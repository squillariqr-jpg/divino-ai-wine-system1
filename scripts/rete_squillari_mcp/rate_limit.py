import time
class RateLimiter:
    def __init__(self, limit): self.limit, self.buckets = limit, {}
    def allow(self, key):
        now = time.time(); bucket = self.buckets.setdefault(key, []); bucket[:] = [x for x in bucket if x > now - 60]
        if len(bucket) >= self.limit: return False
        bucket.append(now); return True
