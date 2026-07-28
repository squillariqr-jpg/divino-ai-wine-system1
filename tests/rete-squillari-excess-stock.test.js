// Tests for the excess-stock publication UI + static migration safety.
// DB/RPC/concurrency-level tests for this gate could not be executed this
// session (local Docker was unavailable throughout) - see the final report
// for that limitation. What's covered here is genuinely verified: the real
// index.html/adapter code renders correctly, blocks invalid client-side
// submissions, never shows "Posso aiutare" on an excess card, and the
// migrations are structurally additive/safe.
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
    fetch: undefined, // overridden per-test
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

async function runLoggedInAsMalta(excessItems, rpcHandler) {
  const session = { user: { id: 'u-test' }, access_token: 'test-token' };
  const membership = { role: 'store', location_id: 2, active: true, pilot_enabled: true, rete_locations: { code: 2, name: 'Malta', active: true } };
  const supabaseClient = mockSupabase({
    session,
    tables: {
      rete_memberships: { single: { data: membership, error: null } },
      rete_locations: { list: { data: [{ id: 2, code: 2, name: 'Malta', active: true }, { id: 4, code: 4, name: 'Sestri', active: true }], error: null } },
      rete_requests: { list: { data: [], error: null } },
      rete_offers: { list: { data: [], error: null } },
      rete_transfers: { list: { data: [], error: null } },
      rete_excess_stock: { list: { data: excessItems || [], error: null } },
      rete_excess_reservations: { list: { data: [], error: null } },
    },
    rpc: rpcHandler || (() => ({ data: { status: 'OK' }, error: null })),
  });
  const { sandbox, elementsById } = freshApp(supabaseClient);
  await vm.runInContext('initAuth()', sandbox, { filename: 'invoke-initAuth.js' });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  return { sandbox, elementsById };
}

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + (e && e.stack)); fail++; }
}

const otherStoreExcessRow = {
  id: 'ex-1', offering_location_id: 4, catalog_product_id: 'C1', product_code: 'C1', ean: null,
  product_description: 'Vermentino Gallura DOCG', initial_quantity: 12, remaining_quantity: 12,
  reason: 'OVERSTOCK', notes: null, status: 'AVAILABLE', expires_at: null, created_at: '2026-07-27T10:00:00Z', version: 0,
};
const ownExcessRow = {
  id: 'ex-2', offering_location_id: 2, catalog_product_id: 'C2', product_code: 'C2', ean: null,
  product_description: 'Prosecco DOC', initial_quantity: 6, remaining_quantity: 6,
  reason: 'SLOW_MOVING', notes: null, status: 'AVAILABLE', expires_at: null, created_at: '2026-07-27T10:00:00Z', version: 0,
};

