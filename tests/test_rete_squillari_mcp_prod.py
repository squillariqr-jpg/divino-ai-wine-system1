"""Test suite for the production Supabase-backed read-only Rete Squillari
MCP server (scripts/rete_squillari_mcp_prod/). Runs exclusively against the
LOCAL Supabase stack, using synthetic fixtures inserted directly (not via
the governed write RPCs, since this suite tests the read-only MCP, not the
application's write path). Never touches the linked/remote project.

Usage:
  supabase db reset --local   # first, from the repo root
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -c "ALTER ROLE rete_mcp_reader WITH LOGIN PASSWORD 'test-only-local-password';"
  python3 -m pytest tests/test_rete_squillari_mcp_prod.py -q
"""
import json
import os
import signal
import subprocess
import sys
import time
import uuid

import psycopg2
import pytest
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts")
sys.path.insert(0, SCRIPTS_DIR)

ADMIN_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
READER_PASSWORD = "test-only-local-password-not-committed-anywhere-else"
READER_DSN = f"postgresql://rete_mcp_reader:{READER_PASSWORD}@127.0.0.1:54322/postgres"
JWT_SECRET = "local-test-jwt-secret-at-least-32-characters-long-for-tests"
BASE_PORT = 8799
BASE_URL = f"http://127.0.0.1:{BASE_PORT}"


def _admin_exec(sql, params=None):
    conn = psycopg2.connect(ADMIN_DSN)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql, params)
        try:
            return cur.fetchall()
        except psycopg2.ProgrammingError:
            return None
    conn.close()


@pytest.fixture(scope="module", autouse=True)
def enable_reader_login():
    _admin_exec(f"ALTER ROLE rete_mcp_reader WITH LOGIN PASSWORD %s", [READER_PASSWORD])
    yield
    _admin_exec("ALTER ROLE rete_mcp_reader WITH NOLOGIN PASSWORD NULL")


@pytest.fixture(scope="module")
def fixtures():
    """Synthetic requests/offers/transfers/audit rows inserted directly,
    not via governed RPCs - this suite tests the read tools only."""
    central_id = str(uuid.uuid4())
    _admin_exec(
        "INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) "
        "VALUES (%s, %s, 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb) ON CONFLICT DO NOTHING",
        [central_id, "mcp-test-fixture-central@local.invalid"],
    )

    req_pending = str(uuid.uuid4())
    req_open = str(uuid.uuid4())
    req_closed = str(uuid.uuid4())
    _admin_exec(
        "INSERT INTO rete_requests (id, requesting_location_id, product_code, product_description, "
        "requested_quantity, remaining_quantity, status, source, created_by, operational_request_key) VALUES "
        "(%s, 2, 'MCPFIX-PENDING', 'Pending fixture', 3, 3, 'DA_CONFERMARE', 'WBOS_AUTO', %s, 'mcp-fix-pending'),"
        "(%s, 4, 'MCPFIX-OPEN', 'Open fixture', 5, 2, 'DA_TROVARE', 'WBOS_AUTO', %s, 'mcp-fix-open'),"
        "(%s, 2, 'MCPFIX-CLOSED', 'Closed fixture', 4, 0, 'CHIUSA', 'MANUAL', %s, 'mcp-fix-closed')",
        [req_pending, central_id, req_open, central_id, req_closed, central_id],
    )

    offer_id = str(uuid.uuid4())
    offer_id_2 = str(uuid.uuid4())
    offer_id_3 = str(uuid.uuid4())
    _admin_exec(
        "INSERT INTO rete_offers (id, request_id, offering_location_id, offered_quantity, status, offered_by) VALUES "
        "(%s, %s, 4, 3, 'PROPOSTA', %s),"  # req_open, Sestri
        "(%s, %s, 4, 4, 'APPROVATA', %s),"  # req_closed, Sestri -> transfer_unresolved
        "(%s, %s, 5, 4, 'APPROVATA', %s)",  # req_closed, Cantore -> transfer_resolved
        [offer_id, req_open, central_id, offer_id_2, req_closed, central_id, offer_id_3, req_closed, central_id],
    )

    transfer_unresolved = str(uuid.uuid4())
    transfer_resolved = str(uuid.uuid4())
    _admin_exec(
        "INSERT INTO rete_transfers (id, request_id, offer_id, from_location_id, to_location_id, quantity, "
        "status, received_quantity, discrepancy_type, discrepancy_acknowledged, approved_by) VALUES "
        "(%s, %s, %s, 4, 2, 4, 'RICEVUTA', 3, 'SHORT', false, %s)",
        [transfer_unresolved, req_closed, offer_id_2, central_id],
    )
    _admin_exec(
        "INSERT INTO rete_transfers (id, request_id, offer_id, from_location_id, to_location_id, quantity, "
        "status, received_quantity, discrepancy_type, discrepancy_acknowledged, discrepancy_resolution_note, approved_by) VALUES "
        "(%s, %s, %s, 5, 2, 4, 'RICEVUTA', 3, 'SHORT', true, 'resolved test note', %s)",
        [transfer_resolved, req_closed, offer_id_3, central_id],
    )

    _admin_exec(
        "INSERT INTO rete_audit_events (actor_user_id, event_type, entity_type, entity_id, payload) VALUES "
        "(%s, 'wbos_suggestion_ingested', 'request', %s, %s),"
        "(%s, 'request_confirmed', 'request', %s, %s)",
        [central_id, req_pending, json.dumps({"quantity": 3}), central_id, req_pending, json.dumps({"pin_hint": "999999", "note": "should be redacted"})],
    )

    return {
        "req_pending": req_pending, "req_open": req_open, "req_closed": req_closed,
        "offer_id": offer_id, "transfer_unresolved": transfer_unresolved,
        "transfer_resolved": transfer_resolved, "central_id": central_id,
    }


