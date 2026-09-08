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
const EMU_DATA = SELF_HOSTED ? "/emulatorjs/" : "https://cdn.emulatorjs.org/stable/data/";
const STATE_BASE = SELF_HOSTED ? "/states/" : TS + "/states/";   // cloud save-states
const API = SELF_HOSTED ? "" : TS;                               // dynamic endpoints (search, stats, twitch…)
const NETPLAY_URL = TS + ":8712/";                                // EmulatorJS netplay signalling (tailnet)
const CID = (() => {
  try {
    let c = localStorage.getItem("ssw:cid");
    if (!c) { c = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("ssw:cid", c); }
    return c;
  } catch { return "anon"; }
})();
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

// route hot-linked libretro art through the self-host proxy (rate-limit + cache);
// public mirror keeps the raw URL and leans on the onerror fallback below.
const LR_RAW = "https://raw.githubusercontent.com/libretro-thumbnails/";
const artUrl = (u) => (SELF_HOSTED && u && u.startsWith(LR_RAW)) ? "/thumb/" + u.slice(LR_RAW.length) : u;
// when box art 404s (GH raw throttling, dead link), swap in the text placeholder
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName !== "IMG" || img.dataset.fb) return;
  img.dataset.fb = "1";
  const box = img.closest(".tile-art, .hero-art, .coll-cover");
  if (!box) { img.style.visibility = "hidden"; return; }
  if (box.classList.contains("coll-cover")) { img.remove(); return; }
  img.replaceWith(el("div", { className: "ph", textContent: img.alt || "" }));
}, true);

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

/* ---- accounts + preferences -------------------------------------- */
const PREF_DEFAULTS = {
  lite: false, autoResume: false, musicShuffle: false, videoFilter: "pixel",
  region: "", playingToasts: true, confirmOverwrite: false,
};
const AUTH = { token: LS.get("auth", null), user: null };
const authHdr = () => AUTH.token ? { "x-ssw-auth": AUTH.token } : {};
const signedIn = () => !!AUTH.user;

