-- Rete Squillari — Pilot Server-Side Allowlist Test Suite
--
-- Runs exclusively against the LOCAL Supabase stack (psql on 127.0.0.1:54322).
-- Never run against a linked/remote project.
--
-- Prerequisites: supabase db reset --local, then:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 \
--     -f tests/sql/fixtures_rete_squillari_operations.sql \
--     -f tests/sql/test_rete_squillari_pilot_allowlist.sql

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Test helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', p_message;
  END IF;
  RAISE NOTICE 'PASS: %', p_message;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(p_sql text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'ASSERTION FAILED (expected exception, none raised): %', p_message;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS (raised as expected: %): %', SQLERRM, p_message;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises_matching(p_sql text, p_expected_msg text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_sqlerrm text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'ASSERTION FAILED (expected exception, none raised): %', p_message;
  EXCEPTION WHEN OTHERS THEN
    v_sqlerrm := SQLERRM;
    IF v_sqlerrm LIKE 'ASSERTION FAILED%' THEN RAISE; END IF;
    IF v_sqlerrm NOT LIKE '%' || p_expected_msg || '%' THEN
      RAISE EXCEPTION 'ASSERTION FAILED (wrong message "%" expected substring "%"): %', v_sqlerrm, p_expected_msg, p_message;
    END IF;
    RAISE NOTICE 'PASS (raised "%"): %', v_sqlerrm, p_message;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixture references
-- ---------------------------------------------------------------------------
\set central_id      '''11111111-0000-0000-0000-000000000001'''
\set malta_id        '''11111111-0000-0000-0000-000000000002'''
\set sestri_id       '''11111111-0000-0000-0000-000000000003'''
\set cantore_id      '''11111111-0000-0000-0000-000000000004'''
\set nomembership_id '''11111111-0000-0000-0000-000000000005'''
\set inactive_id     '''11111111-0000-0000-0000-000000000006'''
\set nonpilot_id     '''11111111-0000-0000-0000-000000000008'''

-- ---------------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='rete_memberships'
      AND a.attname='pilot_enabled' AND NOT a.attisdropped
  ),
  'prereq: pilot_enabled column exists on rete_memberships'
);

SELECT pg_temp.assert_true(
  (SELECT provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rete_require_active_membership') = 'v',
  'prereq: rete_require_active_membership is VOLATILE (required for FOR KEY SHARE)'
);

SELECT pg_temp.assert_true(
  (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rete_require_active_membership')
   ILIKE '%FOR KEY SHARE%',
  'prereq: helper body contains FOR KEY SHARE (kill-switch linearization lock)'
);

-- ---------------------------------------------------------------------------
-- 1. PILOT_ENABLED=FALSE DENIES ALL 9 RPCs — with individual side-effect checks
-- ---------------------------------------------------------------------------
\echo '--- SECTION 1: pilot=false denies all 9 RPCs ---'

SET ROLE authenticated;
SET request.jwt.claim.sub = :nonpilot_id;

SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_request_publish(4::smallint,'NP','NP test',1,'NORMALE',NULL,'pd-rp') $sql$,
  'no active membership', '1a rete_request_publish: pilot=false → denied with generic message');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid,1,'pd-oc') $sql$,
  'no active membership', '1b rete_offer_create: pilot=false → denied');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_withdraw('00000000-0000-0000-0000-000000000000'::uuid,'pd-ow') $sql$,
  'no active membership', '1c rete_offer_withdraw: pilot=false → denied');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_approve('00000000-0000-0000-0000-000000000000'::uuid,1,'pd-oa') $sql$,
  'no active membership', '1d rete_offer_approve: pilot=false → denied');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_reject('00000000-0000-0000-0000-000000000000'::uuid,'pd-or') $sql$,
  'no active membership', '1e rete_offer_reject: pilot=false → denied');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_transfer_mark_ready('00000000-0000-0000-0000-000000000000'::uuid,'pd-tmr') $sql$,
  'no active membership', '1f rete_transfer_mark_ready: pilot=false → denied');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_transfer_mark_departed('00000000-0000-0000-0000-000000000000'::uuid,'pd-tmd') $sql$,
  'no active membership', '1g rete_transfer_mark_departed: pilot=false → denied');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_transfer_receive('00000000-0000-0000-0000-000000000000'::uuid,1,NULL,'pd-tr') $sql$,
  'no active membership', '1h rete_transfer_receive: pilot=false → denied');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_trasta_arrival_record('00000000-0000-0000-0000-000000000000'::uuid,'NP',1,NULL,'pd-tar') $sql$,
  'no active membership', '1i rete_trasta_arrival_record: pilot=false → denied');

