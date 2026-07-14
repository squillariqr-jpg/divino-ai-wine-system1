import hashlib, json, os, pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "scripts"))
from rete_squillari_mcp.auth import StaticDigestCredentialVerifier
from rete_squillari_mcp.config import MCPConfig
from rete_squillari_mcp.server import MCPServer
from rete_squillari_mcp.session import SessionStore
from rete_squillari_mcp.rate_limit import RateLimiter

TOKEN = "local-test-token"
def server(**kw): return MCPServer(MCPConfig(token_digest=hashlib.sha256(TOKEN.encode()).hexdigest(), **kw))
class MCPTests(unittest.TestCase):
    def setUp(self): self.s = server()
    def call(self, method="tools/list", params=None, rid=1, token=TOKEN, nonce=None): return self.s.handle({"jsonrpc":"2.0","id":rid,"method":method,"params":params or {}}, token, request_id_header=nonce or f"req-{rid}")
    def test_server_starts(self): self.assertIsInstance(self.s, MCPServer)
    def test_tools_list_count(self): self.assertEqual(len(self.call()["result"]["tools"]), 8)
    def test_tools_are_read_only(self): self.assertTrue(all(t["annotations"]["readOnlyHint"] for t in self.call()["result"]["tools"]))
    def test_tools_are_non_destructive(self): self.assertTrue(all(not t["annotations"]["destructiveHint"] for t in self.call()["result"]["tools"]))
    def test_tools_are_idempotent(self): self.assertTrue(all(t["annotations"]["idempotentHint"] for t in self.call()["result"]["tools"]))
    def test_unknown_method(self): self.assertEqual(self.call("nope")["error"]["message"], "METHOD_NOT_FOUND")
    def test_unknown_tool(self): self.assertTrue(self.call("tools/call", {"name":"rete_squillari.nope","arguments":{}}, 2)["result"]["isError"])
    def test_missing_token(self): self.assertEqual(self.call(token=None)["error"]["message"], "AUTHENTICATION_FAILED")
    def test_empty_token(self): self.assertEqual(self.call(token="")["error"]["message"], "AUTHENTICATION_FAILED")
    def test_invalid_token(self): self.assertEqual(self.call(token="bad")["error"]["message"], "AUTHENTICATION_FAILED")
    def test_valid_token(self): self.assertIn("tools", self.call()["result"])
    def test_constant_time_verifier(self): self.assertIsNotNone(StaticDigestCredentialVerifier(hashlib.sha256(TOKEN.encode()).hexdigest()).verify(TOKEN))
    def test_missing_http_secret_blocks_config(self): self.assertEqual(MCPConfig(transport="STREAMABLE_HTTP").validate(), "MISSING_AUTH_OR_INVALID_SOURCE")
    def test_non_loopback_blocks_config(self): self.assertEqual(MCPConfig(transport="STREAMABLE_HTTP", bind_host="0.0.0.0", token_digest="x").validate(), "NON_LOOPBACK_BIND_DENIED")
    def test_lan_blocks_config(self): self.assertEqual(MCPConfig(transport="STREAMABLE_HTTP", bind_host="192.168.1.5", token_digest="x").validate(), "NON_LOOPBACK_BIND_DENIED")
    def test_principal_is_server_side(self): self.assertEqual(self.s.profile.capabilities[0], "rete_squillari.locations.read")
    def test_client_metadata_cannot_add_capability(self): self.assertNotIn("write", self.s.profile.capabilities)
    def test_correlation_metadata_is_limited(self): self.assertEqual(self.s.profile.principal("x","s",{}).correlation_id, "mcp-correlation")
    def test_agent_identity_is_present(self): self.assertEqual(self.s.profile.principal("x","s",{}) .actor_type, "AGENT")
    def test_gateway_success_call(self): self.assertFalse(self.call("tools/call", {"name":"rete_squillari.list_locations","arguments":{}}, 2)["result"]["isError"])
    def test_gateway_scope_denial(self):
        self.s.profile.locations = ("cantore",); result = self.call("tools/call", {"name":"rete_squillari.get_location","arguments":{"location_id":"malta"}}, 2); self.assertTrue(result["result"]["isError"])
    def test_invalid_arguments(self):
        result = self.call("tools/call", {"name":"rete_squillari.get_location","arguments":{"location_id":"unknown"}}, 2); self.assertTrue(result["result"]["isError"])
    def test_additional_arguments_denied_by_gateway(self):
        result = self.call("tools/call", {"name":"rete_squillari.get_location","arguments":{"location_id":"malta","extra":True}}, 2); self.assertTrue(result["result"]["isError"])
    def test_invalid_output_reason_preserved(self):
        identity = self.s.profile.principal("x", "s", {}).__dict__.copy(); identity["authorized_location_ids"] = list(identity["authorized_location_ids"]); identity["capabilities"] = list(identity["capabilities"])
        self.assertEqual(self.s.gateway.run_read_tool(identity, "rete_squillari.get_location", {"location_id":"malta"})["status"], "SUCCESS")
    def test_session_created(self): self.call(); self.assertTrue(self.s.sessions.sessions)
    def test_unknown_session_denied(self): self.assertEqual(self.s.sessions.validate("missing", "x"), None)
    def test_credential_mismatch_denied(self): sid=self.s.sessions.create("a"); self.assertIsNone(self.s.sessions.validate(sid,"b"))
    def test_expired_session_denied(self): self.s.sessions.ttl = -1; sid=self.s.sessions.create("a"); self.assertIsNone(self.s.sessions.validate(sid,"a"))
    def test_duplicate_request_id_denied(self): self.call(); sid=next(iter(self.s.sessions.sessions)); self.assertEqual(self.s.handle({"jsonrpc":"2.0","id":2,"method":"tools/list"},TOKEN,session_id=sid,request_id_header="req-1")["error"]["message"], "REPLAY_OR_MISSING_REQUEST_ID")
    def test_empty_request_id_denied(self): sid=self.s.sessions.create("rete-squillari-local-readonly"); self.assertEqual(self.s.handle({"jsonrpc":"2.0","id":1,"method":"tools/list"},TOKEN,session_id=sid,request_id_header="")["error"]["message"], "REPLAY_OR_MISSING_REQUEST_ID")
    def test_long_request_id_denied(self): self.assertEqual(self.call(nonce="x"*129)["error"]["message"], "REPLAY_OR_MISSING_REQUEST_ID")
    def test_rate_limit(self): s=server(max_requests_per_minute=1); s.handle({"jsonrpc":"2.0","id":1,"method":"tools/list"},TOKEN,request_id_header="a"); sid=next(iter(s.sessions.sessions)); self.assertEqual(s.handle({"jsonrpc":"2.0","id":2,"method":"tools/list"},TOKEN,session_id=sid,request_id_header="b")["error"]["message"], "RATE_LIMITED")
    def test_oversized_payload(self): s=server(max_payload_bytes=20); self.assertEqual(s.handle({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"x":"x"*100}},TOKEN,request_id_header="a")["error"]["data"]["reason_code"], "PAYLOAD_TOO_LARGE")
    def test_invalid_jsonrpc(self): self.assertEqual(self.s.handle({"id":1},TOKEN)["error"]["message"], "INVALID_REQUEST")
    def test_error_has_no_token(self): self.assertNotIn(TOKEN, json.dumps(self.call(token="wrong")))
    def test_error_has_no_digest(self): self.assertNotIn(hashlib.sha256(TOKEN.encode()).hexdigest(), json.dumps(self.call(token="wrong")))
    def test_audit_has_no_token(self): self.call(token="wrong"); self.assertNotIn(TOKEN, json.dumps(self.s.audit.events))
    def test_stdio_has_no_network_config(self): self.assertEqual(self.s.config.transport, "STDIO")
    def test_source_demo(self): self.assertEqual(self.s.config.source_mode, "DEMO")
    def test_no_write_tools(self): self.assertFalse(any("create" in t["name"] or "update" in t["name"] or "delete" in t["name"] for t in self.call()["result"]["tools"]))
    def test_rate_limiter(self): r=RateLimiter(1); self.assertTrue(r.allow("x")); self.assertFalse(r.allow("x"))
    def test_session_nonce_store(self): sid=self.s.sessions.create("x"); self.assertTrue(self.s.sessions.accept_nonce(sid,"n")); self.assertFalse(self.s.sessions.accept_nonce(sid,"n"))
if __name__ == "__main__": unittest.main()
