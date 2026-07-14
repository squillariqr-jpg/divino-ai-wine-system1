import hashlib, json, time, uuid
from copy import deepcopy
from .adapters import LocalStorageDemoReadOnlyAdapter
from .audit import AuditStore
from .contracts import CAPABILITIES
from .evidence import EvidenceStore
from .registry import ToolRegistry

class WBOSReadOnlyApplicationGateway:
    def __init__(self, adapter=None, registry=None, audit=None, evidence=None):
        self.adapter = adapter or LocalStorageDemoReadOnlyAdapter(); self.registry = registry or ToolRegistry(); self.audit = audit or AuditStore(); self.evidence = evidence or EvidenceStore()
    def _fingerprint(self, value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    def _identity_error(self, identity):
        if not isinstance(identity, dict) or not identity.get("actor_type") or identity.get("actor_type") not in ("HUMAN", "AGENT", "SYSTEM"): return "MISSING_OR_UNKNOWN_ACTOR"
        if not identity.get("actor_id"): return "MISSING_ACTOR_ID"
        if identity["actor_type"] == "AGENT" and not identity.get("agent_id"): return "MISSING_AGENT_ID"
        if not isinstance(identity.get("capabilities"), list): return "MISSING_CAPABILITIES"
        if not identity.get("correlation_id"): return "MISSING_CORRELATION_ID"
        return None
    def _input_error(self, tool, data):
        data = data if isinstance(data, dict) else {}
        schema = tool.input_schema
        if set(data) - set(schema.get("properties", {})): return "INVALID_SCHEMA"
        if any(field not in data for field in schema.get("required", [])): return "INVALID_INPUT"
        for key, rule in schema.get("properties", {}).items():
            if key not in data: continue
            value = data[key]
            if "enum" in rule and value not in rule["enum"]: return "INVALID_INPUT"
            if rule.get("type") == "integer" and (not isinstance(value, int) or isinstance(value, bool) or value < rule.get("minimum", value) or value > rule.get("maximum", value)): return "INVALID_INPUT"
            if rule.get("type") == "string" and (not isinstance(value, str) or len(value) < rule.get("minLength", 0)) : return "INVALID_INPUT"
        return None
    def list_application_tools(self, identity):
        error = self._identity_error(identity)
        if error: return {"tools": [], "status": "DENIED", "reason_codes": [error]}
        return {"tools": self.registry.list_tools(), "status": "SUCCESS"}
    def get_tool_contract(self, identity, tool_name):
        error = self._identity_error(identity); tool = self.registry.get_tool(tool_name)
        if error: return {"status": "DENIED", "reason_codes": [error]}
        if not tool: return {"status": "DENIED", "reason_codes": ["UNKNOWN_TOOL"]}
        return {"status": "SUCCESS", "contract": tool.as_dict()}
    def get_evidence(self, identity, evidence_id): return self.evidence.get(evidence_id) if not self._identity_error(identity) else None
    def get_audit_event(self, identity, event_id): return self.audit.get(event_id) if not self._identity_error(identity) else None
    def run_read_tool(self, identity, tool_name, input_data):
        run_id = "run_" + uuid.uuid4().hex; started = time.monotonic(); tool = self.registry.get_tool(tool_name); identity_error = self._identity_error(identity)
        status, reasons, result = "SUCCESS", [], None
        if identity_error: status, reasons = "DENIED", [identity_error]
        elif not tool: status, reasons = "DENIED", ["UNKNOWN_TOOL"]
        elif not tool.read_only: status, reasons = "DENIED", ["WRITE_LIKE_TOOL"]
        elif tool.required_capability not in identity.get("capabilities", []): status, reasons = "DENIED", ["MISSING_OR_UNKNOWN_CAPABILITY"]
        elif self._input_error(tool, input_data) : status, reasons = "INVALID_INPUT", [self._input_error(tool, input_data)]
        else:
            try:
                if tool_name.endswith("list_locations"): result = self.adapter.list_locations()
                elif tool_name.endswith("get_location"): result = self.adapter.get_location(input_data.get("location_id")); status, reasons = ("SUCCESS", []) if result else ("NOT_FOUND", ["LOCATION_NOT_FOUND"])
                elif tool_name.endswith("get_allowed_reasons"): result = self.adapter.get_allowed_reasons(input_data.get("location_id")); status, reasons = ("SUCCESS", []) if result else ("NOT_FOUND", ["LOCATION_NOT_FOUND"])
                elif tool_name.endswith("list_shortage_requests"): result = self.adapter.list_shortage_requests(input_data)
                elif tool_name.endswith("get_shortage_request"): result = self.adapter.get_shortage_request(input_data.get("request_id")); status, reasons = ("SUCCESS", []) if result else ("NOT_FOUND", ["REQUEST_NOT_FOUND"])
                elif tool_name.endswith("validate_shortage_request"): result = self.adapter.validate_shortage_request(input_data)
                elif tool_name.endswith("preview_request_print"): result = self.adapter.preview_request_print(input_data.get("request_id")); status, reasons = ("SUCCESS", []) if result else ("NOT_FOUND", ["REQUEST_NOT_FOUND"])
                elif tool_name.endswith("preview_transfer_label"): result = self.adapter.preview_transfer_label(input_data.get("request_id")); status, reasons = ("SUCCESS", []) if result else ("NOT_FOUND", ["REQUEST_NOT_FOUND"])
                else: status, reasons = "DENIED", ["UNKNOWN_TOOL"]
            except Exception: status, reasons, result = "ERROR", ["ADAPTER_ERROR"], None
        input_fp = self._fingerprint({"tool_name": tool_name, "tool_version": tool.version if tool else "unknown", "input": input_data or {}, "source_mode": "DEMO"})
        output_fp = self._fingerprint({"result": result, "status": status, "reason_codes": reasons, "source_mode": "DEMO"})
        evidence_id = "evidence_" + uuid.uuid4().hex; audit_id = "event_" + uuid.uuid4().hex
        self.evidence.put({"evidence_id": evidence_id, "created_at": self.audit.timestamp(), "tool_name": tool_name, "tool_version": tool.version if tool else "unknown", "run_id": run_id, "input_fingerprint": input_fp, "output_fingerprint": output_fp, "source_adapter": type(self.adapter).__name__, "source_mode": "DEMO", "read_only": True, "result_summary": status})
        self.audit.append({"event_id": audit_id, "timestamp": self.audit.timestamp(), "run_id": run_id, "correlation_id": identity.get("correlation_id") if isinstance(identity, dict) else None, "actor_type": identity.get("actor_type") if isinstance(identity, dict) else None, "actor_id": identity.get("actor_id") if isinstance(identity, dict) else None, "agent_id": identity.get("agent_id") if isinstance(identity, dict) else None, "agent_run_id": identity.get("agent_run_id") if isinstance(identity, dict) else None, "tool_name": tool_name, "tool_version": tool.version if tool else "unknown", "risk_class": tool.risk_class if tool else None, "capability": tool.required_capability if tool else None, "input_fingerprint": input_fp, "status": status, "reason_codes": reasons, "evidence_id": evidence_id, "duration_ms": int((time.monotonic() - started) * 1000), "read_only": True})
        return {"run_id": run_id, "tool_name": tool_name, "tool_version": tool.version if tool else "unknown", "status": status, "read_only": True, "result": result, "reason_codes": reasons, "evidence_id": evidence_id, "audit_event_id": audit_id, "correlation_id": identity.get("correlation_id") if isinstance(identity, dict) else None}