RESET ROLE; RESET request.jwt.claim.sub;

-- Side-effects: no DML, no audit, no idempotency for any of the 9 denied calls
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_idempotent_operations WHERE idempotency_key LIKE 'pd-%')=0,
  '1-SE: no idempotency row created for any pilot-denied call');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_audit_events WHERE actor_user_id=:nonpilot_id::uuid)=0,
  '1-SE: no audit event created by nonpilot caller');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_requests WHERE created_by=:nonpilot_id::uuid)=0,
  '1-SE: no request row created by denied rete_request_publish');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_offers WHERE offered_by=:nonpilot_id::uuid)=0,
  '1-SE: no offer row created by denied rete_offer_create');

-- ---------------------------------------------------------------------------
-- 2. ROLE / LOCATION COHERENCE (pilot=true, various coherence violations)
-- ---------------------------------------------------------------------------
\echo '--- SECTION 2: role/location coherence ---'

-- Create base resources for coherence tests
SET ROLE authenticated;
SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint,'COHERENCE-TEST','Coherence wine',10,'NORMALE',NULL,'coherence-req-base') AS result \gset coh_req_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'coh_req_result'::jsonb->>'request_id') AS coh_req_id \gset

-- 2a. store → rete_request_publish (central-only)
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_request_publish(1::smallint,'X','X',1,'NORMALE',NULL,'coh-store-as-central') $sql$,
  'operation not permitted','2a pilot=true + store → rete_request_publish → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2b. central → rete_offer_create (store-only)
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,1,'coh-central-as-store') $sql$, :'coh_req_id'),
  'operation not permitted','2b pilot=true + central → rete_offer_create → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2c. store → rete_offer_approve (central-only)
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'coh_req_id'::uuid,5,'coh-malta-offer-1') AS result \gset coh_offer_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'coh_offer_result'::jsonb->>'offer_id') AS coh_offer_id \gset

SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_approve('%s'::uuid,3,'coh-store-approve') $sql$, :'coh_offer_id'),
  'operation not permitted','2c pilot=true + store → rete_offer_approve → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2d. store → rete_offer_reject (central-only)
SET ROLE authenticated; SET request.jwt.claim.sub = :sestri_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_reject('%s'::uuid,'coh-store-reject') $sql$, :'coh_offer_id'),
  'operation not permitted','2d pilot=true + store → rete_offer_reject → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2e. central → rete_transfer_mark_ready/departed (store-only)
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT public.rete_offer_approve(:'coh_offer_id'::uuid,5,'coh-central-approve-1') AS result \gset coh_approve_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'coh_approve_result'::jsonb->>'transfer_id') AS coh_transfer_id \gset

SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_transfer_mark_ready('%s'::uuid,'coh-central-ready') $sql$, :'coh_transfer_id'),
  'operation not permitted','2e pilot=true + central → rete_transfer_mark_ready → operation not permitted');
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_transfer_mark_departed('%s'::uuid,'coh-central-departed') $sql$, :'coh_transfer_id'),
  'operation not permitted','2f pilot=true + central → rete_transfer_mark_departed → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2g. Wrong from-store (Sestri, not Malta) tries to mark Malta's transfer ready
SET ROLE authenticated; SET request.jwt.claim.sub = :sestri_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_transfer_mark_ready('%s'::uuid,'coh-wrong-from-store') $sql$, :'coh_transfer_id'),
  'operation not permitted','2g pilot=true + wrong from-store (location mismatch) → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2h. Self-offer: Cantore (requesting_location_id=3) tries to offer on own request
