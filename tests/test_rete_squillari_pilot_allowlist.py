"""Rete Squillari — Pilot Server-Side Allowlist REST/Concurrency Test Suite.

Runs exclusively against the LOCAL Supabase stack (port 54321).
Never targets the linked/remote project. No real PINs, no real service-role key.

Coverage:
  1. anon rejected on all 9 RPCs (401)
  2. authenticated non-pilot rejected on all 9 RPCs ("no active membership")
  3. authenticated pilot succeeds on at least one representative RPC
  4. Direct PATCH of rete_memberships.pilot_enabled rejected (HTTP 200/0-rows or 403);
     DB value verified unchanged via direct psql admin query
  5. user_metadata spoofing: JWT sub with misleading metadata but non-pilot
     membership still rejected by every RPC
  6. Kill-switch: idempotency replay rejected after pilot_enabled=false
  7. Concurrency tests:
     a. Two simultaneous calls from the same pilot user (no duplicate rows)
     b. Pilot store and non-pilot store calling simultaneously (pilot succeeds,
        non-pilot denied, no bleed)
     c. Simultaneous approval by central-pilot and store-pilot offer-withdraw
        (exactly one winner/state)
     d. Pilot-disable races a concurrent RPC (kill-switch linearization)
     e. Two different idempotency keys on the same resource (no oversubscription)
"""

import json
import os
import subprocess
import threading
import time
import unittest
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import jwt as pyjwt
except ImportError:
    import subprocess as _sp
    _sp.run(["pip", "install", "--quiet", "PyJWT"], check=True)
    import jwt as pyjwt

REST_URL  = "http://127.0.0.1:54321/rest/v1/rpc"
LOCAL_JWT_SECRET = os.environ.get("LOCAL_JWT_SECRET", "super-secret-jwt-token-with-at-least-32-characters-long")

# Fixture UUIDs (must match fixtures_rete_squillari_operations.sql)
CENTRAL_ID    = "11111111-0000-0000-0000-000000000001"
MALTA_ID      = "11111111-0000-0000-0000-000000000002"
SESTRI_ID     = "11111111-0000-0000-0000-000000000003"
CANTORE_ID    = "11111111-0000-0000-0000-000000000004"
NOMEMBERSHIP_ID = "11111111-0000-0000-0000-000000000005"
INACTIVE_ID   = "11111111-0000-0000-0000-000000000006"
NONPILOT_ID   = "11111111-0000-0000-0000-000000000008"


def local_jwt(sub, extra_claims=None):
    claims = {"sub": sub, "role": "authenticated", "aud": "authenticated"}
    if extra_claims:
        claims.update(extra_claims)
    return pyjwt.encode(claims, LOCAL_JWT_SECRET, algorithm="HS256")


