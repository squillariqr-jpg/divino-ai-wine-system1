-- Migration 1: create_rete_squillari_core_schema



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."rete_offer_status" AS ENUM (
    'PROPOSTA',
    'APPROVATA',
    'RITIRATA',
    'RIFIUTATA'
);


ALTER TYPE "public"."rete_offer_status" OWNER TO "postgres";


CREATE TYPE "public"."rete_request_status" AS ENUM (
    'DA_VERIFICARE',
    'DA_TROVARE',
    'DA_CONFERMARE',
    'DA_PREPARARE',
    'IN_TRASFERIMENTO',
    'ARRIVO_PARZIALE_A_TRASTA',
    'ARRIVATO_A_TRASTA',
    'RICEVUTA',
    'CHIUSA',
    'ANNULLATA'
);


ALTER TYPE "public"."rete_request_status" OWNER TO "postgres";


CREATE TYPE "public"."rete_transfer_status" AS ENUM (
    'DA_PREPARARE',
    'PRONTA',
    'IN_TRASFERIMENTO',
    'RICEVUTA',
    'ANNULLATA'
);


ALTER TYPE "public"."rete_transfer_status" OWNER TO "postgres";


CREATE TYPE "public"."rete_user_role" AS ENUM (
    'central',
    'store'
);


ALTER TYPE "public"."rete_user_role" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."rete_audit_events" (
    "id" bigint NOT NULL,
    "actor_user_id" "uuid",
    "event_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rete_audit_events_entity_type_check" CHECK ((("length"(TRIM(BOTH FROM "entity_type")) >= 1) AND ("length"(TRIM(BOTH FROM "entity_type")) <= 100))),
    CONSTRAINT "rete_audit_events_event_type_check" CHECK ((("length"(TRIM(BOTH FROM "event_type")) >= 1) AND ("length"(TRIM(BOTH FROM "event_type")) <= 100)))
);


ALTER TABLE "public"."rete_audit_events" OWNER TO "postgres";


ALTER TABLE "public"."rete_audit_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."rete_audit_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."rete_locations" (
    "id" smallint NOT NULL,
    "code" smallint NOT NULL,
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rete_locations_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 80)))
);


ALTER TABLE "public"."rete_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rete_memberships" (
    "user_id" "uuid" NOT NULL,
    "role" "public"."rete_user_role" NOT NULL,
    "location_id" smallint,
    "display_name" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "membership_role_location_check" CHECK (((("role" = 'central'::"public"."rete_user_role") AND ("location_id" IS NULL)) OR (("role" = 'store'::"public"."rete_user_role") AND ("location_id" IS NOT NULL)))),
    CONSTRAINT "rete_memberships_display_name_check" CHECK ((("display_name" IS NULL) OR (("length"(TRIM(BOTH FROM "display_name")) >= 1) AND ("length"(TRIM(BOTH FROM "display_name")) <= 120))))
);


ALTER TABLE "public"."rete_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rete_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "offering_location_id" smallint NOT NULL,
    "offered_quantity" integer NOT NULL,
    "approved_quantity" integer,
    "status" "public"."rete_offer_status" DEFAULT 'PROPOSTA'::"public"."rete_offer_status" NOT NULL,
    "offered_by" "uuid" NOT NULL,
    "approved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rete_offers_check" CHECK ((("approved_quantity" IS NULL) OR (("approved_quantity" >= 0) AND ("approved_quantity" <= "offered_quantity")))),
    CONSTRAINT "rete_offers_offered_quantity_check" CHECK (("offered_quantity" > 0))
);


