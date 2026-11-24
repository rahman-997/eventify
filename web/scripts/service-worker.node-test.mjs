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
      keys: async () => ["eventify-shell-v1", "eventify-shell-v2", "eventify-static-v2", "eventify-shell-v3", "eventify-static-v3", "eventify-shell-v4", "eventify-static-v4", "other-app-cache", "eventify-user-backups"],
      delete: async (key) => { deleted.push(key); return true; },
    },
  });
  let completion;
  handlers.get("activate")({ waitUntil: (promise) => { completion = promise; } });
  await completion;
  assert.deepEqual(deleted.sort(), ["eventify-shell-v1", "eventify-shell-v2", "eventify-shell-v3", "eventify-static-v2", "eventify-static-v3"]);
  assert.equal(claimed, true);
});

function fetchHarness({ shell = new Map(), assets = new Map(), globalResponse, network } = {}) {
  const handlers = new Map();
  const source = readFileSync(new URL("../public/service-worker.js", import.meta.url), "utf8");
  const shellName = /const SHELL_CACHE = "([^"]+)"/.exec(source)[1];
  const staticName = /const STATIC_CACHE = "([^"]+)"/.exec(source)[1];
  const opened = [];
  const puts = [];
  vm.runInNewContext(source, {
    URL, Response,
    self: { location: { origin: "https://eventify.test" }, addEventListener: (name, handler) => handlers.set(name, handler) },
    fetch: network ?? (async () => { throw new TypeError("offline"); }),
    caches: {
      match: async () => globalResponse,
      open: async (name) => {
        opened.push(name);
        const store = name === shellName ? shell : name === staticName ? assets : new Map();
        return {
          match: async (request) => store.get(typeof request === "string" ? request : new URL(request.url).pathname),
          put: async (request, response) => { puts.push(request); store.set(typeof request === "string" ? request : new URL(request.url).pathname, response); },
          keys: async () => [],
        };
      },
    },
  });
  return {
    opened, puts,
    async request(path, mode = "navigate") {
      let response;
      handlers.get("fetch")({ request: { url: `https://eventify.test${path}`, method: "GET", headers: new Headers(), mode }, respondWith: promise => { response = promise; } });
      return response;
    },
  };
}

test("offline navigation uses Eventify's current shell instead of another application's cached root", async () => {
  const harness = fetchHarness({ shell: new Map([["/", new Response("Eventify shell")]]), globalResponse: new Response("unrelated application") });
  assert.equal(await (await harness.request("/events")).text(), "Eventify shell");
});

test("offline navigation falls back only to Eventify's own offline page", async () => {
  const harness = fetchHarness({ shell: new Map([["/offline.html", new Response("Eventify offline")]]), globalResponse: new Response("stale unrelated shell") });
  assert.equal(await (await harness.request("/events")).text(), "Eventify offline");
});

test("an empty offline cache returns a real unavailable response", async () => {
  const harness = fetchHarness();
  const response = await harness.request("/events");
  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
});

test("static assets come from Eventify's current cache without a global cache lookup", async () => {
  const harness = fetchHarness({ assets: new Map([["/assets/app.js", new Response("current bundle")]]), globalResponse: new Response("old bundle") });
  assert.equal(await (await harness.request("/assets/app.js", "cors")).text(), "current bundle");
});

test("a network asset is fetched when only an unrelated cache contains its URL", async () => {
  let fetched = 0;
  const harness = fetchHarness({ globalResponse: new Response("other bundle"), network: async () => { fetched++; return new Response("fresh bundle"); } });
  assert.equal(await (await harness.request("/assets/app.js", "cors")).text(), "fresh bundle");
  assert.equal(fetched, 1);
});
