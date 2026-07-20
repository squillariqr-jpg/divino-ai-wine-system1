"""Read-only database access layer for the production Rete Squillari MCP
server. Connects exclusively as the rete_mcp_reader Postgres role (see
supabase/migrations/20260720100000_rete_squillari_mcp_readonly_role.sql) -
a role with column-level SELECT-only grants and zero write/RPC-execute
privilege, enforced by Postgres itself. Every query here is parameterized;
no query in this module ever interpolates a caller-supplied value into SQL
text.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import uuid

import psycopg2
import psycopg2.pool
import psycopg2.extras


class QueryError(Exception):
    def __init__(self, reason_code: str):
        self.reason_code = reason_code
        super().__init__(reason_code)


STATUS_ALLOWLIST_REQUESTS = frozenset({
    "DA_CONFERMARE", "DA_TROVARE", "DA_PREPARARE", "IN_TRASFERIMENTO",
    "RICEVUTA", "CHIUSA", "ANNULLATA",
})
STATUS_ALLOWLIST_OFFERS = frozenset({"PROPOSTA", "APPROVATA", "RIFIUTATA", "RITIRATA"})
STATUS_ALLOWLIST_TRANSFERS = frozenset({
    "DA_PREPARARE", "PRONTA", "IN_TRASFERIMENTO", "RICEVUTA", "ANNULLATA",
})


def validate_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        raise QueryError("INVALID_UUID")


def validate_enum(value: str, allowlist: frozenset, field_name: str) -> str:
    if value not in allowlist:
        raise QueryError(f"INVALID_{field_name.upper()}")
    return value


def clamp_limit(requested: int, default: int, maximum: int) -> int:
    if requested is None:
        return default
    try:
        requested = int(requested)
    except (TypeError, ValueError):
        raise QueryError("INVALID_LIMIT")
    if requested <= 0:
        raise QueryError("INVALID_LIMIT")
    return min(requested, maximum)


def clamp_offset(requested: int) -> int:
    if requested is None:
        return 0
    try:
        requested = int(requested)
    except (TypeError, ValueError):
        raise QueryError("INVALID_OFFSET")
    if requested < 0:
        raise QueryError("INVALID_OFFSET")
    return requested


class ReadOnlyDB:
    def __init__(self, database_url: str, min_size: int, max_size: int,
                 statement_timeout_ms: int, connect_timeout_s: int):
        self._pool = psycopg2.pool.ThreadedConnectionPool(
            min_size, max_size, dsn=database_url,
            connect_timeout=connect_timeout_s,
            options=f"-c statement_timeout={statement_timeout_ms} -c default_transaction_read_only=on",
        )

    def close(self) -> None:
        self._pool.closeall()

    @contextmanager
    def _cursor(self):
        conn = self._pool.getconn()
        try:
            conn.set_session(readonly=True, autocommit=True)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                yield cur
        finally:
            self._pool.putconn(conn)

    def health_check(self) -> bool:
        with self._cursor() as cur:
            cur.execute("SELECT 1 AS ok")
            row = cur.fetchone()
            return bool(row and row["ok"] == 1)

    def list_locations(self):
        with self._cursor() as cur:
            cur.execute(
                "SELECT id, code, name, active FROM public.rete_locations ORDER BY id ASC"
            )
            return cur.fetchall()

    def pilot_status(self):
        with self._cursor() as cur:
            cur.execute("""
                SELECT
                  (SELECT count(*) FROM public.rete_memberships WHERE pilot_enabled AND active) AS pilot_enabled_locations,
                  (SELECT count(*) FROM public.rete_requests WHERE source = 'WBOS_AUTO' AND status NOT IN ('CHIUSA','ANNULLATA')) AS active_automatic_requests,
                  (SELECT count(*) FROM public.rete_requests WHERE status NOT IN ('CHIUSA','ANNULLATA')) AS active_requests_total,
                  (SELECT count(*) FROM public.rete_requests WHERE status = 'DA_CONFERMARE') AS pending_confirmations,
                  (SELECT count(*) FROM public.rete_transfers WHERE status = 'RICEVUTA' AND received_quantity IS NOT NULL AND received_quantity <> quantity AND NOT discrepancy_acknowledged) AS unresolved_discrepancies
            """)
            return cur.fetchone()

    def list_pending_confirmations(self, location_id, limit: int, offset: int):
        params = ["DA_CONFERMARE"]
        where = "status = %s"
        if location_id is not None:
            where += " AND requesting_location_id = %s"
            params.append(location_id)
        params.extend([limit, offset])
        with self._cursor() as cur:
            cur.execute(f"""
                SELECT id, requesting_location_id, product_code, product_description,
                       requested_quantity, remaining_quantity, status, source,
                       requires_central_confirmation, warning_codes, score, score_version,
                       created_at, updated_at, confirmed_at, cancelled_at, closed_at
                FROM public.rete_requests
                WHERE {where}
                ORDER BY created_at DESC, id DESC
                LIMIT %s OFFSET %s
            """, params)
            return cur.fetchall()

    def list_open_requests(self, location_id, limit: int, offset: int):
        params = []
        where = "status NOT IN ('DA_CONFERMARE', 'CHIUSA', 'ANNULLATA')"
        if location_id is not None:
            where += " AND requesting_location_id = %s"
            params.append(location_id)
        params.extend([limit, offset])
        with self._cursor() as cur:
            cur.execute(f"""
                SELECT id, requesting_location_id, product_code, product_description,
                       requested_quantity, remaining_quantity, status, source,
                       requires_central_confirmation, warning_codes, score, score_version,
                       created_at, updated_at, confirmed_at, cancelled_at, closed_at
                FROM public.rete_requests
                WHERE {where}
                ORDER BY created_at DESC, id DESC
                LIMIT %s OFFSET %s
            """, params)
            return cur.fetchall()

    def get_request(self, request_id: str):
        with self._cursor() as cur:
            cur.execute("""
                SELECT id, requesting_location_id, product_code, product_description,
                       requested_quantity, remaining_quantity, status, source,
                       requires_central_confirmation, warning_codes, score, score_version,
                       created_at, updated_at, confirmed_at, cancelled_at, closed_at
                FROM public.rete_requests WHERE id = %s
            """, [request_id])
            return cur.fetchone()

    def list_offers(self, request_id, location_id, limit: int, offset: int):
        params = []
        clauses = []
        if request_id is not None:
            clauses.append("request_id = %s")
            params.append(request_id)
        if location_id is not None:
            clauses.append("offering_location_id = %s")
            params.append(location_id)
        where = " AND ".join(clauses) if clauses else "TRUE"
        params.extend([limit, offset])
        with self._cursor() as cur:
            cur.execute(f"""
                SELECT id, request_id, offering_location_id, offered_quantity,
                       approved_quantity, status, created_at, updated_at
                FROM public.rete_offers
                WHERE {where}
                ORDER BY created_at DESC, id DESC
                LIMIT %s OFFSET %s
            """, params)
            return cur.fetchall()

    def list_transfers(self, request_id, status, limit: int, offset: int):
        params = []
        clauses = []
        if request_id is not None:
            clauses.append("request_id = %s")
            params.append(request_id)
        if status is not None:
            clauses.append("status = %s")
            params.append(status)
        where = " AND ".join(clauses) if clauses else "TRUE"
        params.extend([limit, offset])
        with self._cursor() as cur:
            cur.execute(f"""
                SELECT id, request_id, offer_id, from_location_id, to_location_id, quantity,
                       status, prepared_at, departed_at, received_at, received_quantity,
                       discrepancy_type, discrepancy_acknowledged, discrepancy_resolution_note,
                       discrepancy_resolved_at, anomaly_note, created_at, updated_at
                FROM public.rete_transfers
                WHERE {where}
                ORDER BY created_at DESC, id DESC
                LIMIT %s OFFSET %s
            """, params)
            return cur.fetchall()

    def list_receipt_discrepancies(self, resolved: bool, limit: int, offset: int):
        clause = "discrepancy_acknowledged = %s" if resolved is not None else "discrepancy_type IS NOT NULL"
        params = []
        base = "discrepancy_type IS NOT NULL"
        if resolved is not None:
            base += " AND discrepancy_acknowledged = %s"
            params.append(resolved)
        params.extend([limit, offset])
        with self._cursor() as cur:
            cur.execute(f"""
                SELECT id, request_id, offer_id, from_location_id, to_location_id, quantity,
                       status, received_at, received_quantity, discrepancy_type,
                       discrepancy_acknowledged, discrepancy_resolution_note,
                       discrepancy_resolved_at, anomaly_note, created_at, updated_at
                FROM public.rete_transfers
                WHERE {base}
                ORDER BY created_at DESC, id DESC
                LIMIT %s OFFSET %s
            """, params)
            return cur.fetchall()

    def get_request_audit(self, request_id: str, limit: int, offset: int):
        with self._cursor() as cur:
            cur.execute("""
                SELECT id, event_type, entity_type, entity_id, payload, created_at
                FROM public.rete_audit_events
                WHERE entity_id IN (
                    SELECT %s::text
                    UNION SELECT id::text FROM public.rete_offers WHERE request_id = %s::uuid
                    UNION SELECT id::text FROM public.rete_transfers WHERE request_id = %s::uuid
                )
                ORDER BY created_at ASC, id ASC
                LIMIT %s OFFSET %s
            """, [request_id, request_id, request_id, limit, offset])
            return cur.fetchall()
