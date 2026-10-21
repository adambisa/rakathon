"""Small read-only REDCap MCP server, also usable directly from the terminal."""

import argparse
import json
import os
import tempfile
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from mcp.server.fastmcp import FastMCP

ROOT = Path(__file__).resolve().parents[2]
API_URL = "https://redcap.mou.cz/api/"
TOKEN_FILE = ROOT / ".local/redcap-token"
GATEWAY_FILE = ROOT / ".local/redcap-gateway-cookies.json"
GATEWAY_NAMES = frozenset({"BNIS___utm_is1", "BNIS___utm_is2", "BNIS___utm_is3",
                           "BNIS_vid", "BNIS_x-bni-jas", "x-bni-ci",
                           "x-bni-fpc", "x-bni-rncf"})
mcp = FastMCP(
    "rakathon-redcap",
    instructions="Read-only access to COMPARE pro Rakathon, REDCap project 64. "
    "Start with project_info, instruments and data_dictionary. Use record_ids to "
    "discover IDs, then records with explicit IDs and fields. Surgery targets are "
    "surgery_c61 and repeating surgery_c61_resected_lesion. Never infer choice codes; "
    "read the dictionary. No imports, updates or deletes are exposed.",
)

EXPORT_PARAMS = {
    "project": set(),
    "metadata": {"forms", "fields"},
    "instrument": set(),
    "event": set(),
    "repeatingFormsEvents": set(),
    "record": {"action", "type", "records", "fields", "forms", "events",
               "rawOrLabel", "rawOrLabelHeaders", "exportCheckboxLabel",
               "exportSurveyFields", "exportDataAccessGroups"},
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def gateway_cookies():
    if not GATEWAY_FILE.exists():
        return {}
    cookies = json.loads(GATEWAY_FILE.read_text())
    if not isinstance(cookies, dict) or any(
        name not in GATEWAY_NAMES or not isinstance(value, str)
        or any(char in value for char in "\r\n;")
        for name, value in cookies.items()
    ):
        raise ValueError("Invalid gateway cookie configuration.")
    return cookies


def save_gateway_cookies(cookies):
    GATEWAY_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=GATEWAY_FILE.parent, prefix=".gateway-")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(cookies, stream)
        os.replace(temporary, GATEWAY_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def request(content: str, **params):
    if content not in EXPORT_PARAMS or set(params) - EXPORT_PARAMS[content]:
        raise ValueError("Only allowlisted read-only REDCap operations are supported.")
    if content == "record":
        if params.get("action", "export") != "export":
            raise ValueError("Only record export is permitted.")
        params["action"] = "export"
    token = os.environ.get("REDCAP_API_TOKEN", "").strip()
    if not token and TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text().strip()
    if not token:
        raise ValueError("API token missing. Set REDCAP_API_TOKEN or .local/redcap-token.")
    payload = {"token": token, "content": content, "format": "json", "returnFormat": "json"}
    for key, value in params.items():
        if isinstance(value, list):
            for index, item in enumerate(value):
                payload[f"{key}[{index}]"] = item
        elif value is not None:
            payload[key] = value
    cookies = gateway_cookies()
    headers = {"Accept": "application/json"}
    if cookies:
        headers["Cookie"] = "; ".join(f"{name}={value}" for name, value in cookies.items())
    req = Request(API_URL, data=urlencode(payload).encode(), method="POST", headers=headers)
    try:
        with build_opener(NoRedirect).open(req, timeout=45) as response:
            raw = response.read()
            if b"Validation request" in raw and b"captcha" in raw.lower():
                raise RuntimeError(
                    "MOÚ network gateway requires browser CAPTCHA validation. "
                    "Complete the challenge in your browser, then refresh the "
                    "MCP's gateway session cookies; browser validation alone does "
                    "not update this client's cookies. See tools/redcap/README.md. "
                    "No REDCap data was returned."
                )
            result = json.loads(raw)
            response_headers = getattr(response, "headers", None)
            if cookies and response_headers is not None:
                updated = dict(cookies)
                for header in response_headers.get_all("Set-Cookie", []):
                    parsed = SimpleCookie()
                    parsed.load(header)
                    for name, morsel in parsed.items():
                        if name in GATEWAY_NAMES:
                            if morsel["max-age"] == "0" or not morsel.value:
                                updated.pop(name, None)
                            else:
                                updated[name] = morsel.value
                if updated != cookies:
                    save_gateway_cookies(updated)
    except HTTPError as exc:
        raise RuntimeError(
            f"REDCap HTTP {exc.code} for {content}; this API method may be unavailable "
            "for this account/project. Check permissions and gateway availability."
        ) from None
    except (URLError, TimeoutError):
        raise RuntimeError("REDCap network request failed; check network/VPN access.") from None
    except (ValueError, UnicodeError):
        raise RuntimeError("REDCap returned a non-JSON response; check API access.") from None
    if isinstance(result, dict) and "error" in result:
        raise RuntimeError(str(result["error"]).replace(token, "[REDACTED]"))
    return result


@mcp.tool(annotations={"readOnlyHint": True})
def connection_status() -> dict:
    """Report local configuration without revealing or transmitting the token."""
    return {"api_url": API_URL, "project_id": 64,
            "token_configured": bool(os.environ.get("REDCAP_API_TOKEN", "").strip())
            or (TOKEN_FILE.exists() and bool(TOKEN_FILE.read_text().strip())),
            "gateway_session_configured": bool(gateway_cookies()),
            "mode": "read-only"}


@mcp.tool(annotations={"readOnlyHint": True})
def project_info() -> dict:
    """Read project settings; verify the token belongs to project 64."""
    result = request("project")
    if str(result.get("project_id")) != "64":
        raise ValueError("Token belongs to another project; expected project 64.")
    return result


@mcp.tool(annotations={"readOnlyHint": True})
def data_dictionary(forms: list[str] | None = None, fields: list[str] | None = None) -> list[dict]:
    """Read exact field names, types, choices, branching logic and annotations."""
    project_info()
    return request("metadata", forms=forms, fields=fields)


@mcp.tool(annotations={"readOnlyHint": True})
def instruments() -> list[dict]:
    """List project instrument names and labels."""
    project_info()
    return request("instrument")


@mcp.tool(annotations={"readOnlyHint": True})
def events() -> list[dict]:
    """List longitudinal events; classic projects may reject this operation."""
    project_info()
    return request("event")


@mcp.tool(annotations={"readOnlyHint": True})
def repeating_instruments() -> list[dict]:
    """Read repeating instrument/event configuration."""
    project_info()
    return request("repeatingFormsEvents")


@mcp.tool(annotations={"readOnlyHint": True})
def record_ids() -> list[str]:
    """Discover record IDs without exporting clinical fields."""
    project_info()
    dictionary = request("metadata")
    if not dictionary:
        return []
    id_field = dictionary[0]["field_name"]
    rows = request("record", action="export", type="flat", fields=[id_field])
    return sorted({str(row[id_field]) for row in rows if row.get(id_field)})


@mcp.tool(annotations={"readOnlyHint": True})
def records(record_ids: list[str], fields: list[str], forms: list[str] | None = None,
            event_names: list[str] | None = None, labels: bool = False) -> list[dict]:
    """Export explicitly selected records and fields, using raw codes by default."""
    if not record_ids or not fields or any(not x.strip() for x in record_ids + fields):
        raise ValueError("Provide nonempty record_ids and fields; unfiltered exports are disabled.")
    project_info()
    return request("record", action="export", type="flat", records=record_ids,
                   fields=fields, forms=forms, events=event_names,
                   rawOrLabel="label" if labels else "raw", rawOrLabelHeaders="raw",
                   exportCheckboxLabel="false", exportSurveyFields="false",
                   exportDataAccessGroups="false")


COMMANDS = {f.__name__: f for f in [connection_status, project_info, data_dictionary,
                                    instruments, events, repeating_instruments, record_ids, records]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=COMMANDS)
    parser.add_argument("--args", default="{}", help="JSON keyword arguments for the command")
    args = parser.parse_args()
    if args.command:
        try:
            print(json.dumps(COMMANDS[args.command](**json.loads(args.args)), ensure_ascii=False, indent=2))
        except (ValueError, RuntimeError) as exc:
            parser.exit(1, f"{exc}\n")
    else:
        mcp.run(transport="stdio")
