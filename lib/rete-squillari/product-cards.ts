/**
 * Pure, testable transformation layer: raw MCP tool rows -> the product-card
 * view model rendered by the "Prodotti mancanti" UI, plus the read-only
 * shortage classification. No network calls, no Supabase, no MCP token -
 * this module only ever receives already-fetched rows.
 */

import type { LocationRow, OfferRow, RequestRow, TransferRow } from './mcp-schemas';

export const NORMALIZED_STATUSES = [
  'DA_VERIFICARE',
  'DA_TROVARE',
  'DA_CONFERMARE',
  'DA_PREPARARE',
  'IN_TRASFERIMENTO',
  'ARRIVO_PARZIALE',
  'ARRIVATO_A_TRASTA',
  'RICEVUTA',
  'CHIUSA',
] as const;
export type NormalizedStatus = (typeof NORMALIZED_STATUSES)[number];

const UNKNOWN_STATUS = 'STATO_SCONOSCIUTO' as const;

// Only the backend request statuses this application actually maps. Any
// other value (including a genuinely new backend status added later) is
// deliberately NOT coerced into one of these - see mapBackendStatus below.
const BACKEND_STATUS_MAP: Record<string, NormalizedStatus> = {
  DA_CONFERMARE: 'DA_CONFERMARE',
  DA_TROVARE: 'DA_TROVARE',
  DA_PREPARARE: 'DA_PREPARARE',
  IN_TRASFERIMENTO: 'IN_TRASFERIMENTO',
  RICEVUTA: 'RICEVUTA',
  CHIUSA: 'CHIUSA',
};

// ANNULLATA is intentionally excluded from BACKEND_STATUS_MAP: a cancelled
// request is not a "missing product" and must never appear in this view,
// mapped or otherwise.
const EXCLUDED_BACKEND_STATUSES = new Set(['ANNULLATA']);

export interface StatusMapResult {
  normalized: NormalizedStatus | typeof UNKNOWN_STATUS;
  raw: string;
  known: boolean;
}

export function mapBackendStatus(raw: string): StatusMapResult {
  const mapped = BACKEND_STATUS_MAP[raw];
  if (mapped) return { normalized: mapped, raw, known: true };
  // Explicit, visible "unknown" marker - never silently guessed.
  return { normalized: UNKNOWN_STATUS, raw, known: false };
}

export function isExcludedStatus(raw: string): boolean {
  return EXCLUDED_BACKEND_STATUSES.has(raw);
}

export type Classification = 'TRANSFER_CANDIDATE' | 'BUYER_SHORTAGE' | 'HIGH_VOLUME_SHORTAGE';

// Matched by name, not by a hardcoded id/code number - rete_locations.id
// (the foreign key requests actually carry) is not guaranteed to equal
// rete_locations.code, so resolving these four by name against the live
// locations list is the only safe approach.
export const HIGH_VOLUME_LOCATION_NAMES = ['Malta', 'Sestri', 'Cantore', 'De Ferrari'] as const;

function resolveHighVolumeLocationIds(locations: Map<number, LocationRow>): Set<number> {
  const ids = new Set<number>();
  for (const loc of locations.values()) {
    if ((HIGH_VOLUME_LOCATION_NAMES as readonly string[]).includes(loc.name)) {
      ids.add(loc.id);
    }
  }
  return ids;
}

export interface ProductCardViewModel {
  ref: string; // short, non-sensitive reference derived from the request id - never the raw UUID
  productCode: string;
  productDescription: string;
  requestingLocationLabel: string;
  requestingLocationId: number;
  missingQuantity: number;
  requestDate: string;
  status: NormalizedStatus | typeof UNKNOWN_STATUS;
  statusRaw: string;
  offersCount: number;
  offeredQuantity: number;
  approvedQuantity: number;
  transferStatus: NormalizedStatus | typeof UNKNOWN_STATUS | null;
  receiptDiscrepancy: { type: string; acknowledged: boolean } | null;
  classification: Classification;
  lastUpdate: string;
  dataSource: 'MCP_PRODUCTION';
}

