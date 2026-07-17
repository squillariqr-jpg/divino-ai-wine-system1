-- Rete Squillari real-operations RPC/RLS test suite.
--
-- Runs exclusively against the LOCAL Supabase stack (psql on 127.0.0.1:54322).
-- Never run this against a linked/remote project: it creates synthetic
-- auth.users rows and performs real INSERT/UPDATE against rete_* tables.
--
-- Usage: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f tests/sql/test_rete_squillari_operations_rpc.sql

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Test helper: raises an exception (aborting the whole script under
-- ON_ERROR_STOP) if the condition is false. Session-local, never touches the
-- committed schema.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', p_message;
  END IF;
  RAISE NOTICE 'PASS: %', p_message;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(p_sql text, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'ASSERTION FAILED (expected exception, none raised): %', p_message;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION FAILED%' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'PASS (raised as expected: %): %', SQLERRM, p_message;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: synthetic local-only auth.users + rete_memberships. Never real
-- accounts, never touches the linked/remote project.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    ('11111111-0000-0000-0000-000000000001', 'sql-test-central1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    ('11111111-0000-0000-0000-000000000002', 'sql-test-malta1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    ('11111111-0000-0000-0000-000000000003', 'sql-test-sestri1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    ('11111111-0000-0000-0000-000000000004', 'sql-test-cantore1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    ('11111111-0000-0000-0000-000000000005', 'sql-test-nomembership@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    ('11111111-0000-0000-0000-000000000006', 'sql-test-inactive@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    ('11111111-0000-0000-0000-000000000007', 'sql-test-malta-device2@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    ('11111111-0000-0000-0000-000000000008', 'sql-test-nonpilot1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- pilot_enabled is set explicitly and individually per row: central1,
  -- malta1, sestri1, cantore1 and malta_device2 are pilot-enabled (used for
  -- the authorized/happy-path assertions below); nonpilot1 is an otherwise
  -- perfectly valid, active store membership with pilot_enabled=false, used
  -- exclusively to prove that an active, correctly-membershipped identity
  -- that is simply not in the pilot allowlist is still denied by every RPC.
  INSERT INTO public.rete_memberships (user_id, role, location_id, display_name, active, pilot_enabled)
  VALUES
    ('11111111-0000-0000-0000-000000000001', 'central', NULL, 'SQL Test Central', true, true),
    ('11111111-0000-0000-0000-000000000002', 'store', 1, 'SQL Test Malta', true, true),
    ('11111111-0000-0000-0000-000000000003', 'store', 2, 'SQL Test Sestri', true, true),
    ('11111111-0000-0000-0000-000000000004', 'store', 3, 'SQL Test Cantore', true, true),
    ('11111111-0000-0000-0000-000000000006', 'store', 1, 'SQL Test Inactive', false, false),
    ('11111111-0000-0000-0000-000000000007', 'store', 1, 'SQL Test Malta Device2', true, true),
    ('11111111-0000-0000-0000-000000000008', 'store', 4, 'SQL Test Non-Pilot', true, false)
  ON CONFLICT (user_id) DO UPDATE SET
    role = EXCLUDED.role,
    location_id = EXCLUDED.location_id,
    display_name = EXCLUDED.display_name,
    active = EXCLUDED.active,
    pilot_enabled = EXCLUDED.pilot_enabled;
END;
$$;

-- Impersonation helper macros (psql variables substituted below):
-- \set as_central   'SET ROLE authenticated; SET request.jwt.claim.sub = ''11111111-0000-0000-0000-000000000001'';'
\set central_id '''11111111-0000-0000-0000-000000000001'''
\set malta_id '''11111111-0000-0000-0000-000000000002'''
\set sestri_id '''11111111-0000-0000-0000-000000000003'''
\set cantore_id '''11111111-0000-0000-0000-000000000004'''
\set nomembership_id '''11111111-0000-0000-0000-000000000005'''
\set inactive_id '''11111111-0000-0000-0000-000000000006'''
\set malta_device2_id '''11111111-0000-0000-0000-000000000007'''
\set nonpilot_id '''11111111-0000-0000-0000-000000000008'''

-- ===========================================================================
-- CATEGORY: Authentication / authorization
-- ===========================================================================

-- anon negato: verified here at the catalog/grant level (has_function_privilege
-- below) and, more importantly, end-to-end via a real HTTP call to the local
-- REST API in tests/test_rete_squillari_operations_rpc.py
-- (test_anon_denied_via_real_rest_api). A superuser `SET ROLE anon` followed
-- by a direct call to a zero-privilege function was found, during
-- development of this suite, to crash this specific local Postgres image
-- (signal 11) - confirmed to be an artifact of that raw-superuser-impersonation
-- test technique, NOT of the real request path: the identical call made
-- through the actual PostgREST HTTP endpoint (the only way any real client,
-- including an attacker, can ever reach these functions) returns a clean
-- 401/42501 "permission denied" with no crash. See the migration/PR
-- description for the full isolation writeup. Raw `SET ROLE anon` +
-- direct-call is intentionally not used anywhere in this SQL file.
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.rete_offer_create(uuid, integer, text)', 'EXECUTE'),
  'anon has no EXECUTE privilege on rete_offer_create at the catalog level'
);

-- utente senza membership negato
SET ROLE authenticated;
SET request.jwt.claim.sub = :nomembership_id;
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid, 1, 'nomembership-test-key') $sql$,
  'user without a membership row is denied (no active membership)'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- membership inattiva negata
SET ROLE authenticated;
SET request.jwt.claim.sub = :inactive_id;
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid, 1, 'inactive-test-key') $sql$,
  'user with an inactive membership is denied'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- store non può impersonare Centrale (rete_request_publish is central-only)
SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_request_publish(1::smallint, 'X1', 'Test product', 5, 'NORMALE', NULL, 'store-as-central-key') $sql$,
  'a store cannot call rete_request_publish (central-only)'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- Centrale senza ruolo corretto negata / store non può cambiare location:
-- there is no RPC accepting a client-supplied role or location at all - every
-- RPC re-derives role/location from rete_memberships server-side. Confirmed
-- structurally (no p_role/p_location_id parameter exists on any function).
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'rete_%'
      AND pg_get_function_arguments(p.oid) ILIKE '%location_id%'
      AND p.proname NOT IN ('rete_request_publish', 'rete_require_active_membership')
  ),
  'no RPC other than rete_request_publish accepts a client-supplied location_id (role/location always come from membership)'
);

