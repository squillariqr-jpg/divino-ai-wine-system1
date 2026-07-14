# Rete Squillari — ChatGPT Connector Exposure Plan

This document is planning only. No public endpoint, connector, OAuth client, production secret or real data connection is configured.

## Preconditions

1. Close the MCP 2025-06-18 gaps in the conformance matrix.
2. Verify STDIO and Streamable HTTP with an official/independent MCP client.
3. Run security review for origin rebinding, session headers, protocol version headers, OAuth audience and replay.
4. Keep the eight-tool static allowlist and WBOS gateway as the only execution path.

## Hosting requirements

The production host must provide stable HTTPS, TLS termination, request streaming/long-lived connections where required, session state or affinity, bounded timeouts, rate limiting, secret-manager integration, structured audit and deployment provenance. The existing Vercel site is not assumed to be suitable for a stateful Streamable HTTP MCP service; a dedicated container/service or managed MCP-compatible host should be evaluated first.

## Identity and secrets

Use an OAuth-compatible MCP resource-server model for remote exposure. The authorization server must issue audience-bound short-lived access tokens. Store signing keys and client credentials in an external secret manager with rotation, revocation, environment separation, least privilege and audited break-glass access. Never use the local static test token in Production.

The request context must derive connector identity, service identity, agent identity, human authority, capabilities, authorized location IDs and correlation IDs server-side. Client input must not elevate capabilities or location scope.

## Connector registration sequence

1. Publish a reviewed HTTPS MCP endpoint in a separate release gate.
2. Configure OAuth metadata, resource indicator/audience and redirect policy.
3. Register the connector in the approved ChatGPT administrative surface.
4. Verify the tool allowlist contains only the eight read-only tools.
5. Test first with `rete_squillari.list_locations`, then `rete_squillari.get_allowed_reasons`.
6. Verify user authorization, audit correlation and location-scope denial.
7. Revoke the connector and confirm access termination.

## Operations

Retain MCP boundary audit correlated to WBOS audit/evidence, monitor authentication failures, rate-limit denials, protocol errors and latency, and define incident response, rollback, health checks and deployment provenance before any exposure. No write tools, real backend or production data are included in this plan.
