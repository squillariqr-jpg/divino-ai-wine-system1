-- Rete Squillari — excess stock publication: enum types.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE.
--
-- Split into its own migration/transaction (same reason as every previous
-- enum-adding migration in this project): Postgres forbids using a newly
-- added enum value within the same transaction that created it. The tables
-- and functions using these values live in
-- 20260727130000_rete_squillari_excess_stock.sql.
--
-- Excess stock is a deliberately SEPARATE model from rete_requests/
-- rete_offers (see that migration's header comment for the full audit
-- reasoning: a shortage request always means "someone needs X", an offer
-- always means "a response to a specific request" - excess stock is a
-- standalone published surplus with no requesting party at all until a
-- reservation exists. Reusing rete_requests/rete_offers would have forced
-- either a fake self-referential "request" for every excess listing or an
-- offer with no request_id, both of which blur meanings that the rest of
-- this codebase (and its tests) currently treat as structurally guaranteed.

BEGIN;

CREATE TYPE "public"."rete_excess_stock_status" AS ENUM (
  'AVAILABLE', 'PARTIALLY_RESERVED', 'FULLY_RESERVED', 'WITHDRAWN', 'EXPIRED', 'COMPLETED'
);

CREATE TYPE "public"."rete_excess_stock_reason" AS ENUM (
  'OVERSTOCK', 'SEASONAL', 'SLOW_MOVING', 'RANGE_CHANGE', 'OTHER'
);

CREATE TYPE "public"."rete_excess_reservation_status" AS ENUM (
  'ACCEPTED', 'PREPARING', 'IN_TRANSFER', 'RECEIVED', 'CANCELLED'
);

-- Additive extension of the existing WhatsApp notification event enum
-- (20260724110000_rete_squillari_whatsapp_notifications.sql) - reuses the
-- same outbox rather than building a second notification system, per
-- Phase 10's instruction.
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_STOCK_PUBLISHED';
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_STOCK_RESERVED';
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_STOCK_PARTIALLY_RESERVED';
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_STOCK_FULLY_RESERVED';
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_GOODS_TO_PREPARE';
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_TRANSFER_STARTED';
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_TRANSFER_RECEIVED';
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_STOCK_EXPIRED';
ALTER TYPE "public"."rete_whatsapp_event_type" ADD VALUE IF NOT EXISTS 'EXCESS_STOCK_WITHDRAWN';

COMMIT;
