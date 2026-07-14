# Rete Squillari authenticated read-only MCP implementation

The local boundary exposes exactly eight named read-only tools through `WBOSReadOnlyApplicationGateway`. The lifecycle is explicit: `NEW → INITIALIZED → READY`, with requests denied before readiness and notification responses suppressed.

Protocol baseline is `2025-06-18`; the negotiated value is stored in each STDIO connection or HTTP `Mcp-Session-Id` session. HTTP is loopback-only, requires bearer authentication, exact Origin validation, `X-Request-Id`, and `MCP-Protocol-Version` after initialization. Sessions use CSPRNG identifiers and never accept a client-selected identifier.

JSON-RPC standard error codes, strict JSON decoding, payload limits, replay protection, audit-safe identifiers, and a bounded gateway timeout path are implemented. The timeout path remains locally bounded but cannot certify interruption of an arbitrary non-cancellable blocking adapter; this is the only implementation gap carried forward.

Local verification: 135 unittest methods pass, independent subprocess STDIO passes, and independent loopback HTTP passes. The official Python SDK `mcp 1.28.1` and TypeScript SDK/Inspector were installed only in temporary external environments; the Python client defaults to a newer protocol and therefore could not complete a `2025-06-18` session.

Security invariants remain: DEMO data only, no production secrets, no real backend, no public exposure, no ChatGPT connector, no write tools, and no gateway bypass.
