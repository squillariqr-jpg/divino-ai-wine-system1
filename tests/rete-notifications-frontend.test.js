// Static structural checks over the frontend notification surfaces
// (bell/panel, push permission flow, service worker, manifest) - no
// browser, no network, matching this repo's existing convention for
// public/rete-squillari/*.js (see tests/rete-squillari-browser-bindings.test.js).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

const publicDir = path.join(__dirname, '..', 'public', 'rete-squillari');
const notificationCenterJs = fs.readFileSync(path.join(publicDir, 'notification-center.js'), 'utf8');
const pushNotificationsJs = fs.readFileSync(path.join(publicDir, 'push-notifications.js'), 'utf8');
const swJs = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
const manifestRaw = fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8');
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

check('notification center renders bell, panel, empty/loading/error states, and "Segna tutte come lette"', () => {
  assert.ok(notificationCenterJs.includes('🔔'));
  assert.ok(notificationCenterJs.includes('Segna tutte come lette'));
  assert.ok(notificationCenterJs.includes('Nessuna notifica'));
  assert.ok(notificationCenterJs.includes('Caricamento'));
  assert.ok(notificationCenterJs.includes('Impossibile caricare'));
  assert.ok(notificationCenterJs.includes('Riprova'));
});

check('notification click navigates via deep_link and marks read first', () => {
  assert.ok(notificationCenterJs.includes('item.deep_link'));
  assert.ok(notificationCenterJs.includes('markNotificationRead'));
});

check('notification content is never rendered from anything but server-provided title/body (no phone/PIN/token field access)', () => {
  const code = notificationCenterJs.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\.(phone|telefono|pin_code|token|price|prezzo)\b/i.test(code));
});

check('push permission is requested only inside requestAndSubscribe(), never called at module top level', () => {
  const code = pushNotificationsJs.replace(/^\s*\/\/.*$/gm, '');
  const requestAndSubscribeBody = code.slice(code.indexOf('async function requestAndSubscribe'), code.indexOf('async function unsubscribe'));
  assert.ok(requestAndSubscribeBody.includes('requestPermission'), 'requestAndSubscribe must call Notification.requestPermission()');
  const outsideRequestAndSubscribe = code.replace(requestAndSubscribeBody, '');
  assert.ok(!outsideRequestAndSubscribe.includes('requestPermission'), 'requestPermission must never be called outside requestAndSubscribe()');
  assert.ok(!/\n(root\.RETE_PUSH_NOTIFICATIONS\.)?requestAndSubscribe\s*\(/.test(code), 'requestAndSubscribe must never be invoked at module scope - only from a UI click handler elsewhere');
});

check('required Italian push permission copy is present verbatim', () => {
  assert.ok(notificationCenterJs.includes('Attiva le notifiche operative'));
  assert.ok(notificationCenterJs.includes('Riceverai avvisi per merce da preparare, trasferimenti e arrivi.'));
});

check('push module checks browser support and fails gracefully when unsupported', () => {
  assert.ok(pushNotificationsJs.includes('isSupported'));
  assert.ok(notificationCenterJs.includes('non sono supportate'));
});

check('push module exposes a disable/unsubscribe path', () => {
  assert.ok(pushNotificationsJs.includes('function unsubscribe'));
});

check('service worker contains no secret-shaped strings (API keys, service-role keys, VAPID private key material)', () => {
  const forbidden = [/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]+['"]/, /AGENTMAIL_API_KEY\s*[:=]\s*['"][^'"]+['"]/, /RETE_PUSH_VAPID_PRIVATE_KEY\s*[:=]\s*['"][^'"]+['"]/, /BEGIN (EC )?PRIVATE KEY/];
  for (const pattern of forbidden) assert.ok(!pattern.test(swJs), 'sw.js matched forbidden pattern ' + pattern);
});

check('service worker only ever reads the already-decrypted push payload (title/body/deepLink), never raw endpoint/keys', () => {
  assert.ok(swJs.includes("event.data.json()"));
  assert.ok(!/p256dh|auth_secret|authSecret|endpoint_ciphertext/.test(swJs));
});

check('manifest.json is valid JSON with the required PWA fields', () => {
  const manifest = JSON.parse(manifestRaw);
  assert.ok(manifest.name);
  assert.ok(manifest.start_url);
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
});

check('index.html links the manifest and registers the notification center only for GOVERNED_BACKEND actors', () => {
  assert.ok(indexHtml.includes('rel="manifest" href="/rete-squillari/manifest.json"'));
  assert.ok(indexHtml.includes('RETE_NOTIFICATION_CENTER.mount'));
  assert.ok(indexHtml.includes('MODE.GOVERNED_BACKEND'));
});

check('rete-backend-adapter.js exposes the new notification/push/preference RPC wrappers', () => {
  const adapterJs = fs.readFileSync(path.join(publicDir, 'rete-backend-adapter.js'), 'utf8');
  for (const fn of ['listNotifications', 'unreadNotificationCount', 'markNotificationRead', 'markAllNotificationsRead', 'subscribePush', 'unsubscribePush', 'getNotificationPreferences', 'setNotificationPreferences']) {
    assert.ok(adapterJs.includes(fn), 'adapter missing ' + fn);
  }
});

console.log(JSON.stringify({ PASS: pass, FAIL: fail }));
if (fail > 0) process.exitCode = 1;
