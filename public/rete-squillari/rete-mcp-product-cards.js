/*
 * "Prodotti mancanti" - real, production-MCP-backed missing-product cards.
 *
 * Strictly read-only. Calls only the same-origin /api/rete-squillari/mcp
 * route (never the MCP server directly, never any token in this file).
 * Controlled by a feature flag (window.RETE_MCP_CARDS_ENABLED) so the full
 * nav entry only appears once explicitly turned on - see Phase 10 of the
 * implementation gate this shipped under.
 */
(function (root) {
  'use strict';

  var STATUS_LABEL = {
    DA_VERIFICARE: 'Da verificare',
    DA_TROVARE: 'Da trovare',
    DA_CONFERMARE: 'Da confermare',
    DA_PREPARARE: 'Da preparare',
    IN_TRASFERIMENTO: 'In trasferimento',
    ARRIVO_PARZIALE: 'Arrivo parziale',
    ARRIVATO_A_TRASTA: 'Arrivato a Trasta',
    RICEVUTA: 'Ricevuta',
    CHIUSA: 'Chiusa',
    STATO_SCONOSCIUTO: 'Stato sconosciuto',
  };

  var CLASSIFICATION_LABEL = {
    TRANSFER_CANDIDATE: 'Candidato trasferimento',
    BUYER_SHORTAGE: 'Ammanco rete (buyer)',
    HIGH_VOLUME_SHORTAGE: 'Ammanco rete alto volume',
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Pure, dependency-free filter predicate - exported separately so it can
  // be unit-tested in Node without any DOM/browser shim.
  function filterCards(cards, f) {
    return cards.filter(function (c) {
      if (f.search) {
        var s = f.search.toLowerCase();
        if (c.productCode.toLowerCase().indexOf(s) === -1 && c.productDescription.toLowerCase().indexOf(s) === -1) return false;
      }
      if (f.location !== 'Tutti' && c.requestingLocationLabel !== f.location) return false;
      if (f.status !== 'Tutte' && c.status !== f.status) return false;
      if (f.classification === 'TRANSFER_CANDIDATES' && c.classification !== 'TRANSFER_CANDIDATE') return false;
      if (f.classification === 'NETWORK_SHORTAGES' && c.classification !== 'BUYER_SHORTAGE' && c.classification !== 'HIGH_VOLUME_SHORTAGE') return false;
      if (f.classification === 'BUYER_PRIORITY' && c.classification !== 'HIGH_VOLUME_SHORTAGE') return false;
      return true;
    });
  }

  function createController(getAccessToken) {
    var state = { status: 'idle', cards: [], error: null, filters: { search: '', location: 'Tutti', status: 'Tutte', classification: 'ALL' } };

    async function fetchCards() {
      state.status = 'loading';
      state.error = null;
      render();
      var token;
      try {
        token = await getAccessToken();
      } catch (e) {
        state.status = 'error';
        state.error = { code: 'NOT_AUTHENTICATED', message: 'Sessione non valida.' };
        render();
        return;
      }
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 10000);
      try {
        var res = await fetch('/api/rete-squillari/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ action: 'list_missing_products' }),
          signal: controller.signal,
        });
        var body = await res.json();
        if (!res.ok || !body.ok) {
          state.status = 'error';
          state.error = { code: (body && body.code) || 'UNKNOWN', message: (body && body.message) || 'Errore nel caricamento dei dati.' };
          render();
          return;
        }
        state.status = 'ready';
        state.cards = body.cards || [];
        render();
      } catch (e) {
        state.status = 'error';
        var isAbort = e && e.name === 'AbortError';
        state.error = { code: isAbort ? 'TIMEOUT' : 'NETWORK', message: isAbort ? 'Il servizio non ha risposto in tempo.' : 'Servizio non disponibile.' };
        render();
      } finally {
        clearTimeout(timer);
      }
    }

    function filteredCards() {
      return filterCards(state.cards, state.filters);
    }

    function card(c) {
      var badgeClass = c.classification === 'HIGH_VOLUME_SHORTAGE' ? 'red' : c.classification === 'BUYER_SHORTAGE' ? 'gold' : '';
      return '<article class="card mcp-product-card">' +
        '<span class="flag">' + esc(STATUS_LABEL[c.status] || c.status) + '</span>' +
        '<h3>' + esc(c.requestingLocationLabel) + '</h3>' +
        '<div class="product">' +
        '<div class="code">CODICE ' + esc(c.productCode) + '</div>' +
        '<strong>' + esc(c.productDescription) + '</strong>' +
        '<div class="qty">Mancanti: <b>' + esc(c.missingQuantity) + '</b> bottiglie<br>' +
        'Offerte: ' + esc(c.offersCount) + ' (' + esc(c.offeredQuantity) + ' offerte, ' + esc(c.approvedQuantity) + ' approvate)' +
        (c.transferStatus ? '<br>Trasferimento: ' + esc(STATUS_LABEL[c.transferStatus] || c.transferStatus) : '') +
        (c.receiptDiscrepancy ? '<br>Discrepanza ricezione: ' + esc(c.receiptDiscrepancy.type) : '') +
        '</div>' +
        '<span class="tag ' + badgeClass + '">' + esc(CLASSIFICATION_LABEL[c.classification] || c.classification) + '</span>' +
        '<div class="muted" style="margin-top:8px">Rif. ' + esc(c.ref) + ' · Ultimo aggiornamento ' + esc((c.lastUpdate || '').slice(0, 10)) + ' · Dati reali (MCP)</div>' +
        '</div></article>';
    }

    function skeleton() {
      var out = '';
      for (var i = 0; i < 4; i++) out += '<div class="card mcp-skeleton"><div class="skel-line" style="width:60%"></div><div class="skel-line" style="width:90%"></div><div class="skel-line" style="width:40%"></div></div>';
      return out;
    }

    function controlsHtml() {
      var locations = [];
      state.cards.forEach(function (c) { if (locations.indexOf(c.requestingLocationLabel) === -1) locations.push(c.requestingLocationLabel); });
      var statuses = [];
      state.cards.forEach(function (c) { if (statuses.indexOf(c.status) === -1) statuses.push(c.status); });
      return '<div class="mcp-controls">' +
        '<input type="text" id="mcp-search" placeholder="Cerca per codice o descrizione" value="' + esc(state.filters.search) + '">' +
        '<select id="mcp-filter-location"><option>Tutti</option>' + locations.map(function (l) { return '<option' + (state.filters.location === l ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>' +
        '<select id="mcp-filter-status"><option>Tutte</option>' + statuses.map(function (s) { return '<option value="' + esc(s) + '"' + (state.filters.status === s ? ' selected' : '') + '>' + esc(STATUS_LABEL[s] || s) + '</option>'; }).join('') + '</select>' +
        '<select id="mcp-filter-classification">' +
        '<option value="ALL"' + (state.filters.classification === 'ALL' ? ' selected' : '') + '>Tutte le classificazioni</option>' +
        '<option value="TRANSFER_CANDIDATES"' + (state.filters.classification === 'TRANSFER_CANDIDATES' ? ' selected' : '') + '>Candidati trasferimento</option>' +
        '<option value="NETWORK_SHORTAGES"' + (state.filters.classification === 'NETWORK_SHORTAGES' ? ' selected' : '') + '>Ammanchi di rete</option>' +
        '<option value="BUYER_PRIORITY"' + (state.filters.classification === 'BUYER_PRIORITY' ? ' selected' : '') + '>Priorità buyer</option>' +
        '</select>' +
        '<button class="secondary" id="mcp-clear-filters">Pulisci filtri</button>' +
        '</div>';
    }

    function render() {
      var host = document.getElementById('mcp-product-cards-root');
      if (!host) return;
      if (state.status === 'idle' || state.status === 'loading') {
        host.innerHTML = '<div class="bar"><h2>Prodotti mancanti</h2></div><div class="grid">' + skeleton() + '</div>';
        return;
      }
      if (state.status === 'error') {
        var isAuthError = state.error.code === 'NOT_AUTHENTICATED' || state.error.code === 'PILOT_NOT_ENABLED' || state.error.code === 'MCP_AUTH_DENIED';
        var isUnavailable = state.error.code === 'MCP_UNREACHABLE' || state.error.code === 'MCP_NOT_CONFIGURED' || state.error.code === 'NETWORK';
        var label = isAuthError ? 'Sessione non valida o accesso non autorizzato.' : isUnavailable ? 'Servizio dati rete non disponibile al momento.' : (state.error.code === 'TIMEOUT' ? 'Il servizio non ha risposto in tempo.' : state.error.message);
        host.innerHTML = '<div class="bar"><h2>Prodotti mancanti</h2></div><div class="empty">' + esc(label) + '<br><button class="secondary" id="mcp-retry" style="margin-top:10px">Riprova</button></div>';
        var retryBtn = document.getElementById('mcp-retry');
        if (retryBtn) retryBtn.onclick = fetchCards;
        return;
      }
      var visible = filteredCards();
      host.innerHTML = '<div class="bar"><h2>Prodotti mancanti</h2></div>' + controlsHtml() +
        (state.cards.length === 0
          ? '<div class="empty">Nessun prodotto mancante al momento. I dati sono reali e aggiornati dal servizio di rete.</div>'
          : (visible.length === 0
              ? '<div class="empty">Nessuna scheda corrisponde ai filtri selezionati.</div>'
              : '<div class="grid mcp-grid">' + visible.map(card).join('') + '</div>'));

      var searchEl = document.getElementById('mcp-search');
      if (searchEl) searchEl.oninput = function (e) { state.filters.search = e.target.value; render(); };
      var locEl = document.getElementById('mcp-filter-location');
      if (locEl) locEl.onchange = function (e) { state.filters.location = e.target.value; render(); };
      var statusEl = document.getElementById('mcp-filter-status');
      if (statusEl) statusEl.onchange = function (e) { state.filters.status = e.target.value; render(); };
      var classEl = document.getElementById('mcp-filter-classification');
      if (classEl) classEl.onchange = function (e) { state.filters.classification = e.target.value; render(); };
      var clearEl = document.getElementById('mcp-clear-filters');
      if (clearEl) clearEl.onclick = function () { state.filters = { search: '', location: 'Tutti', status: 'Tutte', classification: 'ALL' }; render(); };
    }

    return { fetchCards: fetchCards, render: render, getState: function () { return state; } };
  }

  root.RETE_MCP_PRODUCT_CARDS = { create: createController, filterCards: filterCards };
})(typeof window === 'undefined' ? globalThis : window);