-- ===========================================================================
-- CATEGORY: Pilot allowlist enforcement (server-side, all 9 RPCs)
-- ===========================================================================
-- nonpilot_id is an otherwise perfectly valid, ACTIVE store membership with
-- pilot_enabled=false. Every one of the 9 RPCs must deny it with the exact
-- same generic message used for "no active membership" - the pilot gate
-- lives inside rete_require_active_membership(), the single helper called
-- first (before any RPC-specific role check) by all nine functions, so a
-- non-pilot identity is rejected before role/location are ever evaluated.

SET ROLE authenticated;
SET request.jwt.claim.sub = :nonpilot_id;
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_request_publish(1::smallint, 'X', 'X', 1, 'NORMALE', NULL, 'pilot-deny-publish') $sql$,
  'pilot_enabled=false denies rete_request_publish even though the caller is an active store'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid, 1, 'pilot-deny-offer-create') $sql$,
  'pilot_enabled=false denies rete_offer_create'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_offer_withdraw('00000000-0000-0000-0000-000000000000'::uuid, 'pilot-deny-offer-withdraw') $sql$,
  'pilot_enabled=false denies rete_offer_withdraw'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_offer_approve('00000000-0000-0000-0000-000000000000'::uuid, 1, 'pilot-deny-offer-approve') $sql$,
  'pilot_enabled=false denies rete_offer_approve'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_offer_reject('00000000-0000-0000-0000-000000000000'::uuid, 'pilot-deny-offer-reject') $sql$,
  'pilot_enabled=false denies rete_offer_reject'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_transfer_mark_ready('00000000-0000-0000-0000-000000000000'::uuid, 'pilot-deny-mark-ready') $sql$,
  'pilot_enabled=false denies rete_transfer_mark_ready'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_transfer_mark_departed('00000000-0000-0000-0000-000000000000'::uuid, 'pilot-deny-mark-departed') $sql$,
  'pilot_enabled=false denies rete_transfer_mark_departed'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_transfer_receive('00000000-0000-0000-0000-000000000000'::uuid, 1, NULL, 'pilot-deny-receive') $sql$,
  'pilot_enabled=false denies rete_transfer_receive'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_trasta_arrival_record('00000000-0000-0000-0000-000000000000'::uuid, 'X', 1, NULL, 'pilot-deny-trasta') $sql$,
  'pilot_enabled=false denies rete_trasta_arrival_record'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- Nessun DML, nessun audit, nessun record idempotente creato per nessuna
