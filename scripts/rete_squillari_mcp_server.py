#!/usr/bin/env python3
import argparse, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from rete_squillari_mcp.config import MCPConfig
from rete_squillari_mcp.server import MCPServer

def run_stdio(server):
    for line in sys.stdin:
        try: print(json.dumps(server.handle(json.loads(line), os.environ.get("RETE_SQUILLARI_MCP_TEST_TOKEN"))), flush=True)
        except Exception: print(json.dumps({"jsonrpc":"2.0","id":None,"error":{"code":-32600,"message":"INVALID_REQUEST"}}), flush=True)

def run_http(server):
    class Handler(BaseHTTPRequestHandler):
        def _headers(self):
            self.send_header("Cache-Control", "no-store"); self.send_header("X-Content-Type-Options", "nosniff"); self.send_header("Referrer-Policy", "no-referrer")
        def _deny(self, status, message, allow=None):
            body = json.dumps({"error": message}).encode(); self.send_response(status); self._headers(); self.send_header("Content-Type", "application/json");
            if allow: self.send_header("Allow", allow)
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_GET(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_DELETE(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_PUT(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_PATCH(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_TRACE(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_OPTIONS(self): self._deny(405, "METHOD_NOT_ALLOWED", "POST")
        def do_POST(self):
            if self.path != "/mcp": self._deny(404, "NOT_FOUND"); return
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json": self._deny(415, "UNSUPPORTED_MEDIA_TYPE"); return
            accept = self.headers.get("Accept", "")
            if not ("application/json" in accept and "text/event-stream" in accept): self._deny(406, "NOT_ACCEPTABLE"); return
            origin = self.headers.get("Origin")
            if origin and not self._valid_origin(origin): self._deny(403, "ORIGIN_DENIED"); return
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 0 or length > server.config.max_payload_bytes: self._deny(413, "PAYLOAD_TOO_LARGE"); return
            try: request = json.loads(self.rfile.read(length)); response = server.handle(request, self.headers.get("Authorization", "").removeprefix("Bearer ").strip(), request_id_header=self.headers.get("X-Request-Id"))
            except Exception: response = {"jsonrpc":"2.0","id":None,"error":{"code":-32600,"message":"INVALID_REQUEST"}}
            if response is None:
                self.send_response(202); self._headers(); self.send_header("Content-Length", "0"); self.end_headers(); return
            body = json.dumps(response).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.send_header("Cache-Control", "no-store"); self.send_header("X-Content-Type-Options", "nosniff"); self.send_header("Referrer-Policy", "no-referrer"); self.end_headers(); self.wfile.write(body)
        def _valid_origin(self, origin):
            try:
                parsed = urlparse(origin)
                return parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1") and not parsed.username and not parsed.password
            except Exception: return False
        def log_message(self, *args): pass
    server_http = ThreadingHTTPServer((server.config.bind_host, server.config.bind_port), Handler)
    try: server_http.serve_forever()
    finally: server_http.server_close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--transport", choices=("stdio", "http"), default="stdio"); args = parser.parse_args(); config = MCPConfig.from_env("STREAMABLE_HTTP" if args.transport == "http" else "STDIO"); instance = MCPServer(config); run_http(instance) if args.transport == "http" else run_stdio(instance)
