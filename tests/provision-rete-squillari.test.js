const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const provisioning = require(path.join('..', 'scripts', 'provision_rete_squillari.js'));

const {
  LOCATION_MATRIX,
  STORE_ENTRIES,
  CENTRAL_ENTRY,
  classifyAdminSecretKey,
  classifySupabaseUrl,
  CANONICAL_PROJECT_REF,
  CANONICAL_SUPABASE_HOSTNAME,
  CANONICAL_SUPABASE_URL,
  verifyRemoteLocationMatrix,
  buildProvisioningPlan,
  validateMatrixStructure,
  validateProvisioningStructure,
  provisionEntry,
  buildMembershipPayload,
  MEMBERSHIP_UPSERT_CONFLICT_TARGET
} = provisioning;

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'provision_rete_squillari.js');

function byName(name) {
  return STORE_ENTRIES.find((e) => e.name === name);
}

// ---------------------------------------------------------------------------
// PROBLEMA 1 — mapping matrix
// ---------------------------------------------------------------------------

assert.strictEqual(byName('Malta').location_id, 2, 'Malta must map to location_id 2');
assert.strictEqual(byName('Sestri').location_id, 4, 'Sestri must map to location_id 4');
assert.strictEqual(byName('Cantore').location_id, 5, 'Cantore must map to location_id 5');
assert.strictEqual(byName('Trento').location_id, 6, 'Trento must map to location_id 6');
assert.strictEqual(byName('De Ferrari').location_id, 7, 'De Ferrari must map to location_id 7');
assert.strictEqual(byName('Armenia').location_id, 8, 'Armenia must map to location_id 8');
assert.strictEqual(CENTRAL_ENTRY.location_id, null, 'Centrale must have a null location_id');
assert.strictEqual(CENTRAL_ENTRY.role, 'central');

const usedLocationIds = STORE_ENTRIES.map((e) => e.location_id);
assert.ok(!usedLocationIds.includes(1), 'location_id 1 must never be used by the provisioning matrix');
assert.ok(!usedLocationIds.includes(3), 'location_id 3 must never be used by the provisioning matrix');

// Nessuna derivazione sequenziale: l'indice nell'array (+1) non deve coincidere
// sistematicamente con location_id per tutte le voci store.
const sequentialMatches = STORE_ENTRIES.filter((entry, index) => entry.location_id === index + 1).length;
assert.notStrictEqual(sequentialMatches, STORE_ENTRIES.length, 'location_id must not be derivable from array position + 1');

assert.ok(!LOCATION_MATRIX.some((e) => e.name === 'Trasta'), 'Trasta must be absent from the provisioning matrix (not a store)');
assert.strictEqual(STORE_ENTRIES.length, 6, 'exactly 6 store entries expected');
assert.strictEqual(LOCATION_MATRIX.length, 7, 'exactly 7 total identities expected (6 store + 1 central)');

// ---------------------------------------------------------------------------
// Read-only remote location matrix verification — fail-closed on divergence
// ---------------------------------------------------------------------------

const authoritativeRemoteRows = STORE_ENTRIES.map((e) => ({ id: e.location_id, code: e.code, name: e.name, active: true }));
assert.strictEqual(verifyRemoteLocationMatrix(authoritativeRemoteRows).ok, true, 'matching remote rows (all active) must verify OK');

// Divergent matrix (e.g. the legacy sequential 1..6 ids currently present in the
// local dev schema) must be rejected fail-closed, never silently accepted.
const sequentialRemoteRows = [
  { id: 1, code: 101, name: 'Malta', active: true },
  { id: 2, code: 102, name: 'Sestri', active: true },
  { id: 3, code: 103, name: 'Cantore', active: true },
  { id: 4, code: 104, name: 'Trento', active: true },
  { id: 5, code: 105, name: 'De Ferrari', active: true },
  { id: 6, code: 106, name: 'Armenia', active: true }
];
const divergent = verifyRemoteLocationMatrix(sequentialRemoteRows);
assert.strictEqual(divergent.ok, false, 'divergent remote matrix must fail-closed');
assert.ok(divergent.mismatches.length > 0);

