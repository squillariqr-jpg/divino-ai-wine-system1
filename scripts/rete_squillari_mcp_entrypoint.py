#!/usr/bin/env python3
import sys
import logging
from scripts.rete_squillari_mcp.config import MCPConfig
from scripts.rete_squillari_mcp.server import MCPServer
from scripts.rete_squillari_mcp_server import run_http

logging.basicConfig(level=logging.INFO, format="%(message)s")

def main():
    config = MCPConfig.from_env()
    validation_error = config.validate()

    if validation_error:
        logging.error(f"Configuration validation failed: {validation_error}")
        sys.exit(1)

    try:
        server = MCPServer(config)
        logging.info("Starting Rete Squillari MCP server...")
        run_http(server)
    except Exception as e:
        logging.error(f"Server encountered a fatal error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
