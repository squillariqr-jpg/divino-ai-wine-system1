"""One-shot, demo-only gateway worker for strong timeout isolation."""
import json, os, signal, time
from .config import MCPConfig

def _safe_response(value, max_bytes):
    encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > max_bytes: raise ValueError("OVERSIZED_RESPONSE")
    return encoded

def worker_entry(send_conn, payload_bytes, max_request_bytes, max_response_bytes, test_mode=""):
    try:
        if len(payload_bytes) > max_request_bytes: raise ValueError("PAYLOAD_TOO_LARGE")
        payload = json.loads(payload_bytes.decode("utf-8"))
        if not isinstance(payload, dict) or set(payload) != {"tool_name", "tool_arguments", "identity", "correlation_id", "request_id", "source_mode"}: raise ValueError("INVALID_WORKER_REQUEST")
        if payload["source_mode"] != "DEMO" or not isinstance(payload["tool_name"], str) or not isinstance(payload["tool_arguments"], dict) or not isinstance(payload["identity"], dict): raise ValueError("INVALID_WORKER_REQUEST")
        if test_mode == "CRASH": os._exit(17)
        from rete_squillari_tools.gateway import WBOSReadOnlyApplicationGateway
        gateway = WBOSReadOnlyApplicationGateway()
        if test_mode == "SLEEP": time.sleep(10)
        if test_mode == "LATE_MUTATION": gateway.adapter._requests[0]["updated_at"] = "late-worker-mutation"; time.sleep(10)
        if test_mode == "IGNORE_TERMINATE": signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(10)
        response = gateway.run_read_tool(payload["identity"], payload["tool_name"], dict(payload["tool_arguments"]))
        if test_mode == "MALFORMED": send_conn.send_bytes(b"not-json")
        elif test_mode == "OVERSIZED": send_conn.send_bytes(b"x" * (max_response_bytes + 1))
        else: send_conn.send_bytes(_safe_response(response, max_response_bytes))
    except Exception as exc:
        try: send_conn.send_bytes(_safe_response({"worker_error": str(exc) if str(exc) in ("PAYLOAD_TOO_LARGE", "INVALID_WORKER_REQUEST", "OVERSIZED_RESPONSE") else "WORKER_EXECUTION_FAILED"}, max_response_bytes))
        except Exception: pass
    finally:
        try: send_conn.close()
        except Exception: pass
