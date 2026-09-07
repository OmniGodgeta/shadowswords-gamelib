"use strict";

/* ========================================================================
   shadowswords arcade
   ======================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null && k !== false) n.append(k);
  return n;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---- config ------------------------------------------------------------ */
// Movie library (Jellyfin) and playable-ROM server, both fronted by Tailscale.
const MOVIES_URL = "https://shadow-1.tail51f9d6.ts.net/";
const ROM_BASE   = "https://shadow-1.tail51f9d6.ts.net:8443/";
const EMU_DATA   = "https://cdn.emulatorjs.org/stable/data/";
const PLAY_SYSTEMS = { nes: "Nintendo Entertainment System", snes: "Super Nintendo" };
const EMU_CORE = { nes: "nes", snes: "snes" };
const COLLAGE_SYSTEMS = ["atari2600", "archimedes", "3do", "wii", "xbox", "gba"];
const PAGE = 90;

const view = $("#view");
const state = { index: null, systems: {}, cache: {}, search: null, catalog: undefined, render: 0 };

/* ---- data ------------------------------------------------------------- */
async function getIndex() {
  if (!state.index) {
    state.index = await fetch("data/index.json").then((r) => r.json());
    for (const s of state.index.systems) state.systems[s.id] = s;
    $("#footcount").textContent =
      `${state.index.total.toLocaleString()} games · ${state.index.systems.length} systems`;
  }
  return state.index;
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
// ROM catalog from the tailnet server: { nes:[{name,file,size}], snes:[...] }  — null if unreachable
async function getCatalog() {
  if (state.catalog === undefined) {
    state.catalog = await fetch(ROM_BASE + "catalog.json", { mode: "cors" })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return state.catalog;
}

const sysName = (id) => state.systems[id]?.name || PLAY_SYSTEMS[id] || id;

/* ---- components ------------------------------------------------------- */
function collage(imgs) {
  const c = el("div", { className: "collage" });
  imgs.slice(0, 24).forEach((src) => c.append(el("img", { src, loading: "lazy", alt: "" })));
  return c;
}

function hero({ kicker, title, desc, meta, art, actions = [] }) {
  const artBox = el("div", { className: "hero-art" });
  if (art) artBox.append(art);
  const body = el("div", { className: "hero-body" },
    kicker && el("p", { className: "hero-kicker", textContent: kicker }),
    el("h1", { className: "hero-title", textContent: title }),
    desc && el("p", { className: "hero-desc", textContent: desc }),
    el("div", { className: "hero-actions" },
      ...actions.map((a) => el("a", {
        className: "btn " + (a.primary ? "btn-primary" : "btn-ghost"),
        href: a.href || "javascript:void 0",
        target: a.blank ? "_blank" : null, rel: a.blank ? "noopener" : null,
        onclick: a.onClick || null,
        textContent: a.label,
      }))),
    meta && el("p", { className: "hero-meta", textContent: meta }));
  return el("section", { className: "hero" }, artBox, body);
}

function shelf({ title, count, moreHref, tiles }) {
  const track = el("div", { className: "shelf-track" }, ...tiles);
  const scroll = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: "smooth" });
  return el("section", { className: "shelf" },
    el("div", { className: "shelf-head" },
      el("h2", { textContent: title }),
      count != null && el("span", { className: "count", textContent: `${count.toLocaleString()}` }),
      moreHref && el("a", { href: moreHref, textContent: "See all ›" })),
    track,
    el("button", { className: "shelf-nav prev", ariaLabel: "Scroll left", textContent: "‹",
      onclick: () => scroll(-1) }),
    el("button", { className: "shelf-nav next", ariaLabel: "Scroll right", textContent: "›",
      onclick: () => scroll(1) }));
}

function consoleTile(s) {
  return el("a", { className: "tile", href: `#/s/${s.id}` },
    el("div", { className: "tile-art console" },
      el("div", { className: "ph", textContent: s.name })),
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: s.name }),
      el("div", { className: "s", textContent: `${s.count.toLocaleString()} games` })));
}

