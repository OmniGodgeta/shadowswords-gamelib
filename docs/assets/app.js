"use strict";

/* ========================================================================
   shadowswords arcade
   ======================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "dataset") Object.assign(n.dataset, v);
    else if (k === "style" && typeof v === "string") n.setAttribute("style", v);
    else n[k] = v;
  }
  for (const k of kids) if (k != null && k !== false) n.append(k);
  return n;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
let _toastT;
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = el("div", { id: "toast" }); document.body.append(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---- config --------------------------------------------------------- */
const TS = "https://shadow-1.tail51f9d6.ts.net";
const SELF_HOSTED = location.hostname.endsWith(".ts.net");
const IN_APP = /ShadowSwordsApp/.test(navigator.userAgent);   // native wrapper intercepts _blank → phone browser
const extTarget = { target: "_blank", rel: "noopener" };      // keep the signal the app hooks on
const ROM_BASE = SELF_HOSTED ? "/roms/" : TS + "/roms/";       // needs Funnel when off-tailnet
const MUSIC_BASE = SELF_HOSTED ? "/music/" : TS + "/music/";
const MOVIES_URL = TS + ":8443/";                               // opens in a new tab
const EMU_DATA = "https://cdn.emulatorjs.org/stable/data/";
const STATE_BASE = SELF_HOSTED ? "/states/" : TS + "/states/";   // cloud save-states
const NETPLAY_URL = TS + ":8712/";                                // EmulatorJS netplay signalling (tailnet)
const ROM_CACHE_CAP = 1610612736;                                 // 1.5 GiB IndexedDB budget
const ROM_CACHE_MAX_ITEM = 805306368;                             // don't cache a single file bigger than 768 MiB
const YT_CHANNEL = "https://www.youtube.com/@shadowswordsttv";
const SOCIALS = [
  ["Facebook", "https://www.facebook.com/ShadowSwordsQc", "f", "#1877f2"],
  ["Instagram", "https://www.instagram.com/1shadowswords/", "◎", "#e1306c"],
  ["YouTube", "https://www.youtube.com/@shadowswordsttv", "▶", "#ff0000"],
  ["TikTok", "https://www.tiktok.com/@1shadowswords", "♪", "#25f4ee"],
  ["X", "https://x.com/XEricChalifoux", "𝕏", "#ffffff"],
  ["Rumble", "https://rumble.com/c/c-7883882", "▲", "#85c742"],
];
const DISCORD = "https://discord.gg/QnMc35rUdB";
const PAGE = 90;
const COLLAGE_SYSTEMS = ["atari2600", "archimedes", "3do", "wii", "xbox", "gba", "psx", "gc"];

const view = $("#view");
const state = { sys: null, systems: {}, cache: {}, search: null, render: 0 };

/* ---- local prefs: favorites + recently played --------------------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem("ssw:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ssw:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const favList = () => LS.get("favs", []);
const isFav = (sys, id) => favList().some((f) => f.sys === sys && f.id === id);
function toggleFav(g) {
  const l = favList();
  const i = l.findIndex((f) => f.sys === g._sys && f.id === g.id);
  if (i >= 0) l.splice(i, 1);
  else l.unshift({ sys: g._sys, id: g.id, name: g.name, img: g.img || null,
    file: g.file || null, year: g.year || null, genre: g.genre || null });
  LS.set("favs", l.slice(0, 400));
  window.dispatchEvent(new Event("ssw-favs"));
  return i < 0;
}
const recentList = () => LS.get("recent", []);
function pushRecent(sys, file, name, img) {
  const l = recentList().filter((r) => !(r.sys === sys && r.file === file));
  l.unshift({ sys, file, name, img: img || null, t: Date.now() });
  LS.set("recent", l.slice(0, 24));
}

/* ---- data ---------------------------------------------------------- */
async function getSystems() {
  if (!state.sys) {
    state.sys = await fetch("data/systems.json").then((r) => r.json());
    for (const s of state.sys.systems) state.systems[s.id] = s;
    $("#footcount").textContent =
      `${state.sys.total.toLocaleString()} games · ${state.sys.systems.length} systems`;
  }
  return state.sys;
}
async function getSystem(id) {
  if (!state.cache[id]) {
    state.cache[id] = await fetch(`data/${id}.json`).then((r) => r.json());
    for (const g of state.cache[id]) g._sys = id;
  }
  return state.cache[id];
}
async function getSearch() {
  if (!state.search) state.search = await fetch("data/search.json").then((r) => r.json());
  return state.search;
}
const meta = (id) => state.systems[id] || { id, name: id };
const sysName = (id) => meta(id).name;
// hero art fallback for a system: hardware photo, else white wordmark
const sysArt = (m) => m.photo
  ? el("img", { src: m.photo, alt: m.name, style: "object-fit:contain;padding:6%" })
  : (m.logo ? el("img", { src: m.logo, alt: m.name, className: "console-logo", style: "object-fit:contain;padding:12%;width:auto;max-width:70%;max-height:55%" }) : null);

/* ---- components --------------------------------------------------- */
function collage(imgs) {
  const c = el("div", { className: "collage" });
  imgs.slice(0, 24).forEach((src) => c.append(el("img", { src, loading: "lazy", alt: "" })));
  return c;
}
async function collageArt(n = 20) {
  const picks = [];
  for (const id of COLLAGE_SYSTEMS) {
    try { for (const g of await getSystem(id)) if (g.img) picks.push(g.img); } catch { /**/ }
    if (picks.length > n * 3) break;
  }
  for (let i = picks.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[picks[i], picks[j]] = [picks[j], picks[i]]; }
  return picks.length ? collage(picks.slice(0, n)) : null;
}

function hero({ kicker, title, desc, meta: metaLine, art, actions = [] }) {
  const artBox = el("div", { className: "hero-art" });
  if (art) artBox.append(art);
  return el("section", { className: "hero" }, artBox,
    el("div", { className: "hero-body" },
      kicker && el("p", { className: "hero-kicker", textContent: kicker }),
      el("h1", { className: "hero-title", textContent: title }),
      desc && el("p", { className: "hero-desc", textContent: desc }),
      el("div", { className: "hero-actions" },
        ...actions.map((a) => el("a", {
          className: "btn " + (a.primary ? "btn-primary" : "btn-ghost"),
          href: a.href || "javascript:void 0",
          target: a.blank ? "_blank" : null, rel: a.blank ? "noopener" : null,
          onclick: a.onClick || null, textContent: a.label,
        }))),
      metaLine && el("p", { className: "hero-meta", textContent: metaLine })));
}

