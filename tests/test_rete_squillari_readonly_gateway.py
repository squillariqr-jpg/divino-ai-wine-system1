import copy, pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "scripts"))
from rete_squillari_tools.adapters import LOCATIONS, LocalStorageDemoReadOnlyAdapter
from rete_squillari_tools.contracts import TOOL_DEFINITIONS, ToolDefinition, validate_tool_contract
from rete_squillari_tools.registry import ToolRegistry
from rete_squillari_tools.gateway import WBOSReadOnlyApplicationGateway

VALID = {"actor_type": "AGENT", "actor_id": "agent-1", "agent_id": "run-agent", "capabilities": ["rete_squillari.locations.read", "rete_squillari.shortages.read", "rete_squillari.shortages.validate", "rete_squillari.print.preview"], "correlation_id": "corr-1"}
class GatewayTests(unittest.TestCase):
    def setUp(self): self.adapter = LocalStorageDemoReadOnlyAdapter(); self.gateway = WBOSReadOnlyApplicationGateway(adapter=self.adapter)
    def run_tool(self, name, data=None, identity=None): return self.gateway.run_read_tool(VALID if identity is None else identity, name, data or {})
    def test_registry_has_exactly_eight_valid_tools(self):
        self.assertEqual(len(TOOL_DEFINITIONS), 8); self.assertTrue(all(not validate_tool_contract(t) for t in TOOL_DEFINITIONS)); self.assertTrue(all(t.read_only for t in TOOL_DEFINITIONS)); self.assertEqual(len({t.name for t in TOOL_DEFINITIONS}), 8)
    def test_identity_and_capability_fail_closed(self):
        self.assertEqual(self.run_tool("rete_squillari.list_locations", identity={})["status"], "DENIED")
        self.assertEqual(self.run_tool("rete_squillari.list_locations", identity={**VALID, "capabilities": []})["status"], "DENIED")
        self.assertEqual(self.run_tool("rete_squillari.list_locations", identity={**VALID, "agent_id": None})["status"], "DENIED")
        self.assertEqual(self.run_tool("rete_squillari.list_locations", identity={**VALID, "actor_type": "UNKNOWN"})["status"], "DENIED")
        self.assertEqual(self.run_tool("rete_squillari.list_locations", identity={**VALID, "correlation_id": ""})["status"], "DENIED")
        self.assertEqual(self.run_tool("rete_squillari.list_locations", identity={**VALID, "capabilities": ["unknown.capability"]})["status"], "DENIED")
    def test_locations_and_reasons(self):
        locations = self.run_tool("rete_squillari.list_locations")["result"]; self.assertEqual(len(locations), 7); self.assertEqual(sum(x["type"] == "STORE" for x in locations), 6); self.assertEqual(next(x for x in locations if x["id"] == "trasta")["type"], "WAREHOUSE")
        self.assertEqual(self.run_tool("rete_squillari.get_allowed_reasons", {"location_id": "cantore"})["result"]["reasons"], ["CUSTOMER_SALE", "ONLINE_SALE", "STOCK_GAP"])
        self.assertEqual(self.run_tool("rete_squillari.get_allowed_reasons", {"location_id": "trasta"})["result"]["reasons"], ["ONLINE_SALE", "STOCK_GAP"])
    def test_reads_validation_and_not_found(self):
        self.assertEqual(self.run_tool("rete_squillari.list_shortage_requests")["status"], "SUCCESS"); self.assertEqual(self.run_tool("rete_squillari.get_shortage_request", {"request_id": "UNKNOWN"})["status"], "NOT_FOUND")
        good = {"requester_location_id": "cantore", "product_code": "SKU", "product_description": "Test", "quantity": 2, "reason": "ONLINE_SALE", "comment": "", "priority": "HIGH"}; self.assertTrue(self.run_tool("rete_squillari.validate_shortage_request", good)["result"]["valid"])
        bad = {**good, "requester_location_id": "trasta", "reason": "CUSTOMER_SALE"}; self.assertFalse(self.run_tool("rete_squillari.validate_shortage_request", bad)["result"]["valid"])
        self.assertEqual(self.run_tool("rete_squillari.get_location", {"location_id": "unknown"})["status"], "INVALID_INPUT")
        self.assertEqual(self.run_tool("rete_squillari.get_shortage_request", {"request_id": "DEMO-001", "extra": True})["status"], "INVALID_INPUT")
    def test_previews_are_non_mutating_and_evidenced(self):
        before = copy.deepcopy(self.adapter._requests); response = self.run_tool("rete_squillari.preview_request_print", {"request_id": "DEMO-001"}); self.assertEqual(response["status"], "SUCCESS"); self.assertTrue(response["read_only"]); self.assertEqual(before, self.adapter._requests); self.assertEqual(self.gateway.evidence.get(response["evidence_id"])["source_mode"], "DEMO"); self.assertEqual(self.gateway.audit.get(response["audit_event_id"])["correlation_id"], "corr-1")
    def test_unknown_and_write_like_tools_denied_without_stack_trace(self):
        self.assertEqual(self.run_tool("rete_squillari.execute")["status"], "DENIED"); self.assertEqual(self.run_tool("unknown.tool")["status"], "DENIED"); self.assertNotIn("Traceback", str(self.run_tool("unknown.tool")))
    def test_registry_rejects_duplicates_and_generic_names(self):
        with self.assertRaises(ValueError): ToolRegistry(TOOL_DEFINITIONS + (TOOL_DEFINITIONS[0],))
        bad = ToolDefinition("rete_squillari.execute", "1.0.0", "bad", "R0_READ_ONLY", True, {}, {}, "cap", (), "a", "e", True, "bounded", ())
        with self.assertRaises(ValueError): ToolRegistry((bad,))
    def test_fingerprint_is_stable_for_same_input_and_output(self):
        a = self.run_tool("rete_squillari.list_locations"); b = self.run_tool("rete_squillari.list_locations"); self.assertEqual(self.gateway.evidence.get(a["evidence_id"])["input_fingerprint"], self.gateway.evidence.get(b["evidence_id"])["input_fingerprint"]); self.assertEqual(self.gateway.evidence.get(a["evidence_id"])["output_fingerprint"], self.gateway.evidence.get(b["evidence_id"])["output_fingerprint"])
if __name__ == "__main__": unittest.main()