function prefs() {
  const local = LS.get("settings", {});
  const remote = (AUTH.user && AUTH.user.settings) || {};
  return { ...PREF_DEFAULTS, ...local, ...remote };
}
function setPref(k, v) {
  const local = LS.get("settings", {}); local[k] = v; LS.set("settings", local);
  if (AUTH.user) {
    AUTH.user.settings = { ...(AUTH.user.settings || {}), [k]: v };
    apiAuth("update", { settings: { [k]: v } }).catch(() => {});
  }
  window.dispatchEvent(new Event("ssw-prefs"));
}
async function apiAuth(action, body) {
  const r = await fetch(`${API}/auth/${action}`, {
    method: action === "me" ? "GET" : "POST",
    headers: { "content-type": "application/json", ...authHdr() },
    body: action === "me" ? undefined : JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status });
  return data;
}
function setSession(token, user) {
  AUTH.token = token || AUTH.token; AUTH.user = user;
  if (token) LS.set("auth", token);
  window.dispatchEvent(new Event("ssw-auth"));
  applyPrefs();
}
function signOut() {
  AUTH.token = null; AUTH.user = null;
  try { localStorage.removeItem("ssw:auth"); } catch { /* */ }
  window.dispatchEvent(new Event("ssw-auth"));
  toast("Signed out");
}
async function hydrateAuth() {
  if (!AUTH.token) { applyPrefs(); return; }
  try { const { user } = await apiAuth("me"); setSession(null, user); }
  catch (e) { if (e.status === 401) signOut(); applyPrefs(); }
}
function applyPrefs() {
  const p = prefs();
  document.body.classList.toggle("lite", p.lite === true);
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
  if (g.img) art.append(el("img", { src: artUrl(g.img), loading: "lazy", alt: g.name }));
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
      if (r.img) art.append(el("img", { src: artUrl(r.img), loading: "lazy", alt: r.name }));
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

  const anchor = el("div");
  frag.append(anchor);
  Promise.all([
    getJSON("added"), getJSON("collections"), getJSON("franchises"),
    fetch(`${API}/play/stats`).then((r) => r.json()).catch(() => null),
  ]).then(([added, cols, fr, ps]) => {
    if (location.hash !== "#/" && location.hash !== "" && location.hash !== "#") return;
    const bits = document.createDocumentFragment();
    const trend = ps && (ps.trending && ps.trending.length ? ps.trending : ps.top) || [];
    if (trend.length >= 4) bits.append(shelf({ title: "Trending", count: trend.length,
      tiles: trend.map((p) => {
        const gm = (state.cache[p.sys] || []).find((x) => x.file === p.file);
        const art = el("div", { className: "tile-art" });
        if (gm && gm.img) art.append(el("img", { src: artUrl(gm.img), loading: "lazy", alt: p.name }));
        else art.append(el("div", { className: "ph", textContent: p.name }));
        art.append(el("span", { className: "badge", textContent: "Play" }));
        return el("a", { className: "tile wide",
          href: `#/play/${p.sys}/${p.file.split("/").map(encodeURIComponent).join("/")}` }, art,
          el("div", { className: "tile-cap" },
            el("div", { className: "t", textContent: p.name }),
            el("div", { className: "s", textContent: `${sysName(p.sys)} · ${p.count} play${p.count === 1 ? "" : "s"}` })));
      }) }));
    if (added && added.length) bits.append(shelf({ title: "Recently added", count: added.length,
      tiles: added.slice(0, 24).map((r) => refTile(r)) }));
    if (cols && cols.length) {
      const pick = [...cols].sort(() => Math.random() - 0.5).slice(0, 3);
      for (const c of pick) bits.append(shelf({ title: c.title, count: c.items.length,
        moreHref: `#/collection/${c.id}`, tiles: c.items.slice(0, 20).map((r) => refTile(r)) }));
    }
    if (fr && fr.length) bits.append(shelf({ title: "Franchises", count: fr.length, moreHref: "#/franchises",
      tiles: fr.slice(0, 24).map((f) => {
        const cover = el("div", { className: "tile-art console coll-cover" });
        (f.items.filter((i) => i[3]).slice(0, 4)).forEach((i) => cover.append(el("img", { src: artUrl(i[3]), loading: "lazy", alt: "" })));
        cover.append(el("span", { className: "coll-label", textContent: f.title }));
        return el("a", { className: "tile", href: `#/franchise/${f.id}` }, cover,
          el("div", { className: "tile-cap" }, el("div", { className: "t", textContent: f.title }),
            el("div", { className: "s", textContent: f.note })));
      }) }));
    anchor.replaceWith(bits);
  });

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
      linkTile("#/collections", "🗂", "Collections", "Curated & by genre"),
      linkTile("#/franchises", "🎯", "Franchises", "Mario, Zelda, Sonic…"),
      linkTile("#/contact", "📡", "Contact", "Socials & Discord"),
      linkTile("#/favorites", "♥", "Favorites", "Your starred games"),
      linkTile("#/saves", "☁", "Cloud saves", "Resume on any device"),
      linkTile("#/profile", "👤", "Profile", signedIn() ? AUTH.user.display : "Sign in & settings"),
      linkTile("#/stats", "📊", "Stats", "Trending & reports"),
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
  document.title = `${m.name} — ShadowSwords`;
  const genres = [...new Set(games.map((g) => g.genre).filter(Boolean))].sort();
  const years = games.map((g) => g.year).filter(Boolean);
  const decades = [...new Set(years.map((y) => Math.floor(y / 10) * 10))].sort();
  const hasPlayers = games.some((g) => g.players);
  const arty = games.filter((g) => g.img).slice(0, 20).map((g) => g.img);

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "Console", title: m.name,
    desc: `${games.length.toLocaleString()} games${m.withArt ? `, ${m.withArt} with box art` : ""}${m.playable ? " · playable in your browser" : ""}.`,
    art: arty.length ? collage(arty) : sysArt(m),
    actions: m.playable
      ? [{ label: "▶ Play these", href: `#/play/${id}`, primary: true }, { label: "🎲 Random", onClick: () => surpriseMe(id) }]
      : [],
  }));

  const fText = el("input", { type: "search", placeholder: "Filter titles…" });
  const fGenre = el("select", {}, el("option", { value: "", textContent: "All genres" }),
    ...genres.map((x) => el("option", { value: x, textContent: x })));
  const fDecade = decades.length > 1 ? el("select", {}, el("option", { value: "", textContent: "Any era" }),
    ...decades.map((d) => el("option", { value: String(d), textContent: d + "s" }))) : null;
  const fArt = el("label", { className: "chk" }, el("input", { type: "checkbox" }), " box art only");
  const fMulti = hasPlayers ? el("label", { className: "chk" }, el("input", { type: "checkbox" }), " 2+ players") : null;
  const fSort = el("select", {},
    el("option", { value: "name", textContent: "A–Z" }), el("option", { value: "-name", textContent: "Z–A" }),
    el("option", { value: "-year", textContent: "Newest" }), el("option", { value: "art", textContent: "Box art first" }));
  frag.append(el("div", { className: "grid-tools" }, fText, fGenre, fDecade, fSort, fArt, fMulti));
  const box = el("div", {});
  frag.append(box);
  view.replaceChildren(frag);

  const apply = () => {
    const q = fText.value.trim().toLowerCase(), gv = fGenre.value;
    const dv = fDecade && fDecade.value ? +fDecade.value : null;
    const artOnly = fArt.querySelector("input").checked;
    const multi = fMulti && fMulti.querySelector("input").checked;
    let list = games.filter((g) =>
      (!q || g.name.toLowerCase().includes(q)) &&
      (!gv || g.genre === gv) &&
      (!dv || (g.year && g.year >= dv && g.year < dv + 10)) &&
      (!artOnly || g.img) &&
      (!multi || (g.players && /[2-9]|multi/i.test(String(g.players)))));
    const cmp = {
      "name": (a, b) => a.name.localeCompare(b.name), "-name": (a, b) => b.name.localeCompare(a.name),
      "-year": (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name),
      "art": (a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.name.localeCompare(b.name),
    }[fSort.value];
    tileGrid(box, [...list].sort(cmp), PAGE);
  };
  fText.oninput = debounce(apply, 150);
  for (const c of [fGenre, fDecade, fSort, fArt, fMulti]) if (c) c.onchange = apply;
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
    art: g.img ? el("img", { src: artUrl(g.img), alt: g.name })
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

  const CART_SYS = new Set(["nes", "fds", "snes", "satellaview", "gb", "gbc", "gba", "genesis",
    "megadrive", "megadrivejp", "mastersystem", "sg-1000", "gamegear", "pcengine", "supergrafx",
    "atari2600", "atari5200", "atari7800", "atarilynx", "wonderswan", "wonderswancolor",
    "ngp", "ngpc", "virtualboy", "colecovision", "sega32x"]);
  const canOffline = CART_SYS.has(id) && games.length <= 600 && !meta(id).bios;

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "Play", title: m.name,
    desc: `${games.length.toLocaleString()} games, ready to run. Streamed from the home server — pick one.`,
    art: sysArt(m),
    actions: [
      { label: "🎲 Random game", primary: true, onClick: () => surpriseMe(id) },
      canOffline ? { label: "⬇ Save all for offline", onClick: () => offlineDownload(id, games) } : null,
      { label: "Or upload a ROM", onClick: () => $("#rom-input")?.click() },
    ].filter(Boolean),
  }));
  frag.append(el("div", { className: "wrap", style: "padding-bottom:6px" }, dropzone()));
  const NOTE = {
    cps1: "Arcade emulation needs romsets that match EmulatorJS's exact FBNeo build. Many current CPS romsets show a “missing files for THIS VERSION” error — that's the romset, not a bug.",
    cps2: "Arcade emulation needs romsets that match EmulatorJS's exact FBNeo build. Many current CPS romsets show a “missing files for THIS VERSION” error — that's the romset, not a bug.",
    mame: "Arcade emulation needs romsets that match the mame2003-plus (0.78) set. Newer romsets won't load.",
    neogeo: "Neo Geo needs a matching FBNeo romset + neogeo.zip BIOS. Hit-or-miss.",
    amiga: "Amiga (PUAE) is experimental in EmulatorJS and often won't boot — WHDLoad/ADF quirks.",
    satellaview: "Satellaview .bs files load via the BS-X BIOS; some titles still drop to the emulator menu.",
    pcecd: "PC Engine CD boots via the syscard3 BIOS, but multi-track / .cue disc images are hit-or-miss in the mednafen core — a black screen usually means the disc format, not a missing file.",
    "tg-cd": "TurboGrafx-CD boots via the syscard3 BIOS, but multi-track / .cue disc images are hit-or-miss in the mednafen core.",
    segacd: "Sega CD needs the region BIOS; multi-track .cue images sometimes hang at a black screen.",
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
// the service worker's EmulatorJS core-file cache (populated as you play)
async function ejsCacheStats() {
  try {
    const c = await caches.open("ssw-ejs");
    const keys = await c.keys();
    let bytes = 0;
    for (const k of keys) {
      const r = await c.match(k);
      const len = +(r && r.headers.get("content-length"));
      bytes += len || (r ? (await r.clone().blob()).size : 0);
    }
    return { count: keys.length, bytes };
  } catch { return { count: 0, bytes: 0 }; }
}
async function ejsCacheClear() {
  try { await caches.delete("ssw-ejs"); } catch { /* */ }
  navigator.serviceWorker?.controller?.postMessage("clear-ejs");
}
// exposed for the native wrapper's offline UX
window.sswOfflineStats = async () => {
  const [rom, ejs] = await Promise.all([romCacheStats(), ejsCacheStats()]);
  return { rom, ejs, offlineReady: ejs.count > 2 };
};
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
// cache a ROM without producing an object URL (bulk "save for offline")
async function cacheRom(key, url) {
  if (await idbGetIn("romcache", key).catch(() => null)) return 0;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const blob = await resp.blob();
  if (blob.size <= ROM_CACHE_MAX_ITEM) {
    await romCacheEvict(blob.size);
    await idbPutIn("romcache", key, { blob, size: blob.size, t: Date.now() });
  }
  return blob.size;
}
async function offlineDownload(sys, games) {
  const CAP = 500 * 1048576;
  let cancel = false, done = 0, bytes = 0;
  const bar = el("div", { className: "dl-bar" }, el("i"));
  const stat = el("div", { className: "hint", style: "margin:10px 0" });
  const o = el("div", { id: "help-overlay" },
    el("div", { className: "help-card", style: "min-width:320px" },
      el("h3", { textContent: `Saving ${sysName(sys)} for offline` }),
      el("p", { className: "hint", style: "margin:0 0 10px", textContent: "Downloads into your browser's ROM cache (1.5 GB, oldest evicted first). You can keep browsing." }),
      stat, bar,
      el("button", { className: "btn btn-ghost", style: "margin-top:12px", textContent: "Stop",
        onclick: () => { cancel = true; o.remove(); toast(`Saved ${done} games offline`); } })));
  document.body.append(o);
  const list = games.filter((g) => !/\.(chd|iso|cue|pbp|bin)$/i.test(g.file));
  for (const g of list) {
    if (cancel || bytes > CAP) break;
    const key = sys + "/" + g.file;
    const url = ROM_BASE + "rom/" + encodeURIComponent(sys) + "/" + g.file.split("/").map(encodeURIComponent).join("/");
    try { bytes += await cacheRom(key, url); } catch { /* skip */ }
    done++;
    stat.textContent = `${done} / ${list.length} · ${fmtBytes(bytes)}`;
    bar.firstChild.style.width = (done / list.length * 100).toFixed(1) + "%";
  }
  if (!cancel) { o.remove(); toast(`✅ ${sysName(sys)} saved for offline (${done} games, ${fmtBytes(bytes)})`); }
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

function reportGame(sys, file, name) {
  const opts = ["Won't boot / black screen", "Crashes while playing", "Graphics glitches",
    "No sound", "Wrong / missing BIOS", "Controls don't work"];
  const o = el("div", { id: "help-overlay", onclick: (e) => { if (e.target.id === "help-overlay") o.remove(); } },
    el("div", { className: "help-card" },
      el("h3", { textContent: "Report a problem" }),
      el("p", { className: "hint", style: "margin:0 0 12px", textContent: name }),
      ...opts.map((label) => el("button", { className: "btn btn-ghost", style: "display:block;width:100%;margin:6px 0;text-align:left",
        onclick: async () => {
          o.remove();
          try {
            await fetch(`${API}/report`, { method: "POST", headers: { "content-type": "application/json", ...tokenHdr() },
              body: JSON.stringify({ sys, file, name, issue: label }) });
            toast("Thanks — logged it 👍");
          } catch { toast("Couldn't send the report"); }
        } })),
      el("button", { className: "btn btn-ghost", style: "margin-top:8px", textContent: "Cancel", onclick: () => o.remove() })));
  document.body.append(o);
}
const tokenHdr = () => { const t = LS.get("token", ""); return t ? { "x-ssw-token": t } : {}; };

async function routePlayGame(sys, romParam, resume = false) {
  ++state.render;
  if (window.__emuUp) { location.reload(); return; }
  window.__emuUp = true;
  if (MP.ai && !MP.ai.paused) { MP.ai.pause(); toast("Music paused for the game"); }
  await getSystems().catch(() => {});

  const loadEl = el("div", { className: "player-load", id: "player-load" }, "Booting emulator…");
  const saveBtn = el("button", { className: "pbtn", id: "cloud-save", textContent: "☁ Save", title: "Save state to the server", hidden: true });
  const loadBtn = el("button", { className: "pbtn", id: "cloud-load", textContent: "☁ Load", title: "Load the last server save state", hidden: true });
  const flagBtn = el("button", { className: "pbtn", id: "flag-btn", textContent: "⚑", title: "Report a problem with this game" });
  if (sys !== "upload") flagBtn.onclick = () => reportGame(sys, file, romName);
  else flagBtn.hidden = true;
  const shell = el("div", { className: "player" },
    el("div", { className: "player-bar" },
      el("button", { className: "exit", textContent: "‹ Exit", onclick: exitPlayer }),
      el("div", { className: "title", id: "player-title", textContent: "Loading…" }),
      saveBtn, loadBtn, flagBtn),
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
  window.EJS_Buttons = { restart: true, settings: true, fullscreen: true, saveState: true,
    loadState: true, screenshot: true, cheat: true, gamepad: true };
  window.EJS_RETROACHIEVEMENTS = true;          // enables the RA login in the settings menu (build-permitting)
  const vf = prefs().videoFilter;
  window.EJS_defaultOptions = vf === "crt" ? { shader: "crt-aperture.glslp" }
    : vf === "smooth" ? { shader: "bicubic.glslp" } : {};
  // Netplay signalling server — tailnet default; override with localStorage ssw:netplay ("off" disables).
  const np = LS.get("netplay", NETPLAY_URL);
  if (np && np !== "off") { window.EJS_netplayServer = np; window.EJS_Buttons.netplay = true; }

  // cloud save-states — the stable EmulatorJS build has no onSaveState hook, so
  // we drive it ourselves via gameManager.getState()/loadState() + our own buttons.
  const key = sys === "upload" ? null : stateKey(sys, file);
  const wantResume = resume || prefs().autoResume;
  let hasCloudSave = false;
  if (key && wantResume) {
    try { hasCloudSave = (await fetch(key, { method: "HEAD", headers: authHdr() })).ok; } catch { /* offline */ }
  }
  const cloudSave = async () => {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm) return;
    if (prefs().confirmOverwrite && hasCloudSave && !confirm("Overwrite your cloud save for this game?")) return;
    try {
      const data = gm.getState();
      await fetch(key, { method: "PUT", headers: { "content-type": "application/octet-stream", ...tokenHdr(), ...authHdr() }, body: data });
      hasCloudSave = true;
      toast("Saved to the server ☁");
    } catch { toast("Cloud save failed"); }
  };
  const cloudLoad = async () => {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm) return;
    try {
      const buf = await fetch(key, { headers: authHdr() }).then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); });
      gm.loadState(new Uint8Array(buf));
      toast("Server save state loaded");
    } catch { toast("No server save state for this game"); }
  };

  // silent cloud auto-save (no toast) — on a timer and on exit
  const autoSave = async () => {
    const g2 = window.EJS_emulator?.gameManager;
    if (!key || !g2) return;
    try { await fetch(key, { method: "PUT", headers: { "content-type": "application/octet-stream", ...tokenHdr(), ...authHdr() }, body: g2.getState() }); }
    catch { /* offline */ }
  };
  window.__emuAutoSave = autoSave;

  // play-stats ping + local playtime accounting
  const ptKey = sys === "upload" ? null : `${sys}/${file}`;
  let ptStart = 0;
  const ping = (start) => fetch(`${API}/play/ping`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sys, file, name: romName, start, cid: CID }),
  }).catch(() => {});
  const flushPlaytime = () => {
    if (!ptKey || !ptStart) return;
    const secs = Math.round((Date.now() - ptStart) / 1000);
    ptStart = Date.now();
    if (secs > 0 && secs < 7200) {
      const pt = LS.get("playtime", {}); pt[ptKey] = (pt[ptKey] || 0) + secs; LS.set("playtime", pt);
    }
  };

  window.EJS_onGameStart = () => {
    $("#player-load")?.remove();
    ptStart = Date.now();
    ping(true);
    window.__emuHeartbeat = setInterval(() => { ping(false); flushPlaytime(); }, 60000);
    window.__emuAutoSaveT = key ? setInterval(autoSave, 180000) : 0;
    if (key) {
      saveBtn.hidden = false; saveBtn.onclick = cloudSave;
      loadBtn.hidden = false; loadBtn.onclick = cloudLoad;
      if (hasCloudSave) setTimeout(cloudLoad, 400);
    }
  };
  window.__emuFlush = flushPlaytime;

  const s = el("script", { src: EMU_DATA + "loader.js" });
  s.onerror = () => { const l = $("#player-load"); if (l) l.textContent = "Emulator failed to load (CDN blocked?)."; };
  document.body.append(s);
}
function emuCleanup() {
  clearInterval(window.__emuHeartbeat); clearInterval(window.__emuAutoSaveT);
  try { window.__emuFlush?.(); } catch { /* */ }
}
async function exitPlayer() {
  emuCleanup();
  try { await window.__emuAutoSave?.(); } catch { /* */ }
  window.__emuUp = false; location.hash = "#/play"; location.reload();
}
window.addEventListener("beforeunload", () => { if (window.__emuUp) { emuCleanup(); navigator.sendBeacon?.(`${API}/play/ping`, JSON.stringify({ cid: CID, bye: true })); } });

