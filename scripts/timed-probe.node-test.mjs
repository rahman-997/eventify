import test from "node:test";
import assert from "node:assert/strict";
import { timedProbe } from "../src/observability/timed-probe.ts";

function watchTimers(t) {
  const scheduled = t.mock.method(globalThis, "setTimeout");
  const cleared = t.mock.method(globalThis, "clearTimeout");
  return () => {
    assert.equal(scheduled.mock.callCount(), 1);
    assert.equal(cleared.mock.callCount(), 1);
    assert.equal(cleared.mock.calls[0].arguments[0], scheduled.mock.calls[0].result);
  };
}

for (const value of [true, false]) {
  test(`immediate ${value} result clears its deadline`, async (t) => {
    const assertCleared = watchTimers(t);
    const result = await timedProbe(async () => value, 100);
    assert.equal(result.ok, value);
    assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
    assertCleared();
  });
}

test("rejected probe reports unhealthy and clears its deadline", async (t) => {
  const assertCleared = watchTimers(t);
  assert.equal((await timedProbe(async () => { throw new Error("offline"); }, 100)).ok, false);
  assertCleared();
});

test("synchronous probe failure reports unhealthy and clears its deadline", async (t) => {
  const assertCleared = watchTimers(t);
  assert.equal((await timedProbe(() => { throw new Error("offline"); }, 100)).ok, false);
  assertCleared();
});

test("unsettled probe reaches its deadline and reports unhealthy", async (t) => {
  const assertCleared = watchTimers(t);
  const result = await timedProbe(() => new Promise(() => {}), 10);
  assert.equal(result.ok, false);
  assertCleared();
});

test("simultaneous checks do not cancel each other's deadlines", async () => {
  const result = await Promise.all([
    timedProbe(async () => true, 100),
    timedProbe(() => new Promise(() => {}), 10),
    timedProbe(async () => false, 100),
  ]);
  assert.deepEqual(result.map((check) => check.ok), [true, false, false]);
});

test("a rejection after the deadline is handled", async () => {
  let rejectProbe;
  const pending = new Promise((_, reject) => { rejectProbe = reject; });
  assert.equal((await timedProbe(() => pending, 10)).ok, false);
  rejectProbe(new Error("late failure"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("the production default deadline remains 2500 ms", async (t) => {
  const scheduled = t.mock.method(globalThis, "setTimeout");
  const result = await timedProbe(async () => true);
  assert.equal(result.ok, true);
  assert.equal(scheduled.mock.callCount(), 1);
  assert.equal(scheduled.mock.calls[0].arguments[1], 2_500);
});
