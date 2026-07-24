// Tests for the store-facing environment labels gate: active pilot stores
// (Malta/Sestri/De Ferrari) must never see demo wording; inactive stores
// (Cantore/Trento/Armenia) must fail closed to a clear inactive-service
// message instead of the local demo workspace. Drives the real
// public/rete-squillari/index.html inline scripts + rete-backend-adapter.js
// through initAuth()/loadSession() against a mocked Supabase client - no
// live database required, no jsdom dependency (hand-rolled DOM shim).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = '';
    this.className = '';
    this._innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this.onclick = null;
    this.style = {};
    this._listeners = {};
    this.classList = {
      add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false,
    };
  }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  insertBefore(node) { this.children.unshift(node); node.parentElement = this; return node; }
  prepend(...nodes) { this.children.unshift(...nodes); nodes.forEach((n) => { n.parentElement = this; }); }
  append(...nodes) { this.children.push(...nodes); nodes.forEach((n) => { n.parentElement = this; }); }
  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
    }
  }
  matchesSelector(sel) {
    if (sel[0] === '.') return (' ' + this.className + ' ').indexOf(' ' + sel.slice(1) + ' ') !== -1;
    if (sel[0] === '#') return this.id === sel.slice(1);
    return false;
  }
  querySelector(sel) {
    for (const c of this.children) {
      if (c.matchesSelector(sel)) return c;
      const r = c.querySelector(sel);
      if (r) return r;
    }
    return null;
  }
  querySelectorAll(sel) {
    let out = [];
    for (const c of this.children) {
      if (c.matchesSelector(sel)) out.push(c);
      out = out.concat(c.querySelectorAll(sel));
    }
    return out;
  }
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
  mainApp.classList = {
    add: (c) => mainApp._classes.add(c),
    remove: (c) => mainApp._classes.delete(c),
    toggle: () => {},
    contains: (c) => mainApp._classes.has(c),
  };
  const aside = el(elementsById, 'aside', null, 'side'); mainApp.appendChild(aside);
  const logo = el(elementsById, 'div', null, 'logo'); logo.innerHTML = 'Rete Squillari<small>Aiuta un negozio</small>'; aside.appendChild(logo);
  const roleBtn = el(elementsById, 'button', 'role'); aside.appendChild(roleBtn);
  const profileKind = el(elementsById, 'small', 'profile-kind'); roleBtn.appendChild(profileKind);
  const who = el(elementsById, 'b', 'who'); roleBtn.appendChild(who);
  const nav = el(elementsById, 'nav', 'nav'); aside.appendChild(nav);
  const sidebarFoot = el(elementsById, 'div', 'sidebar-foot'); aside.appendChild(sidebarFoot);

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
    head: el(elementsById, 'head'),
    body,
    getElementById(id) { return elementsById[id] || null; },
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
    document: documentMock,
    localStorage: localStorageMock,
    location: { reload() {}, href: 'http://127.0.0.1:4173/rete-squillari/' },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener() {},
    print() {},
    console,
    Date, JSON, Math, Array, Object, String, Number, Boolean, RegExp, Set, Promise,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
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
assert.strictEqual(inlineScripts.length, 3, 'expected exactly 3 inline <script> blocks');

// Fake Supabase client. `membership` and `locations`/`requests`/`offers`/
// `transfers` are keyed by table name so both the original demo loadSession()
// and the governed adapter's initialize()/loadDashboard() can share one mock.
function mockSupabase(opts) {
  opts = opts || {};
  const tables = opts.tables || {};
  function chain(table) {
    const self = { _table: table };
    self.select = () => self;
    self.eq = () => self;
    self.order = () => self;
    self.single = () => Promise.resolve(tables[table] && tables[table].single ? tables[table].single : { data: null, error: { message: 'not mocked' } });
    self.then = (resolve, reject) => Promise.resolve(tables[table] && tables[table].list ? tables[table].list : { data: [], error: null }).then(resolve, reject);
    return self;
  }
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: opts.session || null } }),
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ data: null, error: { message: 'not used in these tests' } }),
    },
    from: (table) => chain(table),
    rpc: () => Promise.resolve({ data: { status: 'OK' }, error: null }),
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