function shelf({ title, count, moreHref, tiles }) {
  const track = el("div", { className: "shelf-track" }, ...tiles);
  const scroll = (d) => track.scrollBy({ left: d * track.clientWidth * 0.85, behavior: "smooth" });
  return el("section", { className: "shelf" },
    el("div", { className: "shelf-head" },
      el("h2", { textContent: title }),
      count != null && el("span", { className: "count", textContent: count.toLocaleString() }),
      moreHref && el("a", { href: moreHref, textContent: "See all ›" })),
    track,
    el("button", { className: "shelf-nav prev", ariaLabel: "left", textContent: "‹", onclick: () => scroll(-1) }),
    el("button", { className: "shelf-nav next", ariaLabel: "right", textContent: "›", onclick: () => scroll(1) }));
}

function consoleTile(s, { play = false } = {}) {
  const art = el("div", { className: "tile-art console" });
  if (s.photo) art.append(el("img", { className: "console-photo", src: s.photo, loading: "lazy", alt: s.name }));
  else if (s.logo) art.append(el("img", { className: "console-logo", src: s.logo, loading: "lazy", alt: s.name }));
  else art.append(el("div", { className: "ph", textContent: s.name }));
  if (play && s.playable) art.append(el("span", { className: "badge", textContent: "Play" }));
  return el("a", { className: "tile", href: play ? `#/play/${s.id}` : `#/s/${s.id}` },
    art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: s.name }),
      el("div", { className: "s", textContent: `${s.count.toLocaleString()} games` })));
}

function heartBtn(g) {
  const b = el("button", { className: "heart" + (isFav(g._sys, g.id) ? " on" : ""),
    title: "Favorite", ariaLabel: "Favorite", textContent: "♥" });
  b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.toggle("on", toggleFav(g)); };
  return b;
}
function gameTile(g, { play = false } = {}) {
  const art = el("div", { className: "tile-art" });
  if (g.img) art.append(el("img", { src: g.img, loading: "lazy", alt: g.name }));
  else art.append(el("div", { className: "ph", textContent: g.name }));
  if (play) art.append(el("span", { className: "badge", textContent: "Play" }));
  if (g.id) art.append(heartBtn(g));
  const href = play ? `#/play/${g._sys}/${g.file.split("/").map(encodeURIComponent).join("/")}`
    : `#/g/${g._sys}/${g.id}`;
  return el("a", { className: "tile wide", href },
    art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: g.name }),
      el("div", { className: "s", textContent: [g.year, g.genre].filter(Boolean).join(" · ") || (play ? sysName(g._sys) : "") })));
}

const spinner = () => view.replaceChildren(el("div", { className: "spinner", textContent: "Loading…" }));

function tileGrid(container, list, shown, opts = {}) {
  const grid = el("div", { className: "tile-grid" });
  list.slice(0, shown).forEach((g) => grid.append(gameTile(g, opts)));
  const parts = [grid];
  if (list.length > shown) parts.push(el("button", {
    className: "more",
    textContent: `Show more · ${(list.length - shown).toLocaleString()} left`,
    onclick: () => tileGrid(container, list, shown + PAGE, opts),
  }));
  else if (!list.length) { parts.length = 0; parts.push(el("div", { className: "empty-state", textContent: "Nothing here." })); }
  container.replaceChildren(...parts);
}

/* ---- routes: browse --------------------------------------------- */
async function routeHome() {
  const token = ++state.render;
  spinner();
  await getSystems();
  if (token !== state.render) return;
  const { systems, total } = state.sys;
  const playable = systems.filter((s) => s.playable).sort((a, b) => b.count - a.count);

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "shadowswords arcade",
    title: "Every console. Every game.",
    desc: `${total.toLocaleString()} games across ${systems.length} systems — browse the lot, play ${playable.length} of them right in your browser, and stream the movie library.`,
    art: await collageArt(22),
    actions: [
      { label: "▶ Play now", href: "#/play", primary: true },
      { label: "🎲 Surprise me", href: "#/play/random" },
      { label: "Browse all", href: "#/browse" },
    ],
  }));
  if (token !== state.render) return;

  const recent = recentList();
  if (recent.length) frag.append(shelf({
    title: "Continue playing", count: recent.length,
    tiles: recent.map((r) => {
      const art = el("div", { className: "tile-art" });
      if (r.img) art.append(el("img", { src: r.img, loading: "lazy", alt: r.name }));
      else art.append(el("div", { className: "ph", textContent: r.name }));
      art.append(el("span", { className: "badge", textContent: "Resume" }));
      return el("a", { className: "tile wide",
        href: `#/resume/${r.sys}/${r.file.split("/").map(encodeURIComponent).join("/")}` }, art,
        el("div", { className: "tile-cap" },
          el("div", { className: "t", textContent: r.name }),
          el("div", { className: "s", textContent: sysName(r.sys) })));
    }),
  }));
  const favs = favList();
  if (favs.length) frag.append(shelf({
    title: "Favorites", count: favs.length, moreHref: "#/favorites",
    tiles: favs.slice(0, 24).map((f) => favTile(f)),
  }));

  frag.append(shelf({
    title: "Play now", count: playable.length, moreHref: "#/play",
    tiles: playable.slice(0, 24).map((s) => consoleTile(s, { play: true })),
  }));
  const withLogo = systems.filter((s) => s.logo);
  const rest = systems.filter((s) => !s.logo);
  frag.append(shelf({
    title: "All consoles", count: systems.length, moreHref: "#/browse",
    tiles: [...withLogo, ...rest].map((s) => consoleTile(s)),
  }));
  const linkTile = (href, emoji, title, sub) => el("a", { className: "tile", href },
    el("div", { className: "tile-art console" }, el("div", { className: "ph", textContent: `${emoji}  ${title}` })),
    el("div", { className: "tile-cap" }, el("div", { className: "t", textContent: title }),
      el("div", { className: "s", textContent: sub })));
  frag.append(el("div", { className: "shelf" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "More" })),
    el("div", { className: "shelf-track" },
      linkTile("#/movies", "🎬", "Movies", "Jellyfin library"),
      linkTile("#/music", "🎧", "Music", "Albums on the server"),
      linkTile("#/videos", "▶", "Videos", "Latest YouTube uploads"),
      linkTile("#/contact", "📡", "Contact", "Socials & Discord"),
      linkTile("#/favorites", "♥", "Favorites", "Your starred games"),
      linkTile("#/saves", "☁", "Cloud saves", "Resume on any device"),
      linkTile("#/cache", "💾", "Offline", "Install & ROM cache"))));
  view.replaceChildren(frag);
}

