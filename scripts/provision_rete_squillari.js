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

const SUPABASE_URL_DEFAULT = 'http://127.0.0.1:54321';

const LOCATION_MATRIX = Object.freeze([
  Object.freeze({ key: 'malta', email: 'malta@rete.squillari.it', role: 'store', location_id: 2, code: 101, name: 'Malta' }),
  Object.freeze({ key: 'sestri', email: 'sestri@rete.squillari.it', role: 'store', location_id: 4, code: 102, name: 'Sestri' }),
  Object.freeze({ key: 'cantore', email: 'cantore@rete.squillari.it', role: 'store', location_id: 5, code: 103, name: 'Cantore' }),
  Object.freeze({ key: 'trento', email: 'trento@rete.squillari.it', role: 'store', location_id: 6, code: 104, name: 'Trento' }),
  Object.freeze({ key: 'de_ferrari', email: 'de_ferrari@rete.squillari.it', role: 'store', location_id: 7, code: 105, name: 'De Ferrari' }),
  Object.freeze({ key: 'armenia', email: 'armenia@rete.squillari.it', role: 'store', location_id: 8, code: 106, name: 'Armenia' }),
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
// Read-only remote location matrix verification (fail-closed).
// ---------------------------------------------------------------------------

function verifyRemoteLocationMatrix(remoteRows) {
  const rows = Array.isArray(remoteRows) ? remoteRows : [];
  const byName = new Map(rows.map((row) => [row.name, row]));
  const mismatches = [];

  for (const entry of STORE_ENTRIES) {
    const remote = byName.get(entry.name);
    if (!remote) {
      mismatches.push({ name: entry.name, reason: 'MISSING_IN_REMOTE' });
      continue;
    }
    if (remote.id !== entry.location_id || remote.code !== entry.code || remote.name !== entry.name) {
      mismatches.push({ name: entry.name, reason: 'FIELD_MISMATCH' });
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
  const { data, error } = await supabaseClient.from('rete_locations').select('id, code, name');
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
    const SUPABASE_URL = process.env.SUPABASE_URL || SUPABASE_URL_DEFAULT;

    console.log(`Starting Provisioning (DRY_RUN: ${DRY_RUN})`);

    let supabase = null;

    if (DRY_RUN) {
        // Dry-run must never initialize a remote admin client and must never
        // require or read the admin secret.
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

        supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
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
    verifyRemoteLocationMatrix,
    fetchRemoteLocations,
    buildProvisioningPlan,
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
