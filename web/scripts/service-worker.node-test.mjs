import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("worker activation preserves unrelated caches and current offline assets", async () => {
  const handlers = new Map();
  const deleted = [];
  let claimed = false;
  vm.runInNewContext(readFileSync(new URL("../public/service-worker.js", import.meta.url), "utf8"), {
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      keys: async () => ["eventify-shell-v1", "eventify-shell-v2", "eventify-static-v2", "eventify-shell-v3", "eventify-static-v3", "other-app-cache", "eventify-user-backups"],
      delete: async (key) => { deleted.push(key); return true; },
    },
  });
  let completion;
  handlers.get("activate")({ waitUntil: (promise) => { completion = promise; } });
  await completion;
  assert.deepEqual(deleted.sort(), ["eventify-shell-v1", "eventify-shell-v2", "eventify-static-v2"]);
  assert.equal(claimed, true);
});
