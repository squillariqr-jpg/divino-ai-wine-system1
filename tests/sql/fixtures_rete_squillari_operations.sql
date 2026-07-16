-- Synthetic, local-only fixtures for tests/test_rete_squillari_operations_rpc.py
-- Never touches the linked/remote project. Safe to re-run (ON CONFLICT DO NOTHING).
INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('11111111-0000-0000-0000-000000000001', 'sql-test-central1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000002', 'sql-test-malta1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000003', 'sql-test-sestri1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000004', 'sql-test-cantore1@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000005', 'sql-test-nomembership@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('11111111-0000-0000-0000-000000000006', 'sql-test-inactive@local.invalid', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rete_memberships (user_id, role, location_id, display_name, active)
VALUES
  ('11111111-0000-0000-0000-000000000001', 'central', NULL, 'SQL Test Central', true),
  ('11111111-0000-0000-0000-000000000002', 'store', 1, 'SQL Test Malta', true),
  ('11111111-0000-0000-0000-000000000003', 'store', 2, 'SQL Test Sestri', true),
  ('11111111-0000-0000-0000-000000000004', 'store', 3, 'SQL Test Cantore', true),
  ('11111111-0000-0000-0000-000000000006', 'store', 1, 'SQL Test Inactive', false)
ON CONFLICT (user_id) DO NOTHING;