async function routeBrowse() {
  ++state.render;
  await getSystems();
  const q = el("input", { type: "search", placeholder: "Filter consoles…" });
  const grid = el("div", { className: "tile-grid" });
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    grid.replaceChildren(...state.sys.systems
      .filter((s) => !t || s.name.toLowerCase().includes(t) || s.id.includes(t))
      .map((s) => consoleTile(s)));
  };
  q.oninput = debounce(draw, 120);
  view.replaceChildren(el("div", { className: "wrap" },
    el("section", { className: "shelf", style: "padding:24px 0 0" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: "All consoles" }),
        el("span", { className: "count", textContent: `${state.sys.systems.length}` })),
      el("div", { className: "grid-tools", style: "padding:0" }, q),
      grid)));
  draw();
}

async function routeSystem(id) {
  const token = ++state.render;
  spinner();
  await getSystems();
  const games = await getSystem(id).catch(() => []);
  if (token !== state.render) return;
  const m = meta(id);
  const genres = [...new Set(games.map((g) => g.genre).filter(Boolean))].sort();
  const arty = games.filter((g) => g.img).slice(0, 20).map((g) => g.img);

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "Console", title: m.name,
    desc: `${games.length.toLocaleString()} games${m.withArt ? `, ${m.withArt} with box art` : ""}${m.playable ? " · playable in your browser" : ""}.`,
    art: arty.length ? collage(arty) : sysArt(m),
    actions: m.playable ? [{ label: "▶ Play these", href: `#/play/${id}`, primary: true }] : [],
  }));

  const fText = el("input", { type: "search", placeholder: "Filter titles…" });
  const fGenre = el("select", {}, el("option", { value: "", textContent: "All genres" }),
    ...genres.map((x) => el("option", { value: x, textContent: x })));
  const fSort = el("select", {},
    el("option", { value: "name", textContent: "A–Z" }), el("option", { value: "-name", textContent: "Z–A" }),
    el("option", { value: "-year", textContent: "Newest" }), el("option", { value: "art", textContent: "Box art first" }));
  frag.append(el("div", { className: "grid-tools" }, fText, fGenre, fSort));
  const box = el("div", {});
  frag.append(box);
  view.replaceChildren(frag);

  const apply = () => {
    const q = fText.value.trim().toLowerCase(), gv = fGenre.value;
    let list = games.filter((g) => (!q || g.name.toLowerCase().includes(q)) && (!gv || g.genre === gv));
    const cmp = {
      "name": (a, b) => a.name.localeCompare(b.name), "-name": (a, b) => b.name.localeCompare(a.name),
      "-year": (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name),
      "art": (a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.name.localeCompare(b.name),
    }[fSort.value];
    tileGrid(box, [...list].sort(cmp), PAGE);
  };
  fText.oninput = debounce(apply, 150);
  fGenre.onchange = fSort.onchange = apply;
  apply();
}

async function routeGame(sysId, gid) {
  const token = ++state.render;
  spinner();
  await getSystems();
  const games = await getSystem(sysId).catch(() => []);
  const g = games.find((x) => x.id === gid);
  if (token !== state.render) return;
  if (!g) { location.hash = `#/s/${sysId}`; return; }
  const m = meta(sysId);

  const actions = [];
  if (m.playable) actions.push({ label: "▶ Play", primary: true,
    href: `#/play/${sysId}/${g.file.split("/").map(encodeURIComponent).join("/")}` });
  actions.push({ label: `All ${m.name}`, href: `#/s/${sysId}` });

  view.replaceChildren(hero({
    kicker: [m.name, g.year].filter(Boolean).join(" · "),
    title: g.name,
    desc: g.desc || "No description scraped for this title.",
    meta: [g.developer && `Dev: ${g.developer}`, g.publisher && `Pub: ${g.publisher}`,
      g.players && `${g.players} players`].filter(Boolean).join("   ·   "),
    art: g.img ? el("img", { src: g.img, alt: g.name })
      : (games.filter((x) => x.img).length ? collage(games.filter((x) => x.img).slice(0, 16).map((x) => x.img))
        : sysArt(m)),
    actions,
  }));
}

/* ---- routes: play --------------------------------------------- */
function dropzone() {
  const drop = el("label", { className: "drop", htmlFor: "rom-input" },
    el("input", { id: "rom-input", type: "file", accept: ".nes,.sfc,.smc,.fig,.gb,.gbc,.gba,.n64,.z64,.md,.gen,.smd,.sms,.gg,.pce,.a26,.a78,.lnx,.ws,.wsc,.col,.vb,.zip,.bin,.iso,.cue,.chd" }),
    el("div", {}, el("strong", { textContent: "Drop a ROM here" }), " or click — plays locally, never uploaded."));
  const input = drop.querySelector("input");
  input.onchange = () => input.files[0] && startUpload(input.files[0]);
  ["dragover", "dragenter"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, () => drop.classList.remove("hot")));
  drop.addEventListener("drop", (ev) => { ev.preventDefault(); ev.dataTransfer.files[0] && startUpload(ev.dataTransfer.files[0]); });
  return drop;
}

async function routePlay() {
  const token = ++state.render;
  spinner();
  await getSystems();
  if (token !== state.render) return;
  const playable = state.sys.systems.filter((s) => s.playable).sort((a, b) => b.count - a.count);
  const total = playable.reduce((n, s) => n + s.count, 0);

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "Play",
    title: "Play in your browser",
    desc: `${total.toLocaleString()} games across ${playable.length} systems, emulated right here. Pick a console below, or drop in a ROM from your device.`,
    art: null,
    actions: [{ label: "Pick a ROM file", primary: true, onClick: () => $("#rom-input")?.click() }],
  }));
  frag.append(el("div", { className: "wrap", style: "padding-bottom:6px" }, dropzone()));
  frag.append(el("div", { className: "shelf" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Playable consoles" }),
      el("span", { className: "count", textContent: `${playable.length}` })),
    el("div", { className: "tile-grid", style: "padding:0" },
      ...playable.map((s) => consoleTile(s, { play: true })))));
  view.replaceChildren(frag);
}

