# Rete Squillari production MCP — deployment runbook

This document describes how to deploy `scripts/rete_squillari_mcp_prod/` to
the target Hetzner host. **No step in this runbook has been executed as
part of this gate** — deployment was explicitly out of scope. This is a
design/artifact deliverable only.

## 1. One-time host setup

### 1.1 Non-root service user

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin rete-mcp
```

### 1.2 Directory layout (versioned release dir, not a single mutable checkout)

```
/opt/rete-squillari-mcp-prod/
  shared/
    venv/                    # Python virtualenv, rebuilt per release
    rete-mcp.env             # mode 600, owned by rete-mcp:rete-mcp — never in git
    revoked_jti.json         # mode 600, owned by rete-mcp:rete-mcp
  releases/
    <git-sha>/                # one directory per deployed commit
      scripts/rete_squillari_mcp_prod/
      scripts/rete_squillari_mcp_prod_server.py
  current -> releases/<git-sha>   # symlink, atomically repointed on deploy
```

```bash
sudo mkdir -p /opt/rete-squillari-mcp-prod/{shared,releases}
sudo chown -R rete-mcp:rete-mcp /opt/rete-squillari-mcp-prod
```

### 1.3 Firewall

Only the reverse proxy (Caddy, already running on this host for other
services) needs to reach the MCP process, and it does so over loopback —
the MCP's own port (8791) must **never** be exposed on a public interface.

```bash
# ufw example — adjust to whatever this host actually uses
sudo ufw deny 8791/tcp        # explicit: never reachable except via 127.0.0.1
```

Public firewall surface for this service is exactly Caddy's existing
443/tcp (HTTPS) and 80/tcp (ACME challenge / redirect to HTTPS) — nothing
new to open.

## 2. Per-release deployment

```bash
GIT_SHA=<commit-sha-of-the-merged-mcp-pr>
RELEASE_DIR=/opt/rete-squillari-mcp-prod/releases/$GIT_SHA

sudo -u rete-mcp mkdir -p "$RELEASE_DIR"
sudo -u rete-mcp git -C /tmp clone --depth 1 --branch main \
  https://github.com/squillariqr-jpg/divino-ai-wine-system1.git divino-tmp-$GIT_SHA
sudo -u rete-mcp cp -r /tmp/divino-tmp-$GIT_SHA/scripts/rete_squillari_mcp_prod \
  "$RELEASE_DIR/rete_squillari_mcp_prod"
sudo -u rete-mcp cp /tmp/divino-tmp-$GIT_SHA/scripts/rete_squillari_mcp_prod_server.py \
  "$RELEASE_DIR/"
rm -rf /tmp/divino-tmp-$GIT_SHA

# Rebuild the shared venv against this release's requirements (kept
# outside the release dir so it is not duplicated per-release).
sudo -u rete-mcp python3 -m venv /opt/rete-squillari-mcp-prod/shared/venv
sudo -u rete-mcp /opt/rete-squillari-mcp-prod/shared/venv/bin/pip install \
  -r "$RELEASE_DIR/rete_squillari_mcp_prod/../../deploy/rete-squillari-mcp-prod/requirements.txt"

# Atomic cutover
sudo -u rete-mcp ln -sfn "$RELEASE_DIR" /opt/rete-squillari-mcp-prod/current
sudo systemctl restart rete-squillari-mcp-prod
sudo systemctl status rete-squillari-mcp-prod --no-pager
curl -sf http://127.0.0.1:8791/healthz
```

### 2.1 First-time systemd install

```bash
sudo cp deploy/rete-squillari-mcp-prod/rete-squillari-mcp-prod.service \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable rete-squillari-mcp-prod
```

### 2.2 First-time secrets

```bash
sudo cp deploy/rete-squillari-mcp-prod/rete-mcp.env.template \
  /opt/rete-squillari-mcp-prod/shared/rete-mcp.env
sudo chmod 600 /opt/rete-squillari-mcp-prod/shared/rete-mcp.env
sudo chown rete-mcp:rete-mcp /opt/rete-squillari-mcp-prod/shared/rete-mcp.env
# edit in place with real values (RETE_MCP_DATABASE_URL, RETE_MCP_JWT_SECRET)
```

Create the `rete_mcp_reader` Postgres role's login password directly
against the linked Supabase project (never in a migration, never in git):

```bash
psql "$SUPABASE_DB_URL" -c \
  "ALTER ROLE rete_mcp_reader WITH LOGIN PASSWORD '$(openssl rand -base64 32)';"
```

Record the generated password only in the env file above and in whatever
secret manager this operator already uses for other Hetzner-hosted
services — never in a chat log, ticket, or commit message.

## 3. Issuing client tokens

Run directly on the host (or any trusted machine with the same
`RETE_MCP_JWT_SECRET`), never over the network:

```bash
RETE_MCP_JWT_SECRET=$(grep RETE_MCP_JWT_SECRET /opt/rete-squillari-mcp-prod/shared/rete-mcp.env | cut -d= -f2) \
  /opt/rete-squillari-mcp-prod/shared/venv/bin/python3 \
  /opt/rete-squillari-mcp-prod/current/rete_squillari_mcp_prod/issue_token.py \
  --sub wbos-pipeline --scopes rete:read --expires-in-days 90
```

## 4. Revoking a token

Append the token's `jti` (printed to stderr at issuance time) to
`revoked_jti.json`:

```bash
sudo -u rete-mcp python3 -c "
import json
p = '/opt/rete-squillari-mcp-prod/shared/revoked_jti.json'
try:
    d = json.load(open(p))
except FileNotFoundError:
    d = {'revoked_jti': []}
d['revoked_jti'].append('<jti-to-revoke>')
json.dump(d, open(p, 'w'))
"
```

The running server picks this up within 30 seconds (see
`TokenVerifier._reload_revoked`) — no restart required.

## 5. Rollback

Deployment is fully atomic and reversible: releases are immutable,
versioned directories, and cutover is a single symlink repoint.

```bash
PREVIOUS_SHA=<the-git-sha-that-was-live-before-the-bad-release>
sudo -u rete-mcp ln -sfn /opt/rete-squillari-mcp-prod/releases/$PREVIOUS_SHA \
  /opt/rete-squillari-mcp-prod/current
sudo systemctl restart rete-squillari-mcp-prod
curl -sf http://127.0.0.1:8791/healthz
```

No database rollback is ever required for an MCP-only release, since this
service performs no writes and the `rete_mcp_reader` role/grants live in
their own migration (`20260720100000_rete_squillari_mcp_readonly_role.sql`),
independent of any MCP application release.

## 6. Log rotation

systemd/journald already rotates the service's stdout/stderr logs per the
host's existing `journald.conf` policy. Caddy's access log for this
vhost is rotated per the `Caddyfile.snippet` (50MiB / keep 10 / keep 30
days) — adjust to match this host's existing retention policy for other
services.

## 7. Backup

This service holds no state of its own (no local database, no writable
files beyond the env/revocation files, which are small and manually
maintained). Back up `/opt/rete-squillari-mcp-prod/shared/rete-mcp.env`
and `revoked_jti.json` via whatever mechanism already backs up this host's
other `/opt/*` service configs.

## 8. Explicitly NOT done by this runbook or this gate

- No DNS record was created for `mcp-rete-squillari.example.com` (a
  placeholder — the real subdomain is a decision for the operator).
- No `rete_mcp_reader` password was generated or set.
- No systemd unit was installed on any host.
- No Caddy config was reloaded on any host.
- The service has never been started outside a local development machine.