assert.strictEqual(verifyRemoteLocationMatrix([]).ok, false, 'empty remote matrix must fail-closed');
assert.strictEqual(
  verifyRemoteLocationMatrix([...authoritativeRemoteRows, { id: 99, code: 999, name: 'Trasta', active: true }]).ok,
  false,
  'an unexpected extra location (e.g. Trasta) must fail-closed'
);

// ---------------------------------------------------------------------------
// F-2 — remote verification must also check `active` and reject duplicates
// ---------------------------------------------------------------------------

{
  const oneInactive = authoritativeRemoteRows.map((r) => ({ ...r }));
  oneInactive[0] = { ...oneInactive[0], active: false };
  assert.strictEqual(verifyRemoteLocationMatrix(oneInactive).ok, false, 'active=false on any store must fail-closed');

  const missingActiveField = authoritativeRemoteRows.map((r) => ({ ...r }));
  delete missingActiveField[0].active;
  assert.strictEqual(verifyRemoteLocationMatrix(missingActiveField).ok, false, 'missing active field must fail-closed');

  const nonBooleanActive = authoritativeRemoteRows.map((r) => ({ ...r }));
  nonBooleanActive[0] = { ...nonBooleanActive[0], active: 'true' };
  assert.strictEqual(verifyRemoteLocationMatrix(nonBooleanActive).ok, false, 'non-boolean active value must fail-closed');

  const missingLocation = authoritativeRemoteRows.filter((r) => r.name !== 'Malta');
  assert.strictEqual(verifyRemoteLocationMatrix(missingLocation).ok, false, 'a missing certified location must fail-closed');

  const duplicateLocation = [...authoritativeRemoteRows, { ...authoritativeRemoteRows[0] }];
  const duplicateResult = verifyRemoteLocationMatrix(duplicateLocation);
  assert.strictEqual(duplicateResult.ok, false, 'a duplicated location row must fail-closed');
  assert.ok(duplicateResult.mismatches.some((m) => m.reason === 'DUPLICATE_IN_REMOTE'));

  const divergentField = authoritativeRemoteRows.map((r) => ({ ...r }));
  divergentField[0] = { ...divergentField[0], code: 999 };
  assert.strictEqual(verifyRemoteLocationMatrix(divergentField).ok, false, 'id/code/name divergence must fail-closed');

  // Centrale is never part of the remote rete_locations check (role central,
  // location_id null) — the certified matrix itself enforces this (see F-3
  // structural checks below), independent of what the remote table returns.
  assert.strictEqual(CENTRAL_ENTRY.location_id, null);
}

// ---------------------------------------------------------------------------
// F-4 — location codes must equal location_id (aligned to the certified
// remote project ljuyolwnlbqlfxjujfrq), never the old local-migration
// convention (101-106).
// ---------------------------------------------------------------------------

const EXPECTED_CODE_BY_NAME = {
  Malta: 2,
  Sestri: 4,
  Cantore: 5,
  Trento: 6,
  'De Ferrari': 7,
  Armenia: 8
};

// 1) the six location_id values are exactly 2,4,5,6,7,8.
assert.deepStrictEqual(
  STORE_ENTRIES.map((e) => e.location_id).sort((a, b) => a - b),
  [2, 4, 5, 6, 7, 8],
  'the six store location_id values must be exactly 2,4,5,6,7,8'
);

// 2) the six code values are exactly 2,4,5,6,7,8.
assert.deepStrictEqual(
  STORE_ENTRIES.map((e) => e.code).sort((a, b) => a - b),
  [2, 4, 5, 6, 7, 8],
  'the six store code values must be exactly 2,4,5,6,7,8'
);

// 3) for every store, code === location_id, and none of the old 101-106
// local-migration values remain.
for (const entry of STORE_ENTRIES) {
  assert.strictEqual(entry.code, entry.location_id, `${entry.name}: code must equal location_id`);
  assert.strictEqual(EXPECTED_CODE_BY_NAME[entry.name], entry.code, `${entry.name}: code must match the certified remote value`);
  assert.ok(entry.code < 100, `${entry.name}: code must not use the old local-migration convention (101-106)`);
}

