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
    worker_start_method: str = "fork"
    shutdown_grace_ms: int = 5000
    worker_shutdown_grace_ms: int = 2000
    audit_sink: str = "memory"
    max_active_workers: int = 10
    environment: str = "local"

    @classmethod
    def from_env(cls, transport="STDIO"):
        token = os.environ.get("RETE_SQUILLARI_MCP_TEST_TOKEN", "")
        env = os.environ.get("RETE_SQUILLARI_MCP_ENV", "local")
        transport_env = os.environ.get("RETE_SQUILLARI_MCP_TRANSPORT", transport)
        audit_default = "memory"
        if env == "staging":
            audit_default = "stdout_json" if transport_env == "STREAMABLE_HTTP" else "stderr_json"
        
        return cls(
            transport=transport_env,
            bind_host=os.environ.get("RETE_SQUILLARI_MCP_BIND_HOST", "127.0.0.1"),
            bind_port=int(os.environ.get("RETE_SQUILLARI_MCP_BIND_PORT", "8767")),
            token_digest=hashlib.sha256(token.encode()).hexdigest() if token else "",
            environment=env,
            worker_start_method=os.environ.get("RETE_SQUILLARI_MCP_WORKER_START_METHOD", "spawn" if env == "staging" else "fork"),
            audit_sink=os.environ.get("RETE_SQUILLARI_MCP_AUDIT_SINK", audit_default)
        )

    def validate(self):
        if self.transport not in ("STDIO", "STREAMABLE_HTTP"): return "INVALID_TRANSPORT"
        if self.audit_sink not in ("memory", "stdout_json", "stderr_json"): return "INVALID_AUDIT_SINK"
        if self.auth_mode not in ("STATIC_TEST_TOKEN", "EXTERNAL_VERIFIER_INTERFACE"): return "INVALID_CONFIG"
        if self.transport == "STREAMABLE_HTTP" and self.environment == "local" and self.bind_host not in ("127.0.0.1", "::1"): return "NON_LOOPBACK_BIND_DENIED"
        if not self.token_digest or self.source_mode != "DEMO": return "MISSING_AUTH_OR_INVALID_SOURCE"
        if self.max_payload_bytes <= 0 or self.max_requests_per_minute <= 0 or self.session_ttl_seconds <= 0 or self.worker_max_response_bytes <= 0 or self.worker_terminate_grace_ms < 0: return "INVALID_CONFIG"
        if self.environment == "staging":
            if self.worker_start_method != "spawn": return "STAGING_REQUIRES_SPAWN"
            if self.transport == "STDIO" and self.audit_sink != "stderr_json": return "STAGING_STDIO_STDERR_AUDIT_REQUIRED"
            if self.transport == "STREAMABLE_HTTP" and self.audit_sink != "stdout_json": return "STAGING_HTTP_STDOUT_AUDIT_REQUIRED"
        
        if self.transport == "STDIO" and self.audit_sink == "stdout_json": return "STDIO_STDOUT_AUDIT_FORBIDDEN"
        
        if self.environment == "production": return "PRODUCTION_NOT_AUTHORIZED"
        if self.worker_start_method not in ("spawn", "forkserver", "fork"): return "INVALID_WORKER_START_METHOD"
        return None
