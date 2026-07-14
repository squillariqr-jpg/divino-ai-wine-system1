import unittest
import json
import urllib.request
import urllib.error
import threading
import time
import socket
import os
from scripts.rete_squillari_mcp.server import MCPServer
from scripts.rete_squillari_mcp.config import MCPConfig

import hashlib

class StagingReadinessTests(unittest.TestCase):
    def setUp(self):
        self.config = MCPConfig(
            transport="STREAMABLE_HTTP",
            bind_host="127.0.0.1",
            bind_port=0,
            token_digest=hashlib.sha256(b"test").hexdigest(),
            environment="staging",
            worker_start_method="spawn",
            audit_sink="stdout_json"
        )
        self.server = MCPServer(self.config)
        self.http_server = None
        self.server_thread = None

    def _start_server(self):
        from scripts.rete_squillari_mcp_server import run_http

        self.config = MCPConfig(
            transport="STREAMABLE_HTTP",
            bind_host="127.0.0.1",
            bind_port=0,
            token_digest=hashlib.sha256(b"test").hexdigest(),
            environment="staging",
            worker_start_method="spawn",
            audit_sink="stdout_json"
        )
        self.server = MCPServer(self.config)

        def run():
            try:
                run_http(self.server)
            except Exception as e:
                print("run_http error:", e)

        self.server_thread = threading.Thread(target=run, daemon=True)
        self.server_thread.start()

        timeout_start = time.time()
        while not getattr(self.server, "_http_server", None):
            if time.time() - timeout_start > 5:
                raise TimeoutError("Server did not start in 5s")
            time.sleep(0.01)

        return self.server._http_server.server_port

    def _stop_server(self):
        if self.server:
            self.server.shutdown()
        if self.server_thread:
            self.server_thread.join(timeout=1.0)

    def tearDown(self):
        self._stop_server()

    def test_healthz_endpoint_returns_200(self):
        port = self._start_server()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/healthz")
        with urllib.request.urlopen(req, timeout=1) as response:
            self.assertEqual(response.status, 200)
            data = json.loads(response.read().decode())
            self.assertEqual(data["status"], "ok")

    def test_readyz_endpoint_returns_200_when_ready(self):
        port = self._start_server()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/readyz")
        with urllib.request.urlopen(req, timeout=1) as response:
            self.assertEqual(response.status, 200)
            data = json.loads(response.read().decode())
            self.assertEqual(data["status"], "ready")

    def test_readyz_returns_503_during_shutdown(self):
        port = self._start_server()
        self.server._is_shutting_down = True
        req = urllib.request.Request(f"http://127.0.0.1:{port}/readyz")
        try:
            urllib.request.urlopen(req, timeout=1)
            self.fail("Expected HTTPError")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 503)
            data = json.loads(e.read().decode())
            self.assertEqual(data["status"], "shutting_down")

    def test_health_endpoints_reject_post(self):
        port = self._start_server()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/healthz", method="POST", data=b"{}")
        try:
            urllib.request.urlopen(req, timeout=1)
            self.fail("Expected HTTPError")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 405)

        req = urllib.request.Request(f"http://127.0.0.1:{port}/readyz", method="POST", data=b"{}")
        try:
            urllib.request.urlopen(req, timeout=1)
            self.fail("Expected HTTPError")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 405)

    def test_worker_capacity_exhaustion(self):
        # We simulate max capacity
        self.server.config = MCPConfig(
            transport="STREAMABLE_HTTP",
            bind_host="127.0.0.1",
            bind_port=0,
            token_digest="test",
            environment="staging",
            worker_start_method="spawn",
            audit_sink="stdout_json",
            max_active_workers=0  # Zero capacity
        )

        from scripts.rete_squillari_mcp.server import LifecycleState
        session_id = self.server.sessions.create("rete-squillari-local-readonly", "2024-11-05")
        self.server.sessions.sessions[session_id]["lifecycle_state"] = LifecycleState.READY
        self.server._request_protocol_version = "2024-11-05"
        response = self.server.handle({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "rete_squillari.list_locations", "arguments": {}}
        }, token="test", session_id=session_id, request_id_header="test_nonce_1")

        # It should return WORKER_CAPACITY_EXHAUSTED
        self.assertIn("error", response)
        self.assertEqual(response["error"]["message"], "INTERNAL_ERROR")
        self.assertEqual(response["error"]["data"]["reason_code"], "WORKER_CAPACITY_EXHAUSTED")

    def test_shutdown_lifecycle(self):
        port = self._start_server()
        # Trigger shutdown
        self.server.shutdown()
        self.assertTrue(self.server._is_shutting_down)

        # Any new handle should fail with 503 equivalent (handled in HTTP layer via SERVER_IS_SHUTTING_DOWN)
        response = self.server.handle({"jsonrpc":"2.0", "id": 1, "method": "initialize", "params": {}}, token="test")
        self.assertEqual(response["error"]["data"]["reason_code"], "SERVER_IS_SHUTTING_DOWN")

    def test_staging_config_validation(self):
        config = MCPConfig(
            transport="STREAMABLE_HTTP",
            bind_host="127.0.0.1",
            bind_port=8767,
            token_digest="test",
            environment="staging",
            worker_start_method="fork", # Invalid for staging
            audit_sink="stdout_json"
        )
        self.assertEqual(config.validate(), "STAGING_REQUIRES_SPAWN")

        config = MCPConfig(
            transport="STREAMABLE_HTTP",
            bind_host="127.0.0.1",
            bind_port=8767,
            token_digest="test",
            environment="staging",
            worker_start_method="spawn",
            audit_sink="memory" # Invalid for staging
        )
        self.assertEqual(config.validate(), "STAGING_REQUIRES_STDOUT_AUDIT")

    def test_audit_sink_memory(self):
        from scripts.rete_squillari_mcp.audit import MCPAudit
        audit = MCPAudit(sink="memory")
        evt = audit.append(method="test")
        self.assertEqual(len(audit.events), 1)
        self.assertEqual(audit.events[0]["method"], "test")

    def test_audit_sink_stdout(self):
        import io, sys
        from scripts.rete_squillari_mcp.audit import MCPAudit
        audit = MCPAudit(sink="stdout_json")
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        try:
            audit.append(method="test_stdout")
            output = sys.stdout.getvalue()
            self.assertIn('"method":"test_stdout"', output)
        finally:
            sys.stdout = old_stdout

    def test_entrypoint_import(self):
        import scripts.rete_squillari_mcp_entrypoint
        self.assertTrue(hasattr(scripts.rete_squillari_mcp_entrypoint, "main"))

    def test_entrypoint_invalid_config(self):
        import scripts.rete_squillari_mcp_entrypoint
        import sys, os
        old_env = dict(os.environ)
        os.environ["RETE_SQUILLARI_MCP_ENV"] = "production"
        try:
            with self.assertRaises(SystemExit) as cm:
                scripts.rete_squillari_mcp_entrypoint.main()
            self.assertEqual(cm.exception.code, 1)
        finally:
            os.environ.clear()
            os.environ.update(old_env)

    def test_dockerfile_references_tracked_files(self):
        import subprocess
        # Basic check to see if we can find the tracked files mentioned in Dockerfile
        with open("Dockerfile.rete-squillari-mcp", "r") as f:
            content = f.read()
        self.assertIn("scripts/rete_squillari_mcp_entrypoint.py", content)

if __name__ == '__main__':
    unittest.main()
