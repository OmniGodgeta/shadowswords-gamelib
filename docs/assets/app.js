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

/* ---- config --------------------------------------------------------- */
const TS = "https://shadow-1.tail51f9d6.ts.net";
const SELF_HOSTED = location.hostname.endsWith(".ts.net");
const ROM_BASE = SELF_HOSTED ? "/roms/" : TS + "/roms/";       // needs Funnel when off-tailnet
const MOVIES_URL = TS + ":8443/";                               // opens in a new tab
const EMU_DATA = "https://cdn.emulatorjs.org/stable/data/";
const PAGE = 90;
const COLLAGE_SYSTEMS = ["atari2600", "archimedes", "3do", "wii", "xbox", "gba", "psx", "gc"];

const view = $("#view");
const state = { sys: null, systems: {}, cache: {}, search: null, render: 0 };

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
  if (s.logo) art.append(el("img", { className: "console-logo", src: s.logo, loading: "lazy", alt: s.name }));
  else art.append(el("div", { className: "ph", textContent: s.name }));
  if (play && s.playable) art.append(el("span", { className: "badge", textContent: "Play" }));
  return el("a", { className: "tile", href: play ? `#/play/${s.id}` : `#/s/${s.id}` },
    art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: s.name }),
      el("div", { className: "s", textContent: `${s.count.toLocaleString()} games` })));
}

function gameTile(g, { play = false } = {}) {
  const art = el("div", { className: "tile-art" });
  if (g.img) art.append(el("img", { src: g.img, loading: "lazy", alt: g.name }));
  else art.append(el("div", { className: "ph", textContent: g.name }));
  if (play) art.append(el("span", { className: "badge", textContent: "Play" }));
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
    actions: [{ label: "▶ Play now", href: "#/play", primary: true }, { label: "Browse all", href: "#/browse" }],
  }));
  if (token !== state.render) return;

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
  frag.append(el("div", { className: "shelf" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Movies" })),
    el("div", { className: "shelf-track" },
      el("a", { className: "tile", href: "#/movies" },
        el("div", { className: "tile-art console" }, el("div", { className: "ph", textContent: "🎬  Movie library" })),
        el("div", { className: "tile-cap" }, el("div", { className: "t", textContent: "Jellyfin" }))))));
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
    art: arty.length ? collage(arty) : (m.logo ? el("img", { src: m.logo, alt: m.name, style: "object-fit:contain;padding:8%" }) : null),
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
        : (m.logo ? el("img", { src: m.logo, style: "object-fit:contain;padding:9%" }) : null)),
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
    art: m.logo ? el("img", { src: m.logo, style: "object-fit:contain;padding:8%" }) : null,
    actions: [{ label: "Or upload a ROM", onClick: () => $("#rom-input")?.click() }],
  }));
  frag.append(el("div", { className: "wrap", style: "padding-bottom:6px" }, dropzone()));
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

// --- IndexedDB stash so an uploaded ROM survives the player's reload
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("ssw-arcade", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("rom");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const idbPut = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("rom", "readwrite"); t.objectStore("rom").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); };
const idbGet = async (k) => { const db = await idb(); return new Promise((res, rej) => { const g = db.transaction("rom", "readonly").objectStore("rom").get(k); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); }); };

// file extension -> EmulatorJS system (EJS_core) for uploaded ROMs
const EXT_CORE = {
  nes: "nes", fds: "nes", unf: "nes", sfc: "snes", smc: "snes", fig: "snes",
  gb: "gb", gbc: "gb", gba: "gba", n64: "n64", z64: "n64", v64: "n64",
  md: "segaMD", gen: "segaMD", smd: "segaMD", sms: "segaMS",
  gg: "segaGG", pce: "pce", sgx: "pce", a26: "atari2600",
  a78: "atari7800", lnx: "lynx", j64: "jaguar", jag: "jaguar", ws: "ws", wsc: "ws",
  ngp: "ngp", ngc: "ngp", vb: "vb", col: "coleco", d64: "c64",
  iso: "psx", cue: "psx", chd: "psx", pbp: "psx", bin: "psx", zip: "arcade",
};
async function startUpload(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const core = EXT_CORE[ext];
  if (!core) { alert("Unsupported ROM type: ." + ext); return; }
  await idbPut("upload", { name: file.name, core, blob: file });
  location.hash = `#/play/upload/${encodeURIComponent(file.name)}`;
}

