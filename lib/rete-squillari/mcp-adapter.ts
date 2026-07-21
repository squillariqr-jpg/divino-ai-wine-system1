/**
 * Server-side-only client for the production Rete Squillari read-only MCP.
 *
 * This module must never be imported from client components or any file
 * bundled into the browser - it reads RETE_MCP_TOKEN from process.env,
 * which is never prefixed with NEXT_PUBLIC_ and therefore never inlined
 * into client JavaScript by Next.js. It is only ever called from
 * app/api/rete-squillari/mcp/route.ts (a server-only Route Handler).
 *
 * Read-only by construction: the tool allowlist below is the only surface
 * this module exposes, it is not a generic JSON-RPC proxy, and it never
 * accepts an arbitrary method/tool name from a caller.
 */

const MCP_TIMEOUT_MS = 8000;

export const ALLOWED_TOOLS = [
  'rete_get_health',
  'rete_get_pilot_status',
  'rete_list_locations',
  'rete_list_pending_confirmations',
  'rete_list_open_requests',
  'rete_get_request',
  'rete_list_offers',
  'rete_list_transfers',
  'rete_list_receipt_discrepancies',
  'rete_get_request_audit',
] as const;

export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

export class McpAdapterError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 502) {
    super(message);
    this.name = 'McpAdapterError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function getConfig() {
  const baseUrl = process.env.RETE_MCP_BASE_URL;
  const token = process.env.RETE_MCP_TOKEN;
  if (!baseUrl || !token) {
    // Fail closed: never attempt a request with a missing base URL or
    // token, and never leak which one specifically is missing.
    throw new McpAdapterError(
      'MCP_NOT_CONFIGURED',
      'Servizio dati rete non configurato sul server.',
      503
    );
  }
  return { baseUrl, token };
}

export interface McpToolResult {
  ok: true;
  data: Record<string, unknown>;
}

export interface McpToolFailure {
  ok: false;
  code: string;
  httpStatus: number;
  message: string;
}

export type McpToolOutcome = McpToolResult | McpToolFailure;

/**
 * Calls exactly one allowlisted read-only MCP tool. Never logs the
 * Authorization header value (only its presence/absence is logged by the
 * caller, never the header itself). Fails closed on timeout, network
 * error, non-2xx HTTP, malformed JSON-RPC envelope, or a JSON-RPC-level
 * error response - every failure path returns a generic, redacted
 * McpToolFailure, never the raw upstream error text or stack.
 */
export async function callMcpTool(
  tool: AllowedTool,
  args: Record<string, unknown> = {}
): Promise<McpToolOutcome> {
  if (!ALLOWED_TOOLS.includes(tool)) {
    // Defense in depth - the route handler already validates this, but
    // this module must never trust a caller-supplied tool name either.
    return { ok: false, code: 'TOOL_NOT_ALLOWED', httpStatus: 400, message: 'Strumento non consentito.' };
  }

  let baseUrl: string;
  let token: string;
  try {
    ({ baseUrl, token } = getConfig());
  } catch (e) {
    if (e instanceof McpAdapterError) {
      return { ok: false, code: e.code, httpStatus: e.httpStatus, message: e.message };
    }
    return { ok: false, code: 'MCP_NOT_CONFIGURED', httpStatus: 503, message: 'Servizio dati rete non configurato sul server.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
      signal: controller.signal,
    });
  } catch (networkErr) {
    const isAbort = networkErr instanceof Error && networkErr.name === 'AbortError';
    return {
      ok: false,
      code: isAbort ? 'MCP_TIMEOUT' : 'MCP_UNREACHABLE',
      httpStatus: isAbort ? 504 : 502,
      message: isAbort ? 'Il servizio dati rete non ha risposto in tempo.' : 'Servizio dati rete non raggiungibile.',
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return { ok: false, code: 'MCP_HTTP_ERROR', httpStatus: 502, message: 'Errore del servizio dati rete.' };
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    return { ok: false, code: 'MCP_INVALID_RESPONSE', httpStatus: 502, message: 'Risposta non valida dal servizio dati rete.' };
  }

  if (!isJsonRpcEnvelope(envelope)) {
    return { ok: false, code: 'MCP_INVALID_RESPONSE', httpStatus: 502, message: 'Risposta non valida dal servizio dati rete.' };
  }

  if ('error' in envelope) {
    const reasonCode = envelope.error?.data?.reason_code;
    if (reasonCode === 'AUTHORIZATION_DENIED') {
      return { ok: false, code: 'MCP_AUTH_DENIED', httpStatus: 401, message: 'Autenticazione al servizio dati rete non valida o scaduta.' };
    }
    if (reasonCode === 'RATE_LIMITED') {
      return { ok: false, code: 'MCP_RATE_LIMITED', httpStatus: 429, message: 'Troppe richieste al servizio dati rete. Riprova tra poco.' };
    }
    // Any other tool-level error (NOT_FOUND, INVALID_UUID, etc.) - the
    // reason_code is safe to pass through, it is one of a small fixed
    // vocabulary the MCP server itself defines and never includes SQL,
    // stack traces, or internal paths.
    return { ok: false, code: typeof reasonCode === 'string' ? reasonCode : 'MCP_TOOL_ERROR', httpStatus: 422, message: 'Il servizio dati rete ha rifiutato la richiesta.' };
  }

  if (!envelope.result || typeof envelope.result !== 'object') {
    return { ok: false, code: 'MCP_INVALID_RESPONSE', httpStatus: 502, message: 'Risposta non valida dal servizio dati rete.' };
  }

  const structuredContent = (envelope.result as Record<string, unknown>).structuredContent;
  if (!structuredContent || typeof structuredContent !== 'object') {
    return { ok: false, code: 'MCP_INVALID_RESPONSE', httpStatus: 502, message: 'Risposta non valida dal servizio dati rete.' };
  }

  return { ok: true, data: structuredContent as Record<string, unknown> };
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: unknown;
  result: unknown;
}
interface JsonRpcError {
  jsonrpc: '2.0';
  id: unknown;
  error: { code: number; message: string; data?: { reason_code?: string } };
}
type JsonRpcEnvelope = JsonRpcSuccess | JsonRpcError;

function isJsonRpcEnvelope(value: unknown): value is JsonRpcEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.jsonrpc !== '2.0') return false;
  return 'result' in v || 'error' in v;
}
