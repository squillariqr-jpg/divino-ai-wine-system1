/**
 * Real, authoritative product-catalog lookup for Rete Squillari shortage
 * ingestion. Queries the WBOS product master (public.products,
 * Supabase project yoofyenaeauelczskbpu, table core/products.sql) via its
 * PostgREST REST API - exact match only, never fuzzy, never AI-repaired.
 *
 * Column mapping (from live read-only discovery, not the draft schema file):
 *   product_code -> products.internal_code_clean (NEVER internal_code
 *     itself, which carries a stray ".0" suffix from a float-typed import)
 *   description  -> products.name
 *   active       -> products.active (boolean)
 *   ean          -> products.ean (nullable on many real rows - EAN
 *     compatibility is only checked when the catalog actually has one)
 *
 * "Do not fuzzy-match product codes" - the catalog exposes a couple of
 * approximate-matching RPC endpoints, and this module deliberately calls
 * neither of them; only a plain equality filter on the REST endpoint below
 * is the only lookup this module ever performs.
 */

export type CatalogLookupOutcome =
  | 'MATCH'
  | 'UNKNOWN_CODE'
  | 'AMBIGUOUS_CODE'
  | 'INACTIVE_PRODUCT'
  | 'EAN_CONFLICT'
  | 'DESCRIPTION_CONFLICT'
  | 'CATALOG_UNAVAILABLE';

export interface CatalogLookupResult {
  outcome: CatalogLookupOutcome;
  matchedCode: string | null;
  matchedDescription: string | null;
  matchedEan: string | null;
  latencyMs: number;
}

const LOOKUP_TIMEOUT_MS = 10_000;

function normalizeCode(code: string): string {
  return code.trim();
}

function normalizeEan(ean: string): string {
  return ean.trim().replace(/^0+(?=\d)/, ''); // tolerate leading-zero padding differences only, never a fuzzy match
}

/**
 * Very loose compatibility check: not fuzzy-matching the CODE (that is
 * never done), just a sanity check that the two descriptions share at
 * least one meaningful word - guards against a code collision pointing at
 * a completely unrelated product. Deliberately permissive (a real
 * catalog's naming conventions won't match a hand-typed email description
 * word-for-word) - this rejects only gross mismatches, not stylistic ones.
 */
function descriptionsReasonablyCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // nothing to compare against is not a conflict
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length >= 4));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length >= 4));
  if (wordsA.size === 0 || wordsB.size === 0) return true;
  for (const w of wordsA) if (wordsB.has(w)) return true;
  return false;
}

function emptyResult(outcome: CatalogLookupOutcome, latencyMs: number): CatalogLookupResult {
  return { outcome, matchedCode: null, matchedDescription: null, matchedEan: null, latencyMs };
}

/**
 * Looks up exactly one product code against the real catalog. Fails closed
 * (CATALOG_UNAVAILABLE) on any network error, timeout, or non-2xx
 * response - never silently treats an unreachable catalog as "no match" or
 * "match". Configuration comes from RETE_CATALOG_SUPABASE_URL /
 * RETE_CATALOG_SUPABASE_KEY (server-side only, never NEXT_PUBLIC_).
 *
 * candidateEan is checked ONLY when the catalog record actually has a
 * non-null ean value - most real rows sampled had ean = null, and a missing
 * catalog EAN is never treated as a conflict.
 */