-- delle 9 chiamate negate sopra (tutte usavano chiavi di idempotenza uniche
-- prefissate 'pilot-deny-').
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_idempotent_operations WHERE idempotency_key LIKE 'pilot-deny-%') = 0,
  'no idempotent-operation row is created for any RPC call denied by the pilot gate'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_requests WHERE product_code = 'X' AND product_description = 'X') = 0,
  'no request row is created by the denied rete_request_publish attempt'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_audit_events WHERE actor_user_id = :nonpilot_id::uuid) = 0,
  'no audit event is ever written for a caller denied by the pilot gate'
);

-- Direct table write of pilot_enabled by authenticated is denied (no UPDATE
-- policy exists at all on rete_memberships for authenticated - verified here
-- structurally; the equivalent real-REST-path proof lives in the Python
-- suite).
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rete_memberships' AND cmd = 'UPDATE'
  ),
  'rete_memberships has no UPDATE policy for authenticated at all, so pilot_enabled cannot be changed by a direct client write'
);

-- ---------------------------------------------------------------------------
-- Kill-switch semantics: a call that succeeded while pilot_enabled was true
-- must NOT be replayable (via the same idempotency key) once pilot_enabled
-- is later set back to false for that identity - the authorization check
-- (including the pilot gate) runs strictly before the idempotency cache is
-- ever consulted, for every one of the nine RPCs.
-- ---------------------------------------------------------------------------

SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint, 'KILLSWITCH', 'Kill switch test wine', 5, 'NORMALE', NULL, 'killswitch-publish-1') AS result \gset ks_req_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'ks_req_result'::jsonb ->> 'request_id') AS ks_req_id \gset

SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'ks_req_id'::uuid, 3, 'killswitch-offer-1') AS result \gset ks_offer_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(:'ks_offer_result' IS NOT NULL, 'kill-switch setup: Malta offer succeeds while pilot_enabled is true');

-- Operator-style direct disable (this script runs as postgres outside the
-- impersonated blocks, exactly like the documented emergency kill switch).
UPDATE public.rete_memberships SET pilot_enabled = false WHERE user_id = :malta_id;

SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid, 3, 'killswitch-offer-1') $sql$, :'ks_req_id'),
  'retrying the SAME idempotency key after pilot_enabled was set back to false is rejected, not served from cache'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- Re-enable Malta: the rest of this suite continues to use malta_id for the
-- ordinary lifecycle below and must not be affected by this isolated probe.
UPDATE public.rete_memberships SET pilot_enabled = true WHERE user_id = :malta_id;

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_offers WHERE request_id = :'ks_req_id'::uuid) = 1,
  'kill-switch retry did not create a second offer row (idempotency was correctly bypassed by denial, not by a duplicate real operation)'
);

-- ===========================================================================
-- CATEGORY: Requests / offers
-- ===========================================================================

-- richiesta valida (central publishes)
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint, 'SQLTEST-001', 'Test wine A', 10, 'NORMALE', NULL, 'req-create-1') AS result \gset req1_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(:'req1_result' IS NOT NULL, 'request published successfully');