def call_rpc(function_name, payload, token, timeout=15):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7NFK6AAIpce7EBsSTSjFRi1GPXhJPEhCM_s",
    }
    req = urllib.request.Request(
        f"{REST_URL}/{function_name}",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def call_rpc_anon(function_name, payload, timeout=10):
    """Call an RPC without any Bearer token (anon)."""
    headers = {
        "Content-Type": "application/json",
        "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7NFK6AAIpce7EBsSTSjFRi1GPXhJPEhCM_s",
    }
    req = urllib.request.Request(
        f"{REST_URL}/{function_name}",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def run_psql(sql, check=True):
    """Direct psql execution — operator-style path, same as kill switch."""
    result = subprocess.run(
        ["psql", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1", "-c", sql],
        env={**os.environ, "PGPASSWORD": "postgres"},
        check=check, capture_output=True, text=True,
    )
    return result.stdout, result.returncode


def psql_scalar(sql):
    """Return a single scalar value from a psql query."""
    out, _ = run_psql(f"COPY ({sql}) TO STDOUT;")
    return out.strip()


# All 9 RPC names with minimal payloads sufficient to reach the auth gate
ALL_9_RPCS_NONPILOT = [
    ("rete_request_publish",   {"p_requesting_location_id": 6, "p_product_code": "NP", "p_product_description": "NP", "p_requested_quantity": 1, "p_idempotency_key": "anon-np-rp"}),
    ("rete_offer_create",      {"p_request_id": "00000000-0000-0000-0000-000000000000", "p_offered_quantity": 1, "p_idempotency_key": "anon-np-oc"}),
    ("rete_offer_withdraw",    {"p_offer_id": "00000000-0000-0000-0000-000000000000", "p_idempotency_key": "anon-np-ow"}),
    ("rete_offer_approve",     {"p_offer_id": "00000000-0000-0000-0000-000000000000", "p_approved_quantity": 1, "p_idempotency_key": "anon-np-oa"}),
    ("rete_offer_reject",      {"p_offer_id": "00000000-0000-0000-0000-000000000000", "p_idempotency_key": "anon-np-or"}),
    ("rete_transfer_mark_ready",    {"p_transfer_id": "00000000-0000-0000-0000-000000000000", "p_idempotency_key": "anon-np-tmr"}),
    ("rete_transfer_mark_departed", {"p_transfer_id": "00000000-0000-0000-0000-000000000000", "p_idempotency_key": "anon-np-tmd"}),
    ("rete_transfer_receive",  {"p_transfer_id": "00000000-0000-0000-0000-000000000000", "p_received_quantity": 1, "p_idempotency_key": "anon-np-tr"}),
    ("rete_trasta_arrival_record", {"p_target_request_id": "00000000-0000-0000-0000-000000000000", "p_product_code": "X", "p_quantity": 1, "p_idempotency_key": "anon-np-tar"}),
]


class TestAnonDenied(unittest.TestCase):
    """anon (no Bearer token) must be denied on all 9 RPCs."""

    def test_anon_denied_all_9_rpcs(self):
        for name, payload in ALL_9_RPCS_NONPILOT:
            with self.subTest(rpc=name):
                # Change idempotency key prefix to avoid collision with nonpilot tests
                p = {**payload, "p_idempotency_key": f"anon-{name}"}
                status, body = call_rpc_anon(name, p)
                self.assertIn(status, (401, 403),
                    f"{name}: anon must be denied (got {status}: {body})")


class TestNonPilotDenied(unittest.TestCase):
    """Active, correctly-membershipped store with pilot_enabled=false must be
    denied by all 9 RPCs with the exact generic "no active membership" message."""

    def test_nonpilot_denied_all_9_rpcs(self):
        token = local_jwt(NONPILOT_ID)
        for name, payload in ALL_9_RPCS_NONPILOT:
            p = {**payload, "p_idempotency_key": f"np-rest-{name}"}
            with self.subTest(rpc=name):
                status, body = call_rpc(name, p, token)
                self.assertEqual(status, 400,
                    f"{name}: non-pilot must get 400 (got {status})")
                self.assertIn("no active membership", body.get("message", ""),
                    f"{name}: must use generic message, got: {body}")

    def test_nonpilot_no_idempotency_rows_created(self):
        """Verify no idempotency rows were created by the nonpilot calls above."""
        count = psql_scalar(
            "SELECT count(*) FROM public.rete_idempotent_operations "
            "WHERE idempotency_key LIKE 'np-rest-%'"
        )
        self.assertEqual(int(count), 0,
            f"Expected 0 idempotency rows for non-pilot calls, found {count}")

    def test_nonpilot_no_audit_rows_created(self):
        count = psql_scalar(
            f"SELECT count(*) FROM public.rete_audit_events "
            f"WHERE actor_user_id='{NONPILOT_ID}'::uuid"
        )
        self.assertEqual(int(count), 0,
            f"Expected 0 audit rows for non-pilot calls, found {count}")


class TestDirectPatchPilotEnabled(unittest.TestCase):
    """A direct PATCH to rete_memberships.pilot_enabled must not change the DB value.
    PostgREST with row-level security may return 200 with zero rows or 403 — both
    are acceptable HTTP outcomes, but the DB value MUST remain unchanged."""

    def test_direct_patch_pilot_enabled_no_db_change(self):
        token = local_jwt(MALTA_ID)

        # Read current value
        before = psql_scalar(
            f"SELECT pilot_enabled FROM public.rete_memberships WHERE user_id='{MALTA_ID}'"
        )

        # Attempt PATCH via REST
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7NFK6AAIpce7EBsSTSjFRi1GPXhJPEhCM_s",
            "Prefer": "return=minimal",
        }
        req = urllib.request.Request(
            f"http://127.0.0.1:54321/rest/v1/rete_memberships?user_id=eq.{MALTA_ID}",
            data=json.dumps({"pilot_enabled": False}).encode(),
            headers=headers,
            method="PATCH",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                http_status = resp.status
        except urllib.error.HTTPError as e:
            http_status = e.code

        # HTTP outcome: 200 with 0 rows (RLS silently filtered) or 403 — both OK
        self.assertIn(http_status, (200, 204, 403),
            f"PATCH returned unexpected status {http_status}")

        # Critical: DB value must be unchanged
        after = psql_scalar(
            f"SELECT pilot_enabled FROM public.rete_memberships WHERE user_id='{MALTA_ID}'"
        )
        self.assertEqual(before, after,
            f"CRITICAL: PATCH changed pilot_enabled in DB (before={before}, after={after})")


class TestUserMetadataSpoofing(unittest.TestCase):
    """A JWT with user_metadata claiming pilot_enabled=true / role=central
    must be denied if the actual rete_memberships row has pilot_enabled=false."""

    def test_spoofer_no_membership_denied(self):
        """User with lying metadata but NO membership row → denied."""
        # Use NONPILOT_ID as proxy (it has an active membership with pilot=false).
        # Add falsely-claiming extra claims to the JWT:
        token = local_jwt(NONPILOT_ID, extra_claims={
            "user_metadata": {"pilot_enabled": True, "role": "central"},
            "app_metadata": {"pilot_enabled": True, "role": "central"},
        })
        status, body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 2,
            "p_product_code": "SPOOF-PY",
            "p_product_description": "Spoof wine py",
            "p_requested_quantity": 1,
            "p_idempotency_key": "spoof-py-rp-1",
        }, token)
        self.assertEqual(status, 400,
            f"Spoofer JWT should be denied by server-side pilot check (got {status})")
        self.assertIn("no active membership", body.get("message", ""),
            f"Spoofer must get generic message, not a role-related one (got {body})")

    def test_spoofer_no_dml_created(self):
        count = psql_scalar(
            "SELECT count(*) FROM public.rete_idempotent_operations "
            "WHERE idempotency_key LIKE 'spoof-py-%'"
        )
        self.assertEqual(int(count), 0, f"Spoofer calls must create no idempotency rows")


class TestKillSwitchREST(unittest.TestCase):
    """Kill-switch via REST: pilot_enabled=false immediately blocks new calls
    and prevents cache replay of previously-successful idempotency keys."""

    def setUp(self):
        """Create a request to work against."""
        token_central = local_jwt(CENTRAL_ID)
        status, body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5,
            "p_product_code": "PY-KS-WINE",
            "p_product_description": "Python kill-switch wine",
            "p_requested_quantity": 5,
            "p_idempotency_key": "py-ks-setup-req-1",
        }, token_central)
        self.assertEqual(status, 200, f"setup: publish request failed: {body}")
        self.request_id = body["request_id"]

    def tearDown(self):
        """Ensure Malta's pilot is re-enabled even if a test fails."""
        run_psql(f"UPDATE public.rete_memberships SET pilot_enabled=true WHERE user_id='{MALTA_ID}';", check=False)

    def test_kill_switch_replay_rejected(self):
        """After pilot_enabled=false, the same idempotency key that previously
        succeeded must be rejected, not served from cache."""
        token_malta = local_jwt(MALTA_ID)
        KEY = "py-ks-offer-replay-test"

        # Successful call while pilot=true
        status, body = call_rpc("rete_offer_create", {
            "p_request_id": self.request_id,
            "p_offered_quantity": 2,
            "p_idempotency_key": KEY,
        }, token_malta)
        self.assertEqual(status, 200, f"pre-kill offer failed: {body}")

        # Kill switch
        run_psql(f"UPDATE public.rete_memberships SET pilot_enabled=false WHERE user_id='{MALTA_ID}';")

        # Retry with SAME key → must be denied, not cached result
        status, body = call_rpc("rete_offer_create", {
            "p_request_id": self.request_id,
            "p_offered_quantity": 2,
            "p_idempotency_key": KEY,
        }, token_malta)
        self.assertEqual(status, 400,
            f"replay after kill-switch must be denied 400 (got {status}: {body})")
        self.assertIn("no active membership", body.get("message", ""),
            f"replay after kill-switch must get generic denial message")

        # Verify no second offer row
        count = psql_scalar(
            f"SELECT count(*) FROM public.rete_offers WHERE request_id='{self.request_id}'"
        )
        self.assertEqual(int(count), 1,
            f"kill-switch replay must not create a second offer row")

    def test_kill_switch_new_call_rejected(self):
        """After kill-switch, even a brand-new call with a fresh key is rejected."""
        token_malta = local_jwt(MALTA_ID)
        run_psql(f"UPDATE public.rete_memberships SET pilot_enabled=false WHERE user_id='{MALTA_ID}';")

        status, body = call_rpc("rete_offer_create", {
            "p_request_id": self.request_id,
            "p_offered_quantity": 2,
            "p_idempotency_key": "py-ks-offer-fresh-after-kill",
        }, token_malta)
        self.assertEqual(status, 400,
            f"new call after kill-switch must be rejected (got {status}: {body})")

        # No idempotency row created
        count = psql_scalar(
            "SELECT count(*) FROM public.rete_idempotent_operations "
            "WHERE idempotency_key='py-ks-offer-fresh-after-kill'"
        )
        self.assertEqual(int(count), 0,
            "kill-switch: rejected new call must not create idempotency row")