export async function lookupCatalogProduct(
  code: string,
  candidateDescription: string | null,
  candidateEan: string | null = null
): Promise<CatalogLookupResult> {
  const baseUrl = process.env.RETE_CATALOG_SUPABASE_URL;
  const apiKey = process.env.RETE_CATALOG_SUPABASE_KEY;
  const start = Date.now();

  if (!baseUrl || !apiKey) {
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }

  const normalized = normalizeCode(code);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/rest/v1/products?select=internal_code_clean,name,active,ean&internal_code_clean=eq.${encodeURIComponent(normalized)}`,
      {
        method: 'GET',
        headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      }
    );
  } catch {
    clearTimeout(timer);
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }
  clearTimeout(timer);

  if (!response.ok) {
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }

  if (!Array.isArray(rows)) {
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }

  const latencyMs = Date.now() - start;

  if (rows.length === 0) {
    return emptyResult('UNKNOWN_CODE', latencyMs);
  }
  if (rows.length > 1) {
    return emptyResult('AMBIGUOUS_CODE', latencyMs);
  }

  const row = rows[0] as { internal_code_clean?: unknown; name?: unknown; active?: unknown; ean?: unknown };
  const matchedCode = typeof row.internal_code_clean === 'string' ? row.internal_code_clean : null;
  const matchedDescription = typeof row.name === 'string' ? row.name : null;
  const matchedEan = typeof row.ean === 'string' ? row.ean : null;

  // "the returned code exactly matches the requested code" - defense in
  // depth against a malformed filter ever silently substituting a
  // different row.
  if (matchedCode !== normalized) {
    return emptyResult('CATALOG_UNAVAILABLE', latencyMs);
  }

  if (row.active !== true) {
    return { outcome: 'INACTIVE_PRODUCT', matchedCode, matchedDescription, matchedEan, latencyMs };
  }

  if (candidateEan && matchedEan && normalizeEan(candidateEan) !== normalizeEan(matchedEan)) {
    return { outcome: 'EAN_CONFLICT', matchedCode, matchedDescription, matchedEan, latencyMs };
  }

  if (!descriptionsReasonablyCompatible(candidateDescription, matchedDescription)) {
    return { outcome: 'DESCRIPTION_CONFLICT', matchedCode, matchedDescription, matchedEan, latencyMs };
  }

  return { outcome: 'MATCH', matchedCode, matchedDescription, matchedEan, latencyMs };
}

/**
 * Same exact-match discipline as lookupCatalogProduct, keyed by EAN instead
 * of internal_code_clean - for the excess-stock publication flow, which
 * accepts product code OR EAN as the store's chosen identifier. Never
 * fuzzy, never falls back to a code search.
 */
export async function lookupCatalogProductByEan(ean: string): Promise<CatalogLookupResult> {
  const baseUrl = process.env.RETE_CATALOG_SUPABASE_URL;
  const apiKey = process.env.RETE_CATALOG_SUPABASE_KEY;
  const start = Date.now();

  if (!baseUrl || !apiKey) {
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }

  const normalized = normalizeEan(ean);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/rest/v1/products?select=internal_code_clean,name,active,ean&ean=eq.${encodeURIComponent(normalized)}`,
      {
        method: 'GET',
        headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      }
    );
  } catch {
    clearTimeout(timer);
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }
  clearTimeout(timer);

  if (!response.ok) {
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }

  if (!Array.isArray(rows)) {
    return emptyResult('CATALOG_UNAVAILABLE', Date.now() - start);
  }

  const latencyMs = Date.now() - start;

  if (rows.length === 0) {
    return emptyResult('UNKNOWN_CODE', latencyMs);
  }
  if (rows.length > 1) {
    return emptyResult('AMBIGUOUS_CODE', latencyMs);
  }

  const row = rows[0] as { internal_code_clean?: unknown; name?: unknown; active?: unknown; ean?: unknown };
  const matchedCode = typeof row.internal_code_clean === 'string' ? row.internal_code_clean : null;
  const matchedDescription = typeof row.name === 'string' ? row.name : null;
  const matchedEan = typeof row.ean === 'string' ? row.ean : null;

  if (!matchedEan || normalizeEan(matchedEan) !== normalized) {
    return emptyResult('CATALOG_UNAVAILABLE', latencyMs);
  }

  if (row.active !== true) {
    return { outcome: 'INACTIVE_PRODUCT', matchedCode, matchedDescription, matchedEan, latencyMs };
  }

  return { outcome: 'MATCH', matchedCode, matchedDescription, matchedEan, latencyMs };
}
