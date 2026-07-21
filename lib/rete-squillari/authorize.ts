/**
 * Server-side caller identity + role filtering for the "Prodotti mancanti"
 * MCP-backed view. The MCP itself returns broad, network-wide data by
 * design (its RLS is USING (true) for the reader role) - this module is
 * what actually enforces per-role visibility before anything reaches the
 * browser. It must never be skipped in favor of hiding things only in the
 * frontend.
 *
 * Identity is derived the same way the existing governed-backend adapter
 * derives it client-side (rete_memberships, RLS-restricted to the caller's
 * own row) - just executed server-side, using the caller's own Supabase
 * access token so the exact same RLS policy applies.
 */

import { createClient } from '@supabase/supabase-js';
import type { ProductCardViewModel } from './product-cards';

export interface RequestActor {
  userId: string;
  role: 'central' | 'store';
  locationId: number | null;
}

export class AuthorizationError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Resolves the calling user's role/location from their own Supabase access
 * token (sent by the browser as a Bearer token, exactly as it already does
 * for direct Supabase RPC calls in the governed adapter). Never uses a
 * service-role key - this deliberately runs with the same anon-key +
 * user-JWT combination the browser itself would use, so `rete_memberships`
 * RLS ("users read own membership") applies unchanged.
 */
export async function resolveActor(accessToken: string | null): Promise<RequestActor> {
  if (!accessToken) {
    throw new AuthorizationError('NOT_AUTHENTICATED', 'Sessione non valida.', 401);
  }
  const supabaseUrl = process.env.RETE_SQUILLARI_SUPABASE_URL;
  const anonKey = process.env.RETE_SQUILLARI_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new AuthorizationError('SERVER_NOT_CONFIGURED', 'Configurazione server incompleta.', 503);
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await client.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    throw new AuthorizationError('NOT_AUTHENTICATED', 'Sessione scaduta. Accedi di nuovo.', 401);
  }

  const { data: member, error: memberErr } = await client
    .from('rete_memberships')
    .select('role, location_id, active, pilot_enabled, rete_locations(active)')
    .eq('user_id', userData.user.id)
    .single();

  if (memberErr || !member) {
    throw new AuthorizationError('ACCESS_DENIED', 'Profilo non trovato.', 403);
  }
  const loc = (member as { rete_locations?: { active?: boolean } | null }).rete_locations;
  const isValidCentral = member.role === 'central' && !loc;
  const isValidStore = member.role === 'store' && loc && loc.active === true;
  if (!(isValidCentral || isValidStore)) {
    throw new AuthorizationError('ACCESS_DENIED', 'Profilo non valido o disattivato.', 403);
  }
  if (member.pilot_enabled !== true) {
    throw new AuthorizationError('PILOT_NOT_ENABLED', 'Backend governato non attivo per questa identità.', 403);
  }

  return {
    userId: userData.user.id,
    role: member.role as 'central' | 'store',
    locationId: member.location_id ?? null,
  };
}

/**
 * Applies server-side visibility rules. Centrale sees everything unchanged.
 * A store sees full detail on its own requests, and general "can I help"
 * information on other stores' requests (product/quantity/status/offer
 * counts) - but transfer status, receipt discrepancy detail, and the
 * buyer-level shortage classification are restricted to centrale and to
 * the store's own requests. This must run on every response; there is no
 * code path that returns MCP data to the browser without going through
 * this function first.
 */
export function applyRoleFiltering(
  cards: ProductCardViewModel[],
  actor: RequestActor
): ProductCardViewModel[] {
  if (actor.role === 'central') return cards;

  return cards.map((card) => {
    const isOwn = actor.locationId != null && card.requestingLocationId === actor.locationId;
    if (isOwn) return card;
    return {
      ...card,
      transferStatus: null,
      receiptDiscrepancy: null,
      classification: 'TRANSFER_CANDIDATE',
    };
  });
}
