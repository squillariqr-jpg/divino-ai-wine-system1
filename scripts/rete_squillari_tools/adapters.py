from copy import deepcopy
from .contracts import CAPABILITIES

LOCATIONS = [
    {"id": "malta", "name": "Malta", "type": "STORE", "active": True},
    {"id": "sestri", "name": "Sestri", "type": "STORE", "active": True},
    {"id": "cantore", "name": "Cantore", "type": "STORE", "active": True},
    {"id": "trento", "name": "Trento", "type": "STORE", "active": True},
    {"id": "de_ferrari", "name": "De Ferrari", "type": "STORE", "active": True},
    {"id": "armenia", "name": "Armenia", "type": "STORE", "active": True},
    {"id": "trasta", "name": "Trasta", "type": "WAREHOUSE", "active": True},
]
PERMISSIONS = {"malta": ["CUSTOMER_SALE", "STOCK_GAP"], "sestri": ["CUSTOMER_SALE", "STOCK_GAP"], "cantore": ["CUSTOMER_SALE", "ONLINE_SALE", "STOCK_GAP"], "trento": ["CUSTOMER_SALE", "STOCK_GAP"], "de_ferrari": ["CUSTOMER_SALE", "STOCK_GAP"], "armenia": ["CUSTOMER_SALE", "STOCK_GAP"], "trasta": ["ONLINE_SALE", "STOCK_GAP"]}
REQUESTS = [{"request_number": "DEMO-001", "requester_location_id": "de_ferrari", "requester_location_type": "STORE", "product_code": "2101208", "product_description": "Erbaluce DOCG Rolletto", "requested_quantity": 6, "reason": "CUSTOMER_SALE", "comment": "", "priority": "HIGH", "status": "DA_TROVARE", "created_at": "2026-07-14T00:00:00.000Z", "updated_at": "2026-07-14T00:00:00.000Z", "supplier_location_id": None, "confirmed_quantity": None, "expected_transfer_date": None}]

class DemoInMemoryReadOnlyAdapter:
    source_mode = "DEMO"
    def __init__(self): self._requests = deepcopy(REQUESTS)
    def _location(self, location_id): return next((deepcopy(x) for x in LOCATIONS if x["id"] == location_id), None)
    def list_locations(self):
        result = []
        for location in LOCATIONS:
            item = deepcopy(location); item["allowed_reasons"] = list(PERMISSIONS[location["id"]]); result.append(item)
        return result
    def get_location(self, location_id): return self._location(location_id)
    def get_allowed_reasons(self, location_id):
        if not self._location(location_id): return None
        return {"location_id": location_id, "reasons": list(PERMISSIONS[location_id])}
    def list_shortage_requests(self, filters):
        values = deepcopy(self._requests)
        for key in ("requester_location_id", "status", "reason"):
            if filters.get(key): values = [x for x in values if x.get(key) == filters[key]]
        limit = filters.get("limit", 100); return {"requests": values[:limit], "next_cursor": None}
    def get_shortage_request(self, request_id): return next((deepcopy(x) for x in self._requests if x["request_number"] == request_id), None)
    def validate_shortage_request(self, payload):
        errors = []; location = self._location(payload.get("requester_location_id")); quantity = payload.get("quantity")
        if not location: errors.append("UNKNOWN_LOCATION")
        if payload.get("reason") not in (PERMISSIONS.get(payload.get("requester_location_id"), [])): errors.append("UNAUTHORIZED_REASON")
        if not isinstance(payload.get("product_code"), str) or not payload["product_code"].strip(): errors.append("MISSING_PRODUCT_CODE")
        if not isinstance(payload.get("product_description"), str) or not payload["product_description"].strip(): errors.append("MISSING_PRODUCT_DESCRIPTION")
        if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity <= 0: errors.append("INVALID_QUANTITY")
        if payload.get("priority", "NORMAL") not in ("NORMAL", "HIGH"): errors.append("INVALID_PRIORITY")
        normalized = deepcopy(payload); normalized["priority"] = payload.get("priority", "NORMAL")
        if location: normalized["requester_location_type"] = location["type"]
        return {"valid": not errors, "reason_codes": errors, "normalized_payload": normalized}
    def preview_request_print(self, request_id):
        request = self.get_shortage_request(request_id)
        if not request: return None
        return {"request_number": request["request_number"], "created_at": request["created_at"], "updated_at": request["updated_at"], "requesting_location": request["requester_location_id"], "requesting_location_type": request["requester_location_type"], "product_code": request["product_code"], "product_description": request["product_description"], "requested_quantity": request["requested_quantity"], "reason": request["reason"], "comment": request["comment"] or "—", "priority": request["priority"], "status": request["status"], "supplier_location": request["supplier_location_id"] or "—", "confirmed_quantity": request["confirmed_quantity"] or "—", "expected_transfer_date": request["expected_transfer_date"] or "—"}
    def preview_transfer_label(self, request_id):
        request = self.get_shortage_request(request_id)
        if not request: return None
        eligible = bool(request["supplier_location_id"] and request["confirmed_quantity"] and request["confirmed_quantity"] > 0 and request.get("destination_location_id"))
        return {"eligible": eligible, "reason_codes": [] if eligible else ["TRANSFER_DATA_INCOMPLETE"], "label_view_model": deepcopy(request) if eligible else None}