class TestConcurrency(unittest.TestCase):
    """Real concurrent HTTP calls — separate threads / separate TCP connections."""

    @classmethod
    def setUpClass(cls):
        """Create a reusable base request for concurrency tests."""
        token = local_jwt(CENTRAL_ID)
        status, body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5,
            "p_product_code": "PY-CONCURRENT",
            "p_product_description": "Concurrency test wine",
            "p_requested_quantity": 20,
            "p_idempotency_key": "concurrent-base-req-1",
        }, token)
        assert status == 200, f"concurrency setUp failed: {body}"
        cls.request_id = body["request_id"]

    @classmethod
    def tearDownClass(cls):
        """Re-enable all pilots that might have been disabled during tests."""
        for uid in (MALTA_ID, SESTRI_ID, CANTORE_ID):
            run_psql(f"UPDATE public.rete_memberships SET pilot_enabled=true WHERE user_id='{uid}';", check=False)

    def test_two_simultaneous_pilot_calls_no_duplicate_rows(self):
        """Two concurrent rete_offer_create calls from two DIFFERENT pilot
        stores (Malta, Sestri) on the same request, each with its own
        idempotency key, must each create exactly one offer row. (A single
        store can only ever have one offer per request - unique constraint
        rete_offers_request_id_offering_location_id_key - so this uses two
        distinct offering stores rather than the same store twice. Uses its
        own dedicated fresh request, not the shared class-level one, since
        other test methods in this class also have Malta offer on the shared
        request.)"""
        token_central = local_jwt(CENTRAL_ID)
        _, pub_body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5,
            "p_product_code": "PY-CONC-DEDICATED",
            "p_product_description": "Dedicated concurrency wine",
            "p_requested_quantity": 20,
            "p_idempotency_key": "concurrent-dedicated-req-1",
        }, token_central)
        dedicated_request_id = pub_body["request_id"]

        results = {}

        def make_offer(token, key):
            s, b = call_rpc("rete_offer_create", {
                "p_request_id": dedicated_request_id,
                "p_offered_quantity": 3,
                "p_idempotency_key": key,
            }, token)
            results[key] = (s, b)

        t1 = threading.Thread(target=make_offer, args=(local_jwt(MALTA_ID), "concurrent-malta-offer-t1"))
        t2 = threading.Thread(target=make_offer, args=(local_jwt(SESTRI_ID), "concurrent-sestri-offer-t2"))
        t1.start(); t2.start()
        t1.join(); t2.join()

        # Both should succeed
        for key in ("concurrent-malta-offer-t1", "concurrent-sestri-offer-t2"):
            s, b = results[key]
            self.assertEqual(s, 200, f"{key}: concurrent call failed: {b}")
            self.assertIn("offer_id", b, f"{key}: missing offer_id in response")

        # Total idempotency rows for these two distinct keys: exactly 2
        count = psql_scalar(
            f"SELECT count(*) FROM public.rete_idempotent_operations "
            f"WHERE idempotency_key IN ('concurrent-malta-offer-t1','concurrent-sestri-offer-t2')"
        )
        self.assertEqual(int(count), 2,
            f"Expected 2 idempotency rows (one per concurrent call), got {count}")

    def test_pilot_and_nonpilot_concurrent_no_bleed(self):
        """Pilot store (Malta) and non-pilot store (NONPILOT) call the same RPC
        concurrently. Malta succeeds; NONPILOT is denied. No cross-contamination."""
        token_pilot = local_jwt(MALTA_ID)
        token_np    = local_jwt(NONPILOT_ID)
        results = {}

        def pilot_call():
            s, b = call_rpc("rete_offer_create", {
                "p_request_id": self.request_id,
                "p_offered_quantity": 3,
                "p_idempotency_key": "concurrent-pilot-np-malta",
            }, token_pilot)
            results["pilot"] = (s, b)

        def nonpilot_call():
            s, b = call_rpc("rete_offer_create", {
                "p_request_id": self.request_id,
                "p_offered_quantity": 3,
                "p_idempotency_key": "concurrent-pilot-np-nonpilot",
            }, token_np)
            results["nonpilot"] = (s, b)

        t1 = threading.Thread(target=pilot_call)
        t2 = threading.Thread(target=nonpilot_call)
        t1.start(); t2.start()
        t1.join(); t2.join()

        s_pilot, b_pilot = results["pilot"]
        s_np, b_np = results["nonpilot"]

        self.assertEqual(s_pilot, 200, f"pilot concurrent call failed: {b_pilot}")
        self.assertEqual(s_np, 400, f"nonpilot concurrent call should be denied: {b_np}")
        self.assertIn("no active membership", b_np.get("message", ""),
            f"nonpilot concurrent: wrong denial message: {b_np}")

        # No idempotency row for nonpilot call
        count = psql_scalar(
            "SELECT count(*) FROM public.rete_idempotent_operations "
            "WHERE idempotency_key='concurrent-pilot-np-nonpilot'"
        )
        self.assertEqual(int(count), 0,
            "nonpilot concurrent call must not create an idempotency row")

    def test_kill_switch_concurrent_with_rpc(self):
        """Demonstrates kill-switch linearization: a disable UPDATE racing with
        an RPC results in deterministic behavior — either:
          a. RPC completes (acquired FOR KEY SHARE before UPDATE committed), OR
          b. RPC is rejected (UPDATE committed first, RPC reads pilot=false).
        In both cases: no idempotency row is created by a rejected RPC.
        No phantom data, no negative quantities, no bypass.
        """
        token = local_jwt(SESTRI_ID)
        # Ensure Sestri is pilot-enabled
        run_psql(f"UPDATE public.rete_memberships SET pilot_enabled=true WHERE user_id='{SESTRI_ID}';")

        # Make a fresh request for Sestri concurrency test
        token_central = local_jwt(CENTRAL_ID)
        _, req_body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5,
            "p_product_code": "PY-KS-CONCURRENT",
            "p_product_description": "Kill-switch concurrent wine",
            "p_requested_quantity": 10,
            "p_idempotency_key": "concurrent-ks-req-1",
        }, token_central)
        ks_request_id = req_body["request_id"]

        rpc_result = {}

        def rpc_call():
            time.sleep(0.02)  # slight delay so disable fires around same time
            s, b = call_rpc("rete_offer_create", {
                "p_request_id": ks_request_id,
                "p_offered_quantity": 5,
                "p_idempotency_key": "concurrent-ks-sestri-offer-1",
            }, token, timeout=20)
            rpc_result["status"] = s
            rpc_result["body"] = b

        def disable_call():
            # Disable Sestri while the RPC thread is running
            run_psql(f"UPDATE public.rete_memberships SET pilot_enabled=false WHERE user_id='{SESTRI_ID}';")

        t_rpc     = threading.Thread(target=rpc_call)
        t_disable = threading.Thread(target=disable_call)
        t_rpc.start(); t_disable.start()
        t_rpc.join(); t_disable.join()

        s = rpc_result["status"]
        b = rpc_result["body"]

        # Either outcome is valid (linearization point determines which wins)
        if s == 200:
            # RPC won the race (acquired lock before UPDATE committed)
            # Verify exactly one offer row and one idempotency row
            offer_count = int(psql_scalar(
                f"SELECT count(*) FROM public.rete_idempotent_operations "
                f"WHERE idempotency_key='concurrent-ks-sestri-offer-1'"
            ))
            self.assertEqual(offer_count, 1,
                f"concurrent kill-switch: RPC succeeded, must have exactly 1 idempotency row")
        elif s == 400:
            # Kill-switch won the race
            self.assertIn("no active membership", b.get("message", ""),
                f"concurrent kill-switch: RPC denied, must use generic message")
            count = int(psql_scalar(
                "SELECT count(*) FROM public.rete_idempotent_operations "
                "WHERE idempotency_key='concurrent-ks-sestri-offer-1'"
            ))
            self.assertEqual(count, 0,
                f"concurrent kill-switch: rejected RPC must not create idempotency row")
        else:
            self.fail(f"Unexpected HTTP status {s} during kill-switch concurrency test: {b}")

        # Re-enable Sestri for subsequent tests
        run_psql(f"UPDATE public.rete_memberships SET pilot_enabled=true WHERE user_id='{SESTRI_ID}';")

    def test_two_idempotency_keys_same_resource_no_oversubscription(self):
        """Two concurrent MANUAL approval calls with DIFFERENT idempotency keys
        on the same offer must not double-approve or double-transfer.

        Since rete_offer_create (automatic offer acceptance) now resolves a
        normal offer straight to APPROVATA - with its transfer already
        created - in the SAME transaction that creates it, there is no
        PROPOSTA window left for rete_offer_approve to win a race against:
        rete_offer_approve only accepts an offer in
        ('PROPOSTA','DATA_REVIEW','CONFLICT_REVIEW','ARRIVAL_CONFLICT'), and
        this offer is already APPROVATA by the time either concurrent call
        starts. Both manual-approval attempts must be rejected consistently
        - the "exactly one winner" race this test exercised previously is now
        won, atomically, by rete_offer_create itself before either thread
        runs. The invariant this test protects (no double transfer, no
        oversubscription) still holds and is asserted below."""

        token_central = local_jwt(CENTRAL_ID)

        # Create a fresh request and a fresh offer - auto-accepted immediately.
        _, req_body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5,
            "p_product_code": "PY-DOUBLEAPPROVE",
            "p_product_description": "Double-approve wine",
            "p_requested_quantity": 5,
            "p_idempotency_key": "concurrent-double-req-1",
        }, token_central)
        da_request_id = req_body["request_id"]

        token_malta = local_jwt(MALTA_ID)
        _, offer_body = call_rpc("rete_offer_create", {
            "p_request_id": da_request_id,
            "p_offered_quantity": 5,
            "p_idempotency_key": "concurrent-double-offer-1",
        }, token_malta)
        da_offer_id = offer_body["offer_id"]
        self.assertEqual(offer_body.get("status"), "APPROVATA",
            f"offer must already be auto-accepted before either manual approve call: {offer_body}")

        results = {}

        def approve(key):
            s, b = call_rpc("rete_offer_approve", {
                "p_offer_id": da_offer_id,
                "p_approved_quantity": 3,
                "p_idempotency_key": key,
            }, token_central, timeout=20)
            results[key] = (s, b)

        t1 = threading.Thread(target=approve, args=("concurrent-approve-key-A",))
        t2 = threading.Thread(target=approve, args=("concurrent-approve-key-B",))
        t1.start(); t2.start()
        t1.join(); t2.join()

        statuses = {k: v[0] for k, v in results.items()}
        # Both must be rejected: the offer already left the
        # approve-eligible status set the instant it was created.
        self.assertTrue(all(s == 400 for s in statuses.values()),
            f"Both manual approvals must be rejected (already auto-accepted); got statuses: {statuses}")

        # Exactly one transfer row must exist (created by rete_offer_create
        # itself, not by either rejected manual-approve call).
        transfer_count = int(psql_scalar(
            f"SELECT count(*) FROM public.rete_transfers WHERE offer_id='{da_offer_id}'"
        ))
        self.assertEqual(transfer_count, 1,
            f"Exactly one transfer must exist from automatic acceptance; got {transfer_count}")

        # remaining_quantity must be non-negative
        remaining = int(psql_scalar(
            f"SELECT remaining_quantity FROM public.rete_requests WHERE id='{da_request_id}'"
        ))
        self.assertGreaterEqual(remaining, 0,
            f"remaining_quantity must never be negative; got {remaining}")

    def test_concurrent_offer_withdraw_vs_approve(self):
        """Concurrent manual offer-approve (central) and offer-withdraw
        (Malta) on the same offer, post automatic offer acceptance.

        rete_offer_create now auto-accepts a normal offer (and creates its
        transfer) in the same transaction that creates it, so by the time
        either concurrent manual call starts the offer is already APPROVATA:
        rete_offer_approve only accepts
        ('PROPOSTA','DATA_REVIEW','CONFLICT_REVIEW','ARRIVAL_CONFLICT'), and
        rete_offer_withdraw only accepts 'PROPOSTA' - neither matches
        APPROVATA. Both manual calls must be rejected; the transfer created
        by automatic acceptance must be the only one that exists."""
        token_central = local_jwt(CENTRAL_ID)
        token_malta   = local_jwt(MALTA_ID)

        # Create request and offer - auto-accepted immediately.
        _, req_body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5,
            "p_product_code": "PY-WITHDRAW-APPROVE",
            "p_product_description": "Withdraw-vs-approve wine",
            "p_requested_quantity": 10,
            "p_idempotency_key": "concurrent-wa-req-1",
        }, token_central)
        wa_request_id = req_body["request_id"]

        _, offer_body = call_rpc("rete_offer_create", {
            "p_request_id": wa_request_id,
            "p_offered_quantity": 5,
            "p_idempotency_key": "concurrent-wa-offer-1",
        }, token_malta)
        wa_offer_id = offer_body["offer_id"]
        self.assertEqual(offer_body.get("status"), "APPROVATA",
            f"offer must already be auto-accepted before either manual call: {offer_body}")

        results = {}

        def do_approve():
            s, b = call_rpc("rete_offer_approve", {
                "p_offer_id": wa_offer_id,
                "p_approved_quantity": 5,
                "p_idempotency_key": "concurrent-wa-approve-1",
            }, token_central, timeout=20)
            results["approve"] = (s, b)

        def do_withdraw():
            s, b = call_rpc("rete_offer_withdraw", {
                "p_offer_id": wa_offer_id,
                "p_idempotency_key": "concurrent-wa-withdraw-1",
            }, token_malta, timeout=20)
            results["withdraw"] = (s, b)

        t1 = threading.Thread(target=do_approve)
        t2 = threading.Thread(target=do_withdraw)
        t1.start(); t2.start()
        t1.join(); t2.join()

        s_approve  = results["approve"][0]
        s_withdraw = results["withdraw"][0]

        # Both must be rejected: the offer already left PROPOSTA the instant
        # it was created.
        self.assertEqual(s_approve, 400,
            f"manual approve must be rejected (already auto-accepted): {results['approve']}")
        self.assertEqual(s_withdraw, 400,
            f"withdraw must be rejected (already auto-accepted, not PROPOSTA): {results['withdraw']}")

        # Exactly one transfer must exist - the one automatic acceptance
        # created, untouched by either rejected manual call.
        transfer_count = int(psql_scalar(
            f"SELECT count(*) FROM public.rete_transfers WHERE offer_id='{wa_offer_id}'"
        ))
        self.assertEqual(transfer_count, 1,
            f"exactly one transfer must exist from automatic acceptance; got {transfer_count}")


