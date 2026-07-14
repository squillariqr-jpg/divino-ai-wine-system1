#!/usr/bin/env python3
import argparse, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from rete_squillari_mcp.config import MCPConfig
from rete_squillari_mcp.server import MCPServer

def run_stdio(server):
    for line in sys.stdin:
        try: print(json.dumps(server.handle(json.loads(line), os.environ.get("RETE_SQUILLARI_MCP_TEST_TOKEN"))), flush=True)
        except Exception: print(json.dumps({"jsonrpc":"2.0","id":None,"error":{"code":-32600,"message":"INVALID_REQUEST"}}), flush=True)

def run_http(server):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/mcp" or self.headers.get("Content-Type", "").split(";")[0] != "application/json": self.send_error(404); return
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 0 or length > server.config.max_payload_bytes: self.send_error(413); return
            try: request = json.loads(self.rfile.read(length)); response = server.handle(request, self.headers.get("Authorization", "").removeprefix("Bearer ").strip(), request_id_header=self.headers.get("X-Request-Id"))
            except Exception: response = {"jsonrpc":"2.0","id":None,"error":{"code":-32600,"message":"INVALID_REQUEST"}}
            body = json.dumps(response).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.send_header("Cache-Control", "no-store"); self.send_header("X-Content-Type-Options", "nosniff"); self.send_header("Referrer-Policy", "no-referrer"); self.end_headers(); self.wfile.write(body)
        def log_message(self, *args): pass
    server_http = ThreadingHTTPServer((server.config.bind_host, server.config.bind_port), Handler)
    try: server_http.serve_forever()
    finally: server_http.server_close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--transport", choices=("stdio", "http"), default="stdio"); args = parser.parse_args(); config = MCPConfig.from_env("STREAMABLE_HTTP" if args.transport == "http" else "STDIO"); instance = MCPServer(config); run_http(instance) if args.transport == "http" else run_stdio(instance)