SET ROLE authenticated; SET request.jwt.claim.sub = :cantore_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,5,'coh-self-offer') $sql$, :'coh_req_id'),
  'operation not permitted','2h pilot=true + self-offer (requester offering on own request) → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2i. store → rete_trasta_arrival_record (central-only)
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_trasta_arrival_record('%s'::uuid,'X',3,NULL,'coh-store-trasta') $sql$, :'coh_req_id'),
  'operation not permitted','2i pilot=true + store → rete_trasta_arrival_record (central-only) → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2j. Wrong destination (Sestri not Cantore) tries to receive Malta→Cantore transfer
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_transfer_mark_ready(:'coh_transfer_id'::uuid,'coh-malta-ready-1');
SELECT public.rete_transfer_mark_departed(:'coh_transfer_id'::uuid,'coh-malta-departed-1');
RESET ROLE; RESET request.jwt.claim.sub;

SET ROLE authenticated; SET request.jwt.claim.sub = :sestri_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_transfer_receive('%s'::uuid,5,NULL,'coh-wrong-dest-receive') $sql$, :'coh_transfer_id'),
  'operation not permitted','2j pilot=true + wrong destination (location mismatch) → rete_transfer_receive → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2k. Out-of-order: central → rete_transfer_receive (store-only) on an IN_TRASFERIMENTO transfer
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_transfer_receive('%s'::uuid,5,NULL,'coh-central-receive') $sql$, :'coh_transfer_id'),
  'operation not permitted','2k pilot=true + central → rete_transfer_receive (store-only) → operation not permitted');
RESET ROLE; RESET request.jwt.claim.sub;

-- Correct receive to complete coherence test cycle
SET ROLE authenticated; SET request.jwt.claim.sub = :cantore_id;
SELECT public.rete_transfer_receive(:'coh_transfer_id'::uuid,5,NULL,'coh-cantore-receive-1');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2l. Missing membership → denied
SET ROLE authenticated; SET request.jwt.claim.sub = :nomembership_id;
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid,1,'coh-no-member') $sql$,
  'no active membership','2l no membership → denied');
RESET ROLE; RESET request.jwt.claim.sub;

-- 2m. Inactive membership → denied
SET ROLE authenticated; SET request.jwt.claim.sub = :inactive_id;
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid,1,'coh-inactive') $sql$,
  'no active membership','2m inactive membership → denied');
RESET ROLE; RESET request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- 3. USER_METADATA SPOOFING
-- ---------------------------------------------------------------------------
\echo '--- SECTION 3: user_metadata spoofing has no effect ---'

INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('11111111-0000-0000-0000-000000000099','sql-test-spoofer@local.invalid',
        'authenticated','authenticated',now(),now(),now(),'{}'::jsonb,
        '{"pilot_enabled":true,"role":"central","location_id":1}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Case A: spoofer has NO membership row at all
SET ROLE authenticated; SET request.jwt.claim.sub = '11111111-0000-0000-0000-000000000099';
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_request_publish(1::smallint,'SP','Spoof wine',1,'NORMALE',NULL,'spoof-rp-1') $sql$,
  'no active membership',
  '3A no membership: user_metadata.pilot_enabled=true/role=central has no effect on rete_request_publish');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_approve('00000000-0000-0000-0000-000000000000'::uuid,1,'spoof-oa-1') $sql$,
  'no active membership',
  '3A no membership: user_metadata claims ignored by rete_offer_approve');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_trasta_arrival_record('00000000-0000-0000-0000-000000000000'::uuid,'X',1,NULL,'spoof-tar-1') $sql$,
  'no active membership',
  '3A no membership: user_metadata claims ignored by rete_trasta_arrival_record');
RESET ROLE; RESET request.jwt.claim.sub;