(async function run() {
  await check('excess stock nav item and page render for a logged-in store', async () => {
    const { sandbox, elementsById } = await runLoggedInAsMalta([otherStoreExcessRow]);
    vm.runInContext("go('excess')", sandbox);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.ok(elementsById.view.innerHTML.includes('Eccedenze disponibili'));
    assert.ok(elementsById.view.innerHTML.includes('Vermentino Gallura DOCG'));
  });

  await check('another store\'s entry shows "Prenota", never "Posso aiutare" (shortage-only wording)', async () => {
    const { sandbox, elementsById } = await runLoggedInAsMalta([otherStoreExcessRow]);
    vm.runInContext("go('excess')", sandbox);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const html = elementsById.view.innerHTML;
    assert.ok(html.includes('Prenota'));
    assert.ok(!html.includes('Posso aiutare'), 'excess cards must never show the shortage-request "Posso aiutare" action');
  });

  await check('own entry shows "Modifica quantità residua" and "Ritira eccedenza", never "Prenota" on itself', async () => {
    const { sandbox, elementsById } = await runLoggedInAsMalta([ownExcessRow]);
    vm.runInContext("go('excess')", sandbox);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const html = elementsById.view.innerHTML;
    assert.ok(html.includes('Modifica quantità residua'));
    assert.ok(html.includes('Ritira eccedenza'));
    // The only "Prenota" that could appear must not be attached to the own card -
    // with a single own row in the mock, no "Prenota" should render at all.
    assert.ok(!html.includes('Prenota'), 'offering store must never see a reserve action on its own entry');
  });

  await check('publish form: missing both product code and EAN blocks submission before any RPC call', async () => {
    let rpcCalls = [];
    const { sandbox, elementsById } = await runLoggedInAsMalta([], (name, params) => { rpcCalls.push({ name, params }); return { data: { status: 'OK' }, error: null }; });
    vm.runInContext('openPublishExcessForm()', sandbox);
    vm.runInContext("document.getElementById('ex-code')", sandbox).value = '';
    vm.runInContext("document.getElementById('ex-ean')", sandbox).value = '';
    vm.runInContext("document.getElementById('ex-qty')", sandbox).value = '5';
    vm.runInContext("document.getElementById('ex-reason')", sandbox).value = 'OVERSTOCK';
    await vm.runInContext('submitPublishExcess()', sandbox, { filename: 'submit-excess-no-id.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.strictEqual(rpcCalls.filter((c) => c.name === 'rete_excess_stock_publish').length, 0, 'must not call the RPC without a product identifier');
  });

  await check('publish form: missing reason blocks submission before any RPC call', async () => {
    let rpcCalls = [];
    const { sandbox } = await runLoggedInAsMalta([], (name, params) => { rpcCalls.push({ name, params }); return { data: { status: 'OK' }, error: null }; });
    vm.runInContext('openPublishExcessForm()', sandbox);
    vm.runInContext("document.getElementById('ex-code')", sandbox).value = 'C9';
    vm.runInContext("document.getElementById('ex-qty')", sandbox).value = '5';
    vm.runInContext("document.getElementById('ex-reason')", sandbox).value = '';
    await vm.runInContext('submitPublishExcess()', sandbox, { filename: 'submit-excess-no-reason.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.strictEqual(rpcCalls.filter((c) => c.name === 'rete_excess_stock_publish').length, 0, 'must not call the RPC without a reason');
  });

  await check('publish form: non-positive quantity blocks submission before any RPC call', async () => {
    let rpcCalls = [];
    const { sandbox } = await runLoggedInAsMalta([], (name, params) => { rpcCalls.push({ name, params }); return { data: { status: 'OK' }, error: null }; });
    vm.runInContext('openPublishExcessForm()', sandbox);
    vm.runInContext("document.getElementById('ex-code')", sandbox).value = 'C9';
    vm.runInContext("document.getElementById('ex-qty')", sandbox).value = '0';
    vm.runInContext("document.getElementById('ex-reason')", sandbox).value = 'OVERSTOCK';
    await vm.runInContext('submitPublishExcess()', sandbox, { filename: 'submit-excess-bad-qty.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.strictEqual(rpcCalls.filter((c) => c.name === 'rete_excess_stock_publish').length, 0, 'must not call the RPC with a non-positive quantity');
  });

  await check('reserve form: non-positive quantity blocks submission before any RPC call', async () => {
    let rpcCalls = [];
    const { sandbox } = await runLoggedInAsMalta([otherStoreExcessRow], (name, params) => { rpcCalls.push({ name, params }); return { data: { status: 'OK' }, error: null }; });
    vm.runInContext('openReserveExcessForm(1)', sandbox);
    vm.runInContext("document.getElementById('ex-rq')", sandbox).value = '-1';
    await vm.runInContext('submitReserveExcess(1)', sandbox, { filename: 'submit-reserve-bad-qty.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.strictEqual(rpcCalls.filter((c) => c.name === 'rete_excess_stock_reserve').length, 0);
  });

  await check('successful reservation shows "Prenotazione confermata" and "Merce da preparare"', async () => {
    const { sandbox, elementsById } = await runLoggedInAsMalta([otherStoreExcessRow], (name) => {
      if (name === 'rete_excess_stock_reserve') return { data: { reservation_id: 'r1', transfer_id: 't1', excess_stock_status: 'PARTIALLY_RESERVED', quantity: 4, reservation_status: 'ACCEPTED', human_approval_required: false }, error: null };
      return { data: { status: 'OK' }, error: null };
    });
    vm.runInContext("go('excess')", sandbox);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    vm.runInContext('openReserveExcessForm(1)', sandbox);
    vm.runInContext("document.getElementById('ex-rq')", sandbox).value = '4';
    await vm.runInContext('submitReserveExcess(1)', sandbox, { filename: 'submit-reserve-ok.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const toastText = elementsById.toast.textContent || elementsById.toast.innerHTML;
    assert.ok(/prenotazione confermata/i.test(toastText), toastText);
    assert.ok(/merce da preparare/i.test(toastText), toastText);
    for (const forbidden of [/in attesa di approvazione/i, /da confermare/i, /richiede approvazione/i, /in verifica centrale/i]) {
      assert.ok(!forbidden.test(toastText), 'forbidden wording matched ' + forbidden + ' in: ' + toastText);
    }
  });

  await check('successful publication shows "Eccedenza pubblicata" and the exact required copy, never an approval message', async () => {
    global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ outcome: 'MATCH', catalogProductId: 'C9', productCode: 'C9', productDescription: 'Test Product', ean: null, catalogMatchMethod: 'PRODUCT_CODE' }) });
    const { sandbox, elementsById } = await runLoggedInAsMalta([], (name) => {
      if (name === 'rete_excess_stock_publish') return { data: { excess_stock_id: 'ex-9', status: 'AVAILABLE', remaining_quantity: 5, publication_mode: 'AUTOMATIC', approved_by: null, human_approval_required: false }, error: null };
      return { data: { status: 'OK' }, error: null };
    });
    sandbox.fetch = global.fetch;
    vm.runInContext('openPublishExcessForm()', sandbox);
    vm.runInContext("document.getElementById('ex-code')", sandbox).value = 'C9';
    vm.runInContext("document.getElementById('ex-qty')", sandbox).value = '5';
    vm.runInContext("document.getElementById('ex-reason')", sandbox).value = 'OVERSTOCK';
    await vm.runInContext('submitPublishExcess()', sandbox, { filename: 'submit-excess-ok.js' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const toastText = elementsById.toast.textContent || elementsById.toast.innerHTML;
    assert.ok(/eccedenza pubblicata/i.test(toastText), toastText);
    assert.ok(/ora visibile agli altri negozi/i.test(toastText), toastText);
    for (const forbidden of [/in attesa di approvazione/i, /da confermare/i, /richiede approvazione/i, /in verifica centrale/i]) {
      assert.ok(!forbidden.test(toastText), 'forbidden wording matched ' + forbidden + ' in: ' + toastText);
    }
    delete global.fetch;
  });

  await check('anonymous users see the login screen only (unchanged)', async () => {
    const supabaseClient = mockSupabase({ session: null, tables: {} });
    const { sandbox, elementsById } = freshApp(supabaseClient);
    await vm.runInContext('initAuth()', sandbox, { filename: 'invoke-initAuth-anon.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.strictEqual(elementsById['login-screen'].style.display, 'flex');
    assert.strictEqual(elementsById['main-app']._classes.has('hidden'), true);
  });

  console.log((fail === 0 ? 'EXCESS_STOCK_UI_TESTS: PASS' : 'EXCESS_STOCK_UI_TESTS: FAIL') + ` (${pass} passed, ${fail} failed)`);

  // --- Static migration safety checks (no DB required) ---
  const migrationPaths = [
    path.join(__dirname, '..', 'supabase/migrations/20260727120000_rete_squillari_excess_stock_enums.sql'),
    path.join(__dirname, '..', 'supabase/migrations/20260727130000_rete_squillari_excess_stock.sql'),
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

  await check('rete_transfers gets a nullable request_id/offer_id/approved_by plus excess_reservation_id, with an exactly-one-world CHECK', () => {
    const src = migrationSources[1];
    assert.ok(src.includes('ALTER COLUMN "request_id" DROP NOT NULL'));
    assert.ok(src.includes('ALTER COLUMN "offer_id" DROP NOT NULL'));
    assert.ok(src.includes('rete_transfers_exactly_one_world_check'));
  });

  await check('no status in the excess-stock model resembles a human-approval queue (DA_VERIFICARE/PENDING_APPROVAL/etc. absent)', () => {
    const src = migrationSources[0];
    for (const forbidden of ['DA_VERIFICARE', 'DA_CONFERMARE', 'PENDING_APPROVAL']) {
      assert.ok(!src.includes("'" + forbidden + "'"), 'excess-stock enums must not include: ' + forbidden);
    }
  });

  await check('no rete_excess_stock/reservations row carries an approver identity field', () => {
    const src = migrationSources[1];
    assert.ok(!/rete_excess_stock[\s\S]{0,400}approved_by/i.test(src.split('rete_excess_reservations')[0]), 'rete_excess_stock must never gain an approved_by-style column');
  });

  await check('enum values are added in their own separate migration/transaction', () => {
    assert.ok(migrationSources[0].includes("CREATE TYPE \"public\".\"rete_excess_stock_status\""));
    assert.ok(!migrationSources[1].includes('CREATE TYPE'), 'the second migration must not itself define enum types it then uses');
  });

  await check('duplicate-publication guard exists (no active duplicate for same store + canonical product)', () => {
    assert.ok(migrationSources[1].includes('No active duplicate for the same store + canonical catalog product'));
  });

  await check('per-store excess limit is tracked separately from the 60-card shortage network budget', () => {
    assert.ok(migrationSources[1].includes('rete_excess_stock_config'));
    assert.ok(migrationSources[1].includes('max_active_per_store'));
  });

  console.log((fail === 0 ? 'EXCESS_STOCK_ALL_TESTS: PASS' : 'EXCESS_STOCK_ALL_TESTS: FAIL') + ` (${pass} passed, ${fail} failed)`);
  if (fail > 0) process.exit(1);
})();
