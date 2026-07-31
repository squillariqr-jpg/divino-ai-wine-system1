// In-app-first rollout gate (production release Phase 7): each external
// channel worker must require an explicit RETE_NOTIFICATIONS_*_ENABLED
// flag, checked before any claim/send call, independent of whether
// credentials happen to be configured. Verified both statically here and
// live against a local Supabase instance during this gate's manual
// verification pass (credentials present + flag unset/false -> zero
// claims, zero sends).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

function stripLineComments(source) {
  return source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
}

const scriptsDir = path.join(__dirname, '..', 'scripts');
const pushWorker = stripLineComments(fs.readFileSync(path.join(scriptsDir, 'rete-squillari-web-push-worker.ts'), 'utf8'));
const emailWorker = stripLineComments(fs.readFileSync(path.join(scriptsDir, 'rete-squillari-email-digest-send.ts'), 'utf8'));

check('web push worker checks RETE_NOTIFICATIONS_WEB_PUSH_ENABLED before claiming any deliveries', () => {
  const claimIdx = pushWorker.indexOf('rete_push_claim_pending_deliveries');
  const flagIdx = pushWorker.indexOf("RETE_NOTIFICATIONS_WEB_PUSH_ENABLED");
  assert.ok(flagIdx !== -1, 'flag check not found');
  assert.ok(claimIdx !== -1, 'claim call not found');
  assert.ok(flagIdx < claimIdx, 'flag must be checked before the claim RPC is ever called');
});

check('web push worker flag check does not depend on credentials being present (checked before adapter construction)', () => {
  const flagIdx = pushWorker.indexOf("RETE_NOTIFICATIONS_WEB_PUSH_ENABLED");
  const adapterIdx = pushWorker.indexOf('createWebPushAdapter()');
  assert.ok(flagIdx < adapterIdx, 'flag must gate the worker before the real adapter (which only checks credentials) is ever constructed');
});

check('email digest worker checks RETE_NOTIFICATIONS_EMAIL_ENABLED before claiming any locations', () => {
  const claimIdx = emailWorker.indexOf('rete_email_digest_claim_locations');
  const flagIdx = emailWorker.indexOf("RETE_NOTIFICATIONS_EMAIL_ENABLED");
  assert.ok(flagIdx !== -1, 'flag check not found');
  assert.ok(claimIdx !== -1, 'claim call not found');
  assert.ok(flagIdx < claimIdx, 'flag must be checked before the claim RPC is ever called');
});

check('email digest worker flag check does not depend on credentials being present (checked before adapter construction)', () => {
  const flagIdx = emailWorker.indexOf("RETE_NOTIFICATIONS_EMAIL_ENABLED");
  const adapterIdx = emailWorker.indexOf('createEmailAdapter()');
  assert.ok(flagIdx < adapterIdx, 'flag must gate the worker before the real adapter (which only checks credentials) is ever constructed');
});

check('both flag checks require the exact string "true" (not merely truthy/non-empty), so an unset or misconfigured env var fails closed', () => {
  assert.ok(/RETE_NOTIFICATIONS_WEB_PUSH_ENABLED\s*!==\s*'true'/.test(pushWorker));
  assert.ok(/RETE_NOTIFICATIONS_EMAIL_ENABLED\s*!==\s*'true'/.test(emailWorker));
});

check('the frontend never references RETE_NOTIFICATIONS_WHATSAPP_ENABLED or exposes a WhatsApp configuration control', () => {
  const notifCenter = fs.readFileSync(path.join(__dirname, '..', 'public', 'rete-squillari', 'notification-center.js'), 'utf8');
  const pushUi = fs.readFileSync(path.join(__dirname, '..', 'public', 'rete-squillari', 'push-notifications.js'), 'utf8');
  assert.ok(!/whatsapp/i.test(notifCenter));
  assert.ok(!/whatsapp/i.test(pushUi));
});

console.log(JSON.stringify({ PASS: pass, FAIL: fail }));
if (fail > 0) process.exitCode = 1;
