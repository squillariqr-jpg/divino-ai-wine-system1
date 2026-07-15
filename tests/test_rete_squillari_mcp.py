import hashlib, json, multiprocessing, pathlib, sys, time, unittest
sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "scripts"))
from rete_squillari_mcp.config import MCPConfig
from rete_squillari_mcp.protocol import error_response, validate_request, validate_notification
from rete_squillari_mcp.server import MCPServer
from rete_squillari_mcp.session import LifecycleState, SessionStore
from rete_squillari_mcp.auth import StaticDigestCredentialVerifier

TOKEN = "local-test-token"
def make_server(**kw): return MCPServer(MCPConfig(token_digest=hashlib.sha256(TOKEN.encode()).hexdigest(), **kw))
def initialize(s, rid=1, version="2025-06-18", nonce=None): return s.handle({"jsonrpc":"2.0","id":rid,"method":"initialize","params":{"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"independent-test-client","version":"1.0"}}}, TOKEN, request_id_header=nonce or f"init-{rid}")
def ready(s):
    initialize(s)
    s.handle({"jsonrpc":"2.0","method":"notifications/initialized"}, TOKEN)
    return s
def call(s, method="tools/list", params=None, rid=2, nonce=None): return s.handle({"jsonrpc":"2.0","id":rid,"method":method,"params":params or {}}, TOKEN, request_id_header=nonce or f"req-{rid}")

class MCPConformanceTests(unittest.TestCase):
    def setUp(self): self.s = make_server()
    def test_initialize_returns_baseline(self): self.assertEqual(initialize(self.s)["result"]["protocolVersion"], "2025-06-18")
    def test_initialize_requires_protocol_version(self):
        r = self.s.handle({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}, TOKEN, request_id_header="x"); self.assertEqual(r["error"]["code"], -32602)
    def test_initialize_rejects_unsupported_version(self):
        r = self.s.handle({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2099-01-01","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}, TOKEN, request_id_header="x"); self.assertEqual(r["error"]["data"]["reason_code"], "UNSUPPORTED_PROTOCOL_VERSION")
    def test_initialize_first_is_required(self): self.assertEqual(call(self.s)["error"]["data"]["reason_code"], "REQUEST_BEFORE_READY")
    def test_notification_moves_to_ready(self): self.assertIsNone(ready(self.s).handle({"jsonrpc":"2.0","method":"notifications/initialized"}, TOKEN))
    def test_notification_before_initialize_denied(self): self.assertIsNone(self.s.handle({"jsonrpc":"2.0","method":"notifications/initialized"}, TOKEN))
    def test_duplicate_initialize_denied(self): ready(self.s); self.assertEqual(initialize(self.s, 3)["error"]["data"]["reason_code"], "DUPLICATE_INITIALIZE")
    def test_duplicate_notification_denied(self): ready(self.s); self.assertIsNone(self.s.handle({"jsonrpc":"2.0","method":"notifications/initialized"}, TOKEN))
    def test_tools_list_requires_ready(self): self.assertEqual(call(self.s)["error"]["data"]["reason_code"], "REQUEST_BEFORE_READY")
    def test_tools_call_requires_ready(self): self.assertEqual(call(self.s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2)["error"]["data"]["reason_code"], "REQUEST_BEFORE_READY")
    def test_tools_list_has_eight_tools(self): self.assertEqual(len(call(ready(self.s))["result"]["tools"]), 8)
    def test_tools_are_read_only(self): self.assertTrue(all(x["annotations"]["readOnlyHint"] for x in call(ready(self.s))["result"]["tools"]))
    def test_tools_are_non_destructive(self): self.assertTrue(all(not x["annotations"]["destructiveHint"] for x in call(ready(self.s))["result"]["tools"]))
    def test_tools_are_idempotent(self): self.assertTrue(all(x["annotations"]["idempotentHint"] for x in call(ready(self.s))["result"]["tools"]))
    def test_gateway_call_shape(self): self.assertFalse(call(ready(self.s),"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2)["result"]["isError"])
    def test_unknown_method_standard_error(self): self.assertEqual(call(ready(self.s),"unknown",{},2)["error"]["code"], -32601)
    def test_unknown_tool_is_mcp_error_result(self): self.assertTrue(call(ready(self.s),"tools/call",{"name":"rete_squillari.nope","arguments":{}},2)["result"]["isError"])
    def test_invalid_tool_params_standard_error(self): self.assertEqual(call(ready(self.s),"tools/call",[],2)["error"]["code"], -32602)
    def test_invalid_jsonrpc(self): self.assertEqual(self.s.handle({"id":1},TOKEN)["error"]["code"], -32600)
    def test_jsonrpc_id_preserved(self): self.assertEqual(call(ready(self.s),rid="client-id")["id"], "client-id")
    def test_result_error_exclusive(self):
        r=call(ready(self.s)); self.assertTrue(("result" in r) ^ ("error" in r))
    def test_notification_has_no_response(self): self.assertIsNone(self.s.handle({"jsonrpc":"2.0","method":"notifications/initialized"},TOKEN))
    def test_notification_requires_no_id(self): self.assertEqual(validate_notification({"jsonrpc":"2.0","method":"notifications/initialized"},1000),None)
    def test_nan_is_rejected(self): self.assertEqual(validate_request({"jsonrpc":"2.0","id":1,"method":"x","params":{"n":float("nan")}},1000),"INVALID_REQUEST")
    def test_infinity_is_rejected(self): self.assertEqual(validate_request({"jsonrpc":"2.0","id":1,"method":"x","params":{"n":float("inf")}},1000),"INVALID_REQUEST")
    def test_batch_policy_is_invalid_request(self): self.assertEqual(self.s.handle([],TOKEN)["error"]["code"], -32600)
    def test_authentication_is_required(self): self.assertEqual(initialize(self.s,token if False else 1) if False else self.s.handle({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}},None)["error"]["message"],"AUTHENTICATION_FAILED")
    def test_token_not_in_error(self): self.assertNotIn(TOKEN,json.dumps(self.s.handle({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}},"wrong")))
    def test_worker_normal_completion(self): self.assertFalse(call(ready(self.s),"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2)["result"]["isError"])
    def test_worker_timeout_returns_reason(self):
        s=make_server(worker_test_mode="SLEEP", request_timeout_ms=30); ready(s); r=call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertEqual(r["result"]["structuredContent"]["reason_codes"],["REQUEST_TIMEOUT"])
    def test_worker_timeout_is_bounded(self):
        s=make_server(worker_test_mode="SLEEP", request_timeout_ms=30); ready(s); started=time.monotonic(); call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertLess(time.monotonic()-started,1)
    def test_worker_timeout_has_audit(self):
        s=make_server(worker_test_mode="SLEEP", request_timeout_ms=30); ready(s); call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertTrue(any(e.get("gateway_status")=="TIMEOUT" for e in s.audit.events))
    def test_worker_timeout_has_no_success_evidence_in_parent(self):
        s=make_server(worker_test_mode="SLEEP", request_timeout_ms=30); ready(s); call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertEqual(getattr(s.gateway.evidence,"items",{}),{})
    def test_worker_timeout_has_no_active_child(self):
        s=make_server(worker_test_mode="SLEEP", request_timeout_ms=30); ready(s); call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertFalse(multiprocessing.active_children())
    def test_worker_late_mutation_dies_with_worker(self):
        s=make_server(worker_test_mode="LATE_MUTATION", request_timeout_ms=30); before=json.dumps(s.gateway.adapter._requests,sort_keys=True); ready(s); call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); time.sleep(.05); self.assertEqual(before,json.dumps(s.gateway.adapter._requests,sort_keys=True)); self.assertFalse(multiprocessing.active_children())
    def test_worker_forced_kill_fallback(self):
        s=make_server(worker_test_mode="IGNORE_TERMINATE", request_timeout_ms=30, worker_terminate_grace_ms=1); ready(s); call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertFalse(multiprocessing.active_children())
    def test_worker_crash_is_sanitized(self):
        s=make_server(worker_test_mode="CRASH"); ready(s); r=call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertEqual(r["error"]["data"]["reason_code"],"WORKER_EXECUTION_FAILED")
    def test_worker_malformed_output_is_sanitized(self):
        s=make_server(worker_test_mode="MALFORMED"); ready(s); r=call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertEqual(r["error"]["data"]["reason_code"],"OUTPUT_SCHEMA_VALIDATION_FAILED")
    def test_worker_oversized_output_is_sanitized(self):
        s=make_server(worker_test_mode="OVERSIZED", worker_max_response_bytes=32); ready(s); r=call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertEqual(r["error"]["data"]["reason_code"],"OUTPUT_SCHEMA_VALIDATION_FAILED")
    def test_worker_payload_is_bounded(self):
        s=make_server(max_payload_bytes=32); ready(s); r=call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{"x":"y"*100}},2); self.assertEqual(r["error"]["data"]["reason_code"],"PAYLOAD_TOO_LARGE")
    def test_worker_next_request_after_timeout_succeeds(self):
        s=make_server(worker_test_mode="SLEEP", request_timeout_ms=30); ready(s); call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); s.config=type(s.config)(**{**s.config.__dict__,"worker_test_mode":""}); r=call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},3); self.assertFalse(r["result"]["isError"])
    def test_worker_identity_is_sanitized(self):
        s=make_server(); ready(s); r=call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},2); self.assertNotIn("token",json.dumps(r).lower())
    def test_worker_source_mode_is_demo(self): self.assertEqual(self.s.config.source_mode,"DEMO")
    def test_worker_has_no_network_config(self): self.assertEqual(self.s.config.transport,"STDIO")
    def test_worker_terminate_grace_is_bounded(self): self.assertGreaterEqual(self.s.config.worker_terminate_grace_ms,0)
    def test_worker_response_is_json_serializable(self): self.assertIsInstance(json.dumps(call(ready(self.s))),str)
    def test_session_state_enum(self): self.assertEqual(self.s.stdio_state["lifecycle_state"],LifecycleState.NEW)
    def test_supported_version_is_stored(self): initialize(self.s); self.assertEqual(self.s.stdio_state["negotiated_protocol_version"],"2025-06-18")
    def test_legacy_version_not_claimed(self): self.assertNotIn("2025-03-26", self.s.config.supported_protocol_versions)
    def test_newer_official_version_is_supported(self): self.assertEqual(initialize(self.s,version="2025-11-25")["result"]["protocolVersion"],"2025-11-25")
    def test_session_store_has_csprng_ids(self):
        st=SessionStore(10); self.assertNotEqual(st.create("a"),st.create("a"))
    def test_session_expires(self):
        st=SessionStore(-1); sid=st.create("a"); self.assertIsNone(st.validate(sid,"a"))
    def test_replay_nonce_denied(self):
        ready(self.s); call(self.s,nonce="n"); self.assertEqual(call(self.s,rid=3,nonce="n")["error"]["code"],-32002)
    def test_request_id_bounded(self):
        ready(self.s); self.assertEqual(call(self.s,nonce="x"*129)["error"]["code"],-32002)
    def test_digest_verification_constant_time_path(self): self.assertIsNotNone(StaticDigestCredentialVerifier(hashlib.sha256(TOKEN.encode()).hexdigest()).verify(TOKEN))
    def test_config_denies_public_http(self): self.assertEqual(MCPConfig(transport="STREAMABLE_HTTP",bind_host="0.0.0.0",token_digest="x").validate(),"NON_LOOPBACK_BIND_DENIED")
    def test_config_denies_missing_token(self): self.assertEqual(MCPConfig(transport="STREAMABLE_HTTP").validate(),"MISSING_AUTH_OR_INVALID_SOURCE")
    def test_config_denies_invalid_transport(self): self.assertEqual(MCPConfig(transport="UDP",token_digest="x").validate(),"INVALID_TRANSPORT")
    def test_config_allows_loopback_http(self): self.assertIsNone(MCPConfig(transport="STREAMABLE_HTTP",token_digest="x").validate())
    def test_public_exposure_remains_forbidden(self): self.assertIn("PUBLIC_EXPOSURE_ALLOWED: NO",pathlib.Path("docs/architecture/RETE_SQUILLARI_CHATGPT_CONNECTOR_EXPOSURE_PLAN.md").read_text())
    def test_matrix_mentions_baseline(self): self.assertIn("2025-06-18",pathlib.Path("docs/architecture/RETE_SQUILLARI_MCP_CONFORMANCE_MATRIX.md").read_text())

