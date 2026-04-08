type WindowEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, WindowEntry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    const next: WindowEntry = {
      count: 1,
      resetAt: now + windowMs,
    };
    buckets.set(key, next);
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: next.resetAt,
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
  };
}

export function pruneRateLimitBuckets(maxSize = 10000): void {
  if (buckets.size <= maxSize) return;
  const now = Date.now();
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) {
      buckets.delete(key);
    }
  }
}