@pytest.fixture(scope="module")
def server_proc(enable_reader_login):
    env = dict(os.environ)
    env.update({
        "RETE_MCP_DATABASE_URL": READER_DSN,
        "RETE_MCP_JWT_SECRET": JWT_SECRET,
        "RETE_MCP_BIND_PORT": str(BASE_PORT),
        "RETE_MCP_LOG_LEVEL": "WARNING",
    })
    proc = subprocess.Popen(
        [sys.executable, os.path.join(SCRIPTS_DIR, "rete_squillari_mcp_prod_server.py")],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    for _ in range(30):
        try:
            r = requests.get(f"{BASE_URL}/healthz", timeout=1)
            if r.status_code == 200:
                break
        except requests.exceptions.ConnectionError:
            time.sleep(0.2)
    else:
        proc.kill()
        raise RuntimeError("server did not start")
    yield proc
    proc.send_signal(signal.SIGTERM)
    proc.wait(timeout=5)


def _issue_token(sub, scopes, expires_in_days=1):
    sys.path.insert(0, SCRIPTS_DIR)
    from rete_squillari_mcp_prod.auth import ALL_SCOPES  # noqa
    import jwt as _jwt
    now = int(time.time())
    jti = str(uuid.uuid4())
    claims = {
        "sub": sub, "scopes": scopes, "iss": "rete-squillari-mcp-prod",
        "aud": "rete-squillari-mcp-prod", "iat": now, "exp": now + expires_in_days * 86400, "jti": jti,
    }
    return _jwt.encode(claims, JWT_SECRET, algorithm="HS256"), jti


@pytest.fixture(scope="module")
def read_token():
    token, _ = _issue_token("test-full-read", ["rete:read"])
    return token


def _call(token, tool, args=None, id_=1):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    body = {"jsonrpc": "2.0", "id": id_, "method": "tools/call", "params": {"name": tool, "arguments": args or {}}}
    return requests.post(f"{BASE_URL}/mcp", headers=headers, json=body, timeout=5).json()


# ---------------------------------------------------------------------------
# Phase 11: MCP protocol validation
# ---------------------------------------------------------------------------
def test_healthz(server_proc):
    r = requests.get(f"{BASE_URL}/healthz")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_readyz(server_proc):
    r = requests.get(f"{BASE_URL}/readyz")
    assert r.status_code == 200 and r.json()["status"] == "ready"


def test_server_refuses_to_start_with_unreachable_database():
    """psycopg2's ThreadedConnectionPool connects its minimum pool size
    eagerly at construction time - a completely unreachable/misauthenticated
    database therefore fails startup outright (main() catches the
    exception and exits 1) rather than starting in a broken, silently
    degraded state. This is the startup-validation guarantee: a bad
    credential is caught before the process ever binds a socket, not
    discovered later by a client getting errors."""
    bad_port = BASE_PORT + 1
    env = dict(os.environ)
    env.update({
        "RETE_MCP_DATABASE_URL": "postgresql://rete_mcp_reader:wrong-password@127.0.0.1:54322/postgres",
        "RETE_MCP_JWT_SECRET": JWT_SECRET,
        "RETE_MCP_BIND_PORT": str(bad_port),
        "RETE_MCP_LOG_LEVEL": "CRITICAL",
        "RETE_MCP_DB_CONNECT_TIMEOUT_S": "2",
    })
    proc = subprocess.Popen(
        [sys.executable, os.path.join(SCRIPTS_DIR, "rete_squillari_mcp_prod_server.py")],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    returncode = proc.wait(timeout=15)
    assert returncode == 1
    base = f"http://127.0.0.1:{bad_port}"
    with pytest.raises(requests.exceptions.ConnectionError):
        requests.get(f"{base}/healthz", timeout=1)


def test_health_check_returns_true_for_reachable_database():
    """ReadOnlyDB.health_check() - the same call server.py's /readyz
    handler makes - returns True against a genuinely reachable database.
    Combined with the source of server.py's do_GET handler (readyz wraps
    this exact call in try/except and returns 503/"database_unreachable"
    on any falsy result or exception, never 200 unconditionally), this is
    the full proof: /readyz's 200 response is conditioned on a real,
    bounded database round-trip, not merely on the process being alive."""
    from rete_squillari_mcp_prod import db as db_module

    reader = db_module.ReadOnlyDB(READER_DSN, 1, 2, 2000, 3)
    assert reader.health_check() is True
    reader.close()


def test_mcp_handshake(server_proc):
    r = requests.post(f"{BASE_URL}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    body = r.json()
    assert body["result"]["serverInfo"]["name"] == "rete-squillari-mcp-prod"


def test_tools_listed(server_proc):
    r = requests.post(f"{BASE_URL}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    names = {t["name"] for t in r.json()["result"]["tools"]}
    expected = {
        "rete_get_health", "rete_get_pilot_status", "rete_list_locations",
        "rete_list_pending_confirmations", "rete_list_open_requests", "rete_get_request",
        "rete_list_offers", "rete_list_transfers", "rete_list_receipt_discrepancies",
        "rete_get_request_audit",
    }
    assert names == expected


def test_unknown_method_rejected(server_proc):
    r = requests.post(f"{BASE_URL}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/delete", "params": {}})
    assert "error" in r.json()


def test_malformed_json_rejected(server_proc):
    r = requests.post(f"{BASE_URL}/mcp", data="{not json", headers={"Content-Type": "application/json"})
    assert "error" in r.json()


def test_unknown_tool_rejected(server_proc, read_token):
    body = _call(read_token, "rete_definitely_not_a_real_tool")
    assert body["error"]["data"]["reason_code"] == "UNKNOWN_TOOL"


def test_malformed_arguments_rejected(server_proc, read_token):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {read_token}"}
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "rete_get_health", "arguments": [1, 2]}}
    r = requests.post(f"{BASE_URL}/mcp", headers=headers, json=body)
    assert r.json()["error"]["data"]["reason_code"] == "MALFORMED_ARGUMENTS"


def test_concurrent_clients(server_proc, read_token):
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futures = [ex.submit(_call, read_token, "rete_get_health") for _ in range(10)]
        results = [f.result() for f in futures]
    assert all(r["result"]["structuredContent"]["status"] == "ok" for r in results)


# ---------------------------------------------------------------------------
# Phase 6/7: authentication and authorization
# ---------------------------------------------------------------------------
def test_no_token_rejected(server_proc):
    body = _call(None, "rete_get_health")
    assert body["error"]["data"]["reason_code"] == "AUTHORIZATION_DENIED"


def test_invalid_token_rejected(server_proc):
    body = _call("not-a-real-token", "rete_get_health")
    assert body["error"]["data"]["reason_code"] == "AUTHORIZATION_DENIED"


def test_expired_token_rejected(server_proc):
    import jwt as _jwt
    now = int(time.time())
    token = _jwt.encode(
        {"sub": "x", "scopes": ["rete:read"], "iss": "rete-squillari-mcp-prod", "aud": "rete-squillari-mcp-prod",
         "iat": now - 100, "exp": now - 50, "jti": str(uuid.uuid4())},
        JWT_SECRET, algorithm="HS256",
    )
    body = _call(token, "rete_get_health")
    assert body["error"]["data"]["reason_code"] == "AUTHORIZATION_DENIED"


def test_wrong_audience_rejected(server_proc):
    import jwt as _jwt
    now = int(time.time())
    token = _jwt.encode(
        {"sub": "x", "scopes": ["rete:read"], "iss": "rete-squillari-mcp-prod", "aud": "some-other-service",
         "iat": now, "exp": now + 3600, "jti": str(uuid.uuid4())},
        JWT_SECRET, algorithm="HS256",
    )
    body = _call(token, "rete_get_health")
    assert body["error"]["data"]["reason_code"] == "AUTHORIZATION_DENIED"


def test_missing_scope_blocked(server_proc):
    token, _ = _issue_token("narrow-client", ["rete:health"])
    body = _call(token, "rete_get_request_audit", {"request_id": str(uuid.uuid4())})
    assert body["error"]["data"]["reason_code"] == "AUTHORIZATION_DENIED"


def test_broad_scope_covers_narrow_tools(server_proc, read_token):
    body = _call(read_token, "rete_get_request_audit", {"request_id": str(uuid.uuid4())})
    # not a scope error - falls through to a normal (empty) result
    assert body["error"]["data"]["reason_code"] != "AUTHORIZATION_DENIED" if "error" in body else True


def test_sql_injection_in_request_id_rejected(server_proc, read_token):
    body = _call(read_token, "rete_get_request", {"request_id": "'; DROP TABLE rete_requests; --"})
    assert body["error"]["data"]["reason_code"] == "INVALID_UUID"


# ---------------------------------------------------------------------------
# Phase 10: per-tool tests
# ---------------------------------------------------------------------------
def test_health_tool(server_proc, read_token):
    body = _call(read_token, "rete_get_health")
    assert body["result"]["structuredContent"]["status"] == "ok"


def test_pilot_status_reflects_fixtures(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_get_pilot_status")
    status = body["result"]["structuredContent"]
    assert status["pending_confirmations"] >= 1
    assert status["unresolved_discrepancies"] >= 1


def test_list_locations_excludes_disabled_correctly(server_proc, read_token):
    body = _call(read_token, "rete_list_locations")
    locs = body["result"]["structuredContent"]["locations"]
    assert len(locs) == 6
    assert {l["id"] for l in locs} == {2, 4, 5, 6, 7, 8}


def test_pending_confirmations_only_pending_state(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_list_pending_confirmations")
    reqs = body["result"]["structuredContent"]["requests"]
    assert all(r["status"] == "DA_CONFERMARE" for r in reqs)
    assert any(r["id"] == fixtures["req_pending"] for r in reqs)
    assert not any(r["id"] == fixtures["req_open"] for r in reqs)


def test_pending_confirmations_pagination(server_proc, read_token):
    body = _call(read_token, "rete_list_pending_confirmations", {"limit": 1})
    assert len(body["result"]["structuredContent"]["requests"]) <= 1
    assert body["result"]["structuredContent"]["limit"] == 1


def test_open_requests_no_unconfirmed_leakage(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_list_open_requests")
    reqs = body["result"]["structuredContent"]["requests"]
    assert not any(r["id"] == fixtures["req_pending"] for r in reqs)
    assert any(r["id"] == fixtures["req_open"] for r in reqs)


def test_get_request_valid(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_get_request", {"request_id": fixtures["req_open"]})
    assert body["result"]["structuredContent"]["request"]["product_code"] == "MCPFIX-OPEN"


def test_get_request_unknown(server_proc, read_token):
    body = _call(read_token, "rete_get_request", {"request_id": str(uuid.uuid4())})
    assert body["error"]["data"]["reason_code"] == "NOT_FOUND"


def test_get_request_invalid_uuid(server_proc, read_token):
    body = _call(read_token, "rete_get_request", {"request_id": "xyz"})
    assert body["error"]["data"]["reason_code"] == "INVALID_UUID"


def test_offers_by_request(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_list_offers", {"request_id": fixtures["req_open"]})
    offers = body["result"]["structuredContent"]["offers"]
    assert len(offers) == 1
    assert offers[0]["id"] == fixtures["offer_id"]


def test_offers_by_store(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_list_offers", {"location_id": 4})
    offers = body["result"]["structuredContent"]["offers"]
    assert any(o["id"] == fixtures["offer_id"] for o in offers)


def test_transfers_active_vs_completed(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_list_transfers", {"status": "RICEVUTA"})
    transfers = body["result"]["structuredContent"]["transfers"]
    assert any(t["id"] == fixtures["transfer_unresolved"] for t in transfers)


def test_discrepancies_unresolved_default(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_list_receipt_discrepancies", {"resolved": False})
    ids = {d["id"] for d in body["result"]["structuredContent"]["discrepancies"]}
    assert fixtures["transfer_unresolved"] in ids
    assert fixtures["transfer_resolved"] not in ids


def test_discrepancies_resolved_filter(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_list_receipt_discrepancies", {"resolved": True})
    ids = {d["id"] for d in body["result"]["structuredContent"]["discrepancies"]}
    assert fixtures["transfer_resolved"] in ids
    assert fixtures["transfer_unresolved"] not in ids


def test_audit_chronological_and_redacted(server_proc, read_token, fixtures):
    body = _call(read_token, "rete_get_request_audit", {"request_id": fixtures["req_pending"]})
    events = body["result"]["structuredContent"]["audit_events"]
    assert len(events) == 2
    assert events[0]["created_at"] <= events[1]["created_at"]
    payloads = [e["payload"] for e in events]
    assert any(p.get("pin_hint") == "[REDACTED]" for p in payloads if p)
    assert all("actor_user_id" not in e for e in events)


def test_limits_are_clamped(server_proc, read_token):
    body = _call(read_token, "rete_list_open_requests", {"limit": 99999})
    assert body["result"]["structuredContent"]["limit"] <= 100


def test_negative_offset_rejected(server_proc, read_token):
    body = _call(read_token, "rete_list_open_requests", {"offset": -1})
    assert body["error"]["data"]["reason_code"] == "INVALID_OFFSET"


def test_invalid_transfer_status_rejected(server_proc, read_token):
    body = _call(read_token, "rete_list_transfers", {"status": "NOT_A_REAL_STATUS"})
    assert body["error"]["data"]["reason_code"] == "INVALID_STATUS"


# ---------------------------------------------------------------------------
# Phase 9: read-only enforcement (database-role level, not just app level)
# ---------------------------------------------------------------------------
def test_reader_role_cannot_insert():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("INSERT INTO rete_locations (id, code, name, active) VALUES (999,999,'x',true)")
    conn.close()


def test_reader_role_cannot_update():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("UPDATE rete_locations SET active = false WHERE id = 2")
    conn.close()


def test_reader_role_cannot_delete():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM rete_locations WHERE id = 2")
    conn.close()


def test_reader_role_cannot_execute_mutation_rpc():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("SELECT rete_request_publish(2::smallint,'X','X',1,'NORMALE',NULL,'x')")
    conn.close()


def test_reader_role_cannot_access_auth_schema():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("SELECT email FROM auth.users LIMIT 1")
    conn.close()


def test_reader_role_cannot_select_forbidden_columns():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("SELECT created_by FROM rete_requests")
    conn.close()


def test_reader_role_cannot_create_table():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("CREATE TABLE public.mcp_adversarial_test (id int)")
    conn.close()


def test_reader_role_cannot_alter_or_drop_table():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE public.rete_locations ADD COLUMN evil text")
    conn.close()
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("DROP TABLE public.rete_locations")
    conn.close()


def test_reader_role_cannot_create_function():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.execute("CREATE FUNCTION public.evil_fn() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql")
    conn.close()


def test_reader_role_cannot_set_role():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.Error):
        with conn.cursor() as cur:
            cur.execute("SET ROLE postgres")
    conn.close()


def test_reader_role_cannot_copy():
    conn = psycopg2.connect(READER_DSN)
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
        with conn.cursor() as cur:
            cur.copy_expert("COPY rete_locations TO STDOUT", sys.stdout)
    conn.close()


def test_reader_role_session_read_only_blocks_temp_table_and_large_object():
    """CREATE TEMP TABLE and lo_create() are granted to PUBLIC by every
    Postgres database and cannot be revoked from one specific role (a
    grant-level REVOKE against a PUBLIC-inherited privilege is a documented
    no-op) - the actual protection is the read-only session the connection
    pool opens with (db.py: default_transaction_read_only=on)."""
    conn = psycopg2.connect(READER_DSN, options="-c default_transaction_read_only=on")
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.ReadOnlySqlTransaction):
        with conn.cursor() as cur:
            cur.execute("CREATE TEMP TABLE t (id int)")
    conn.close()

    conn = psycopg2.connect(READER_DSN, options="-c default_transaction_read_only=on")
    conn.autocommit = True
    with pytest.raises(psycopg2.errors.ReadOnlySqlTransaction):
        with conn.cursor() as cur:
            cur.execute("SELECT lo_create(0)")
    conn.close()


def test_repeated_calls_leave_no_mutation(server_proc, read_token, fixtures):
    def _snapshot():
        rows = _admin_exec(
            "SELECT (SELECT count(*) FROM rete_requests), (SELECT count(*) FROM rete_offers), "
            "(SELECT count(*) FROM rete_transfers), (SELECT count(*) FROM rete_audit_events)"
        )
        return rows[0]

    before = _snapshot()
    for _ in range(20):
        _call(read_token, "rete_list_open_requests")
        _call(read_token, "rete_get_pilot_status")
    after = _snapshot()
    assert before == after


# ---------------------------------------------------------------------------
# Mutation-tool absence (registry-level proof)
# ---------------------------------------------------------------------------
def test_no_mutation_tools_in_registry():
    from rete_squillari_mcp_prod.tools import TOOL_REGISTRY
    mutation_verbs = ("create", "cancel", "approve", "reject", "resolve", "publish", "ingest", "withdraw", "mark", "receive", "update", "delete", "insert")
    for name in TOOL_REGISTRY:
        assert name.startswith("rete_get_") or name.startswith("rete_list_"), (
            f"tool {name} does not follow the read-only naming convention"
        )
        words = set(name.lower().split("_"))
        assert not (words & set(mutation_verbs)), f"tool {name} looks mutation-shaped"


def test_no_generic_sql_or_rpc_tool():
    from rete_squillari_mcp_prod.tools import TOOL_REGISTRY
    forbidden = {"execute_sql", "run_sql", "query", "rpc", "call_function", "raw_query"}
    assert not (forbidden & set(TOOL_REGISTRY.keys()))


# ---------------------------------------------------------------------------
# Config validation: non-loopback DB connections must require verify-full TLS
# ---------------------------------------------------------------------------
def _cfg(database_url, **overrides):
    from rete_squillari_mcp_prod.config import MCPConfig
    kwargs = dict(database_url=database_url, jwt_secret="x" * 32)
    kwargs.update(overrides)
    return MCPConfig(**kwargs)


def test_remote_database_url_requires_verify_full():
    from rete_squillari_mcp_prod.config import ConfigError
    with pytest.raises(ConfigError):
        _cfg("postgresql://rete_mcp_reader:x@db.example.supabase.co:5432/postgres?sslmode=require").validate()
    with pytest.raises(ConfigError):
        _cfg("postgresql://rete_mcp_reader:x@db.example.supabase.co:5432/postgres").validate()


def test_remote_database_url_accepts_verify_full():
    _cfg("postgresql://rete_mcp_reader:x@db.example.supabase.co:5432/postgres?sslmode=verify-full").validate()


def test_loopback_database_url_exempt_from_tls_requirement():
    _cfg("postgresql://rete_mcp_reader:x@127.0.0.1:54322/postgres").validate()
