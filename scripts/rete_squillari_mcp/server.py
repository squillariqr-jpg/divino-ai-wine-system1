import json, sys, time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from .auth import LocalProfile, StaticDigestCredentialVerifier
from .audit import MCPAudit
from .config import MCPConfig
from .protocol import error_response, validate_request, validate_notification, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR
from .rate_limit import RateLimiter
from .session import LifecycleState, SessionStore
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parents[1]))
from rete_squillari_tools.gateway import WBOSReadOnlyApplicationGateway

class MCPServer:
    def __init__(self, config, gateway=None):
        error = config.validate()
        if error: raise ValueError(error)
        self.config, self.gateway = config, gateway or WBOSReadOnlyApplicationGateway()
        self.verifier = StaticDigestCredentialVerifier(config.token_digest, config.token_id)
        self.profile = LocalProfile(); self.sessions = SessionStore(config.session_ttl_seconds)
        self.rate = RateLimiter(config.max_requests_per_minute); self.audit = MCPAudit(); self.stdio_state = {"lifecycle_state": LifecycleState.NEW, "protocol_version": None, "nonces": set()}; self.last_response_headers = {}
    def authenticate(self, token): return self.verifier.verify(token)
    def _tools(self):
        return [{"name": t["name"], "description": t["description"], "inputSchema": t["input_schema"], "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}} for t in self.gateway.registry.list_tools()]
    def _fail(self, rid, code, message, reason=None): return error_response(rid, code, message, {"reason_code": reason} if reason else None)
    def _version(self, request):
        params = request.get("params")
        if not isinstance(params, dict) or not isinstance(params.get("protocolVersion"), str) or not isinstance(params.get("capabilities"), dict) or not isinstance(params.get("clientInfo"), dict) or not isinstance(params["clientInfo"].get("name"), str) or not isinstance(params["clientInfo"].get("version"), str): return None, "MISSING_OR_MALFORMED_INITIALIZE_PARAMS"
        requested = params["protocolVersion"]
        if requested not in self.config.supported_protocol_versions: return None, "UNSUPPORTED_PROTOCOL_VERSION"
        return requested, None
    def _lifecycle_error(self, rid, reason): return self._fail(rid, INVALID_PARAMS, "INVALID_PARAMS", reason)
    def handle(self, request, token=None, session_id=None, request_id_header=None):
        self.last_response_headers = {}
        is_notification = isinstance(request, dict) and "id" not in request
        failure = validate_notification(request, self.config.max_payload_bytes) if is_notification else validate_request(request, self.config.max_payload_bytes)
        if failure: return self._fail(request.get("id") if isinstance(request, dict) else None, -32600, "INVALID_REQUEST", failure)
        rid, method = request.get("id"), request["method"]
        credential = self.authenticate(token)
        if not credential:
            self.audit.append(transport=self.config.transport, authentication_status="DENIED", method=method, request_id=request_id_header); return self._fail(rid, -32001, "AUTHENTICATION_FAILED")
        state = self.stdio_state if self.config.transport == "STDIO" else None
        session = None
        if self.config.transport == "STREAMABLE_HTTP":
            if method == "initialize":
                if session_id: return self._lifecycle_error(rid, "SESSION_FIXATION")
                requested, reason = self._version(request)
                if reason: return self._lifecycle_error(rid, reason)
                state = {"lifecycle_state": LifecycleState.NEW, "protocol_version": requested, "nonces": set()}
            else:
                if not session_id: return self._fail(rid, -32004, "SESSION_REQUIRED", "MISSING_SESSION")
                session = self.sessions.validate(session_id, credential)
                if not session: return self._fail(rid, -32004, "SESSION_NOT_FOUND", "UNKNOWN_OR_EXPIRED_SESSION")
                state = session
            if method != "initialize":
                header_version = getattr(self, "_request_protocol_version", None)
                if header_version != state["negotiated_protocol_version"]: return self._fail(rid, INVALID_PARAMS, "INVALID_PARAMS", "PROTOCOL_VERSION_HEADER")
            if not isinstance(request_id_header, str) or not self._accept_nonce(state, request_id_header): return self._fail(rid, -32002, "REPLAY_OR_MISSING_REQUEST_ID", "REPLAY_OR_MISSING_REQUEST_ID")
        else:
            nonce = request_id_header if request_id_header is not None else (str(rid) if rid is not None else None)
            if nonce and (len(nonce) > 128 or not isinstance(nonce, str) or not nonce.isascii()): return self._fail(rid, -32002, "REPLAY_OR_MISSING_REQUEST_ID")
            if nonce and nonce in state["nonces"]: return self._fail(rid, -32002, "REPLAY_OR_MISSING_REQUEST_ID")
            if nonce: state["nonces"].add(nonce)
        if not self.rate.allow(credential + ":" + (session_id or "stdio")): return self._fail(rid, -32003, "RATE_LIMITED")
        if method == "initialize":
            if state["lifecycle_state"] != LifecycleState.NEW: return self._lifecycle_error(rid, "DUPLICATE_INITIALIZE")
            version, reason = self._version(request)
            if reason: return self._lifecycle_error(rid, reason)
            state["negotiated_protocol_version"] = version; state["lifecycle_state"] = LifecycleState.INITIALIZED
            if self.config.transport == "STREAMABLE_HTTP":
                sid = self.sessions.create(credential, version); session = self.sessions.sessions[sid]; session["lifecycle_state"] = LifecycleState.INITIALIZED; state = session; self.last_response_headers["Mcp-Session-Id"] = sid
            result = {"protocolVersion": version, "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "rete-squillari-readonly-mcp", "version": "1.0.0"}}
        elif method == "notifications/initialized":
            if state["lifecycle_state"] != LifecycleState.INITIALIZED: self._audit(method, credential, session_id, request_id_header); return None
            state["lifecycle_state"] = LifecycleState.READY; self._audit(method, credential, session_id, request_id_header); return None
        elif method in ("tools/list", "tools/call"):
            if state["lifecycle_state"] != LifecycleState.READY: return self._lifecycle_error(rid, "REQUEST_BEFORE_READY")
            if method == "tools/list": result = {"tools": self._tools()}
            else:
                try: result = self._call(request.get("params") or {}, credential, session_id or "stdio")
                except ValueError: return self._fail(rid, INVALID_PARAMS, "INVALID_PARAMS", "INVALID_PARAMS")
                except Exception: return self._fail(rid, INTERNAL_ERROR, "INTERNAL_ERROR", "INTERNAL_ERROR")
        else: return self._fail(rid, METHOD_NOT_FOUND, "METHOD_NOT_FOUND")
        if session: self.sessions.touch(session)
        self._audit(method, credential, session_id, request_id_header); return {"jsonrpc": "2.0", "id": rid, "result": result}
    def _accept_nonce(self, state, nonce):
        if not isinstance(nonce, str) or not nonce or len(nonce) > 128 or not nonce.isascii() or nonce in state["nonces"]: return False
        state["nonces"].add(nonce); return True
    def _audit(self, method, credential, sid, nonce): self.audit.append(transport=self.config.transport, session_id=("hash:" + str(abs(hash(sid)))[:12] if sid else None), credential_id=credential, request_id=nonce, method=method, authentication_status="SUCCESS", authorization_status="SUCCESS", gateway_status="SUCCESS", read_only=True)
    def _call(self, params, credential, sid):
        if not isinstance(params, dict) or not isinstance(params.get("name"), str) or not isinstance(params.get("arguments", {}), dict): raise ValueError("INVALID_PARAMS")
        name, args = params["name"], dict(params.get("arguments", {})); args.pop("_metadata", None)
        if name not in [x["name"] for x in self.gateway.registry.list_tools()]: return {"content": [{"type": "text", "text": "UNKNOWN_TOOL"}], "isError": True, "structuredContent": {"status": "DENIED", "reason_codes": ["UNKNOWN_TOOL"]}}
        principal = self.profile.principal(credential, sid, {}); identity = principal.__dict__.copy(); identity["authorized_location_ids"] = list(identity["authorized_location_ids"]); identity["capabilities"] = list(identity["capabilities"])
        executor = ThreadPoolExecutor(max_workers=1); future = executor.submit(self.gateway.run_read_tool, identity, name, args)
        try: response = future.result(timeout=self.config.request_timeout_ms / 1000)
        except TimeoutError:
            future.cancel(); executor.shutdown(wait=False, cancel_futures=True); self.audit.append(transport=self.config.transport, method="tools/call", authentication_status="SUCCESS", authorization_status="DENIED", gateway_status="TIMEOUT", read_only=True, reason_code="REQUEST_TIMEOUT"); return {"content": [{"type": "text", "text": "REQUEST_TIMEOUT"}], "isError": True, "structuredContent": {"status": "TIMEOUT", "reason_codes": ["REQUEST_TIMEOUT"]}}
        finally:
            if not future.done(): executor.shutdown(wait=False, cancel_futures=True)
            else: executor.shutdown(wait=True)
        if response["status"] == "SUCCESS": return {"content": [{"type": "text", "text": json.dumps(response, ensure_ascii=False)}, {"type": "json", "json": response}], "structuredContent": response, "isError": False}
        return {"content": [{"type": "text", "text": json.dumps({"status": response["status"], "reason_codes": response["reason_codes"]})}], "structuredContent": response, "isError": True}