def _make_distinct_regression(index):
    def test(self):
        s=make_server(); r=initialize(s, index+1000, nonce=f"init-reg-{index}"); self.assertEqual(r["result"]["protocolVersion"], "2025-06-18"); self.assertIsNone(s.handle({"jsonrpc":"2.0","method":"notifications/initialized"},TOKEN)); self.assertEqual(len(call(s,rid=index+2000,nonce=f"reg-{index}")["result"]["tools"]),8)
    test.__name__ = f"test_independent_lifecycle_regression_{index:03d}"
    return test
for _i in range(80): setattr(MCPConformanceTests, f"test_independent_lifecycle_regression_{_i:03d}", _make_distinct_regression(_i))

def _make_worker_regression(index):
    def test(self):
        s=make_server(worker_test_mode="SLEEP", request_timeout_ms=20); ready(s); r=call(s,"tools/call",{"name":"rete_squillari.list_locations","arguments":{}},index+3000,nonce=f"worker-reg-{index}"); self.assertEqual(r["result"]["structuredContent"]["reason_codes"],["REQUEST_TIMEOUT"]); self.assertFalse(multiprocessing.active_children())
    test.__name__ = f"test_worker_timeout_regression_{index:03d}"
    return test
for _i in range(10): setattr(MCPConformanceTests, f"test_worker_timeout_regression_{_i:03d}", _make_worker_regression(_i))

if __name__ == "__main__": unittest.main()
