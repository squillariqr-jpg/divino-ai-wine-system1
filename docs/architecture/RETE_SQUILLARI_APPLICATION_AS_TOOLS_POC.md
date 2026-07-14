# Rete Squillari — Application-as-Tools POC

## 1. Executive summary

Rete Squillari è una applicazione frontend demo locale per coordinare richieste di ammanco tra i sei negozi autorizzati e il magazzino Trasta. Non è un agente. In futuro esporrà strumenti applicativi tipizzati a WBOS; gli agenti proporranno e verificheranno operazioni, mentre la governance WBOS e Luca manterranno l'autorità sulle scritture sensibili.

Questo documento definisce contratti e confini soltanto. Non implementa backend condiviso, MCP server, gateway, agent runtime, notifiche reali o integrazioni inventariali.

## 2. Current-state evidence

- L'app demo è `public/rete-squillari/index.html`, con `public/rete-squillari/location-model.js` e persistenza `localStorage`.
- La matrice location/permission è implementata nel modello locale e coperta dai test esistenti.
- Il repository contiene agenti e un orchestratore Hermes in `lib/hermes/agents/*` e `lib/hermes/orchestrator.ts`, oltre a `docs/agents.md` e `docs/RETE_SQUILLARI_AGENT_UPDATE_WORKFLOW.md`.
- Non sono stati trovati un registry applicativo Rete Squillari, un MCP server Rete Squillari o un WBOS gateway esposto per questi tool.
- Il log `db.audit` della demo è una struttura locale applicativa; non è un evidence store verificabile.
- `lib/placeholder-backend.ts` documenta/fornisce un pattern placeholder, non una persistence adapter condivisa per Rete Squillari.

## 3. Gap analysis

| Componente | Stato | Evidenza / gap |
|---|---|---|
| Agent registry | PARTIAL | Agenti Hermes presenti, registry governato non trovato |
| Tool registry | ABSENT | Nessun catalogo invocabile Rete Squillari |
| MCP server | ABSENT | Nessun server MCP specifico trovato |
| WBOS gateway | ABSENT | Nessun boundary di invocazione Rete Squillari trovato |
| Authorization boundary | PARTIAL | Matrice locale demo; manca autorizzazione autenticata e single-use |
| Evidence store | ABSENT | Nessun evidence store condiviso trovato |
| Audit log | PARTIAL | `db.audit` locale, non immutabile e non multi-store |
| Application adapter pattern | DOCUMENTED_ONLY | placeholder/backend patterns presenti, non collegati alla demo |
| Agent runtime | PARTIAL | Runtime/orchestrator Hermes esistono, non governano questi tool |

`RETE_SQUILLARI_AS_APPLICATION: YES`  
`RETE_SQUILLARI_AS_AGENT: NO`  
`RETE_SQUILLARI_AS_TOOL_PROVIDER: NO (proposed only)`  
`WBOS_CAN_INVOKE_RETE_SQUILLARI_TOOLS_TODAY: NO`  
`CHATGPT_CAN_ORCHESTRATE_THESE_TOOLS_TODAY: NO`

## 4. Target architecture

```text
Luca → ChatGPT Orchestrator → WBOS Orchestration Gateway → Agent Registry
     → bounded WBOS agents → Rete Squillari application tools
     → persistence adapter → audit/evidence store
```

Agents reason, coordinate and propose. Application tools execute typed application operations. WBOS validates identity, scope, gate and authorization. Luca remains final authority for sensitive operations.

## 5. Tool catalog

Read tools: `rete_squillari.list_locations`, `get_location`, `list_shortage_requests`, `get_shortage_request`, `get_allowed_reasons`, `validate_shortage_request`, `preview_request_print`, `preview_transfer_label`.

Proposal tools: `propose_shortage_request`, `propose_stock_offer`, `propose_transfer`, `propose_request_cancellation`.

Governed write tools: `create_shortage_request`, `add_comment`, `offer_stock`, `confirm_stock_offer`, `prepare_transfer`, `mark_transfer_departed`, `mark_transfer_received`, `close_shortage_request`, `cancel_shortage_request`.

Print tools: `render_request_print`, `render_transfer_label`.

No generic `execute`, `run_anything`, `call_method`, shell, arbitrary HTTP or generic file-write tool is permitted.

## 6. Typed contracts

Every tool contract has this envelope:

```json
{
  "tool_name": "string",
  "description": "string",
  "risk_class": "R0_READ_ONLY | R1_PREVIEW | R2_PROPOSAL | R3_REVERSIBLE_WRITE | R4_STATE_TRANSITION | R5_DESTRUCTIVE_OR_EXTERNAL",
  "read_or_write": "READ | WRITE",
  "input_schema": "JSON Schema",
  "output_schema": "JSON Schema",
  "required_identity": ["authenticated_user_id", "agent_id", "agent_run_id", "location_context"],
  "required_capability": "string",
  "required_approval": "NONE | HUMAN_LUCA",
  "idempotency_strategy": "key and payload fingerprint",
  "audit_event": "required event schema",
  "evidence_output": ["evidence_id"],
  "failure_modes": ["DENY", "STALE_STATE", "DUPLICATE", "VALIDATION_ERROR"]
}
```

