import assert from "node:assert/strict";
import test from "node:test";
import { timedProbe } from "../src/observability/timed-probe.ts";

test("successful and negative probes clear their deadline", async (t) => {
  const clear = t.mock.method(globalThis, "clearTimeout");
  for (const ok of [true, false]) {
    const result = await timedProbe(async () => ok);
    assert.equal(result.ok, ok);
    assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
  }
  assert.equal(clear.mock.callCount(), 2);
  assert.ok(clear.mock.calls.every(({ arguments: args }) => args[0] !== undefined));
});

test("rejected and synchronously throwing probes fail closed and clear their deadline", async (t) => {
  const clear = t.mock.method(globalThis, "clearTimeout");
  assert.equal((await timedProbe(async () => { throw new Error("rejected"); })).ok, false);
  assert.equal((await timedProbe(() => { throw new Error("sync"); })).ok, false);
  assert.equal(clear.mock.callCount(), 2);
});

test("a hung probe returns false when its deadline elapses", async (t) => {
  const clear = t.mock.method(globalThis, "clearTimeout");
  const result = await timedProbe(() => new Promise(() => {}), 10);
  assert.equal(result.ok, false);
  assert.ok(Number.isFinite(result.latencyMs));
  assert.equal(clear.mock.callCount(), 1);
});
