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
assert.strictEqual(model.canCreateShortageRequest(undefined, 'STOCK_GAP'), false);
assert.strictEqual(model.canCreateShortageRequest('malta', 'UNKNOWN_REASON'), false);
assert.strictEqual(model.canCreateShortageRequest('malta', undefined), false);
assert.strictEqual(model.canCreateShortageRequest('trasta', 'CUSTOMER_SALE'), false);
assert.strictEqual(model.canCreateShortageRequest('trasta', 'ONLINE_SALE'), true);
assert.strictEqual(model.canCreateShortageRequest('trasta', 'STOCK_GAP'), true);
const expected = {
  malta: [true, false, true], sestri: [true, false, true], cantore: [true, true, true],
  trento: [true, false, true], de_ferrari: [true, false, true], armenia: [true, false, true],
  trasta: [false, true, true]
};
for (const location of model.locations) {
  ['CUSTOMER_SALE', 'ONLINE_SALE', 'STOCK_GAP'].forEach((reason, index) => {
    assert.strictEqual(model.canCreateShortageRequest(location.id, reason), expected[location.id][index]);
  });
}
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'cantore', reason: 'ONLINE_SALE', product_code: 'SKU-1', product_description: 'Rosato', quantity: 2 }).valid, true);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'malta', reason: 'ONLINE_SALE', product_code: 'SKU-1', product_description: 'Rosato', quantity: 2 }).valid, false);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'trasta', reason: 'STOCK_GAP', product_code: 'SKU-1', product_description: 'Rosato', quantity: 0 }).valid, false);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'cantore', reason: 'CUSTOMER_SALE', product_code: '', product_description: 'Rosato', quantity: 1 }).valid, false);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'cantore', reason: 'CUSTOMER_SALE', product_code: 'SKU-1', product_description: '', quantity: 1 }).valid, false);
console.log('LOCATION_MODEL_TESTS: PASS (36 assertions)');
