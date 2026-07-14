import json, time
from .auth import LocalProfile, StaticDigestCredentialVerifier
from .audit import MCPAudit
from .config import MCPConfig
from .protocol import error_response, validate_request
from .rate_limit import RateLimiter
from .session import SessionStore
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parents[1]))
from rete_squillari_tools.gateway import WBOSReadOnlyApplicationGateway

class MCPServer:
    def __init__(self, config, gateway=None):
        error = config.validate()
        if error: raise ValueError(error)
        self.config, self.gateway = config, gateway or WBOSReadOnlyApplicationGateway(); self.verifier = StaticDigestCredentialVerifier(config.token_digest, config.token_id); self.profile = LocalProfile(); self.sessions = SessionStore(config.session_ttl_seconds); self.rate = RateLimiter(config.max_requests_per_minute); self.audit = MCPAudit()
    def authenticate(self, token): return self.verifier.verify(token)
    def _tools(self):
        return [{"name": t["name"], "description": t["description"], "inputSchema": t["input_schema"], "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}} for t in self.gateway.registry.list_tools()]
    def handle(self, request, token=None, session_id=None, request_id_header=None):
        failure = validate_request(request, self.config.max_payload_bytes)
        if failure: return error_response(request.get("id") if isinstance(request, dict) else None, -32600, "INVALID_REQUEST", {"reason_code": failure})
        rid = request["id"]
        credential = self.authenticate(token)
        if not credential: self.audit.append(transport=self.config.transport, authentication_status="DENIED", method=request["method"], request_id=request_id_header); return error_response(rid, -32001, "AUTHENTICATION_FAILED")
        sid = session_id or self.sessions.create(credential)
        if not self.sessions.validate(sid, credential): return error_response(rid, -32001, "AUTHENTICATION_FAILED")
        nonce = str(rid) if request_id_header is None else request_id_header
        if not self.sessions.accept_nonce(sid, nonce): return error_response(rid, -32002, "REPLAY_OR_MISSING_REQUEST_ID")
        if not self.rate.allow(credential + ":" + sid): return error_response(rid, -32003, "RATE_LIMITED")
        method = request["method"]
        if method == "notifications/initialized" and "id" not in request:
            self.audit.append(transport=self.config.transport, session_id=sid, credential_id=credential, request_id=nonce, method=method, authentication_status="SUCCESS", authorization_status="SUCCESS", gateway_status="SUCCESS", read_only=True, payload_size=len(json.dumps(request).encode()))
            return None
        if method == "initialize": result = {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}}, "serverInfo": {"name": "rete-squillari-local-mcp", "version": "0.1.0"}}
        elif method == "tools/list": result = {"tools": self._tools()}
        elif method == "tools/call": result = self._call(request.get("params") or {}, credential, sid)
        else: return error_response(rid, -32601, "METHOD_NOT_FOUND")
        self.audit.append(transport=self.config.transport, session_id=sid, credential_id=credential, request_id=nonce, method=method, authentication_status="SUCCESS", authorization_status="SUCCESS", gateway_status="SUCCESS", read_only=True, payload_size=len(json.dumps(request).encode()))
        return {"jsonrpc": "2.0", "id": rid, "result": result}
    def _call(self, params, credential, sid):
        name, args = params.get("name"), params.get("arguments", {})
        if name not in [x["name"] for x in self.gateway.registry.list_tools()]: return {"content": [{"type": "text", "text": "UNKNOWN_TOOL"}], "isError": True, "structuredContent": {"status": "DENIED", "reason_codes": ["UNKNOWN_TOOL"]}}
        principal = self.profile.principal(credential, sid, args.pop("_metadata", {}) if isinstance(args, dict) else {})
        identity = principal.__dict__.copy(); identity["authorized_location_ids"] = list(identity["authorized_location_ids"]); identity["capabilities"] = list(identity["capabilities"])
        response = self.gateway.run_read_tool(identity, name, args)
        if response["status"] == "SUCCESS": return {"content": [{"type": "text", "text": json.dumps(response, ensure_ascii=False)}, {"type": "json", "json": response}], "structuredContent": response, "isError": False}
        return {"content": [{"type": "text", "text": json.dumps({"status": response["status"], "reason_codes": response["reason_codes"]})}], "structuredContent": response, "isError": True}
