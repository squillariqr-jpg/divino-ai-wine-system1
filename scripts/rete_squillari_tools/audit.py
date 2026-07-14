from datetime import datetime, timezone
class AuditStore:
    def __init__(self): self.events = []
    def append(self, event): self.events.append(dict(event)); return event["event_id"]
    def get(self, event_id): return next((x for x in self.events if x["event_id"] == event_id), None)
    def last(self): return self.events[-1] if self.events else None
    @staticmethod
    def timestamp(): return datetime.now(timezone.utc).isoformat()
