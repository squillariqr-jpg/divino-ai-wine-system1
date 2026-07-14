const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Minimal hand-rolled DOM shim (no jsdom dependency available/authorized).
// Sufficient surface for the inline scripts in index.html: getElementById-based
// containers, a few querySelector fallbacks used defensively (?. / early-return
// guards) elsewhere in the file, createElement, classList, dataset, onclick.
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
    const self = this;
    this.classList = {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    };
  }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML; }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  insertBefore(node) { this.children.unshift(node); node.parentElement = this; return node; }
  prepend(...nodes) { this.children.unshift(...nodes); nodes.forEach((n) => { n.parentElement = this; }); }
  append(...nodes) { this.children.push(...nodes); nodes.forEach((n) => { n.parentElement = this; }); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  matches() { return false; }
}

function buildSandbox() {
  const elementsById = Object.create(null);
  const storageData = Object.create(null);
  const documentMock = {
    head: new FakeElement('head'),
    body: new FakeElement('body'),
    getElementById(id) {
      if (!elementsById[id]) {
        elementsById[id] = new FakeElement('div');
        elementsById[id].id = id;
      }
      return elementsById[id];
    },
    querySelector(sel) {
      if (sel === '.nav') return elementsById.nav || null;
      if (sel === '#modal') return elementsById.modal || null;
      return null;
    },
    querySelectorAll() { return []; },
    createElement(tag) { return new FakeElement(tag); },
    addEventListener() {},
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
    Date,
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Set,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, elementsById };
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
const html = fs.readFileSync(htmlPath, 'utf8');
const modelSource = fs.readFileSync(modelPath, 'utf8');
const inlineScripts = loadInlineScripts(html);
assert.strictEqual(inlineScripts.length, 3, 'expected exactly 3 inline <script> blocks (excluding location-model.js src)');

function freshApp() {
  const { sandbox, elementsById } = buildSandbox();
  // Execution order matches the document: app script, remediation-layer
  // script, location-model.js (external), shortages overlay script.
  vm.runInContext(inlineScripts[0], sandbox, { filename: 'index-script-0.js' });
  vm.runInContext(inlineScripts[1], sandbox, { filename: 'index-script-1.js' });
  vm.runInContext(modelSource, sandbox, { filename: 'location-model.js' });
  vm.runInContext(inlineScripts[2], sandbox, { filename: 'index-script-2-overlay.js' });
  return { sandbox, elementsById };
}

// --- BUG 1: shortages view must be injected into the DOM, not merely returned ---
(function bug1Test() {
  const { sandbox, elementsById } = freshApp();
  const homeSnapshot = elementsById.view.innerHTML;
  assert.ok(homeSnapshot.length > 0, 'home view should have rendered something at boot');
  assert.ok(!homeSnapshot.includes('Schede ammanco'), 'home view must not already contain the shortages markup');

  vm.runInContext("go('shortages')", sandbox);
  const shortagesHtml = elementsById.view.innerHTML;

  assert.notStrictEqual(shortagesHtml, homeSnapshot, 'BUG 1 regression: #view was not updated after navigating to shortages');
  assert.ok(shortagesHtml.includes('Schede ammanco'), 'BUG 1 regression: "Schede ammanco" heading missing from #view');
  assert.ok(shortagesHtml.includes('Crea scheda ammanco'), 'BUG 1 regression: "Crea scheda ammanco" button missing from #view');
  console.log('BUG_1_DOM_TEST: PASS');
})();

// --- BUG 2: #role / #mob must resolve the CURRENT picker (with Trasta), not the stale one ---
(function bug2Test() {
  const { sandbox, elementsById } = freshApp();

  // Simulate a real click: invoke the bound handler, exactly as the browser would.
  elementsById.role.onclick();
  const desktopModal = elementsById.modal.innerHTML;
  assert.ok(desktopModal.includes('Trasta'), 'BUG 2 regression: desktop #role picker does not offer Trasta');
  assert.ok(desktopModal.includes('Demo locale: scegli una sede'), 'desktop #role picker should render the CURRENT (overlay) picker, not the stale one');

  elementsById.mob.onclick();
  const mobileModal = elementsById.modal.innerHTML;
  assert.ok(mobileModal.includes('Trasta'), 'BUG 2 regression: mobile #mob picker does not offer Trasta');
  assert.ok(mobileModal.includes('Demo locale: scegli una sede'), 'mobile #mob picker should render the CURRENT (overlay) picker, not the stale one');
  console.log('BUG_2_PICKER_TEST: PASS');

  // Selecting Trasta must resolve to location_id=trasta / location_type=WAREHOUSE,
  // and must not silently degrade Trasta to a STORE.
  vm.runInContext("setRole('Trasta')", sandbox);
  vm.runInContext("go('shortages')", sandbox);
  const trastaView = elementsById.view.innerHTML;
  assert.ok(trastaView.includes('WAREHOUSE'), 'Trasta must resolve to location_type WAREHOUSE in the rendered shortages view');
  assert.ok(!trastaView.includes('>STORE<'), 'BLOCKED_TRASTA_IDENTITY_REGRESSION: Trasta must not render as STORE');

  vm.runInContext('openShortageForm()', sandbox);
  const trastaForm = elementsById.modal.innerHTML;
  assert.ok(trastaForm.includes('Vendita online'), 'Trasta form must offer Vendita online');
  assert.ok(trastaForm.includes('Copertura buco'), 'Trasta form must offer Copertura buco');
  assert.ok(!trastaForm.includes('Vendita a cliente'), 'Trasta form must NOT offer Vendita a cliente');
  console.log('BUG_2_TRASTA_IDENTITY_TEST: PASS');
})();

// --- Regression: permission matrix must be unchanged for other locations ---
(function permissionMatrixRegressionTest() {
  const { sandbox, elementsById } = freshApp();

  vm.runInContext("setRole('5 – Cantore')", sandbox);
  vm.runInContext('openShortageForm()', sandbox);
  let form = elementsById.modal.innerHTML;
  assert.ok(form.includes('Vendita a cliente') && form.includes('Vendita online') && form.includes('Copertura buco'),
    'REGRESSION: Cantore must keep all 3 reasons');

  vm.runInContext("setRole('2 – Malta')", sandbox);
  vm.runInContext('openShortageForm()', sandbox);
  form = elementsById.modal.innerHTML;
  assert.ok(form.includes('Vendita a cliente') && form.includes('Copertura buco'),
    'REGRESSION: Malta must keep Vendita a cliente + Copertura buco');
  assert.ok(!form.includes('Vendita online'), 'REGRESSION: Malta must NOT gain Vendita online');

  const model = sandbox.window.RETE_LOCATION_MODEL;
  assert.strictEqual(model.locations.filter((l) => l.type === 'STORE').length, 6, 'REGRESSION: store count must remain 6');
  assert.strictEqual(model.locations.filter((l) => l.type === 'WAREHOUSE').length, 1, 'REGRESSION: warehouse count must remain 1');
  assert.strictEqual(model.getLocation('trasta').type, 'WAREHOUSE', 'REGRESSION: Trasta must remain WAREHOUSE');
  assert.strictEqual(model.getLocation('malta').type, 'STORE', 'REGRESSION: Malta must remain STORE');
  assert.strictEqual(model.getLocation('cantore').type, 'STORE', 'REGRESSION: Cantore must remain STORE');
  console.log('PERMISSION_MATRIX_REGRESSION_TEST: PASS');
})();

console.log('BROWSER_BINDINGS_TESTS: PASS (14 assertions)');
