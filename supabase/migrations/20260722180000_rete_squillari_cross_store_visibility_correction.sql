-- Rete Squillari — cross-store visibility and RLS correction.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. Reviewable design
-- artifact only, on branch feat/rete-squillari-email-shortage-ingest,
-- requires its own explicit-authorization step before `supabase db push`.
--
-- Three real, empirically-verified gaps (rolled-back transaction, real
-- membership identities, real RLS enforcement - never a real password or
-- session token was used or needed):
--
-- 1. The "active members read requests" SELECT policy exempted only
--    DA_CONFERMARE from network-wide visibility - DA_VERIFICARE (an
--    unconfirmed candidate from the body-text email pipeline, never meant
--    to be a published request) was fully network-wide visible to every
--    store. Verified live: an unrelated store could read another store's
--    DA_VERIFICARE row.
-- 2. rete_guard_protected_columns() (the trigger that already forces
--    status/remaining_quantity/lifecycle fields through governed RPCs -
--    see rete_request_update_quantity's own `SET rete.trusted_rpc = 'on'`
--    pattern in 20260719120000_...) never covered product_code,
--    product_description, requested_quantity, or requesting_location_id.
--    Verified live: the requesting store could UPDATE its own request's
--    product_code and requested_quantity directly, bypassing
--    rete_request_update_quantity's real validation entirely (status
--    check, no-approved-offer check, optimistic version check).
-- 3. The DELETE policy allowed the requesting store (not just central) to
--    physically delete its own request row - no corresponding governed
--    retraction path, no audit trail, no trigger guard at all for DELETE.
--    Verified live: a requesting store's DELETE actually removed the row.
--
-- Everything ELSE checked in this gate was already correct and is left
-- unchanged: self-offer is blocked (RLS INSERT with_check), forged donor
-- identity is blocked (membership-derived, never caller-supplied), offer
-- quantity must be positive (CHECK constraint), status/lifecycle fields
-- are already trigger-guarded, cross-store request edits are already
-- blocked (RLS USING clause), audit/ingest tables are already
-- central-only, and anon has no grant at all on any operational table.

BEGIN;

-- Fix 1: exempt DA_VERIFICARE the same way DA_CONFERMARE already is -
-- only the requesting store or central may see an unconfirmed candidate.
DROP POLICY IF EXISTS "active members read requests" ON "public"."rete_requests";
CREATE POLICY "active members read requests" ON "public"."rete_requests" FOR SELECT TO "authenticated"
    USING (
        (EXISTS ( SELECT 1 FROM "public"."rete_memberships" m
            WHERE ((m.user_id = ( SELECT auth.uid())) AND m.active)))
        AND (
            (status NOT IN ('DA_CONFERMARE', 'DA_VERIFICARE'))
            OR (EXISTS ( SELECT 1 FROM "public"."rete_memberships" m
                WHERE ((m.user_id = ( SELECT auth.uid())) AND m.active
                    AND ((m.role = 'central'::"rete_user_role") OR (m.location_id = rete_requests.requesting_location_id)))))
        )
    );

-- Fix 2: extend the existing protected-column guard to cover product
-- identity and quantity fields - these already have a real governed RPC
-- (rete_request_update_quantity) that does the validation a raw UPDATE
-- skips entirely. No new mechanism, no new bypass flag - reuses the exact
-- same rete.trusted_rpc session flag every other governed RPC already
-- sets, so no existing RPC needs to change.
CREATE OR REPLACE FUNCTION "public"."rete_guard_protected_columns"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_setting('rete.trusted_rpc', true) IS DISTINCT FROM 'on' THEN
    IF TG_TABLE_NAME = 'rete_requests' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.remaining_quantity IS DISTINCT FROM OLD.remaining_quantity
         OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
         OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
         OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
         OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
         OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
         OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
         OR NEW.requires_central_confirmation IS DISTINCT FROM OLD.requires_central_confirmation
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.product_code IS DISTINCT FROM OLD.product_code
         OR NEW.product_description IS DISTINCT FROM OLD.product_description
         OR NEW.requested_quantity IS DISTINCT FROM OLD.requested_quantity
         OR NEW.requesting_location_id IS DISTINCT FROM OLD.requesting_location_id THEN
        RAISE EXCEPTION 'rete_requests: status, quantity, product identity, requesting store, and lifecycle fields can only change via a governed operation';
      END IF;
    ELSIF TG_TABLE_NAME = 'rete_offers' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.approved_quantity IS DISTINCT FROM OLD.approved_quantity
         OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
        RAISE EXCEPTION 'rete_offers: status, approved_quantity and approved_by can only change via a governed operation';
      END IF;
    ELSIF TG_TABLE_NAME = 'rete_transfers' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.received_quantity IS DISTINCT FROM OLD.received_quantity
         OR NEW.received_at IS DISTINCT FROM OLD.received_at
         OR NEW.received_by IS DISTINCT FROM OLD.received_by
         OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at
         OR NEW.departed_at IS DISTINCT FROM OLD.departed_at
         OR NEW.discrepancy_type IS DISTINCT FROM OLD.discrepancy_type
         OR NEW.discrepancy_acknowledged IS DISTINCT FROM OLD.discrepancy_acknowledged
         OR NEW.discrepancy_resolved_by IS DISTINCT FROM OLD.discrepancy_resolved_by
         OR NEW.discrepancy_resolved_at IS DISTINCT FROM OLD.discrepancy_resolved_at
         OR NEW.discrepancy_resolution_note IS DISTINCT FROM OLD.discrepancy_resolution_note
         OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'rete_transfers: status, receipt/prep/departure fields, discrepancy fields and version can only change via a governed operation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Fix 3: DELETE is central-only. A store's own "cancel my request" path
-- already exists as a governed RPC (rete_request_cancel, per the
-- adapter's RPC table: "store (own) or central") - that sets status to
-- ANNULLATA with an audit trail rather than physically removing the row.
-- Raw DELETE bypasses that trail entirely and is no longer needed by any
-- legitimate store workflow.
DROP POLICY IF EXISTS "requesting store or central deletes requests" ON "public"."rete_requests";
CREATE POLICY "central deletes requests" ON "public"."rete_requests" FOR DELETE TO "authenticated"
    USING ((EXISTS ( SELECT 1 FROM "public"."rete_memberships" m
        WHERE ((m.user_id = ( SELECT auth.uid())) AND m.active AND (m.role = 'central'::"rete_user_role")))));

COMMIT;
