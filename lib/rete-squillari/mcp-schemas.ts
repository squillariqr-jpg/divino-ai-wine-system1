/**
 * Minimal, hand-rolled runtime validators for the shape of each MCP tool's
 * structuredContent. Deliberately not a full schema library - just enough
 * to fail closed (reject) when the upstream response doesn't match what
 * this application expects, rather than passing malformed data through to
 * the view-model layer or the browser.
 */

export interface RequestRow {
  id: string;
  requesting_location_id: number;
  product_code: string;
  product_description: string;
  requested_quantity: number;
  remaining_quantity: number;
  status: string;
  source: string;
  requires_central_confirmation: boolean;
  warning_codes: unknown;
  score: number | null;
  score_version: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  closed_at: string | null;
}

export interface OfferRow {
  id: string;
  request_id: string;
  offering_location_id: number;
  offered_quantity: number;
  approved_quantity: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TransferRow {
  id: string;
  request_id: string;
  offer_id: string | null;
  from_location_id: number;
  to_location_id: number;
  quantity: number;
  status: string;
  prepared_at: string | null;
  departed_at: string | null;
  received_at: string | null;
  received_quantity: number | null;
  discrepancy_type: string | null;
  discrepancy_acknowledged: boolean;
  discrepancy_resolution_note: string | null;
  discrepancy_resolved_at: string | null;
  anomaly_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocationRow {
  id: number;
  code: number;
  name: string;
  active: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}
function isNullableString(v: unknown): v is string | null {
  return v === null || isString(v);
}
function isNullableNumber(v: unknown): v is number | null {
  return v === null || isNumber(v);
}

export function isRequestRow(v: unknown): v is RequestRow {
  if (!isRecord(v)) return false;
  return (
    isString(v.id) &&
    isNumber(v.requesting_location_id) &&
    isString(v.product_code) &&
    isString(v.product_description) &&
    isNumber(v.requested_quantity) &&
    isNumber(v.remaining_quantity) &&
    isString(v.status) &&
    isString(v.source) &&
    isBoolean(v.requires_central_confirmation) &&
    isNullableNumber(v.score) &&
    isString(v.created_at) &&
    isString(v.updated_at) &&
    isNullableString(v.confirmed_at) &&
    isNullableString(v.cancelled_at) &&
    isNullableString(v.closed_at)
  );
}

export function isOfferRow(v: unknown): v is OfferRow {
  if (!isRecord(v)) return false;
  return (
    isString(v.id) &&
    isString(v.request_id) &&
    isNumber(v.offering_location_id) &&
    isNumber(v.offered_quantity) &&
    isNullableNumber(v.approved_quantity) &&
    isString(v.status) &&
    isString(v.created_at) &&
    isString(v.updated_at)
  );
}

export function isTransferRow(v: unknown): v is TransferRow {
  if (!isRecord(v)) return false;
  return (
    isString(v.id) &&
    isString(v.request_id) &&
    (v.offer_id === null || isString(v.offer_id)) &&
    isNumber(v.from_location_id) &&
    isNumber(v.to_location_id) &&
    isNumber(v.quantity) &&
    isString(v.status) &&
    isNullableString(v.prepared_at) &&
    isNullableString(v.departed_at) &&
    isNullableString(v.received_at) &&
    isNullableNumber(v.received_quantity) &&
    isNullableString(v.discrepancy_type) &&
    isBoolean(v.discrepancy_acknowledged) &&
    isString(v.created_at) &&
    isString(v.updated_at)
  );
}

export function isLocationRow(v: unknown): v is LocationRow {
  if (!isRecord(v)) return false;
  return isNumber(v.id) && isNumber(v.code) && isString(v.name) && isBoolean(v.active);
}

export function validateArray<T>(
  value: unknown,
  key: string,
  itemGuard: (v: unknown) => v is T
): T[] | null {
  if (!isRecord(value)) return null;
  const arr = value[key];
  if (!Array.isArray(arr)) return null;
  const out: T[] = [];
  for (const item of arr) {
    if (!itemGuard(item)) return null;
    out.push(item);
  }
  return out;
}