/* ---- routes: movies ----------------------------------------- */
const JF = (SELF_HOSTED ? "" : TS) + "/jellyfin/";
const jfImg = (it) => it.ImageTags && it.ImageTags.Primary
  ? `${JF}Items/${it.Id}/Images/Primary?maxWidth=320&tag=${it.ImageTags.Primary}` : null;
const jfOpen = (id) => MOVIES_URL + "web/#/details?id=" + id;
let _jfUser;
const jfUser = () => _jfUser ||= fetch(`${JF}Users`).then((r) => r.json())
  .then((us) => (us.find((u) => !u.Policy?.IsAdministrator) || us[0] || {}).Id).catch(() => null);

async function movieShelf(title, url) {
  const items = await fetch(url).then((r) => r.json())
    .then((d) => Array.isArray(d) ? d : d.Items || []).catch(() => []);
  if (!items.length) return null;
  return shelf({ title, count: items.length, tiles: items.slice(0, 20).map((it) => movieCard(it)) });
}

function movieLinkoutPane() {
  const host = (() => { try { return new URL(MOVIES_URL).host; } catch { return MOVIES_URL; } })();
  return el("section", { className: "pane" },
    el("div", { className: "big-emoji", textContent: "🎬" }),
    el("h1", { textContent: "Movie library" }),
    el("p", { textContent: "The full film & TV collection, streamed from the home server" + (IN_APP ? "." : ". Opens the Jellyfin player in a new tab — sign in with the shared account.") }),
    el("a", { className: "btn btn-primary", href: MOVIES_URL, ...extTarget, textContent: IN_APP ? "Open the movie library" : "Open the movie library ↗" }),
    el("div", { className: "hint" }, "Jellyfin at ", el("code", { textContent: host }),
      " — if it doesn't load, the server may be off or you're not on the tailnet."));
}

function movieCard(it) {
  const art = el("div", { className: "tile-art" });
  const src = jfImg(it);
  if (src) art.append(el("img", { src, loading: "lazy", alt: it.Name }));
  else art.append(el("div", { className: "ph", textContent: it.Name }));
  art.append(el("span", { className: "badge", textContent: "▶" }));
  const a = el("a", { className: "tile wide", href: "javascript:void 0", onclick: () => movieDetail(it) }, art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: it.Name }),
      el("div", { className: "s", textContent: [it.ProductionYear, it.OfficialRating].filter(Boolean).join(" · ") })));
  return a;
}
async function movieDetail(it) {
  const full = await fetch(`${JF}Items/${it.Id}?Fields=Overview,Genres,People`).then((r) => r.json()).catch(() => it);
  const back = full.BackdropImageTags && full.BackdropImageTags[0]
    ? `${JF}Items/${full.Id}/Images/Backdrop/0?maxWidth=1200&tag=${full.BackdropImageTags[0]}` : jfImg(full);
  const o = el("div", { id: "movie-modal", onclick: (e) => { if (e.target.id === "movie-modal") o.remove(); } },
    el("div", { className: "mv-card" },
      back && el("div", { className: "mv-back", style: `background-image:url("${back}")` }),
      el("button", { className: "mv-x", textContent: "✕", onclick: () => o.remove() }),
      el("div", { className: "mv-body" },
        el("h2", { textContent: full.Name }),
        el("div", { className: "mv-meta", textContent: [full.ProductionYear,
          full.RunTimeTicks && Math.round(full.RunTimeTicks / 600000000) + " min",
          (full.Genres || []).slice(0, 3).join(", "), full.OfficialRating].filter(Boolean).join("  ·  ") }),
        full.Overview && el("p", { className: "mv-ov", textContent: full.Overview }),
        el("a", { className: "btn btn-primary", href: jfOpen(full.Id), ...extTarget,
          textContent: IN_APP ? "Play in Jellyfin" : "Play in Jellyfin ↗" }))));
  document.body.append(o);
}

async function routeMovies() {
  const token = ++state.render;
  spinner();
  document.title = "Movies — ShadowSwords";
  const probe = await fetch(`${JF}Items?IncludeItemTypes=Movie&Recursive=true&Limit=0&EnableTotalRecordCount=true`)
    .then((r) => r.ok ? r.json() : null).catch(() => null);
  if (token !== state.render) return;
  if (!probe) { view.replaceChildren(movieLinkoutPane()); return; }
  const total = probe.TotalRecordCount || 0;
  const genres = await fetch(`${JF}Genres?IncludeItemTypes=Movie&Recursive=true&SortBy=SortName`)
    .then((r) => r.json()).then((d) => d.Items.map((g) => g.Name)).catch(() => []);

  const fText = el("input", { type: "search", placeholder: "Search movies…" });
  const fGenre = el("select", {}, el("option", { value: "", textContent: "All genres" }),
    ...genres.map((g) => el("option", { value: g, textContent: g })));
  const fSort = el("select", {},
    el("option", { value: "SortName", textContent: "A–Z" }),
    el("option", { value: "ProductionYear,SortName", textContent: "Newest" }),
    el("option", { value: "DateCreated,SortName", textContent: "Recently added" }),
    el("option", { value: "Random", textContent: "Shuffle" }),
    el("option", { value: "CommunityRating,SortName", textContent: "Top rated" }));
  const box = el("div", {});
  const head = el("div", { className: "shelf-head" }, el("h2", { textContent: "Movies" }),
    el("span", { className: "count", id: "mv-count", textContent: total.toLocaleString() }),
    el("a", { href: MOVIES_URL, ...extTarget, textContent: "Open Jellyfin ›" }));

  const shelves = el("div");
  view.replaceChildren(el("div", { className: "wrap" },
    shelves,
    el("section", { className: "shelf", style: "padding:22px 0 0" }, head),
    el("div", { className: "grid-tools", style: "padding:0" }, fText, fGenre, fSort),
    box));

  // Continue watching + Just added rows (best-effort)
  (async () => {
    const uid = await jfUser();
    const frag2 = document.createDocumentFragment();
    if (uid) {
      const cw = await movieShelf("Continue watching",
        `${JF}Users/${uid}/Items/Resume?IncludeItemTypes=Movie&Limit=20&Fields=ProductionYear,OfficialRating&EnableImageTypes=Primary`);
      if (cw) frag2.append(cw);
    }
    const la = await movieShelf("Just added",
      `${JF}Items?IncludeItemTypes=Movie&Recursive=true&SortBy=DateCreated&SortOrder=Descending&Limit=20&Fields=ProductionYear,OfficialRating`);
    if (la) frag2.append(la);
    if (location.hash.startsWith("#/movies")) shelves.replaceWith(frag2);
  })();

  let loaded = [], idx = 0, busy = false, done = false, myToken;
  const PAGEM = 60;
  const load = async (reset) => {
    if (busy) return; busy = true;
    if (reset) { loaded = []; idx = 0; done = false; myToken = Symbol(); box.replaceChildren(spinnerEl()); }
    const t = myToken;
    const p = new URLSearchParams({ IncludeItemTypes: "Movie", Recursive: "true",
      Fields: "PrimaryImageAspectRatio,ProductionYear,OfficialRating",
      ImageTypeLimit: "1", StartIndex: idx, Limit: PAGEM,
      SortBy: fSort.value === "Random" ? "Random" : fSort.value,
      SortOrder: /Year|Rating|DateCreated/.test(fSort.value) ? "Descending" : "Ascending" });
    if (fText.value.trim()) p.set("SearchTerm", fText.value.trim());
    if (fGenre.value) p.set("Genres", fGenre.value);
    const res = await fetch(`${JF}Items?${p}`).then((r) => r.json()).catch(() => ({ Items: [] }));
    if (t !== myToken) { busy = false; return; }
    loaded.push(...res.Items); idx += res.Items.length;
    if (res.Items.length < PAGEM) done = true;
    const grid = box.querySelector(".tile-grid") || el("div", { className: "tile-grid", style: "padding:0" });
    if (reset) grid.replaceChildren();
    res.Items.forEach((it) => grid.append(movieCard(it)));
    const more = el("button", { className: "more", textContent: "Show more",
      onclick: () => load(false) });
    box.replaceChildren(grid);
    if (!done) box.append(more);
    else if (!loaded.length) box.replaceChildren(el("div", { className: "empty-state", textContent: "No movies match." }));
    busy = false;
  };
  fText.oninput = debounce(() => load(true), 350);
  fGenre.onchange = fSort.onchange = () => load(true);
  load(true);
}
const spinnerEl = () => el("div", { className: "spinner", textContent: "Loading…" });

/* ---- music: a player that survives navigation --------------- */
const cleanAlbum = (n) => parseAlbum(n).album;
function parseAlbum(name) {
  const m = name.match(/^(.+?)\s+[-–]\s+(.+)$/);
  let artist = m ? m[1] : "";
  let album = (m ? m[2] : name)
    .replace(/\[[^\]]*\]/g, "").replace(/\([^)]*\)/g, "")
    .replace(/\s[-–]\s*[A-Za-z0-9]{1,14}$/, "")     // trailing "-Sc4r3cr0w" release tag
    .replace(/(\s+(FLAC|MP3|320kbps|320|V0|WEB|vtwin88cube?))+$/i, "")
    .replace(/\s{2,}/g, " ").trim();
  artist = artist.replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
  return { artist, album: album || name };
}
const fmtTime = (s) => !isFinite(s) || s < 0 ? "0:00"
  : `${(s / 60) | 0}:${String((s % 60) | 0).padStart(2, "0")}`;
function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; }

// order = [{alb, tr}] play queue; pos = index into it; ctxAlb = source album (-1 = whole library)
// the page owns the OS media session only in a browser; inside the native
// wrapper the app runs its own MediaSession (SSMediaBridge) to avoid flicker.
const MS = (!IN_APP && "mediaSession" in navigator) ? navigator.mediaSession : null;
const MP = { data: null, ai: null, order: [], pos: -1, ctxAlb: -1, alb: -1, tr: -1,
  shuffle: false, repeat: "off", ctx: null, an: null, src: null, _viz: 0 };
