import assert from "node:assert/strict";
import test from "node:test";
import { resolveDemoSeedPolicy } from "./demo-seed-policy.mjs";

test("demo seed is off by default", () => {
  assert.deepEqual(resolveDemoSeedPolicy({}), {
    requested: false,
    production: false,
    productionOverride: false,
    blocked: false,
    shouldRun: false,
  });
});

test("demo seed remains opt-in for development and test", () => {
  assert.equal(resolveDemoSeedPolicy({ NODE_ENV: "development", SEED_DEMO_DATA_ON_START: "true" }).shouldRun, true);
  assert.equal(resolveDemoSeedPolicy({ NODE_ENV: "test", SEED_DEMO_DATA_ON_START: "1" }).shouldRun, true);
});

test("production blocks a single seed opt-in", () => {
  const policy = resolveDemoSeedPolicy({ NODE_ENV: "production", SEED_DEMO_DATA_ON_START: "true" });
  assert.equal(policy.blocked, true);
  assert.equal(policy.shouldRun, false);
});

test("production requires a deliberate second opt-in", () => {
  const policy = resolveDemoSeedPolicy({
    NODE_ENV: "production",
    SEED_DEMO_DATA_ON_START: "yes",
    ALLOW_PRODUCTION_DEMO_SEED: "true",
  });
  assert.equal(policy.blocked, false);
  assert.equal(policy.shouldRun, true);
});

test("truthy parsing is case-insensitive and trims whitespace", () => {
  const policy = resolveDemoSeedPolicy({
    NODE_ENV: " PRODUCTION ",
    SEED_DEMO_DATA_ON_START: " TRUE ",
    ALLOW_PRODUCTION_DEMO_SEED: " YES ",
  });
  assert.equal(policy.shouldRun, true);
});