function gameTile(g, { wide = true, badge } = {}) {
  const art = el("div", { className: "tile-art" + (wide ? "" : "") });
  if (g.img) art.append(el("img", { src: g.img, loading: "lazy", alt: g.name }));
  else art.append(el("div", { className: "ph", textContent: g.name }));
  if (badge) art.append(el("span", { className: "badge", textContent: badge }));
  return el("a", { className: "tile" + (wide ? " wide" : ""), href: `#/g/${g._sys}/${g.id}` },
    art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: g.name }),
      el("div", { className: "s", textContent: [g.year, g.genre].filter(Boolean).join(" · ") })));
}

function playTile(sys, rom) {
  return el("a", { className: "tile wide", href: `#/play/${sys}/${encodeURIComponent(rom.file)}` },
    el("div", { className: "tile-art console" },
      el("div", { className: "ph", textContent: rom.name }),
      el("span", { className: "badge", textContent: "Play" })),
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: rom.name }),
      el("div", { className: "s", textContent: PLAY_SYSTEMS[sys] })));
}

const spinner = () => view.replaceChildren(el("div", { className: "spinner", textContent: "Loading…" }));

async function collageArt(n = 18) {
  const picks = [];
  for (const id of COLLAGE_SYSTEMS) {
    try {
      const g = await getSystem(id);
      for (const x of g) if (x.img) picks.push(x.img);
    } catch { /* skip */ }
    if (picks.length > n * 3) break;
  }
  for (let i = picks.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;[picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.length ? collage(picks.slice(0, n)) : null;
}

/* ---- routes: browse ------------------------------------------------- */
async function routeHome() {
  const token = ++state.render;
  spinner();
  await getIndex();
  const cat = await getCatalog();
  if (token !== state.render) return;

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "shadowswords",
    title: "The whole collection, one place",
    desc: "Browse 4,350 games across 38 systems, play NES & SNES right in the browser, and stream the movie library — no installs.",
    art: await collageArt(20),
    actions: [
      { label: "▶ Play now", href: "#/play", primary: true },
      { label: "Movies", href: "#/movies" },
    ],
  }));
  if (token !== state.render) return;

  // Play-now shelf
  const playTiles = [];
  for (const sys of Object.keys(PLAY_SYSTEMS)) {
    const list = cat?.[sys] || [];
    list.slice(0, 12).forEach((r) => playTiles.push(playTile(sys, r)));
  }
  playTiles.push(el("a", { className: "tile wide", href: "#/play" },
    el("div", { className: "tile-art console" }, el("div", { className: "ph", textContent: "＋ Upload a ROM / see all" })),
    el("div", { className: "tile-cap" }, el("div", { className: "t", textContent: "Play library" }))));
  frag.append(shelf({ title: "Play now", moreHref: "#/play", tiles: playTiles }));

  // Consoles shelf(s)
  const withArt = state.index.systems.filter((s) => s.withArt > 0);
  const noArt = state.index.systems.filter((s) => s.withArt === 0);
  frag.append(shelf({
    title: "Consoles", count: state.index.systems.length, moreHref: "#/browse",
    tiles: [...withArt, ...noArt].map(consoleTile),
  }));

  view.replaceChildren(frag);
}

async function routeBrowse() {
  ++state.render;
  await getIndex();
  view.replaceChildren(el("div", { className: "wrap" },
    el("section", { className: "shelf", style: "padding-left:0;padding-right:0" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: "All consoles" }),
        el("span", { className: "count", textContent: `${state.index.systems.length}` })),
      el("div", { className: "tile-grid", style: "padding:0" },
        ...state.index.systems.map(consoleTile)))));
}