// 4) verifyRemoteLocationMatrix accepts an independently constructed synthetic
// fixture using the certified code === id convention (not derived from
// STORE_ENTRIES, to avoid a tautological comparison).
const certifiedRemoteFixture = [
  { id: 2, code: 2, name: 'Malta', active: true },
  { id: 4, code: 4, name: 'Sestri', active: true },
  { id: 5, code: 5, name: 'Cantore', active: true },
  { id: 6, code: 6, name: 'Trento', active: true },
  { id: 7, code: 7, name: 'De Ferrari', active: true },
  { id: 8, code: 8, name: 'Armenia', active: true }
];
assert.strictEqual(verifyRemoteLocationMatrix(certifiedRemoteFixture).ok, true, 'the certified code===id fixture must verify OK');

// 5) a single legacy code (101-106) must be rejected fail-closed, even if
// id/name/active are otherwise correct.
{
  const oneLegacyCode = certifiedRemoteFixture.map((r) => ({ ...r }));
  oneLegacyCode[0] = { ...oneLegacyCode[0], code: 101 };
  const result = verifyRemoteLocationMatrix(oneLegacyCode);
  assert.strictEqual(result.ok, false, 'a single legacy code (101) must fail-closed');
  assert.ok(result.mismatches.some((m) => m.name === 'Malta' && m.reason === 'FIELD_MISMATCH'));
}

// 6) a missing code field must be rejected fail-closed.
{
  const missingCode = certifiedRemoteFixture.map((r) => ({ ...r }));
  delete missingCode[0].code;
  assert.strictEqual(verifyRemoteLocationMatrix(missingCode).ok, false, 'a missing code field must fail-closed');
}

// 7) a duplicated code, or a code associated with the wrong location, must be
// rejected fail-closed.
{
  const duplicatedCode = certifiedRemoteFixture.map((r) => ({ ...r }));
  duplicatedCode[1] = { ...duplicatedCode[1], code: duplicatedCode[0].code }; // Sestri's code = Malta's code
  assert.strictEqual(verifyRemoteLocationMatrix(duplicatedCode).ok, false, 'a duplicated code must fail-closed');

  const swappedCode = certifiedRemoteFixture.map((r) => ({ ...r }));
  const maltaCode = swappedCode[0].code;
  swappedCode[0] = { ...swappedCode[0], code: swappedCode[1].code };
  swappedCode[1] = { ...swappedCode[1], code: maltaCode };
  assert.strictEqual(verifyRemoteLocationMatrix(swappedCode).ok, false, 'a code associated with the wrong location must fail-closed');
}

// 8) an inactive certified location must still fail-closed with the new codes.
{
  const inactiveWithNewCodes = certifiedRemoteFixture.map((r) => ({ ...r }));
  inactiveWithNewCodes[0] = { ...inactiveWithNewCodes[0], active: false };
  assert.strictEqual(verifyRemoteLocationMatrix(inactiveWithNewCodes).ok, false, 'an inactive location must still fail-closed after the code fix');
}

// 9) a duplicated location id must still fail-closed with the new codes.
{
  const duplicatedId = certifiedRemoteFixture.map((r) => ({ ...r }));
  duplicatedId[1] = { ...duplicatedId[1], id: duplicatedId[0].id };
  const result = verifyRemoteLocationMatrix(duplicatedId);
  assert.strictEqual(result.ok, false, 'a duplicated location id must still fail-closed after the code fix');
}

// 10) a wrong project URL/ref must still fail-closed, and the canonical URL
// must still validate — unaffected by the code fix (full coverage lives in
// the F-1 section below; re-asserted here for F-4 completeness).
assert.strictEqual(classifySupabaseUrl('https://otherref.supabase.co'), 'INVALID', 'wrong project ref must still fail-closed after the code fix');

// ---------------------------------------------------------------------------
// Dry-run plan shape
// ---------------------------------------------------------------------------

const plan = buildProvisioningPlan();
assert.strictEqual(plan.totalIdentities, 7);
assert.strictEqual(plan.stores.length, 6);
assert.ok(plan.central);
assert.strictEqual(plan.central.role, 'central');

// ---------------------------------------------------------------------------
// F-1 — Supabase URL classification: bound to exactly one certified project.
// ---------------------------------------------------------------------------

