'use strict';

const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

// Requisiti: idempotente; --dry-run; conferma esplicita prima delle modifiche;
// PIN letti solo da ambiente o input nascosto; PIN esattamente di 6 cifre; PIN tutti distinti;
// nessun PIN nei log; nessun argomento CLI contenente PIN.
//
// La matrice sotto è la mappatura autorevole delle sedi Rete Squillari. NON derivare mai
// location_id dalla posizione nell'array o da un indice + 1: Trasta non è una sede negozio
// e gli id storicamente non sono sequenziali.

// Canonical remote project. Mutating mode MUST NOT fall back to a local URL:
// the operator has to explicitly point at this exact project, or the script
// refuses to create an admin client at all.
const CANONICAL_PROJECT_REF = 'ljuyolwnlbqlfxjujfrq';
const CANONICAL_SUPABASE_HOSTNAME = `${CANONICAL_PROJECT_REF}.supabase.co`;
const CANONICAL_SUPABASE_URL = `https://${CANONICAL_SUPABASE_HOSTNAME}`;

const LOCATION_MATRIX = Object.freeze([
  Object.freeze({ key: 'malta', email: 'malta@rete.squillari.it', role: 'store', location_id: 2, code: 2, name: 'Malta' }),
  Object.freeze({ key: 'sestri', email: 'sestri@rete.squillari.it', role: 'store', location_id: 4, code: 4, name: 'Sestri' }),
  Object.freeze({ key: 'cantore', email: 'cantore@rete.squillari.it', role: 'store', location_id: 5, code: 5, name: 'Cantore' }),
  Object.freeze({ key: 'trento', email: 'trento@rete.squillari.it', role: 'store', location_id: 6, code: 6, name: 'Trento' }),
  Object.freeze({ key: 'de_ferrari', email: 'de_ferrari@rete.squillari.it', role: 'store', location_id: 7, code: 7, name: 'De Ferrari' }),
  Object.freeze({ key: 'armenia', email: 'armenia@rete.squillari.it', role: 'store', location_id: 8, code: 8, name: 'Armenia' }),
  Object.freeze({ key: 'centrale', email: 'centrale@rete.squillari.it', role: 'central', location_id: null, code: null, name: 'Centrale' })
]);

const STORE_ENTRIES = LOCATION_MATRIX.filter((entry) => entry.role === 'store');
const CENTRAL_ENTRY = LOCATION_MATRIX.find((entry) => entry.role === 'central');

function pinEnvVarName(entry) {
  return `RETE_PIN_${entry.name.toUpperCase().replace(/\s+/g, '_')}`;
}

// ---------------------------------------------------------------------------
// Admin secret key classification.
//
// This code path must NEVER log the key value, a prefix, a length, leading or
// trailing characters, or a hash of the key. Callers may only surface one of
// the three literal outcomes: ADMIN_KEY_VALID, ADMIN_KEY_INVALID, ADMIN_KEY_MISSING.
// ---------------------------------------------------------------------------

function base64UrlDecode(segment) {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLength), 'base64').toString('utf8');
}

function isModernSecretKey(value) {
  return /^sb_secret_[A-Za-z0-9_-]{10,}$/.test(value);
}

function isLegacyServiceRoleJwt(value) {
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0 || !/^[A-Za-z0-9_-]+$/.test(part))) {
    return false;
  }
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]));
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch (err) {
    return false;
  }
  return Boolean(header) && typeof header.alg === 'string' && Boolean(payload) && payload.role === 'service_role';
}

function isRejectedKeyFormat(value) {
  // Modern publishable keys and legacy anon JWTs are rejected implicitly because
  // they never satisfy isModernSecretKey/isLegacyServiceRoleJwt above. This only
  // needs to catch formats that could otherwise be mistaken for admin secrets.
  return /^sb_publishable_/.test(value) || /^sbp_/.test(value);
}

