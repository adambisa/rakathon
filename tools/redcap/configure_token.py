"""Save a REDCap token with a hidden prompt; never print it or put it in argv."""

import getpass
import os
import re
import tempfile

from server import TOKEN_FILE, project_info


def main():
    token = getpass.getpass("REDCap project 64 API token (hidden): ").strip()
    if not re.fullmatch(r"[a-fA-F0-9]{32}", token):
        raise SystemExit("Expected a 32-character hexadecimal REDCap API token.")
    os.environ["REDCAP_API_TOKEN"] = token
    project = project_info()
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=TOKEN_FILE.parent, prefix=".redcap-token-")
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(token + "\n")
        os.replace(temporary, TOKEN_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f"Connected to {project.get('project_title', 'REDCap')} (project 64).")
    print("Token saved with owner-only permissions; MCP access is read-only.")


if __name__ == "__main__":
    main()