-- Case B: spoofer has a real membership with pilot_enabled=false
INSERT INTO public.rete_memberships (user_id, role, location_id, display_name, active, pilot_enabled)
VALUES ('11111111-0000-0000-0000-000000000099','store',1,'Spoofer',true,false)
ON CONFLICT (user_id) DO UPDATE SET pilot_enabled=false, active=true;

SET ROLE authenticated; SET request.jwt.claim.sub = '11111111-0000-0000-0000-000000000099';
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_request_publish(1::smallint,'SP2','Spoof2',1,'NORMALE',NULL,'spoof-rp-2') $sql$,
  'no active membership',
  '3B DB pilot_enabled=false overrides user_metadata.pilot_enabled=true claim');
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid,1,'spoof-oc-2') $sql$,
  'no active membership',
  '3B DB pilot_enabled=false: all RPCs still denied despite metadata claims');

RESET ROLE; RESET request.jwt.claim.sub;

-- Verify: no side-effects from spoofer
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_requests WHERE created_by='11111111-0000-0000-0000-000000000099'::uuid)=0,
  '3-SE: no request created by spoofer');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_audit_events WHERE actor_user_id='11111111-0000-0000-0000-000000000099'::uuid)=0,
  '3-SE: no audit created by spoofer');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_idempotent_operations WHERE idempotency_key LIKE 'spoof-%')=0,
  '3-SE: no idempotency row created by spoofer');

-- Cleanup
DELETE FROM public.rete_memberships WHERE user_id='11111111-0000-0000-0000-000000000099';

-- ---------------------------------------------------------------------------
-- 4. DIRECT WRITE OF pilot_enabled DENIED (no UPDATE policy on rete_memberships)
-- ---------------------------------------------------------------------------
\echo '--- SECTION 4: direct write of pilot_enabled denied ---'

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='rete_memberships' AND cmd='UPDATE'
  ),
  '4: rete_memberships has no UPDATE policy → no authenticated client can modify pilot_enabled directly'
);

-- Empirical check: attempt UPDATE as authenticated, then verify DB value unchanged
DO $$
DECLARE
  v_before boolean; v_after boolean;
BEGIN
  SELECT pilot_enabled INTO v_before FROM public.rete_memberships WHERE user_id='11111111-0000-0000-0000-000000000002';
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claim.sub = '11111111-0000-0000-0000-000000000002';
  UPDATE public.rete_memberships SET pilot_enabled = NOT pilot_enabled WHERE user_id='11111111-0000-0000-0000-000000000002';
  RESET ROLE; RESET request.jwt.claim.sub;
  SELECT pilot_enabled INTO v_after FROM public.rete_memberships WHERE user_id='11111111-0000-0000-0000-000000000002';
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'ASSERTION FAILED: direct authenticated UPDATE changed pilot_enabled (before=%, after=%)', v_before, v_after;
  END IF;
  RAISE NOTICE 'PASS: direct authenticated UPDATE of pilot_enabled had zero effect on DB value (RLS silently blocked it)';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. KILL-SWITCH SEMANTICS
-- ---------------------------------------------------------------------------
\echo '--- SECTION 5: kill-switch semantics ---'

-- 5a. Successful call while Malta pilot=true
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint,'KS-WINE','Kill-switch wine',8,'NORMALE',NULL,'ks-central-req-pilot') AS result \gset ks_central_req_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'ks_central_req_result'::jsonb->>'request_id') AS ks_req_id \gset

SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'ks_req_id'::uuid,4,'ks-malta-offer-pilot') AS result \gset ks_offer_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(:'ks_offer_result' IS NOT NULL,'5a: Malta offer succeeds while pilot=true');

SELECT count(*) AS n FROM public.rete_idempotent_operations WHERE idempotency_key='ks-malta-offer-pilot' \gset ks_idem_before_

-- 5b. Operator kills Malta's pilot access
UPDATE public.rete_memberships SET pilot_enabled=false WHERE user_id=:malta_id;
SELECT pg_temp.assert_true(
  (SELECT NOT pilot_enabled FROM public.rete_memberships WHERE user_id=:malta_id),
  '5b: pilot_enabled=false confirmed in DB after kill-switch');

