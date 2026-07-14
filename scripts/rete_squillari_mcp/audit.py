import time, uuid
class MCPAudit:
    def __init__(self): self.events = []
    def append(self, **values):
        event = {"mcp_event_id": "mcp_evt_" + uuid.uuid4().hex, "timestamp": time.time(), **values}; self.events.append(event); return event
