import { NextRequest, NextResponse } from 'next/server';
import { callMcpTool } from '@/lib/rete-squillari/mcp-adapter';
import { validateArray, isRequestRow, isOfferRow, isTransferRow, isLocationRow, type RequestRow, type OfferRow, type TransferRow, type LocationRow } from '@/lib/rete-squillari/mcp-schemas';
import { buildProductCards } from '@/lib/rete-squillari/product-cards';
import { resolveActor, applyRoleFiltering, AuthorizationError, type RequestActor } from '@/lib/rete-squillari/authorize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The browser may only ever request one of these fixed, pre-defined
// application-level actions - never a raw MCP tool name. This is the
// enforcement point for "no generic SQL or generic RPC / no arbitrary
// tool call" required by the security review for this feature.
const ALLOWED_ACTIONS = ['list_missing_products'] as const;
type Action = (typeof ALLOWED_ACTIONS)[number];

function isAllowedAction(v: unknown): v is Action {
  return typeof v === 'string' && (ALLOWED_ACTIONS as readonly string[]).includes(v);
}

// Best-effort, single-instance in-memory rate limit. Vercel serverless
// functions are not guaranteed to share this Map across invocations/
// instances, so this is documented defense-in-depth on top of the MCP
// server's own per-token limiter (120 req/min), not a substitute for a
// durable rate limiter (e.g. Vercel KV) if abuse becomes a real concern.
const RATE_LIMIT_PER_MINUTE = 30;
const rateBuckets = new Map<string, { windowStart: number; count: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    rateBuckets.set(key, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_PER_MINUTE;
}

function errorResponse(code: string, message: string, status: number) {
  // Never include the upstream/raw error text or a stack trace - only the
  // fixed, small vocabulary of reason codes this route itself defines.
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return errorResponse('RATE_LIMITED', 'Troppe richieste. Riprova tra poco.', 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_REQUEST', 'Richiesta non valida.', 400);
  }
  const action = (body as { action?: unknown } | null)?.action;
  if (!isAllowedAction(action)) {
    return errorResponse('ACTION_NOT_ALLOWED', 'Azione non consentita.', 400);
  }

  // Never log the Authorization header value itself - only whether one was
  // present, for diagnostics.
  const authHeader = req.headers.get('authorization');
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  let actor: RequestActor;
  try {
    actor = await resolveActor(accessToken);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return errorResponse(e.code, e.message, e.httpStatus);
    }
    return errorResponse('NOT_AUTHENTICATED', 'Sessione non valida.', 401);
  }

  if (action === 'list_missing_products') {
    return handleListMissingProducts();
  }

  // Unreachable given isAllowedAction, but fail closed explicitly rather
  // than falling through silently.
  return errorResponse('ACTION_NOT_ALLOWED', 'Azione non consentita.', 400);

  async function handleListMissingProducts() {
    const [locationsOutcome, openRequestsOutcome, pendingOutcome] = await Promise.all([
      callMcpTool('rete_list_locations'),
      callMcpTool('rete_list_open_requests', { limit: 100 }),
      callMcpTool('rete_list_pending_confirmations', { limit: 100 }),
    ]);

    for (const outcome of [locationsOutcome, openRequestsOutcome, pendingOutcome]) {
      if (!outcome.ok) {
        return errorResponse(outcome.code, outcome.message, outcome.httpStatus);
      }
    }
    if (!locationsOutcome.ok || !openRequestsOutcome.ok || !pendingOutcome.ok) {
      // Type narrowing guard for TS - unreachable given the loop above.
      return errorResponse('MCP_INVALID_RESPONSE', 'Risposta non valida dal servizio dati rete.', 502);
    }

    const locationRows = validateArray<LocationRow>(locationsOutcome.data, 'locations', isLocationRow);
    const openRequestRows = validateArray<RequestRow>(openRequestsOutcome.data, 'requests', isRequestRow);
    const pendingRequestRows = validateArray<RequestRow>(pendingOutcome.data, 'requests', isRequestRow);
    if (!locationRows || !openRequestRows || !pendingRequestRows) {
      return errorResponse('MCP_SCHEMA_INVALID', 'Formato dati non riconosciuto dal servizio dati rete.', 502);
    }

    const allRequests: RequestRow[] = [...pendingRequestRows, ...openRequestRows];

    // Unfiltered calls return every offer/transfer in one request each
    // (db.py's WHERE clause is TRUE when no filter args are given) - no
    // need for a per-request N+1 call pattern here.
    const [offersOutcome, transfersOutcome] = await Promise.all([
      callMcpTool('rete_list_offers', { limit: 100 }),
      callMcpTool('rete_list_transfers', { limit: 100 }),
    ]);
    let offerRows: OfferRow[] = [];
    let transferRows: TransferRow[] = [];
    if (offersOutcome.ok) {
      const rows = validateArray<OfferRow>(offersOutcome.data, 'offers', isOfferRow);
      if (rows) offerRows = rows;
    }
    if (transfersOutcome.ok) {
      const rows = validateArray<TransferRow>(transfersOutcome.data, 'transfers', isTransferRow);
      if (rows) transferRows = rows;
    }

    const locationsMap = new Map<number, LocationRow>(locationRows.map((l) => [l.id, l]));
    const cards = buildProductCards(allRequests, offerRows, transferRows, locationsMap);
    const filtered = applyRoleFiltering(cards, actor);

    return NextResponse.json({ ok: true, cards: filtered, generatedAt: new Date().toISOString() });
  }
}
