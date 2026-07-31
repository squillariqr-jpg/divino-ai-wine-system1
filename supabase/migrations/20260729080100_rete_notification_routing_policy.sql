-- Rete Squillari — deterministic default channel-routing policy (Phase 3).
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE.
--
-- rete_notification_routing_defaults holds one row per (event_type,
-- channel) naming the DEFAULT routing mode for that pair. It is read by
-- the routing engine in 20260729080500 and combined with per-user/location
-- preferences (20260729080200) and per-channel destination availability
-- (push subscription / verified email contact) to decide whether a
-- delivery row is created, and with what initial status.
--
-- Modes:
--   YES                 - channel enabled by default for this event.
--   NO                  - channel never used for this event by default.
--   DIGEST               - EMAIL only: included in the next daily digest,
--                          never sent as an individual message.
--   IMMEDIATE             - EMAIL only: SYSTEM_EXCEPTION (central) - sent as
--                          its own message, not batched into the digest.
--   OPTIONAL_DISABLED     - channel is architecturally wired but off by
--                          default (e.g. WHATSAPP for GOODS_TO_PREPARE) -
--                          a location-level preference could turn it on in
--                          the future; nothing in this gate does.
--
-- This table is a plain reference/config table - no direct grants to
-- authenticated/anon (frontend never needs to read routing internals),
-- read only from SECURITY DEFINER routing code.

BEGIN;

CREATE TABLE IF NOT EXISTS "public"."rete_notification_routing_defaults" (
  "event_type" "public"."rete_notification_event_type" NOT NULL,
  "channel" "public"."rete_notification_channel" NOT NULL,
  "mode" "text" NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("event_type", "channel"),
  CONSTRAINT "rete_notification_routing_defaults_mode_check"
    CHECK ("mode" IN ('YES', 'NO', 'DIGEST', 'IMMEDIATE', 'OPTIONAL_DISABLED'))
);
ALTER TABLE "public"."rete_notification_routing_defaults" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_notification_routing_defaults" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_notification_routing_defaults" TO "service_role";

