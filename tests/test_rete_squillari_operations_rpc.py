"""Rete Squillari real-operations RPC authorization tests, exercised through
the real local PostgREST HTTP endpoint - the only way any client (including
an attacker) can ever reach these functions in production.

Runs exclusively against the LOCAL Supabase stack (127.0.0.1:54321/54322).
Never touches the linked/remote project, never uses a real PIN or the real
service-role key: only the well-known local dev default anon/JWT_SECRET
values that `supabase start` prints for every local project.

Rationale for testing via HTTP rather than raw `psql ... SET ROLE anon`:
during development of this suite, a superuser session doing `SET ROLE anon`
(or `authenticated`) and then directly calling a function with zero granted
privilege (neither a direct grant nor a PUBLIC grant) was found to crash this
specific local Postgres Docker image with SIGSEGV. Extensive isolation ruled
out a general Postgres bug (a plain custom role reproduces a clean
"permission denied" instead) and ruled out corruption (reproduces on a fresh
container and a fresh volume). The identical authorization check made
through the real REST API - the only reachable path in practice - returns a
clean 401/42501 with no crash at all, confirming this is an artifact of the
raw-superuser-impersonation test technique itself, not a defect reachable by
any real client. This suite therefore exercises every authorization
boundary exclusively via real HTTP calls, which is both safe and more
faithful to how the frontend will actually call these RPCs.
"""
import json
import os
import subprocess
import unittest
import urllib.error
import urllib.request

import jwt

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REST_URL = "http://127.0.0.1:54321/rest/v1/rpc"
LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"
LOCAL_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9."
    "CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)

CENTRAL_ID = "11111111-0000-0000-0000-000000000001"
MALTA_ID = "11111111-0000-0000-0000-000000000002"
SESTRI_ID = "11111111-0000-0000-0000-000000000003"
NOMEMBERSHIP_ID = "11111111-0000-0000-0000-000000000005"
INACTIVE_ID = "11111111-0000-0000-0000-000000000006"


def local_jwt(sub):
    return jwt.encode({"sub": sub, "role": "authenticated", "aud": "authenticated"}, LOCAL_JWT_SECRET, algorithm="HS256")


