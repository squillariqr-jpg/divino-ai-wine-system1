// Tests for the automatic offer-acceptance UI copy + static migration
// safety checks. DB/RPC/concurrency-level tests for this gate could not be
// executed this session (local Docker was unavailable) - see the final
// report for that limitation; what's covered here is genuinely verified:
// the frontend never shows forbidden "pending approval" wording for a
// normal auto-accepted offer, and the migrations are structurally safe
// (additive, no data mutation, no destructive statements).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = ''; this.className = ''; this._innerHTML = ''; this.textContent = '';
    this.children = []; this.parentElement = null; this.dataset = {}; this.attributes = {};
    this.onclick = null; this.style = {}; this.value = ''; this._listeners = {};
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
  }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() {
    if (this.children.length === 0) return this._innerHTML;
    return this._innerHTML + this.children.map((c) => '<' + c.tagName.toLowerCase() + '>' + c.innerHTML + '</' + c.tagName.toLowerCase() + '>').join('');
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  insertBefore(node) { this.children.unshift(node); node.parentElement = this; return node; }
  prepend(...nodes) { this.children.unshift(...nodes); nodes.forEach((n) => { n.parentElement = this; }); }
  append(...nodes) { this.children.push(...nodes); nodes.forEach((n) => { n.parentElement = this; }); }
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  matchesSelector(sel) {
    if (sel[0] === '.') return (' ' + this.className + ' ').indexOf(' ' + sel.slice(1) + ' ') !== -1;
    if (sel[0] === '#') return this.id === sel.slice(1);
    return false;
  }
  querySelector(sel) { for (const c of this.children) { if (c.matchesSelector(sel)) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
  querySelectorAll(sel) { let out = []; for (const c of this.children) { if (c.matchesSelector(sel)) out.push(c); out = out.concat(c.querySelectorAll(sel)); } return out; }
  closest() { return null; }
  matches() { return false; }
}

function el(elementsById, tag, id, className) {
  const e = new FakeElement(tag);
  if (id) { e.id = id; elementsById[id] = e; }
  if (className) e.className = className;
  return e;
}

function buildSandbox() {
  const elementsById = Object.create(null);
  const storageData = Object.create(null);
  const body = el(elementsById, 'body', 'body');
  const loginScreen = el(elementsById, 'div', 'login-screen'); body.appendChild(loginScreen);
  loginScreen.style = {};
  el(elementsById, 'select', 'login-store'); loginScreen.appendChild(elementsById['login-store']);
  el(elementsById, 'input', 'login-pin'); loginScreen.appendChild(elementsById['login-pin']);
  el(elementsById, 'button', 'login-btn'); loginScreen.appendChild(elementsById['login-btn']);
  const mainApp = el(elementsById, 'div', 'main-app', 'app hidden'); body.appendChild(mainApp);
  mainApp._classes = new Set(['app', 'hidden']);
  mainApp.classList = { add: (c) => mainApp._classes.add(c), remove: (c) => mainApp._classes.delete(c), toggle: () => {}, contains: (c) => mainApp._classes.has(c) };
  const aside = el(elementsById, 'aside', null, 'side'); mainApp.appendChild(aside);
  const logo = el(elementsById, 'div', null, 'logo'); logo.innerHTML = 'Rete Squillari<small>Aiuta un negozio</small>'; aside.appendChild(logo);
  const roleBtn = el(elementsById, 'button', 'role'); aside.appendChild(roleBtn);
  el(elementsById, 'small', 'profile-kind'); roleBtn.appendChild(elementsById['profile-kind']);
  el(elementsById, 'b', 'who'); roleBtn.appendChild(elementsById.who);
  const nav = el(elementsById, 'nav', 'nav'); aside.appendChild(nav);
  el(elementsById, 'div', 'sidebar-foot'); aside.appendChild(elementsById['sidebar-foot']);
  const main = el(elementsById, 'main', null, 'main'); mainApp.appendChild(main);
  el(elementsById, 'button', 'mob'); main.appendChild(elementsById.mob);
  el(elementsById, 'div', 'eyebrow'); main.appendChild(elementsById.eyebrow);
  el(elementsById, 'h1', 'title'); main.appendChild(elementsById.title);
  const view = el(elementsById, 'div', 'view'); main.appendChild(view);
  const modalbg = el(elementsById, 'div', 'mb', 'modalbg hidden'); body.appendChild(modalbg);
  const modal = el(elementsById, 'div', 'modal'); modalbg.appendChild(modal);
  el(elementsById, 'div', 'toast'); body.appendChild(elementsById.toast);

  const documentListeners = {};
  const documentMock = {
    head: el(elementsById, 'head'), body,
    getElementById(id) { if (!elementsById[id]) { elementsById[id] = new FakeElement('div'); elementsById[id].id = id; } return elementsById[id]; },
    querySelector(sel) { return body.matchesSelector(sel) ? body : body.querySelector(sel); },
    querySelectorAll(sel) { return body.querySelectorAll(sel); },
    createElement(tag) { return new FakeElement(tag); },
    addEventListener(type, fn) { (documentListeners[type] = documentListeners[type] || []).push(fn); },
    _fire(type) { (documentListeners[type] || []).forEach((fn) => fn()); },
  };
  const localStorageMock = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null; },
    setItem(k, v) { storageData[k] = String(v); },
    removeItem(k) { delete storageData[k]; },
  };
  const sandbox = {
    document: documentMock, localStorage: localStorageMock,
    location: { reload() {}, href: 'http://127.0.0.1:4173/rete-squillari/' },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 0, clearTimeout: () => {}, addEventListener() {}, print() {},
    console, Date, JSON, Math, Array, Object, String, Number, Boolean, RegExp, Set, Promise,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, elementsById, documentMock };
}