ALTER TABLE "public"."rete_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rete_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requesting_location_id" smallint NOT NULL,
    "product_code" "text" NOT NULL,
    "product_description" "text" NOT NULL,
    "requested_quantity" integer NOT NULL,
    "remaining_quantity" integer NOT NULL,
    "status" "public"."rete_request_status" DEFAULT 'DA_VERIFICARE'::"public"."rete_request_status" NOT NULL,
    "urgency" "text" DEFAULT 'NORMALE'::"text" NOT NULL,
    "source" "text" DEFAULT 'MANUAL'::"text" NOT NULL,
    "source_reference" "text",
    "notes" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    CONSTRAINT "rete_requests_check" CHECK ((("remaining_quantity" >= 0) AND ("remaining_quantity" <= "requested_quantity"))),
    CONSTRAINT "rete_requests_notes_check" CHECK ((("notes" IS NULL) OR ("length"("notes") <= 2000))),
    CONSTRAINT "rete_requests_product_code_check" CHECK ((("length"(TRIM(BOTH FROM "product_code")) >= 1) AND ("length"(TRIM(BOTH FROM "product_code")) <= 64))),
    CONSTRAINT "rete_requests_product_description_check" CHECK ((("length"(TRIM(BOTH FROM "product_description")) >= 1) AND ("length"(TRIM(BOTH FROM "product_description")) <= 240))),
    CONSTRAINT "rete_requests_requested_quantity_check" CHECK (("requested_quantity" > 0)),
    CONSTRAINT "rete_requests_source_check" CHECK (("source" = ANY (ARRAY['MANUAL'::"text", 'EMAIL'::"text", 'TRASTA_ARRIVAL'::"text", 'DEMO'::"text"]))),
    CONSTRAINT "rete_requests_urgency_check" CHECK (("urgency" = ANY (ARRAY['BASSA'::"text", 'NORMALE'::"text", 'ALTA'::"text"])))
);


ALTER TABLE "public"."rete_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rete_transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "offer_id" "uuid" NOT NULL,
    "from_location_id" smallint NOT NULL,
    "to_location_id" smallint NOT NULL,
    "quantity" integer NOT NULL,
    "status" "public"."rete_transfer_status" DEFAULT 'DA_PREPARARE'::"public"."rete_transfer_status" NOT NULL,
    "approved_by" "uuid" NOT NULL,
    "prepared_at" timestamp with time zone,
    "departed_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    "received_by" "uuid",
    "anomaly_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rete_transfers_anomaly_note_check" CHECK ((("anomaly_note" IS NULL) OR ("length"("anomaly_note") <= 2000))),
    CONSTRAINT "rete_transfers_check" CHECK (("from_location_id" <> "to_location_id")),
    CONSTRAINT "rete_transfers_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."rete_transfers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rete_trasta_arrivals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_code" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "source_reference" "text",
    "arrived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recorded_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rete_trasta_arrivals_product_code_check" CHECK ((("length"(TRIM(BOTH FROM "product_code")) >= 1) AND ("length"(TRIM(BOTH FROM "product_code")) <= 64))),
    CONSTRAINT "rete_trasta_arrivals_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."rete_trasta_arrivals" OWNER TO "postgres";


ALTER TABLE ONLY "public"."rete_audit_events"
    ADD CONSTRAINT "rete_audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rete_locations"
    ADD CONSTRAINT "rete_locations_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."rete_locations"
    ADD CONSTRAINT "rete_locations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."rete_locations"
    ADD CONSTRAINT "rete_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rete_memberships"
    ADD CONSTRAINT "rete_memberships_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."rete_offers"
    ADD CONSTRAINT "rete_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rete_offers"
    ADD CONSTRAINT "rete_offers_request_id_offering_location_id_key" UNIQUE ("request_id", "offering_location_id");



ALTER TABLE ONLY "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_offer_id_key" UNIQUE ("offer_id");



ALTER TABLE ONLY "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rete_trasta_arrivals"
    ADD CONSTRAINT "rete_trasta_arrivals_pkey" PRIMARY KEY ("id");



CREATE INDEX "rete_audit_entity_idx" ON "public"."rete_audit_events" USING "btree" ("entity_type", "entity_id", "created_at" DESC);



CREATE INDEX "rete_memberships_location_idx" ON "public"."rete_memberships" USING "btree" ("location_id") WHERE "active";



