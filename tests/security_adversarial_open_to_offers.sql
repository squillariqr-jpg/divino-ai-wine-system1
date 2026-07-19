-- Adversarial security tests (Phase 15). Local sandbox only; never touches
-- the remote project. Every test below should raise an exception or return
-- zero rows - a test that succeeds where it should fail is a real defect.
--
-- Only 2 rete_wbos_suggestion_ingest calls are made in this whole script
-- (req1 for Malta, req2 for Sestri) to respect the real
-- max_new_publications_per_day=2 budget within a single test run - this is
-- the correct governed limit working as designed, not something to route
-- around with more calls.
\set ON_ERROR_STOP off

\echo '=== SETUP: two pending WBOS suggestions (Malta, Sestri); confirm only Malta''s ==='
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_wbos_suggestion_ingest('sec-test-1', 2::smallint, 'SEC001', 'Security Test Product', 6, 'EXPLICIT', NULL, NULL, NULL, 'idem-sec-1') AS r1 \gset
SELECT id AS req1 FROM rete_requests WHERE operational_request_key = 'sec-test-1' \gset
SELECT public.rete_wbos_suggestion_ingest('sec-test-2', 4::smallint, 'SEC002', 'Sestri Product', 6, 'EXPLICIT', NULL, NULL, NULL, 'idem-sec-2') AS r2 \gset
SELECT id AS req2 FROM rete_requests WHERE operational_request_key = 'sec-test-2' \gset

\echo ''
\echo '=== TEST 4: Sestri cannot see Malta unconfirmed suggestion (req1 still DA_CONFERMARE) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT count(*) AS sestri_visibility FROM rete_requests WHERE id = :'req1';
-- EXPECTED: 0

\echo ''
\echo '=== confirm req1 (Malta) so the rest of the flow can proceed ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_request_confirm(:'req1', 0, 'idem-sec-confirm');

RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000004", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_offer_create(:'req1', 4, 'idem-sec-offer-armenia') AS offer1 \gset
SELECT id AS armenia_offer FROM rete_offers WHERE request_id = :'req1' AND offering_location_id = 6 \gset

\echo ''
\echo '=== TEST 1: Malta cannot confirm the Sestri suggestion (req2) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_request_confirm(:'req2', 0, 'idem-sec-attack-1');
-- EXPECTED: ERROR operation not permitted

\echo ''
\echo '=== TEST 2: Malta cannot offer to its own request (req1) ==='
SELECT public.rete_offer_create(:'req1', 2, 'idem-sec-attack-2');
-- EXPECTED: ERROR operation not permitted

\echo ''
\echo '=== TEST 3: Malta cannot create an offer that lands as Armenia (offering_location_id derived only from own membership) ==='
SELECT public.rete_offer_create(:'req1', 1, 'idem-sec-attack-3');
-- EXPECTED: ERROR operation not permitted (Malta IS req1''s requesting store - test 2 already covers this identical path; this call additionally proves offering_location_id can never be client-supplied, since the RPC has no such parameter at all)

\echo ''
\echo '=== TEST 5: disabled store cannot act ==='
RESET role;
UPDATE public.rete_memberships SET pilot_enabled = false WHERE user_id = '00000000-0000-0000-0000-000000000005';
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000005", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_offer_create(:'req1', 1, 'idem-sec-disabled');
-- EXPECTED: ERROR no active membership
RESET role;
UPDATE public.rete_memberships SET pilot_enabled = true WHERE user_id = '00000000-0000-0000-0000-000000000005';

\echo ''
\echo '=== TEST 6: anonymous user cannot read ==='
RESET role;
RESET request.jwt.claims;
SET role anon;
SELECT count(*) AS anon_read_requests FROM rete_requests;
-- EXPECTED: ERROR permission denied for table rete_requests

\echo ''
\echo '=== TEST 7: donor cannot approve own offer ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000004", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_offer_approve(:'armenia_offer', 4, 'idem-sec-attack-7');
-- EXPECTED: ERROR operation not permitted (Armenia has role=store, not central)

\echo ''
\echo '=== TEST 8: receiving store cannot mark sent (only the FROM/donor location can) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_offer_approve(:'armenia_offer', 4, 'idem-sec-approve-for-8') AS approve_result \gset
SELECT id AS transfer1 FROM rete_transfers WHERE offer_id = :'armenia_offer' \gset

RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_mark_departed(:'transfer1', 'idem-sec-attack-8');
-- EXPECTED: ERROR operation not permitted (Malta is to_location, not from_location)