The canonical proposal contract is:

```json
{
  "tool_name": "rete_squillari.propose_shortage_request",
  "risk_class": "R2_PROPOSAL",
  "read_or_write": "WRITE",
  "input_schema": {
    "type": "object",
    "required": ["requesting_location_id", "product_code", "product_description", "requested_quantity", "reason"],
    "properties": {
      "requesting_location_id": {"enum": ["malta", "sestri", "cantore", "trento", "de_ferrari", "armenia", "trasta"]},
      "product_code": {"type": "string", "minLength": 1},
      "product_description": {"type": "string", "minLength": 1},
      "requested_quantity": {"type": "integer", "minimum": 1},
      "reason": {"enum": ["CUSTOMER_SALE", "ONLINE_SALE", "STOCK_GAP"]},
      "comment": {"type": "string"},
      "priority": {"enum": ["NORMAL", "HIGH"]}
    }
  },
  "output_schema": {"type": "object", "required": ["proposal_id", "validation_result", "reason_codes", "normalized_payload", "evidence_id"]}
}
```

All read, proposal, write and print tools use the same envelope and must define their resource-specific input/output schemas before implementation. Each write requires a typed capability and explicit authorization; print tools return a preview/artifact and must be side-effect free.

## 7. Agent catalog and boundary

- **Shortage Coordinator Agent:** interprets requests, validates and proposes shortage requests; never direct-writes inventory.
- **Inventory Verification Agent:** reads stock evidence; never assigns a supplier automatically or creates transfers.
- **Transfer Matching Agent:** proposes supplier/destination matches; never confirms a transfer.
- **Store Notification Agent:** drafts notifications and recipients; external delivery requires human authorization.
- **Human Review Agent:** presents evidence and conflicts; cannot substitute for Luca or sign authorization.
- **Observer / Audit Agent:** read-only verification and evidence production; cannot repair state.

### Agent/tool matrix

Legend: `ALLOW` read-only, `PROPOSE_ONLY`, `REQUIRES_HUMAN_AUTHORIZATION`, `DENY`.

| Agent | Read tools | Proposal tools | Governed writes | Print tools |
|---|---|---|---|---|
| Shortage Coordinator | ALLOW | PROPOSE_ONLY shortage | create/add comment: HUMAN; other writes: DENY | preview/render: ALLOW |
| Inventory Verification | ALLOW | stock offer: PROPOSE_ONLY | all writes: DENY | preview: ALLOW; render: DENY |
| Transfer Matching | ALLOW | transfer: PROPOSE_ONLY | prepare/depart/receive: HUMAN; others: DENY | preview/render label: ALLOW |
| Store Notification | locations/requests: ALLOW | cancellation: PROPOSE_ONLY | external notification and state writes: HUMAN | DENY |
| Human Review | all reads: ALLOW | all proposals: ALLOW | all governed writes: HUMAN/Luca only | all print: ALLOW |
| Observer / Audit | all reads: ALLOW | all proposals: DENY | all writes: DENY | previews: ALLOW; render: DENY |

## 8. Risk classes

| Class | Automatic execution | Human approval | Audit | Rollback | Idempotency |
|---|---|---|---|---|---|
| R0_READ_ONLY | yes | no | yes | n/a | request key |
| R1_PREVIEW | yes | no | yes | n/a | request key |
| R2_PROPOSAL | yes, proposal only | before write | yes | discard proposal | proposal key |
| R3_REVERSIBLE_WRITE | no | Luca | yes | required | mandatory |
| R4_STATE_TRANSITION | no | Luca | yes | transition-specific | mandatory |
| R5_DESTRUCTIVE_OR_EXTERNAL | no | Luca + gate | yes | compensating action | mandatory + replay lock |

## 9. Authorization flow

```text
PROPOSE → VALIDATE → REVIEW → AUTHORIZE → EXECUTE → VERIFY → AUDIT
```

An authorization record contains `authorization_id`, `proposal_id`, `authorized_action`, `authorized_scope`, `authorized_by`, `authorized_at`, `expires_at`, `single_use` and `payload_fingerprint`. The record is issued by WBOS, not inferred from a prompt or API key. Execution rejects expired, replayed, scope-mismatched or fingerprint-mismatched records.

## 10. Persistence adapters

Required interfaces: `ShortageRequestRepository`, `LocationRepository`, `TransferRepository`, `AuditRepository`, `EvidenceRepository`.

`LocalStorageDemoAdapter` is browser-local, demo-only, unsynchronized and not production-ready. Agents must never access `localStorage` directly. `SharedBackendAdapter` is future-only and must be authenticated, transactional, versioned/optimistic-locked, auditable and fail-closed.

## 11. Identity model

