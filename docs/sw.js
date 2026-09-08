/* ShadowSwords Arcade — service worker.
   ssw-shell  : app shell + assets, stale-while-revalidate, wiped on version bump
   ssw-data   : data/*.json, network-first, PERSISTS across version bumps (offline browse)
   ssw-ejs    : /emulatorjs/* core files, cache-first, PERSISTS (offline play)
   Never touched: /roms, /music, /states, search.json, cross-origin CDN, dynamic APIs */
const VERSION = "ssw-v2.12";
const SHELL = VERSION, DATA = "ssw-data", EJS_CACHE = "ssw-ejs";
const KEEP = [SHELL, DATA, EJS_CACHE];
const SHELL_FILES = [
  "./", "./index.html", "./assets/app.js", "./assets/style.css",
  "./assets/img/logo.webp", "./manifest.json",
];
const R504 = () => new Response(null, { status: 504, statusText: "offline" });

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});
self.addEventListener("message", (e) => {
  if (e.data === "skip") self.skipWaiting();
  else if (e.data === "clear-ejs") caches.delete(EJS_CACHE);
  else if (e.data === "clear-data") caches.delete(DATA);
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

  // self-hosted EmulatorJS core files — cache-first, refresh in bg
  if (u.pathname.startsWith("/emulatorjs/")) {
    e.respondWith(caches.open(EJS_CACHE).then((c) =>
      c.match(req).then((hit) => {
        const net = fetch(req).then((r) => { if (r.ok && r.status === 200) c.put(req, r.clone()); return r; })
          .catch(() => hit || R504());
        return hit || net;
      })));
    return;
  }
  // large / dynamic / API — never cache, let it hit the network (and fail plainly offline)
  if (/^\/(roms|music|states|netplay|thumb|jellyfin|play|twitch|discord|search|request|auth|admin|banner|u)(\/|$|\?)/.test(u.pathname)) return;
  if (u.pathname.endsWith("search.json")) return;                  // 6 MB, not worth caching

  // data/*.json — network-first, persist in ssw-data so offline browse survives updates
  if (u.pathname.includes("/data/")) {
    e.respondWith(
      fetch(req).then((r) => {
        if (r.ok) { const cp = r.clone(); caches.open(DATA).then((c) => c.put(req, cp)); }
        return r;
      }).catch(() => caches.open(DATA).then((c) => c.match(req)).then((m) => m || R504()))
    );
    return;
  }

  // navigations / html — network-first, fall back to the cached shell
  if (req.mode === "navigate" || u.pathname.endsWith(".html")) {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(SHELL).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req).then((m) => m || caches.match("./index.html")).then((m) => m || R504()))
    );
    return;
  }

  // assets (app.js, css, images, fonts) — stale-while-revalidate, always resolve to a Response
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((r) => {
        if (r.ok && r.type === "basic") { const cp = r.clone(); caches.open(SHELL).then((c) => c.put(req, cp)); }
        return r;
      }).catch(() => cached || R504());
      return cached || net;
    })
  );
});
