import json, math

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

def error_response(request_id, code, message, data=None):
    value = {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
    if data is not None:
        value["error"]["data"] = data
    return value

def validate_request(request, max_bytes):
    try:
        encoded = json.dumps(request, allow_nan=False, separators=(",", ":")).encode()
    except (TypeError, ValueError, UnicodeEncodeError):
        return "INVALID_REQUEST"
    if len(encoded) > max_bytes:
        return "PAYLOAD_TOO_LARGE"
    if not isinstance(request, dict): return "INVALID_REQUEST"
    if request.get("jsonrpc") != "2.0": return "INVALID_REQUEST"
    if "id" not in request or isinstance(request.get("id"), (dict, list, bool)) or request.get("id") is None: return "INVALID_REQUEST"
    if not isinstance(request.get("method"), str) or not request["method"]: return "INVALID_REQUEST"
    if "params" in request and not isinstance(request["params"], (dict, list)): return "INVALID_REQUEST"
    return None

def validate_notification(request, max_bytes):
    try: json.dumps(request, allow_nan=False, separators=(",", ":")).encode()
    except (TypeError, ValueError, UnicodeEncodeError): return "INVALID_REQUEST"
    if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str): return "INVALID_REQUEST"
    if "id" in request: return "INVALID_REQUEST"
    if "params" in request and not isinstance(request["params"], (dict, list)): return "INVALID_REQUEST"
    return None

def decode_json(raw, max_bytes):
    if not raw: return None, "EMPTY_BODY"
    if len(raw) > max_bytes: return None, "PAYLOAD_TOO_LARGE"
    try: return json.loads(raw.decode("utf-8")), None
    except UnicodeDecodeError: return None, "INVALID_UTF8"
    except (json.JSONDecodeError, ValueError): return None, "PARSE_ERROR"