async function runLoggedIn(membershipRow, locationsRows, requestsRows) {
  const session = { user: { id: 'u-test' } };
  const supabaseClient = mockSupabase({
    session,
    tables: {
      rete_memberships: { single: { data: membershipRow, error: null } },
      rete_locations: { list: { data: locationsRows || [], error: null } },
      rete_requests: { list: { data: requestsRows || [], error: null } },
      rete_offers: { list: { data: [], error: null } },
      rete_transfers: { list: { data: [], error: null } },
    },
  });
  const { sandbox, elementsById } = freshApp(supabaseClient);
  await vm.runInContext('initAuth()', sandbox, { filename: 'invoke-initAuth.js' });
  // initAuth/loadSession/adapter.initialize/refreshFromBackend are all async;
  // let their microtask chains settle before inspecting the DOM.
  for (let i = 0; i < 6; i++) await Promise.resolve();
  return { sandbox, elementsById };
}

function allRenderedText(elementsById) {
  return [
    elementsById.view.innerHTML,
    elementsById.nav.innerHTML,
    elementsById['sidebar-foot'].innerHTML,
    elementsById['profile-kind'].innerHTML,
    elementsById['title'].textContent,
    elementsById['eyebrow'].textContent,
  ].join('\n');
}

const FORBIDDEN_ACTIVE = [/demo/i, /versione demo/i, /demo locale/i, /ambiente di prova/i, /dati dimostrativi/i, /PILOTA ATTIVO/, /GOVERNED_BACKEND/, /DEMO_LOCAL/];

var pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + (e && e.message)); fail++; }
}

const activeStores = [
  { name: 'Malta', location_id: 2, code: 2 },
  { name: 'Sestri', location_id: 4, code: 4 },
  { name: 'De Ferrari', location_id: 7, code: 7 },
];
const inactiveStores = [
  { name: 'Cantore', location_id: 5, code: 5 },
  { name: 'Trento', location_id: 6, code: 6 },
  { name: 'Armenia', location_id: 8, code: 8 },
];