-- 5c. Retry of SAME idempotency key → rejected, NOT cached result
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,4,'ks-malta-offer-pilot') $sql$, :'ks_req_id'),
  'no active membership',
  '5c: retry of same idempotency key after kill-switch → "no active membership", NOT cached result (auth before idempotency)');
RESET ROLE; RESET request.jwt.claim.sub;

-- 5d. New call with different key → also rejected
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,4,'ks-malta-offer-new-after-kill') $sql$, :'ks_req_id'),
  'no active membership',
  '5d: new call after kill-switch also rejected');
RESET ROLE; RESET request.jwt.claim.sub;

-- 5e. Idempotency row count: 1 (from the pre-kill call) not 2 or 3
SELECT count(*) AS n FROM public.rete_idempotent_operations WHERE idempotency_key='ks-malta-offer-pilot' \gset ks_idem_after_
SELECT pg_temp.assert_true(:ks_idem_before_n=1 AND :ks_idem_after_n=1,
  '5e: exactly one idempotency row (pre-kill); rejected calls created none');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_idempotent_operations WHERE idempotency_key='ks-malta-offer-new-after-kill')=0,
  '5e: no idempotency row for the post-kill new call');

-- 5f. No offer duplication
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_offers WHERE request_id=:'ks_req_id'::uuid)=1,
  '5f: exactly one offer row (no duplicates from rejected calls)');

-- 5g. No audit from rejected calls
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_audit_events WHERE actor_user_id=:malta_id::uuid
     AND created_at > (SELECT created_at FROM public.rete_idempotent_operations WHERE idempotency_key='ks-malta-offer-pilot'))=0,
  '5g: no audit event written after kill-switch activation');

-- 5h. Re-enable → normal operation resumes
UPDATE public.rete_memberships SET pilot_enabled=true WHERE user_id=:malta_id;
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint,'KS-WINE-2','Kill-switch wine 2',8,'NORMALE',NULL,'ks-central-req-pilot-2') AS result \gset ks_central_req_2_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'ks_central_req_2_result'::jsonb->>'request_id') AS ks_req_id_2 \gset

SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'ks_req_id_2'::uuid,4,'ks-malta-offer-after-reenable') AS result \gset ks_reenable_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(
  (:'ks_reenable_result'::jsonb->>'status')='PROPOSTA',
  '5h: after re-enabling pilot, Malta can create offers again');

-- ---------------------------------------------------------------------------
-- 6. IDEMPOTENCY ORDER (empirical: auth before idempotency lookup) AND
--    LEGACY-ROW HANDLING (payload_canonical IS NULL -> permanently
--    unreplayable, fail-closed, per the F-1/F-2 remediation gate)
-- ---------------------------------------------------------------------------
\echo '--- SECTION 6: authorization before idempotency + legacy-row handling (empirical) ---'

-- Pre-create a LEGACY-SHAPED idempotency row (as if written before the
-- payload-binding fix existed: no payload_canonical at all).
INSERT INTO public.rete_idempotent_operations (operation, idempotency_key, actor_user_id, result)
VALUES ('rete_offer_create','idem-order-key-pilot', :malta_id::uuid,
        '{"offer_id":"00000000-dead-beef-0000-000000000001","status":"PROPOSTA"}'::jsonb)
ON CONFLICT (operation, idempotency_key) DO NOTHING;

SELECT pg_temp.assert_true(
  (SELECT payload_canonical IS NULL FROM public.rete_idempotent_operations WHERE idempotency_key='idem-order-key-pilot'),
  '6-prereq: the pre-created row has no payload_canonical (simulates a legacy pre-fix row)');

-- Disable Malta
UPDATE public.rete_memberships SET pilot_enabled=false WHERE user_id=:malta_id;

-- Attempt replay with the pre-existing key while pilot is disabled
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid,1,'idem-order-key-pilot') $sql$,
  'no active membership',
  '6a: with pilot=false, replay of pre-existing idempotency key raises exception (auth runs BEFORE cache lookup)');
RESET ROLE; RESET request.jwt.claim.sub;

