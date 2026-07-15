-- Migration 2: harden_rete_squillari_anon_privileges
REVOKE ALL PRIVILEGES ON TABLE "public"."rete_audit_events" FROM "anon";
REVOKE ALL PRIVILEGES ON SEQUENCE "public"."rete_audit_events_id_seq" FROM "anon";
REVOKE ALL PRIVILEGES ON TABLE "public"."rete_locations" FROM "anon";
REVOKE ALL PRIVILEGES ON TABLE "public"."rete_memberships" FROM "anon";
REVOKE ALL PRIVILEGES ON TABLE "public"."rete_offers" FROM "anon";
REVOKE ALL PRIVILEGES ON TABLE "public"."rete_requests" FROM "anon";
REVOKE ALL PRIVILEGES ON TABLE "public"."rete_transfers" FROM "anon";
REVOKE ALL PRIVILEGES ON TABLE "public"."rete_trasta_arrivals" FROM "anon";