async function routeSystem(id) {
  const token = ++state.render;
  spinner();
  await getIndex();
  const games = await getSystem(id).catch(() => []);
  if (token !== state.render) return;
  const meta = state.systems[id] || { name: id };
  const genres = [...new Set(games.map((g) => g.genre).filter(Boolean))].sort();
  const arty = games.filter((g) => g.img).slice(0, 20).map((g) => g.img);

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "Console",
    title: meta.name,
    desc: `${games.length.toLocaleString()} games in the collection${meta.withArt ? `, ${meta.withArt} with box art` : ""}.`,
    art: arty.length ? collage(arty) : null,
    actions: PLAY_SYSTEMS[id] ? [{ label: "▶ Play these", href: `#/play/${id}`, primary: true }] : [],
  }));

  const fText = el("input", { type: "search", placeholder: "Filter titles…" });
  const fGenre = el("select", {}, el("option", { value: "", textContent: "All genres" }),
    ...genres.map((x) => el("option", { value: x, textContent: x })));
  const fSort = el("select", {},
    el("option", { value: "name", textContent: "A–Z" }),
    el("option", { value: "-name", textContent: "Z–A" }),
    el("option", { value: "-year", textContent: "Newest" }),
    el("option", { value: "year", textContent: "Oldest" }),
    el("option", { value: "art", textContent: "Box art first" }));
  frag.append(el("div", { className: "grid-tools" }, fText, fGenre, fSort));
  const box = el("div", {});
  frag.append(box);
  view.replaceChildren(frag);

  const apply = () => {
    const q = fText.value.trim().toLowerCase(), gv = fGenre.value;
    let list = games.filter((g) => (!q || g.name.toLowerCase().includes(q)) && (!gv || g.genre === gv));
    const cmp = {
      "name": (a, b) => a.name.localeCompare(b.name),
      "-name": (a, b) => b.name.localeCompare(a.name),
      "-year": (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name),
      "year": (a, b) => (a.year || 9999) - (b.year || 9999) || a.name.localeCompare(b.name),
      "art": (a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.name.localeCompare(b.name),
    }[fSort.value];
    renderTileGrid(box, [...list].sort(cmp), PAGE);
  };
  fText.oninput = debounce(apply, 150);
  fGenre.onchange = fSort.onchange = apply;
  apply();
}

function renderTileGrid(container, list, shown) {
  const grid = el("div", { className: "tile-grid" });
  list.slice(0, shown).forEach((g) => grid.append(gameTile(g, { wide: true })));
  const parts = [grid];
  if (list.length > shown) {
    parts.push(el("button", {
      className: "more",
      textContent: `Show ${Math.min(PAGE, list.length - shown)} more · ${(list.length - shown).toLocaleString()} left`,
      onclick: (e) => { e.target.remove(); renderTileGrid(container, list, shown + PAGE); },
    }));
  } else if (!list.length) {
    parts.length = 0; parts.push(el("div", { className: "empty-state", textContent: "Nothing matches." }));
  }
  container.replaceChildren(...parts);
}

async function routeGame(sysId, gid) {
  const token = ++state.render;
  spinner();
  await getIndex();
  const games = await getSystem(sysId).catch(() => []);
  const g = games.find((x) => x.id === gid);
  if (token !== state.render) return;
  if (!g) { location.hash = `#/s/${sysId}`; return; }

  const actions = [];
  if (PLAY_SYSTEMS[sysId]) actions.push({ label: "▶ Play", primary: true, href: `#/play/${sysId}` });
  actions.push({ label: `All ${sysName(sysId)}`, href: `#/s/${sysId}` });

  view.replaceChildren(hero({
    kicker: [sysName(sysId), g.year].filter(Boolean).join(" · "),
    title: g.name,
    desc: g.desc || "No description scraped for this title.",
    meta: [g.developer && `Developer: ${g.developer}`, g.publisher && `Publisher: ${g.publisher}`,
      g.players && `Players: ${g.players}`, g.rating && `Rating ${g.rating}/5`].filter(Boolean).join("   ·   "),
    art: g.img ? el("img", { src: g.img, alt: g.name }) : (games.filter((x) => x.img).length
      ? collage(games.filter((x) => x.img).slice(0, 16).map((x) => x.img)) : null),
    actions,
  }));
}

