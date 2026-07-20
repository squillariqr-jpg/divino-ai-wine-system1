#!/usr/bin/env python3
"""Out-of-band operator CLI to mint a bearer token for the production Rete
Squillari MCP server. This is never invoked by the MCP server itself and
is not reachable over the network - it must be run directly on a trusted
machine with RETE_MCP_JWT_SECRET available in the environment.

Usage:
  RETE_MCP_JWT_SECRET=... python3 issue_token.py \\
      --sub wbos-pipeline --scopes rete:read --expires-in-days 90

Prints the signed token to stdout exactly once. The caller is responsible
for delivering it to the client out-of-band and never logging it.
"""
import argparse
import os
import sys
import time
import uuid

import jwt

from rete_squillari_mcp_prod.auth import ALL_SCOPES


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sub", required=True, help="client identifier, e.g. wbos-pipeline")
    parser.add_argument(
        "--scopes", required=True, nargs="+", choices=sorted(ALL_SCOPES),
        help="one or more scopes to grant",
    )
    parser.add_argument("--expires-in-days", type=int, default=90)
    parser.add_argument("--issuer", default=os.environ.get("RETE_MCP_JWT_ISSUER", "rete-squillari-mcp-prod"))
    parser.add_argument("--audience", default=os.environ.get("RETE_MCP_JWT_AUDIENCE", "rete-squillari-mcp-prod"))
    args = parser.parse_args()

    secret = os.environ.get("RETE_MCP_JWT_SECRET", "")
    if not secret or len(secret) < 32:
        print("RETE_MCP_JWT_SECRET must be set (>=32 chars) in the environment", file=sys.stderr)
        return 1
    if args.expires_in_days <= 0 or args.expires_in_days > 365:
        print("--expires-in-days must be between 1 and 365", file=sys.stderr)
        return 1

    now = int(time.time())
    jti = str(uuid.uuid4())
    claims = {
        "sub": args.sub,
        "scopes": args.scopes,
        "iss": args.issuer,
        "aud": args.audience,
        "iat": now,
        "exp": now + args.expires_in_days * 86400,
        "jti": jti,
    }
    token = jwt.encode(claims, secret, algorithm="HS256")
    print(token)
    print(f"jti={jti} sub={args.sub} scopes={','.join(args.scopes)} expires_in_days={args.expires_in_days}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
