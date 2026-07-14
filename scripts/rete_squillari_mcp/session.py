import time, uuid

class SessionStore:
    def __init__(self, ttl): self.ttl, self.sessions = ttl, {}
    def create(self, credential_id):
        sid = "mcp_" + uuid.uuid4().hex; now = time.time(); self.sessions[sid] = {"credential_id": credential_id, "created_at": now, "expires_at": now + self.ttl, "last_seen_at": now, "request_count": 0, "nonces": set()}; return sid
    def validate(self, sid, credential_id):
        item = self.sessions.get(sid)
        if not item or item["credential_id"] != credential_id or item["expires_at"] <= time.time(): return None
        item["last_seen_at"] = time.time(); return item
    def accept_nonce(self, sid, nonce):
        if not nonce or len(nonce) > 128: return False
        item = self.sessions.get(sid)
        if not item or nonce in item["nonces"]: return False
        item["nonces"].add(nonce); return True
