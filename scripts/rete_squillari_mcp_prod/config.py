"""Production configuration for the Supabase-backed read-only Rete Squillari
MCP server. Entirely environment-driven - no STATIC_TEST_TOKEN mode, no
demo/fallback source, no hardcoded credentials anywhere in this file or
committed to the repository.
"""
from dataclasses import dataclass, field
from urllib.parse import urlparse, parse_qs
import os


class ConfigError(ValueError):
    pass


_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}

# Reverse-proxy reachability exception, added for the Hetzner
# (ubuntu-4gb-fsn1-1) deployment: on that host Caddy itself runs inside a
# Docker container (n8n-caddy-1, on the n8n_default network,
# 172.18.0.0/16) rather than natively, so a strictly-loopback bind is
# unreachable from Caddy - 127.0.0.1 inside that container is the
# container's own loopback, not the host's. 172.17.0.1 is the default
# docker0 bridge gateway on that exact host (verified live via `docker
# network inspect bridge`); Docker's inter-bridge routing was empirically
# confirmed to deliver traffic from a container on a different
# user-defined network to this address. This is intentionally a single
# named IP, not a general "allow any non-loopback bind_host" carve-out:
# anything reachable via the default bridge gateway is reachable by any
# container on that host's default bridge network, a materially wider
# boundary than "only Caddy" - narrower than binding to a public
# interface, but every call still requires a valid bearer JWT regardless.
_DOCKER_BRIDGE_GATEWAY_EXCEPTIONS = {"172.17.0.1"}


@dataclass(frozen=True)
class MCPConfig:
    # Database (rete_mcp_reader role only - never the Supabase service role
    # or the project's superuser/postgres credentials).
    database_url: str
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10
    db_statement_timeout_ms: int = 5000
    db_connect_timeout_s: int = 5

    # Auth
    jwt_secret: str = ""
    jwt_issuer: str = "rete-squillari-mcp-prod"
    jwt_audience: str = "rete-squillari-mcp-prod"
    revoked_jti_path: str = ""

    # Transport
    bind_host: str = "127.0.0.1"
    bind_port: int = 8791
    max_payload_bytes: int = 32768

    # Query safety defaults
    default_list_limit: int = 25
    max_list_limit: int = 100
    max_audit_limit: int = 200
    request_timeout_ms: int = 4000
    max_requests_per_minute_per_client: int = 120

    # Observability
    log_level: str = "INFO"
    environment: str = "production"

    def validate(self) -> None:
        if not self.database_url:
            raise ConfigError("DATABASE_URL is required")
        if "service_role" in self.database_url or "postgres:postgres@" in self.database_url:
            raise ConfigError(
                "DATABASE_URL must not use the service_role or postgres superuser credential; "
                "use the dedicated rete_mcp_reader role"
            )
        parsed = urlparse(self.database_url)
        if parsed.hostname not in _LOOPBACK_HOSTS:
            # A remote database connection (e.g. the linked Supabase
            # project) must be both encrypted and certificate-verified.
            # sslmode=require alone only encrypts the connection - it does
            # NOT validate the server certificate against a CA, so it does
            # not protect against a MITM presenting a spoofed certificate.
            # sslmode=verify-full validates both the certificate chain and
            # that the hostname matches. Loopback connections (local dev/
            # test against the local Supabase stack) are exempt, matching
            # the same reasoning already applied to bind_host below.
            qs = parse_qs(parsed.query)
            sslmode = (qs.get("sslmode") or [""])[0]
            if sslmode != "verify-full":
                raise ConfigError(
                    "DATABASE_URL must use sslmode=verify-full for any non-loopback host - "
                    f"got sslmode={sslmode!r}. sslmode=require alone encrypts the connection "
                    "but does not verify the server certificate."
                )
        if not self.jwt_secret or len(self.jwt_secret) < 32:
            raise ConfigError("MCP_JWT_SECRET is required and must be at least 32 characters")
        if self.bind_host not in _LOOPBACK_HOSTS | _DOCKER_BRIDGE_GATEWAY_EXCEPTIONS:
            raise ConfigError(
                "bind_host must be a loopback address (or the documented Docker-bridge-gateway "
                "exception) - this server is designed to sit behind a TLS-terminating reverse "
                "proxy, never bound directly to a public interface"
            )
        if self.max_list_limit > 100:
            raise ConfigError("max_list_limit must not exceed 100")
        if self.max_audit_limit > 200:
            raise ConfigError("max_audit_limit must not exceed 200")

    @classmethod
    def from_env(cls) -> "MCPConfig":
        def _int(name: str, default: int) -> int:
            v = os.environ.get(name)
            return int(v) if v else default

        cfg = cls(
            database_url=os.environ.get("RETE_MCP_DATABASE_URL", ""),
            db_pool_min_size=_int("RETE_MCP_DB_POOL_MIN", 1),
            db_pool_max_size=_int("RETE_MCP_DB_POOL_MAX", 10),
            db_statement_timeout_ms=_int("RETE_MCP_DB_STATEMENT_TIMEOUT_MS", 5000),
            db_connect_timeout_s=_int("RETE_MCP_DB_CONNECT_TIMEOUT_S", 5),
            jwt_secret=os.environ.get("RETE_MCP_JWT_SECRET", ""),
            jwt_issuer=os.environ.get("RETE_MCP_JWT_ISSUER", "rete-squillari-mcp-prod"),
            jwt_audience=os.environ.get("RETE_MCP_JWT_AUDIENCE", "rete-squillari-mcp-prod"),
            revoked_jti_path=os.environ.get("RETE_MCP_REVOKED_JTI_PATH", ""),
            bind_host=os.environ.get("RETE_MCP_BIND_HOST", "127.0.0.1"),
            bind_port=_int("RETE_MCP_BIND_PORT", 8791),
            max_payload_bytes=_int("RETE_MCP_MAX_PAYLOAD_BYTES", 32768),
            default_list_limit=_int("RETE_MCP_DEFAULT_LIST_LIMIT", 25),
            max_list_limit=_int("RETE_MCP_MAX_LIST_LIMIT", 100),
            max_audit_limit=_int("RETE_MCP_MAX_AUDIT_LIMIT", 200),
            request_timeout_ms=_int("RETE_MCP_REQUEST_TIMEOUT_MS", 4000),
            max_requests_per_minute_per_client=_int("RETE_MCP_RATE_LIMIT_PER_MIN", 120),
            log_level=os.environ.get("RETE_MCP_LOG_LEVEL", "INFO"),
            environment=os.environ.get("RETE_MCP_ENV", "production"),
        )
        cfg.validate()
        return cfg