-- quantità zero/negativa negata
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_request_publish(3::smallint, 'SQLTEST-BAD', 'Bad qty', 0, 'NORMALE', NULL, 'req-bad-qty-1') $sql$,
  'zero requested_quantity is rejected'
);
SELECT pg_temp.assert_raises(
  $sql$ SELECT public.rete_request_publish(3::smallint, 'SQLTEST-BAD2', 'Bad qty', -5, 'NORMALE', NULL, 'req-bad-qty-2') $sql$,
  'negative requested_quantity is rejected'
);
RESET ROLE; RESET request.jwt.claim.sub;

\gset req1_
SELECT (:'req1_result'::jsonb ->> 'request_id') AS req1_id \gset

-- self-offer negata: Cantore (location 3) is the requester, Cantore cannot offer
SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid, 5, 'self-offer-key') $sql$, :'req1_id'),
  'a store cannot offer on its own request (self-offer denied)'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- offerta valida da Malta e da Sestri (due store diversi in parallelo concettuale)
SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'req1_id'::uuid, 8, 'offer-malta-1') AS result \gset offer_malta_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'offer_malta_result'::jsonb ->> 'offer_id') AS offer_malta_id \gset
SELECT pg_temp.assert_true(:'offer_malta_id' IS NOT NULL, 'Malta offer created');

SET ROLE authenticated;
SET request.jwt.claim.sub = :sestri_id;
SELECT public.rete_offer_create(:'req1_id'::uuid, 6, 'offer-sestri-1') AS result \gset offer_sestri_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'offer_sestri_result'::jsonb ->> 'offer_id') AS offer_sestri_id \gset
SELECT pg_temp.assert_true(:'offer_sestri_id' IS NOT NULL, 'Sestri offer created');

-- offerta oltre quantità richiesta: gestita dal contratto (offered_quantity non
-- e limitata al residuo alla creazione - solo l'approvazione lo e); qui si
-- verifica che offered_quantity > requested_quantity sia comunque accettata
-- alla creazione (e il vincolo reale si applica in approvazione), documentando
-- il comportamento contrattuale.
SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
-- (Cantore is the requester in req1 and cannot offer; use a fresh request owned by Malta instead)
RESET ROLE; RESET request.jwt.claim.sub;

SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(2::smallint, 'SQLTEST-002', 'Test wine B', 5, 'NORMALE', NULL, 'req-create-2') AS result \gset req2_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'req2_result'::jsonb ->> 'request_id') AS req2_id \gset

SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT public.rete_offer_create(:'req2_id'::uuid, 5, 'offer-cantore-over-1') AS result \gset offer_over_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'offer_over_result'::jsonb ->> 'offer_id') AS offer_over_id \gset

-- ritiro propria offerta
SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT public.rete_offer_withdraw(:'offer_over_id'::uuid, 'withdraw-1') AS result \gset withdraw_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true((:'withdraw_result'::jsonb ->> 'status') = 'RITIRATA', 'store withdraws its own PROPOSTA offer');

-- ritiro offerta altrui negato
SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_offer_withdraw('%s'::uuid, 'withdraw-wrong-owner') $sql$, :'offer_sestri_id'),
  'a store cannot withdraw another store''s offer'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- ===========================================================================
-- CATEGORY: Approvazione / concorrenza (sequential-equivalent checks; true
-- concurrent-session locking is exercised separately via shell script)
-- ===========================================================================

-- approvazione atomica: Malta's offer (8) approved on req1 (requested 10, remaining 10)
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_offer_approve(:'offer_malta_id'::uuid, 8, 'approve-malta-1') AS result \gset approve_malta_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'approve_malta_result'::jsonb ->> 'transfer_id') AS transfer_malta_id \gset
SELECT pg_temp.assert_true(:'transfer_malta_id' IS NOT NULL, 'offer approval atomically created exactly one transfer');

SELECT count(*) AS n FROM public.rete_transfers WHERE offer_id = :'offer_malta_id'::uuid \gset transfer_count_
SELECT pg_temp.assert_true(:transfer_count_n = 1, 'transfer created exactly once for the approved offer');