/* ---- routes: play -------------------------------------------------- */
async function routePlay(onlySys) {
  const token = ++state.render;
  spinner();
  const cat = await getCatalog();
  if (token !== state.render) return;

  const frag = document.createDocumentFragment();
  const total = cat ? Object.values(cat).reduce((n, a) => n + a.length, 0) : 0;
  frag.append(hero({
    kicker: "Play",
    title: "Play in your browser",
    desc: cat
      ? `${total.toLocaleString()} NES & SNES games, streamed from the home server and emulated right here. Or drop in a ROM from your own device below.`
      : "Load a NES (.nes) or SNES (.sfc/.smc) ROM from your device and play it instantly — no server needed. Connect to the tailnet to reach the full home library.",
    art: null,
    actions: [{ label: "Pick a ROM file", primary: true, onClick: () => $("#rom-input")?.click() }],
  }));

  // upload dropzone
  const drop = el("label", { className: "drop", htmlFor: "rom-input" },
    el("input", { id: "rom-input", type: "file", accept: ".nes,.sfc,.smc,.fig,.bin,.zip" }),
    el("div", {}, el("strong", { textContent: "Drop a ROM here" }), " or click to browse — ",
      "it plays locally in your browser and is never uploaded."));
  const input = drop.querySelector("input");
  input.onchange = () => input.files[0] && startUpload(input.files[0]);
  ["dragover", "dragenter"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, () => drop.classList.remove("hot")));
  drop.addEventListener("drop", (ev) => { ev.preventDefault(); ev.dataTransfer.files[0] && startUpload(ev.dataTransfer.files[0]); });
  frag.append(el("div", { className: "wrap", style: "padding-bottom:8px" }, drop));

  const systems = onlySys ? [onlySys] : Object.keys(PLAY_SYSTEMS);
  for (const sys of systems) {
    const list = (cat?.[sys] || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    if (list.length) {
      frag.append(shelf({ title: PLAY_SYSTEMS[sys], count: list.length, tiles: list.slice(0, 60).map((r) => playTile(sys, r)) }));
    }
  }
  if (!cat) {
    frag.append(el("div", { className: "wrap" }, el("p", { className: "hint",
      style: "border:0;text-align:center;color:var(--dim)",
      textContent: `Home game server (${new URL(ROM_BASE).host}) isn't reachable right now — join your Tailscale network to browse the full library, or use the ROM picker above.` })));
  }
  view.replaceChildren(frag);
}

// --- tiny IndexedDB stash so an uploaded ROM survives the reload into the player
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("ssw-arcade", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("rom");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction("rom", "readwrite"); t.objectStore("rom").put(val, key);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const g = db.transaction("rom", "readonly").objectStore("rom").get(key);
    g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error);
  });
}

async function startUpload(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const sys = ext === "nes" ? "nes" : ["sfc", "smc", "fig"].includes(ext) ? "snes" : null;
  if (!sys && ext !== "zip") { alert("Unsupported file — pick a .nes, .sfc or .smc ROM."); return; }
  await idbPut("upload", { name: file.name, sys: sys || "snes", blob: file });
  location.hash = `#/play/upload/${encodeURIComponent(file.name)}`;
}

async function routePlayGame(sys, romParam) {
  ++state.render;
  // The emulator can't be cleanly re-created in place; if one is already up, reload into this hash.
  if (window.__emuUp) { location.reload(); return; }
  window.__emuUp = true;

  const shell = el("div", { className: "player" },
    el("div", { className: "player-bar" },
      el("button", { className: "exit", textContent: "‹ Exit", onclick: exitPlayer }),
      el("div", { className: "title", id: "player-title", textContent: "Loading…" })),
    el("div", { className: "player-stage" },
      el("div", { id: "game" }),
      el("div", { className: "player-load", id: "player-load", textContent: "Booting emulator…" })));
  document.body.append(shell);
  view.replaceChildren();

  let romUrl, romName, core;
  try {
    if (sys === "upload") {
      const u = await idbGet("upload");
      if (!u) throw new Error("no upload");
      romUrl = URL.createObjectURL(u.blob); romName = u.name; core = EMU_CORE[u.sys];
    } else {
      const file = decodeURIComponent(romParam);
      romName = file.replace(/\.[^.]+$/, "");
      romUrl = ROM_BASE + "rom/" + sys + "/" + encodeURIComponent(file);
      core = EMU_CORE[sys];
    }
  } catch {
    $("#player-load").textContent = "Couldn't load that ROM. Go back and pick another.";
    return;
  }
  $("#player-title").textContent = romName;

  window.EJS_player = "#game";
  window.EJS_core = core;
  window.EJS_gameUrl = romUrl;
  window.EJS_gameName = romName;
  window.EJS_pathtodata = EMU_DATA;
  window.EJS_startOnLoaded = true;
  window.EJS_Buttons = { restart: true, settings: true, fullscreen: true, saveState: true, loadState: true };
  window.EJS_onGameStart = () => $("#player-load")?.remove();

  const s = el("script", { src: EMU_DATA + "loader.js" });
  s.onerror = () => { $("#player-load").textContent = "Emulator failed to load (network / CDN blocked)."; };
  document.body.append(s);
}
function exitPlayer() {
  window.__emuUp = false;
  location.hash = "#/play";
  location.reload();
}

