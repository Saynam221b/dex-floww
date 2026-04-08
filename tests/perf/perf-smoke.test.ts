import test from "node:test";
import assert from "node:assert/strict";
import { runPerfSmoke } from "../../scripts/perf-smoke.ts";

test("perf smoke budgets hold", () => {
  const report = runPerfSmoke();
  assert.equal(report.summaries.length, 5);
  assert.equal(report.passed, true, report.failures.join("\n"));
});
