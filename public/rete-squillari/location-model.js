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
    return { valid: errors.length === 0, errors: errors };
  }

  root.RETE_LOCATION_MODEL = {
    locations: locations,
    reasons: reasons,
    permissions: permissions,
    canCreateShortageRequest: canCreateShortageRequest,
    validateShortageRequest: validateShortageRequest,
    getLocation: function (id) { return byId[id] || null; }
  };
})(typeof window === 'undefined' ? globalThis : window);