const musicArtUrl = (name) => MUSIC_BASE + "art/" + encodeURIComponent(name);
const mpCur = () => MP.order[MP.pos] || null;
const allTrackRefs = () => MP.data.albums.flatMap((a, alb) => a.tracks.map((_, tr) => ({ alb, tr })));
const albTrackRefs = (alb) => MP.data.albums[alb].tracks.map((_, tr) => ({ alb, tr }));

async function mpData() {
  if (!MP.data) MP.data = await fetch(MUSIC_BASE + "index.json").then((r) => r.json()).catch(() => null);
  return MP.data;
}
function mpBar() {
  let b = $("#mini-player");
  if (b) return b;
  const prog = el("div", { className: "mp-prog", id: "mp-prog" }, el("i", { id: "mp-prog-fill" }));
  prog.onclick = (e) => {
    const ai = MP.ai; if (!ai || !isFinite(ai.duration)) return;
    const r = prog.getBoundingClientRect();
    ai.currentTime = ((e.clientX - r.left) / r.width) * ai.duration;
  };
  b = el("div", { id: "mini-player", hidden: true },
    el("img", { id: "mp-art", alt: "", hidden: true }),
    el("button", { className: "mp-b", id: "mp-prev", textContent: "⏮", title: "Previous", onclick: mpPrev }),
    el("button", { className: "mp-b mp-play", id: "mp-toggle", textContent: "▶", onclick: mpToggle }),
    el("button", { className: "mp-b", id: "mp-next", textContent: "⏭", title: "Next", onclick: mpNext }),
    el("div", { className: "mp-meta", id: "mp-meta" },
      el("div", { className: "mp-t", id: "mp-title", onclick: () => { location.hash = "#/music" + (MP.alb >= 0 ? "/" + MP.alb : ""); } }),
      el("div", { className: "mp-s", id: "mp-sub" }),
      el("div", { className: "mp-prog-row" }, el("span", { id: "mp-cur", textContent: "0:00" }), prog, el("span", { id: "mp-dur", textContent: "0:00" }))),
    el("button", { className: "mp-b mp-sh", id: "mp-shuffle", textContent: "🔀", title: "Shuffle", onclick: mpToggleShuffle }),
    el("button", { className: "mp-b mp-rp", id: "mp-repeat", textContent: "🔁", title: "Repeat", onclick: mpCycleRepeat }),
    el("button", { className: "mp-b", id: "mp-close", textContent: "✕", title: "Stop", onclick: mpStop }));
  document.body.append(b);
  return b;
}
function mpAudio() {
  if (MP.ai) return MP.ai;
  MP.ai = $("#player-audio");
  MP.ai.hidden = true;
  MP.ai.addEventListener("ended", () => { if (MP.repeat === "one") { MP.ai.currentTime = 0; MP.ai.play(); } else mpNext(); });
  MP.ai.addEventListener("play", mpSync);
  MP.ai.addEventListener("pause", mpSync);
  MP.ai.addEventListener("timeupdate", mpTick);
  MP.ai.addEventListener("loadedmetadata", mpTick);
  if (MS) {
    const set = (a, fn) => { try { MS.setActionHandler(a, fn); } catch { /* unsupported */ } };
    set("play", () => { MP.ai.play(); });
    set("pause", () => { MP.ai.pause(); });
    set("previoustrack", () => mpPrev());
    set("nexttrack", () => mpNext());
    set("stop", () => mpStop());
    set("seekto", (e) => { if (e.seekTime != null && isFinite(MP.ai.duration)) MP.ai.currentTime = e.seekTime; });
    set("seekforward", (e) => { MP.ai.currentTime = Math.min(MP.ai.duration || 1e9, MP.ai.currentTime + (e.seekOffset || 10)); });
    set("seekbackward", (e) => { MP.ai.currentTime = Math.max(0, MP.ai.currentTime - (e.seekOffset || 10)); });
  }
  return MP.ai;
}
function mpTick() {
  const ai = MP.ai; if (!ai) return;
  const f = $("#mp-prog-fill");
  if (f && isFinite(ai.duration)) f.style.width = (ai.currentTime / ai.duration * 100) + "%";
  const c = $("#mp-cur"), d = $("#mp-dur");
  if (c) c.textContent = fmtTime(ai.currentTime);
  if (d) d.textContent = fmtTime(ai.duration);
  if (MS && isFinite(ai.duration) && "setPositionState" in MS) {
    try { MS.setPositionState({ duration: ai.duration, position: ai.currentTime, playbackRate: ai.playbackRate }); } catch { /* */ }
  }
}
function mpViz(canvas) {
  const ai = mpAudio();
  try {
    if (!MP.ctx) {
      MP.ctx = new (window.AudioContext || window.webkitAudioContext)();
      MP.src = MP.ctx.createMediaElementSource(ai);
      MP.an = MP.ctx.createAnalyser(); MP.an.fftSize = 128;
      MP.src.connect(MP.an); MP.an.connect(MP.ctx.destination);
    }
    MP.ctx.resume?.();
  } catch { return; }
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const bins = MP.an.frequencyBinCount, buf = new Uint8Array(bins);
  cancelAnimationFrame(MP._viz);
  const draw = () => {
    MP._viz = requestAnimationFrame(draw);
    if (!canvas.isConnected) return cancelAnimationFrame(MP._viz);
    const w = canvas.width = canvas.clientWidth, h = canvas.height = canvas.clientHeight;
    MP.an.getByteFrequencyData(buf);
    g.clearRect(0, 0, w, h);
    const bw = w / bins;
    for (let i = 0; i < bins; i++) {
      const v = buf[i] / 255, bh = v * h;
      const grad = g.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, "#22e0ff"); grad.addColorStop(1, "#ff33c6");
      g.fillStyle = grad;
      g.fillRect(i * bw + 1, h - bh, bw - 2, bh);
    }
  };
  draw();
}
function mpSync() {
  const ai = MP.ai; if (!ai) return;
  const playing = !ai.paused && !ai.ended;
  const t = $("#mp-toggle"); if (t) t.textContent = playing ? "⏸" : "▶";
  $$(".track").forEach((r) => r.classList.toggle("playing",
    +r.dataset.alb === MP.alb && +r.dataset.tr === MP.tr));
  $$(".album-btn").forEach((b) => b.classList.toggle("nowplaying", +b.dataset.alb === MP.alb));
  if (MS && MP.data && MP.alb >= 0) {
    const alb = MP.data.albums[MP.alb], tr = alb.tracks[MP.tr], meta = parseAlbum(alb.name);
    const art = alb.art ? [{ src: new URL(musicArtUrl(alb.name), location.href).href, sizes: "512x512", type: "image/jpeg" }] : [];
    MS.metadata = new MediaMetadata({
      title: tr.title, album: meta.album, artist: meta.artist || "ShadowSwords", artwork: art });
    MS.playbackState = playing ? "playing" : "paused";
  }
  const q = $("#mp-queue-list");
  if (q) $$("#mp-queue-list .qrow").forEach((r, i) => r.classList.toggle("playing", i === MP.pos));
  if (window.SSMusic) mpEmit();
}
function mpLoad(pos) {
  const d = MP.data; if (!d) return;
  MP.pos = Math.max(0, Math.min(pos, MP.order.length - 1));
  const ref = mpCur(); if (!ref) return;
  MP.alb = ref.alb; MP.tr = ref.tr;
  const alb = d.albums[ref.alb], tk = alb.tracks[ref.tr], m = parseAlbum(alb.name);
  const ai = mpAudio();
  ai.src = MUSIC_BASE + "file/" + tk.file.split("/").map(encodeURIComponent).join("/");
  ai.play().catch(() => {});
  mpBar().hidden = false;
  document.body.classList.add("has-mp");
  $("#mp-title").textContent = tk.title;
  $("#mp-sub").textContent = [m.artist, m.album].filter(Boolean).join(" — ");
  const art = $("#mp-art");
  if (alb.art) { art.src = musicArtUrl(alb.name); art.hidden = false; } else art.hidden = true;
  document.title = `▶ ${tk.title} — ShadowSwords`;
  mpViz();
  mpSync();
}
function mpQueueAlbum(albIdx, shuffle) {
  MP.ctxAlb = albIdx;
  MP.shuffle = !!shuffle;
  MP.order = albTrackRefs(albIdx);
  if (shuffle) shuffleInPlace(MP.order);
  $("#mp-shuffle")?.classList.toggle("on", MP.shuffle);
  mpLoad(0);
  renderQueue();
}
function mpQueueAll(shuffle) {
  MP.ctxAlb = -1;
  MP.shuffle = !!shuffle;
  MP.order = allTrackRefs();
  if (shuffle) shuffleInPlace(MP.order);
  $("#mp-shuffle")?.classList.toggle("on", MP.shuffle);
  mpLoad(0);
  renderQueue();
}
// clicking a track in a list
function mpPlayTrackAt(albIdx, trIdx) {
  if (MP.ctxAlb === albIdx && MP.order.length) {
    const at = MP.order.findIndex((x) => x.alb === albIdx && x.tr === trIdx);
    if (at >= 0) return mpLoad(at);
  }
  // fresh context from this album
  MP.ctxAlb = albIdx;
  MP.order = albTrackRefs(albIdx);
  if (MP.shuffle) {
    const pick = MP.order.splice(trIdx, 1)[0];
    shuffleInPlace(MP.order);
    MP.order.unshift(pick);
    mpLoad(0);
  } else mpLoad(trIdx);
  renderQueue();
}
function mpToggle() { const ai = MP.ai; if (!ai) return; ai.paused ? ai.play().catch(() => {}) : ai.pause(); }
function mpNext() {
  if (!MP.order.length) return;
  if (MP.pos + 1 < MP.order.length) return mpLoad(MP.pos + 1);
  if (MP.repeat === "all") return mpLoad(0);
  // reached the end
  MP.ai && MP.ai.pause();
}
function mpPrev() {
  if (!MP.order.length) return;
  if (MP.ai && MP.ai.currentTime > 3) { MP.ai.currentTime = 0; return; }
  if (MP.pos > 0) return mpLoad(MP.pos - 1);
  if (MP.repeat === "all") return mpLoad(MP.order.length - 1);
  MP.ai.currentTime = 0;
}
function mpToggleShuffle() {
  MP.shuffle = !MP.shuffle;
  $("#mp-shuffle")?.classList.toggle("on", MP.shuffle);
  const cur = mpCur();
  const base = MP.ctxAlb >= 0 ? albTrackRefs(MP.ctxAlb) : allTrackRefs();
  if (MP.shuffle && cur) {
    const rest = base.filter((x) => !(x.alb === cur.alb && x.tr === cur.tr));
    shuffleInPlace(rest);
    MP.order = [cur, ...rest]; MP.pos = 0;
  } else if (cur) {
    MP.order = base;
    MP.pos = base.findIndex((x) => x.alb === cur.alb && x.tr === cur.tr);
  }
  toast(MP.shuffle ? "🔀 Shuffle on" : "Shuffle off");
  renderQueue(); mpSync();
}
function mpCycleRepeat() {
  MP.repeat = MP.repeat === "off" ? "all" : MP.repeat === "all" ? "one" : "off";
  const b = $("#mp-repeat");
  if (b) { b.textContent = MP.repeat === "one" ? "🔂" : "🔁"; b.classList.toggle("on", MP.repeat !== "off"); }
  toast(MP.repeat === "off" ? "Repeat off" : MP.repeat === "all" ? "🔁 Repeat album" : "🔂 Repeat track");
}
function mpStop() {
  if (MP.ai) { MP.ai.pause(); MP.ai.removeAttribute("src"); MP.ai.load(); }
  MP.order = []; MP.pos = MP.alb = MP.tr = -1; MP.ctxAlb = -1;
  const b = $("#mini-player"); if (b) b.hidden = true;
  document.body.classList.remove("has-mp");
  cancelAnimationFrame(MP._viz);
  if (MS) MS.playbackState = "none";
}