CREATE INDEX "rete_offers_location_idx" ON "public"."rete_offers" USING "btree" ("offering_location_id", "created_at" DESC);



CREATE INDEX "rete_offers_request_idx" ON "public"."rete_offers" USING "btree" ("request_id", "status");



CREATE INDEX "rete_requests_location_idx" ON "public"."rete_requests" USING "btree" ("requesting_location_id", "created_at" DESC);



CREATE INDEX "rete_requests_product_idx" ON "public"."rete_requests" USING "btree" ("product_code");



CREATE INDEX "rete_requests_status_idx" ON "public"."rete_requests" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "rete_transfers_from_idx" ON "public"."rete_transfers" USING "btree" ("from_location_id", "status");



CREATE INDEX "rete_transfers_request_idx" ON "public"."rete_transfers" USING "btree" ("request_id", "status");



CREATE INDEX "rete_transfers_to_idx" ON "public"."rete_transfers" USING "btree" ("to_location_id", "status");



CREATE INDEX "rete_trasta_arrivals_product_idx" ON "public"."rete_trasta_arrivals" USING "btree" ("product_code", "arrived_at" DESC);



ALTER TABLE ONLY "public"."rete_audit_events"
    ADD CONSTRAINT "rete_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rete_memberships"
    ADD CONSTRAINT "rete_memberships_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."rete_locations"("id");



ALTER TABLE ONLY "public"."rete_memberships"
    ADD CONSTRAINT "rete_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rete_offers"
    ADD CONSTRAINT "rete_offers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rete_offers"
    ADD CONSTRAINT "rete_offers_offered_by_fkey" FOREIGN KEY ("offered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rete_offers"
    ADD CONSTRAINT "rete_offers_offering_location_id_fkey" FOREIGN KEY ("offering_location_id") REFERENCES "public"."rete_locations"("id");



ALTER TABLE ONLY "public"."rete_offers"
    ADD CONSTRAINT "rete_offers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."rete_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_requesting_location_id_fkey" FOREIGN KEY ("requesting_location_id") REFERENCES "public"."rete_locations"("id");



ALTER TABLE ONLY "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "public"."rete_locations"("id");



ALTER TABLE ONLY "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."rete_offers"("id");



ALTER TABLE ONLY "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."rete_requests"("id");



ALTER TABLE ONLY "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."rete_locations"("id");



ALTER TABLE ONLY "public"."rete_trasta_arrivals"
    ADD CONSTRAINT "rete_trasta_arrivals_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id");



CREATE POLICY "active members read offers" ON "public"."rete_offers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active"))));



CREATE POLICY "active members read requests" ON "public"."rete_requests" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active"))));



CREATE POLICY "active members read transfers" ON "public"."rete_transfers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active"))));



CREATE POLICY "active members read trasta arrivals" ON "public"."rete_trasta_arrivals" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active"))));



CREATE POLICY "authenticated members read locations" ON "public"."rete_locations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active"))));



CREATE POLICY "central creates transfers" ON "public"."rete_transfers" FOR INSERT TO "authenticated" WITH CHECK ((("approved_by" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND ("m"."role" = 'central'::"public"."rete_user_role"))))));



CREATE POLICY "central or involved stores update transfers" ON "public"."rete_transfers" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND (("m"."role" = 'central'::"public"."rete_user_role") OR ("m"."location_id" = ANY (ARRAY["rete_transfers"."from_location_id", "rete_transfers"."to_location_id"]))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND (("m"."role" = 'central'::"public"."rete_user_role") OR ("m"."location_id" = ANY (ARRAY["rete_transfers"."from_location_id", "rete_transfers"."to_location_id"])))))));



CREATE POLICY "central reads audit" ON "public"."rete_audit_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND ("m"."role" = 'central'::"public"."rete_user_role")))));



CREATE POLICY "central records trasta arrivals" ON "public"."rete_trasta_arrivals" FOR INSERT TO "authenticated" WITH CHECK ((("recorded_by" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND ("m"."role" = 'central'::"public"."rete_user_role"))))));



