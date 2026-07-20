"""Bearer-token authentication and scope-based authorization for the
production Rete Squillari MCP server.

Tokens are standard signed JWTs (HS256), issued out-of-band by
scripts/rete_squillari_mcp_prod/issue_token.py - never by the MCP server
itself (this server exposes no token-issuance tool; it is strictly
read-only). Verification checks signature, issuer, audience, and expiry
(all via PyJWT, which uses constant-time comparison internally), plus a
revocation list keyed by the token's unique jti claim.

No STATIC_TEST_TOKEN, no shared test-token environment variable, no
anonymous fallback mode: a request with no token, an invalid token, an
expired token, or a token missing the required scope is rejected the same
way - a generic AUTHORIZATION_DENIED error that does not distinguish which
check failed, so a caller probing for valid client identities learns
nothing from the failure mode.
"""
from dataclasses import dataclass
import json
import os
import time

import jwt

ALL_SCOPES = frozenset({
    "rete:read",
    "rete:health",
    "rete:requests:read",
    "rete:offers:read",
    "rete:transfers:read",
    "rete:audit:read",
})

# rete:read is a superset scope: any tool gated on a narrower scope also
# accepts a token that holds rete:read.
_BROAD_SCOPE = "rete:read"


class AuthError(Exception):
    def __init__(self, reason_code: str):
        self.reason_code = reason_code
        super().__init__(reason_code)


@dataclass(frozen=True)
class Identity:
    sub: str
    scopes: frozenset
    jti: str

    def has_scope(self, required: str) -> bool:
        return required in self.scopes or _BROAD_SCOPE in self.scopes


class TokenVerifier:
    def __init__(self, secret: str, issuer: str, audience: str, revoked_jti_path: str = ""):
        if not secret:
            raise ValueError("secret is required")
        self._secret = secret
        self._issuer = issuer
        self._audience = audience
        self._revoked_jti_path = revoked_jti_path
        self._revoked_cache: frozenset = frozenset()
        self._revoked_cache_loaded_at = 0.0
        self._reload_revoked(force=True)

    def _reload_revoked(self, force: bool = False) -> None:
        if not self._revoked_jti_path:
            return
        now = time.time()
        if not force and now - self._revoked_cache_loaded_at < 30:
            return
        try:
            with open(self._revoked_jti_path, "r") as f:
                data = json.load(f)
            self._revoked_cache = frozenset(data.get("revoked_jti", []))
        except FileNotFoundError:
            self._revoked_cache = frozenset()
        except (json.JSONDecodeError, OSError):
            # Fail closed: if the revocation list is unreadable/corrupt, do
            # not silently treat it as empty - refuse to authenticate at all
            # until it is fixed, since we cannot prove nothing is revoked.
            raise AuthError("REVOCATION_LIST_UNAVAILABLE")
        self._revoked_cache_loaded_at = now

    def verify(self, authorization_header: str) -> Identity:
        if not authorization_header or not authorization_header.startswith("Bearer "):
            raise AuthError("MISSING_TOKEN")
        token = authorization_header[len("Bearer "):].strip()
        if not token:
            raise AuthError("MISSING_TOKEN")
        try:
            # algorithms=["HS256"] is an explicit allowlist, not a hint -
            # PyJWT never trusts the token's own header to pick the
            # algorithm, which is what blocks both the classic "alg:none"
            # attack and algorithm-confusion attacks. No `leeway` is
            # passed (defaults to 0 seconds): zero clock-skew tolerance is
            # the more conservative choice for a service issuing and
            # validating tokens on infrastructure the operator controls
            # directly - the alternative (a grace window) would mean
            # sometimes accepting an expired token, never the reverse.
            # `nbf` is deliberately not required or issued: every token
            # this service issues is valid immediately from `iat`, and
            # PyJWT already ignores nbf validation entirely when nbf is
            # absent from a token, so there is nothing to relax or
            # tighten either way. This algorithm/secret pairing also means
            # a real Supabase user JWT (signed with the project's own,
            # separate JWT secret) can never be accepted here by
            # accident - signature verification fails immediately - as
            # long as RETE_MCP_JWT_SECRET is generated independently and
            # is never set to the Supabase project's own JWT secret (see
            # the runbook: `openssl rand -base64 48`, a fresh value).
            claims = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                issuer=self._issuer,
                audience=self._audience,
                options={"require": ["exp", "iat", "sub", "jti", "scopes"]},
            )
        except jwt.ExpiredSignatureError:
            raise AuthError("EXPIRED_TOKEN")
        except jwt.InvalidAudienceError:
            raise AuthError("WRONG_AUDIENCE")
        except jwt.InvalidIssuerError:
            raise AuthError("WRONG_ISSUER")
        except jwt.PyJWTError:
            raise AuthError("INVALID_TOKEN")

        self._reload_revoked()
        jti = claims.get("jti", "")
        if jti in self._revoked_cache:
            raise AuthError("REVOKED_TOKEN")

        scopes = claims.get("scopes")
        if not isinstance(scopes, list) or not scopes:
            raise AuthError("INVALID_TOKEN")
        unknown = set(scopes) - ALL_SCOPES
        if unknown:
            raise AuthError("INVALID_TOKEN")

        return Identity(sub=claims["sub"], scopes=frozenset(scopes), jti=jti)


def require_scope(identity: Identity, required_scope: str) -> None:
    if not identity.has_scope(required_scope):
        raise AuthError("MISSING_SCOPE")
