const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public/rete-squillari/location-model.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public/rete-squillari/index.html'), 'utf8');
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
assert.strictEqual(model.normalizePriority(), 'NORMAL');
assert.strictEqual(model.normalizePriority('NORMAL'), 'NORMAL');
assert.strictEqual(model.normalizePriority('HIGH'), 'HIGH');
assert.strictEqual(model.normalizePriority('STANDARD'), 'STANDARD');
assert.strictEqual(model.formatPriorityLabel('NORMAL'), 'Normale');
assert.strictEqual(model.formatPriorityLabel('HIGH'), 'Urgente');
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'cantore', reason: 'CUSTOMER_SALE', product_code: 'SKU-1', product_description: 'Rosato', quantity: 1, priority: 'NORMAL' }).valid, true);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'cantore', reason: 'CUSTOMER_SALE', product_code: 'SKU-1', product_description: 'Rosato', quantity: 1, priority: 'HIGH' }).valid, true);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'cantore', reason: 'CUSTOMER_SALE', product_code: 'SKU-1', product_description: 'Rosato', quantity: 1, priority: 'STANDARD' }).valid, false);
assert.strictEqual(model.validateShortageRequest({ requester_location_id: 'cantore', reason: 'CUSTOMER_SALE', product_code: 'SKU-1', product_description: 'Rosato', quantity: 1, priority: 'URGENTE' }).valid, false);
const request = { request_number: 'SR-1', created_at: '2026-07-14T05:44:00.000Z', updated_at: '2026-07-14T05:44:00.000Z', requester_location_label: '5 – Cantore', requester_location_type: 'STORE', product_code: 'SKU-1', product_description: 'Rosato', requested_quantity: 2, reason: 'ONLINE_SALE', comment: '', priority: 'HIGH', status: 'DA_TROVARE', supplier_location_label: null, confirmed_quantity: null, expected_transfer_date: null };
const printVm = model.buildRequestPrintViewModel(request);
['request_number', 'created_at', 'updated_at', 'requesting_location', 'requesting_location_type', 'product_code', 'product_description', 'requested_quantity', 'reason', 'comment', 'priority', 'status', 'supplier_location', 'confirmed_quantity', 'expected_transfer_date'].forEach((key) => assert.ok(printVm[key] !== undefined && printVm[key] !== null));
assert.strictEqual(printVm.priority, 'Urgente');
const beforePrint = JSON.stringify(request);
model.buildRequestPrintViewModel(request);
assert.strictEqual(JSON.stringify(request), beforePrint);
assert.strictEqual(model.canPrintTransferLabel(request), false);
assert.strictEqual(model.canPrintTransferLabel({ ...request, supplier_location_id: 'trasta', destination_location_id: 'cantore', confirmed_quantity: 0 }), false);
assert.strictEqual(model.canPrintTransferLabel({ ...request, supplier_location_id: 'trasta', destination_location_id: 'cantore', confirmed_quantity: -1 }), false);
const completeTransfer = { ...request, supplier_location_id: 'trasta', supplier_location_label: 'Trasta', supplier_location_type: 'WAREHOUSE', destination_location_id: 'cantore', destination_location_label: '5 – Cantore', destination_location_type: 'STORE', confirmed_quantity: 2, expected_transfer_date: '2026-07-15' };
model.buildTransferLabelViewModel(completeTransfer);
assert.strictEqual(model.canPrintTransferLabel(completeTransfer), true);
const labelVm = model.buildTransferLabelViewModel(completeTransfer);
['request_number', 'sender', 'sender_type', 'destination', 'destination_type', 'product_code', 'product_description', 'confirmed_quantity', 'reason', 'priority', 'expected_transfer_date'].forEach((key) => assert.ok(labelVm[key] !== undefined && labelVm[key] !== null));
assert.ok(html.includes('DEMO LOCALE'));
assert.ok(html.includes('Data e ora creazione'));
assert.ok(html.includes('Stampa etichetta trasferimento'));
console.log('LOCATION_MODEL_TESTS: PASS (69 assertions)');