async function routePlaySystem(id) {
  const token = ++state.render;
  spinner();
  await getSystems();
  const m = meta(id);
  if (!m.playable) { location.hash = `#/s/${id}`; return; }
  const games = await getSystem(id).catch(() => []);
  if (token !== state.render) return;

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "Play", title: m.name,
    desc: `${games.length.toLocaleString()} games, ready to run. Streamed from the home server — pick one.`,
    art: sysArt(m),
    actions: [
      { label: "🎲 Random game", primary: true, onClick: () => surpriseMe(id) },
      { label: "Or upload a ROM", onClick: () => $("#rom-input")?.click() },
    ],
  }));
  frag.append(el("div", { className: "wrap", style: "padding-bottom:6px" }, dropzone()));
  const NOTE = {
    cps1: "Arcade emulation needs romsets that match EmulatorJS's exact FBNeo build. Many current CPS romsets show a “missing files for THIS VERSION” error — that's the romset, not a bug.",
    cps2: "Arcade emulation needs romsets that match EmulatorJS's exact FBNeo build. Many current CPS romsets show a “missing files for THIS VERSION” error — that's the romset, not a bug.",
    mame: "Arcade emulation needs romsets that match the mame2003-plus (0.78) set. Newer romsets won't load.",
    neogeo: "Neo Geo needs a matching FBNeo romset + neogeo.zip BIOS. Hit-or-miss.",
    amiga: "Amiga (PUAE) is experimental in EmulatorJS and often won't boot — WHDLoad/ADF quirks.",
    satellaview: "Satellaview .bs files load via the BS-X BIOS; some titles still drop to the emulator menu.",
  }[id];
  if (NOTE) frag.append(el("div", { className: "note" }, el("b", { textContent: "Heads up: " }), NOTE));
  const fText = el("input", { type: "search", placeholder: "Filter titles…" });
  frag.append(el("div", { className: "grid-tools" }, fText));
  const box = el("div", {});
  frag.append(box);
  view.replaceChildren(frag);

  const apply = () => {
    const q = fText.value.trim().toLowerCase();
    tileGrid(box, games.filter((g) => !q || g.name.toLowerCase().includes(q)), PAGE, { play: true });
  };
  fText.oninput = debounce(apply, 150);
  apply();
}

