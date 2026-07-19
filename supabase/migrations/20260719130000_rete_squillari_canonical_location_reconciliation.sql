-- Migration 6: rete_squillari_canonical_location_reconciliation
--
-- Reconciles rete_locations to the certified canonical model:
--   rete_locations.id  = the immutable WBOS retail location ID (matches
--                         scripts/active_transfer_opportunity_filter.py
--                         CANONICAL_STORES in the wbos repository), for
--                         all six stores: Malta=2, Sestri=4, Cantore=5,
--                         Trento=6, De Ferrari=7, Armenia=8.
--   rete_locations.code = rete_locations.id (no separate numbering scheme).
--
-- Root cause (established via live read-only investigation of the
-- certified remote project ljuyolwnlbqlfxjujfrq, cross-checked against
-- scripts/provision_rete_squillari.js commit f413322 "fix(rete-squillari):
-- align provisioning location codes", 2026-07-16): the certified remote
-- project has always used id=code={2,4,5,6,7,8}. The tracked
-- 20260715075948_create_rete_squillari_core_schema.sql migration file's
-- INSERT used a sequential id (1-6) with an unrelated code (101-106) - a
-- draft that was corrected in this same commit set (see that migration's
-- updated header) but was never what actually ran against the certified
-- project, since Supabase tracks applied migrations by version/filename,
-- not by content hash. This migration reconciles any environment that
-- already ran the old draft content (a clean local reset performed before
-- this fix, or any other database seeded from the stale file) to the
-- canonical model, and is a verified no-op against an already-canonical
-- database (including the certified remote project itself).
--
-- Safety contract:
--   * No-op if all six rows already match the canonical model exactly.
--   * Guarded re-key only if all six rows match the known legacy model
--     exactly (id 1-6 / code 101-106, by name) - never a partial or
--     best-effort correction.
--   * Fails closed (RAISE EXCEPTION, whole migration rolls back) on any
--     other state: missing store, extra/unexpected row, duplicate name,
--     duplicate code, a mix of canonical and legacy rows, or any
--     dependent row (rete_memberships/rete_requests/rete_offers/
--     rete_transfers) referencing a location_id outside the exact legacy
--     id set {1,2,3,4,5,6}. This migration never invents a missing store
--     and never uses ON DELETE/UPDATE CASCADE as a shortcut - every
--     dependent row is remapped explicitly, one legacy id at a time, via
--     the same fixed mapping used for rete_locations itself.
--   * Uses a temporary, disjoint id offset (+1000) for the re-key itself,
--     since the legacy id range {1..6} and the canonical id range
--     {2,4,5,6,7,8} overlap (e.g. legacy Sestri id=2 collides with
--     canonical Malta id=2) - a direct UPDATE without an offset would
--     violate the primary key uniqueness constraint mid-statement. The
--     five FK constraints referencing rete_locations.id are dropped and
--     re-added around the two-phase renumbering (all in this migration's
--     single transaction) rather than declared ON UPDATE CASCADE,
--     because CASCADE would apply silently to any future accidental id
--     change - this migration is the one place location ids are ever
--     expected to move, and it remaps every dependent table explicitly.
--   * Never deletes any row. name and active are preserved unchanged
--     throughout.

DO $$
DECLARE
  v_canonical_count integer;
  v_legacy_count integer;
  v_total_count integer;
  v_bad_membership_count integer;
  v_bad_request_count integer;
  v_bad_offer_count integer;
  v_bad_transfer_from_count integer;
  v_bad_transfer_to_count integer;
BEGIN
  SELECT count(*) INTO v_total_count FROM public.rete_locations;

  SELECT count(*) INTO v_canonical_count FROM public.rete_locations WHERE
    (name = 'Malta' AND id = 2 AND code = 2) OR
    (name = 'Sestri' AND id = 4 AND code = 4) OR
    (name = 'Cantore' AND id = 5 AND code = 5) OR
    (name = 'Trento' AND id = 6 AND code = 6) OR
    (name = 'De Ferrari' AND id = 7 AND code = 7) OR
    (name = 'Armenia' AND id = 8 AND code = 8);

  IF v_total_count = 6 AND v_canonical_count = 6 THEN
    RAISE NOTICE 'rete_locations already canonical - no-op';
    RETURN;
  END IF;

  SELECT count(*) INTO v_legacy_count FROM public.rete_locations WHERE
    (name = 'Malta' AND id = 1 AND code = 101) OR
    (name = 'Sestri' AND id = 2 AND code = 102) OR
    (name = 'Cantore' AND id = 3 AND code = 103) OR
    (name = 'Trento' AND id = 4 AND code = 104) OR
    (name = 'De Ferrari' AND id = 5 AND code = 105) OR
    (name = 'Armenia' AND id = 6 AND code = 106);

  IF v_total_count <> 6 OR v_legacy_count <> 6 THEN
    RAISE EXCEPTION 'rete_locations is in an ambiguous state (% total rows, % canonical, % legacy) - refusing to guess, manual review required', v_total_count, v_canonical_count, v_legacy_count;
  END IF;

  -- Every dependent row must reference a known legacy id (or not exist at
  -- all) - an unknown location_id here means some other actor already
  -- depends on a location id this migration does not know how to remap.
  SELECT count(*) INTO v_bad_membership_count FROM public.rete_memberships WHERE location_id IS NOT NULL AND location_id NOT IN (1,2,3,4,5,6);
  SELECT count(*) INTO v_bad_request_count FROM public.rete_requests WHERE requesting_location_id NOT IN (1,2,3,4,5,6);
  SELECT count(*) INTO v_bad_offer_count FROM public.rete_offers WHERE offering_location_id NOT IN (1,2,3,4,5,6);
  SELECT count(*) INTO v_bad_transfer_from_count FROM public.rete_transfers WHERE from_location_id NOT IN (1,2,3,4,5,6);
  SELECT count(*) INTO v_bad_transfer_to_count FROM public.rete_transfers WHERE to_location_id NOT IN (1,2,3,4,5,6);

  IF v_bad_membership_count > 0 OR v_bad_request_count > 0 OR v_bad_offer_count > 0 OR v_bad_transfer_from_count > 0 OR v_bad_transfer_to_count > 0 THEN
    RAISE EXCEPTION 'a dependent row references a location_id outside the known legacy set {1..6} - refusing to guess a remap (memberships=%, requests=%, offers=%, transfers_from=%, transfers_to=%)',
      v_bad_membership_count, v_bad_request_count, v_bad_offer_count, v_bad_transfer_from_count, v_bad_transfer_to_count;
  END IF;

  RAISE NOTICE 'rete_locations is in the known legacy state - reconciling to canonical ids';

  ALTER TABLE public.rete_memberships DROP CONSTRAINT IF EXISTS "rete_memberships_location_id_fkey";
  ALTER TABLE public.rete_offers DROP CONSTRAINT IF EXISTS "rete_offers_offering_location_id_fkey";
  ALTER TABLE public.rete_requests DROP CONSTRAINT IF EXISTS "rete_requests_requesting_location_id_fkey";
  ALTER TABLE public.rete_transfers DROP CONSTRAINT IF EXISTS "rete_transfers_from_location_id_fkey";
  ALTER TABLE public.rete_transfers DROP CONSTRAINT IF EXISTS "rete_transfers_to_location_id_fkey";

  -- Phase 1: move every legacy id to a disjoint temporary range so phase 2
  -- never collides with a still-legacy or already-final id.
  UPDATE public.rete_locations SET id = id + 1000, code = code + 1000 WHERE id IN (1,2,3,4,5,6);
  UPDATE public.rete_memberships SET location_id = location_id + 1000 WHERE location_id IN (1,2,3,4,5,6);
  UPDATE public.rete_requests SET requesting_location_id = requesting_location_id + 1000 WHERE requesting_location_id IN (1,2,3,4,5,6);
  UPDATE public.rete_offers SET offering_location_id = offering_location_id + 1000 WHERE offering_location_id IN (1,2,3,4,5,6);
  UPDATE public.rete_transfers SET from_location_id = from_location_id + 1000 WHERE from_location_id IN (1,2,3,4,5,6);
  UPDATE public.rete_transfers SET to_location_id = to_location_id + 1000 WHERE to_location_id IN (1,2,3,4,5,6);

  -- Phase 2: move from the temporary range to the final canonical ids.
  -- code is set explicitly to the canonical id (not merely copied from the
  -- temporary offset), matching the "code = id" contract exactly.
  UPDATE public.rete_locations SET id = 2, code = 2 WHERE id = 1001; -- Malta
  UPDATE public.rete_locations SET id = 4, code = 4 WHERE id = 1002; -- Sestri
  UPDATE public.rete_locations SET id = 5, code = 5 WHERE id = 1003; -- Cantore
  UPDATE public.rete_locations SET id = 6, code = 6 WHERE id = 1004; -- Trento
  UPDATE public.rete_locations SET id = 7, code = 7 WHERE id = 1005; -- De Ferrari
  UPDATE public.rete_locations SET id = 8, code = 8 WHERE id = 1006; -- Armenia

  UPDATE public.rete_memberships SET location_id = 2 WHERE location_id = 1001;
  UPDATE public.rete_memberships SET location_id = 4 WHERE location_id = 1002;
  UPDATE public.rete_memberships SET location_id = 5 WHERE location_id = 1003;
  UPDATE public.rete_memberships SET location_id = 6 WHERE location_id = 1004;
  UPDATE public.rete_memberships SET location_id = 7 WHERE location_id = 1005;
  UPDATE public.rete_memberships SET location_id = 8 WHERE location_id = 1006;

  UPDATE public.rete_requests SET requesting_location_id = 2 WHERE requesting_location_id = 1001;
  UPDATE public.rete_requests SET requesting_location_id = 4 WHERE requesting_location_id = 1002;
  UPDATE public.rete_requests SET requesting_location_id = 5 WHERE requesting_location_id = 1003;
  UPDATE public.rete_requests SET requesting_location_id = 6 WHERE requesting_location_id = 1004;
  UPDATE public.rete_requests SET requesting_location_id = 7 WHERE requesting_location_id = 1005;
  UPDATE public.rete_requests SET requesting_location_id = 8 WHERE requesting_location_id = 1006;

  UPDATE public.rete_offers SET offering_location_id = 2 WHERE offering_location_id = 1001;
  UPDATE public.rete_offers SET offering_location_id = 4 WHERE offering_location_id = 1002;
  UPDATE public.rete_offers SET offering_location_id = 5 WHERE offering_location_id = 1003;
  UPDATE public.rete_offers SET offering_location_id = 6 WHERE offering_location_id = 1004;
  UPDATE public.rete_offers SET offering_location_id = 7 WHERE offering_location_id = 1005;
  UPDATE public.rete_offers SET offering_location_id = 8 WHERE offering_location_id = 1006;

  UPDATE public.rete_transfers SET from_location_id = 2 WHERE from_location_id = 1001;
  UPDATE public.rete_transfers SET from_location_id = 4 WHERE from_location_id = 1002;
  UPDATE public.rete_transfers SET from_location_id = 5 WHERE from_location_id = 1003;
  UPDATE public.rete_transfers SET from_location_id = 6 WHERE from_location_id = 1004;
  UPDATE public.rete_transfers SET from_location_id = 7 WHERE from_location_id = 1005;
  UPDATE public.rete_transfers SET from_location_id = 8 WHERE from_location_id = 1006;

  UPDATE public.rete_transfers SET to_location_id = 2 WHERE to_location_id = 1001;
  UPDATE public.rete_transfers SET to_location_id = 4 WHERE to_location_id = 1002;
  UPDATE public.rete_transfers SET to_location_id = 5 WHERE to_location_id = 1003;
  UPDATE public.rete_transfers SET to_location_id = 6 WHERE to_location_id = 1004;
  UPDATE public.rete_transfers SET to_location_id = 7 WHERE to_location_id = 1005;
  UPDATE public.rete_transfers SET to_location_id = 8 WHERE to_location_id = 1006;

  ALTER TABLE public.rete_memberships ADD CONSTRAINT "rete_memberships_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."rete_locations"("id");
  ALTER TABLE public.rete_offers ADD CONSTRAINT "rete_offers_offering_location_id_fkey" FOREIGN KEY ("offering_location_id") REFERENCES "public"."rete_locations"("id");
  ALTER TABLE public.rete_requests ADD CONSTRAINT "rete_requests_requesting_location_id_fkey" FOREIGN KEY ("requesting_location_id") REFERENCES "public"."rete_locations"("id");
  ALTER TABLE public.rete_transfers ADD CONSTRAINT "rete_transfers_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "public"."rete_locations"("id");
  ALTER TABLE public.rete_transfers ADD CONSTRAINT "rete_transfers_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."rete_locations"("id");

  -- Final validation before allowing this transaction to commit.
  SELECT count(*) INTO v_canonical_count FROM public.rete_locations WHERE
    (name = 'Malta' AND id = 2 AND code = 2) OR
    (name = 'Sestri' AND id = 4 AND code = 4) OR
    (name = 'Cantore' AND id = 5 AND code = 5) OR
    (name = 'Trento' AND id = 6 AND code = 6) OR
    (name = 'De Ferrari' AND id = 7 AND code = 7) OR
    (name = 'Armenia' AND id = 8 AND code = 8);

  IF v_canonical_count <> 6 THEN
    RAISE EXCEPTION 'post-reconciliation validation failed: expected 6 canonical rows, found %', v_canonical_count;
  END IF;

  RAISE NOTICE 'rete_locations reconciled to canonical ids successfully';
END;
$$;