assert.strictEqual(CANONICAL_PROJECT_REF, 'ljuyolwnlbqlfxjujfrq');
assert.strictEqual(CANONICAL_SUPABASE_HOSTNAME, 'ljuyolwnlbqlfxjujfrq.supabase.co');
assert.strictEqual(CANONICAL_SUPABASE_URL, 'https://ljuyolwnlbqlfxjujfrq.supabase.co');

// Accepted.
assert.strictEqual(classifySupabaseUrl('https://ljuyolwnlbqlfxjujfrq.supabase.co'), 'VALID', 'canonical URL must pass');
assert.strictEqual(classifySupabaseUrl('https://ljuyolwnlbqlfxjujfrq.supabase.co/'), 'VALID', 'canonical URL with trailing slash must pass (normalized)');

// Missing variable in mutating mode.
assert.strictEqual(classifySupabaseUrl(undefined), 'MISSING');
assert.strictEqual(classifySupabaseUrl(null), 'MISSING');
assert.strictEqual(classifySupabaseUrl(''), 'MISSING');
assert.strictEqual(classifySupabaseUrl('   '), 'MISSING');

// Rejected formats — every one of these must fail-closed.
const rejectedSupabaseUrls = {
  'http (not https)': 'http://ljuyolwnlbqlfxjujfrq.supabase.co',
  'localhost': 'https://localhost',
  '127.0.0.1': 'https://127.0.0.1',
  'different project ref': 'https://otherref.supabase.co',
  'hostname with appended suffix': 'https://ljuyolwnlbqlfxjujfrq.supabase.co.evil.com',
  'deceptive subdomain': 'https://evil.ljuyolwnlbqlfxjujfrq.supabase.co',
  'deceptive prefixed hostname': 'https://ljuyolwnlbqlfxjujfrq-evil.supabase.co',
  'custom port': 'https://ljuyolwnlbqlfxjujfrq.supabase.co:8443',
  'username in URL': 'https://user@ljuyolwnlbqlfxjujfrq.supabase.co',
  'username+password in URL': 'https://user:pass@ljuyolwnlbqlfxjujfrq.supabase.co',
  'extra path': 'https://ljuyolwnlbqlfxjujfrq.supabase.co/rest/v1',
  'query string': 'https://ljuyolwnlbqlfxjujfrq.supabase.co?x=1',
  'fragment': 'https://ljuyolwnlbqlfxjujfrq.supabase.co#frag',
  'malformed string': 'not a url at all :::'
};
for (const [label, url] of Object.entries(rejectedSupabaseUrls)) {
  assert.strictEqual(classifySupabaseUrl(url), 'INVALID', `${label} must be rejected: ${url}`);
}
assert.doesNotThrow(() => classifySupabaseUrl('::::'), 'malformed input must never throw');

// ---------------------------------------------------------------------------
// F-3 — structural validation of the provisioning matrix (generic, pure)
// ---------------------------------------------------------------------------

// The real, shipped matrix must pass its own structural validation.
assert.strictEqual(validateProvisioningStructure().ok, true, 'the certified LOCATION_MATRIX must pass structural validation');

function cloneMatrix() {
  return LOCATION_MATRIX.map((e) => ({ ...e }));
}

// mapping certificato → PASS (already covered above); every mutation below → FAIL.

{
  const m = cloneMatrix();
  m[1] = { ...m[1], location_id: m[0].location_id }; // Sestri = Malta's location_id
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'duplicate location_id must fail');
}
{
  const m = cloneMatrix();
  m[1] = { ...m[1], code: m[0].code };
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'duplicate code must fail');
}
{
  const m = cloneMatrix();
  m[1] = { ...m[1], email: m[0].email };
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'duplicate technical identity/email must fail');
}
{
  const m = cloneMatrix();
  m[1] = { ...m[1], name: m[0].name };
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'duplicate profile name must fail');
}
{
  const m = cloneMatrix();
  m[0] = { ...m[0], role: 'central', location_id: null };
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'two central identities must fail');
}
{
  const m = cloneMatrix();
  const centralIndex = m.findIndex((e) => e.role === 'central');
  m[centralIndex] = { ...m[centralIndex], location_id: 9 };
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'central with a non-null location_id must fail');
}
{
  const m = cloneMatrix();
  m[0] = { ...m[0], location_id: null };
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'store without a location_id must fail');
}
{
  const m = cloneMatrix();
  m[0] = { ...m[0], location_id: 1 };
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'location_id 1 must fail');
}
{
  const m = cloneMatrix();
  m[0] = { ...m[0], location_id: 3 };
  assert.strictEqual(validateMatrixStructure(m).ok, false, 'location_id 3 must fail');
}
{
  const m = [...cloneMatrix(), { key: 'trasta', email: 'trasta@rete.squillari.it', role: 'store', location_id: 99, code: 999, name: 'Trasta' }];
  const result = validateMatrixStructure(m);
  assert.strictEqual(result.ok, false, 'Trasta present must fail');
  assert.ok(result.problems.includes('TRASTA_PRESENT'));
}
assert.deepStrictEqual(validateMatrixStructure(null), { ok: false, problems: validateMatrixStructure(null).problems }, 'non-array input must not throw');
assert.doesNotThrow(() => validateMatrixStructure(undefined));

