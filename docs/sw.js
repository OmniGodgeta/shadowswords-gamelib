/* ShadowSwords Arcade — service worker.
   Shell + assets: cache-first. HTML + small data JSON: network-first with fallback.
   ROMs, BIOS, music, save-states, search.json, cross-origin (EmulatorJS CDN): never touched. */
const CACHE = "ssw-v2.5";
const SHELL = [
  "./", "./index.html", "./assets/app.js", "./assets/style.css",
  "./assets/img/logo.webp", "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
self.addEventListener("message", (e) => { if (e.data === "skip") self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;                       // EmulatorJS CDN etc.
  // large / dynamic / API — never cache
  if (/^\/(roms|music|states|netplay|emulatorjs|thumb|jellyfin|play|twitch|discord|search|request)(\/|$|\?)/.test(u.pathname)) return;
  if (u.pathname.endsWith("search.json")) return;                  // 6 MB, not worth caching

  const isDoc = req.mode === "navigate" || u.pathname.endsWith(".html");
  const isData = u.pathname.includes("/data/");

  if (isDoc || isData) {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req).then((m) => m || caches.match("./index.html")))
    );
    return;
  }
  // assets (app.js, style.css, images, logo): stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((r) => {
        if (r.ok && r.type === "basic") { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
