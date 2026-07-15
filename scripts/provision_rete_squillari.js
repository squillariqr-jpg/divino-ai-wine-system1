const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

// Requisiti: idempotente; --dry-run; conferma esplicita prima delle modifiche; 
// PIN letti solo da ambiente o input nascosto; PIN esattamente di 6 cifre; PIN tutti distinti; 
// nessun PIN nei log; nessun argomento CLI contenente PIN.

const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY_RUN && !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY is required in environment.');
    process.exit(1);
}
const keyToUse = SUPABASE_SERVICE_ROLE_KEY || 'dummy-key';
const supabase = createClient(SUPABASE_URL, keyToUse, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const profiles = [
    { email: 'malta@rete.squillari.it', role: 'store', location_id: 1, display_name: 'Malta' },
    { email: 'sestri@rete.squillari.it', role: 'store', location_id: 2, display_name: 'Sestri' },
    { email: 'cantore@rete.squillari.it', role: 'store', location_id: 3, display_name: 'Cantore' },
    { email: 'trento@rete.squillari.it', role: 'store', location_id: 4, display_name: 'Trento' },
    { email: 'de_ferrari@rete.squillari.it', role: 'store', location_id: 5, display_name: 'De Ferrari' },
    { email: 'armenia@rete.squillari.it', role: 'store', location_id: 6, display_name: 'Armenia' },
    { email: 'centrale@rete.squillari.it', role: 'central', location_id: null, display_name: 'Centrale' }
];

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
            switch (char) {
                case '\n':
                case '\r':
                case '\u0004':
                    process.stdin.pause();
                    process.stdout.write('\n');
                    resolve(input);
                    break;
                case '\u0008': // backspace
                case '\x7f': // delete
                    input = input.slice(0, -1);
                    break;
                case '\u0003': // ctrl+c
                    process.exit(1);
                    break;
                default:
                    input += char;
                    break;
            }
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

async function main() {
    console.log(`Starting Provisioning (DRY_RUN: ${DRY_RUN})`);
    
    // Check PINs from env
    const pins = {};
    const usedPins = new Set();
    
    for (const p of profiles) {
        const envVar = `RETE_PIN_${p.display_name.toUpperCase().replace(/\s+/g, '_')}`;
        let pin = process.env[envVar];
        
        if (!pin) {
            console.log(`PIN for ${p.display_name} not found in environment (${envVar}).`);
            pin = await hiddenInput(`Enter 6-digit PIN for ${p.display_name}: `);
        }
        
        if (!/^\d{6}$/.test(pin)) {
            console.error(`Error: PIN for ${p.display_name} must be exactly 6 digits.`);
            process.exit(1);
        }
        
        if (usedPins.has(pin)) {
            console.error(`Error: PINs must be unique. Duplicate found for ${p.display_name}.`);
            process.exit(1);
        }
        
        usedPins.add(pin);
        pins[p.email] = pin;
    }
    
    console.log('All PINs validated successfully.');
    
    if (!DRY_RUN) {
        const confirm = await promptConfirm('Are you sure you want to apply these changes to the database?');
        if (!confirm) {
            console.log('Aborted.');
            process.exit(0);
        }
    }
    
    for (const p of profiles) {
        console.log(`Processing user: ${p.email}`);
        
        // 1. Ensure user exists
        let userId;
        let existing = null;
        if (!DRY_RUN) {
            const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
            if (listError) {
                console.error('Error listing users:', listError);
                process.exit(1);
            }
            existing = listData.users.find(u => u.email === p.email);
        }
        
        if (existing) {
            console.log(`- User already exists (id: ${existing.id}). Updating password...`);
            userId = existing.id;
            if (!DRY_RUN) {
                const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
                    password: pins[p.email]
                });
                if (updateError) {
                    console.error('- Error updating password:', updateError.message);
                }
            }
        } else {
            console.log(`- Creating new user...`);
            if (!DRY_RUN) {
                const { data: createData, error: createError } = await supabase.auth.admin.createUser({
                    email: p.email,
                    password: pins[p.email],
                    email_confirm: true
                });
                if (createError) {
                    console.error('- Error creating user:', createError.message);
                    continue;
                }
                userId = createData.user.id;
            } else {
                userId = 'dry-run-uuid';
            }
        }
        
        // 2. Ensure membership
        if (!DRY_RUN && userId !== 'dry-run-uuid') {
            const { error: upsertError } = await supabase.from('rete_memberships').upsert({
                user_id: userId,
                role: p.role,
                location_id: p.location_id,
                display_name: p.display_name,
                active: true
            }, { onConflict: 'user_id' });
            
            if (upsertError) {
                console.error('- Error upserting membership:', upsertError.message);
            } else {
                console.log('- Membership upserted successfully.');
            }
        } else {
            console.log('- (Dry run) Would upsert membership.');
        }
    }
    
    console.log('Provisioning complete.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