-- Seed exactly the matrix from Phase 3 of the gate spec. Every event_type
-- defined in rete_notification_event_type has an explicit row for all four
-- channels - no implicit/undefined pair, so the routing engine never has
-- to guess a default for a pair it doesn't recognize.
INSERT INTO "public"."rete_notification_routing_defaults" ("event_type", "channel", "mode") VALUES
  ('OFFER_RECEIVED', 'IN_APP', 'YES'), ('OFFER_RECEIVED', 'WEB_PUSH', 'NO'), ('OFFER_RECEIVED', 'EMAIL', 'DIGEST'), ('OFFER_RECEIVED', 'WHATSAPP', 'NO'),
  ('OFFER_AUTO_ACCEPTED', 'IN_APP', 'YES'), ('OFFER_AUTO_ACCEPTED', 'WEB_PUSH', 'YES'), ('OFFER_AUTO_ACCEPTED', 'EMAIL', 'DIGEST'), ('OFFER_AUTO_ACCEPTED', 'WHATSAPP', 'NO'),
  ('GOODS_TO_PREPARE', 'IN_APP', 'YES'), ('GOODS_TO_PREPARE', 'WEB_PUSH', 'YES'), ('GOODS_TO_PREPARE', 'EMAIL', 'DIGEST'), ('GOODS_TO_PREPARE', 'WHATSAPP', 'OPTIONAL_DISABLED'),
  ('GOODS_READY', 'IN_APP', 'YES'), ('GOODS_READY', 'WEB_PUSH', 'YES'), ('GOODS_READY', 'EMAIL', 'DIGEST'), ('GOODS_READY', 'WHATSAPP', 'NO'),
  ('TRANSFER_STARTED', 'IN_APP', 'YES'), ('TRANSFER_STARTED', 'WEB_PUSH', 'YES'), ('TRANSFER_STARTED', 'EMAIL', 'DIGEST'), ('TRANSFER_STARTED', 'WHATSAPP', 'NO'),
  ('TRANSFER_RECEIVED', 'IN_APP', 'YES'), ('TRANSFER_RECEIVED', 'WEB_PUSH', 'YES'), ('TRANSFER_RECEIVED', 'EMAIL', 'DIGEST'), ('TRANSFER_RECEIVED', 'WHATSAPP', 'NO'),
  ('TRASTA_PARTIAL_ARRIVAL', 'IN_APP', 'YES'), ('TRASTA_PARTIAL_ARRIVAL', 'WEB_PUSH', 'YES'), ('TRASTA_PARTIAL_ARRIVAL', 'EMAIL', 'DIGEST'), ('TRASTA_PARTIAL_ARRIVAL', 'WHATSAPP', 'NO'),
  ('TRASTA_FULL_ARRIVAL', 'IN_APP', 'YES'), ('TRASTA_FULL_ARRIVAL', 'WEB_PUSH', 'YES'), ('TRASTA_FULL_ARRIVAL', 'EMAIL', 'DIGEST'), ('TRASTA_FULL_ARRIVAL', 'WHATSAPP', 'NO'),
  ('REQUEST_CANCELLED', 'IN_APP', 'YES'), ('REQUEST_CANCELLED', 'WEB_PUSH', 'YES'), ('REQUEST_CANCELLED', 'EMAIL', 'DIGEST'), ('REQUEST_CANCELLED', 'WHATSAPP', 'NO'),
  ('EXCESS_STOCK_PUBLISHED', 'IN_APP', 'YES'), ('EXCESS_STOCK_PUBLISHED', 'WEB_PUSH', 'NO'), ('EXCESS_STOCK_PUBLISHED', 'EMAIL', 'DIGEST'), ('EXCESS_STOCK_PUBLISHED', 'WHATSAPP', 'NO'),
  ('EXCESS_STOCK_RESERVED', 'IN_APP', 'YES'), ('EXCESS_STOCK_RESERVED', 'WEB_PUSH', 'YES'), ('EXCESS_STOCK_RESERVED', 'EMAIL', 'DIGEST'), ('EXCESS_STOCK_RESERVED', 'WHATSAPP', 'NO'),
  ('EXCESS_GOODS_TO_PREPARE', 'IN_APP', 'YES'), ('EXCESS_GOODS_TO_PREPARE', 'WEB_PUSH', 'YES'), ('EXCESS_GOODS_TO_PREPARE', 'EMAIL', 'DIGEST'), ('EXCESS_GOODS_TO_PREPARE', 'WHATSAPP', 'NO'),
  ('EXCESS_TRANSFER_STARTED', 'IN_APP', 'YES'), ('EXCESS_TRANSFER_STARTED', 'WEB_PUSH', 'YES'), ('EXCESS_TRANSFER_STARTED', 'EMAIL', 'DIGEST'), ('EXCESS_TRANSFER_STARTED', 'WHATSAPP', 'NO'),
  ('EXCESS_TRANSFER_RECEIVED', 'IN_APP', 'YES'), ('EXCESS_TRANSFER_RECEIVED', 'WEB_PUSH', 'YES'), ('EXCESS_TRANSFER_RECEIVED', 'EMAIL', 'DIGEST'), ('EXCESS_TRANSFER_RECEIVED', 'WHATSAPP', 'NO'),
  ('SYSTEM_EXCEPTION', 'IN_APP', 'YES'), ('SYSTEM_EXCEPTION', 'WEB_PUSH', 'YES'), ('SYSTEM_EXCEPTION', 'EMAIL', 'IMMEDIATE'), ('SYSTEM_EXCEPTION', 'WHATSAPP', 'NO'),
  -- Events that exist in the enum (excess-stock lifecycle detail) but are
  -- not enumerated in the Phase 3 matrix - conservative, IN_APP-only
  -- defaults, no push/email/whatsapp broadcast, matching the "do not
  -- broadcast every publication/lifecycle event" instruction.
  ('EXCESS_STOCK_PARTIALLY_RESERVED', 'IN_APP', 'YES'), ('EXCESS_STOCK_PARTIALLY_RESERVED', 'WEB_PUSH', 'NO'), ('EXCESS_STOCK_PARTIALLY_RESERVED', 'EMAIL', 'DIGEST'), ('EXCESS_STOCK_PARTIALLY_RESERVED', 'WHATSAPP', 'NO'),
  ('EXCESS_STOCK_FULLY_RESERVED', 'IN_APP', 'YES'), ('EXCESS_STOCK_FULLY_RESERVED', 'WEB_PUSH', 'NO'), ('EXCESS_STOCK_FULLY_RESERVED', 'EMAIL', 'DIGEST'), ('EXCESS_STOCK_FULLY_RESERVED', 'WHATSAPP', 'NO'),
  ('EXCESS_STOCK_EXPIRED', 'IN_APP', 'YES'), ('EXCESS_STOCK_EXPIRED', 'WEB_PUSH', 'NO'), ('EXCESS_STOCK_EXPIRED', 'EMAIL', 'DIGEST'), ('EXCESS_STOCK_EXPIRED', 'WHATSAPP', 'NO'),
  ('EXCESS_STOCK_WITHDRAWN', 'IN_APP', 'YES'), ('EXCESS_STOCK_WITHDRAWN', 'WEB_PUSH', 'NO'), ('EXCESS_STOCK_WITHDRAWN', 'EMAIL', 'DIGEST'), ('EXCESS_STOCK_WITHDRAWN', 'WHATSAPP', 'NO')
ON CONFLICT ("event_type", "channel") DO NOTHING;

COMMIT;
