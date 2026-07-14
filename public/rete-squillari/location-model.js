(function (root) {
  'use strict';

  var locations = [
    { id: 'malta', name: 'Malta', type: 'STORE', active: true },
    { id: 'sestri', name: 'Sestri', type: 'STORE', active: true },
    { id: 'cantore', name: 'Cantore', type: 'STORE', active: true },
    { id: 'trento', name: 'Trento', type: 'STORE', active: true },
    { id: 'de_ferrari', name: 'De Ferrari', type: 'STORE', active: true },
    { id: 'armenia', name: 'Armenia', type: 'STORE', active: true },
    { id: 'trasta', name: 'Trasta', type: 'WAREHOUSE', active: true }
  ];
  var reasons = { CUSTOMER_SALE: 'Vendita a cliente', ONLINE_SALE: 'Vendita online', STOCK_GAP: 'Copertura buco' };
  var priorities = { NORMAL: 'Normale', HIGH: 'Urgente' };
  var statuses = { DA_TROVARE: 'Da trovare', DA_CONFERMARE: 'Da confermare', DA_PREPARARE: 'Da preparare', IN_TRASFERIMENTO: 'In trasferimento', RICEVUTA: 'Ricevuta', CHIUSA: 'Chiusa', ANNULLATA: 'Annullata' };
  var permissions = {
    malta: { CUSTOMER_SALE: true, ONLINE_SALE: false, STOCK_GAP: true },
    sestri: { CUSTOMER_SALE: true, ONLINE_SALE: false, STOCK_GAP: true },
    cantore: { CUSTOMER_SALE: true, ONLINE_SALE: true, STOCK_GAP: true },
    trento: { CUSTOMER_SALE: true, ONLINE_SALE: false, STOCK_GAP: true },
    de_ferrari: { CUSTOMER_SALE: true, ONLINE_SALE: false, STOCK_GAP: true },
    armenia: { CUSTOMER_SALE: true, ONLINE_SALE: false, STOCK_GAP: true },
    trasta: { CUSTOMER_SALE: false, ONLINE_SALE: true, STOCK_GAP: true }
  };
  var byId = locations.reduce(function (out, location) { out[location.id] = location; return out; }, {});

  function canCreateShortageRequest(locationId, reason) {
    return Boolean(byId[locationId] && byId[locationId].active && permissions[locationId] && permissions[locationId][reason] === true);
  }

  function validateShortageRequest(payload) {
    payload = payload || {};
    var location = byId[payload.requester_location_id];
    var quantity = Number(payload.quantity);
    var errors = [];
    if (!location || !location.active) errors.push('Sede richiedente non valida o inattiva');
    if (!canCreateShortageRequest(payload.requester_location_id, payload.reason)) errors.push('Motivo non consentito per la sede richiedente');
    if (!String(payload.product_code || '').trim()) errors.push('Codice prodotto obbligatorio');
    if (!String(payload.product_description || '').trim()) errors.push('Descrizione prodotto obbligatoria');
    if (!Number.isInteger(quantity) || quantity <= 0) errors.push('Quantità richiesta non valida');
    if (!Object.prototype.hasOwnProperty.call(priorities, payload.priority || 'NORMAL')) errors.push('Priorità non valida');
    if (payload.status && !Object.prototype.hasOwnProperty.call(statuses, payload.status)) errors.push('Stato non valido');
    return { valid: errors.length === 0, errors: errors };
  }

  function normalizePriority(value) { return value === undefined || value === '' ? 'NORMAL' : value; }
  function formatPriorityLabel(value) { return priorities[value] || '—'; }
  function buildRequestPrintViewModel(request) {
    return {
      request_number: request.request_number || request.request_id || '—',
      created_at: request.created_at || '—', updated_at: request.updated_at || '—',
      requesting_location: request.requester_location_label || request.requesting_location_label || '—',
      requesting_location_type: request.requester_location_type || request.requesting_location_type || '—',
      product_code: request.product_code || '—', product_description: request.product_description || '—',
      requested_quantity: request.requested_quantity || request.quantity || '—',
      reason: reasons[request.reason] || '—', comment: request.comment || '—',
      priority: formatPriorityLabel(request.priority), status: statuses[request.status] || '—',
      supplier_location: request.supplier_location_label || '—',
      confirmed_quantity: request.confirmed_quantity || '—', expected_transfer_date: request.expected_transfer_date || '—'
    };
  }
  function canPrintTransferLabel(request) {
    return Boolean(request && request.supplier_location_id && request.destination_location_id && Number.isInteger(Number(request.confirmed_quantity)) && Number(request.confirmed_quantity) > 0);
  }
  function buildTransferLabelViewModel(request) {
    if (!canPrintTransferLabel(request)) return null;
    return { request_number: request.request_number || request.request_id || '—', sender: request.supplier_location_label || request.supplier_location_id, sender_type: request.supplier_location_type || '—', destination: request.destination_location_label || request.destination_location_id, destination_type: request.destination_location_type || '—', product_code: request.product_code || '—', product_description: request.product_description || '—', confirmed_quantity: Number(request.confirmed_quantity), reason: reasons[request.reason] || '—', priority: formatPriorityLabel(request.priority), expected_transfer_date: request.expected_transfer_date || '—' };
  }

  root.RETE_LOCATION_MODEL = {
    locations: locations,
    reasons: reasons,
    permissions: permissions,
    priorities: priorities,
    statuses: statuses,
    canCreateShortageRequest: canCreateShortageRequest,
    validateShortageRequest: validateShortageRequest,
    normalizePriority: normalizePriority,
    formatPriorityLabel: formatPriorityLabel,
    buildRequestPrintViewModel: buildRequestPrintViewModel,
    canPrintTransferLabel: canPrintTransferLabel,
    buildTransferLabelViewModel: buildTransferLabelViewModel,
    getLocation: function (id) { return byId[id] || null; }
  };
})(typeof window === 'undefined' ? globalThis : window);