const PLACEHOLDER_PATTERNS = [
  /^(your|my|test|example|placeholder|changeme|change[-_]me|xxx+|todo|fixme|dummy|fake|sample)/i,
  /service[-_]?role[-_]?key[-_]?here/i,
  /<.*>/
];

function isPlaceholderValue(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function classifyAdminSecretKey(rawValue) {
  if (rawValue === undefined || rawValue === null) return 'MISSING';
  const value = String(rawValue).trim();
  if (value.length === 0) return 'MISSING';
  if (isRejectedKeyFormat(value)) return 'INVALID';
  if (isPlaceholderValue(value)) return 'INVALID';
  if (isModernSecretKey(value)) return 'VALID';
  if (isLegacyServiceRoleJwt(value)) return 'VALID';
  return 'INVALID';
}

// ---------------------------------------------------------------------------
// Supabase URL classification (F-1).
//
// Mutating mode is bound to exactly one project: CANONICAL_SUPABASE_URL. No
// local fallback, no other host, subdomain, port, path, query, fragment, or
// credentials embedded in the URL are ever accepted. On any rejection the
// caller must print a generic message only — never the raw URL value.
// ---------------------------------------------------------------------------

function classifySupabaseUrl(rawValue) {
  if (rawValue === undefined || rawValue === null) return 'MISSING';
  const trimmed = String(rawValue).trim();
  if (trimmed.length === 0) return 'MISSING';

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return 'INVALID';
  }

  if (parsed.protocol !== 'https:') return 'INVALID';
  if (parsed.hostname !== CANONICAL_SUPABASE_HOSTNAME) return 'INVALID';
  if (parsed.username !== '') return 'INVALID';
  if (parsed.password !== '') return 'INVALID';
  if (parsed.port !== '') return 'INVALID';
  // The only normalization performed is accepting an optional trailing slash;
  // no other pathname is ever accepted.
  if (parsed.pathname !== '' && parsed.pathname !== '/') return 'INVALID';
  if (parsed.search !== '') return 'INVALID';
  if (parsed.hash !== '') return 'INVALID';

  return 'VALID';
}

// ---------------------------------------------------------------------------
// Read-only remote location matrix verification (fail-closed).
// ---------------------------------------------------------------------------

