export interface CacheItem<T> {
  value: T;
  expiresAt: number;
  size: number;
}

export class TtlLruCache<T> {
  private readonly map = new Map<string, CacheItem<T>>();
  private readonly maxItems: number;
  private readonly maxItemSize: number;

  constructor(maxItems: number, maxItemSize: number) {
    this.maxItems = maxItems;
    this.maxItemSize = maxItemSize;
  }

  get(key: string, now = Date.now()): T | null {
    const item = this.map.get(key);
    if (!item) return null;

    if (item.expiresAt <= now) {
      this.map.delete(key);
      return null;
    }

    // LRU touch
    this.map.delete(key);
    this.map.set(key, item);
    return item.value;
  }

  set(key: string, value: T, ttlMs: number, sizeHint: number, now = Date.now()): void {
    if (sizeHint > this.maxItemSize) return;

    const item: CacheItem<T> = {
      value,
      expiresAt: now + ttlMs,
      size: sizeHint,
    };

    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, item);
    this.evict(now);
  }

  private evict(now: number): void {
    // Remove expired first.
    for (const [key, item] of this.map.entries()) {
      if (item.expiresAt <= now) {
        this.map.delete(key);
      }
    }

    while (this.map.size > this.maxItems) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.map.delete(oldestKey);
    }
  }

  size(): number {
    return this.map.size;
  }
}
