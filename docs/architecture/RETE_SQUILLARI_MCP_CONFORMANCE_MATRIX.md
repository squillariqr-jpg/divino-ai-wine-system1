# Rete Squillari MCP conformance matrix

Review base: official MCP `2025-06-18`. Latest official specification reviewed: `2025-11-25`; this implementation intentionally negotiates only the review baseline. Sources: [Lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

| Requirement | Spec section | Implementation location | Test location | Status | Evidence | Remaining gap |
|---|---|---|---|---|---|---|
| Explicit NEW/INITIALIZED/READY/CLOSED lifecycle | Lifecycle | `scripts/rete_squillari_mcp/session.py`, `server.py` | `tests/test_rete_squillari_mcp.py` | PASS_LOCAL | 135 tests; per-STDIO and per-HTTP-session state | Closure is represented by process/session cleanup. |
| `initialize` first interaction | Lifecycle | `MCPServer.handle` | lifecycle tests | PASS_LOCAL | pre-ready tools denied; duplicate initialize denied | None for local scope. |
| `notifications/initialized` | Lifecycle | `MCPServer.handle`, STDIO/HTTP runners | notification tests, independent clients | PASS_LOCAL | no response body; HTTP 202 | None for local scope. |
| Version negotiation `2025-06-18` | Lifecycle | `_version`, `MCPConfig` | version tests, STDIO/HTTP clients | PASS_LOCAL | negotiated version returned and stored | Official Python client 1.28.1 defaults to newer protocol and rejected baseline. |
| `Mcp-Session-Id` | Transports | `SessionStore`, HTTP runner | independent HTTP client | PASS_LOCAL | CSPRNG header issued and required | No remote/session DELETE because public exposure is forbidden. |
| `MCP-Protocol-Version` | Transports | HTTP runner/server | independent HTTP client | PASS_LOCAL | missing/mismatch denied with HTTP 400 | None for local scope. |
| JSON-RPC standard errors | JSON-RPC | `protocol.py`, runners, server | protocol tests | PASS_LOCAL | `-32700` through `-32603`; batch denied `-32600` | None for local scope. |
| Origin policy | Transports/security | HTTP runner | unit/HTTP tests | PASS_LOCAL | exact loopback allowlist; missing/null/public/LAN denied | Missing Origin is intentionally denied. |
| Replay semantics | Transports/security | `SessionStore`, `MCPServer` | nonce tests, HTTP client | PASS_LOCAL | X-Request-Id bounded and unique per HTTP session | STDIO uses transport-local request IDs only. |
| End-to-end timeout | server boundary | `MCPServer._call` | local timeout path | PARTIAL | bounded future and `REQUEST_TIMEOUT` audit path | Python thread cancellation cannot prove interruption of arbitrary blocking adapter. |
| Independent STDIO interoperability | gate requirement | subprocess boundary | `/private/tmp/rete_squillari_stdio_client.py` | PASS_LOCAL | protocol-clean, 8 tools, call, clean exit | Official SDK attempt was not baseline-compatible. |
| Independent Streamable HTTP interoperability | gate requirement | loopback HTTP boundary | `/private/tmp/rete_squillari_http_client.py` | PASS_LOCAL | session, 202, 8 tools, call, 400 errors | No public endpoint by policy. |
| Exact eight read-only tools | Tools | gateway registry and `_tools` | gateway/MCP tests | PASS_LOCAL | 8, no writes/generic tools | None. |

## Decision

`OFFICIAL_MCP_CONFORMANCE: IMPLEMENTATION_COMPLETE_INTEROPERABILITY_UNVERIFIED`

`FAIL_COUNT: 0` for implemented local requirements; `CRITICAL_GAPS: TIMEOUT_CANCELLATION_PROOF, OFFICIAL_SDK_BASELINE_COMPATIBILITY`.

The server remains local-only: no public endpoint, tunnel, connector, production authorization, real data, or write tool.
