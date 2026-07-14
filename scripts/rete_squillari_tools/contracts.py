from dataclasses import dataclass
from typing import Any, Dict

RISK_CLASSES = {"R0_READ_ONLY", "R1_PREVIEW"}
FORBIDDEN_NAME_PARTS = ("run_anything", "execute", "call_method", "eval", "shell", "http_request", "file_write", "raw_query", "generic")

CAPABILITIES = {
    "rete_squillari.list_locations": "rete_squillari.locations.read",
    "rete_squillari.get_location": "rete_squillari.locations.read",
    "rete_squillari.get_allowed_reasons": "rete_squillari.locations.read",
    "rete_squillari.list_shortage_requests": "rete_squillari.shortages.read",
    "rete_squillari.get_shortage_request": "rete_squillari.shortages.read",
    "rete_squillari.validate_shortage_request": "rete_squillari.shortages.validate",
    "rete_squillari.preview_request_print": "rete_squillari.print.preview",
    "rete_squillari.preview_transfer_label": "rete_squillari.print.preview",
}

def _schema(properties: Dict[str, Any], required=()):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}

STRING = {"type": "string", "minLength": 1}
LOCATION = {"type": "string", "enum": ["malta", "sestri", "cantore", "trento", "de_ferrari", "armenia", "trasta"]}
REASON = {"type": "string", "enum": ["CUSTOMER_SALE", "ONLINE_SALE", "STOCK_GAP"]}

@dataclass(frozen=True)
class ToolDefinition:
    name: str
    version: str
    description: str
    risk_class: str
    read_only: bool
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]
    required_capability: str
    required_identity: tuple
    audit_event_type: str
    evidence_type: str
    idempotent: bool
    timeout_policy: str
    failure_modes: tuple

    def as_dict(self):
        return {"name": self.name, "version": self.version, "description": self.description, "risk_class": self.risk_class, "read_only": self.read_only, "input_schema": self.input_schema, "output_schema": self.output_schema, "required_capability": self.required_capability, "required_identity": list(self.required_identity), "audit_event_type": self.audit_event_type, "evidence_type": self.evidence_type, "idempotent": self.idempotent, "timeout_policy": self.timeout_policy, "failure_modes": list(self.failure_modes)}

def _tools():
    common = ("actor_type", "actor_id", "capabilities", "correlation_id")
    return [
        ToolDefinition("rete_squillari.list_locations", "1.0.0", "List demo locations.", "R0_READ_ONLY", True, _schema({}, ()), _schema({"locations": {"type": "array"}}, ("locations",)), CAPABILITIES["rete_squillari.list_locations"], common, "locations.listed", "locations.snapshot", True, "bounded", ("DENY", "ERROR")),
        ToolDefinition("rete_squillari.get_location", "1.0.0", "Get one demo location.", "R0_READ_ONLY", True, _schema({"location_id": LOCATION}, ("location_id",)), _schema({"location": {"type": "object"}}, ("location",)), CAPABILITIES["rete_squillari.get_location"], common, "location.read", "location.snapshot", True, "bounded", ("NOT_FOUND", "DENY", "ERROR")),
        ToolDefinition("rete_squillari.get_allowed_reasons", "1.0.0", "Get reasons allowed for a location.", "R0_READ_ONLY", True, _schema({"location_id": LOCATION}, ("location_id",)), _schema({"location_id": LOCATION, "reasons": {"type": "array"}}, ("location_id", "reasons")), CAPABILITIES["rete_squillari.get_allowed_reasons"], common, "location.reasons.read", "reasons.snapshot", True, "bounded", ("NOT_FOUND", "ERROR")),
        ToolDefinition("rete_squillari.list_shortage_requests", "1.0.0", "List deterministic demo shortage requests.", "R0_READ_ONLY", True, _schema({"location_id": LOCATION, "status": STRING, "reason": REASON, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "cursor": {"type": "string"}}, ()), _schema({"requests": {"type": "array"}, "next_cursor": {"type": ["string", "null"]}}, ("requests", "next_cursor")), CAPABILITIES["rete_squillari.list_shortage_requests"], common, "shortages.listed", "shortages.snapshot", True, "bounded", ("INVALID_INPUT", "ERROR")),
        ToolDefinition("rete_squillari.get_shortage_request", "1.0.0", "Get one demo shortage request.", "R0_READ_ONLY", True, _schema({"request_id": STRING}, ("request_id",)), _schema({"request": {"type": "object"}}, ("request",)), CAPABILITIES["rete_squillari.get_shortage_request"], common, "shortage.read", "shortage.snapshot", True, "bounded", ("NOT_FOUND", "ERROR")),
        ToolDefinition("rete_squillari.validate_shortage_request", "1.0.0", "Validate a shortage payload without persisting it.", "R0_READ_ONLY", True, _schema({"requester_location_id": LOCATION, "product_code": STRING, "product_description": STRING, "quantity": {"type": "integer", "minimum": 1}, "reason": REASON, "comment": {"type": "string"}, "priority": {"type": "string", "enum": ["NORMAL", "HIGH"]}}, ("requester_location_id", "product_code", "product_description", "quantity", "reason")), _schema({"valid": {"type": "boolean"}, "reason_codes": {"type": "array"}, "normalized_payload": {"type": "object"}}, ("valid", "reason_codes", "normalized_payload")), CAPABILITIES["rete_squillari.validate_shortage_request"], common, "shortage.validated", "validation.result", True, "bounded", ("INVALID_INPUT", "ERROR")),
        ToolDefinition("rete_squillari.preview_request_print", "1.0.0", "Build a non-mutating request print view model.", "R1_PREVIEW", True, _schema({"request_id": STRING}, ("request_id",)), _schema({"print_view_model": {"type": "object"}}, ("print_view_model",)), CAPABILITIES["rete_squillari.preview_request_print"], common, "shortage.print.previewed", "print.preview", True, "bounded", ("NOT_FOUND", "ERROR")),
        ToolDefinition("rete_squillari.preview_transfer_label", "1.0.0", "Build a non-mutating transfer-label preview.", "R1_PREVIEW", True, _schema({"request_id": STRING}, ("request_id",)), _schema({"eligible": {"type": "boolean"}, "reason_codes": {"type": "array"}, "label_view_model": {"type": ["object", "null"]}}, ("eligible", "reason_codes", "label_view_model")), CAPABILITIES["rete_squillari.preview_transfer_label"], common, "transfer.label.previewed", "label.preview", True, "bounded", ("NOT_FOUND", "ERROR")),
    ]

TOOL_DEFINITIONS = tuple(_tools())

def validate_tool_contract(tool: ToolDefinition):
    errors = []
    if not tool.name or any(part in tool.name.lower() for part in FORBIDDEN_NAME_PARTS): errors.append("GENERIC_TOOL_NAME")
    if not tool.version: errors.append("MISSING_VERSION")
    if tool.risk_class not in RISK_CLASSES: errors.append("UNKNOWN_RISK_CLASS")
    if tool.read_only is not True: errors.append("NOT_READ_ONLY")
    if not tool.input_schema or not tool.output_schema: errors.append("MISSING_SCHEMA")
    if not tool.required_capability: errors.append("MISSING_CAPABILITY")
    if tool.name not in CAPABILITIES or tool.required_capability != CAPABILITIES[tool.name]: errors.append("CAPABILITY_MISMATCH")
    return errors