CREATE POLICY "offering store or central updates offers" ON "public"."rete_offers" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND (("m"."role" = 'central'::"public"."rete_user_role") OR ("m"."location_id" = "rete_offers"."offering_location_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND (("m"."role" = 'central'::"public"."rete_user_role") OR (("m"."location_id" = "rete_offers"."offering_location_id") AND ("rete_offers"."status" = ANY (ARRAY['PROPOSTA'::"public"."rete_offer_status", 'RITIRATA'::"public"."rete_offer_status"])) AND ("rete_offers"."approved_quantity" IS NULL) AND ("rete_offers"."approved_by" IS NULL)))))));



CREATE POLICY "requesting store or central deletes requests" ON "public"."rete_requests" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND (("m"."role" = 'central'::"public"."rete_user_role") OR ("m"."location_id" = "rete_requests"."requesting_location_id"))))));



CREATE POLICY "requesting store or central updates requests" ON "public"."rete_requests" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND (("m"."role" = 'central'::"public"."rete_user_role") OR ("m"."location_id" = "rete_requests"."requesting_location_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND (("m"."role" = 'central'::"public"."rete_user_role") OR ("m"."location_id" = "rete_requests"."requesting_location_id"))))));



ALTER TABLE "public"."rete_audit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rete_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rete_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rete_offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rete_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rete_transfers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rete_trasta_arrivals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stores create offers for own location" ON "public"."rete_offers" FOR INSERT TO "authenticated" WITH CHECK ((("offered_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = 'PROPOSTA'::"public"."rete_offer_status") AND ("approved_quantity" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND ("m"."role" = 'store'::"public"."rete_user_role") AND ("m"."location_id" = "rete_offers"."offering_location_id")))) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."rete_requests" "r"
  WHERE (("r"."id" = "rete_offers"."request_id") AND ("r"."requesting_location_id" = "rete_offers"."offering_location_id")))))));



CREATE POLICY "stores create own requests and central creates any" ON "public"."rete_requests" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND (("m"."role" = 'central'::"public"."rete_user_role") OR ("m"."location_id" = "rete_requests"."requesting_location_id")))))));



CREATE POLICY "users read own membership" ON "public"."rete_memberships" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND "active"));







ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON SEQUENCE "public"."rete_audit_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rete_audit_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rete_audit_events_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."rete_audit_events" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rete_audit_events" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_audit_events" TO "service_role";

GRANT ALL ON TABLE "public"."rete_locations" TO "anon";
GRANT ALL ON TABLE "public"."rete_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_locations" TO "service_role";

GRANT ALL ON TABLE "public"."rete_memberships" TO "anon";
GRANT ALL ON TABLE "public"."rete_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_memberships" TO "service_role";

GRANT ALL ON TABLE "public"."rete_offers" TO "anon";
GRANT ALL ON TABLE "public"."rete_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_offers" TO "service_role";

GRANT ALL ON TABLE "public"."rete_requests" TO "anon";
GRANT ALL ON TABLE "public"."rete_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_requests" TO "service_role";

GRANT ALL ON TABLE "public"."rete_transfers" TO "anon";
GRANT ALL ON TABLE "public"."rete_transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_transfers" TO "service_role";

GRANT ALL ON TABLE "public"."rete_trasta_arrivals" TO "anon";
GRANT ALL ON TABLE "public"."rete_trasta_arrivals" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_trasta_arrivals" TO "service_role";

-- Insert the six certified store locations. Trasta is not a store and is
-- intentionally not part of rete_locations.
INSERT INTO public.rete_locations (id, code, name, active) VALUES
(1, 101, 'Malta', true),
(2, 102, 'Sestri', true),
(3, 103, 'Cantore', true),
(4, 104, 'Trento', true),
(5, 105, 'De Ferrari', true),
(6, 106, 'Armenia', true) ON CONFLICT DO NOTHING;