// stable API for the native app wrapper (media-session bridge)
window.SSMusic = {
  next: () => mpNext(),
  prev: () => mpPrev(),
  toggle: () => mpToggle(),
  play: () => MP.ai && MP.ai.play().catch(() => {}),
  pause: () => MP.ai && MP.ai.pause(),
  stop: () => mpStop(),
  seek: (sec) => { if (MP.ai && isFinite(MP.ai.duration)) MP.ai.currentTime = Math.max(0, Math.min(+sec || 0, MP.ai.duration)); },
  getState: () => {
    const ai = MP.ai, cur = mpCur();
    if (!ai || !cur || !MP.data) return { playing: false, active: false };
    const alb = MP.data.albums[cur.alb], m = parseAlbum(alb.name);
    return {
      active: true,
      playing: !ai.paused && !ai.ended,
      title: alb.tracks[cur.tr].title,
      artist: m.artist || "ShadowSwords",
      album: m.album,
      artworkUrl: alb.art ? new URL(musicArtUrl(alb.name), location.href).href : null,
      position: ai.currentTime || 0,
      duration: isFinite(ai.duration) ? ai.duration : 0,
      shuffle: MP.shuffle,
      repeat: MP.repeat,
      queueLength: MP.order.length,
      queuePos: MP.pos,
    };
  },
};
// fired on every track / play-state change so the wrapper can update the native session without polling
function mpEmit() {
  try { window.dispatchEvent(new CustomEvent("ssmusic", { detail: window.SSMusic.getState() })); } catch { /* */ }
  if (window.SSMediaBridge?.update) try { window.SSMediaBridge.update(JSON.stringify(window.SSMusic.getState())); } catch { /* */ }
}
function renderQueue() {
  const host = $("#mp-queue-list"); if (!host) return;
  const panel = host.closest(".queue-panel");
  if (panel) panel.hidden = MP.pos < 0 || !MP.order.length;
  const upcoming = MP.order.slice(MP.pos, MP.pos + 40);
  host.replaceChildren(...upcoming.map((ref, i) => {
    const alb = MP.data.albums[ref.alb], tk = alb.tracks[ref.tr];
    return el("div", { className: "qrow" + (i === 0 ? " playing" : ""), onclick: () => mpLoad(MP.pos + i) },
      el("span", { className: "q-t", textContent: tk.title }),
      el("span", { className: "q-a", textContent: parseAlbum(alb.name).album }));
  }));
  const c = $("#mp-queue-count");
  if (c) c.textContent = `${MP.order.length - MP.pos - 1} up next`;
}

async function routeMusic(albumIdx) {
  const token = ++state.render;
  spinner();
  const data = await mpData();
  if (token !== state.render) return;
  if (!data || !data.albums.length) {
    view.replaceChildren(el("section", { className: "pane center" },
      el("div", { className: "big-emoji", textContent: "🎧" }),
      el("h1", { textContent: "Music" }),
      el("p", { textContent: "No music on the server yet — drop albums into the Music folder and they'll show up here." }),
      el("div", { className: "hint" }, "Served from ", el("code", { textContent: new URL(MUSIC_BASE, location.href).host }))));
    return;
  }
  document.title = "Music — ShadowSwords";
  const idx = Math.min(Math.max(0, albumIdx | 0), data.albums.length - 1);
  const album = data.albums[idx];
  const am = parseAlbum(album.name);

  const trackList = el("div", { className: "track-list" },
    ...album.tracks.map((t, i) => el("div", {
      className: "track" + (MP.alb === idx && MP.tr === i ? " playing" : ""),
      tabIndex: 0, dataset: { alb: String(idx), tr: String(i) },
      onkeydown: (e) => { if (e.key === "Enter") mpPlayTrackAt(idx, i); },
      onclick: () => mpPlayTrackAt(idx, i),
    },
      el("span", { className: "num", textContent: String(i + 1).padStart(2, "0") }),
      el("span", { textContent: t.title }),
      el("span", { className: "tk-play", textContent: "▶" }))));

  const viz = el("canvas", { className: "viz" });

  // searchable album list (with artist / album split)
  const albSearch = el("input", { type: "search", className: "alb-search", placeholder: "Filter albums…" });
  const albumList = el("div", { className: "album-list" });
  const drawAlbums = () => {
    const q = albSearch.value.trim().toLowerCase();
    albumList.replaceChildren(...data.albums.map((a, i) => {
      const m = parseAlbum(a.name);
      if (q && !(m.album + " " + m.artist + " " + a.name).toLowerCase().includes(q)) return null;
      return el("button", {
        className: "album-btn" + (i === idx ? " active" : "") + (MP.alb === i ? " nowplaying" : ""),
        dataset: { alb: String(i) },
        onclick: () => { location.hash = `#/music/${i}`; },
      },
        a.art
          ? el("img", { className: "alb-thumb", src: musicArtUrl(a.name), loading: "lazy", alt: "" })
          : el("span", { className: "alb-thumb ph", textContent: "♪" }),
        el("span", { className: "alb-txt" },
          el("span", { textContent: m.album }),
          el("small", { textContent: `${m.artist ? m.artist + " · " : ""}${a.tracks.length} track${a.tracks.length > 1 ? "s" : ""}` })));
    }).filter(Boolean));
  };
  albSearch.oninput = debounce(drawAlbums, 120);
  drawAlbums();

  const albHead = el("div", { className: "alb-head" });
  if (album.art) albHead.append(el("img", { className: "alb-cover", src: musicArtUrl(album.name), alt: "" }));
  albHead.append(el("div", { className: "alb-head-info" },
    am.artist && el("div", { className: "alb-artist", textContent: am.artist }),
    el("h3", { style: "margin:2px 0 8px", textContent: am.album }),
    el("div", { className: "alb-actions" },
      el("button", { className: "btn btn-primary sm", textContent: "▶ Play", onclick: () => mpQueueAlbum(idx, prefs().musicShuffle === true) }),
      el("button", { className: "btn btn-ghost sm", textContent: "🔀 Shuffle album", onclick: () => mpQueueAlbum(idx, true) }))));

  const queuePanel = el("div", { className: "queue-panel", hidden: MP.pos < 0 },
    el("div", { className: "queue-head" }, el("h4", { textContent: "Up next" }),
      el("span", { className: "hint", id: "mp-queue-count" })),
    el("div", { id: "mp-queue-list" }));

  view.replaceChildren(el("div", { className: "wrap" },
    el("section", { className: "shelf", style: "padding:22px 0 6px" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: "Music" }),
        el("span", { className: "count", textContent: `${data.albums.length} album${data.albums.length > 1 ? "s" : ""}` }),
        el("a", { href: "javascript:void 0", textContent: "🔀 Shuffle everything", onclick: () => mpQueueAll(true) }))),
    el("div", { className: "music-layout" },
      el("div", { className: "album-col" }, albSearch, albumList),
      el("div", {}, albHead, queuePanel, trackList, viz))));
  mpBar();
  mpAudio();
  renderQueue();
  if (MP.alb >= 0) mpViz(viz);
}

/* ---- routes: contact ---------------------------------------- */
function requestForm() {
  const title = el("input", { type: "text", placeholder: "Game or system you'd like added", maxLength: 200 });
  const who = el("input", { type: "text", placeholder: "Your name / handle (optional)", maxLength: 60 });
  const note = el("textarea", { placeholder: "Anything else? (optional)", rows: 2, maxLength: 500 });
  const btn = el("button", { className: "btn btn-primary", textContent: "Send request" });
  const status = el("div", { className: "hint", style: "margin-top:8px" });
  btn.onclick = async () => {
    if (!title.value.trim()) { status.textContent = "Enter a game first."; return; }
    btn.disabled = true; status.textContent = "Sending…";
    try {
      const r = await fetch(`${API}/request`, { method: "POST", headers: { "content-type": "application/json", ...tokenHdr() },
        body: JSON.stringify({ title: title.value, who: who.value, note: note.value }) });
      if (r.ok) { status.textContent = "Sent — thanks! It'll show up in the Discord."; title.value = note.value = ""; }
      else if (r.status === 501) status.textContent = "Requests aren't wired up yet — ask in the Discord for now.";
      else status.textContent = "Couldn't send — try the Discord instead.";
    } catch { status.textContent = "Couldn't reach the server — you may be off the tailnet."; }
    btn.disabled = false;
  };
  return el("div", { className: "req-form" },
    el("h3", { textContent: "Request a game" }), title, who, note, btn, status);
}
function routeContact() {
  ++state.render;
  document.title = "Contact — ShadowSwords";
  const dc = el("div", { className: "discord-cta" },
    el("div", {}, el("strong", { style: "font-size:16px", textContent: "💬  Discord server" }),
      el("div", { className: "dc-sub", style: "color:var(--muted);font-size:13px", textContent: "The best place to reach me." })),
    el("a", { className: "btn btn-primary", href: DISCORD, ...extTarget, textContent: "Join the Discord ↗" }));
  fetch(`${API}/discord/info`).then((r) => r.json()).then((d) => {
    if (d && d.online != null) dc.querySelector(".dc-sub").textContent =
      `${d.members?.toLocaleString() || "?"} members · ${d.online.toLocaleString()} online now`;
  }).catch(() => {});
  view.replaceChildren(el("section", { className: "pane" },
    el("div", { className: "big-emoji", textContent: "📡" }),
    el("h1", { textContent: "Contact & Socials" }),
    el("p", { textContent: "Follow ShadowSwords everywhere, or jump into the Discord to chat, request games, or report anything broken." }),
    el("div", { className: "socials" },
      ...SOCIALS.map(([name, url, ic, col]) => el("a", { className: "social", href: url, ...extTarget },
        el("span", { className: "ic", style: `color:${col}`, textContent: ic }),
        el("span", {}, name, el("small", { textContent: url.replace(/^https?:\/\/(www\.)?/, "") }))))),
    dc,
    requestForm()));
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

/* ---- discovery: collections / franchises / recently added -- */
const _json = {};
const getJSON = (name) => _json[name] ||= fetch(`data/${name}.json`).then((r) => r.json()).catch(() => null);

// [name, sys, gid, img] -> tile
function refTile(r) {
  const [name, sys, gid, img] = r;
  const playable = meta(sys).playable;
  const art = el("div", { className: "tile-art" });
  if (img) art.append(el("img", { src: artUrl(img), loading: "lazy", alt: name }));
  else art.append(el("div", { className: "ph", textContent: name }));
  if (playable) art.append(el("span", { className: "badge", textContent: "Play" }));
  art.append(heartBtn({ _sys: sys, id: gid, name, img: img || null }));
  return el("a", { className: "tile wide", href: `#/g/${sys}/${gid}` }, art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: name }),
      el("div", { className: "s", textContent: sysName(sys) })));
}
function refGrid(box, items, shown = PAGE) {
  const grid = el("div", { className: "tile-grid" });
  items.slice(0, shown).forEach((r) => grid.append(refTile(r)));
  const parts = [grid];
  if (items.length > shown) parts.push(el("button", { className: "more",
    textContent: `Show more · ${items.length - shown} left`, onclick: () => refGrid(box, items, shown + PAGE) }));
  box.replaceChildren(...parts);
}