// ---------------------------------------------------------------------------
// PROBLEMA 2 — admin secret key classification
// ---------------------------------------------------------------------------

function synthesizeLegacyJwt(role) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ role, iss: 'supabase-demo', synthetic: true });
  const fakeSignature = 'synthetic-signature-not-a-real-secret';
  return `${header}.${payload}.${fakeSignature}`;
}

// Accepted: modern secret key format.
assert.strictEqual(classifyAdminSecretKey('sb_secret_synthetic_0000000000000000'), 'VALID');

// Accepted: legacy service-role JWT (synthetic, unsigned — format+claim check only).
assert.strictEqual(classifyAdminSecretKey(synthesizeLegacyJwt('service_role')), 'VALID');

// Rejected: legacy anon JWT.
assert.strictEqual(classifyAdminSecretKey(synthesizeLegacyJwt('anon')), 'INVALID');

// Rejected: modern publishable key.
assert.strictEqual(classifyAdminSecretKey('sb_publishable_synthetic_0000000000'), 'INVALID');

// Rejected: personal access token.
assert.strictEqual(classifyAdminSecretKey('sbp_synthetic_0000000000000000000000'), 'INVALID');

// Rejected: placeholders.
['your-service-role-key-here', 'CHANGE_ME', 'placeholder', '<SUPABASE_SERVICE_ROLE_KEY>', 'xxxxxxxxxxxx', 'TODO'].forEach((placeholder) => {
  assert.strictEqual(classifyAdminSecretKey(placeholder), 'INVALID', `placeholder "${placeholder}" must be rejected`);
});

// Rejected: empty / missing.
assert.strictEqual(classifyAdminSecretKey(''), 'MISSING');
assert.strictEqual(classifyAdminSecretKey('   '), 'MISSING');
assert.strictEqual(classifyAdminSecretKey(undefined), 'MISSING');
assert.strictEqual(classifyAdminSecretKey(null), 'MISSING');

// Rejected: structurally malformed JWT-like strings must not throw.
assert.strictEqual(classifyAdminSecretKey('not.a.jwt.at.all'), 'INVALID');
assert.strictEqual(classifyAdminSecretKey('only-one-segment'), 'INVALID');
assert.doesNotThrow(() => classifyAdminSecretKey('a.b.c'));

// ---------------------------------------------------------------------------
// Idempotency — provisionEntry against a fully in-memory mock client
// (no real Supabase credentials, no real PINs).
// ---------------------------------------------------------------------------

function createMockSupabase() {
  const users = [];
  const memberships = new Map();
  let nextUserId = 1;

  return {
    _state: { users, memberships },
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: users.slice() }, error: null };
        },
        async createUser({ email }) {
          const user = { id: `user-${nextUserId++}`, email };
          users.push(user);
          return { data: { user }, error: null };
        },
        async updateUserById(id, { password }) {
          const user = users.find((u) => u.id === id);
          if (!user) return { error: { message: 'not found' } };
          user.lastPassword = password;
          return { error: null };
        }
      }
    },
    from(table) {
      assert.strictEqual(table, 'rete_memberships');
      return {
        upsert(payload, options) {
          assert.strictEqual(options.onConflict, MEMBERSHIP_UPSERT_CONFLICT_TARGET);
          memberships.set(payload.user_id, payload);
          return Promise.resolve({ error: null });
        }
      };
    }
  };
}

