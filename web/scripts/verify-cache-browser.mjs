import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.PREVIEW_URL || "http://127.0.0.1:4192";
const out = "artifacts/cache-browser";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const results = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/offline.html`);
  const setup = await page.evaluate(async () => {
    const unrelated = await caches.open("other-app-cache");
    await unrelated.put("/", new Response("UNRELATED ROOT", { headers: { "Content-Type": "text/html" } }));
    await unrelated.put("/assets/isolated-check.js", new Response("UNRELATED BUNDLE"));
    const stale = await caches.open("eventify-shell-v2");
    await stale.put("/", new Response("STALE ROOT"));
    await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    const current = await caches.open("eventify-static-v4");
    await current.put("/assets/isolated-check.js", new Response("CURRENT EVENTIFY BUNDLE"));
    return { keys: await caches.keys(), controlled: !!navigator.serviceWorker.controller };
  });
  assert.ok(setup.controlled);
  assert.ok(setup.keys.includes("other-app-cache"));
  assert.ok(!setup.keys.includes("eventify-shell-v2"));
  results.push({ scenario: "activation preserves unrelated caches and removes obsolete Eventify caches", result: "PASS" });
  assert.equal(await page.evaluate(() => fetch("/assets/isolated-check.js").then(r => r.text())), "CURRENT EVENTIFY BUNDLE");
  results.push({ scenario: "current cache wins over a different application's same-URL asset", result: "PASS" });
  await context.setOffline(true);
  const response = await page.goto(`${base}/events`, { waitUntil: "domcontentloaded" });
  assert.equal(response.status(), 200);
  assert.ok(!(await page.content()).includes("UNRELATED ROOT"));
  assert.ok((await page.locator("title").innerText()).length > 0);
  results.push({ scenario: "cold offline navigation returns the Eventify shell", result: "PASS" });
  await context.close();
} finally {
  await browser.close();
  await writeFile(`${out}/results.json`, JSON.stringify({ results }, null, 2));
}
console.log(`Eventify PWA browser: ${results.length} scenarios passed.`);