async function routeStats() {
  ++state.render; spinner();
  await getSystems().catch(() => {});
  document.title = "Stats — ShadowSwords";
  const s = await fetch(`${API}/play/stats`).then((r) => r.json()).catch(() => null);
  if (!s) { view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "📊" }), el("h1", { textContent: "Stats" }),
    el("p", { textContent: "Can't reach the stats server — you may be off the tailnet." }))); return; }
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Library stats" }),
      s.playingNow ? el("span", { className: "count", textContent: `${s.playingNow} playing now` }) : null)));
  const gtile = (p, extra) => {
    const gm = (state.cache[p.sys] || []).find((x) => x.file === p.file);
    const art = el("div", { className: "tile-art" });
    if (gm && gm.img) art.append(el("img", { src: artUrl(gm.img), loading: "lazy", alt: p.name }));
    else art.append(el("div", { className: "ph", textContent: p.name }));
    if (meta(p.sys).playable) art.append(el("span", { className: "badge", textContent: "Play" }));
    return el("a", { className: "tile wide",
      href: `#/play/${p.sys}/${p.file.split("/").map(encodeURIComponent).join("/")}` }, art,
      el("div", { className: "tile-cap" }, el("div", { className: "t", textContent: p.name }),
        el("div", { className: "s", textContent: `${sysName(p.sys)} · ${extra(p)}` })));
  };
  if (s.top && s.top.length) frag.append(shelf({ title: "Most played", count: s.top.length,
    tiles: s.top.map((p) => gtile(p, (x) => `${x.count} play${x.count === 1 ? "" : "s"}`)) }));
  if (s.reported && s.reported.length) {
    const box = el("div", {});
    const grid = el("div", { className: "tile-grid" });
    s.reported.forEach((p) => grid.append(gtile(p, (x) =>
      `${x.n} report${x.n === 1 ? "" : "s"} · ${Object.keys(x.issues || {})[0] || "issue"}`)));
    box.append(grid);
    frag.append(el("section", { className: "shelf", style: "padding:10px var(--pad) 0" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: "Reported problems" }),
        el("span", { className: "count", textContent: `${s.reported.length}` }))),
      el("div", { className: "wrap" }, box));
  }
  view.replaceChildren(frag);
}

async function routeCollections() {
  ++state.render; spinner();
  await getSystems().catch(() => {});
  const cols = await getJSON("collections") || [];
  document.title = "Collections — ShadowSwords";
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Collections" }),
      el("span", { className: "count", textContent: `${cols.length}` }))));
  const grid = el("div", { className: "tile-grid", style: "padding:0 var(--pad) 30px;max-width:1600px;margin:0 auto" });
  for (const c of cols) {
    const cover = el("div", { className: "tile-art console coll-cover" });
    (c.items.filter((i) => i[3]).slice(0, 4)).forEach((i) => cover.append(el("img", { src: artUrl(i[3]), loading: "lazy", alt: "" })));
    cover.append(el("span", { className: "coll-label", textContent: c.title }));
    grid.append(el("a", { className: "tile", href: `#/collection/${c.id}` }, cover,
      el("div", { className: "tile-cap" }, el("div", { className: "t", textContent: c.title }),
        el("div", { className: "s", textContent: c.note || `${c.items.length} games` }))));
  }
  frag.append(el("div", { className: "wrap" }, grid));
  view.replaceChildren(frag);
}
async function routeCollection(id) {
  ++state.render; spinner();
  await getSystems().catch(() => {});
  const c = (await getJSON("collections") || []).find((x) => x.id === id)
    || (await getJSON("franchises") || []).find((x) => x.id === id);
  if (!c) { location.hash = "#/collections"; return; }
  document.title = `${c.title} — ShadowSwords`;
  const box = el("div", {});
  view.replaceChildren(el("div", { className: "wrap" },
    el("section", { className: "shelf", style: "padding:22px 0 0" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: c.title }),
        el("span", { className: "count", textContent: `${c.items.length}` }),
        el("a", { href: "#/collections", textContent: "All collections ›" })),
      box)));
  refGrid(box, c.items);
}
const routeFranchise = routeCollection;
async function routeFranchises() {
  ++state.render; spinner();
  await getSystems().catch(() => {});
  const fr = await getJSON("franchises") || [];
  document.title = "Franchises — ShadowSwords";
  const grid = el("div", { className: "tile-grid", style: "padding:0 var(--pad) 30px;max-width:1600px;margin:0 auto" });
  for (const f of fr) {
    const cover = el("div", { className: "tile-art console coll-cover" });
    (f.items.filter((i) => i[3]).slice(0, 4)).forEach((i) => cover.append(el("img", { src: artUrl(i[3]), loading: "lazy", alt: "" })));
    cover.append(el("span", { className: "coll-label", textContent: f.title }));
    grid.append(el("a", { className: "tile", href: `#/franchise/${f.id}` }, cover,
      el("div", { className: "tile-cap" }, el("div", { className: "t", textContent: f.title }),
        el("div", { className: "s", textContent: f.note }))));
  }
  view.replaceChildren(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Franchises" }),
      el("span", { className: "count", textContent: `${fr.length}` }))),
    el("div", { className: "wrap" }, grid));
}

/* ---- routes: favorites / recent / cloud saves / cache ------- */
function favTile(f) {
  const play = !!f.file;
  const art = el("div", { className: "tile-art" });
  if (f.img) art.append(el("img", { src: artUrl(f.img), loading: "lazy", alt: f.name }));
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
  const saves = await fetch(STATE_BASE + "list", { headers: authHdr() }).then((r) => r.json()).catch(() => null);
  if (token !== state.render) return;
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Cloud save states" }),
      el("span", { className: "count", textContent: saves ? `${saves.length}` : "—" }),
      signedIn() ? el("span", { className: "hint", textContent: `signed in as ${AUTH.user.display}` })
        : el("a", { href: "#/login", textContent: "Sign in to keep saves private ›" }))));
  const grid = el("div", { className: "tile-grid" });
  if (!saves) {
    grid.append(el("div", { className: "empty-state", textContent: "Can't reach the save-state server — you may be off the tailnet." }));
  } else if (!saves.length) {
    grid.append(el("div", { className: "empty-state", textContent: "No cloud saves yet. Save a state from the emulator menu and it syncs here automatically." }));
  } else {
    saves.sort((a, b) => b.mtime - a.mtime).forEach((s) => {
      const gm = (state.cache[s.sys] || []).find((x) => x.file === s.file);
      const art = el("div", { className: "tile-art" });
      if (gm && gm.img) art.append(el("img", { src: artUrl(gm.img), loading: "lazy", alt: s.name }));
      else art.append(el("div", { className: "ph", textContent: s.name }));
      art.append(el("span", { className: "badge", textContent: s.shared ? "Shared" : "Resume" }));
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
  document.title = "Offline & cache — ShadowSwords";
  const [st, ejs] = await Promise.all([romCacheStats(), ejsCacheStats()]);
  const pct = Math.min(100, st.bytes / ROM_CACHE_CAP * 100);
  const bar = el("div", { className: "dl-bar" }, el("i", { style: `width:${pct.toFixed(1)}%` }));
  const clearBtn = el("button", { className: "btn btn-ghost", textContent: "Clear ROM cache" });
  clearBtn.onclick = async () => { await romCacheClear(); toast("ROM cache cleared"); routeCache(); };
  const clearEjs = el("button", { className: "btn btn-ghost", textContent: "Clear emulator files" });
  clearEjs.onclick = async () => { await ejsCacheClear(); toast("Emulator cache cleared"); routeCache(); };
  const tokIn = el("input", { type: "password", placeholder: "access token (only if the site is public)",
    value: LS.get("token", ""), style: "width:100%;max-width:340px;padding:9px 12px;background:var(--bg-1);color:var(--text);border:1px solid var(--line-2);border-radius:9px;outline:none" });
  tokIn.onchange = () => { LS.set("token", tokIn.value.trim()); toast("Saved"); };
  const section = (title, body) => el("div", { style: "margin-top:22px;border-top:1px solid var(--line);padding-top:18px;text-align:left" },
    el("h3", { style: "margin:0 0 8px;font-size:15px", textContent: title }), body);
  view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "💾" }),
    el("h1", { textContent: "Offline & cache" }),
    el("p", { textContent: `Downloaded ROMs are kept in your browser so replaying a game is instant — capped at ${fmtBytes(ROM_CACHE_CAP)}, oldest evicted first.` }),
    el("p", { className: "hint", style: "margin:0 0 6px", textContent: `${st.count} ROM${st.count === 1 ? "" : "s"} cached · ${fmtBytes(st.bytes)} used` }),
    bar,
    el("div", { style: "margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap" }, clearBtn),

    section("Play offline", el("div", {},
      el("p", { className: "hint", style: "margin:0 0 6px" },
        "Each console's emulator is saved the first time you play a game on it. After that, a saved emulator + a cached ROM (use “Save all for offline” on a console page) = plays with no connection."),
      el("p", { className: "hint", style: "margin:0 0 10px" },
        `${ejs.count} emulator file${ejs.count === 1 ? "" : "s"} saved · ${fmtBytes(ejs.bytes)}${ejs.count > 2 ? " · ✅ some consoles ready offline" : ""}`),
      clearEjs)),

    section("Install", el("p", { className: "hint", style: "margin:0" },
      "This site installs as an app — look for “Install” / “Add to Home Screen” in your browser menu.")),

    section("Access token", el("div", {},
      el("p", { className: "hint", style: "margin:0 0 8px" }, "Only needed if this instance has been made public with a write password."),
      tokIn))));
}

const AVATARS = ["🎮", "👾", "🕹️", "🎯", "🦊", "🐉", "⚡", "💀", "🍄", "👑", "🚀", "🎸", "🌚", "🔥", "🧙", "🤖"];

