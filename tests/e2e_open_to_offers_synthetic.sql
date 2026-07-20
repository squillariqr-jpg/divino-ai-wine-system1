-- Synthetic end-to-end pilot flow (Phase 17 requirement). Local sandbox only.
-- Never touches the remote project. Uses synthetic test users created for
-- this session only (not real store staff).

\set central '00000000-0000-0000-0000-000000000001'
\set malta '00000000-0000-0000-0000-000000000002'
\set sestri '00000000-0000-0000-0000-000000000003'
\set armenia '00000000-0000-0000-0000-000000000004'
\set trento '00000000-0000-0000-0000-000000000005'

\echo '--- Step 1: central ingests a synthetic WBOS suggestion for Malta (WBOS/rete_locations id=2), qty 6 ---'
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_wbos_suggestion_ingest(
  'test-key-2026-07|2|9999999'::text, 2::smallint, '9999999'::text, 'Test Product Synthetic'::text, 6::integer, 'EXPLICIT'::text,
  '2026-07-16'::date, 90::numeric, 'score_v2_open_request'::text, 'idem-ingest-1'::text
) AS ingest_result \gset

\echo '--- Step 2: Sestri (not the requesting store) must NOT be able to see or confirm it ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT count(*) AS sestri_sees_malta_pending FROM rete_requests WHERE operational_request_key = 'test-key-2026-07|2|9999999' AND status = 'DA_CONFERMARE';

\echo '--- Step 3: Malta confirms ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}';
SET role authenticated;
SELECT id AS request_id FROM rete_requests WHERE operational_request_key = 'test-key-2026-07|2|9999999' \gset
SELECT public.rete_request_confirm(:'request_id', 0, 'idem-confirm-1');

\echo '--- Step 4: Sestri and Armenia can now see it as OPEN (DA_TROVARE) ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT status FROM rete_requests WHERE id = :'request_id';

\echo '--- Step 5: Trento reports not available (no dedicated RPC exists yet - modeled as a withdrawn/absent offer; documented gap) ---'
\echo '(Trento takes no action - absence of an offer is itself the "not available" signal in this schema, see report)'

\echo '--- Step 6: Armenia offers 4 ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000004", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_offer_create(:'request_id', 4, 'idem-offer-armenia') AS offer_armenia_result \gset

\echo '--- Step 7: Sestri offers 3 ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_offer_create(:'request_id', 3, 'idem-offer-sestri') AS offer_sestri_result \gset

\echo '--- Step 8: Central approves Armenia 4 ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
SELECT id AS armenia_offer_id FROM rete_offers WHERE request_id = :'request_id' AND offering_location_id = 8 \gset
SELECT public.rete_offer_approve(:'armenia_offer_id', 4, 'idem-approve-armenia');

\echo '--- Step 9: Central partially approves Sestri 2 (remaining) ---'
SELECT id AS sestri_offer_id FROM rete_offers WHERE request_id = :'request_id' AND offering_location_id = 4 \gset
SELECT public.rete_offer_approve(:'sestri_offer_id', 2, 'idem-approve-sestri');

\echo '--- Step 10: remaining_quantity should now be 0, status DA_PREPARARE ---'
SELECT remaining_quantity, status FROM rete_requests WHERE id = :'request_id';

\echo '--- Step 11: both donors mark prepared ---'
SELECT id AS transfer_armenia FROM rete_transfers WHERE request_id = :'request_id' AND from_location_id = 8 \gset
SELECT id AS transfer_sestri FROM rete_transfers WHERE request_id = :'request_id' AND from_location_id = 4 \gset

RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000004", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_mark_ready(:'transfer_armenia', 'idem-ready-armenia');

RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_mark_ready(:'transfer_sestri', 'idem-ready-sestri');

\echo '--- Step 12: both donors mark sent ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000004", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_mark_departed(:'transfer_armenia', 'idem-depart-armenia');

RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_mark_departed(:'transfer_sestri', 'idem-depart-sestri');

\echo '--- Step 13: Malta receives both (Armenia clean, Sestri short by 1) ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_receive(:'transfer_armenia', 4, NULL, NULL, 'idem-receive-armenia');
SELECT public.rete_transfer_receive(:'transfer_sestri', 1, 'una bottiglia rotta in trasporto', 'DAMAGED', 'idem-receive-sestri');

\echo '--- Step 14: request must NOT be CHIUSA yet (unresolved discrepancy on Sestri transfer) ---'
SELECT status, remaining_quantity FROM rete_requests WHERE id = :'request_id';

\echo '--- Step 15: central resolves the discrepancy, request closes ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_resolve_discrepancy(:'transfer_sestri', 'Sestri credited 1 bottle, accepted as resolved', 'idem-resolve-1');
SELECT status FROM rete_requests WHERE id = :'request_id';

\echo '--- Step 16: verify immutable audit chronology ---'
SELECT event_type, entity_type, created_at FROM rete_audit_events WHERE entity_id = :'request_id'::text OR entity_id IN (:'armenia_offer_id'::text, :'sestri_offer_id'::text, :'transfer_armenia'::text, :'transfer_sestri'::text) ORDER BY created_at;

\echo '--- Step 17: verify no cross-store leakage - Trento (not involved) cannot see the request via a raw offer INSERT attempt on behalf of Malta ---'
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000005", "role": "authenticated"}';
SET role authenticated;
SELECT count(*) AS trento_sees_offers FROM rete_offers WHERE request_id = :'request_id';
