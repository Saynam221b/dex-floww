import test from "node:test";
import assert from "node:assert/strict";
import { consumeRateLimit } from "../../lib/server/rate-limit.ts";

test("rate limiter blocks after threshold", () => {
  const key = `test:${crypto.randomUUID()}`;
  const limit = 3;
  const windowMs = 60_000;

  const first = consumeRateLimit(key, limit, windowMs);
  const second = consumeRateLimit(key, limit, windowMs);
  const third = consumeRateLimit(key, limit, windowMs);
  const fourth = consumeRateLimit(key, limit, windowMs);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, true);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remaining, 0);
});