Keep separate: `human_identity`, `agent_identity`, `location_identity`, `tool_identity`, `service_identity`. Future invocation context requires `authenticated_user_id`, `role`, `authorized_location_ids`, `agent_id`, `agent_run_id`, `session_id` and `authorization_context`. The current profile value in localStorage is a UI demo selector, not trusted identity.

## 12. Audit and evidence

Every call emits `event_id`, `timestamp`, `tool_name`, `tool_version`, `agent_id`, `agent_run_id`, `human_actor_id`, `location_context`, `input_fingerprint`, `authorization_id`, `result`, `reason_codes`, `state_before_hash`, `state_after_hash` and `evidence_ids`. Read-only calls may have equal state hashes. Secrets and unnecessary personal data are excluded.

## 13. Proposed WBOS gateway surface

`wbos_list_application_tools`, `wbos_get_tool_contract`, `wbos_run_read_tool`, `wbos_submit_proposal`, `wbos_get_proposal`, `wbos_evaluate_gate`, `wbos_authorize_action`, `wbos_execute_authorized_action`, `wbos_get_evidence`, `wbos_get_run_status`, `wbos_cancel_run`.

The gateway forbids arbitrary commands, shell passthrough, generic HTTP/file writes, secret returns, prompt-supplied API keys and writes without typed authorization.

## 14. Threat model

| Threat | Impact | Current exposure | Required mitigation | Residual risk |
|---|---|---|---|---|
| Prompt injection / agent impersonation | unauthorized proposal | medium | signed agent context, allowlisted tools | medium |
| Location impersonation | cross-store leakage | high in demo selector | authenticated location claims and scope checks | low/medium |
| Authorization replay / duplicate execution | duplicate transfer/write | absent in demo | expiring single-use authorization and idempotency keys | low |
| Stale state / race condition | wrong quantity/state | high without shared backend | version checks and transactions | medium |
| localStorage tampering | false local state | high, demo-only | never trust for production; server validation | low after migration |
| Over-permissioned/generic tools | arbitrary mutation | not implemented | typed registry and deny-by-default | low |
| Secret leakage / audit tampering | credential or evidence compromise | no secrets in demo | redaction, append-only evidence store | low/medium |
| Partial failure / notification before commit | inconsistent user state | not integrated | commit-before-notify and outbox | medium |
| Print mutation | unintended state transition | must be tested | pure render functions and immutable snapshots | low |

## 15. Incremental implementation plan

| Phase | Scope | Entry / exit evidence | Blocked actions | Rollback |
|---|---|---|---|---|
| 0 | architecture/contracts only | approved schemas and threat model | all real writes | remove docs |
| 1 | read-only tool registry | contract tests, allowlist | proposals/writes | disable registry |
| 2 | read-only WBOS gateway | auth/scope/evidence tests | writes and external calls | revoke gateway |
| 3 | proposal-only tools | proposal fixtures and review UI | direct write | discard proposals |
| 4 | human-authorized reversible writes | authorization/replay/idempotency tests | transitions/external notify | compensating writes |
| 5 | state-transition tools | transaction/version/evidence tests | destructive actions | transition rollback |
| 6 | real shared backend | migration, backup, RLS and audit evidence | localStorage authority | restore snapshot |
| 7 | ChatGPT orchestration pilot | bounded runs and human review | autonomous writes | revoke agent |
| 8 | limited production pilot | operational, security and rollback gates | unapproved scope | disable feature flag |

## 16. Explicit non-goals

This POC does not implement an MCP server, WBOS gateway, agent runtime, database, shared backend, real notifications, real inventory, production tools, direct ChatGPT orchestration, or any real-data connection.

## 17. Readiness decision

The architecture is defined for a future application-as-tools implementation. It is not implemented, and no agent may invoke Rete Squillari tools today. The shortage demo must pass its independent functional review before branch publication review; architecture readiness does not override that gate.

## Read-Only Tool Registry and Gateway Implementation

This isolated proof of concept implements a static registry, typed contracts, a read-only WBOS gateway, a deterministic `LocalStorageDemoReadOnlyAdapter` equivalent backed by in-memory demo fixtures, audit events, evidence records, deterministic fingerprints and a local CLI harness. It exposes exactly eight read-only tools: location reads, shortage reads and validation, and request/transfer-label previews.

The gateway validates a typed identity context and capability before resolving a registered tool. Unknown tools, write-like names, missing identity, missing capabilities, invalid inputs and adapter errors fail closed through a response envelope. Every invocation is read-only and produces audit/evidence metadata with `source_mode: DEMO`.

Implemented in this POC:

- static tool registry;
- typed contracts with explicit schemas;
- identity and capability checks;
- read-only demo adapter;
- read-only gateway;
- audit and evidence stores;
- deterministic fingerprints;
- local harness and tests.

Not implemented:

- write tools;
- real backend, authentication or shared persistence;
- public MCP connector;
- direct ChatGPT orchestration;
- production data access or deployment.
