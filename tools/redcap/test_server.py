import asyncio
import io
import json
import os
import sys
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

import server


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        patcher = patch.object(server, "GATEWAY_FILE", Path(temporary.name) / "gateway.json")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_validated_gateway_cookie_is_sent_and_refreshed(self):
        server.save_gateway_cookies({"x-bni-ci": "validated-session"})
        response = io.BytesIO(b'{"project_id":64}')
        response.headers = Message()
        response.headers.add_header("Set-Cookie", "x-bni-ci=refreshed-session; Path=/; Secure")
        response.headers.add_header("Set-Cookie", "redcap_session=not-to-be-saved; Path=/")
        with patch.dict(os.environ, {"REDCAP_API_TOKEN": "test-secret"}):
            with patch.object(server, "build_opener") as factory:
                factory.return_value.open.return_value = response
                self.assertEqual(server.request("project"), {"project_id": 64})
                req = factory.return_value.open.call_args.args[0]
                self.assertEqual(req.get_header("Cookie"), "x-bni-ci=validated-session")
        self.assertEqual(server.gateway_cookies(), {"x-bni-ci": "refreshed-session"})
        self.assertEqual(server.GATEWAY_FILE.stat().st_mode & 0o777, 0o600)

    def test_non_gateway_credentials_and_header_injection_are_rejected(self):
        for cookies in [{"redcap_session": "session"}, {"x-bni-ci": "value\r\nInjected: yes"}]:
            server.GATEWAY_FILE.write_text(json.dumps(cookies))
            with self.assertRaisesRegex(ValueError, "Invalid gateway"):
                server.gateway_cookies()

    def test_gateway_challenge_is_reported(self):
        with patch.dict(os.environ, {"REDCAP_API_TOKEN": "test-secret"}):
            with patch.object(server, "build_opener") as factory:
                factory.return_value.open.return_value = io.BytesIO(
                    b'<title>Validation request</title><img src="/captcha.gif">')
                with self.assertRaisesRegex(RuntimeError, "browser CAPTCHA"):
                    server.request("project")

    def test_mutations_rejected_before_network(self):
        for content, params in [("record", {"action": "import"}),
                                ("record", {"action": "delete"}),
                                ("metadata", {"data": "[]"}),
                                ("user", {}), ("project", {"token": "override"})]:
            with self.subTest(content=content, params=params):
                with patch.object(server, "build_opener") as call:
                    with self.assertRaises(ValueError):
                        server.request(content, **params)
                    call.assert_not_called()

    def test_wrong_project_stops_metadata(self):
        with patch.object(server, "request", return_value={"project_id": 12}) as call:
            with self.assertRaisesRegex(ValueError, "another project"):
                server.data_dictionary()
            self.assertEqual(call.call_count, 1)

    def test_unfiltered_records_never_contact_api(self):
        with patch.object(server, "request") as call:
            with self.assertRaises(ValueError):
                server.records([], ["record_id"])
            call.assert_not_called()

    def test_form_encoding_and_secret_redaction(self):
        with patch.dict(os.environ, {"REDCAP_API_TOKEN": "test-secret"}):
            with patch.object(server, "build_opener") as factory:
                factory.return_value.open.return_value = io.BytesIO(json.dumps({"error": "test-secret denied"}).encode())
                with self.assertRaisesRegex(RuntimeError, r"\[REDACTED\] denied"):
                    server.request("record", records=["a", "b"])
                req = factory.return_value.open.call_args.args[0]
                encoded = parse_qs(req.data.decode())
                self.assertEqual(encoded["records[1]"], ["b"])
                self.assertEqual(req.full_url, server.API_URL)

    def test_stdio_handshake_and_tool_call(self):
        async def run():
            params = StdioServerParameters(command=sys.executable, args=[str(Path(server.__file__).resolve())])
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listed = await session.list_tools()
                    self.assertEqual(len(listed.tools), 8)
                    self.assertTrue(all(tool.annotations.readOnlyHint for tool in listed.tools))
                    result = await session.call_tool("connection_status", {})
                    self.assertFalse(result.isError)
                    self.assertIn('"project_id": 64', result.content[0].text)
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
