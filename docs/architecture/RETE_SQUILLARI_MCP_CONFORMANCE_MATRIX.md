# Rete Squillari MCP conformance matrix

Baseline: MCP `2025-06-18`. Supported negotiated versions: `2025-06-18` and `2025-11-25`. The baseline remains primary; the newer revision is selected only when requested by a client. Latest specification reviewed: `2025-11-25`. Official sources: [Lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

| Requirement | Spec section | Implementation location | Test location | Status | Evidence | Remaining gap |
|---|---|---|---|---|---|---|
| Explicit lifecycle NEW/INITIALIZED/READY/CLOSED | Lifecycle | `session.py`, `server.py` | MCP tests | PASS | 164 tests; per-STDIO and HTTP session state | None in local scope. |
| Strict initialize and initialized notification | Lifecycle | `server.py`, runners | MCP tests, official SDKs | PASS | both official SDKs complete lifecycle | None. |
| Version negotiation | Lifecycle | `config.py`, `server.py` | version tests, official SDKs | PASS | `2025-06-18` and `2025-11-25` negotiated per session | None for supported versions. |
| HTTP session and protocol headers | Transports | `session.py`, HTTP runner | official Python HTTP, independent HTTP | PASS | session ID issued; protocol header enforced | None. |
| JSON-RPC standard errors and bounded decoding | JSON-RPC | `protocol.py`, runners | MCP tests | PASS | `-32700` through `-32603`; batch denied | None. |
| Exact loopback Origin policy | Transports/security | HTTP runner | HTTP tests | PASS | structured allowlist; public/LAN/confusion origins denied | Missing Origin intentionally denied. |
| Replay and request ID semantics | Transports/security | `session.py`, `server.py` | nonce tests, HTTP tests | PASS | bounded per-session X-Request-Id | None. |
| Strong timeout cancellation | execution boundary | `worker.py`, `server.py` | timeout/kill tests | PASS | terminate, bounded join, kill fallback | OS sandbox is not implemented. |
| Late mutation prevention | execution boundary | one-shot worker | mutation tests | PASS | worker mutation dies with isolated process; parent unchanged | None within demo process boundary. |
| Worker IPC hardening | execution boundary | `worker.py` | failure tests | PASS | bounded JSON bytes; no pickle input; malformed/oversized/crash mapping | None. |
| Official Python SDK | gate requirement | external venv | official Python STDIO/HTTP clients | PASS | `mcp 1.28.1`, protocol `2025-11-25`, 8 tools/call | None. |
| Official TypeScript SDK | gate requirement | external node env | official TypeScript STDIO client | PASS | SDK latest `2025-11-25`, 8 tools/call | None. |
| Independent transports | gate requirement | STDIO/HTTP runners | independent clients | PASS | STDIO and loopback HTTP pass | No public endpoint by policy. |
| Exact eight read-only tools | Tools | registry, gateway, MCP server | gateway/MCP/SDK tests | PASS | 8 read-only, 0 write, 0 generic | None. |

## Decision

`OFFICIAL_MCP_CONFORMANCE: PASS_LOCAL`

`FAIL_COUNT: 0`
`PARTIAL_COUNT: 0`
`CRITICAL_GAPS: NONE`

`OS_SANDBOX: NO` remains an explicit limitation. The server is local-only: no public endpoint, tunnel, connector, production authorization, real data, or write tool.