// --- IndexedDB: "rom" = uploaded-ROM stash (survives player reload);
//                "romcache" = downloaded catalog ROMs, LRU-capped, so a replay is instant.
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("ssw-arcade", 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("rom")) db.createObjectStore("rom");
      if (!db.objectStoreNames.contains("romcache")) db.createObjectStore("romcache");
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const idbTx = (store, mode) => idb().then((db) => db.transaction(store, mode).objectStore(store));
const idbPutIn = (store, k, v) => idbTx(store, "readwrite").then((os) => new Promise((res, rej) => { const q = os.put(v, k); q.onsuccess = res; q.onerror = () => rej(q.error); }));
const idbGetIn = (store, k) => idbTx(store, "readonly").then((os) => new Promise((res, rej) => { const q = os.get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
const idbDelIn = (store, k) => idbTx(store, "readwrite").then((os) => new Promise((res, rej) => { const q = os.delete(k); q.onsuccess = res; q.onerror = () => rej(q.error); }));
const idbPut = (k, v) => idbPutIn("rom", k, v);
const idbGet = (k) => idbGetIn("rom", k);

async function romCacheEntries() {
  const os = await idbTx("romcache", "readonly");
  return new Promise((res) => {
    const out = [];
    os.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) { out.push({ key: c.key, size: c.value.size, t: c.value.t }); c.continue(); }
      else res(out);
    };
  });
}
async function romCacheStats() {
  const e = await romCacheEntries().catch(() => []);
  return { count: e.length, bytes: e.reduce((n, x) => n + (x.size || 0), 0) };
}
async function romCacheClear() {
  const os = await idbTx("romcache", "readwrite");
  return new Promise((res) => { const q = os.clear(); q.onsuccess = res; q.onerror = res; });
}
async function romCacheEvict(need) {
  let items = (await romCacheEntries().catch(() => [])).sort((a, b) => a.t - b.t);
  let total = items.reduce((n, x) => n + x.size, 0);
  while (total + need > ROM_CACHE_CAP && items.length) {
    const v = items.shift();
    await idbDelIn("romcache", v.key).catch(() => {});
    total -= v.size;
  }
}
// fetch a ROM, using the IndexedDB cache; onProgress(got,total,fromCache)
async function fetchRom(key, url, onProgress) {
  const hit = await idbGetIn("romcache", key).catch(() => null);
  if (hit && hit.blob) {
    idbPutIn("romcache", key, { ...hit, t: Date.now() }).catch(() => {});
    onProgress && onProgress(hit.size, hit.size, true);
    return URL.createObjectURL(hit.blob);
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const total = +resp.headers.get("content-length") || 0;
  let blob;
  if (resp.body && resp.body.getReader) {
    const reader = resp.body.getReader();
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress && onProgress(got, total, false);
    }
    blob = new Blob(chunks);
  } else {
    blob = await resp.blob();
    onProgress && onProgress(blob.size, blob.size, false);
  }
  if (blob.size <= ROM_CACHE_MAX_ITEM) {
    try { await romCacheEvict(blob.size); await idbPutIn("romcache", key, { blob, size: blob.size, t: Date.now() }); } catch { /* quota */ }
  }
  return URL.createObjectURL(blob);
}
const fmtBytes = (n) => !n ? "0 KB"
  : n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB"
  : n >= 1048576 ? Math.round(n / 1048576) + " MB"
  : Math.max(1, Math.round(n / 1024)) + " KB";

// file extension -> EmulatorJS system (EJS_core) for uploaded ROMs
const EXT_CORE = {
  nes: "nes", fds: "nes", unf: "nes", sfc: "snes", smc: "snes", fig: "snes",
  bs: "snes", swc: "snes",
  gb: "gb", gbc: "gb", gba: "gba", srl: "gba", n64: "n64", z64: "n64", v64: "n64",
  md: "segaMD", gen: "segaMD", smd: "segaMD", sms: "segaMS", "32x": "sega32x",
  gg: "segaGG", sg: "segaMS", pce: "pce", sgx: "pce", a26: "atari2600", a52: "atari5200",
  a78: "atari7800", lnx: "lynx", j64: "jaguar", jag: "jaguar", ws: "ws", wsc: "ws",
  ngp: "ngp", ngc: "ngp", vb: "vb", col: "coleco", "int": "coleco",
  d64: "c64", t64: "c64", crt: "c64", prg: "c64",
  iso: "psx", cue: "psx", chd: "psx", pbp: "psx", bin: "psx", zip: "arcade",
};
async function startUpload(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const core = EXT_CORE[ext];
  if (!core) { alert("Unsupported ROM type: ." + ext); return; }
  await idbPut("upload", { name: file.name, core, blob: file });
  location.hash = `#/play/upload/${encodeURIComponent(file.name)}`;
}

const stateKey = (sys, file) => STATE_BASE + encodeURIComponent(sys) + "/" + file.split("/").map(encodeURIComponent).join("/");

async function routePlayGame(sys, romParam, resume = false) {
  ++state.render;
  if (window.__emuUp) { location.reload(); return; }
  window.__emuUp = true;
  await getSystems().catch(() => {});

  const loadEl = el("div", { className: "player-load", id: "player-load" }, "Booting emulator…");
  const saveBtn = el("button", { className: "pbtn", id: "cloud-save", textContent: "☁ Save", title: "Save state to the server", hidden: true });
  const loadBtn = el("button", { className: "pbtn", id: "cloud-load", textContent: "☁ Load", title: "Load the last server save state", hidden: true });
  const shell = el("div", { className: "player" },
    el("div", { className: "player-bar" },
      el("button", { className: "exit", textContent: "‹ Exit", onclick: exitPlayer }),
      el("div", { className: "title", id: "player-title", textContent: "Loading…" }),
      saveBtn, loadBtn),
    el("div", { className: "player-stage" },
      el("div", { id: "game" }), loadEl));
  document.body.append(shell);
  view.replaceChildren();

  const file = sys === "upload" ? null : romParam;
  let romUrl, romName, core;
  try {
    if (sys === "upload") {
      const u = await idbGet("upload");
      if (!u) throw 0;
      romUrl = URL.createObjectURL(u.blob); romName = u.name.replace(/\.[^.]+$/, ""); core = u.core;
    } else {
      romName = file.split("/").pop().replace(/\.[^.]+$/, "");
      core = meta(sys).core || EXT_CORE[file.split(".").pop().toLowerCase()];
      if (!core) throw 0;
      const url = ROM_BASE + "rom/" + encodeURIComponent(sys) + "/" + file.split("/").map(encodeURIComponent).join("/");
      const cacheKey = sys + "/" + file;
      const bar = el("div", { className: "dl-bar" }, el("i"));
      loadEl.replaceChildren(el("div", { textContent: "Downloading ROM…" }), bar);
      romUrl = await fetchRom(cacheKey, url, (got, tot, cached) => {
        if (cached) { loadEl.replaceChildren("Loaded from cache — booting…"); return; }
        bar.firstChild.style.width = tot ? (got / tot * 100).toFixed(1) + "%" : "40%";
        bar.previousSibling.textContent = tot
          ? `Downloading ROM… ${fmtBytes(got)} / ${fmtBytes(tot)}` : `Downloading ROM… ${fmtBytes(got)}`;
      });
      loadEl.replaceChildren("Booting emulator…");
    }
  } catch {
    loadEl.textContent = "Couldn't load that ROM — go back and try another.";
    return;
  }
  $("#player-title").textContent = romName;
  const g = { _sys: sys, id: null, name: romName, file, img: null };
  const gm = sys !== "upload" && (state.cache[sys] || []).find((x) => x.file === file);
  if (sys !== "upload") pushRecent(sys, file, romName, gm && gm.img);

  window.EJS_player = "#game";
  window.EJS_core = core;
  window.EJS_gameUrl = romUrl;
  window.EJS_gameName = romName;
  window.EJS_pathtodata = EMU_DATA;
  window.EJS_startOnLoaded = true;
  const bios = sys !== "upload" && meta(sys).bios;
  if (bios) window.EJS_biosUrl = ROM_BASE + "bios/" + encodeURIComponent(bios);
  window.EJS_Buttons = { restart: true, settings: true, fullscreen: true, saveState: true, loadState: true, gamepad: true };
  // Netplay signalling server — tailnet default; override with localStorage ssw:netplay ("off" disables).
  const np = LS.get("netplay", NETPLAY_URL);
  if (np && np !== "off") { window.EJS_netplayServer = np; window.EJS_Buttons.netplay = true; }

  // cloud save-states — the stable EmulatorJS build has no onSaveState hook, so
  // we drive it ourselves via gameManager.getState()/loadState() + our own buttons.
  const key = sys === "upload" ? null : stateKey(sys, file);
  let hasCloudSave = false;
  if (key && resume) {
    try { hasCloudSave = (await fetch(key, { method: "HEAD" })).ok; } catch { /* offline */ }
  }
  const cloudSave = async () => {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm) return;
    try {
      const data = gm.getState();
      await fetch(key, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: data });
      toast("Saved to the server ☁");
    } catch { toast("Cloud save failed"); }
  };
  const cloudLoad = async () => {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm) return;
    try {
      const buf = await fetch(key).then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); });
      gm.loadState(new Uint8Array(buf));
      toast("Server save state loaded");
    } catch { toast("No server save state for this game"); }
  };

  window.EJS_onGameStart = () => {
    $("#player-load")?.remove();
    if (key) {
      saveBtn.hidden = false; saveBtn.onclick = cloudSave;
      loadBtn.hidden = false; loadBtn.onclick = cloudLoad;
      if (hasCloudSave) setTimeout(cloudLoad, 400);
    }
  };

  const s = el("script", { src: EMU_DATA + "loader.js" });
  s.onerror = () => { const l = $("#player-load"); if (l) l.textContent = "Emulator failed to load (CDN blocked?)."; };
  document.body.append(s);
}
function exitPlayer() { window.__emuUp = false; location.hash = "#/play"; location.reload(); }

