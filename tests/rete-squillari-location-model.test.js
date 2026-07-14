const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public/rete-squillari/location-model.js'), 'utf8');
const sandbox = { globalThis: {} };
vm.runInNewContext(source, sandbox);
const model = sandbox.globalThis.RETE_LOCATION_MODEL;

assert.strictEqual(model.locations.filter((x) => x.type === 'STORE').length, 6);
assert.strictEqual(JSON.stringify(model.locations.filter((x) => x.type === 'STORE').map((x) => x.name)), JSON.stringify(['Malta', 'Sestri', 'Cantore', 'Trento', 'De Ferrari', 'Armenia']));
assert.strictEqual(model.getLocation('trasta').type, 'WAREHOUSE');
assert.strictEqual(model.canCreateShortageRequest('cantore', 'ONLINE_SALE'), true);
assert.strictEqual(model.canCreateShortageRequest('malta', 'ONLINE_SALE'), false);
assert.strictEqual(model.canCreateShortageRequest('trasta', 'CUSTOMER_SALE'), false);
assert.strictEqual(model.canCreateShortageRequest('trasta', 'STOCK_GAP'), true);
assert.strictEqual(model.canCreateShortageRequest('unknown', 'STOCK_GAP'), false);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'cantore', reason: 'ONLINE_SALE', product_code: 'SKU-1', product_description: 'Rosato', quantity: 2 }).valid, true);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'malta', reason: 'ONLINE_SALE', product_code: 'SKU-1', product_description: 'Rosato', quantity: 2 }).valid, false);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'trasta', reason: 'STOCK_GAP', product_code: 'SKU-1', product_description: 'Rosato', quantity: 0 }).valid, false);
console.log('LOCATION_MODEL_TESTS: PASS (9 assertions)');
