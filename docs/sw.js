/* ShadowSwords Arcade — service worker.
   Shell + assets: stale-while-revalidate.  HTML + small data JSON: network-first.
   /emulatorjs/* (self-host EJS proxy): cached in a separate persistent bucket so
   a console you've played once still runs with no network.
   ROMs, BIOS, music, save-states, search.json, cross-origin CDN: never touched. */
const CACHE = "ssw-v2.10";
const EJS_CACHE = "ssw-ejs";        // persists across version bumps; managed from the Offline page
const KEEP = [CACHE, EJS_CACHE];
const SHELL = [
  "./", "./index.html", "./assets/app.js", "./assets/style.css",
  "./assets/img/logo.webp", "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
self.addEventListener("message", (e) => {
  if (e.data === "skip") self.skipWaiting();
  else if (e.data === "clear-ejs") caches.delete(EJS_CACHE);
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;                       // EmulatorJS CDN etc.

  // self-hosted EmulatorJS core files: cache-first, populate as you play, refresh in bg
  if (u.pathname.startsWith("/emulatorjs/")) {
    e.respondWith(caches.open(EJS_CACHE).then((c) =>
      c.match(req).then((hit) => {
        const net = fetch(req).then((r) => { if (r.ok && r.status === 200) c.put(req, r.clone()); return r; })
          .catch(() => hit);
        return hit || net;
      })));
    return;
  }
  // large / dynamic / API — never cache
  if (/^\/(roms|music|states|netplay|thumb|jellyfin|play|twitch|discord|search|request|auth)(\/|$|\?)/.test(u.pathname)) return;
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
