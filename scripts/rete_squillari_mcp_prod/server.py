"""MCP protocol server (JSON-RPC 2.0 over HTTP) for the production Rete
Squillari read-only MCP. Structurally independent from
scripts/rete_squillari_mcp/server.py (the demo) - no shared imports, no
STATIC_TEST_TOKEN, no DEMO source path.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import threading
import time
import uuid

from . import db
from .auth import AuthError, TokenVerifier
from .config import MCPConfig
from .tools import TOOL_REGISTRY, ToolError

logger = logging.getLogger("rete_mcp_prod")

PROTOCOL_VERSION = "2025-06-18"

TOOL_SCHEMAS = [
    {"name": "rete_get_health", "description": "Health check for the pilot backend.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "rete_get_pilot_status", "description": "Aggregate pilot status counters.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "rete_list_locations", "description": "List all six pilot store locations and their active flag.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "rete_list_pending_confirmations", "description": "List requests awaiting requesting-store confirmation.", "inputSchema": {"type": "object", "properties": {"location_id": {"type": "integer"}, "limit": {"type": "integer"}, "offset": {"type": "integer"}}}},
    {"name": "rete_list_open_requests", "description": "List open (post-confirmation, not closed/cancelled) requests.", "inputSchema": {"type": "object", "properties": {"location_id": {"type": "integer"}, "limit": {"type": "integer"}, "offset": {"type": "integer"}}}},
    {"name": "rete_get_request", "description": "Get one request by ID.", "inputSchema": {"type": "object", "properties": {"request_id": {"type": "string"}}, "required": ["request_id"]}},
    {"name": "rete_list_offers", "description": "List offers, optionally filtered by request or offering location.", "inputSchema": {"type": "object", "properties": {"request_id": {"type": "string"}, "location_id": {"type": "integer"}, "limit": {"type": "integer"}, "offset": {"type": "integer"}}}},
    {"name": "rete_list_transfers", "description": "List transfers, optionally filtered by request or status.", "inputSchema": {"type": "object", "properties": {"request_id": {"type": "string"}, "status": {"type": "string"}, "limit": {"type": "integer"}, "offset": {"type": "integer"}}}},
    {"name": "rete_list_receipt_discrepancies", "description": "List transfers with a recorded receipt discrepancy.", "inputSchema": {"type": "object", "properties": {"resolved": {"type": "boolean"}, "limit": {"type": "integer"}, "offset": {"type": "integer"}}}},
    {"name": "rete_get_request_audit", "description": "Get the chronological audit trail for one request (requires audit scope).", "inputSchema": {"type": "object", "properties": {"request_id": {"type": "string"}, "limit": {"type": "integer"}, "offset": {"type": "integer"}}, "required": ["request_id"]}},
]

_JSONRPC_PARSE_ERROR = -32700
_JSONRPC_INVALID_REQUEST = -32600
_JSONRPC_METHOD_NOT_FOUND = -32601
_JSONRPC_INVALID_PARAMS = -32602
_JSONRPC_INTERNAL_ERROR = -32603


def _error(id_, code, reason_code):
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": reason_code, "data": {"reason_code": reason_code}}}


class RateLimiter:
    def __init__(self, max_per_minute: int):
        self._max = max_per_minute
        self._lock = threading.Lock()
        self._buckets: dict = {}

    def allow(self, client_key: str) -> bool:
        now = time.time()
        window = int(now // 60)
        with self._lock:
            bucket_key = (client_key, window)
            for k in list(self._buckets.keys()):
                if k[1] < window:
                    del self._buckets[k]
            count = self._buckets.get(bucket_key, 0)
            if count >= self._max:
                return False
            self._buckets[bucket_key] = count + 1
            return True


class MCPServer:
    def __init__(self, cfg: MCPConfig):
        self.cfg = cfg
        self.database = db.ReadOnlyDB(
            cfg.database_url, cfg.db_pool_min_size, cfg.db_pool_max_size,
            cfg.db_statement_timeout_ms, cfg.db_connect_timeout_s,
        )
        self.verifier = TokenVerifier(cfg.jwt_secret, cfg.jwt_issuer, cfg.jwt_audience, cfg.revoked_jti_path)
        self.rate_limiter = RateLimiter(cfg.max_requests_per_minute_per_client)
        self._shutting_down = False

    def shutdown(self):
        self._shutting_down = True
        self.database.close()

    def handle(self, request: dict, authorization_header: str) -> dict:
        req_id = request.get("id") if isinstance(request, dict) else None
        request_id_log = str(uuid.uuid4())
        start = time.monotonic()

        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or "method" not in request:
            return _error(req_id, _JSONRPC_INVALID_REQUEST, "INVALID_REQUEST")

        method = request.get("method")
        params = request.get("params") or {}

        if method == "initialize":
            return {"jsonrpc": "2.0", "id": req_id, "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "serverInfo": {"name": "rete-squillari-mcp-prod", "version": "1.0.0"},
                "capabilities": {"tools": {}},
            }}

        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOL_SCHEMAS}}

        if method != "tools/call":
            return _error(req_id, _JSONRPC_METHOD_NOT_FOUND, "UNKNOWN_METHOD")

        try:
            identity = self.verifier.verify(authorization_header)
        except AuthError as e:
            logger.info("auth_denied request_id=%s reason=%s", request_id_log, e.reason_code)
            return _error(req_id, _JSONRPC_INVALID_PARAMS, "AUTHORIZATION_DENIED")

        if not self.rate_limiter.allow(identity.sub):
            return _error(req_id, _JSONRPC_INTERNAL_ERROR, "RATE_LIMITED")

        tool_name = params.get("name")
        tool_args = params.get("arguments") or {}
        if not isinstance(tool_args, dict):
            return _error(req_id, _JSONRPC_INVALID_PARAMS, "MALFORMED_ARGUMENTS")

        entry = TOOL_REGISTRY.get(tool_name)
        if entry is None:
            return _error(req_id, _JSONRPC_INVALID_PARAMS, "UNKNOWN_TOOL")
        fn, needs_cfg = entry

        try:
            if needs_cfg:
                result = fn(self.database, identity, tool_args, self.cfg)
            else:
                result = fn(self.database, identity, tool_args)
        except AuthError as e:
            logger.info("tool_denied request_id=%s tool=%s sub=%s reason=%s", request_id_log, tool_name, identity.sub, e.reason_code)
            return _error(req_id, _JSONRPC_INVALID_PARAMS, "AUTHORIZATION_DENIED")
        except (db.QueryError, ToolError) as e:
            code = e.reason_code if isinstance(e, db.QueryError) else e.code
            logger.info("tool_error request_id=%s tool=%s sub=%s reason=%s", request_id_log, tool_name, identity.sub, code)
            return _error(req_id, _JSONRPC_INVALID_PARAMS, code)
        except Exception:
            logger.exception("tool_internal_error request_id=%s tool=%s sub=%s", request_id_log, tool_name, identity.sub)
            return _error(req_id, _JSONRPC_INTERNAL_ERROR, "INTERNAL_ERROR")

        duration_ms = int((time.monotonic() - start) * 1000)
        result_count = None
        for key in result:
            if isinstance(result[key], list):
                result_count = len(result[key])
                break
        logger.info(
            "tool_ok request_id=%s tool=%s sub=%s duration_ms=%d result_count=%s",
            request_id_log, tool_name, identity.sub, duration_ms, result_count,
        )
        return {"jsonrpc": "2.0", "id": req_id, "result": {
            "content": [{"type": "text", "text": json.dumps(result)}],
            "structuredContent": result,
            "isError": False,
        }}


def run_http(server: MCPServer):
    cfg = server.cfg

    class Handler(BaseHTTPRequestHandler):
        def _headers(self):
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")

        def _send_json(self, status, body: dict):
            payload = json.dumps(body).encode()
            self.send_response(status)
            self._headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == "/healthz":
                # Pure liveness - the process is up and answering HTTP.
                # Deliberately does not touch the database: a liveness
                # probe should never fail because a downstream dependency
                # is unavailable, only because this process itself is
                # wedged - that distinction is what /readyz is for.
                self._send_json(200, {"status": "ok"})
            elif self.path == "/readyz":
                if server._shutting_down:
                    self._send_json(503, {"status": "shutting_down"})
                    return
                # Readiness must reflect whether this instance can
                # actually serve a tool call, not just that the process
                # hasn't been asked to shut down - a database outage
                # (network partition, credential expiry, Supabase-side
                # issue) must flip this to unready so an orchestrator or
                # load balancer stops routing traffic here. Bounded by the
                # same statement_timeout as every other query; any
                # exception is caught and reported generically - never the
                # exception text itself, which could include the DSN.
                try:
                    reachable = server.database.health_check()
                except Exception:
                    reachable = False
                if reachable:
                    self._send_json(200, {"status": "ready"})
                else:
                    self._send_json(503, {"status": "database_unreachable"})
            else:
                self._send_json(404, {"error": "NOT_FOUND"})

        def do_POST(self):
            if self.path != "/mcp":
                self._send_json(404, {"error": "NOT_FOUND"})
                return
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 0 or length > cfg.max_payload_bytes:
                self._send_json(413, {"error": "PAYLOAD_TOO_LARGE"})
                return
            raw = self.rfile.read(length)
            try:
                request = json.loads(raw)
            except json.JSONDecodeError:
                self._send_json(200, _error(None, _JSONRPC_PARSE_ERROR, "PARSE_ERROR"))
                return
            auth_header = self.headers.get("Authorization", "")
            response = server.handle(request, auth_header)
            self._send_json(200, response)

        def log_message(self, *args):
            pass  # structured logging handled in MCPServer.handle

    http_server = ThreadingHTTPServer((cfg.bind_host, cfg.bind_port), Handler)
    return http_server
