from dataclasses import dataclass
import hashlib, hmac, time

class CredentialVerifier:
    def verify(self, token): raise NotImplementedError

class StaticDigestCredentialVerifier(CredentialVerifier):
    def __init__(self, digest, credential_id="rete-squillari-local-readonly"): self.digest, self.credential_id = digest, credential_id
    def verify(self, token):
        if not token or not self.digest: return None
        candidate = hashlib.sha256(token.encode()).hexdigest()
        return self.credential_id if hmac.compare_digest(candidate, self.digest) else None

@dataclass(frozen=True)
class Principal:
    connector_id: str; service_id: str; actor_type: str; actor_id: str; agent_id: str; agent_run_id: str; session_id: str; authorized_location_ids: tuple; capabilities: tuple; correlation_id: str; credential_id: str; issued_at: float; expires_at: float

class LocalProfile:
    capabilities = ("rete_squillari.locations.read", "rete_squillari.shortages.read", "rete_squillari.shortages.validate", "rete_squillari.print.preview")
    locations = ("malta", "sestri", "cantore", "trento", "de_ferrari", "armenia", "trasta")
    def principal(self, credential_id, session_id, metadata):
        now = time.time()
        return Principal("local-mcp", "rete-squillari-mcp", "AGENT", "rete-squillari-local-agent", metadata.get("agent_id", "local-agent"), metadata.get("agent_run_id", "local-run"), session_id, self.locations, self.capabilities, metadata.get("correlation_id", "mcp-correlation"), credential_id, now, now + 900)
