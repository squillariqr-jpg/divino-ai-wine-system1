import time, uuid, json, sys

class MCPAudit:
    def __init__(self, sink="memory"):
        self.events = []
        self.sink = sink

    def append(self, **values):
        event = {"mcp_event_id": "mcp_evt_" + uuid.uuid4().hex, "timestamp": time.time(), **values}
        if self.sink == "memory":
            self.events.append(event)
        elif self.sink == "stdout_json":
            try:
                line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                print(line.replace('\n', '\\n'), file=sys.stdout, flush=True)
            except Exception:
                pass
        elif self.sink == "stderr_json":
            try:
                line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                print(line.replace('\n', '\\n'), file=sys.stderr, flush=True)
            except Exception:
                pass
        return event