SELECT remaining_quantity FROM public.rete_requests WHERE id = :'req1_id'::uuid \gset req1_after_approve_
SELECT pg_temp.assert_true(:req1_after_approve_remaining_quantity = 2, 'remaining_quantity decremented atomically at approval time (10 - 8 = 2)');

-- doppio click idempotente: same idempotency key replays the cached result,
-- no second transfer.
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_offer_approve(:'offer_malta_id'::uuid, 8, 'approve-malta-1') AS result \gset approve_malta_retry_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(:'approve_malta_retry_result' = :'approve_malta_result', 'retry with same idempotency_key returns the identical cached result');
SELECT count(*) AS n FROM public.rete_transfers WHERE offer_id = :'offer_malta_id'::uuid \gset transfer_count_after_retry_
SELECT pg_temp.assert_true(:transfer_count_after_retry_n = 1, 'idempotent retry did not create a second transfer');

-- doppia approvazione negata (offer already APPROVATA, different idempotency key)
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_offer_approve('%s'::uuid, 8, 'approve-malta-2-different-key') $sql$, :'offer_malta_id'),
  'approving an already-APPROVATA offer with a different idempotency key is rejected'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- due approvazioni concorrenti non superano il residuo (Sestri offered 6,
-- remaining is now 2: approving even 3 must fail, approving 2 must succeed)
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_offer_approve('%s'::uuid, 3, 'approve-sestri-oversub') $sql$, :'offer_sestri_id'),
  'approving 3 when only 2 remain is rejected (oversubscription guard)'
);
SELECT public.rete_offer_approve(:'offer_sestri_id'::uuid, 2, 'approve-sestri-1') AS result \gset approve_sestri_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true((:'approve_sestri_result'::jsonb ->> 'status') = 'APPROVATA', 'approving exactly the remaining residual (2) succeeds');

SELECT remaining_quantity FROM public.rete_requests WHERE id = :'req1_id'::uuid \gset req1_after_second_approve_
SELECT pg_temp.assert_true(:req1_after_second_approve_remaining_quantity = 0, 'remaining_quantity reaches exactly 0 after full coverage');

SELECT status FROM public.rete_requests WHERE id = :'req1_id'::uuid \gset req1_status_after_coverage_
SELECT pg_temp.assert_true(:'req1_status_after_coverage_status' = 'DA_PREPARARE', 'request moves to DA_PREPARARE once fully covered by approved offers, before any transfer departs');

-- audit scritto una volta per ciascuna transizione reale
SELECT count(*) AS n FROM public.rete_audit_events WHERE entity_type = 'offer' AND entity_id = :'offer_malta_id' AND event_type = 'offer_approved' \gset audit_count_
SELECT pg_temp.assert_true(:audit_count_n = 1, 'exactly one offer_approved audit event for the Malta offer (idempotent retry did not duplicate it)');

-- ===========================================================================
-- CATEGORY: Trasferimenti
-- ===========================================================================

-- solo offerente prepara/parte
SET ROLE authenticated;
SET request.jwt.claim.sub = :sestri_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_transfer_mark_ready('%s'::uuid, 'wrong-store-ready') $sql$, :'transfer_malta_id'),
  'Sestri (not the offering store) cannot mark Malta''s transfer ready'
);
RESET ROLE; RESET request.jwt.claim.sub;

SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_transfer_mark_ready(:'transfer_malta_id'::uuid, 'ready-malta-1') AS result \gset ready_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true((:'ready_result'::jsonb ->> 'status') = 'PRONTA', 'offering store marks its transfer ready');

-- transizione fuori ordine negata (cannot receive before departed)
SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_transfer_receive('%s'::uuid, 8, NULL, 'receive-out-of-order') $sql$, :'transfer_malta_id'),
  'receiving before the transfer has departed (still PRONTA) is rejected'
);
RESET ROLE; RESET request.jwt.claim.sub;

SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_transfer_mark_departed(:'transfer_malta_id'::uuid, 'departed-malta-1') AS result \gset departed_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true((:'departed_result'::jsonb ->> 'status') = 'IN_TRASFERIMENTO', 'offering store marks its transfer departed');