async function idempotencyCheck() {
  const supabase = createMockSupabase();
  const entry = byName('Malta');

  const first = await provisionEntry(supabase, entry, '123456', false);
  assert.strictEqual(first.user.status, 'CREATED');
  assert.strictEqual(first.membership.status, 'UPSERTED');
  assert.strictEqual(supabase._state.users.length, 1);
  assert.strictEqual(supabase._state.memberships.size, 1);

  const second = await provisionEntry(supabase, entry, '654321', false);
  assert.strictEqual(second.user.status, 'UPDATED', 'second run must find the existing user, not create a duplicate');
  assert.strictEqual(second.user.userId, first.user.userId);
  assert.strictEqual(second.membership.status, 'UPSERTED');
  assert.strictEqual(supabase._state.users.length, 1, 'no duplicate user must be created on re-run');
  assert.strictEqual(supabase._state.memberships.size, 1, 'no duplicate membership must be created on re-run');

  const membershipPayload = supabase._state.memberships.get(first.user.userId);
  assert.strictEqual(membershipPayload.location_id, 2);
  assert.strictEqual(membershipPayload.role, 'store');
}

// buildMembershipPayload is pure and deterministic for a given (entry, userId).
const payloadA = buildMembershipPayload(byName('Sestri'), 'user-x');
const payloadB = buildMembershipPayload(byName('Sestri'), 'user-x');
assert.deepStrictEqual(payloadA, payloadB);
assert.strictEqual(payloadA.location_id, 4);
assert.strictEqual(MEMBERSHIP_UPSERT_CONFLICT_TARGET, 'user_id');

// ---------------------------------------------------------------------------
// Dry-run process-level checks: no secret required, no network, no writes,
// no PIN/secret fragments printed.
// ---------------------------------------------------------------------------

function runScript(args, env) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    env,
    timeout: 5000,
    encoding: 'utf8'
  });
}

function baseEnv(overrides) {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (key === 'SUPABASE_SERVICE_ROLE_KEY' || key.startsWith('RETE_PIN_')) continue;
    env[key] = process.env[key];
  }
  // Synthetic, distinct PINs only — never real PINs. Prevents the script from
  // blocking on interactive stdin during automated testing.
  LOCATION_MATRIX.forEach((entry, index) => {
    const envVar = provisioning.pinEnvVarName(entry);
    env[envVar] = String(100000 + index).padStart(6, '0');
  });
  return Object.assign(env, overrides);
}

// Dry-run without SUPABASE_SERVICE_ROLE_KEY in the environment must succeed.
{
  const result = runScript(['--dry-run'], baseEnv({}));
  assert.strictEqual(result.status, 0, `dry-run without secret must exit 0, got: ${result.stderr}`);
  assert.ok(!/ADMIN_KEY_/.test(result.stdout), 'dry-run must never evaluate/print admin key status');
  const anyPinLeaked = LOCATION_MATRIX.some((entry, index) => {
    const pin = String(100000 + index).padStart(6, '0');
    return result.stdout.includes(pin) || result.stderr.includes(pin);
  });
  assert.ok(!anyPinLeaked, 'dry-run must never print PIN values');
}

// Dry-run performs zero network calls: point SUPABASE_URL at an address that
// would hang/refuse if contacted, and confirm the run still completes quickly.
{
  const start = Date.now();
  const result = runScript(['--dry-run'], baseEnv({ SUPABASE_URL: 'http://10.255.255.1:81' }));
  const elapsedMs = Date.now() - start;
  assert.strictEqual(result.status, 0, `dry-run must succeed even with an unreachable SUPABASE_URL, got: ${result.stderr}`);
  assert.ok(elapsedMs < 4000, `dry-run must not attempt network I/O (took ${elapsedMs}ms)`);
}

// Non-dry-run with a synthetic invalid key must fail-closed and print only the
// permitted admin-key message — never a fragment of the key itself.
{
  const fakeKey = 'sb_publishable_should_never_appear_in_logs_zzzzz';
  const result = runScript([], baseEnv({ SUPABASE_SERVICE_ROLE_KEY: fakeKey }));
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('ADMIN_KEY_INVALID'));
  assert.ok(!result.stdout.includes(fakeKey) && !result.stderr.includes(fakeKey), 'no key fragment may appear in logs');
  assert.ok(!result.stdout.includes('sb_publishable_') && !result.stderr.includes('sb_publishable_'), 'no key prefix may appear in logs');
}