-- The row still exists (was not consumed by the rejected call)
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_idempotent_operations WHERE idempotency_key='idem-order-key-pilot')=1,
  '6b: pre-existing idempotency row still present after rejected call (not consumed or deleted)');

-- Re-enable Malta: the LEGACY row (payload_canonical IS NULL) must remain
-- PERMANENTLY unreplayable, fail-closed - it is never treated as a wildcard
-- match, even for the correct actor with a plausible payload. This is the
-- F-1/F-2 remediation's explicit legacy-record requirement.
UPDATE public.rete_memberships SET pilot_enabled=true WHERE user_id=:malta_id;
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid,1,'idem-order-key-pilot') $sql$,
  'operation not permitted',
  '6c: after re-enabling, the LEGACY row (no payload_canonical) is still rejected - never replayable, fail-closed');
RESET ROLE; RESET request.jwt.claim.sub;

DELETE FROM public.rete_idempotent_operations WHERE idempotency_key='idem-order-key-pilot';

-- Contrast: a REAL (properly bound) claim, made while enabled, disabled,
-- then re-enabled, DOES replay correctly with its own matching payload -
-- proving the auth-before-idempotency ordering is the only barrier for
-- bound records (unlike the permanently-blocked legacy case above). Uses a
-- fresh request (coh_req_id from Section 2 is already fully covered/closed
-- by this point in the script).
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint,'IDEM-BOUND','Idem bound wine',10,'NORMALE',NULL,'idem-bound-req-publish') AS result \gset idem_bound_req_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'idem_bound_req_result'::jsonb->>'request_id') AS idem_bound_req_id \gset

SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'idem_bound_req_id'::uuid,1,'idem-order-bound-key') AS result \gset idem_bound_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(:'idem_bound_result' IS NOT NULL, '6d-setup: bound claim succeeds while enabled');

UPDATE public.rete_memberships SET pilot_enabled=false WHERE user_id=:malta_id;
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,1,'idem-order-bound-key') $sql$, :'idem_bound_req_id'),
  'no active membership',
  '6e: bound claim replay denied while disabled (auth before idempotency)');
RESET ROLE; RESET request.jwt.claim.sub;

UPDATE public.rete_memberships SET pilot_enabled=true WHERE user_id=:malta_id;
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'idem_bound_req_id'::uuid,1,'idem-order-bound-key') AS result \gset idem_bound_replay_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(
  :'idem_bound_replay_result' = :'idem_bound_result',
  '6f: after re-enabling, a BOUND claim (matching actor+payload) replays its identical cached result - auth was the only barrier');

DELETE FROM public.rete_idempotent_operations WHERE idempotency_key='idem-order-key-pilot';

-- ---------------------------------------------------------------------------
-- 7. DEFAULT FALSE FOR NEW ROWS
-- ---------------------------------------------------------------------------
\echo '--- SECTION 7: default false for new membership rows ---'

INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('11111111-0000-0000-0000-000000000097','sql-test-default-pilot@local.invalid',
        'authenticated','authenticated',now(),now(),now(),'{}'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rete_memberships (user_id, role, location_id, display_name, active)
VALUES ('11111111-0000-0000-0000-000000000097','store',1,'Default-False Test',true)
ON CONFLICT (user_id) DO NOTHING;

SELECT pg_temp.assert_true(
  (SELECT NOT pilot_enabled FROM public.rete_memberships WHERE user_id='11111111-0000-0000-0000-000000000097'),
  '7: new membership inserted without specifying pilot_enabled gets pilot_enabled=false by default');

SET ROLE authenticated; SET request.jwt.claim.sub = '11111111-0000-0000-0000-000000000097';
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_create('00000000-0000-0000-0000-000000000000'::uuid,1,'default-false-check') $sql$,
  'no active membership',
  '7: new membership with default pilot_enabled=false is correctly denied by every RPC');
RESET ROLE; RESET request.jwt.claim.sub;

DELETE FROM public.rete_memberships WHERE user_id='11111111-0000-0000-0000-000000000097';

