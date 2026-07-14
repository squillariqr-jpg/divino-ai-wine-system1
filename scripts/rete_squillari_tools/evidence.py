class EvidenceStore:
    def __init__(self): self.items = {}
    def put(self, item): self.items[item["evidence_id"]] = dict(item); return item["evidence_id"]
    def get(self, evidence_id): return self.items.get(evidence_id)