/* ---- routes: movies + search --------------------------------- */
function routeMovies() {
  ++state.render;
  const host = (() => { try { return new URL(MOVIES_URL).host; } catch { return MOVIES_URL; } })();
  view.replaceChildren(el("section", { className: "pane" },
    el("div", { className: "big-emoji", textContent: "🎬" }),
    el("h1", { textContent: "Movie library" }),
    el("p", { textContent: "The full film & TV collection, streamed from the home server" + (IN_APP ? " — sign in with the shared account." : ". Opens the Jellyfin player in a new tab — sign in with the shared account.") }),
    el("a", { className: "btn btn-primary", href: MOVIES_URL, ...extTarget, textContent: IN_APP ? "Open the movie library" : "Open the movie library ↗" }),
    el("div", { className: "hint" }, "Jellyfin at ", el("code", { textContent: host }),
      " — if it doesn't load, the server may be off or you're not on the tailnet.")));
}

/* ---- routes: music ------------------------------------------- */
let audioEl = null, curAlbum = null;
async function routeMusic(albumIdx) {
  const token = ++state.render;
  spinner();
  const data = await fetch(MUSIC_BASE + "index.json").then((r) => r.json()).catch(() => null);
  if (token !== state.render) return;
  if (!data || !data.albums.length) {
    view.replaceChildren(el("section", { className: "pane center" },
      el("div", { className: "big-emoji", textContent: "🎧" }),
      el("h1", { textContent: "Music" }),
      el("p", { textContent: "No music on the server yet — drop albums into the Music folder and they'll show up here." }),
      el("div", { className: "hint" }, "Served from ", el("code", { textContent: new URL(MUSIC_BASE, location.href).host }))));
    return;
  }
  const idx = Math.min(Math.max(0, albumIdx | 0), data.albums.length - 1);
  const album = data.albums[idx];

  if (!audioEl) audioEl = $("#player-audio");
  const npTitle = el("div", { className: "np-title" });
  const nowPlaying = el("div", { className: "now-playing" }, npTitle, audioEl);
  audioEl.hidden = false; audioEl.controls = true;

  const trackList = el("div", { className: "track-list" });
  const renderTracks = (alb) => {
    trackList.replaceChildren(...alb.tracks.map((t, i) =>
      el("div", { className: "track", tabIndex: 0, dataset: { file: t.file },
        onkeydown: (e) => { if (e.key === "Enter") playTrack(alb, i); },
        onclick: () => playTrack(alb, i) },
        el("span", { className: "num", textContent: String(i + 1).padStart(2, "0") }),
        el("span", { textContent: t.title }))));
  };
  const playTrack = (alb, i) => {
    curAlbum = alb;
    const t = alb.tracks[i];
    audioEl.src = MUSIC_BASE + "file/" + t.file.split("/").map(encodeURIComponent).join("/");
    audioEl.play().catch(() => {});
    npTitle.textContent = `${t.title} — ${alb.name.replace(/\[[^\]]*\]/g, "").trim()}`;
    $$(".track", trackList).forEach((r, n) => r.classList.toggle("playing", n === i));
  };
  audioEl.onended = () => {
    if (!curAlbum) return;
    const cur = $$(".track", trackList).findIndex((r) => r.classList.contains("playing"));
    if (cur >= 0 && cur + 1 < curAlbum.tracks.length) playTrack(curAlbum, cur + 1);
  };
  renderTracks(album);

  const cleanAlbum = (n) => n
    .replace(/\[[^\]]*\]/g, "").replace(/\([^)]*\)/g, "")
    .replace(/[-–]\s*[A-Za-z0-9]+\s*$/, "")     // trailing release-group tag
    .replace(/\s{2,}/g, " ").trim() || n;

  const albumList = el("div", { className: "album-list" },
    ...data.albums.map((a, i) => el("button", {
      className: "album-btn" + (i === idx ? " active" : ""),
      onclick: () => { location.hash = `#/music/${i}`; },
    }, el("span", { textContent: cleanAlbum(a.name) }),
      el("small", { textContent: `${a.tracks.length} track${a.tracks.length > 1 ? "s" : ""}` }))));

  view.replaceChildren(el("div", { className: "wrap" },
    el("section", { className: "shelf", style: "padding:22px 0 6px" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: "Music" }),
        el("span", { className: "count", textContent: `${data.albums.length} album${data.albums.length > 1 ? "s" : ""}` }))),
    el("div", { className: "music-layout" }, albumList,
      el("div", {}, el("h3", { style: "margin:4px 0 10px", textContent: cleanAlbum(album.name) }), trackList)),
    nowPlaying));
}

/* ---- routes: contact ---------------------------------------- */
function routeContact() {
  ++state.render;
  view.replaceChildren(el("section", { className: "pane" },
    el("div", { className: "big-emoji", textContent: "📡" }),
    el("h1", { textContent: "Contact & Socials" }),
    el("p", { textContent: "Follow ShadowSwords everywhere, or jump into the Discord to chat, request games, or report anything broken." }),
    el("div", { className: "socials" },
      ...SOCIALS.map(([name, url, ic, col]) => el("a", { className: "social", href: url, ...extTarget },
        el("span", { className: "ic", style: `color:${col}`, textContent: ic }),
        el("span", {}, name, el("small", { textContent: url.replace(/^https?:\/\/(www\.)?/, "") }))))),
    el("div", { className: "discord-cta" },
      el("div", {}, el("strong", { style: "font-size:16px", textContent: "💬  Discord server" }),
        el("div", { style: "color:var(--muted);font-size:13px", textContent: "The best place to reach me." })),
      el("a", { className: "btn btn-primary", href: DISCORD, ...extTarget, textContent: "Join the Discord ↗" }))));
}

/* ---- routes: videos --------------------------------------- */
async function routeVideos() {
  const token = ++state.render;
  spinner();
  const vids = await fetch("data/videos.json").then((r) => r.json()).catch(() => []);
  if (token !== state.render) return;
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 6px" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Latest videos" }),
      el("a", { href: YT_CHANNEL, ...extTarget, textContent: "Full channel ›" }))));
  const grid = el("div", { className: "video-grid" });
  if (vids.length) {
    vids.slice(0, 15).forEach((v) => grid.append(el("div", {},
      el("div", { className: "video-embed" },
        el("iframe", { src: `https://www.youtube-nocookie.com/embed/${v.id}`, loading: "lazy",
          allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
          allowFullscreen: true, title: v.title })),
      el("div", { className: "tile-cap", style: "padding:8px 2px" },
        el("div", { className: "t", textContent: v.title }),
        el("div", { className: "s", textContent: v.date || "" })))));
  } else {
    grid.append(el("div", { className: "video-embed channel" },
      el("div", {}, el("div", { style: "font-size:32px;margin-bottom:8px", textContent: "▶" }),
        el("a", { className: "btn btn-primary", href: YT_CHANNEL, ...extTarget, textContent: "Open the YouTube channel ↗" }))));
  }
  frag.append(el("div", { className: "wrap" }, grid));
  view.replaceChildren(frag);
}

