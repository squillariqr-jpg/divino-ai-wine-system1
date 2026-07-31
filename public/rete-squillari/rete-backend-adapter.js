/*
 * Rete Squillari governed backend adapter.
 *
 * Explicit mode selection only. Never falls back from GOVERNED_BACKEND to
 * DEMO_LOCAL, and never falls back from a failed RPC call to a local write.
 * Mode is decided once, from the caller's own rete_memberships row
 * (readable only for the authenticated user's own user_id, per RLS), and is
 * exposed as a constant on the returned actor object.
 *
 * Contract source of truth: supabase/migrations/20260717090000_rete_squillari_pilot_allowlist_enforcement.sql
 */
(function (root) {
  'use strict';

  var MODE = { GOVERNED_BACKEND: 'GOVERNED_BACKEND', DEMO_LOCAL: 'DEMO_LOCAL' };
  var OP_STATE = { IDLE: 'IDLE', SUBMITTING: 'SUBMITTING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', RESULT_UNKNOWN: 'RESULT_UNKNOWN' };

  // Backend enum -> demo display label, matching the existing tag()/reqCard() vocabulary exactly.
  var STATUS_LABEL = {
    DA_VERIFICARE: 'DA VERIFICARE', DA_TROVARE: 'DA TROVARE', DA_CONFERMARE: 'DA CONFERMARE',
    DA_PREPARARE: 'DA PREPARARE', IN_TRASFERIMENTO: 'IN TRASFERIMENTO',
    ARRIVO_PARZIALE_A_TRASTA: 'ARRIVO PARZIALE A TRASTA', ARRIVATO_A_TRASTA: 'ARRIVATO A TRASTA',
    RICEVUTA: 'RICEVUTA', CHIUSA: 'CHIUSA', ANNULLATA: 'ANNULLATA',
    PROPOSTA: 'DICHIARATA', APPROVATA: 'APPROVATA', RITIRATA: 'RITIRATA', RIFIUTATA: 'RIFIUTATA',
    PRONTA: 'PRONTA',
    DATA_REVIEW: 'IN VERIFICA', CONFLICT_REVIEW: 'IN VERIFICA', ARRIVAL_CONFLICT: 'IN VERIFICA'
  };

  function createAdapter(supabaseClient) {
    var actor = null;                 // { userId, role, locationId, locationLabel, pilotEnabled, mode }
    var locationsById = null;         // Map<number, {code, name, label}>
    var idByUuid = new Map();         // sequential local id (number) -> real UUID, per entity kind
    var uuidById = new Map();         // 'kind:localId' -> uuid
    var nextLocalId = 1;
    var pendingOps = new Map();       // 'op:targetKey' -> { key, payloadHash, state }

    function localIdFor(kind, uuid) {
      var mapKey = kind + ':' + uuid;
      if (uuidById.has(mapKey)) return uuidById.get(mapKey);
      var id = nextLocalId++;
      uuidById.set(mapKey, id);
      idByUuid.set(kind + ':' + id, uuid);
      return id;
    }
    function uuidFor(kind, localId) {
      var uuid = idByUuid.get(kind + ':' + localId);
      if (!uuid) throw new AdapterError('UNKNOWN_LOCAL_ID', 'Riferimento scheda non valido. Aggiorna la pagina.');
      return uuid;
    }

    function AdapterErrorCtor(code, userMessage, raw) {
      this.name = 'AdapterError';
      this.code = code;
      this.message = userMessage;
      this.raw = raw || null;
    }
    AdapterErrorCtor.prototype = Object.create(Error.prototype);
    var AdapterError = AdapterErrorCtor;

    // Every backend rejection (auth/role/location/state/quantity) surfaces as
    // one of two generic Postgres messages, by explicit design (no
    // information leak about which specific gate failed). The adapter must
    // not try to reverse-engineer a more specific reason from the message
    // text - it normalizes to one of two user-facing codes and keeps the raw
    // message only for console diagnostics.
    function normalizeRpcError(error) {
      var raw = (error && error.message) || String(error);
      if (/not authenticated/i.test(raw)) {
        return new AdapterError('NOT_AUTHENTICATED', 'Sessione scaduta. Accedi di nuovo.', raw);
      }
      if (/no active membership/i.test(raw)) {
        return new AdapterError('ACCESS_DENIED', 'Accesso non autorizzato per questa identità.', raw);
      }
      if (/operation not permitted/i.test(raw)) {
        return new AdapterError('OPERATION_NOT_PERMITTED', 'Operazione non consentita.', raw);
      }
      if (/idempotency_key is required/i.test(raw)) {
        return new AdapterError('IDEMPOTENCY_KEY_MISSING', 'Errore interno (chiave operazione mancante).', raw);
      }
      // Network-level failure (fetch threw, no structured Postgres error) is
      // treated as RESULT_UNKNOWN by the caller, not as a definite failure.
      return new AdapterError('NETWORK_OR_UNKNOWN', 'Impossibile completare l’operazione. Riprova.', raw);
    }

    function uuidv4() {
      if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
      // RFC4122-ish fallback, only used if crypto.randomUUID is unavailable.
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    function canonicalPayloadKey(opName, targetKey, payload) {
      return opName + '::' + targetKey + '::' + JSON.stringify(payload, Object.keys(payload).sort());
    }

    // Generates or reuses an idempotency key for (opName, targetKey, payload).
    // A NEW key is only ever minted when there is no pending/unknown-result
    // operation for the exact same canonical payload. A RESULT_UNKNOWN retry
    // reuses the same key and the same payload, never a fresh one.
    function claimIdempotencyKey(opName, targetKey, payload) {
      var slotKey = opName + '::' + targetKey;
      var canonical = canonicalPayloadKey(opName, targetKey, payload);
      var existing = pendingOps.get(slotKey);
      if (existing && existing.canonical === canonical &&
          (existing.state === OP_STATE.SUBMITTING || existing.state === OP_STATE.RESULT_UNKNOWN)) {
        return existing;
      }
      var entry = { key: uuidv4(), canonical: canonical, state: OP_STATE.IDLE };
      pendingOps.set(slotKey, entry);
      return entry;
    }

    async function callRpc(opName, targetKey, rpcName, params) {
      var payload = params;
      var entry = claimIdempotencyKey(opName, targetKey, payload);
      entry.state = OP_STATE.SUBMITTING;
      var fullParams = Object.assign({}, params, { p_idempotency_key: entry.key });
      var response;
      try {
        response = await supabaseClient.rpc(rpcName, fullParams);
      } catch (networkErr) {
        // fetch-level failure: result is genuinely unknown server-side.
        entry.state = OP_STATE.RESULT_UNKNOWN;
        throw new AdapterError('RESULT_UNKNOWN', 'Rete non disponibile. Il risultato non è confermato: verifica lo stato prima di riprovare.', String(networkErr));
      }
      if (response.error) {
        var normalized = normalizeRpcError(response.error);
        entry.state = (normalized.code === 'NETWORK_OR_UNKNOWN') ? OP_STATE.RESULT_UNKNOWN : OP_STATE.FAILED;
        throw normalized;
      }
      entry.state = OP_STATE.SUCCEEDED;
      pendingOps.delete(opName + '::' + targetKey);
      return response.data;
    }

    function buildLocationLabel(code, name) {
      return code + ' – ' + name;
    }

    async function loadLocations() {
      var res = await supabaseClient.from('rete_locations').select('id, code, name, active');
      if (res.error) throw normalizeRpcError(res.error);
      var map = new Map();
      (res.data || []).forEach(function (l) {
        map.set(l.id, { code: l.code, name: l.name, label: buildLocationLabel(l.code, l.name), active: l.active });
      });
      locationsById = map;
      return map;
    }

    function locationLabel(locationId) {
      if (locationId == null) return 'Responsabile centrale';
      var l = locationsById && locationsById.get(locationId);
      return l ? l.label : ('Sede #' + locationId);
    }

    async function initialize(session) {
      if (!session || !session.user) {
        throw new AdapterError('NOT_AUTHENTICATED', 'Sessione non valida.', 'no session');
      }
      var memRes = await supabaseClient
        .from('rete_memberships')
        .select('role, location_id, active, pilot_enabled, rete_locations(code, name, active)')
        .eq('user_id', session.user.id)
        .single();
      if (memRes.error || !memRes.data) {
        throw new AdapterError('ACCESS_DENIED', 'Profilo non trovato.', memRes.error && memRes.error.message);
      }
      var m = memRes.data;
      var loc = m.rete_locations;
      var isValidCentral = m.role === 'central' && !loc;
      var isValidStore = m.role === 'store' && loc && loc.active === true;
      // Membership-level `active` is deliberately NOT re-checked here: the
      // "users read own membership" RLS policy already requires active=true
      // for the row to be returned at all (see migration 1). A second
      // client-side check on m.active would be redundant against real
      // Supabase and would wrongly reject any caller/mock whose response
      // shape omits that already-guaranteed field - exactly mirroring the
      // pre-adapter loadSession() validation, which never checked it either.
      if (!(isValidCentral || isValidStore)) {
        throw new AdapterError('ACCESS_DENIED', 'Profilo non valido o disattivato.', 'invalid membership shape');
      }

      // Location label for the caller's OWN membership comes straight out of
      // the already-fetched join (loc.code/loc.name) - no extra network call.
      // The full rete_locations map (locationsById, used to label OTHER
      // parties' requests/offers/transfers in the read model) is only ever
      // needed in GOVERNED_BACKEND mode and is loaded lazily by
      // loadDashboard(), keeping initialize()'s network footprint to exactly
      // one query regardless of mode - identical to the pre-adapter
      // loadSession() footprint.
      var mode = m.pilot_enabled === true ? MODE.GOVERNED_BACKEND : MODE.DEMO_LOCAL;
      actor = {
        userId: session.user.id,
        role: m.role,
        locationId: m.location_id,
        locationLabel: m.role === 'central' ? 'Responsabile centrale' : buildLocationLabel(loc.code, loc.name),
        pilotEnabled: m.pilot_enabled === true,
        mode: mode
      };
      return actor;
    }

    function getCurrentActor() {
      if (!actor) throw new AdapterError('NOT_AUTHENTICATED', 'Adapter non inizializzato.', 'initialize() not called');
      return actor;
    }

    function requireGovernedMode() {
      var a = getCurrentActor();
      if (a.mode !== MODE.GOVERNED_BACKEND) {
        throw new AdapterError('WRONG_MODE', 'Questa identità opera in modalità demo locale, non backend governato.', 'mode=' + a.mode);
      }
      return a;
    }

    function mapRequestRow(row) {
      return {
        id: localIdFor('request', row.id),
        backendId: row.id,
        store: locationLabel(row.requesting_location_id),
        storeLocationId: row.requesting_location_id,
        code: row.product_code,
        name: row.product_description,
        original: row.requested_quantity,
        remaining: row.remaining_quantity,
        status: STATUS_LABEL[row.status] || row.status,
        urgent: row.urgency === 'ALTA',
        rawStatus: row.status,
        source: row.source,
        version: row.version || 0,
        requiresCentralConfirmation: row.requires_central_confirmation === true,
        cancelReason: row.cancel_reason || null,
        score: row.score,
        sourceDocumentDate: row.source_document_date,
        requestReason: row.request_reason || null,
        requestReasonNote: row.request_reason_note || null
      };
    }
    function mapOfferRow(row) {
      return {
        id: localIdFor('offer', row.id),
        backendId: row.id,
        request: localIdFor('request', row.request_id),
        from: locationLabel(row.offering_location_id),
        fromLocationId: row.offering_location_id,
        qty: row.offered_quantity,
        approved: row.approved_quantity || 0,
        status: STATUS_LABEL[row.status] || row.status,
        rawStatus: row.status,
        date: (row.created_at || '').slice(0, 10)
      };
    }
    function mapTransferRow(row) {
      return {
        id: localIdFor('transfer', row.id),
        backendId: row.id,
        request: localIdFor('request', row.request_id),
        offer: row.offer_id ? localIdFor('offer', row.offer_id) : null,
        from: locationLabel(row.from_location_id),
        fromLocationId: row.from_location_id,
        to: locationLabel(row.to_location_id),
        toLocationId: row.to_location_id,
        qty: row.quantity,
        status: STATUS_LABEL[row.status] || row.status,
        rawStatus: row.status,
        date: (row.created_at || '').slice(0, 10),
        receivedQuantity: row.received_quantity,
        discrepancyType: row.discrepancy_type,
        discrepancyAcknowledged: row.discrepancy_acknowledged === true,
        version: row.version || 0
      };
    }

    async function loadDashboard() {
      requireGovernedMode();
      if (!locationsById) await loadLocations();
      var [reqRes, offRes, trRes] = await Promise.all([
        supabaseClient.from('rete_requests').select('*').order('created_at', { ascending: false }),
        supabaseClient.from('rete_offers').select('*').order('created_at', { ascending: false }),
        supabaseClient.from('rete_transfers').select('*').order('created_at', { ascending: false })
      ]);
      if (reqRes.error) throw normalizeRpcError(reqRes.error);
      if (offRes.error) throw normalizeRpcError(offRes.error);
      if (trRes.error) throw normalizeRpcError(trRes.error);
      return {
        requests: reqRes.data.map(mapRequestRow),
        offers: offRes.data.map(mapOfferRow),
        transfers: trRes.data.map(mapTransferRow),
        emails: [],   // no governed equivalent; demo-only email-scavenger feature stays disabled in governed mode
        audit: []     // rete_audit_events is central-only readable; not surfaced in this adapter version
      };
    }

    function mapExcessStockRow(row) {
      return {
        id: localIdFor('excess', row.id),
        backendId: row.id,
        store: locationLabel(row.offering_location_id),
        storeLocationId: row.offering_location_id,
        code: row.product_code,
        ean: row.ean,
        name: row.product_description,
        initialQuantity: row.initial_quantity,
        remainingQuantity: row.remaining_quantity,
        reason: row.reason,
        notes: row.notes,
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        version: row.version || 0
      };
    }
    function mapExcessReservationRow(row) {
      return {
        id: localIdFor('excessReservation', row.id),
        backendId: row.id,
        excessStockId: localIdFor('excess', row.excess_stock_id),
        requestingLocationId: row.requesting_location_id,
        store: locationLabel(row.requesting_location_id),
        qty: row.quantity,
        status: row.status,
        createdAt: row.created_at,
        transferBackendId: row.transfer_id
      };
    }

    async function loadExcessStock() {
      requireGovernedMode();
      if (!locationsById) await loadLocations();
      var [stockRes, resRes] = await Promise.all([
        supabaseClient.from('rete_excess_stock').select('*').order('created_at', { ascending: false }),
        supabaseClient.from('rete_excess_reservations').select('*').order('created_at', { ascending: false })
      ]);
      if (stockRes.error) throw normalizeRpcError(stockRes.error);
      if (resRes.error) throw normalizeRpcError(resRes.error);
      return {
        items: stockRes.data.map(mapExcessStockRow),
        reservations: resRes.data.map(mapExcessReservationRow)
      };
    }

    async function publishExcessStock(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo un negozio può pubblicare un’eccedenza.', 'role=' + a.role);
      var params = {
        p_product_code: input.productCode, p_catalog_product_id: input.catalogProductId,
        p_product_description: input.productDescription, p_quantity: input.quantity, p_reason: input.reason,
        p_catalog_match_method: input.catalogMatchMethod || 'PRODUCT_CODE',
        p_ean: input.ean || null, p_notes: input.notes || null, p_expires_at: input.expiresAt || null
      };
      return callRpc('publishExcessStock', 'loc:' + a.locationId + ':' + input.catalogProductId, 'rete_excess_stock_publish', params);
    }

    async function reserveExcessStock(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo un negozio può prenotare un’eccedenza.', 'role=' + a.role);
      var excessUuid = uuidFor('excess', input.excessStockLocalId);
      var params = { p_excess_stock_id: excessUuid, p_quantity: input.quantity };
      return callRpc('reserveExcessStock', excessUuid, 'rete_excess_stock_reserve', params);
    }

    async function withdrawExcessStock(input) {
      var a = requireGovernedMode();
      var excessUuid = uuidFor('excess', input.excessStockLocalId);
      return callRpc('withdrawExcessStock', excessUuid, 'rete_excess_stock_withdraw', { p_excess_stock_id: excessUuid });
    }

    async function updateExcessStockQuantity(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo il negozio offerente può modificare la quantità.', 'role=' + a.role);
      var excessUuid = uuidFor('excess', input.excessStockLocalId);
      var params = { p_excess_stock_id: excessUuid, p_new_remaining_quantity: input.newRemainingQuantity, p_expected_version: input.expectedVersion };
      return callRpc('updateExcessStockQuantity', excessUuid, 'rete_excess_stock_update_quantity', params);
    }

    async function publishRequest(input) {
      var a = requireGovernedMode();
      if (a.role !== 'central') throw new AdapterError('WRONG_ROLE', 'Solo il responsabile centrale può pubblicare richieste.', 'role=' + a.role);
      var params = {
        p_requesting_location_id: input.locationId,
        p_product_code: input.productCode,
        p_product_description: input.productDescription,
        p_requested_quantity: input.quantity,
        p_urgency: input.urgency || 'NORMALE',
        p_notes: input.notes || null
      };
      return callRpc('publishRequest', 'loc:' + input.locationId + ':' + input.productCode, 'rete_request_publish', params);
    }

    async function createOffer(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo un negozio può offrire disponibilità.', 'role=' + a.role);
      var requestUuid = uuidFor('request', input.requestLocalId);
      var params = { p_request_id: requestUuid, p_offered_quantity: input.quantity };
      return callRpc('createOffer', requestUuid, 'rete_offer_create', params);
    }

    async function withdrawOffer(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo un negozio può ritirare una propria offerta.', 'role=' + a.role);
      var offerUuid = uuidFor('offer', input.offerLocalId);
      return callRpc('withdrawOffer', offerUuid, 'rete_offer_withdraw', { p_offer_id: offerUuid });
    }

    async function approveOffer(input) {
      var a = requireGovernedMode();
      if (a.role !== 'central') throw new AdapterError('WRONG_ROLE', 'Solo il responsabile centrale può approvare offerte.', 'role=' + a.role);
      var offerUuid = uuidFor('offer', input.offerLocalId);
      var params = { p_offer_id: offerUuid, p_approved_quantity: input.approvedQuantity };
      return callRpc('approveOffer', offerUuid, 'rete_offer_approve', params);
    }

    async function rejectOffer(input) {
      var a = requireGovernedMode();
      if (a.role !== 'central') throw new AdapterError('WRONG_ROLE', 'Solo il responsabile centrale può rifiutare offerte.', 'role=' + a.role);
      var offerUuid = uuidFor('offer', input.offerLocalId);
      return callRpc('rejectOffer', offerUuid, 'rete_offer_reject', { p_offer_id: offerUuid });
    }

    async function markTransferReady(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo il negozio mittente può preparare il trasferimento.', 'role=' + a.role);
      var transferUuid = uuidFor('transfer', input.transferLocalId);
      return callRpc('markTransferReady', transferUuid, 'rete_transfer_mark_ready', { p_transfer_id: transferUuid });
    }

    async function markTransferDeparted(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo il negozio mittente può segnare la partenza.', 'role=' + a.role);
      var transferUuid = uuidFor('transfer', input.transferLocalId);
      return callRpc('markTransferDeparted', transferUuid, 'rete_transfer_mark_departed', { p_transfer_id: transferUuid });
    }

    async function receiveTransfer(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo il negozio destinatario può confermare la ricezione.', 'role=' + a.role);
      var transferUuid = uuidFor('transfer', input.transferLocalId);
      var params = {
        p_transfer_id: transferUuid, p_received_quantity: input.receivedQuantity,
        p_anomaly_note: input.anomalyNote || null, p_discrepancy_type: input.discrepancyType || null
      };
      return callRpc('receiveTransfer', transferUuid, 'rete_transfer_receive', params);
    }

    // --- Open-to-offers pilot extension: requesting-store confirmation,
    // manual requests, cancellation, and discrepancy resolution. ---

    async function confirmRequest(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo il negozio richiedente può confermare la propria richiesta.', 'role=' + a.role);
      var requestUuid = uuidFor('request', input.requestLocalId);
      var params = { p_request_id: requestUuid, p_expected_version: input.expectedVersion };
      return callRpc('confirmRequest', requestUuid, 'rete_request_confirm', params);
    }

    async function updateRequestQuantity(input) {
      requireGovernedMode();
      var requestUuid = uuidFor('request', input.requestLocalId);
      var params = { p_request_id: requestUuid, p_new_quantity: input.newQuantity, p_expected_version: input.expectedVersion };
      return callRpc('updateRequestQuantity', requestUuid, 'rete_request_update_quantity', params);
    }

    async function createManualRequest(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo un negozio può creare una richiesta manuale.', 'role=' + a.role);
      var params = {
        p_product_code: input.productCode, p_product_description: input.productDescription,
        p_requested_quantity: input.quantity, p_reason: input.reason || null,
        p_requires_central_confirmation: input.requiresCentralConfirmation || false,
        p_warning_codes: input.warningCodes || [],
        p_request_reason: input.requestReason || null,
        p_request_reason_note: input.requestReasonNote || null
      };
      return callRpc('createManualRequest', 'loc:' + a.locationId + ':' + input.productCode, 'rete_manual_request_create', params);
    }

    async function centralConfirmRequest(input) {
      var a = requireGovernedMode();
      if (a.role !== 'central') throw new AdapterError('WRONG_ROLE', 'Solo il responsabile centrale può confermare la richiesta.', 'role=' + a.role);
      var requestUuid = uuidFor('request', input.requestLocalId);
      return callRpc('centralConfirmRequest', requestUuid, 'rete_request_central_confirm', { p_request_id: requestUuid });
    }

    async function cancelRequest(input) {
      requireGovernedMode();
      var requestUuid = uuidFor('request', input.requestLocalId);
      var params = { p_request_id: requestUuid, p_reason: input.reason || null, p_expected_version: input.expectedVersion };
      return callRpc('cancelRequest', requestUuid, 'rete_request_cancel', params);
    }

    async function markRequestNoLongerNeeded(input) {
      var a = requireGovernedMode();
      if (a.role !== 'store') throw new AdapterError('WRONG_ROLE', 'Solo il negozio richiedente può segnalare che la richiesta non serve più.', 'role=' + a.role);
      var requestUuid = uuidFor('request', input.requestLocalId);
      var params = { p_request_id: requestUuid, p_expected_version: input.expectedVersion };
      return callRpc('markRequestNoLongerNeeded', requestUuid, 'rete_request_mark_no_longer_needed', params);
    }

    async function resolveDiscrepancy(input) {
      var a = requireGovernedMode();
      if (a.role !== 'central') throw new AdapterError('WRONG_ROLE', 'Solo il responsabile centrale può risolvere una discrepanza.', 'role=' + a.role);
      var transferUuid = uuidFor('transfer', input.transferLocalId);
      var params = { p_transfer_id: transferUuid, p_resolution_note: input.resolutionNote };
      return callRpc('resolveDiscrepancy', transferUuid, 'rete_transfer_resolve_discrepancy', params);
    }

    async function recordTrastaArrival(input) {
      var a = requireGovernedMode();
      if (a.role !== 'central') throw new AdapterError('WRONG_ROLE', 'Solo il responsabile centrale può registrare arrivi a Trasta.', 'role=' + a.role);
      var requestUuid = uuidFor('request', input.targetRequestLocalId);
      var params = {
        p_target_request_id: requestUuid, p_product_code: input.productCode,
        p_quantity: input.quantity, p_source_reference: input.sourceReference || null
      };
      return callRpc('recordTrastaArrival', requestUuid + ':' + input.productCode, 'rete_trasta_arrival_record', params);
    }

    async function signOut() {
      actor = null;
      locationsById = null;
      idByUuid.clear();
      uuidById.clear();
      pendingOps.clear();
      return supabaseClient.auth.signOut();
    }

    // Plain RPC calls with no idempotency-key bookkeeping - either
    // read-only (list/count) or naturally idempotent (mark-read,
    // subscription create/revoke, preference upsert already dedupe
    // server-side on their own unique keys), so callRpc's
    // pendingOps/RESULT_UNKNOWN retry machinery does not apply here.
    async function simpleRpc(rpcName, params) {
      var response;
      try {
        response = await supabaseClient.rpc(rpcName, params);
      } catch (networkErr) {
        throw new AdapterError('RESULT_UNKNOWN', 'Rete non disponibile. Riprova.', String(networkErr));
      }
      if (response.error) throw normalizeRpcError(response.error);
      return response.data;
    }

    async function listNotifications(opts) {
      opts = opts || {};
      return simpleRpc('rete_notifications_list', {
        p_limit: opts.limit || 20, p_before: opts.before || null, p_unread_only: !!opts.unreadOnly
      });
    }
    async function unreadNotificationCount() {
      return simpleRpc('rete_notifications_unread_count', {});
    }
    async function markNotificationRead(deliveryId) {
      return simpleRpc('rete_notification_mark_read', { p_delivery_id: deliveryId });
    }
    async function markAllNotificationsRead() {
      return simpleRpc('rete_notifications_mark_all_read', {});
    }
    async function subscribePush(input) {
      return simpleRpc('rete_push_subscription_create', {
        p_endpoint: input.endpoint, p_p256dh: input.p256dh, p_auth_secret: input.authSecret,
        p_user_agent: input.userAgent || null, p_idempotency_key: uuidv4()
      });
    }
    async function unsubscribePush(subscriptionId) {
      return simpleRpc('rete_push_subscription_revoke', { p_subscription_id: subscriptionId });
    }
    async function listPushSubscriptions() {
      return simpleRpc('rete_push_subscriptions_list_own', {});
    }
    async function getNotificationPreferences() {
      return simpleRpc('rete_notification_preferences_get', {});
    }
    async function setNotificationPreferences(input) {
      return simpleRpc('rete_notification_preferences_set', {
        p_event_type: input.eventType, p_web_push_enabled: input.webPushEnabled !== false,
        p_email_digest_enabled: !!input.emailDigestEnabled, p_idempotency_key: uuidv4()
      });
    }

    // Read-only accessor for the UI layer to build a label -> location_id
    // reverse lookup (e.g. the request-publish store picker). Not part of
    // the mutating surface.
    function getLocations() {
      if (!locationsById) return [];
      var out = [];
      locationsById.forEach(function (v, id) { out.push({ id: id, code: v.code, name: v.name, label: v.label, active: v.active }); });
      return out;
    }

    return {
      MODE: MODE, OP_STATE: OP_STATE, AdapterError: AdapterError,
      initialize: initialize, getCurrentActor: getCurrentActor, loadDashboard: loadDashboard,
      getLocations: getLocations,
      publishRequest: publishRequest, createOffer: createOffer, withdrawOffer: withdrawOffer,
      approveOffer: approveOffer, rejectOffer: rejectOffer, markTransferReady: markTransferReady,
      markTransferDeparted: markTransferDeparted, receiveTransfer: receiveTransfer,
      recordTrastaArrival: recordTrastaArrival, signOut: signOut,
      confirmRequest: confirmRequest, updateRequestQuantity: updateRequestQuantity,
      createManualRequest: createManualRequest, centralConfirmRequest: centralConfirmRequest,
      cancelRequest: cancelRequest, markRequestNoLongerNeeded: markRequestNoLongerNeeded,
      resolveDiscrepancy: resolveDiscrepancy,
      loadExcessStock: loadExcessStock, publishExcessStock: publishExcessStock,
      reserveExcessStock: reserveExcessStock, withdrawExcessStock: withdrawExcessStock,
      updateExcessStockQuantity: updateExcessStockQuantity,
      listNotifications: listNotifications, unreadNotificationCount: unreadNotificationCount,
      markNotificationRead: markNotificationRead, markAllNotificationsRead: markAllNotificationsRead,
      subscribePush: subscribePush, unsubscribePush: unsubscribePush, listPushSubscriptions: listPushSubscriptions,
      getNotificationPreferences: getNotificationPreferences, setNotificationPreferences: setNotificationPreferences
    };
  }

  root.RETE_BACKEND_ADAPTER = { create: createAdapter, MODE: MODE, OP_STATE: OP_STATE };
})(typeof window === 'undefined' ? globalThis : window);
