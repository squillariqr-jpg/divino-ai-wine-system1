const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Minimal hand-rolled DOM shim, same approach as rete-squillari-browser-bindings.test.js
// but with a STATEFUL classList (a real Set), since this suite specifically asserts
// modal visibility toggling (#mb gaining/losing the "hidden" class), not just markup.
class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = '';
    this._classes = new Set();
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
      add(...names) { names.forEach((n) => self._classes.add(n)); },
      remove(...names) { names.forEach((n) => self._classes.delete(n)); },
      toggle(name) { self._classes.has(name) ? self._classes.delete(name) : self._classes.add(name); },
      contains(name) { return self._classes.has(name); },
    };
  }
  get className() { return Array.from(this._classes).join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
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
  return { sandbox, elementsById, storageData };
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
  const { sandbox, elementsById, storageData } = buildSandbox();
  vm.runInContext(inlineScripts[0], sandbox, { filename: 'index-script-0.js' });
  vm.runInContext(inlineScripts[1], sandbox, { filename: 'index-script-1.js' });
  vm.runInContext(modelSource, sandbox, { filename: 'location-model.js' });
  vm.runInContext(inlineScripts[2], sandbox, { filename: 'index-script-2-overlay.js' });
  return { sandbox, elementsById, storageData };
}

// --- Global collision guard: the app must not clobber (or rely on) native window.close ---
(function collisionGuardTest() {
  const { sandbox } = freshApp();
  assert.strictEqual(typeof sandbox.window.close, 'undefined',
    'the app must not define a global named "close" (it collides with document.close in inline onclick handlers)');
  assert.strictEqual(typeof sandbox.window.closeModal, 'function',
    'the renamed applicative function closeModal must exist on window');
  console.log('WINDOW_CLOSE_COLLISION_TEST: PASS');
})();

// --- No modal markup should still reference the ambiguous close() name ---
(function noResidualCloseReferenceTest() {
  const { sandbox, elementsById } = freshApp();
  const openers = [
    () => { vm.runInContext("setRole('5 – Cantore')", sandbox); vm.runInContext("go('shortages')", sandbox); vm.runInContext('openShortageForm()', sandbox); },
  ];
  openers.forEach((openFn) => {
    openFn();
    const modalHtml = elementsById.modal.innerHTML;
    assert.ok(!modalHtml.includes('onclick="close()"'), 'modal markup must not contain the ambiguous onclick="close()" (shadowed by document.close in real browsers)');
    assert.ok(modalHtml.includes('onclick="closeModal()"'), 'modal markup must use the unambiguous onclick="closeModal()"');
  });
  const fullSource = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(!fullSource.includes('onclick="close()"'), 'no inline onclick="close()" must remain anywhere in index.html');
  console.log('NO_RESIDUAL_CLOSE_REFERENCE_TEST: PASS');
})();

// --- Modal open / close / reopen lifecycle for "Crea scheda ammanco" ---
(function modalLifecycleTest() {
  const { sandbox, elementsById, storageData } = freshApp();

  // 1. Open
  vm.runInContext("setRole('5 – Cantore')", sandbox);
  vm.runInContext("go('shortages')", sandbox);
  const activeLocationBefore = 'Cantore';
  const dbBefore = JSON.stringify(storageData);
  const requestCountBefore = (JSON.parse(storageData['rete-squillari-v2.db'] || 'null') || {}).shortageRequests
    ? JSON.parse(storageData['rete-squillari-v2.db']).shortageRequests.length : 0;

  vm.runInContext('openShortageForm()', sandbox);
  assert.strictEqual(elementsById.mb.classList.contains('hidden'), false, 'modal must be visible after opening');
  assert.ok(elementsById.modal.innerHTML.includes('Crea scheda ammanco'), 'form must be present after opening');

  // Partially fill fields, exactly like the reported bug scenario, then Cancel.
  vm.runInContext("document.getElementById('sr-code').value='PARTIAL-CODE'", sandbox);
  vm.runInContext("document.getElementById('sr-description').value='Partial description'", sandbox);

  // 2. Close with "Annulla" (invoke the exact function the button is wired to).
  vm.runInContext('closeModal()', sandbox);
  assert.strictEqual(elementsById.mb.classList.contains('hidden'), true, 'BUG regression: modal must be hidden after closeModal()');

  // 3. Non-mutation: nothing must have changed as a side effect of cancelling.
  const dbAfter = JSON.stringify(storageData);
  assert.strictEqual(dbAfter, dbBefore, 'CANCEL must not mutate localStorage');
  const requestCountAfter = (JSON.parse(storageData['rete-squillari-v2.db'] || 'null') || {}).shortageRequests
    ? JSON.parse(storageData['rete-squillari-v2.db']).shortageRequests.length : 0;
  assert.strictEqual(requestCountAfter, requestCountBefore, 'CANCEL must not create a shortage request');
  assert.strictEqual(sandbox.window.RETE_LOCATION_MODEL.getLocation('cantore').type, 'STORE', 'active location identity must be unaffected');

  // 4. Reopen: must work again, with no stale state / no duplicate handlers.
  vm.runInContext('openShortageForm()', sandbox);
  assert.strictEqual(elementsById.mb.classList.contains('hidden'), false, 'modal must be reopenable after a previous cancel');
  assert.ok(!elementsById.modal.innerHTML.includes('PARTIAL-CODE'), 'reopened form must not carry over previously entered (cancelled) values');

  // 5. Second cancel must behave identically (no orphaned overlay, no duplicate toggling bugs).
  vm.runInContext('closeModal()', sandbox);
  assert.strictEqual(elementsById.mb.classList.contains('hidden'), true, 'second cancel must also hide the modal');

  console.log('MODAL_LIFECYCLE_TEST: PASS');
})();

// --- Other modals sharing the same closeModal() handler must not have regressed ---
(function otherModalsRegressionTest() {
  const { sandbox, elementsById } = freshApp();

  vm.runInContext("setRole('5 – Cantore')", sandbox);
  vm.runInContext("go('home')", sandbox);

  // "Ritira richiesta?" confirmation modal (withdrawReq) — offer() modal, generic Annulla.
  vm.runInContext('offer(1)', sandbox);
  assert.strictEqual(elementsById.mb.classList.contains('hidden'), false, 'offer() modal must open');
  assert.ok(elementsById.modal.innerHTML.includes('onclick="closeModal()"'), 'offer() modal must use closeModal()');
  vm.runInContext('closeModal()', sandbox);
  assert.strictEqual(elementsById.mb.classList.contains('hidden'), true, 'offer() modal must close via closeModal()');

  // Reopen once more to confirm no residual/orphan overlay state across different modal types.
  vm.runInContext('offer(1)', sandbox);
  assert.strictEqual(elementsById.mb.classList.contains('hidden'), false, 'offer() modal must be reopenable after another modal type was closed');
  vm.runInContext('closeModal()', sandbox);
  assert.strictEqual(elementsById.mb.classList.contains('hidden'), true, 'final state must be closed, no orphan overlay');

  console.log('OTHER_MODALS_REGRESSION_TEST: PASS');
})();

console.log('MODAL_CLOSE_TESTS: PASS (16 assertions)');