(async function run() {
  for (const store of activeStores) {
    await check(store.name + ' does not see demo wording and sees governed live requests', async () => {
      const membership = {
        role: 'store', location_id: store.location_id, active: true, pilot_enabled: true,
        rete_locations: { code: store.code, name: store.name, active: true },
      };
      const locations = [{ id: store.location_id, code: store.code, name: store.name, active: true }];
      const requests = [{
        id: 'req-1', requesting_location_id: store.location_id, product_code: 'X1',
        product_description: 'LIVE_MARKER_' + store.name, requested_quantity: 6, remaining_quantity: 6,
        status: 'DA_TROVARE', urgency: 'NORMALE', source: 'EMAIL_AMMINISTRAZIONE', version: 0,
      }];
      const { elementsById } = await runLoggedIn(membership, locations, requests);
      const text = allRenderedText(elementsById);
      for (const re of FORBIDDEN_ACTIVE) assert.ok(!re.test(text), 'forbidden wording matched ' + re + ' in: ' + text.slice(0, 400));
      assert.ok(elementsById.view.innerHTML.includes('LIVE_MARKER_' + store.name), 'active store must load its governed live request');
      assert.strictEqual(elementsById['main-app']._classes.has('hidden'), false, 'main app must be visible for an active store');
    });
  }

  await check('active stores see "Rete Squillari" as the app title', async () => {
    const membership = { role: 'store', location_id: 2, active: true, pilot_enabled: true, rete_locations: { code: 2, name: 'Malta', active: true } };
    const { elementsById } = await runLoggedIn(membership, [{ id: 2, code: 2, name: 'Malta', active: true }], []);
    assert.ok(elementsById.body.querySelector('.logo').innerHTML.includes('Rete Squillari'), 'brand title "Rete Squillari" must be present');
  });

  for (const store of inactiveStores) {
    await check(store.name + ' sees inactive-service message, not live data or create/offer actions', async () => {
      const membership = {
        role: 'store', location_id: store.location_id, active: true, pilot_enabled: false,
        rete_locations: { code: store.code, name: store.name, active: true },
      };
      const requests = [{
        id: 'req-1', requesting_location_id: store.location_id, product_code: 'X1',
        product_description: 'SHOULD_NEVER_RENDER_' + store.name, requested_quantity: 6, remaining_quantity: 6,
        status: 'DA_TROVARE', urgency: 'NORMALE', source: 'EMAIL_AMMINISTRAZIONE', version: 0,
      }];
      const { elementsById } = await runLoggedIn(membership, [{ id: store.location_id, code: store.code, name: store.name, active: true }], requests);
      const viewHtml = elementsById.view.innerHTML;
      assert.ok(viewHtml.includes('Servizio non ancora attivo per questo negozio'), 'inactive message must be shown');
      assert.ok(viewHtml.includes('L’accesso alla Rete Squillari sarà disponibile dopo l’attivazione.'), 'inactive detail sentence must be shown');
      assert.ok(!viewHtml.includes('SHOULD_NEVER_RENDER_' + store.name), 'inactive store must not see live requests');
      assert.ok(!/Crea scheda ammanco/i.test(viewHtml), 'inactive store must not see a request-creation action');
      assert.ok(!/Posso aiutare/i.test(viewHtml), 'inactive store must not see an offer action');
      assert.strictEqual(elementsById.nav.innerHTML, '', 'inactive store nav must be empty (no navigable pages)');
    });
  }

  await check('inactive store can still log out via the profile button', async () => {
    const membership = { role: 'store', location_id: 5, active: true, pilot_enabled: false, rete_locations: { code: 5, name: 'Cantore', active: true } };
    const { elementsById } = await runLoggedIn(membership, [{ id: 5, code: 5, name: 'Cantore', active: true }], []);
    assert.strictEqual(typeof elementsById.role.onclick, 'function', 'role button must remain clickable');
    elementsById.role.onclick();
    assert.ok(elementsById.modal.innerHTML.includes('Disconnetti'), 'profile modal must offer Disconnetti for an inactive store');
  });

  await check('anonymous users see the login screen only', async () => {
    const supabaseClient = mockSupabase({ session: null, tables: {} });
    const { sandbox, elementsById } = freshApp(supabaseClient);
    await vm.runInContext('initAuth()', sandbox, { filename: 'invoke-initAuth-anon.js' });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.strictEqual(elementsById['login-screen'].style.display, 'flex', 'login screen must be shown for anonymous users');
    assert.strictEqual(elementsById['main-app']._classes.has('hidden'), true, 'main app must stay hidden for anonymous users');
    const text = elementsById['login-screen'].innerHTML + elementsById.body.innerHTML;
    assert.ok(!/pilot_enabled|GOVERNED_BACKEND|DEMO_LOCAL/i.test(text), 'anonymous login screen must not expose pilot/environment configuration details');
  });

  await check('no store-facing rendered text contains the literal DEMO_LOCAL mode identifier', async () => {
    const activeMembership = { role: 'store', location_id: 2, active: true, pilot_enabled: true, rete_locations: { code: 2, name: 'Malta', active: true } };
    const { elementsById: activeEls } = await runLoggedIn(activeMembership, [{ id: 2, code: 2, name: 'Malta', active: true }], []);
    assert.ok(!allRenderedText(activeEls).includes('DEMO_LOCAL'));

    const inactiveMembership = { role: 'store', location_id: 5, active: true, pilot_enabled: false, rete_locations: { code: 5, name: 'Cantore', active: true } };
    const { elementsById: inactiveEls } = await runLoggedIn(inactiveMembership, [{ id: 5, code: 5, name: 'Cantore', active: true }], []);
    assert.ok(!allRenderedText(inactiveEls).includes('DEMO_LOCAL'));
  });

  await check('inactive-store message reuses the existing styled .empty class (mobile-safe, no new unstyled markup)', async () => {
    const membership = { role: 'store', location_id: 6, active: true, pilot_enabled: false, rete_locations: { code: 6, name: 'Trento', active: true } };
    const { elementsById } = await runLoggedIn(membership, [{ id: 6, code: 6, name: 'Trento', active: true }], []);
    assert.ok(elementsById.view.innerHTML.includes('class="empty"'), 'inactive message should reuse the existing responsive .empty card style');
  });

  console.log((fail === 0 ? 'STORE_ENVIRONMENT_LABEL_TESTS: PASS' : 'STORE_ENVIRONMENT_LABEL_TESTS: FAIL') + ' (' + pass + ' passed, ' + fail + ' failed)');
  if (fail > 0) process.exit(1);
})();
