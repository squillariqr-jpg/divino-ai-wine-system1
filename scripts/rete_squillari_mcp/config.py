from dataclasses import dataclass
import hashlib, os

@dataclass(frozen=True)
class MCPConfig:
    transport: str = "STDIO"
    bind_host: str = "127.0.0.1"
    bind_port: int = 8767
    auth_mode: str = "STATIC_TEST_TOKEN"
    token_digest: str = ""
    token_id: str = "rete-squillari-local-readonly"
    allowed_origins: tuple = ()
    max_payload_bytes: int = 32768
    max_string_length: int = 512
    max_array_items: int = 100
    request_timeout_ms: int = 2000
    max_requests_per_minute: int = 60
    session_ttl_seconds: int = 900
    clock_skew_seconds: int = 5
    source_mode: str = "DEMO"
    supported_protocol_versions: tuple = ("2025-06-18", "2025-11-25")
    worker_max_response_bytes: int = 65536
    worker_terminate_grace_ms: int = 100
    worker_test_mode: str = ""

    @classmethod
    def from_env(cls, transport="STDIO"):
        token = os.environ.get("RETE_SQUILLARI_MCP_TEST_TOKEN", "")
        return cls(transport=transport, bind_host=os.environ.get("RETE_SQUILLARI_MCP_BIND_HOST", "127.0.0.1"), bind_port=int(os.environ.get("RETE_SQUILLARI_MCP_BIND_PORT", "8767")), token_digest=hashlib.sha256(token.encode()).hexdigest() if token else "")

    def validate(self):
        if self.transport not in ("STDIO", "STREAMABLE_HTTP") or self.auth_mode not in ("STATIC_TEST_TOKEN", "EXTERNAL_VERIFIER_INTERFACE"): return "INVALID_CONFIG"
        if self.transport == "STREAMABLE_HTTP" and self.bind_host not in ("127.0.0.1", "::1"): return "NON_LOOPBACK_BIND_DENIED"
        if not self.token_digest or self.source_mode != "DEMO": return "MISSING_AUTH_OR_INVALID_SOURCE"
        if self.max_payload_bytes <= 0 or self.max_requests_per_minute <= 0 or self.session_ttl_seconds <= 0 or self.worker_max_response_bytes <= 0 or self.worker_terminate_grace_ms < 0: return "INVALID_CONFIG"
        return None
