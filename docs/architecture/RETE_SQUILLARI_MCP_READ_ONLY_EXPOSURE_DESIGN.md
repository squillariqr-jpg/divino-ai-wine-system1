# Rete Squillari — MCP Read-Only Exposure Design

This is a design document only. It does not implement an MCP server, connector, endpoint, real authentication or production data access.

## Boundary

```text
ChatGPT / MCP Client
→ Authenticated MCP Connector
→ WBOS MCP Boundary
→ WBOSReadOnlyApplicationGateway
→ Static Tool Registry
→ DemoInMemoryReadOnlyAdapter
→ Audit and Evidence
```

The static allowlist contains only: `rete_squillari.list_locations`, `get_location`, `get_allowed_reasons`, `list_shortage_requests`, `get_shortage_request`, `validate_shortage_request`, `preview_request_print`, and `preview_transfer_label`. No dynamic registration, generic execution, write tool, shell, arbitrary HTTP or file access is allowed.

## Transport and identity

STDIO is appropriate for a local operator-controlled process. For a future remote ChatGPT connector, recommend authenticated Streamable HTTP behind the WBOS boundary, with TLS, request limits and connector-level authorization. The future context must carry connector identity, service identity, human authority, `agent_id`, `agent_run_id`, `session_id`, `authorized_location_ids`, capabilities and `correlation_id`. Secrets belong in external secret storage with rotation; never put API keys in prompts.

## Policy and runtime controls

The gateway must enforce per-tool capability, per-location scope, input and output JSON Schema validation, audit on every invocation, and evidence on successful reads. It must fail closed, apply rate limits, bounded timeouts and payload-size limits, and prevent replay through correlation/run controls. Failed output validation returns `ERROR` with `OUTPUT_SCHEMA_VALIDATION_FAILED`, no success evidence and no stack trace.

## Error mapping and threats

Map `SUCCESS`, `DENIED`, `NOT_FOUND`, `INVALID_INPUT` and `ERROR` to stable MCP tool-result error categories while preserving the gateway reason code. Threats include prompt injection, tool confusion, capability escalation, cross-location leakage, schema bypass, oversized payloads, replay, audit tampering, secret leakage, adapter mutation and generic execution. Mitigations are the authenticated context, static allowlist, scope checks, schema validation, immutable/defensive-copy adapter behavior, append-only audit/evidence storage, redaction, limits and deny-by-default policy.

## Explicit non-goals

`MCP SERVER: NOT IMPLEMENTED`
`PUBLIC ENDPOINT: NOT IMPLEMENTED`
`CHATGPT CONNECTOR: NOT IMPLEMENTED`
`REAL AUTH: NOT IMPLEMENTED`
`REAL BACKEND: NOT IMPLEMENTED`
`PRODUCTION DATA: NOT CONNECTED`
`WRITE TOOLS: NOT IMPLEMENTED`
