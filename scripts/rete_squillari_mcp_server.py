#!/usr/bin/env python3
import argparse, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from rete_squillari_mcp.config import MCPConfig
from rete_squillari_mcp.server import MCPServer
from rete_squillari_mcp.protocol import decode_json, error_response

def run_stdio(server):
    for line in sys.stdin:
        raw = line.encode()
        request, decode_failure = decode_json(raw, server.config.max_payload_bytes)
        if decode_failure:
            code = -32700 if decode_failure == "PARSE_ERROR" else -32600
            print(json.dumps(error_response(None, code, "PARSE_ERROR" if code == -32700 else "INVALID_REQUEST"), separators=(",", ":")), flush=True); continue
        try:
            response = server.handle(request, os.environ.get("RETE_SQUILLARI_MCP_TEST_TOKEN"))
            if response is not None: print(json.dumps(response, separators=(",", ":")), flush=True)
        except Exception: print(json.dumps(error_response(None, -32603, "INTERNAL_ERROR"), separators=(",", ":")), flush=True)

def run_http(server):
    class Handler(BaseHTTPRequestHandler):
        def _headers(self):
            self.send_header("Cache-Control", "no-store"); self.send_header("X-Content-Type-Options", "nosniff"); self.send_header("Referrer-Policy", "no-referrer")
        def _deny(self, status, message, allow=None):
            length = int(self.headers.get("Content-Length", "-1"))
            if length > 0:
                try: self.rfile.read(length)
                except Exception: pass
            body = json.dumps({"error": message}).encode(); self.send_response(status); self._headers(); self.send_header("Content-Type", "application/json");
            if allow: self.send_header("Allow", allow)
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_GET(self):
            if self.path == "/healthz":
                body = b'{"status":"ok"}'
                self.send_response(200); self._headers(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            elif self.path == "/readyz":
                if getattr(server, "_is_shutting_down", False):
                    body = b'{"status":"shutting_down"}'
                    self.send_response(503)
                else:
                    body = b'{"status":"ready"}'
                    self.send_response(200)
                self._headers(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            else:
                self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_DELETE(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_PUT(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_PATCH(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_TRACE(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_OPTIONS(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_POST(self):
            if self.path in ("/healthz", "/readyz"): self._deny(405, "METHOD_NOT_ALLOWED", "GET"); return
            if self.path != "/mcp": self._deny(404, "NOT_FOUND"); return
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json": self._deny(415, "UNSUPPORTED_MEDIA_TYPE"); return
            accept = self.headers.get("Accept", "")
            if not ("application/json" in accept and "text/event-stream" in accept): self._deny(406, "NOT_ACCEPTABLE"); return
            origin = self.headers.get("Origin")
            if origin is None or not self._valid_origin(origin): self._deny(403, "ORIGIN_DENIED"); return
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 0 or length > server.config.max_payload_bytes: self._deny(413, "PAYLOAD_TOO_LARGE"); return
            try:
                request, decode_failure = decode_json(self.rfile.read(length), server.config.max_payload_bytes)
                if decode_failure:
                    code = -32700 if decode_failure == "PARSE_ERROR" else -32600
                    response = error_response(None, code, "PARSE_ERROR" if code == -32700 else "INVALID_REQUEST")
                else:
                    server._request_protocol_version = self.headers.get("MCP-Protocol-Version")
                    response = server.handle(request, self.headers.get("Authorization", "").removeprefix("Bearer ").strip(), session_id=self.headers.get("Mcp-Session-Id"), request_id_header=self.headers.get("X-Request-Id"))
            except Exception: response = {"jsonrpc":"2.0","id":None,"error":{"code":-32600,"message":"INVALID_REQUEST"}}
            if response is None:
                self.send_response(202); self._headers(); self.send_header("Content-Length", "0"); self.end_headers(); return
            body = json.dumps(response).encode(); self.send_response(self._response_status(response)); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self._headers()
            for key, value in server.last_response_headers.items(): self.send_header(key, value)
            self.end_headers(); self.wfile.write(body)
        def _response_status(self, response):
            reason = ((response.get("error") or {}).get("data") or {}).get("reason_code")
            if reason == "UNKNOWN_OR_EXPIRED_SESSION": return 404
            if reason in ("MISSING_SESSION", "PROTOCOL_VERSION_HEADER", "REPLAY_OR_MISSING_REQUEST_ID", "SESSION_FIXATION"): return 400
            if getattr(server, "_is_shutting_down", False) and reason == "SERVER_IS_SHUTTING_DOWN": return 503
            return 200
        def _valid_origin(self, origin):
            try:
                parsed = urlparse(origin)
                return parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1") and parsed.port in (None, server.config.bind_port) and not parsed.username and not parsed.password and not parsed.path and not parsed.query and not parsed.fragment
            except Exception: return False
        def log_message(self, *args): pass
    server_http = ThreadingHTTPServer((server.config.bind_host, server.config.bind_port), Handler)
    server._http_server = server_http
    
    import signal, threading
    if threading.current_thread() == threading.main_thread():
        def shutdown_handler(signum, frame):
            if getattr(server, "_is_shutting_down", False): return
            server.shutdown()
            threading.Thread(target=server_http.shutdown, daemon=True).start()
        signal.signal(signal.SIGTERM, shutdown_handler)
        signal.signal(signal.SIGINT, shutdown_handler)

    try: server_http.serve_forever()
    finally: server_http.server_close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--transport", choices=("stdio", "http"), default="stdio"); args = parser.parse_args(); config = MCPConfig.from_env("STREAMABLE_HTTP" if args.transport == "http" else "STDIO"); instance = MCPServer(config); run_http(instance) if args.transport == "http" else run_stdio(instance)
