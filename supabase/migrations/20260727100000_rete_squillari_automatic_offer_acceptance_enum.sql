-- Rete Squillari — automatic offer acceptance: enum expansion only.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE.
--
-- Split into its own migration file/transaction on purpose: Postgres does
-- not allow a newly added enum value to be referenced (in a function body,
-- INSERT, etc.) within the same transaction that added it. The functions
-- using these three new values live in the next migration
-- (20260727110000_rete_squillari_automatic_offer_acceptance.sql).
--
-- CONFLICT_REVIEW / ARRIVAL_CONFLICT are added for completeness with the
-- documented exception model but have no reachable trigger in this gate's
-- implementation (see that migration's own comments) - DATA_REVIEW is the
-- only one a real code path can currently produce.

BEGIN;

ALTER TYPE "public"."rete_offer_status" ADD VALUE IF NOT EXISTS 'CONFLICT_REVIEW';
ALTER TYPE "public"."rete_offer_status" ADD VALUE IF NOT EXISTS 'DATA_REVIEW';
ALTER TYPE "public"."rete_offer_status" ADD VALUE IF NOT EXISTS 'ARRIVAL_CONFLICT';

COMMIT;
