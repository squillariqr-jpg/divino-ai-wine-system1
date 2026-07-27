import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { lookupCatalogProduct, lookupCatalogProductByEan } from '@/lib/rete-squillari/product-catalog';

// Server-side only: the WBOS catalog (a separate Supabase project) is never
// reachable from the browser, and its credentials are never NEXT_PUBLIC_.
// This route is the sole bridge - it performs the exact catalog lookup and
// returns a verified {catalogProductId, productCode, productDescription,
// ean} triple. The excess-stock creation RPC trusts that triple as already
// verified; it does not (and structurally cannot) re-check the catalog
// itself. No excess-stock row is ever created by this route - read-only.

export async function POST(req: Request) {
  let body: { productCode?: string; ean?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ outcome: 'INVALID_REQUEST' }, { status: 400 });
  }

  const productCode = typeof body.productCode === 'string' ? body.productCode.trim() : '';
  const ean = typeof body.ean === 'string' ? body.ean.trim() : '';
  if (!productCode && !ean) {
    return NextResponse.json({ outcome: 'MISSING_IDENTIFIER' }, { status: 400 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!token) {
    return NextResponse.json({ outcome: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const reteUrl = process.env.RETE_SQUILLARI_SUPABASE_URL;
  const reteAnonKey = process.env.RETE_SQUILLARI_SUPABASE_ANON_KEY;
  if (!reteUrl || !reteAnonKey) {
    return NextResponse.json({ outcome: 'SERVER_MISCONFIGURED' }, { status: 500 });
  }

  // Scoped to the caller's own token - reads only what "users read own
  // membership" RLS already permits, no service-role key involved.
  const userClient = createClient(reteUrl, reteAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ outcome: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { data: membership, error: memErr } = await userClient
    .from('rete_memberships')
    .select('role, active, pilot_enabled, location_id')
    .eq('user_id', userData.user.id)
    .single();

  if (memErr || !membership || membership.role !== 'store' || !membership.active || membership.pilot_enabled !== true) {
    return NextResponse.json({ outcome: 'FORBIDDEN' }, { status: 403 });
  }

  const result = productCode
    ? await lookupCatalogProduct(productCode, null, ean || null)
    : await lookupCatalogProductByEan(ean);

  switch (result.outcome) {
    case 'MATCH':
      return NextResponse.json({
        outcome: 'MATCH',
        catalogProductId: result.matchedCode,
        productCode: result.matchedCode,
        productDescription: result.matchedDescription,
        ean: result.matchedEan,
        catalogMatchMethod: productCode ? 'PRODUCT_CODE' : 'EAN',
      });
    case 'UNKNOWN_CODE':
      return NextResponse.json({ outcome: 'PRODUCT_NOT_FOUND' });
    case 'AMBIGUOUS_CODE':
      return NextResponse.json({ outcome: 'AMBIGUOUS_PRODUCT_MATCH' });
    case 'INACTIVE_PRODUCT':
      return NextResponse.json({ outcome: 'PRODUCT_NOT_FOUND' }); // an inactive catalog product is not publishable - same closed outcome, no extra detail leaked
    case 'EAN_CONFLICT':
    case 'DESCRIPTION_CONFLICT':
      return NextResponse.json({ outcome: 'AMBIGUOUS_PRODUCT_MATCH' });
    case 'CATALOG_UNAVAILABLE':
    default:
      return NextResponse.json({ outcome: 'CATALOG_UNAVAILABLE' }, { status: 503 });
  }
}