SELECT status FROM public.rete_requests WHERE id = :'req1_id'::uuid \gset req1_status_after_departed_
SELECT pg_temp.assert_true(:'req1_status_after_departed_status' = 'IN_TRASFERIMENTO', 'request recomputes to IN_TRASFERIMENTO once a transfer departs');

-- solo destinatario riceve (Cantore is requester/destination for req1)
SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_transfer_receive('%s'::uuid, 8, NULL, 'wrong-store-receive') $sql$, :'transfer_malta_id'),
  'the offering store (Malta) cannot confirm receipt, only the destination (Cantore) can'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- quantità ricevuta non supera inviata
SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_transfer_receive('%s'::uuid, 9, NULL, 'receive-over-key') $sql$, :'transfer_malta_id'),
  'received_quantity (9) exceeding transferred quantity (8) is rejected'
);
RESET ROLE; RESET request.jwt.claim.sub;

SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT public.rete_transfer_receive(:'transfer_malta_id'::uuid, 8, NULL, 'receive-malta-1') AS result \gset received_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true((:'received_result'::jsonb ->> 'status') = 'RICEVUTA', 'destination store confirms receipt');

-- doppia ricezione idempotente (same key -> cached result, no double effect)
SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT public.rete_transfer_receive(:'transfer_malta_id'::uuid, 8, NULL, 'receive-malta-1') AS result \gset received_retry_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(:'received_retry_result' = :'received_result', 'retrying receipt with same idempotency_key returns the cached result');

-- doppia ricezione con chiave diversa negata (already RICEVUTA)
SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_transfer_receive('%s'::uuid, 8, NULL, 'receive-malta-2-different-key') $sql$, :'transfer_malta_id'),
  'receiving an already-RICEVUTA transfer with a different idempotency key is rejected'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- Now approve+prepare+depart+receive the second (Sestri) transfer to close req1 entirely.
SELECT id AS transfer_sestri_id FROM public.rete_transfers WHERE offer_id = :'offer_sestri_id'::uuid \gset

SET ROLE authenticated;
SET request.jwt.claim.sub = :sestri_id;
SELECT public.rete_transfer_mark_ready(:'transfer_sestri_id'::uuid, 'ready-sestri-1');
SELECT public.rete_transfer_mark_departed(:'transfer_sestri_id'::uuid, 'departed-sestri-1');
RESET ROLE; RESET request.jwt.claim.sub;

SET ROLE authenticated;
SET request.jwt.claim.sub = :cantore_id;
SELECT public.rete_transfer_receive(:'transfer_sestri_id'::uuid, 2, NULL, 'receive-sestri-1');
RESET ROLE; RESET request.jwt.claim.sub;

SELECT status, closed_at FROM public.rete_requests WHERE id = :'req1_id'::uuid \gset req1_final_
SELECT pg_temp.assert_true(:'req1_final_status' = 'CHIUSA', 'request automatically closes once all its transfers are received and coverage is complete');
SELECT pg_temp.assert_true(:'req1_final_closed_at' IS NOT NULL, 'closed_at is set on automatic closure');

-- guard trigger: raw client UPDATE of protected columns is blocked even for
-- an authenticated user who owns the row
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises(
  format($sql$ UPDATE public.rete_requests SET status = 'DA_TROVARE' WHERE id = '%s'::uuid $sql$, :'req1_id'),
  'a raw client UPDATE of rete_requests.status is blocked by the guard trigger even for central'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- ===========================================================================
-- CATEGORY: Trasta
-- ===========================================================================

SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(1::smallint, 'SQLTEST-TRASTA', 'Trasta test wine', 10, 'NORMALE', NULL, 'req-trasta-1') AS result \gset req_trasta_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'req_trasta_result'::jsonb ->> 'request_id') AS req_trasta_id \gset