function shortRef(uuid: string): string {
  // First 8 hex chars only - stable, unique enough for on-screen display
  // and React/DOM keys, never the full UUID.
  return uuid.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function locationLabel(locations: Map<number, LocationRow>, id: number): string {
  const l = locations.get(id);
  return l ? `${l.code} – ${l.name}` : `Sede #${id}`;
}

/**
 * Builds one card per (still-active) request. Offers/transfers/discrepancy
 * info for that request are folded in. Cancelled requests are dropped
 * entirely (not mapped to a status at all).
 */
export function buildProductCards(
  requests: RequestRow[],
  offers: OfferRow[],
  transfers: TransferRow[],
  locations: Map<number, LocationRow>
): ProductCardViewModel[] {
  const offersByRequest = new Map<string, OfferRow[]>();
  for (const o of offers) {
    const list = offersByRequest.get(o.request_id) || [];
    list.push(o);
    offersByRequest.set(o.request_id, list);
  }
  const transfersByRequest = new Map<string, TransferRow[]>();
  for (const t of transfers) {
    const list = transfersByRequest.get(t.request_id) || [];
    list.push(t);
    transfersByRequest.set(t.request_id, list);
  }

  const cards: ProductCardViewModel[] = [];
  const classifications = classifyShortages(requests, locations);

  for (const r of requests) {
    if (isExcludedStatus(r.status)) continue;
    const statusResult = mapBackendStatus(r.status);
    const reqOffers = offersByRequest.get(r.id) || [];
    const reqTransfers = transfersByRequest.get(r.id) || [];
    const latestTransfer = reqTransfers.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] || null;
    const discrepancyTransfer = reqTransfers.find((t) => t.discrepancy_type) || null;

    cards.push({
      ref: shortRef(r.id),
      productCode: r.product_code,
      productDescription: r.product_description,
      requestingLocationLabel: locationLabel(locations, r.requesting_location_id),
      requestingLocationId: r.requesting_location_id,
      missingQuantity: r.remaining_quantity,
      requestDate: r.created_at,
      status: statusResult.normalized,
      statusRaw: statusResult.raw,
      offersCount: reqOffers.length,
      offeredQuantity: reqOffers.reduce((sum, o) => sum + o.offered_quantity, 0),
      approvedQuantity: reqOffers.reduce((sum, o) => sum + (o.approved_quantity || 0), 0),
      transferStatus: latestTransfer ? mapBackendStatus(latestTransfer.status).normalized : null,
      receiptDiscrepancy: discrepancyTransfer
        ? { type: discrepancyTransfer.discrepancy_type as string, acknowledged: discrepancyTransfer.discrepancy_acknowledged }
        : null,
      classification: classifications.get(r.product_code) || 'TRANSFER_CANDIDATE',
      lastUpdate: r.updated_at,
      dataSource: 'MCP_PRODUCTION',
    });
  }
  return cards;
}

/**
 * Deterministic, read-only classification: for each product_code, counts
 * how many distinct requesting locations currently have an active
 * (non-excluded-status) request open for it.
 *
 *   1-2 stores  -> TRANSFER_CANDIDATE
 *   3+ stores   -> BUYER_SHORTAGE
 *   all 4 high-volume stores (Malta/Sestri/Cantore/De Ferrari) within the
 *   current calendar month -> HIGH_VOLUME_SHORTAGE (takes precedence over
 *   BUYER_SHORTAGE when both conditions hold)
 *
 * This never creates, approves, or mutates anything - it is a pure
 * read-only grouping over already-fetched request rows.
 */
export function classifyShortages(
  requests: RequestRow[],
  locations: Map<number, LocationRow>,
  now: Date = new Date()
): Map<string, Classification> {
  const byProduct = new Map<string, RequestRow[]>();
  for (const r of requests) {
    if (isExcludedStatus(r.status)) continue;
    const list = byProduct.get(r.product_code) || [];
    list.push(r);
    byProduct.set(r.product_code, list);
  }

  const highVolumeIds = resolveHighVolumeLocationIds(locations);
  const result = new Map<string, Classification>();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  for (const [code, group] of byProduct) {
    const distinctLocations = new Set(group.map((r) => r.requesting_location_id));

    const highVolumeThisMonth =
      highVolumeIds.size === HIGH_VOLUME_LOCATION_NAMES.length &&
      [...highVolumeIds].every((locId) =>
        group.some((r) => {
          if (r.requesting_location_id !== locId) return false;
          const created = new Date(r.created_at);
          return created >= monthStart;
        })
      );

    if (highVolumeThisMonth) {
      result.set(code, 'HIGH_VOLUME_SHORTAGE');
    } else if (distinctLocations.size >= 3) {
      result.set(code, 'BUYER_SHORTAGE');
    } else {
      result.set(code, 'TRANSFER_CANDIDATE');
    }
  }
  return result;
}
