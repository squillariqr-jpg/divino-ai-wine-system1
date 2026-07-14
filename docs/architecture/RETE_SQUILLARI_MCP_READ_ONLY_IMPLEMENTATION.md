# Rete Squillari authenticated read-only MCP implementation

The boundary exposes exactly eight named read-only tools through `WBOSReadOnlyApplicationGateway`. Every `tools/call` runs in a fresh one-shot worker process. The parent sends only a bounded JSON payload containing the tool name, validated arguments, sanitized identity context, correlation/request IDs and `DEMO` source mode.

The worker reconstructs the demo gateway, executes one tool, serializes one bounded JSON response and exits. The parent waits for `request_timeout_ms`, then sends terminate, performs a bounded join, sends kill if necessary, joins again, discards late pipe output and returns `REQUEST_TIMEOUT`. Worker crash, malformed response and oversized response are mapped to sanitized errors.

No pickle is accepted from the client, no mutable state is shared with the parent, and the worker receives no bearer token, Authorization header, token digest or raw HTTP request. This is process isolation, not an OS sandbox: `OS_SANDBOX: NO`.

Protocol versions are negotiated per session. `2025-06-18` remains the primary review baseline and `2025-11-25` is supported for official SDK clients. Official Python `mcp 1.28.1` and the official TypeScript SDK complete STDIO; the Python SDK also completes loopback Streamable HTTP.

Local verification: 164 tests pass, including forced-kill, late-mutation, worker-failure, official SDK and independent transport tests. Security invariants remain: DEMO data only, no production secrets, no public exposure, no ChatGPT connector, no real backend and no write tools.
