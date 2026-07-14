import secrets, time
from enum import Enum

class LifecycleState(str, Enum):
    NEW = "NEW"; INITIALIZED = "INITIALIZED"; READY = "READY"; CLOSED = "CLOSED"

class SessionStore:
    def __init__(self, ttl): self.ttl, self.sessions = ttl, {}
    def create(self, credential_id, protocol_version=None):
        sid = "mcp_" + secrets.token_urlsafe(32); now = time.time()
        self.sessions[sid] = {"session_id": sid, "credential_id": credential_id, "negotiated_protocol_version": protocol_version, "lifecycle_state": LifecycleState.NEW, "created_at": now, "expires_at": now + self.ttl, "last_seen_at": now, "nonces": set()}
        return sid
    def validate(self, sid, credential_id):
        item = self.sessions.get(sid)
        if not item or item["credential_id"] != credential_id or item["expires_at"] <= time.time(): return None
        return item
    def touch(self, item): item["last_seen_at"] = time.time()
    def close(self, sid):
        if sid in self.sessions: self.sessions[sid]["lifecycle_state"] = LifecycleState.CLOSED
    def accept_nonce(self, sid, nonce):
        if not isinstance(nonce, str) or not nonce or len(nonce) > 128 or not nonce.isascii(): return False
        item = self.sessions.get(sid)
        if not item or nonce in item["nonces"]: return False
        item["nonces"].add(nonce); return True
