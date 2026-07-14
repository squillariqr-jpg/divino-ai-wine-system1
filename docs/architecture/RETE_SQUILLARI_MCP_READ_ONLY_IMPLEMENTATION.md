# Rete Squillari — Authenticated Read-Only MCP Implementation

This implementation is local/test-only. It uses a small JSON-RPC MCP boundary and keeps `WBOSReadOnlyApplicationGateway` as the sole execution authority.

`OFFICIAL_MCP_CONFORMANCE: PARTIAL`. The local prototype passes its security/unit checks, but independent review found lifecycle, HTTP negotiation, Origin and standard session-header gaps against MCP 2025-06-18. See `RETE_SQUILLARI_MCP_CONFORMANCE_MATRIX.md`.

## Implemented

- local MCP server entrypoint;
- STDIO transport with stdout reserved for JSON-RPC;
- loopback-only HTTP boundary at `/mcp`;
- static digest credential verifier using `RETE_SQUILLARI_MCP_TEST_TOKEN`;
- server-side principal and read-only capability profile;
- exactly eight static tools from the existing registry;
- WBOS gateway integration, including input/output validation and location scope;
- in-memory sessions, TTL, nonce replay protection, rate limiting and payload limits;
- sanitized MCP error mapping and boundary audit;
- security headers, no wildcard CORS and no public bind;
- 38 independent tests.

The 55 repository tests cover the gateway and local boundary. They do not substitute for an official MCP client/Inspector interoperability run.

## Local test run

```bash
export RETE_SQUILLARI_MCP_TEST_TOKEN=local-test-token
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests -v
python3 scripts/rete_squillari_mcp_server.py --transport stdio
```

HTTP mode requires the same environment variable and binds only to `127.0.0.1`. It is not a production service.

## Not implemented

Public HTTPS deployment, ChatGPT connector registration, production identity provider, production secret storage, real backend, real data, write tools and public MCP exposure are not implemented.