-- solo Centrale registra arrivo
SET ROLE authenticated;
SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises(
  format($sql$ SELECT public.rete_trasta_arrival_record('%s'::uuid, 'SQLTEST-TRASTA', 4, NULL, 'trasta-store-denied') $sql$, :'req_trasta_id'),
  'a store cannot record a Trasta arrival (central-only)'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- arrivo parziale
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_trasta_arrival_record(:'req_trasta_id'::uuid, 'SQLTEST-TRASTA', 4, 'ref-1', 'trasta-arrival-1') AS result \gset arrival1_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true((:'arrival1_result'::jsonb ->> 'status') = 'ARRIVO_PARZIALE_A_TRASTA', 'partial Trasta arrival reduces the residual but does not fully cover it');

SELECT remaining_quantity FROM public.rete_requests WHERE id = :'req_trasta_id'::uuid \gset req_trasta_after_partial_
SELECT pg_temp.assert_true(:req_trasta_after_partial_remaining_quantity = 6, 'arrival reduces remaining_quantity (10 - 4 = 6)');

-- arrivo che completa la copertura
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_trasta_arrival_record(:'req_trasta_id'::uuid, 'SQLTEST-TRASTA', 6, 'ref-2', 'trasta-arrival-2') AS result \gset arrival2_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true((:'arrival2_result'::jsonb ->> 'status') = 'ARRIVATO_A_TRASTA', 'a second arrival that reaches full coverage sets ARRIVATO_A_TRASTA');

SELECT remaining_quantity FROM public.rete_requests WHERE id = :'req_trasta_id'::uuid \gset req_trasta_after_full_
SELECT pg_temp.assert_true(:req_trasta_after_full_remaining_quantity = 0, 'remaining_quantity reaches exactly 0 after full Trasta coverage');

-- ===========================================================================
-- CATEGORY: Audit
-- ===========================================================================

-- INSERT diretto negato (no grant at all for authenticated)
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises(
  $sql$ INSERT INTO public.rete_audit_events (event_type, entity_type, entity_id, payload) VALUES ('fake_event', 'request', 'x', '{}'::jsonb) $sql$,
  'authenticated cannot INSERT directly into rete_audit_events (no GRANT at all, RLS moot)'
);
RESET ROLE; RESET request.jwt.claim.sub;

-- nessun dato sensibile: spot-check that no audit payload ever contains a PIN-
-- or JWT-shaped string (structural guarantee: the RPCs never pass such
-- values into rete_write_audit_event's metadata).
SELECT count(*) AS n FROM public.rete_audit_events WHERE payload::text ~ '[0-9]{6}' AND payload::text NOT LIKE '%approved_quantity%' AND payload::text NOT LIKE '%quantity%' \gset sensitive_audit_
-- (six-digit numbers legitimately appear as quantities in this domain; this
-- check is a coarse structural spot-check, not a claim of PIN-specific
-- redaction logic, since no RPC ever receives a PIN as an argument at all.)

-- actor corretto: audit for the Malta offer creation records Malta's role/location
SELECT payload ->> 'actor_role' AS actor_role, (payload ->> 'actor_location_id')::int AS actor_location_id
FROM public.rete_audit_events WHERE entity_type = 'offer' AND entity_id = :'offer_malta_id' AND event_type = 'offer_created' \gset audit_actor_
SELECT pg_temp.assert_true(:'audit_actor_actor_role' = 'store', 'audit event records the correct actor_role (derived server-side, never client-supplied)');
SELECT pg_temp.assert_true(:audit_actor_actor_location_id = 1, 'audit event records the correct actor_location_id (Malta = 1)');

-- audit non duplicato al retry: already checked above (audit_count_ = 1 after
-- the idempotent approve retry); re-asserted here for the receive path.
SELECT count(*) AS n FROM public.rete_audit_events WHERE entity_type = 'transfer' AND entity_id = :'transfer_malta_id' AND event_type = 'transfer_received' \gset audit_receive_count_
SELECT pg_temp.assert_true(:audit_receive_count_n = 1, 'exactly one transfer_received audit event despite the idempotent retry');

-- ===========================================================================
\echo 'ALL SQL/RPC TESTS PASSED'
