import test from "node:test";
import assert from "node:assert/strict";
import { TtlLruCache } from "../../lib/server/ttl-lru-cache.ts";

test("ttl-lru cache enforces max entries and LRU order", () => {
  const cache = new TtlLruCache<string>(2, 1024);

  cache.set("a", "A", 60_000, 10);
  cache.set("b", "B", 60_000, 10);
  assert.equal(cache.get("a"), "A");

  cache.set("c", "C", 60_000, 10);

  assert.equal(cache.get("a"), "A");
  assert.equal(cache.get("b"), null);
  assert.equal(cache.get("c"), "C");
});

test("ttl-lru cache expires entries", () => {
  const cache = new TtlLruCache<string>(2, 1024);
  const now = Date.now();

  cache.set("x", "X", 5, 10, now);
  assert.equal(cache.get("x", now + 1), "X");
  assert.equal(cache.get("x", now + 10), null);
});
