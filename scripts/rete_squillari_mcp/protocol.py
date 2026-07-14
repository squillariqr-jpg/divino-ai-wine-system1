import json

TOOLS_LIST = None
def validate_request(request, max_bytes=32768):
    if len(json.dumps(request, separators=(",", ":")).encode()) > max_bytes: return "PAYLOAD_TOO_LARGE"
    if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str): return "INVALID_PROTOCOL"
    if "id" in request and not isinstance(request["id"], (str, int, type(None))): return "INVALID_PROTOCOL"
    return None
def error_response(request_id, code, message, data=None):
    result = {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
    if data: result["error"]["data"] = data
    return result
