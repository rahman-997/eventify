import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script } from "node:vm";

const dist = resolve("dist");
const required = ["index.html", "manifest.webmanifest", "service-worker.js", "offline.html", "icon.svg", "pwa-install.js", "pwa-install.css"];

await Promise.all(required.map((file) => access(resolve(dist, file))));

const [html, manifestRaw, worker, installer] = await Promise.all([
  readFile(resolve(dist, "index.html"), "utf8"),
  readFile(resolve(dist, "manifest.webmanifest"), "utf8"),
  readFile(resolve(dist, "service-worker.js"), "utf8"),
  readFile(resolve(dist, "pwa-install.js"), "utf8"),
]);

const manifest = JSON.parse(manifestRaw);
const failures = [];

try {
  new Script(worker, { filename: "service-worker.js" });
  new Script(installer, { filename: "pwa-install.js" });
} catch (error) {
  failures.push(`PWA runtime JavaScript must parse: ${error instanceof Error ? error.message : String(error)}`);
}

if (!html.includes('rel="manifest"') || !html.includes("/manifest.webmanifest")) failures.push("index.html must link the web app manifest");
if (manifest.name !== "Eventify — Discover & Book Events") failures.push("manifest must expose the Eventify product name");
if (manifest.display !== "standalone") failures.push("manifest display must be standalone");
if (manifest.start_url !== "/" || manifest.scope !== "/") failures.push("manifest start_url and scope must remain root-scoped");
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) failures.push("manifest must include an install icon");
if (!worker.includes('url.pathname.startsWith("/api/")')) failures.push("service worker must never cache API traffic");
if (!worker.includes('request.headers.has("range")')) failures.push("service worker must bypass Range requests");
if (!worker.includes("MAX_STATIC_CACHE_ENTRIES")) failures.push("service worker must bound runtime static-cache growth");
if (!worker.includes("trimCache")) failures.push("service worker must prune old runtime cache entries");
if (!worker.includes("networkFirstNavigation")) failures.push("service worker must use network-first navigation");
if (!worker.includes("precacheAppShell")) failures.push("service worker must precache the built app shell");

if (failures.length > 0) {
  console.error(`PWA verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`PWA verification passed (${required.length} production artifacts, runtime scripts parsed).`);
