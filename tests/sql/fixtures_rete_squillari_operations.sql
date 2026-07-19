-- Synthetic, local-only fixtures for tests/test_rete_squillari_operations_rpc.py
-- Never touches the linked/remote project. Safe to re-run (ON CONFLICT DO UPDATE
-- for memberships, so pilot_enabled/active are deterministic across repeated
-- fixture loads against the same long-lived local DB, not only after a fresh
-- `supabase db reset --local`).
INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('11111111-0000-0000-0000-000000000001', 'sql-test-central1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000002', 'sql-test-malta1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000003', 'sql-test-sestri1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000004', 'sql-test-cantore1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000005', 'sql-test-nomembership@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000006', 'sql-test-inactive@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000008', 'sql-test-nonpilot1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- pilot_enabled is set explicitly per row here (never defaulted-true, never
-- set via any RPC or client path): central1/malta1/sestri1/cantore1 are the
-- pilot-enabled identities used for the happy-path/authorized tests;
-- nonpilot1 is an otherwise-identical active store membership with
-- pilot_enabled=false, used exclusively to prove a real, active,
-- correctly-membershipped but non-pilot identity is still denied by every
-- RPC. inactive is both inactive AND non-pilot (irrelevant which check
-- fires first, both must deny).
-- location_id values are the certified canonical WBOS retail location IDs
-- (Malta=2, Sestri=4, Cantore=5, Trento=6 - see
-- 20260719130000_rete_squillari_canonical_location_reconciliation.sql).
INSERT INTO public.rete_memberships (user_id, role, location_id, display_name, active, pilot_enabled)
VALUES
  ('11111111-0000-0000-0000-000000000001', 'central', NULL, 'SQL Test Central', true, true),
  ('11111111-0000-0000-0000-000000000002', 'store', 2, 'SQL Test Malta', true, true),
  ('11111111-0000-0000-0000-000000000003', 'store', 4, 'SQL Test Sestri', true, true),
  ('11111111-0000-0000-0000-000000000004', 'store', 5, 'SQL Test Cantore', true, true),
  ('11111111-0000-0000-0000-000000000006', 'store', 2, 'SQL Test Inactive', false, false),
  ('11111111-0000-0000-0000-000000000008', 'store', 6, 'SQL Test Non-Pilot', true, false)
ON CONFLICT (user_id) DO UPDATE SET
  role = EXCLUDED.role,
  location_id = EXCLUDED.location_id,
  display_name = EXCLUDED.display_name,
  active = EXCLUDED.active,
  pilot_enabled = EXCLUDED.pilot_enabled;
