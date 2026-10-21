# REDCap access for the hackathon

Small read-only MCP server and CLI for **COMPARE pro Rakathon**, project 64.
Uses the official MCP Python SDK. No server ports, record imports or schema edits.
TLS verification stays enabled; redirects are rejected. Tokens stay out of CLI
arguments and tracked repository files. Every remote tool verifies the project ID first.

## Setup

From the repository root:

```sh
python3 -m venv .local/redcap-venv
.local/redcap-venv/bin/pip install -r tools/redcap/requirements.txt
```

Obtain the project's existing API token from REDCap's API page. Store it in
`.local/redcap-token` with mode 600, or set `REDCAP_API_TOKEN` in the process
environment. `.local/` is gitignored. Never commit the token or paste it into a
command line. Requesting a new token notifies the administrator.

## Direct use

```sh
.local/redcap-venv/bin/python tools/redcap/server.py connection_status
.local/redcap-venv/bin/python tools/redcap/server.py project_info
.local/redcap-venv/bin/python tools/redcap/server.py instruments
.local/redcap-venv/bin/python tools/redcap/server.py data_dictionary
.local/redcap-venv/bin/python tools/redcap/server.py records --args '{"record_ids":["Rakathon1"],"fields":["record_id"]}'
```

The last command is illustrative: inspect the actual dictionary and record IDs
before choosing fields. Export requires explicit IDs and fields. `events` and
`repeating_instruments` inspect the project's row structure.

## MCP host configuration

Use stdio with the absolute executable and server paths:

```json
{
  "mcpServers": {
    "rakathon-redcap": {
      "command": "~/rakathon/.local/redcap-venv/bin/python",
      "args": ["~/rakathon/tools/redcap/server.py"]
    }
  }
}
```

Registered globally on this Mac as `rakathon-redcap` for Codex, Claude Code and
Claude Desktop. Start a new session (restart Claude Desktop) to load it. Keep this
checkout and its virtual environment at their current paths. No token is embedded
in host configurations.

The request layer allowlists export operations and rejects imports and deletes.
Start with `project_info`, `instruments`, `data_dictionary` and `record_ids`.
`record_ids` exports only identifiers; `records` requires explicit IDs and fields.
Server instructions also explain this workflow to MCP clients on initialization.

Configure the approved token with a hidden prompt (validates project 64 and saves
with owner-only permissions):

```sh
.local/redcap-venv/bin/python tools/redcap/configure_token.py
```

Run checks:

```sh
.local/redcap-venv/bin/python -m unittest discover -s tools/redcap -p 'test_*.py'
```

## Network gateway validation

MOÚ's gateway validates individual clients using cookies. A completed browser
CAPTCHA did not automatically validate this Python client. Reusing the existing,
user-validated gateway cookies fixed the connection, without a REDCap login cookie.

The adapter loads `.local/redcap-gateway-cookies.json` (mode 600), sends only the
allowlisted gateway cookie names to the fixed REDCap HTTPS endpoint, and saves
rotated gateway cookies atomically with owner-only permissions. It never saves
REDCap login-session cookies. Neither tokens nor cookies belong in host configs,
chat, logs, or tracked files.

If the session expires, complete the gateway CAPTCHA in Chrome and refresh the
allowlisted gateway cookies from DevTools > Application > Cookies >
`https://redcap.mou.cz`. Copy only names allowed by `GATEWAY_NAMES` in `server.py`
into the private JSON file; exclude all REDCap session cookies. The current
session was configured on 16 October 2026. Automatic CAPTCHA solving is not used.

## Verification on 16 October 2026

Live MCP subprocess calls succeeded for project 64, 354 metadata fields,
9 instruments, discovery of 20 record IDs, and a filtered single-record export.
The Codebook counts 363 fields including the 9 generated form-status fields.
The separate `repeating_instruments` endpoint returned HTTP 404 for this account;
use Codebook for those settings until the server/account permits that export.
`events` is intended for longitudinal projects; this project is classic.
Eight unit/protocol tests pass, including read-only restrictions, gateway cookie
refresh, rejection of login cookies/header injection, and secret file permissions.
