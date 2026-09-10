import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script } from "node:vm";

const dist = resolve("dist");
const required = [
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "offline.html",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "pwa-install.js",
  "pwa-install.css",
];

await Promise.all(required.map((file) => access(resolve(dist, file))));

const [html, manifestRaw, worker, installer] = await Promise.all([
  readFile(resolve(dist, "index.html"), "utf8"),
  readFile(resolve(dist, "manifest.webmanifest"), "utf8"),
  readFile(resolve(dist, "service-worker.js"), "utf8"),
  readFile(resolve(dist, "pwa-install.js"), "utf8"),
]);

const manifest = JSON.parse(manifestRaw);
const failures = [];

function findIcon(src, purpose) {
  return Array.isArray(manifest.icons)
    ? manifest.icons.find((icon) => icon?.src === src && String(icon?.purpose ?? "any").split(/\s+/).includes(purpose))
    : undefined;
}

async function readPngSize(file) {
  const data = await readFile(resolve(dist, file));
  const signature = "89504e470d0a1a0a";
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== signature) {
    throw new Error(`${file} is not a valid PNG`);
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

try {
  new Script(worker, { filename: "service-worker.js" });
  new Script(installer, { filename: "pwa-install.js" });
} catch (error) {
  failures.push(`PWA runtime JavaScript must parse: ${error instanceof Error ? error.message : String(error)}`);
}

if (!html.includes('rel="manifest"') || !html.includes("/manifest.webmanifest")) failures.push("index.html must link the web app manifest");
if (!html.includes('rel="apple-touch-icon"') || !html.includes("/apple-touch-icon.png")) failures.push("index.html must expose an Apple touch icon");
if (manifest.name !== "Eventify — Discover & Book Events") failures.push("manifest must expose the Eventify product name");
if (manifest.display !== "standalone") failures.push("manifest display must be standalone");
if (manifest.start_url !== "/" || manifest.scope !== "/") failures.push("manifest start_url and scope must remain root-scoped");
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) failures.push("manifest must include install icons");
if (!findIcon("/icon-192.png", "any")) failures.push("manifest must include a 192x192 PNG icon");
if (!findIcon("/icon-512.png", "any")) failures.push("manifest must include a 512x512 PNG icon");
if (!findIcon("/icon-512.png", "maskable")) failures.push("manifest must include a maskable 512x512 PNG icon");
if (!worker.includes('url.pathname.startsWith("/api/")')) failures.push("service worker must never cache API traffic");
if (!worker.includes('request.headers.has("range")')) failures.push("service worker must bypass Range requests");
if (!worker.includes("MAX_STATIC_CACHE_ENTRIES")) failures.push("service worker must bound runtime static-cache growth");
if (!worker.includes("trimCache")) failures.push("service worker must prune old runtime cache entries");
if (!worker.includes("networkFirstNavigation")) failures.push("service worker must use network-first navigation");
if (!worker.includes("precacheAppShell")) failures.push("service worker must precache the built app shell");

for (const [file, expected] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  try {
    const { width, height } = await readPngSize(file);
    if (width !== expected || height !== expected) failures.push(`${file} must be ${expected}x${expected}, got ${width}x${height}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

if (failures.length > 0) {
  console.error(`PWA verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`PWA verification passed (${required.length} production artifacts, PNG dimensions and runtime scripts verified).`);