/* ---- routes: favorites / recent / cloud saves / cache ------- */
function favTile(f) {
  const play = !!f.file;
  const art = el("div", { className: "tile-art" });
  if (f.img) art.append(el("img", { src: f.img, loading: "lazy", alt: f.name }));
  else art.append(el("div", { className: "ph", textContent: f.name }));
  if (play) art.append(el("span", { className: "badge", textContent: "Play" }));
  art.append(heartBtn({ _sys: f.sys, id: f.id, name: f.name, img: f.img, file: f.file, year: f.year, genre: f.genre }));
  const href = play
    ? `#/play/${f.sys}/${f.file.split("/").map(encodeURIComponent).join("/")}`
    : `#/g/${f.sys}/${f.id}`;
  return el("a", { className: "tile wide", href }, art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: f.name }),
      el("div", { className: "s", textContent: sysName(f.sys) })));
}
async function routeFavorites() {
  const token = ++state.render;
  spinner();
  await getSystems().catch(() => {});
  if (token !== state.render) return;
  const draw = () => {
    const list = favList();
    const box = el("div", {});
    if (list.length) {
      const grid = el("div", { className: "tile-grid" });
      list.forEach((f) => grid.append(favTile(f)));
      box.append(grid);
    } else {
      box.append(el("div", { className: "empty-state", textContent: "No favorites yet — tap the ♥ on any game." }));
    }
    view.replaceChildren(el("div", { className: "wrap" },
      el("section", { className: "shelf", style: "padding:22px 0 0" },
        el("div", { className: "shelf-head" }, el("h2", { textContent: "Favorites" }),
          el("span", { className: "count", textContent: `${list.length}` })),
        box)));
  };
  draw();
  const on = () => { if (location.hash.startsWith("#/favorites")) draw(); };
  window.removeEventListener("ssw-favs", on); window.addEventListener("ssw-favs", on);
}

async function routeSaves() {
  const token = ++state.render;
  spinner();
  await getSystems().catch(() => {});
  const saves = await fetch(STATE_BASE + "list").then((r) => r.json()).catch(() => null);
  if (token !== state.render) return;
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Cloud save states" }),
      el("span", { className: "count", textContent: saves ? `${saves.length}` : "—" }))));
  const grid = el("div", { className: "tile-grid" });
  if (!saves) {
    grid.append(el("div", { className: "empty-state", textContent: "Can't reach the save-state server — you may be off the tailnet." }));
  } else if (!saves.length) {
    grid.append(el("div", { className: "empty-state", textContent: "No cloud saves yet. Save a state from the emulator menu and it syncs here automatically." }));
  } else {
    saves.sort((a, b) => b.mtime - a.mtime).forEach((s) => {
      const gm = (state.cache[s.sys] || []).find((x) => x.file === s.file);
      const art = el("div", { className: "tile-art" });
      if (gm && gm.img) art.append(el("img", { src: gm.img, loading: "lazy", alt: s.name }));
      else art.append(el("div", { className: "ph", textContent: s.name }));
      art.append(el("span", { className: "badge", textContent: "Resume" }));
      grid.append(el("a", { className: "tile wide",
        href: `#/resume/${s.sys}/${s.file.split("/").map(encodeURIComponent).join("/")}` }, art,
        el("div", { className: "tile-cap" },
          el("div", { className: "t", textContent: s.name }),
          el("div", { className: "s", textContent: `${sysName(s.sys)} · ${new Date(s.mtime).toLocaleDateString()}` }))));
    });
  }
  frag.append(el("div", { className: "wrap" }, grid));
  view.replaceChildren(frag);
}

async function routeCache() {
  ++state.render;
  const st = await romCacheStats();
  const pct = Math.min(100, st.bytes / ROM_CACHE_CAP * 100);
  const bar = el("div", { className: "dl-bar" }, el("i", { style: `width:${pct.toFixed(1)}%` }));
  const clearBtn = el("button", { className: "btn btn-ghost", textContent: "Clear ROM cache" });
  clearBtn.onclick = async () => { await romCacheClear(); toast("ROM cache cleared"); routeCache(); };
  view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "💾" }),
    el("h1", { textContent: "Offline & cache" }),
    el("p", { textContent: `Downloaded ROMs are kept in your browser so replaying a game is instant — capped at ${fmtBytes(ROM_CACHE_CAP)}, oldest evicted first.` }),
    el("p", { className: "hint", style: "margin:0 0 6px", textContent: `${st.count} ROM${st.count === 1 ? "" : "s"} cached · ${fmtBytes(st.bytes)} used` }),
    bar,
    el("div", { style: "margin-top:16px" }, clearBtn),
    el("div", { className: "hint", style: "margin-top:20px" },
      "This site also installs as an app — look for “Install” / “Add to Home Screen” in your browser menu.")));
}

async function surpriseMe(sysId) {
  await getSystems().catch(() => {});
  let s;
  if (sysId) s = meta(sysId);
  else {
    const pool = state.sys.systems.filter((x) => x.playable && x.count);
    s = pool[Math.random() * pool.length | 0];
  }
  toast("🎲 Rolling…");
  const games = await getSystem(s.id).catch(() => []);
  if (!games.length) { if (!sysId) return surpriseMe(); toast("No games there"); return; }
  const g = games[Math.random() * games.length | 0];
  location.hash = `#/play/${s.id}/${g.file.split("/").map(encodeURIComponent).join("/")}`;
}

async function routeSearch(qRaw) {
  const token = ++state.render;
  const q = qRaw.trim().toLowerCase();
  spinner();
  await getSystems();
  const rows = await getSearch();
  if (token !== state.render) return;
  const terms = q.split(/\s+/).filter(Boolean);
  let hits = rows.filter((r) => terms.every((t) => r[0].toLowerCase().includes(t)))
    .sort((a, b) => b[4] - a[4] || a[0].localeCompare(b[0])).slice(0, 600);
  const need = [...new Set(hits.slice(0, PAGE).map((r) => r[1]))];
  await Promise.all(need.map((id) => getSystem(id).catch(() => [])));
  if (token !== state.render) return;
  const toGame = (r) => (state.cache[r[1]] || []).find((x) => x.id === r[2]) || { name: r[0], id: r[2], _sys: r[1], year: r[3] || null };

  const box = el("div", {});
  view.replaceChildren(el("div", { className: "wrap" },
    el("section", { className: "shelf", style: "padding:22px 0 0" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: `“${qRaw}”` }),
        el("span", { className: "count", textContent: `${hits.length}${hits.length === 600 ? "+" : ""} results` })),
      box)));
  tileGrid(box, hits.map(toGame), PAGE);
}

