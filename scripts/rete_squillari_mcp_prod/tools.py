"""The 10 read-only MCP tools for the Rete Squillari pilot. Every tool
enforces its required scope before touching the database, and every
database-facing call goes through db.py's parameterized queries only -
there is no generic SQL tool, no arbitrary table reader, and no arbitrary
RPC caller anywhere in this module.
"""
import re

from . import db
from .auth import Identity, require_scope

_SENSITIVE_KEY_PATTERN = re.compile(r"(pin|token|password|secret|key|jwt)", re.IGNORECASE)


def _redact_payload(payload):
    if not isinstance(payload, dict):
        return payload
    out = {}
    for k, v in payload.items():
        if _SENSITIVE_KEY_PATTERN.search(k):
            out[k] = "[REDACTED]"
        else:
            out[k] = v
    return out


def _serialize_datetime_fields(row):
    out = {}
    for k, v in dict(row).items():
        out[k] = v.isoformat() if hasattr(v, "isoformat") else v
    return out


class ToolError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def rete_get_health(database: db.ReadOnlyDB, identity: Identity, args: dict) -> dict:
    require_scope(identity, "rete:health")
    try:
        ok = database.health_check()
    except Exception:
        return {"status": "unhealthy", "database": "unreachable"}
    return {"status": "ok" if ok else "unhealthy", "database": "reachable" if ok else "unreachable"}


def rete_get_pilot_status(database: db.ReadOnlyDB, identity: Identity, args: dict) -> dict:
    require_scope(identity, "rete:requests:read")
    row = database.pilot_status()
    return _serialize_datetime_fields(row)


def rete_list_locations(database: db.ReadOnlyDB, identity: Identity, args: dict) -> dict:
    require_scope(identity, "rete:health")
    rows = database.list_locations()
    return {"locations": [_serialize_datetime_fields(r) for r in rows]}


def _paginated_args(args: dict, cfg):
    limit = db.clamp_limit(args.get("limit"), cfg.default_list_limit, cfg.max_list_limit)
    offset = db.clamp_offset(args.get("offset"))
    return limit, offset


def rete_list_pending_confirmations(database: db.ReadOnlyDB, identity: Identity, args: dict, cfg) -> dict:
    require_scope(identity, "rete:requests:read")
    location_id = args.get("location_id")
    limit, offset = _paginated_args(args, cfg)
    rows = database.list_pending_confirmations(location_id, limit, offset)
    return {"requests": [_serialize_datetime_fields(r) for r in rows], "limit": limit, "offset": offset}


def rete_list_open_requests(database: db.ReadOnlyDB, identity: Identity, args: dict, cfg) -> dict:
    require_scope(identity, "rete:requests:read")
    location_id = args.get("location_id")
    limit, offset = _paginated_args(args, cfg)
    rows = database.list_open_requests(location_id, limit, offset)
    return {"requests": [_serialize_datetime_fields(r) for r in rows], "limit": limit, "offset": offset}


def rete_get_request(database: db.ReadOnlyDB, identity: Identity, args: dict) -> dict:
    require_scope(identity, "rete:requests:read")
    request_id = db.validate_uuid(args.get("request_id"))
    row = database.get_request(request_id)
    if row is None:
        raise ToolError("NOT_FOUND", "request not found")
    return {"request": _serialize_datetime_fields(row)}


def rete_list_offers(database: db.ReadOnlyDB, identity: Identity, args: dict, cfg) -> dict:
    require_scope(identity, "rete:offers:read")
    request_id = args.get("request_id")
    if request_id is not None:
        request_id = db.validate_uuid(request_id)
    location_id = args.get("location_id")
    limit, offset = _paginated_args(args, cfg)
    rows = database.list_offers(request_id, location_id, limit, offset)
    return {"offers": [_serialize_datetime_fields(r) for r in rows], "limit": limit, "offset": offset}


def rete_list_transfers(database: db.ReadOnlyDB, identity: Identity, args: dict, cfg) -> dict:
    require_scope(identity, "rete:transfers:read")
    request_id = args.get("request_id")
    if request_id is not None:
        request_id = db.validate_uuid(request_id)
    status = args.get("status")
    if status is not None:
        status = db.validate_enum(status, db.STATUS_ALLOWLIST_TRANSFERS, "status")
    limit, offset = _paginated_args(args, cfg)
    rows = database.list_transfers(request_id, status, limit, offset)
    return {"transfers": [_serialize_datetime_fields(r) for r in rows], "limit": limit, "offset": offset}


def rete_list_receipt_discrepancies(database: db.ReadOnlyDB, identity: Identity, args: dict, cfg) -> dict:
    require_scope(identity, "rete:transfers:read")
    resolved = args.get("resolved")
    if resolved is not None and not isinstance(resolved, bool):
        raise db.QueryError("INVALID_RESOLVED")
    limit, offset = _paginated_args(args, cfg)
    rows = database.list_receipt_discrepancies(resolved, limit, offset)
    return {"discrepancies": [_serialize_datetime_fields(r) for r in rows], "limit": limit, "offset": offset}


def rete_get_request_audit(database: db.ReadOnlyDB, identity: Identity, args: dict, cfg) -> dict:
    require_scope(identity, "rete:audit:read")
    request_id = db.validate_uuid(args.get("request_id"))
    limit = db.clamp_limit(args.get("limit"), cfg.default_list_limit, cfg.max_audit_limit)
    offset = db.clamp_offset(args.get("offset"))
    rows = database.get_request_audit(request_id, limit, offset)
    events = []
    for r in rows:
        d = _serialize_datetime_fields(r)
        d["payload"] = _redact_payload(d.get("payload"))
        events.append(d)
    return {"audit_events": events, "limit": limit, "offset": offset}


# name -> (callable, needs_cfg)
TOOL_REGISTRY = {
    "rete_get_health": (rete_get_health, False),
    "rete_get_pilot_status": (rete_get_pilot_status, False),
    "rete_list_locations": (rete_list_locations, False),
    "rete_list_pending_confirmations": (rete_list_pending_confirmations, True),
    "rete_list_open_requests": (rete_list_open_requests, True),
    "rete_get_request": (rete_get_request, False),
    "rete_list_offers": (rete_list_offers, True),
    "rete_list_transfers": (rete_list_transfers, True),
    "rete_list_receipt_discrepancies": (rete_list_receipt_discrepancies, True),
    "rete_get_request_audit": (rete_get_request_audit, True),
}