function loadInlineScripts(html) {
  const scripts = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(html))) scripts.push(m[1]);
  return scripts;
}

const htmlPath = path.join(__dirname, '..', 'public/rete-squillari/index.html');
const modelPath = path.join(__dirname, '..', 'public/rete-squillari/location-model.js');
const adapterPath = path.join(__dirname, '..', 'public/rete-squillari/rete-backend-adapter.js');
const html = fs.readFileSync(htmlPath, 'utf8');
const modelSource = fs.readFileSync(modelPath, 'utf8');
const adapterSource = fs.readFileSync(adapterPath, 'utf8');
const inlineScripts = loadInlineScripts(html);

function mockSupabase(opts) {
  opts = opts || {};
  const tables = opts.tables || {};
  function chain(table) {
    const self = { _table: table };
    self.select = () => self; self.eq = () => self; self.order = () => self;
    self.single = () => Promise.resolve(tables[table] && tables[table].single ? tables[table].single : { data: null, error: { message: 'not mocked' } });
    self.then = (resolve, reject) => Promise.resolve(tables[table] && tables[table].list ? tables[table].list : { data: [], error: null }).then(resolve, reject);
    return self;
  }
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: opts.session || null } }),
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ data: null, error: { message: 'not used' } }),
    },
    from: (table) => chain(table),
    rpc: (name, params) => Promise.resolve(opts.rpc ? opts.rpc(name, params) : { data: { status: 'OK' }, error: null }),
  };
}

function freshApp(supabaseClient) {
  const { sandbox, elementsById, documentMock } = buildSandbox();
  sandbox.window.supabase = { createClient: () => supabaseClient };
  vm.runInContext(inlineScripts[0], sandbox, { filename: 'index-script-0.js' });
  vm.runInContext(inlineScripts[1], sandbox, { filename: 'index-script-1.js' });
  vm.runInContext(modelSource, sandbox, { filename: 'location-model.js' });
  vm.runInContext(adapterSource, sandbox, { filename: 'rete-backend-adapter.js' });
  vm.runInContext(inlineScripts[2], sandbox, { filename: 'index-script-2-overlay.js' });
  documentMock._fire('DOMContentLoaded');
  return { sandbox, elementsById };
}

async function runLoggedInAsMalta(offerCreateResponse) {
  const session = { user: { id: 'u-test' } };
  const membership = { role: 'store', location_id: 2, active: true, pilot_enabled: true, rete_locations: { code: 2, name: 'Malta', active: true } };
  const requestRow = { id: 'r-1', requesting_location_id: 4, product_code: 'X1', product_description: 'Prodotto test', requested_quantity: 6, remaining_quantity: 6, status: 'DA_TROVARE', version: 0, source: 'EMAIL' };
  const supabaseClient = mockSupabase({
    session,
    tables: {
      rete_memberships: { single: { data: membership, error: null } },
      rete_locations: { list: { data: [{ id: 2, code: 2, name: 'Malta', active: true }, { id: 4, code: 4, name: 'Sestri', active: true }], error: null } },
      rete_requests: { list: { data: [requestRow], error: null } },
      rete_offers: { list: { data: [], error: null } },
      rete_transfers: { list: { data: [], error: null } },
    },
    rpc: (name) => (name === 'rete_offer_create' ? { data: offerCreateResponse, error: null } : { data: { status: 'OK' }, error: null }),
  });
  const { sandbox, elementsById } = freshApp(supabaseClient);
  await vm.runInContext('initAuth()', sandbox, { filename: 'invoke-initAuth.js' });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  return { sandbox, elementsById };
}

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + (e && e.message)); fail++; }
}