def call_rpc(function_name, payload, token):
    req = urllib.request.Request(
        f"{REST_URL}/{function_name}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "apikey": LOCAL_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


class RealOperationsRpcAuthorizationTests(unittest.TestCase):
    """Every authorization boundary exercised through the real REST API."""

    @classmethod
    def setUpClass(cls):
        fixtures_path = os.path.join(REPO_ROOT, "tests", "sql", "fixtures_rete_squillari_operations.sql")
        subprocess.run(
            ["psql", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "postgres",
             "-v", "ON_ERROR_STOP=1", "-f", fixtures_path],
            env={**os.environ, "PGPASSWORD": "postgres"},
            check=True, capture_output=True,
        )

    def test_anon_denied_via_real_rest_api(self):
        status, body = call_rpc("rete_offer_create", {
            "p_request_id": "00000000-0000-0000-0000-000000000000",
            "p_offered_quantity": 1,
            "p_idempotency_key": "anon-rest-test",
        }, LOCAL_ANON_KEY)
        self.assertEqual(status, 401)
        self.assertEqual(body.get("code"), "42501")
        self.assertIn("permission denied", body.get("message", "").lower())

    def test_anon_denied_on_every_public_rpc(self):
        rpcs = [
            ("rete_request_publish", {"p_requesting_location_id": 1, "p_product_code": "X", "p_product_description": "X", "p_requested_quantity": 1, "p_idempotency_key": "k"}),
            ("rete_offer_create", {"p_request_id": "00000000-0000-0000-0000-000000000000", "p_offered_quantity": 1, "p_idempotency_key": "k"}),
            ("rete_offer_withdraw", {"p_offer_id": "00000000-0000-0000-0000-000000000000", "p_idempotency_key": "k"}),
            ("rete_offer_approve", {"p_offer_id": "00000000-0000-0000-0000-000000000000", "p_approved_quantity": 1, "p_idempotency_key": "k"}),
            ("rete_offer_reject", {"p_offer_id": "00000000-0000-0000-0000-000000000000", "p_idempotency_key": "k"}),
            ("rete_transfer_mark_ready", {"p_transfer_id": "00000000-0000-0000-0000-000000000000", "p_idempotency_key": "k"}),
            ("rete_transfer_mark_departed", {"p_transfer_id": "00000000-0000-0000-0000-000000000000", "p_idempotency_key": "k"}),
            ("rete_transfer_receive", {"p_transfer_id": "00000000-0000-0000-0000-000000000000", "p_received_quantity": 1, "p_idempotency_key": "k"}),
            ("rete_trasta_arrival_record", {"p_target_request_id": "00000000-0000-0000-0000-000000000000", "p_product_code": "X", "p_quantity": 1, "p_idempotency_key": "k"}),
        ]
        for name, payload in rpcs:
            with self.subTest(rpc=name):
                status, body = call_rpc(name, payload, LOCAL_ANON_KEY)
                self.assertEqual(status, 401, f"{name} should be denied to anon")
                self.assertEqual(body.get("code"), "42501", f"{name} should return 42501 for anon")

    def test_no_active_membership_denied(self):
        token = local_jwt(NOMEMBERSHIP_ID)
        status, body = call_rpc("rete_offer_create", {
            "p_request_id": "00000000-0000-0000-0000-000000000000",
            "p_offered_quantity": 1,
            "p_idempotency_key": "nomembership-rest-test",
        }, token)
        self.assertEqual(status, 400)
        self.assertIn("no active membership", body.get("message", ""))

    def test_inactive_membership_denied(self):
        token = local_jwt(INACTIVE_ID)
        status, body = call_rpc("rete_offer_create", {
            "p_request_id": "00000000-0000-0000-0000-000000000000",
            "p_offered_quantity": 1,
            "p_idempotency_key": "inactive-rest-test",
        }, token)
        self.assertEqual(status, 400)
        self.assertIn("no active membership", body.get("message", ""))

    def test_store_cannot_impersonate_central(self):
        token = local_jwt(MALTA_ID)
        status, body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 1,
            "p_product_code": "X",
            "p_product_description": "X",
            "p_requested_quantity": 1,
            "p_idempotency_key": "store-as-central-rest-test",
        }, token)
        self.assertEqual(status, 400)
        self.assertIn("operation not permitted", body.get("message", ""))

    def test_central_can_publish_via_real_rest_api(self):
        token = local_jwt(CENTRAL_ID)
        status, body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 2,
            "p_product_code": "PYTEST-001",
            "p_product_description": "Pytest wine",
            "p_requested_quantity": 5,
            "p_idempotency_key": "central-publish-rest-test",
        }, token)
        self.assertEqual(status, 200)
        self.assertEqual(body.get("status"), "DA_TROVARE")
        self.assertIn("request_id", body)

    def test_self_offer_denied_via_real_rest_api(self):
        token_central = local_jwt(CENTRAL_ID)
        _, publish_body = call_rpc("rete_request_publish", {
            "p_requesting_location_id": 2,
            "p_product_code": "PYTEST-002",
            "p_product_description": "Pytest self-offer wine",
            "p_requested_quantity": 5,
            "p_idempotency_key": "central-publish-selfoffer-rest-test",
        }, token_central)
        request_id = publish_body["request_id"]

        token_sestri = local_jwt(SESTRI_ID)
        status, body = call_rpc("rete_offer_create", {
            "p_request_id": request_id,
            "p_offered_quantity": 3,
            "p_idempotency_key": "sestri-self-offer-rest-test",
        }, token_sestri)
        self.assertEqual(status, 400)
        self.assertIn("operation not permitted", body.get("message", ""))


if __name__ == "__main__":
    unittest.main()
