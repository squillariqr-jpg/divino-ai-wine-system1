# Rete Squillari — MCP 2025-06-18 Conformance Matrix

Baseline: official MCP specification revision `2025-06-18`. This review is independent of the local unit tests. Official sources: lifecycle, transports, authorization and tools pages on `modelcontextprotocol.io`.

| ID | Requirement | MUST/SHOULD | Implementation / test | Status | Gap / remediation |
|---|---|---|---|---|---|
| L-01 | `initialize` first interaction | MUST | `server.py`, local tests | PARTIAL | Current handler accepts normal methods before initialize; add per-session lifecycle state. |
| L-02 | `notifications/initialized` | MUST lifecycle | Not implemented | FAIL | Add notification handling with no response. |
| L-03 | Shutdown via transport | SHOULD | STDIO EOF / HTTP close | PASS | No custom shutdown method is needed. |
| V-01 | Version negotiation | MUST | Fixed response currently | PARTIAL | Validate requested `2025-06-18`, reject malformed/unsupported versions with `-32602`. |
| V-02 | HTTP `MCP-Protocol-Version` | MUST after init | Not implemented | FAIL | Require negotiated header on subsequent HTTP requests. |
| C-01 | Declare only implemented capabilities | MUST | `tools` only | PASS | No false capabilities declared. |
| J-01 | JSON-RPC 2.0 envelope | MUST | `protocol.py`, tests | PASS | Result/error separation covered. |
| J-02 | Standard error codes | MUST | Partial mapping | PARTIAL | Replace transport-level custom codes with standard JSON-RPC codes plus safe data. |
| T-01 | `tools/list` shape | MUST | `server.py`, tests | PASS | Eight static tools and annotations. |
| T-02 | `tools/call` shape | MUST | `server.py`, tests | PASS | Content, structured content and `isError` returned. |
| H-01 | POST requires JSON and both Accept types | MUST | HTTP handler | FAIL | Current handler only checks Content-Type. |
| H-02 | Notification POST returns 202/no body | MUST | Not implemented | FAIL | Add notification detection and 202 response. |
| H-03 | GET SSE or 405 | MUST | Default 501/unsupported | FAIL | Explicitly return 405 with correct Accept handling. |
| H-04 | DELETE 405 or session termination | MAY/SHOULD | Not implemented | FAIL | Explicitly return 405 or implement standard session deletion. |
| H-05 | Origin validation | MUST | Not implemented | FAIL | Validate loopback Origin exactly; reject null/malformed/LAN/public origins. |
| H-06 | `Mcp-Session-Id` header | MUST when stateful | Session only in payload/internal state | FAIL | Emit and require standard HTTP session header. |
| A-01 | Bearer authentication | MUST for remote HTTP | Local static digest | PARTIAL | Valid local test auth; OAuth/resource-server profile is not implemented. |
| A-02 | OAuth authorization profile | SHOULD/MUST for remote exposure | Not implemented | NOT_IMPLEMENTED | Production exposure remains forbidden. |
| R-01 | Replay protection | Local proprietary control | `session.py`, tests | PASS | Must be reconciled with standard HTTP session lifecycle. |
| R-02 | Rate/payload limits | Security control | `rate_limit.py`, tests | PASS | HTTP status mapping needs refinement. |
| I-01 | Independent MCP client | Gate requirement | No official client installed | NOT_IMPLEMENTED | Acquire verified official SDK/Inspector in a later isolated gate. |
| S-01 | Static eight-tool allowlist | Security control | Registry-derived | PASS | No dynamic registration or adapter bypass. |

## Decision

`OFFICIAL_MCP_CONFORMANCE: PARTIAL`

The local boundary is useful as a security-oriented prototype, but it is not ready for public exposure or ChatGPT connector registration until the HTTP lifecycle/header/origin gaps and independent interoperability test are closed.