-- ---------------------------------------------------------------------------
-- 8. NO HARDCODED PILOT IDENTITY IN MIGRATION
-- ---------------------------------------------------------------------------
\echo '--- SECTION 8: no hardcoded pilot identities in migration ---'

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_memberships WHERE pilot_enabled=true
     AND user_id NOT IN (
       '11111111-0000-0000-0000-000000000001',
       '11111111-0000-0000-0000-000000000002',
       '11111111-0000-0000-0000-000000000003',
       '11111111-0000-0000-0000-000000000004',
       '11111111-0000-0000-0000-000000000007'
     ))=0,
  '8: only fixture-loaded synthetic test rows have pilot_enabled=true; migration itself enables no real identity');

-- ---------------------------------------------------------------------------
-- 9. IDEMPOTENCY ACTOR/PAYLOAD BINDING (F-1 / F-2 remediation)
-- ---------------------------------------------------------------------------
\echo '--- SECTION 9: idempotency actor/payload binding (F-1/F-2) ---'

-- Fresh base request for these tests (own product code, avoids collisions).
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint,'F12-BASE','F1/F2 base wine',20,'NORMALE',NULL,'f12-base-publish') AS result \gset f12_req_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'f12_req_result'::jsonb->>'request_id') AS f12_req_id \gset

-- 9.1 same key, same actor, same payload -> identical cached result
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'f12_req_id'::uuid,2,'f12-key-1') AS result \gset f12_a_
SELECT public.rete_offer_create(:'f12_req_id'::uuid,2,'f12-key-1') AS result \gset f12_a_retry_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(:'f12_a_result' = :'f12_a_retry_result', '9.1 same key/actor/payload -> identical result');

-- 9.2 same key, same actor, DIFFERENT payload (different quantity) -> reject (F-1)
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,5,'f12-key-1') $sql$, :'f12_req_id'),
  'operation not permitted', '9.2 F-1: same key/actor, different quantity -> rejected, not silently cached');
RESET ROLE; RESET request.jwt.claim.sub;

-- 9.3 same key, DIFFERENT actor, SAME payload -> reject (F-2)
SET ROLE authenticated; SET request.jwt.claim.sub = :sestri_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,2,'f12-key-1') $sql$, :'f12_req_id'),
  'operation not permitted', '9.3 F-2: same key, different actor, same payload -> rejected (no cross-actor leak)');
RESET ROLE; RESET request.jwt.claim.sub;

-- 9.4 same key, DIFFERENT actor, DIFFERENT payload -> reject
SET ROLE authenticated; SET request.jwt.claim.sub = :sestri_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,7,'f12-key-1') $sql$, :'f12_req_id'),
  'operation not permitted', '9.4 different actor AND different payload -> rejected');
RESET ROLE; RESET request.jwt.claim.sub;

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_offers WHERE request_id=:'f12_req_id'::uuid AND offering_location_id=2)=0,
  '9.3/9.4-SE: Sestri never actually created an offer via the collided key');

-- 9.5 same key, DIFFERENT operation -> independent (PK includes operation)
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_offer_reject('00000000-0000-0000-0000-000000000000'::uuid,'f12-key-1') $sql$,
  'operation not permitted', '9.5 same key, different operation name -> independent claim, denied for its own reason (offer not found), not confused with offer_create''s cached result');
RESET ROLE; RESET request.jwt.claim.sub;