/* ---- routes: movies ---------------------------------------------- */
function routeMovies() {
  ++state.render;
  const host = (() => { try { return new URL(MOVIES_URL).host; } catch { return MOVIES_URL; } })();
  view.replaceChildren(el("section", { className: "pane" },
    el("div", { className: "big-emoji", textContent: "🎬" }),
    el("h1", { textContent: "Movie library" }),
    el("p", { textContent: "The full film & TV collection, streamed from the home server. Opens the Jellyfin player in a new tab — sign in with the shared account." }),
    el("a", { className: "btn btn-primary", href: MOVIES_URL, target: "_blank", rel: "noopener",
      textContent: "Open the movie library ↗" }),
    el("div", { className: "hint" }, "Powered by Jellyfin at ", el("code", { textContent: host }),
      ". If it doesn't load, the server may be offline or you're not on the tailnet.")));
}

/* ---- search ----------------------------------------------------- */
async function routeSearch(qRaw) {
  const token = ++state.render;
  const q = qRaw.trim().toLowerCase();
  spinner();
  await getIndex();
  const rows = await getSearch();
  if (token !== state.render) return;
  const terms = q.split(/\s+/).filter(Boolean);
  let hits = rows.filter((r) => terms.every((t) => r[0].toLowerCase().includes(t)))
    .sort((a, b) => b[4] - a[4] || a[0].localeCompare(b[0])).slice(0, 600);

  const need = [...new Set(hits.slice(0, PAGE).map((r) => r[1]))];
  await Promise.all(need.map((id) => getSystem(id).catch(() => [])));
  if (token !== state.render) return;
  const toGame = (r) => (state.cache[r[1]] || []).find((x) => x.id === r[2])
    || { name: r[0], id: r[2], _sys: r[1], year: r[3] || null };

  const box = el("div", {});
  view.replaceChildren(el("div", { className: "wrap" },
    el("section", { className: "shelf", style: "padding-left:0;padding-right:0" },
      el("div", { className: "shelf-head" },
        el("h2", { textContent: `Search: “${qRaw}”` }),
        el("span", { className: "count", textContent: `${hits.length}${hits.length === 600 ? "+" : ""} results` })),
      box)));
  renderTileGrid(box, hits.map(toGame), PAGE);
}

/* ---- router --------------------------------------------------- */
function parseHash() {
  return location.hash.replace(/^#\/?/, "").split(/[/?]/).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
}
function setNav(name) {
  $$(".bar-link").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  // left slot holds EITHER the nav (top-level routes) OR a back button (deep routes) — never both
  const topLevel = name === "home" || name === "play" || name === "movies";
  $("#bar-nav").hidden = !topLevel;
  $("#back-btn").hidden = topLevel;
}
async function router() {
  // leaving the player? (any hash change while it's up triggers a reload via routePlayGame)
  const [a, b, c] = parseHash();
  if (a !== "q") { $("#bar-search").hidden = true; }
  window.scrollTo(0, 0);
  if (a === "s" && b) { setNav(null); return routeSystem(b); }
  if (a === "g" && b && c) { setNav(null); return routeGame(b, c); }
  if (a === "play" && b && c) { setNav("play"); return routePlayGame(b, c); }
  if (a === "play" && b) { setNav("play"); return routePlay(PLAY_SYSTEMS[b] ? b : null); }
  if (a === "play") { setNav("play"); return routePlay(); }
  if (a === "movies") { setNav("movies"); return routeMovies(); }
  if (a === "browse") { setNav("home"); return routeBrowse(); }
  if (a === "q" && b) { setNav(null); return routeSearch(b); }
  setNav("home"); $("#q").value = ""; return routeHome();
}
window.addEventListener("hashchange", router);

/* ---- chrome: back + search ----------------------------------- */
$("#back-btn").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));
const searchForm = $("#bar-search"), qInput = $("#q");
$("#search-btn").onclick = () => {
  searchForm.hidden = !searchForm.hidden;
  if (!searchForm.hidden) qInput.focus();
};
searchForm.onsubmit = (e) => e.preventDefault();
qInput.addEventListener("input", debounce(() => {
  const v = qInput.value.trim();
  if (v.length >= 2) location.hash = `#/q/${encodeURIComponent(v)}`;
  else if (!v && location.hash.startsWith("#/q/")) location.hash = "#/";
}, 250));
qInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { searchForm.hidden = true; qInput.blur(); } });

router();
