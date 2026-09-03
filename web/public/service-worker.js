const SHELL_CACHE = "eventify-shell-v1";
const STATIC_CACHE = "eventify-static-v1";
const MAX_STATIC_CACHE_ENTRIES = 80;
const SHELL_URLS = ["/offline.html", "/manifest.webmanifest", "/icon.svg", "/pwa-install.js", "/pwa-install.css"];

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  const overflow = keys.length - maxEntries;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

async function precacheAppShell() {
  const shellCache = await caches.open(SHELL_CACHE);
  const response = await fetch("/", { cache: "no-cache" });
  if (!response.ok) throw new Error(`Unable to precache Eventify shell (${response.status})`);

  const html = await response.clone().text();
  await shellCache.put("/", response);
  await shellCache.addAll(SHELL_URLS);

  const assetUrls = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1]);
  const uniqueAssets = [...new Set(assetUrls)];
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.all(uniqueAssets.map((url) => staticCache.add(url)));
  await trimCache(staticCache, MAX_STATIC_CACHE_ENTRIES);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put("/", response.clone());
    }
    return response;
  } catch {
    return (await caches.match("/")) ?? (await caches.match("/offline.html"));
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
    await trimCache(cache, MAX_STATIC_CACHE_ENTRIES);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    ["/icon.svg", "/manifest.webmanifest", "/offline.html", "/pwa-install.js", "/pwa-install.css"].includes(url.pathname)
  ) {
    event.respondWith(cacheFirstStatic(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