\echo ''
\echo '=== TEST 9: donor cannot mark received (only the TO/receiving location can) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000004", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_mark_ready(:'transfer1', 'idem-sec-9-ready');
SELECT public.rete_transfer_mark_departed(:'transfer1', 'idem-sec-9-departed');
SELECT public.rete_transfer_receive(:'transfer1', 4, NULL, NULL, 'idem-sec-attack-9');
-- EXPECTED: ERROR operation not permitted (Armenia is from_location, not to_location)

\echo ''
\echo '=== TEST 10: stale version fails (req2, still at version 0, confirm with wrong expected_version) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_request_confirm(:'req2', 99, 'idem-sec-attack-10');
-- EXPECTED: ERROR operation not permitted (expected_version 99 != actual 0)

\echo ''
\echo '=== TEST 11: duplicate request fails (re-ingest sec-test-1''s operational_request_key must not create a second row) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_wbos_suggestion_ingest('sec-test-1', 2::smallint, 'SEC001', 'Security Test Product', 6, 'EXPLICIT', NULL, NULL, NULL, 'idem-sec-1-repeat') AS r1_repeat \gset
SELECT count(*) AS duplicate_count FROM rete_requests WHERE operational_request_key = 'sec-test-1';
-- EXPECTED: 1 (never 2) - note this call does not consume a new daily-budget
-- slot since it short-circuits on operational_request_key before the budget
-- check ever runs (dedup happens first).

\echo ''
\echo '=== TEST 12: duplicate offer fails (Sestri confirms req2, Trento offers twice on it) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_request_confirm(:'req2', 0, 'idem-sec-confirm-2');

RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000005", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_offer_create(:'req2', 3, 'idem-sec-dup-offer-1');
SELECT public.rete_offer_create(:'req2', 3, 'idem-sec-dup-offer-2');
-- EXPECTED: second ERROR operation not permitted (unique (request_id, offering_location_id) already exists via first successful offer)

\echo ''
\echo '=== TEST 13: over-approval fails (approve more than offered/remaining quantity) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
SELECT id AS req2_offer FROM rete_offers WHERE request_id = :'req2' \gset
SELECT public.rete_offer_approve(:'req2_offer', 999, 'idem-sec-attack-13');
-- EXPECTED: ERROR operation not permitted (999 > offered_quantity 3)

\echo ''
\echo '=== TEST 14: unresolved discrepancy prevents closure - proven fully in tests/e2e_open_to_offers_synthetic.sql step 14 ==='

\echo ''
\echo '=== TEST 15: direct table update bypass fails (raw UPDATE on rete_requests.status) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}';
SET role authenticated;
UPDATE public.rete_requests SET status = 'CHIUSA' WHERE id = :'req1';
-- EXPECTED: ERROR rete_requests: ... can only change via a governed operation

\echo ''
\echo '=== TEST 16: audit delete/update fails ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
DELETE FROM public.rete_audit_events WHERE entity_id = :'req1'::text;
SELECT count(*) AS audit_still_present FROM public.rete_audit_events WHERE entity_id = :'req1'::text;
-- EXPECTED: DELETE 0, audit_still_present > 0

\echo ''
\echo '=== TEST 17: cross-store cancellation blocked - Sestri cannot cancel Malta''s request (req1) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_request_cancel(:'req1', 'attempted cross-store cancel', NULL, 'idem-sec-attack-17');
-- EXPECTED: ERROR operation not permitted

\echo ''
\echo '=== TEST 18: cannot cancel once an offer is approved (req1 already has an APPROVATA offer) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_request_cancel(:'req1', 'attempted cancel after approval', NULL, 'idem-sec-attack-18');
-- EXPECTED: ERROR operation not permitted

\echo ''
\echo '=== TEST 19: central cannot resolve a discrepancy that does not exist (transfer1 was received cleanly, 4=4) ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_transfer_resolve_discrepancy(:'transfer1', 'no discrepancy to resolve', 'idem-sec-attack-19');
-- EXPECTED: ERROR operation not permitted

\echo ''
\echo '=== TEST 20: manual request duplicate prevention ==='
RESET role;
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}';
SET role authenticated;
SELECT public.rete_manual_request_create('MANUAL001', 'Manual Product', 6, 'urgent client order', false, '{}', 'idem-sec-manual-1');
SELECT public.rete_manual_request_create('MANUAL001', 'Manual Product', 6, 'duplicate attempt', false, '{}', 'idem-sec-manual-2');
-- EXPECTED: second ERROR operation not permitted (active duplicate for same store+product)