function signInPrompt() {
  return el("div", { className: "acct-card" },
    el("div", { className: "acct-av", textContent: "👤" }),
    el("div", { style: "flex:1;min-width:0" },
      el("strong", { textContent: "Not signed in" }),
      el("div", { className: "hint", textContent: "Cloud saves, favorites and settings are stored on this device only." })),
    el("a", { className: "btn btn-primary", href: "#/login", textContent: "Sign in" }));
}
function accountCard() {
  const u = AUTH.user;
  const nameIn = el("input", { type: "text", value: u.display, maxLength: 40, style: "font-weight:700;font-size:15px" });
  const avPick = el("div", { className: "av-grid" },
    ...AVATARS.map((a) => el("button", { className: "av-opt" + (a === u.avatar ? " on" : ""), textContent: a,
      onclick: async () => {
        try { const d = await apiAuth("update", { avatar: a }); setSession(null, d.user); toast("Avatar updated"); routeProfile(); }
        catch { toast("Couldn't save"); }
      } })));
  const saveName = el("button", { className: "btn btn-ghost sm", textContent: "Save name", onclick: async () => {
    try { const d = await apiAuth("update", { display: nameIn.value }); setSession(null, d.user); toast("Saved"); }
    catch { toast("Couldn't save"); }
  } });
  // change password
  const pOld = el("input", { type: "password", placeholder: "Current password", autocomplete: "current-password" });
  const pNew = el("input", { type: "password", placeholder: "New password", autocomplete: "new-password" });
  const pStatus = el("div", { className: "hint" });
  const pBtn = el("button", { className: "btn btn-ghost sm", textContent: "Change password", onclick: async () => {
    pStatus.textContent = "";
    try {
      const d = await apiAuth("update", { password: pOld.value, newPassword: pNew.value });
      if (d.token) AUTH.token = d.token, LS.set("auth", d.token);
      setSession(null, d.user); pOld.value = pNew.value = ""; pStatus.textContent = "Password changed ✓";
    } catch (e) { pStatus.textContent = e.message || "Couldn't change password"; }
  } });
  return el("div", {},
    el("div", { className: "acct-card" },
      el("div", { className: "acct-av", textContent: u.avatar }),
      el("div", { style: "flex:1;min-width:0" }, nameIn,
        el("div", { className: "hint", textContent: `@${u.name} · joined ${new Date(u.created).toLocaleDateString()}` })),
      saveName,
      el("button", { className: "btn btn-ghost sm", textContent: "Sign out",
        onclick: () => { signOut(); routeProfile(); } })),
    el("details", { className: "acct-more" },
      el("summary", { textContent: "Avatar & password" }),
      el("div", { style: "padding:12px 2px 4px" },
        el("div", { className: "hint", style: "margin-bottom:6px", textContent: "Avatar" }), avPick,
        el("div", { className: "hint", style: "margin:16px 0 6px", textContent: "Change password" }),
        el("div", { className: "pw-row" }, pOld, pNew), pBtn, pStatus)));
}
function settingsCard() {
  const p = prefs();
  const toggle = (k, label, hint) => {
    const cb = el("input", { type: "checkbox", checked: p[k] === true });
    cb.onchange = () => setPref(k, cb.checked);
    return el("label", { className: "set-row" }, cb,
      el("div", {}, el("div", { textContent: label }), hint && el("div", { className: "hint", textContent: hint })));
  };
  const select = (k, label, opts) => {
    const s = el("select", {}, ...opts.map(([v, t]) => el("option", { value: v, textContent: t, selected: p[k] === v })));
    s.onchange = () => setPref(k, s.value);
    return el("label", { className: "set-row" }, s, el("div", {}, el("div", { textContent: label })));
  };
  return el("div", {},
    el("h3", { style: "margin:22px 0 10px", textContent: "Settings" }),
    el("div", { className: "set-list" },
      select("videoFilter", "Emulator video filter", [["pixel", "Pixel-perfect"], ["smooth", "Smooth"], ["crt", "CRT / scanlines"]]),
      select("region", "Prefer game region", [["", "No preference"], ["USA", "USA"], ["Europe", "Europe"], ["Japan", "Japan"]]),
      toggle("autoResume", "Auto-resume cloud saves", "Load your last save automatically when you open a game"),
      toggle("musicShuffle", "Shuffle albums by default", "Start an album shuffled when you hit Play"),
      toggle("lite", "Lite mode", "Drop the scanlines, glow and animations"),
      toggle("playingToasts", "Show “people playing now” popups", ""),
      toggle("confirmOverwrite", "Confirm before overwriting a cloud save", "")),
    signedIn()
      ? el("div", { className: "hint", style: "margin-top:8px", textContent: "Settings are saved to your account and sync across devices." })
      : el("div", { className: "hint", style: "margin-top:8px" }, "Settings are stored on this device. ",
        el("a", { href: "#/login", textContent: "Sign in" }), " to sync them."));
}

async function routeLogin() {
  ++state.render;
  document.title = "Sign in — ShadowSwords";
  if (signedIn()) { location.hash = "#/profile"; return; }
  let mode = "in";  // "in" | "up"
  const uName = el("input", { type: "text", placeholder: "Username", autocomplete: "username", maxLength: 24 });
  const uPw = el("input", { type: "password", placeholder: "Password", autocomplete: "current-password" });
  const status = el("div", { className: "hint", style: "margin:8px 0;min-height:16px" });
  const submit = el("button", { className: "btn btn-primary", style: "width:100%" });
  const toggle = el("a", { href: "javascript:void 0" });
  const render = () => {
    submit.textContent = mode === "in" ? "Sign in" : "Create account";
    toggle.textContent = mode === "in" ? "New here? Create an account" : "Already have an account? Sign in";
    uPw.autocomplete = mode === "in" ? "current-password" : "new-password";
    document.title = (mode === "in" ? "Sign in" : "Create account") + " — ShadowSwords";
  };
  toggle.onclick = () => { mode = mode === "in" ? "up" : "in"; status.textContent = ""; render(); };
  const go = async () => {
    status.textContent = ""; submit.disabled = true;
    try {
      const d = await apiAuth(mode === "in" ? "login" : "register",
        { username: uName.value.trim(), password: uPw.value });
      setSession(d.token, d.user);
      toast(`Welcome, ${d.user.display}`);
      location.hash = "#/profile";
    } catch (e) { status.textContent = e.message || "Something went wrong"; }
    submit.disabled = false;
  };
  submit.onclick = go;
  uPw.onkeydown = (e) => { if (e.key === "Enter") go(); };
  render();
  view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "🔐" }),
    el("h1", { textContent: "Your account" }),
    el("p", { textContent: "Sign in so your cloud save-states, favorites and settings follow you to every device." }),
    el("div", { className: "auth-form" }, uName, uPw, status, submit,
      el("div", { style: "margin-top:14px" }, toggle))));
}

async function routeProfile() {
  ++state.render; spinner();
  await getSystems().catch(() => {});
  document.title = "Your profile — ShadowSwords";
  const favs = favList(), recent = recentList();
  const played = LS.get("playtime", {});          // sys/file -> seconds
  const totalSec = Object.values(played).reduce((n, s) => n + s, 0);
  const systemsTouched = new Set([...recent.map((r) => r.sys), ...Object.keys(played).map((k) => k.split("/")[0])]).size;
  const rc = await romCacheStats();
  const hrs = totalSec / 3600;
  const stat = (n, l) => el("div", { className: "stat" },
    el("div", { className: "stat-n", textContent: n }), el("div", { className: "stat-l", textContent: l }));
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Your profile" }))));

  frag.append(el("div", { className: "wrap" }, signedIn() ? accountCard() : signInPrompt()));
  frag.append(el("div", { className: "wrap" }, settingsCard()));

  frag.append(
    el("div", { className: "wrap" },
      el("h3", { style: "margin:22px 0 10px", textContent: "Activity" }),
      el("div", { className: "stat-row" },
        stat(hrs >= 1 ? hrs.toFixed(1) + " h" : Math.round(totalSec / 60) + " m", "played in browser"),
        stat(recent.length, "games launched"),
        stat(favs.length, "favorites"),
        stat(systemsTouched, "systems"),
        stat(fmtBytes(rc.bytes), "ROMs cached"))));
  if (recent.length) frag.append(shelf({ title: "Continue playing", count: recent.length,
    tiles: recent.map((r) => favTile({ sys: r.sys, id: null, name: r.name, img: r.img, file: r.file })) }));
  if (favs.length) frag.append(shelf({ title: "Favorites", count: favs.length, moreHref: "#/favorites",
    tiles: favs.slice(0, 24).map((f) => favTile(f)) }));
  const impInput = el("input", { type: "file", accept: ".json", hidden: true });
  impInput.onchange = async () => {
    const f = impInput.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (Array.isArray(d.favs)) LS.set("favs", d.favs);
      if (Array.isArray(d.recent)) LS.set("recent", d.recent);
      if (d.playtime) LS.set("playtime", d.playtime);
      if (d.netplay) LS.set("netplay", d.netplay);
      toast("Imported — reloading"); setTimeout(() => location.reload(), 800);
    } catch { toast("That's not a valid export file"); }
  };
  frag.append(el("div", { className: "wrap", style: "padding:8px var(--pad) 40px;display:flex;gap:10px;flex-wrap:wrap" },
    el("a", { className: "btn btn-ghost", href: "#/cache", textContent: "Manage offline cache" }),
    el("button", { className: "btn btn-ghost", textContent: "Export favorites & data", onclick: () => {
      const blob = new Blob([JSON.stringify({ favs: favList(), recent: recentList(),
        playtime: LS.get("playtime", {}), exported: new Date().toISOString() }, null, 2)], { type: "application/json" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "shadowswords-profile.json" });
      document.body.append(a); a.click(); a.remove();
    } }),
    el("button", { className: "btn btn-ghost", textContent: "Import", onclick: () => impInput.click() }), impInput));
  view.replaceChildren(frag);
}

// arcade systems whose romsets rarely match EmulatorJS's FBNeo/MAME build —
// fine to try on purpose, but keep them out of the random pool
const RANDOM_SKIP = new Set(["neogeo", "cps1", "cps2", "mame", "amiga", "amiga500"]);
async function surpriseMe(sysId) {
  await getSystems().catch(() => {});
  let s;
  if (sysId) s = meta(sysId);
  else {
    const pool = state.sys.systems.filter((x) => x.playable && x.count && !RANDOM_SKIP.has(x.id));
    s = pool[Math.random() * pool.length | 0];
  }
  toast("🎲 Rolling…");
  const region = prefs().region;
  let games = await getSystem(s.id).catch(() => []);
  if (!games.length) { if (!sysId) return surpriseMe(); toast("No games there"); return; }
  if (region) {
    const inRegion = games.filter((g) => (g.region || "").toLowerCase().includes(region.toLowerCase())
      || new RegExp(`\\(${region === "USA" ? "USA|U" : region === "Japan" ? "Japan|J" : "Europe|E"}[,)]`, "i").test(g.file));
    if (inRegion.length >= 5) games = inRegion;
  }
  const g = games[Math.random() * games.length | 0];
  location.hash = `#/play/${s.id}/${g.file.split("/").map(encodeURIComponent).join("/")}`;
}

