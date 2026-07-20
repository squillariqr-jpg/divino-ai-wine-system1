#!/usr/bin/env python3
"""Entry point for the production Rete Squillari read-only MCP server.
Separate from scripts/rete_squillari_mcp_server.py (the demo entry point) -
no shared code, no shared process.

Usage:
  RETE_MCP_DATABASE_URL=... RETE_MCP_JWT_SECRET=... python3 rete_squillari_mcp_prod_server.py
"""
import logging
import signal
import sys
import threading

from rete_squillari_mcp_prod.config import ConfigError, MCPConfig
from rete_squillari_mcp_prod.server import MCPServer, run_http


def main() -> int:
    try:
        cfg = MCPConfig.from_env()
    except ConfigError as e:
        print(f"startup validation failed: {e}", file=sys.stderr)
        return 1

    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logger = logging.getLogger("rete_mcp_prod")

    try:
        server = MCPServer(cfg)
    except Exception:
        logger.exception("failed to initialize server (database unreachable at startup?)")
        return 1

    try:
        http_server = run_http(server)
    except OSError as e:
        logger.error("failed to bind %s:%d - %s", cfg.bind_host, cfg.bind_port, e)
        return 1

    def shutdown_handler(signum, frame):
        logger.info("received shutdown signal, draining")
        server.shutdown()
        threading.Thread(target=http_server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    logger.info("rete-squillari-mcp-prod listening on %s:%d (env=%s)", cfg.bind_host, cfg.bind_port, cfg.environment)
    http_server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