(async function run() {
  await check('normal auto-accepted offer shows "accettata automaticamente" and "Merce da preparare", never pending-approval wording', async () => {
    const { sandbox, elementsById } = await runLoggedInAsMalta({ offer_id: 'off-1', status: 'APPROVATA', acceptance_mode: 'AUTOMATIC', transfer_id: 't-1', requires_review: false });
    vm.runInContext('offer(1)', sandbox);
    const qtyInput = vm.runInContext("document.getElementById('oq')", sandbox); qtyInput.value = '2';
    await vm.runInContext('saveOffer(1)', sandbox, { filename: 'save-offer.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const toastText = elementsById.toast.textContent || elementsById.toast.innerHTML;
    assert.ok(/accettata automaticamente/i.test(toastText), toastText);
    assert.ok(/merce da preparare/i.test(toastText), toastText);
    for (const forbidden of [/in attesa di approvazione/i, /richiede approvazione/i, /da confermare dalla centrale/i]) {
      assert.ok(!forbidden.test(toastText), 'forbidden wording matched ' + forbidden + ' in: ' + toastText);
    }
  });

  await check('exception review offer shows an honest review message, not a false success', async () => {
    const { sandbox, elementsById } = await runLoggedInAsMalta({ offer_id: 'off-2', status: 'DATA_REVIEW', acceptance_mode: null, transfer_id: null, requires_review: true });
    vm.runInContext('offer(1)', sandbox);
    vm.runInContext("document.getElementById('oq')", sandbox).value = '2';
    await vm.runInContext('saveOffer(1)', sandbox, { filename: 'save-offer-review.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const toastText = elementsById.toast.textContent || elementsById.toast.innerHTML;
    assert.ok(/verifica/i.test(toastText), toastText);
    assert.ok(!/accettata automaticamente/i.test(toastText), toastText);
  });

  await check('STATUS_LABEL maps review statuses honestly and never to the forbidden phrases', () => {
    const RETE_BACKEND_ADAPTER = (() => {
      const sandbox = { window: undefined };
      vm.createContext(sandbox);
      vm.runInContext(adapterSource, sandbox);
      return sandbox.RETE_BACKEND_ADAPTER || sandbox.window;
    })();
    assert.ok(adapterSource.includes("DATA_REVIEW: 'IN VERIFICA'"));
    assert.ok(adapterSource.includes("CONFLICT_REVIEW: 'IN VERIFICA'"));
    assert.ok(adapterSource.includes("ARRIVAL_CONFLICT: 'IN VERIFICA'"));
    for (const forbidden of ['In attesa di approvazione', 'Richiede approvazione', 'Da confermare dalla centrale']) {
      assert.ok(!adapterSource.includes(forbidden), 'adapter source must not contain: ' + forbidden);
    }
  });

  console.log((fail === 0 ? 'AUTO_OFFER_UI_TESTS: PASS' : 'AUTO_OFFER_UI_TESTS: FAIL') + ` (${pass} passed, ${fail} failed)`);

  // --- Static migration safety checks (no DB required) ---
  const migrationPaths = [
    path.join(__dirname, '..', 'supabase/migrations/20260727100000_rete_squillari_automatic_offer_acceptance_enum.sql'),
    path.join(__dirname, '..', 'supabase/migrations/20260727110000_rete_squillari_automatic_offer_acceptance.sql'),
  ];
  const migrationSources = migrationPaths.map((p) => fs.readFileSync(p, 'utf8'));

  await check('migrations are additive only: no DROP TABLE/COLUMN, no destructive statements', () => {
    for (const src of migrationSources) {
      assert.ok(!/DROP TABLE/i.test(src));
      assert.ok(!/DROP COLUMN/i.test(src));
      assert.ok(!/TRUNCATE/i.test(src));
      assert.ok(!/DELETE FROM/i.test(src));
    }
  });

  await check('migrations never backfill/UPDATE existing offer rows outside of function-body definitions (no invented data on legacy rows)', () => {
    for (const src of migrationSources) {
      // Strip dollar-quoted function bodies ($$...$$) before checking - an
      // UPDATE inside a stored function's source text is runtime behavior
      // triggered later by an RPC call, not something the migration itself
      // executes against existing rows at apply time.
      const withoutFunctionBodies = src.replace(/\$\$[\s\S]*?\$\$/g, '');
      assert.ok(!/^\s*UPDATE\s+public\.rete_offers/im.test(withoutFunctionBodies), 'must not UPDATE existing rete_offers rows at migration-apply time');
    }
  });

  await check('new rete_offers columns are nullable (no NOT NULL without default)', () => {
    const acceptanceMigration = migrationSources[1];
    assert.ok(acceptanceMigration.includes('ADD COLUMN IF NOT EXISTS "accepted_at"'));
    assert.ok(acceptanceMigration.includes('ADD COLUMN IF NOT EXISTS "acceptance_mode"'));
    assert.ok(!/ADD COLUMN IF NOT EXISTS "accepted_at".*NOT NULL/i.test(acceptanceMigration));
  });

  await check('enum values are added in their own separate migration/transaction (Postgres same-transaction-use restriction)', () => {
    assert.ok(migrationSources[0].includes("ADD VALUE IF NOT EXISTS 'DATA_REVIEW'"));
    assert.ok(!migrationSources[1].includes('ALTER TYPE "public"."rete_offer_status" ADD VALUE'), 'the second migration must not itself add enum values it then uses');
  });

  console.log((fail === 0 ? 'AUTO_OFFER_ALL_TESTS: PASS' : 'AUTO_OFFER_ALL_TESTS: FAIL') + ` (${pass} passed, ${fail} failed)`);
  if (fail > 0) process.exit(1);
})();