class TestIdempotencyActorPayloadBindingConcurrency(unittest.TestCase):
    """F-1/F-2 remediation: real concurrent HTTP calls exercising idempotency
    actor/payload binding (Fase 7, items 10-12 of the remediation gate)."""

    def test_concurrent_same_actor_same_payload_one_effect(self):
        """Item 10: two concurrent calls, same actor, same idempotency key,
        same payload -> exactly one real effect (one offer row), both
        requests return the identical result."""
        token_central = local_jwt(CENTRAL_ID)
        _, pub = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5, "p_product_code": "F12-CONC-10",
            "p_product_description": "x", "p_requested_quantity": 10,
            "p_idempotency_key": "f12-conc10-publish",
        }, token_central)
        request_id = pub["request_id"]

        token_malta = local_jwt(MALTA_ID)
        results = {}

        def call(key):
            s, b = call_rpc("rete_offer_create", {
                "p_request_id": request_id, "p_offered_quantity": 4,
                "p_idempotency_key": "f12-conc10-key",
            }, token_malta)
            results[key] = (s, b)

        t1 = threading.Thread(target=call, args=("a",))
        t2 = threading.Thread(target=call, args=("b",))
        t1.start(); t2.start(); t1.join(); t2.join()

        self.assertEqual(results["a"][0], 200, results["a"])
        self.assertEqual(results["b"][0], 200, results["b"])
        self.assertEqual(results["a"][1], results["b"][1],
            "same actor/key/payload concurrent calls must return the identical result")

        count = int(psql_scalar(
            f"SELECT count(*) FROM public.rete_offers WHERE request_id='{request_id}'"
        ))
        self.assertEqual(count, 1, "exactly one real offer row despite two concurrent identical calls")

    def test_concurrent_same_actor_different_payload_one_winner(self):
        """Item 11: two concurrent calls, same actor, same idempotency key,
        DIFFERENT payload -> exactly one wins (the one that claims the key
        first), the other is rejected (F-1 protection under concurrency)."""
        token_central = local_jwt(CENTRAL_ID)
        _, pub = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5, "p_product_code": "F12-CONC-11",
            "p_product_description": "x", "p_requested_quantity": 10,
            "p_idempotency_key": "f12-conc11-publish",
        }, token_central)
        request_id = pub["request_id"]

        token_malta = local_jwt(MALTA_ID)
        results = {}

        def call(key, qty):
            s, b = call_rpc("rete_offer_create", {
                "p_request_id": request_id, "p_offered_quantity": qty,
                "p_idempotency_key": "f12-conc11-key",
            }, token_malta)
            results[key] = (s, b)

        t1 = threading.Thread(target=call, args=("qty3", 3))
        t2 = threading.Thread(target=call, args=("qty7", 7))
        t1.start(); t2.start(); t1.join(); t2.join()

        statuses = [results["qty3"][0], results["qty7"][0]]
        self.assertEqual(sum(1 for s in statuses if s == 200), 1,
            f"exactly one of the two differing-payload concurrent calls must win: {results}")
        self.assertEqual(sum(1 for s in statuses if s == 400), 1,
            f"the other must be rejected (F-1 protection), not silently succeed with a different result: {results}")

        count = int(psql_scalar(
            f"SELECT count(*) FROM public.rete_offers WHERE request_id='{request_id}'"
        ))
        self.assertEqual(count, 1, "exactly one real offer row - the loser must not have created its own")

    def test_concurrent_different_actors_same_key_one_winner(self):
        """Item 12: two concurrent calls, DIFFERENT actors, same idempotency
        key -> exactly one wins, the other is rejected with no cross-actor
        leak (F-2 protection under concurrency)."""
        token_central = local_jwt(CENTRAL_ID)
        _, pub = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 5, "p_product_code": "F12-CONC-12",
            "p_product_description": "x", "p_requested_quantity": 10,
            "p_idempotency_key": "f12-conc12-publish",
        }, token_central)
        request_id = pub["request_id"]

        token_malta = local_jwt(MALTA_ID)
        token_sestri = local_jwt(SESTRI_ID)
        results = {}

        def call(key, token):
            s, b = call_rpc("rete_offer_create", {
                "p_request_id": request_id, "p_offered_quantity": 3,
                "p_idempotency_key": "f12-conc12-shared-key",
            }, token)
            results[key] = (s, b)

        t1 = threading.Thread(target=call, args=("malta", token_malta))
        t2 = threading.Thread(target=call, args=("sestri", token_sestri))
        t1.start(); t2.start(); t1.join(); t2.join()

        statuses = [results["malta"][0], results["sestri"][0]]
        self.assertEqual(sum(1 for s in statuses if s == 200), 1,
            f"exactly one actor must win the shared-key race: {results}")
        self.assertEqual(sum(1 for s in statuses if s == 400), 1,
            f"the other actor must be rejected, not receive the winner's cached result (F-2): {results}")

        # Whichever actor lost must not have an offer row of their own
        malta_offers = int(psql_scalar(
            f"SELECT count(*) FROM public.rete_offers WHERE request_id='{request_id}' AND offering_location_id=2"
        ))
        sestri_offers = int(psql_scalar(
            f"SELECT count(*) FROM public.rete_offers WHERE request_id='{request_id}' AND offering_location_id=4"
        ))
        self.assertEqual(malta_offers + sestri_offers, 1,
            "exactly one real offer row total - the loser never actually created one, regardless of the response body it received")


if __name__ == "__main__":
    unittest.main(verbosity=2)