-- 9.6 NULL vs empty string in payload -> different canonical payload, no bleed
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint,'F12-NULLEMPTY','desc',5,'NORMALE',NULL,'f12-null-key') AS result \gset f12_null_
SELECT pg_temp.assert_raises_matching(
  $sql$ SELECT public.rete_request_publish(3::smallint,'F12-NULLEMPTY','desc',5,'NORMALE','','f12-null-key') $sql$,
  'operation not permitted',
  '9.6 same key, p_notes NULL vs empty string '''' -> treated as different payload, rejected, not silently merged');
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_requests WHERE product_code='F12-NULLEMPTY')=1,
  '9.6-SE: only the original (NULL notes) request exists, no second row from the empty-string retry');

-- 9.7 different quantity (already covered by 9.2) + 9.8 different target UUID -> reject
SET ROLE authenticated; SET request.jwt.claim.sub = :central_id;
SELECT public.rete_request_publish(3::smallint,'F12-UUID-A','wine A',5,'NORMALE',NULL,'f12-uuid-a-key') AS result \gset f12_ua_
SELECT public.rete_request_publish(3::smallint,'F12-UUID-B','wine B',5,'NORMALE',NULL,'f12-uuid-b-key') AS result \gset f12_ub_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT (:'f12_ua_result'::jsonb->>'request_id') AS f12_ua_id \gset
SELECT (:'f12_ub_result'::jsonb->>'request_id') AS f12_ub_id \gset

SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'f12_ua_id'::uuid,1,'f12-target-key') AS result \gset f12_target_a_
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,1,'f12-target-key') $sql$, :'f12_ub_id'),
  'operation not permitted', '9.8 same key, DIFFERENT target request_id -> rejected, not silently applied to request B');
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_offers WHERE request_id=:'f12_ub_id'::uuid)=0,
  '9.8-SE: no offer was ever created against request B via the collided key');

-- 9.9 semantically identical payload (independently constructed, same values) -> valid replay
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_create(:'f12_ua_id'::uuid,1,'f12-target-key') AS result \gset f12_target_a_retry_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(:'f12_target_a_result' = :'f12_target_a_retry_result', '9.9 semantically identical payload (same request_id, same quantity) -> valid replay of the original result');

-- 9.13 pilot disabled AFTER a successful bound claim -> replay rejected (distinct from legacy-row case)
UPDATE public.rete_memberships SET pilot_enabled=false WHERE user_id=:malta_id;
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,1,'f12-target-key') $sql$, :'f12_ua_id'),
  'no active membership', '9.13 pilot disabled after success -> bound-key replay rejected (auth gate, not idempotency)');
RESET ROLE; RESET request.jwt.claim.sub;
UPDATE public.rete_memberships SET pilot_enabled=true WHERE user_id=:malta_id;

-- 9.14 membership deactivated AFTER a successful bound claim -> replay rejected
UPDATE public.rete_memberships SET active=false WHERE user_id=:malta_id;
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_create('%s'::uuid,1,'f12-target-key') $sql$, :'f12_ua_id'),
  'no active membership', '9.14 membership deactivated after success -> bound-key replay rejected');
RESET ROLE; RESET request.jwt.claim.sub;
UPDATE public.rete_memberships SET active=true WHERE user_id=:malta_id;

-- 9.15 location/ownership error after a valid claim attempt -> transaction (and claim) rolls back
SET ROLE authenticated; SET request.jwt.claim.sub = :sestri_id;
SELECT pg_temp.assert_raises_matching(
  format($sql$ SELECT public.rete_offer_withdraw('%s'::uuid,'f12-loc-fail-key') $sql$, :'f12_target_a_result'::jsonb->>'offer_id'),
  'operation not permitted', '9.15 Sestri (wrong location) attempts to withdraw Malta''s offer -> claim rolls back with the aborted transaction');
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.rete_idempotent_operations WHERE idempotency_key='f12-loc-fail-key')=0,
  '9.15-SE: no idempotent-operation row survives the location-mismatch failure');
-- The correct actor can now use the same key fresh, proving it was not stuck
SET ROLE authenticated; SET request.jwt.claim.sub = :malta_id;
SELECT public.rete_offer_withdraw((:'f12_target_a_result'::jsonb->>'offer_id')::uuid,'f12-loc-fail-key') AS result \gset f12_withdraw_
RESET ROLE; RESET request.jwt.claim.sub;
SELECT pg_temp.assert_true((:'f12_withdraw_result'::jsonb->>'status')='RITIRATA', '9.15-SE: Malta (correct owner) reuses the key successfully after the failed claim rolled back');

-- ---------------------------------------------------------------------------
\echo 'ALL PILOT ALLOWLIST SQL TESTS PASSED'