async function searchRows(q, limit = 600) {
  if (SELF_HOSTED) {
    const r = await fetch(`${API}/search?q=${encodeURIComponent(q)}&limit=${limit}`).then((x) => x.json()).catch(() => null);
    if (r) return r;
  }
  const rows = await getSearch();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((x) => terms.every((t) => x[0].toLowerCase().includes(t)))
    .sort((a, b) => b[4] - a[4] || a[0].localeCompare(b[0])).slice(0, limit);
}
async function routeSearch(qRaw) {
  const token = ++state.render;
  const q = qRaw.trim();
  spinner();
  document.title = `“${qRaw}” — ShadowSwords`;
  await getSystems();
  let hits = await searchRows(q);
  if (token !== state.render) return;
  const need = [...new Set(hits.slice(0, PAGE).map((r) => r[1]))];
  await Promise.all(need.map((id) => getSystem(id).catch(() => [])));
  if (token !== state.render) return;
  const toGame = (r) => (state.cache[r[1]] || []).find((x) => x.id === r[2]) || { name: r[0], id: r[2], _sys: r[1], year: r[3] || null };

  const box = el("div", {});
  const mvBox = el("div", {});
  view.replaceChildren(el("div", { className: "wrap" },
    mvBox,
    el("section", { className: "shelf", style: "padding:22px 0 0" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: `Games — “${qRaw}”` }),
        el("span", { className: "count", textContent: `${hits.length}${hits.length === 600 ? "+" : ""}` })),
      box)));
  tileGrid(box, hits.map(toGame), PAGE);

  // also search movies (best-effort)
  fetch(`${JF}Items?IncludeItemTypes=Movie&Recursive=true&SearchTerm=${encodeURIComponent(q)}&Limit=12&Fields=ProductionYear,OfficialRating`)
    .then((r) => r.json()).then((d) => {
      if (token !== state.render || !d.Items || !d.Items.length) return;
      const grid = el("div", { className: "tile-grid" });
      d.Items.forEach((it) => grid.append(movieCard(it)));
      mvBox.replaceChildren(el("section", { className: "shelf", style: "padding:22px 0 0" },
        el("div", { className: "shelf-head" }, el("h2", { textContent: `Movies — “${qRaw}”` }),
          el("span", { className: "count", textContent: `${d.Items.length}` }))), grid);
    }).catch(() => {});
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
const _scrollY = {};
async function router() {
  const parts = parseHash();
  const [a, b] = parts;
  // an emulator is live and we're navigating away from it -> hard reset (kills audio/RAF)
  if (window.__emuUp && !((a === "play" || a === "resume") && parts.length > 2)) {
    emuCleanup(); try { window.__emuAutoSave?.(); } catch { /* */ }
    window.__emuUp = false; setTimeout(() => location.reload(), 60); return;
  }
  if (a !== "q") $("#bar-search").hidden = true;
  window.scrollTo(0, 0);
  document.title = "ShadowSwords Arcade";
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
  if (a === "profile") { setNav(null); return routeProfile(); }
  if (a === "login") { setNav(null); return routeLogin(); }
  if (a === "stats") { setNav(null); return routeStats(); }
  if (a === "collections") { setNav(null); return routeCollections(); }
  if (a === "collection" && b) { setNav(null); return routeCollection(b); }
  if (a === "franchises") { setNav(null); return routeFranchises(); }
  if (a === "franchise" && b) { setNav(null); return routeFranchise(b); }
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
const acBox = el("div", { className: "ac", hidden: true });
sf.append(acBox);
let acHits = [], acSel = -1;
const acRender = () => {
  acBox.replaceChildren(...acHits.map((r, i) => el("div", {
    className: "ac-row" + (i === acSel ? " sel" : ""),
    onmousedown: (e) => { e.preventDefault(); location.hash = `#/g/${r[1]}/${r[2]}`; sf.hidden = true; },
  }, el("span", { className: "ac-t", textContent: r[0] }),
    el("span", { className: "ac-s", textContent: sysName(r[1]) }))));
  acBox.hidden = !acHits.length;
};
qi.addEventListener("input", debounce(async () => {
  const v = qi.value.trim();
  if (v.length < 2) { acBox.hidden = true; acHits = []; if (location.hash.startsWith("#/q/")) location.hash = "#/"; return; }
  await getSystems().catch(() => {});
  acHits = (await searchRows(v, 8)) || []; acSel = -1; acRender();
}, 180));
qi.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { acBox.hidden = true; sf.hidden = true; qi.blur(); return; }
  if (e.key === "ArrowDown" && acHits.length) { acSel = Math.min(acSel + 1, acHits.length - 1); acRender(); e.preventDefault(); }
  else if (e.key === "ArrowUp" && acHits.length) { acSel = Math.max(acSel - 1, -1); acRender(); e.preventDefault(); }
  else if (e.key === "Enter") {
    const v = qi.value.trim();
    if (acSel >= 0) { location.hash = `#/g/${acHits[acSel][1]}/${acHits[acSel][2]}`; sf.hidden = true; }
    else if (v.length >= 2) location.hash = `#/q/${encodeURIComponent(v)}`;
    acBox.hidden = true;
  }
});
qi.addEventListener("blur", () => setTimeout(() => { acBox.hidden = true; }, 150));

/* ---- lite mode + reduced motion ------------------------------ */
// migrate the old standalone ssw:lite key into settings
{ const old = LS.get("lite", null); if (old !== null && LS.get("settings", {}).lite === undefined) setPref("lite", old === true); }
if (matchMedia("(prefers-reduced-motion: reduce)").matches && LS.get("lite", null) === null && LS.get("settings", {}).lite === undefined) {
  document.body.classList.add("lite");
}
applyPrefs();
window.toggleLite = () => { setPref("lite", !(prefs().lite === true)); toast(document.body.classList.contains("lite") ? "Lite mode on" : "Lite mode off"); };

/* ---- account chip in the header ---------------------------- */
function renderAcctChip() {
  let c = $("#acct-chip");
  if (!c) {
    c = el("a", { id: "acct-chip", href: "#/profile" });
    ($("#bar-right") || $("#bar")).prepend(c);
  }
  c.replaceChildren(el("span", { className: "ac-av", textContent: AUTH.user ? AUTH.user.avatar : "👤" }),
    el("span", { className: "ac-name", textContent: AUTH.user ? AUTH.user.display : "Sign in" }));
  c.href = AUTH.user ? "#/profile" : "#/login";
  // mirror into the mobile drawer
  const dl = $('#drawer a[data-nav="profile"]');
  if (dl) dl.textContent = AUTH.user ? `${AUTH.user.avatar} ${AUTH.user.display}` : "Sign in / Profile";
}
addEventListener("ssw-auth", renderAcctChip);
addEventListener("ssw-prefs", applyPrefs);
renderAcctChip();
hydrateAuth();

/* ---- keyboard shortcuts ------------------------------------- */
const HELP = [["/", "search"], ["g h", "home"], ["g p", "play"], ["g m", "music"], ["g v", "videos"],
  ["g f", "favorites"], ["r", "random game"], ["l", "toggle lite mode"], ["?", "this help"]];
let _kchord = 0;
addEventListener("keydown", (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || window.__emuUp || e.metaKey || e.ctrlKey || e.altKey) return;
  const now = Date.now();
  if (_kchord && now - _kchord < 900) {
    _kchord = 0;
    const map = { h: "#/", p: "#/play", m: "#/music", v: "#/videos", f: "#/favorites", c: "#/contact", s: "#/saves" };
    if (map[e.key]) { location.hash = map[e.key]; return; }
  }
  if (e.key === "g") { _kchord = now; return; }
  if (e.key === "/") { e.preventDefault(); sf.hidden = false; qi.focus(); }
  else if (e.key === "?") toggleHelp();
  else if (e.key === "r") surpriseMe();
  else if (e.key === "l") window.toggleLite();
  else if (e.key === "Escape") $("#help-overlay")?.remove();
});
window.toggleHelp = toggleHelp;
function toggleHelp() {
  const ex = $("#help-overlay"); if (ex) { ex.remove(); return; }
  const o = el("div", { id: "help-overlay", onclick: (e) => { if (e.target.id === "help-overlay") o.remove(); } },
    el("div", { className: "help-card" }, el("h3", { textContent: "Keyboard shortcuts" }),
      ...HELP.map(([k, d]) => el("div", { className: "help-row" },
        el("kbd", { textContent: k }), el("span", { textContent: d }))),
      el("button", { className: "btn btn-ghost", textContent: "Close", onclick: () => o.remove() })));
  document.body.append(o);
}

/* ---- Twitch LIVE badge -------------------------------------- */
(async () => {
  try {
    const t = await fetch(`${API}/twitch/status`).then((r) => r.json());
    if (!t || !t.configured) return;
    const badge = el("a", { id: "live-badge", className: t.live ? "live" : "off",
      href: `https://twitch.tv/${t.user}`, ...extTarget,
      title: t.live ? t.title || "Live on Twitch" : "Offline" },
      el("span", { className: "dot" }), t.live ? "LIVE" : "");
    if (t.live) $("#bar").append(badge);
  } catch { /* */ }
})();

/* ---- "playing now" ----------------------------------------- */
(async () => {
  try {
    const s = await fetch(`${API}/play/stats`).then((r) => r.json());
    if (s && s.playingNow > 1 && prefs().playingToasts !== false) toast(`👾 ${s.playingNow} people playing right now`);
  } catch { /* */ }
})();

/* ---- server-reachable check + degraded banner -------------- */
async function checkServer() {
  let ok = false;
  try { ok = (await fetch(`${API}/roms/health`, { cache: "no-store" })).ok; } catch { /* */ }
  window.__serverOff = !ok;
  let b = $("#offline-banner");
  if (!ok && !b && LS.get("offdismiss", 0) < Date.now() - 3600e3) {
    b = el("div", { id: "offline-banner" },
      "⚠ Home server unreachable — browse & upload-your-own-ROM only. Streamed ROMs, movies, music, saves and stats need the tailnet.",
      el("button", { textContent: "✕", onclick: () => { b.remove(); LS.set("offdismiss", Date.now()); } }));
    document.body.prepend(b);
  } else if (ok && b) { b.remove(); }
}
checkServer();
setInterval(checkServer, 120000);

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

/* ---- PWA service worker + update prompt ---------------------- */
if ("serviceWorker" in navigator) {
  addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw && nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            const t = el("div", { id: "sw-toast" },
              "New version available. ",
              el("button", { textContent: "Reload", onclick: () => { nw.postMessage("skip"); location.reload(); } }));
            document.body.append(t);
          }
        });
      });
    } catch { /* */ }
  });
}

router();