/* ---- router ------------------------------------------------- */
function parseHash() {
  return location.hash.replace(/^#\/?/, "").split(/[/?]/).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
}
const TOP_NAV = new Set(["home", "play", "favorites", "saves", "movies", "music", "videos", "contact"]);
function setNav(name) {
  $$(".bar-link, .drawer a").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  const top = TOP_NAV.has(name);
  $("#bar-nav").hidden = !top;
  $("#back-btn").hidden = top;
  $("#drawer").hidden = true;
}
async function router() {
  const parts = parseHash();
  const [a, b] = parts;
  // an emulator is live and we're navigating away from it -> hard reset (kills audio/RAF)
  if (window.__emuUp && !((a === "play" || a === "resume") && parts.length > 2)) { window.__emuUp = false; location.reload(); return; }
  if (a !== "q") $("#bar-search").hidden = true;
  if (a !== "music" && audioEl) audioEl.pause();
  window.scrollTo(0, 0);
  if (a === "s" && b) { setNav(null); return routeSystem(b); }
  if (a === "g" && b && parts[2]) { setNav(null); return routeGame(b, parts[2]); }
  if (a === "resume" && b && parts.length > 2) { setNav("play"); return routePlayGame(b, parts.slice(2).join("/"), true); }
  if (a === "play" && b && parts.length > 2) { setNav("play"); return routePlayGame(b, parts.slice(2).join("/")); }
  if (a === "play" && b === "random") { setNav("play"); return surpriseMe(); }
  if (a === "play" && b) { setNav("play"); return routePlaySystem(b); }
  if (a === "play") { setNav("play"); return routePlay(); }
  if (a === "favorites") { setNav("favorites"); return routeFavorites(); }
  if (a === "saves") { setNav("saves"); return routeSaves(); }
  if (a === "cache") { setNav(null); return routeCache(); }
  if (a === "movies") { setNav("movies"); return routeMovies(); }
  if (a === "music") { setNav("music"); return routeMusic(b); }
  if (a === "videos") { setNav("videos"); return routeVideos(); }
  if (a === "contact") { setNav("contact"); return routeContact(); }
  if (a === "browse") { setNav("home"); return routeBrowse(); }
  if (a === "q" && b) { setNav(null); return routeSearch(b); }
  setNav("home"); $("#q").value = ""; return routeHome();
}
window.addEventListener("hashchange", router);

/* ---- chrome ----------------------------------------------- */
$("#back-btn").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));
const drawer = $("#drawer");
$("#menu-btn").onclick = () => { drawer.hidden = !drawer.hidden; };
drawer.addEventListener("click", (e) => { if (e.target.tagName === "A") drawer.hidden = true; });
document.addEventListener("click", (e) => {
  if (!drawer.hidden && !drawer.contains(e.target) && e.target.id !== "menu-btn") drawer.hidden = true;
});
const sf = $("#bar-search"), qi = $("#q");
$("#search-btn").onclick = () => { sf.hidden = !sf.hidden; if (!sf.hidden) qi.focus(); };
sf.onsubmit = (e) => e.preventDefault();
qi.addEventListener("input", debounce(() => {
  const v = qi.value.trim();
  if (v.length >= 2) location.hash = `#/q/${encodeURIComponent(v)}`;
  else if (!v && location.hash.startsWith("#/q/")) location.hash = "#/";
}, 250));
qi.addEventListener("keydown", (e) => { if (e.key === "Escape") { sf.hidden = true; qi.blur(); } });

/* ---- gamepad navigation for the site menus (not in-game) --------- */
const NAV_SEL = "a.tile, a.btn, button.more, .bar-link, .drawer a, .album-btn, .social, .shelf-nav, .heart, #back-btn, #menu-btn, #search-btn, .track";
const focusables = () => $$(NAV_SEL).filter((e) => e.offsetParent !== null && !e.disabled && !e.hidden);
function moveFocus(dir) {
  const list = focusables();
  if (!list.length) return;
  const cur = document.activeElement;
  if (!cur || !list.includes(cur)) { list[0].focus(); list[0].scrollIntoView({ block: "center" }); return; }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestScore = Infinity;
  for (const e of list) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - cx, dy = by - cy;
    if (dir === "left" && dx > -6) continue;
    if (dir === "right" && dx < 6) continue;
    if (dir === "up" && dy > -6) continue;
    if (dir === "down" && dy < 6) continue;
    const horiz = dir === "left" || dir === "right";
    const along = horiz ? Math.abs(dx) : Math.abs(dy);
    const cross = horiz ? Math.abs(dy) : Math.abs(dx);
    const score = along + cross * 2.5;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
let _padRAF = 0; const _padPrev = {};
function pollPad() {
  _padRAF = requestAnimationFrame(pollPad);
  if (window.__emuUp) return;                       // EmulatorJS owns the pad in-game
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find(Boolean);
  if (!gp) return;
  const now = performance.now();
  const edge = (id, active, fn, rate = 200) => {
    if (active) { if (now - (_padPrev[id] || 0) > rate) { _padPrev[id] = now; fn(); } }
    else if (_padPrev[id]) _padPrev[id] = 0;
  };
  const b = gp.buttons, ax = gp.axes;
  edge("u", b[12]?.pressed || ax[1] < -0.6, () => moveFocus("up"));
  edge("d", b[13]?.pressed || ax[1] > 0.6, () => moveFocus("down"));
  edge("l", b[14]?.pressed || ax[0] < -0.6, () => moveFocus("left"));
  edge("r", b[15]?.pressed || ax[0] > 0.6, () => moveFocus("right"));
  edge("a", b[0]?.pressed, () => document.activeElement?.click(), 320);
  edge("b", b[1]?.pressed, () => $("#back-btn")?.click() ?? history.back(), 320);
}
window.addEventListener("gamepadconnected", () => { if (!_padRAF) { toast("🎮 Controller connected"); pollPad(); } });
if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) pollPad();

/* ---- PWA service worker ---------------------------------------- */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

router();