async function routePlayGame(sys, romParam) {
  ++state.render;
  if (window.__emuUp) { location.reload(); return; }
  window.__emuUp = true;
  await getSystems().catch(() => {});

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
      if (!u) throw 0;
      romUrl = URL.createObjectURL(u.blob); romName = u.name.replace(/\.[^.]+$/, ""); core = u.core;
    } else {
      const file = romParam;
      romName = file.split("/").pop().replace(/\.[^.]+$/, "");
      core = meta(sys).core || EXT_CORE[file.split(".").pop().toLowerCase()];
      romUrl = ROM_BASE + "rom/" + encodeURIComponent(sys) + "/" + file.split("/").map(encodeURIComponent).join("/");
    }
    if (!core) throw 0;
  } catch {
    $("#player-load").textContent = "Couldn't load that ROM — go back and try another.";
    return;
  }
  $("#player-title").textContent = romName;

  window.EJS_player = "#game";
  window.EJS_core = core;
  window.EJS_gameUrl = romUrl;
  window.EJS_gameName = romName;
  window.EJS_pathtodata = EMU_DATA;
  window.EJS_startOnLoaded = true;
  window.EJS_Buttons = { restart: true, settings: true, fullscreen: true, saveState: true, loadState: true, gamepad: true };
  window.EJS_onGameStart = () => $("#player-load")?.remove();
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
    el("p", { textContent: "The full film & TV collection, streamed from the home server. Opens the Jellyfin player in a new tab — sign in with the shared account." }),
    el("a", { className: "btn btn-primary", href: MOVIES_URL, target: "_blank", rel: "noopener", textContent: "Open the movie library ↗" }),
    el("div", { className: "hint" }, "Jellyfin at ", el("code", { textContent: host }),
      " — if it doesn't load, the server may be off or you're not on the tailnet.")));
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
function setNav(name) {
  $$(".bar-link").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  const top = name === "home" || name === "play" || name === "movies";
  $("#bar-nav").hidden = !top;
  $("#back-btn").hidden = top;
}
async function router() {
  const parts = parseHash();
  const [a, b] = parts;
  // an emulator is live and we're navigating away from it -> hard reset (kills audio/RAF)
  if (window.__emuUp && !(a === "play" && parts.length > 2)) { window.__emuUp = false; location.reload(); return; }
  if (a !== "q") $("#bar-search").hidden = true;
  window.scrollTo(0, 0);
  if (a === "s" && b) { setNav(null); return routeSystem(b); }
  if (a === "g" && b && parts[2]) { setNav(null); return routeGame(b, parts[2]); }
  if (a === "play" && b && parts.length > 2) { setNav("play"); return routePlayGame(b, parts.slice(2).join("/")); }
  if (a === "play" && b) { setNav("play"); return routePlaySystem(b); }
  if (a === "play") { setNav("play"); return routePlay(); }
  if (a === "movies") { setNav("movies"); return routeMovies(); }
  if (a === "browse") { setNav("home"); return routeBrowse(); }
  if (a === "q" && b) { setNav(null); return routeSearch(b); }
  setNav("home"); $("#q").value = ""; return routeHome();
}
window.addEventListener("hashchange", router);

/* ---- chrome ----------------------------------------------- */
$("#back-btn").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));
const sf = $("#bar-search"), qi = $("#q");
$("#search-btn").onclick = () => { sf.hidden = !sf.hidden; if (!sf.hidden) qi.focus(); };
sf.onsubmit = (e) => e.preventDefault();
qi.addEventListener("input", debounce(() => {
  const v = qi.value.trim();
  if (v.length >= 2) location.hash = `#/q/${encodeURIComponent(v)}`;
  else if (!v && location.hash.startsWith("#/q/")) location.hash = "#/";
}, 250));
qi.addEventListener("keydown", (e) => { if (e.key === "Escape") { sf.hidden = true; qi.blur(); } });

router();