// Missing key (non-dry-run) must fail-closed with ADMIN_KEY_MISSING only.
{
  const env = baseEnv({});
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const result = runScript([], env);
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('ADMIN_KEY_MISSING'));
}

// ---------------------------------------------------------------------------
// F-1 process-level checks: a syntactically VALID synthetic key is combined
// with a missing/invalid SUPABASE_URL to prove the URL check runs, fails
// closed, and happens before any client/network is created — without ever
// making a real request to the certified project (no real secret is used, so
// the certified-URL "PASS" path is exercised only at the unit level above,
// never end-to-end here).
// ---------------------------------------------------------------------------

const SYNTHETIC_VALID_KEY = 'sb_secret_synthetic_0000000000000000';

// Missing SUPABASE_URL in mutating mode must fail-closed with SUPABASE_URL_MISSING,
// before ADMIN key material or any URL is ever echoed.
{
  const env = baseEnv({ SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_VALID_KEY });
  delete env.SUPABASE_URL;
  const result = runScript([], env);
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('ADMIN_KEY_VALID'));
  assert.ok(result.stdout.includes('SUPABASE_URL_MISSING'));
  assert.ok(!result.stdout.includes('LOCATION_MATRIX_VERIFIED'), 'must never reach the remote check');
}

// Invalid SUPABASE_URL (with an otherwise valid-format key) must fail-closed,
// fast (proving no real network attempt was made), and must never print the
// rejected URL or any key material.
{
  const rejected = 'http://ljuyolwnlbqlfxjujfrq.supabase.co'; // http, not https
  const start = Date.now();
  const result = runScript([], baseEnv({ SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_VALID_KEY, SUPABASE_URL: rejected }));
  const elapsedMs = Date.now() - start;
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('ADMIN_KEY_VALID'));
  assert.ok(result.stdout.includes('SUPABASE_URL_REJECTED'));
  assert.ok(!result.stdout.includes('LOCATION_MATRIX_VERIFIED'), 'must never reach the remote check (client never created)');
  assert.ok(!result.stdout.includes(rejected) && !result.stderr.includes(rejected), 'the rejected URL must never be echoed');
  assert.ok(!result.stdout.includes(SYNTHETIC_VALID_KEY) && !result.stderr.includes(SYNTHETIC_VALID_KEY), 'no key fragment may appear in logs');
  assert.ok(elapsedMs < 4000, `URL validation must fail before any network attempt (took ${elapsedMs}ms)`);
}

// A deceptive-subdomain / wrong-project URL must be rejected identically.
{
  const result = runScript([], baseEnv({ SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_VALID_KEY, SUPABASE_URL: 'https://evil.ljuyolwnlbqlfxjujfrq.supabase.co' }));
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('SUPABASE_URL_REJECTED'));
}

// Dry-run must succeed with no SUPABASE_URL in the environment at all, and
// must ignore SUPABASE_URL entirely even if present (already exercised above
// with an unreachable address) — no ADMIN_KEY_* or SUPABASE_URL_* message is
// ever evaluated/printed in dry-run.
{
  const env = baseEnv({});
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const result = runScript(['--dry-run'], env);
  assert.strictEqual(result.status, 0, `dry-run without SUPABASE_URL must exit 0, got: ${result.stderr}`);
  assert.ok(!/SUPABASE_URL_/.test(result.stdout), 'dry-run must never evaluate/print SUPABASE_URL status');
}

// ---------------------------------------------------------------------------
// F-3 process-level check: structural validation runs before dry-run's plan
// output too (both modes share the same guard at the top of main()).
// ---------------------------------------------------------------------------
{
  const result = runScript(['--dry-run'], baseEnv({}));
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.includes('PROVISIONING_MATRIX_INVALID'), 'the certified matrix must pass structural validation in dry-run too');
}

idempotencyCheck()
  .then(() => {
    console.log('PROVISIONING_TESTS: PASS');
  })
  .catch((err) => {
    console.error('PROVISIONING_TESTS: FAIL', err);
    process.exit(1);
  });