function verifyRemoteLocationMatrix(remoteRows) {
  const rows = Array.isArray(remoteRows) ? remoteRows : [];
  const byName = new Map();
  const duplicateNames = new Set();
  for (const row of rows) {
    if (byName.has(row.name)) {
      duplicateNames.add(row.name);
    } else {
      byName.set(row.name, row);
    }
  }

  const mismatches = [];

  for (const entry of STORE_ENTRIES) {
    if (duplicateNames.has(entry.name)) {
      mismatches.push({ name: entry.name, reason: 'DUPLICATE_IN_REMOTE' });
      continue;
    }
    const remote = byName.get(entry.name);
    if (!remote) {
      mismatches.push({ name: entry.name, reason: 'MISSING_IN_REMOTE' });
      continue;
    }
    if (remote.id !== entry.location_id || remote.code !== entry.code || remote.name !== entry.name) {
      mismatches.push({ name: entry.name, reason: 'FIELD_MISMATCH' });
      continue;
    }
    if (remote.active !== true) {
      mismatches.push({ name: entry.name, reason: 'INACTIVE_OR_INVALID_ACTIVE_FIELD' });
    }
  }

  const knownNames = new Set(STORE_ENTRIES.map((entry) => entry.name));
  for (const row of rows) {
    if (!knownNames.has(row.name)) {
      mismatches.push({ name: row.name, reason: 'UNEXPECTED_LOCATION' });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

async function fetchRemoteLocations(supabaseClient) {
  const { data, error } = await supabaseClient.from('rete_locations').select('id, code, name, active');
  if (error) {
    throw new Error(`Failed to read rete_locations: ${error.message}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Dry-run plan (zero network calls, zero writes).
// ---------------------------------------------------------------------------

function buildProvisioningPlan() {
  return {
    stores: STORE_ENTRIES.map((entry) => ({ ...entry })),
    central: { ...CENTRAL_ENTRY },
    totalIdentities: LOCATION_MATRIX.length
  };
}

// ---------------------------------------------------------------------------
// Structural validation of the provisioning matrix (F-3).
//
// Pure, generic, and independent of any specific matrix instance so tests can
// exercise every failure mode against synthetic clones without touching the
// real (correct) LOCATION_MATRIX constant.
// ---------------------------------------------------------------------------

const EXPECTED_STORE_LOCATION_IDS = Object.freeze([2, 4, 5, 6, 7, 8]);
const FORBIDDEN_LOCATION_IDS = Object.freeze([1, 3]);

function validateMatrixStructure(matrix) {
  const list = Array.isArray(matrix) ? matrix : [];
  const problems = [];

  if (list.length !== 7) problems.push('IDENTITY_COUNT');

  const stores = list.filter((entry) => entry && entry.role === 'store');
  const centrals = list.filter((entry) => entry && entry.role === 'central');

  if (stores.length !== 6) problems.push('STORE_COUNT');
  if (centrals.length !== 1) problems.push('CENTRAL_COUNT');

  for (const entry of stores) {
    if (entry.location_id === null || entry.location_id === undefined) {
      problems.push('STORE_MISSING_LOCATION_ID');
    }
  }
  for (const entry of centrals) {
    if (entry.location_id !== null) problems.push('CENTRAL_HAS_LOCATION_ID');
  }

  const locationIds = stores.map((entry) => entry.location_id);
  if (new Set(locationIds).size !== locationIds.length) problems.push('DUPLICATE_LOCATION_ID');

  const codes = stores.map((entry) => entry.code);
  if (new Set(codes).size !== codes.length) problems.push('DUPLICATE_CODE');

  const emails = list.map((entry) => entry.email);
  if (new Set(emails).size !== emails.length) problems.push('DUPLICATE_EMAIL');

  const names = list.map((entry) => entry.name);
  if (new Set(names).size !== names.length) problems.push('DUPLICATE_NAME');

  if (locationIds.some((id) => FORBIDDEN_LOCATION_IDS.includes(id))) problems.push('FORBIDDEN_LOCATION_ID');

  const numericIds = locationIds.filter((id) => typeof id === 'number').sort((a, b) => a - b);
  if (JSON.stringify(numericIds) !== JSON.stringify(EXPECTED_STORE_LOCATION_IDS)) problems.push('MAPPING_MISMATCH');

  if (names.some((name) => typeof name === 'string' && name.trim().toLowerCase() === 'trasta')) {
    problems.push('TRASTA_PRESENT');
  }

  return { ok: problems.length === 0, problems };
}

function validateProvisioningStructure() {
  return validateMatrixStructure(LOCATION_MATRIX);
}

// ---------------------------------------------------------------------------
// Per-entry provisioning (extracted for idempotency testing with a mock client;
// no real Supabase credentials are needed to exercise this logic).
// ---------------------------------------------------------------------------

async function ensureUser(supabase, entry, pin, dryRun) {
    let existing = null;
    if (!dryRun) {
        const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) {
            return { status: 'LIST_ERROR', message: listError.message };
        }
        existing = listData.users.find((u) => u.email === entry.email);
    }

    if (existing) {
        let updateMessage = null;
        if (!dryRun) {
            const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, { password: pin });
            if (updateError) updateMessage = updateError.message;
        }
        return { status: 'UPDATED', userId: existing.id, warning: updateMessage };
    }

    if (dryRun) {
        return { status: 'DRY_RUN', userId: 'dry-run-uuid' };
    }

    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
        email: entry.email,
        password: pin,
        email_confirm: true
    });
    if (createError) {
        return { status: 'CREATE_ERROR', message: createError.message };
    }
    return { status: 'CREATED', userId: createData.user.id };
}

const MEMBERSHIP_UPSERT_CONFLICT_TARGET = 'user_id';

function buildMembershipPayload(entry, userId) {
    return {
        user_id: userId,
        role: entry.role,
        location_id: entry.location_id,
        display_name: entry.name,
        active: true
    };
}

async function upsertMembership(supabase, entry, userId, dryRun) {
    if (dryRun || userId === 'dry-run-uuid') {
        return { status: 'DRY_RUN' };
    }
    const { error } = await supabase
        .from('rete_memberships')
        .upsert(buildMembershipPayload(entry, userId), { onConflict: MEMBERSHIP_UPSERT_CONFLICT_TARGET });
    if (error) {
        return { status: 'ERROR', message: error.message };
    }
    return { status: 'UPSERTED' };
}

async function provisionEntry(supabase, entry, pin, dryRun) {
    const userResult = await ensureUser(supabase, entry, pin, dryRun);
    if (userResult.status === 'LIST_ERROR' || userResult.status === 'CREATE_ERROR') {
        return { entry, user: userResult, membership: { status: 'SKIPPED' } };
    }
    const membershipResult = await upsertMembership(supabase, entry, userResult.userId, dryRun);
    return { entry, user: userResult, membership: membershipResult };
}

// ---------------------------------------------------------------------------
// Interactive helpers.
// ---------------------------------------------------------------------------

const KEY_CODE_EOF = 4;
const KEY_CODE_BACKSPACE = 8;
const KEY_CODE_DELETE = 127;
const KEY_CODE_CTRL_C = 3;

async function hiddenInput(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => {
        let input = '';
        process.stdout.write(query);
        process.stdin.on('data', char => {
            char = char.toString();
            const code = char.charCodeAt(0);

            if (char === '\n' || char === '\r' || code === KEY_CODE_EOF) {
                process.stdin.pause();
                process.stdout.write('\n');
                resolve(input);
                return;
            }

            if (code === KEY_CODE_BACKSPACE || code === KEY_CODE_DELETE) {
                input = input.slice(0, -1);
                return;
            }

            if (code === KEY_CODE_CTRL_C) {
                process.exit(1);
                return;
            }

            input += char;
        });
        process.stdin.setRawMode(true);
        process.stdin.resume();
    });
}

async function promptConfirm(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(question + ' (y/N): ', answer => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
    const DRY_RUN = process.argv.includes('--dry-run');

    console.log(`Starting Provisioning (DRY_RUN: ${DRY_RUN})`);

    // F-3: structural validation of the provisioning matrix runs unconditionally,
    // before anything else (dry-run or mutating).
    const structural = validateProvisioningStructure();
    if (!structural.ok) {
        console.error('PROVISIONING_MATRIX_INVALID');
        for (const problem of structural.problems) {
            console.error(`- ${problem}`);
        }
        process.exit(1);
    }

    let supabase = null;

    if (DRY_RUN) {
        // Dry-run must never initialize a remote admin client, must never
        // require or read the admin secret, and must never require or read
        // SUPABASE_URL — only the internal synthetic plan below is used.
        const plan = buildProvisioningPlan();
        console.log(`Dry-run plan: ${plan.stores.length} store identities + 1 central identity = ${plan.totalIdentities} total.`);
    } else {
        const keyStatus = classifyAdminSecretKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
        if (keyStatus === 'MISSING') {
            console.log('ADMIN_KEY_MISSING');
            process.exit(1);
        }
        if (keyStatus === 'INVALID') {
            console.log('ADMIN_KEY_INVALID');
            process.exit(1);
        }
        console.log('ADMIN_KEY_VALID');

        // F-1: mutating mode is bound to exactly one certified project. No
        // local fallback is accepted; the client is never created on mismatch,
        // and the raw URL value is never logged (only a generic outcome).
        const urlStatus = classifySupabaseUrl(process.env.SUPABASE_URL);
        if (urlStatus === 'MISSING') {
            console.log('SUPABASE_URL_MISSING');
            process.exit(1);
        }
        if (urlStatus === 'INVALID') {
            console.log('SUPABASE_URL_REJECTED');
            process.exit(1);
        }
        console.log('SUPABASE_URL_VERIFIED');

        supabase = createClient(CANONICAL_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false }
        });

        console.log('Verifying remote location matrix (read-only)...');
        const remoteRows = await fetchRemoteLocations(supabase);
        const verification = verifyRemoteLocationMatrix(remoteRows);
        if (!verification.ok) {
            console.error('LOCATION_MATRIX_MISMATCH: remote rete_locations do not match the authoritative matrix. Aborting before provisioning.');
            for (const mismatch of verification.mismatches) {
                console.error(`- ${mismatch.name}: ${mismatch.reason}`);
            }
            process.exit(1);
        }
        console.log('LOCATION_MATRIX_VERIFIED');
    }

    // Check PINs from env
    const pins = {};
    const usedPins = new Set();

    for (const entry of LOCATION_MATRIX) {
        const envVar = pinEnvVarName(entry);
        let pin = process.env[envVar];

        if (!pin) {
            console.log(`PIN for ${entry.name} not found in environment (${envVar}).`);
            pin = await hiddenInput(`Enter 6-digit PIN for ${entry.name}: `);
        }

        if (!/^\d{6}$/.test(pin)) {
            console.error(`Error: PIN for ${entry.name} must be exactly 6 digits.`);
            process.exit(1);
        }

        if (usedPins.has(pin)) {
            console.error(`Error: PINs must be unique. Duplicate found for ${entry.name}.`);
            process.exit(1);
        }

        usedPins.add(pin);
        pins[entry.email] = pin;
    }

    console.log('All PINs validated successfully.');

    if (!DRY_RUN) {
        const confirm = await promptConfirm('Are you sure you want to apply these changes to the database?');
        if (!confirm) {
            console.log('Aborted.');
            process.exit(0);
        }
    }

    for (const entry of LOCATION_MATRIX) {
        console.log(`Processing user: ${entry.email}`);

        const result = await provisionEntry(supabase, entry, pins[entry.email], DRY_RUN);

        if (result.user.status === 'LIST_ERROR') {
            console.error('Error listing users:', result.user.message);
            process.exit(1);
        } else if (result.user.status === 'UPDATED') {
            console.log(`- User already exists (id: ${result.user.userId}). Updating password...`);
            if (result.user.warning) {
                console.error('- Error updating password:', result.user.warning);
            }
        } else if (result.user.status === 'CREATED') {
            console.log('- Creating new user...');
        } else if (result.user.status === 'CREATE_ERROR') {
            console.log('- Creating new user...');
            console.error('- Error creating user:', result.user.message);
        } else if (result.user.status === 'DRY_RUN') {
            console.log('- (Dry run) Would create/update user.');
        }

        if (result.membership.status === 'UPSERTED') {
            console.log('- Membership upserted successfully.');
        } else if (result.membership.status === 'ERROR') {
            console.error('- Error upserting membership:', result.membership.message);
        } else if (result.membership.status === 'DRY_RUN') {
            console.log('- (Dry run) Would upsert membership.');
        }
    }

    console.log('Provisioning complete.');
}

module.exports = {
    LOCATION_MATRIX,
    STORE_ENTRIES,
    CENTRAL_ENTRY,
    pinEnvVarName,
    classifyAdminSecretKey,
    classifySupabaseUrl,
    CANONICAL_PROJECT_REF,
    CANONICAL_SUPABASE_HOSTNAME,
    CANONICAL_SUPABASE_URL,
    verifyRemoteLocationMatrix,
    fetchRemoteLocations,
    buildProvisioningPlan,
    validateMatrixStructure,
    validateProvisioningStructure,
    EXPECTED_STORE_LOCATION_IDS,
    FORBIDDEN_LOCATION_IDS,
    ensureUser,
    upsertMembership,
    provisionEntry,
    buildMembershipPayload,
    MEMBERSHIP_UPSERT_CONFLICT_TARGET
};

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
}
