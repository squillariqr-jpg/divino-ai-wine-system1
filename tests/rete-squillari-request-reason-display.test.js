// Tests for the voluntary-request reason display gate: the manual-request
// form must collect a required canonical reason (Vendita/Ordine cliente/
// Riassortimento negozio/Altro), and every request card + the detail modal
// must render it - never an empty row when null, never a raw enum value,
// never a fabricated reason for email-sourced requests. Drives the real
// public/rete-squillari/index.html inline scripts + rete-backend-adapter.js
// through initAuth()/loadSession() against a mocked Supabase client.
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
    this.value = '';
    this._listeners = {};
    this.classList = {
      add: () => {}, remove: () => {},
      toggle: (c, force) => {},
      contains: () => false,
    };
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
    head: el(elementsById, 'head'),
    body,
    getElementById(id) {
      if (!elementsById[id]) { elementsById[id] = new FakeElement('div'); elementsById[id].id = id; }
      return elementsById[id];
    },
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
    rpc: (name, params) => Promise.resolve(opts.rpc ? opts.rpc(name, params) : { data: { status: 'OK' }, error: null }),
    __rpcCalls: opts.__rpcCalls || [],
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

async function runLoggedIn(requestsRows) {
  const session = { user: { id: 'u-test' } };
  const membership = { role: 'store', location_id: 2, active: true, pilot_enabled: true, rete_locations: { code: 2, name: 'Malta', active: true } };
  const rpcCalls = [];
  const supabaseClient = mockSupabase({
    session,
    tables: {
      rete_memberships: { single: { data: membership, error: null } },
      rete_locations: { list: { data: [{ id: 2, code: 2, name: 'Malta', active: true }, { id: 4, code: 4, name: 'Sestri', active: true }], error: null } },
      rete_requests: { list: { data: requestsRows || [], error: null } },
      rete_offers: { list: { data: [], error: null } },
      rete_transfers: { list: { data: [], error: null } },
    },
    rpc: (name, params) => { rpcCalls.push({ name, params }); return { data: { request_id: 'new-req', status: 'DA_TROVARE', requires_central_confirmation: false }, error: null }; },
  });
  const { sandbox, elementsById } = freshApp(supabaseClient);
  await vm.runInContext('initAuth()', sandbox, { filename: 'invoke-initAuth.js' });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  return { sandbox, elementsById, rpcCalls };
}

var pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + (e && e.message)); fail++; }
}

const baseRow = (overrides) => Object.assign({
  id: 'r-1', requesting_location_id: 2, product_code: 'X1', product_description: 'Prodotto test',
  requested_quantity: 6, remaining_quantity: 6, status: 'DA_TROVARE', urgency: 'NORMALE',
  source: 'MANUAL', version: 0,
}, overrides);

(async function run() {
  await check('SALE renders as "Causale: Vendita" on the card', async () => {
    const { elementsById } = await runLoggedIn([baseRow({ request_reason: 'SALE' })]);
    assert.ok(elementsById.view.innerHTML.includes('Causale: Vendita'), elementsById.view.innerHTML.slice(0, 500));
  });

  await check('CUSTOMER_ORDER renders as "Ordine cliente"', async () => {
    const { elementsById } = await runLoggedIn([baseRow({ request_reason: 'CUSTOMER_ORDER' })]);
    assert.ok(elementsById.view.innerHTML.includes('Causale: Ordine cliente'));
  });

  await check('STORE_REPLENISHMENT renders as "Riassortimento negozio"', async () => {
    const { elementsById } = await runLoggedIn([baseRow({ request_reason: 'STORE_REPLENISHMENT' })]);
    assert.ok(elementsById.view.innerHTML.includes('Causale: Riassortimento negozio'));
  });

  await check('OTHER with a note renders "Altro — <note>", HTML-escaped', async () => {
    const { elementsById } = await runLoggedIn([baseRow({ request_reason: 'OTHER', request_reason_note: 'Evento <speciale> & degustazione' })]);
    const html = elementsById.view.innerHTML;
    assert.ok(html.includes('Causale: Altro — Evento &lt;speciale&gt; &amp; degustazione'), html.slice(0, 600));
    assert.ok(!html.includes('<speciale>'), 'reason note must be HTML-escaped, not injected raw');
  });

  await check('raw enum values (e.g. "SALE") are never shown to staff', async () => {
    const { elementsById } = await runLoggedIn([baseRow({ request_reason: 'SALE' })]);
    const html = elementsById.view.innerHTML;
    assert.ok(!/>\s*SALE\s*</.test(html) && !html.includes('Causale: SALE'), 'must render the Italian label, never the raw enum');
  });

  await check('null reason renders no "Causale:" row at all', async () => {
    const { elementsById } = await runLoggedIn([baseRow({ request_reason: null })]);
    assert.ok(!elementsById.view.innerHTML.includes('Causale:'), 'no reason -> no empty Causale row');
  });

  await check('legacy request with no request_reason column value still renders (no crash, no fabricated reason)', async () => {
    const row = baseRow({}); delete row.request_reason; delete row.request_reason_note;
    const { elementsById } = await runLoggedIn([row]);
    assert.ok(elementsById.view.innerHTML.includes('Prodotto test'), 'legacy card must still render');
    assert.ok(!elementsById.view.innerHTML.includes('Causale:'));
  });

  await check('email-derived request is never auto-labeled SALE', async () => {
    const row = baseRow({ source: 'EMAIL', request_reason: null });
    const { elementsById } = await runLoggedIn([row]);
    assert.ok(!elementsById.view.innerHTML.includes('Causale:'), 'EMAIL-sourced request must not display a fabricated reason');
  });

  await check('detail modal shows "Causale richiesta" + label for a reasoned request', async () => {
    const { elementsById, sandbox } = await runLoggedIn([baseRow({ request_reason: 'SALE' })]);
    vm.runInContext('detail(1)', sandbox);
    const modalHtml = elementsById.modal.innerHTML;
    assert.ok(modalHtml.includes('Causale richiesta'), modalHtml.slice(0, 800));
    assert.ok(modalHtml.includes('Vendita'));
  });

  await check('detail modal adds no reason paragraph when reason is null', async () => {
    const { elementsById, sandbox } = await runLoggedIn([baseRow({ request_reason: null })]);
    vm.runInContext('detail(1)', sandbox);
    assert.ok(!elementsById.modal.innerHTML.includes('Causale richiesta'));
  });

  function fillManualForm(sandbox, fields) {
    Object.keys(fields).forEach((id) => {
      vm.runInContext('document.getElementById(' + JSON.stringify(id) + ')', sandbox).value = fields[id];
    });
  }

  await check('manual request form requires a reason selection before submit', async () => {
    const { sandbox, rpcCalls } = await runLoggedIn([]);
    vm.runInContext('openManualRequestForm()', sandbox);
    fillManualForm(sandbox, { 'mr-code': 'C9', 'mr-desc': 'Nuovo prodotto', 'mr-qty': '6', 'mr-reason': '' });
    await vm.runInContext('submitManualRequest()', sandbox, { filename: 'submit-no-reason.js' });
    for (let i = 0; i < 3; i++) await Promise.resolve();
    assert.strictEqual(rpcCalls.filter((c) => c.name === 'rete_manual_request_create').length, 0, 'must not call the RPC without a selected reason');
  });

  await check('manual request form submits SALE and clears the note for non-OTHER reasons', async () => {
    const { sandbox, rpcCalls } = await runLoggedIn([]);
    vm.runInContext('openManualRequestForm()', sandbox);
    fillManualForm(sandbox, { 'mr-code': 'C9', 'mr-desc': 'Nuovo prodotto', 'mr-qty': '6', 'mr-reason': 'SALE', 'mr-reason-note': 'should be dropped' });
    await vm.runInContext('submitManualRequest()', sandbox, { filename: 'submit-sale.js' });
    for (let i = 0; i < 3; i++) await Promise.resolve();
    const call = rpcCalls.find((c) => c.name === 'rete_manual_request_create');
    assert.ok(call, 'RPC must have been called');
    assert.strictEqual(call.params.p_request_reason, 'SALE');
    assert.strictEqual(call.params.p_request_reason_note, null, 'note must be dropped for a non-OTHER reason, never silently forwarded');
  });

  await check('manual request form submits OTHER with its note', async () => {
    const { sandbox, rpcCalls } = await runLoggedIn([]);
    vm.runInContext('openManualRequestForm()', sandbox);
    fillManualForm(sandbox, { 'mr-code': 'C9', 'mr-desc': 'Nuovo prodotto', 'mr-qty': '6', 'mr-reason': 'OTHER', 'mr-reason-note': 'Fiera locale' });
    await vm.runInContext('submitManualRequest()', sandbox, { filename: 'submit-other.js' });
    for (let i = 0; i < 3; i++) await Promise.resolve();
    const call = rpcCalls.find((c) => c.name === 'rete_manual_request_create');
    assert.strictEqual(call.params.p_request_reason, 'OTHER');
    assert.strictEqual(call.params.p_request_reason_note, 'Fiera locale');
  });

  await check('reason is positioned near product description/quantity, not inside the actions row', async () => {
    const { elementsById } = await runLoggedIn([baseRow({ request_reason: 'SALE' })]);
    const html = elementsById.view.innerHTML;
    const reasonIdx = html.indexOf('Causale: Vendita');
    const qtyIdx = html.indexOf('class="qty"');
    const actionsIdx = html.indexOf('class="actions"');
    assert.ok(reasonIdx > -1 && qtyIdx > -1 && actionsIdx > -1);
    assert.ok(reasonIdx < qtyIdx, 'reason line must sit before the quantity block, not after/inside actions');
    assert.ok(reasonIdx < actionsIdx);
  });

  console.log((fail === 0 ? 'REQUEST_REASON_DISPLAY_TESTS: PASS' : 'REQUEST_REASON_DISPLAY_TESTS: FAIL') + ' (' + pass + ' passed, ' + fail + ' failed)');
  if (fail > 0) process.exit(1);
})();
