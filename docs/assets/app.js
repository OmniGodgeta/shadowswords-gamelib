"use strict";

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};
const esc = (s) => (s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const view = $("#view");
const PAGE = 120;

// Public URL of the Jellyfin movie library (served over Tailscale Funnel).
// Change this one line if the server address ever changes.
const MOVIES_URL = "https://shadow-1.tail51f9d6.ts.net/";

const state = {
  index: null,
  systems: {},        // id -> {name,...}
  cache: {},          // id -> [games]
  search: null,       // [[name,sys,id,year,hasImg], ...]
  render: 0,          // token to cancel stale async renders
};

/* ---------- data ---------- */
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
  if (!state.search) {
    state.search = await fetch("data/search.json").then((r) => r.json());
  }
  return state.search;
}

/* ---------- helpers ---------- */
function sysName(id) { return state.systems[id]?.name || id; }

function gameCard(g) {
  const thumb = el("div", { className: "thumb" + (g.img ? "" : " empty") });
  if (g.img) {
    thumb.append(el("img", { loading: "lazy", src: g.img, alt: g.name }));
  }
  const meta = [g.year || null, g.genre || null].filter(Boolean).join(" · ");
  return el("article", {
    className: "game",
    onclick: () => { location.hash = `#/g/${g._sys}/${g.id}`; },
  },
    thumb,
    el("div", { className: "cap" },
      el("div", { className: "t", title: g.name, textContent: g.name }),
      el("div", { className: "s", textContent: meta })));
}

function renderGrid(container, list, shown) {
  const slice = list.slice(0, shown);
  const grid = el("div", { className: "game-grid" });
  slice.forEach((g) => grid.append(gameCard(g)));
  container.replaceChildren(grid);
  if (list.length > shown) {
    container.append(el("button", {
      className: "more",
      textContent: `Show more (${(list.length - shown).toLocaleString()} left)`,
      onclick: (e) => { e.target.remove(); renderGrid(container, list, shown + PAGE); },
    }));
  } else if (list.length === 0) {
    container.replaceChildren(el("div", { className: "empty-state", textContent: "Nothing here." }));
  }
}

function spinner() {
  view.replaceChildren(el("div", { className: "spinner", textContent: "Loading…" }));
}

/* ---------- routes ---------- */
async function routeHome() {
  await getIndex();
  const { systems, total } = state.index;
  const wrap = el("div", {});
  wrap.append(
    el("div", { className: "page-title" },
      el("h1", { textContent: "Game library" }),
      el("span", { className: "count", textContent: `${total.toLocaleString()} games` })),
    el("p", { className: "hero-sub",
      textContent: "Everything scraped into the ES-DE setup. Pick a system, or search across all of them from the box up top." }));

  const grid = el("div", { className: "sys-grid" });
  for (const s of systems) {
    const pct = s.count ? Math.round((s.withArt / s.count) * 100) : 0;
    grid.append(el("a", { className: "sys-card", href: `#/s/${s.id}` },
      el("div", { className: "n", textContent: s.name }),
      el("div", { className: "m",
        textContent: `${s.count.toLocaleString()} games · ${s.withArt} with art` }),
      el("div", { className: "bar" }, el("i", { style: `width:${pct}%` }))));
  }
  wrap.append(grid);
  view.replaceChildren(wrap);
}

async function routeSystem(id) {
  const token = ++state.render;
  spinner();
  await getIndex();
  const games = await getSystem(id);
  if (token !== state.render) return;

  const meta = state.systems[id] || { name: id };
  const genres = [...new Set(games.map((g) => g.genre).filter(Boolean))].sort();

  const head = el("div", {});
  head.append(
    el("div", { className: "crumbs" }, el("a", { href: "#/", textContent: "Library" }),
      document.createTextNode("  ›  " + meta.name)),
    el("div", { className: "page-title" },
      el("h1", { textContent: meta.name }),
      el("span", { className: "count", textContent: `${games.length.toLocaleString()} games` })));

  const fText = el("input", { type: "search", placeholder: "Filter titles…" });
  const fGenre = el("select", {},
    el("option", { value: "", textContent: "All genres" }),
    ...genres.map((x) => el("option", { value: x, textContent: x })));
  const fSort = el("select", {},
    el("option", { value: "name", textContent: "Sort: A–Z" }),
    el("option", { value: "-name", textContent: "Sort: Z–A" }),
    el("option", { value: "-year", textContent: "Sort: newest" }),
    el("option", { value: "year", textContent: "Sort: oldest" }),
    el("option", { value: "art", textContent: "Sort: has art first" }));
  head.append(el("div", { className: "toolbar" }, fText, fGenre, fSort));

  const listBox = el("div", {});
  head.append(listBox);
  view.replaceChildren(head);

  const apply = () => {
    const q = fText.value.trim().toLowerCase();
    const gv = fGenre.value;
    let list = games.filter((g) =>
      (!q || g.name.toLowerCase().includes(q)) && (!gv || g.genre === gv));
    const s = fSort.value;
    const cmp = {
      "name": (a, b) => a.name.localeCompare(b.name),
      "-name": (a, b) => b.name.localeCompare(a.name),
      "-year": (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name),
      "year": (a, b) => (a.year || 9999) - (b.year || 9999) || a.name.localeCompare(b.name),
      "art": (a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.name.localeCompare(b.name),
    }[s];
    list = [...list].sort(cmp);
    renderGrid(listBox, list, PAGE);
  };
  fText.oninput = debounce(apply, 150);
  fGenre.onchange = apply;
  fSort.onchange = apply;
  apply();
}

async function routeGame(sysId, gid) {
  await getIndex();
  const games = await getSystem(sysId).catch(() => []);
  const g = games.find((x) => x.id === gid);
  if (!g) { closeModal(); return; }

  const body = $(".modal-body");
  const art = g.img
    ? el("div", { className: "art" }, el("img", { src: g.img, alt: g.name }))
    : el("div", { className: "art empty" });

  const dl = el("dl");
  const row = (k, v) => { if (v) dl.append(el("dt", { textContent: k }), el("dd", { textContent: v })); };
  row("System", sysName(sysId));
  row("Year", g.year);
  row("Genre", g.genre);
  row("Developer", g.developer);
  row("Publisher", g.publisher);
  row("Players", g.players);
  row("Rating", g.rating ? `${g.rating} / 5` : null);

  body.replaceChildren(el("div", { className: "detail" },
    art,
    el("div", {},
      el("h2", { textContent: g.name }),
      el("div", { className: "sys" },
        el("a", { href: `#/s/${sysId}`, textContent: sysName(sysId), onclick: closeModal })),
      dl,
      g.desc ? el("div", { className: "desc", textContent: g.desc }) : "")));
  openModal();
}

async function routeSearch(qRaw) {
  const token = ++state.render;
  const q = qRaw.trim().toLowerCase();
  $("#q").value = qRaw;
  spinner();
  await getIndex();
  const rows = await getSearch();
  if (token !== state.render) return;

  const terms = q.split(/\s+/).filter(Boolean);
  let hits = rows.filter((r) => {
    const n = r[0].toLowerCase();
    return terms.every((t) => n.includes(t));
  });
  hits.sort((a, b) => b[4] - a[4] || a[0].localeCompare(b[0]));
  hits = hits.slice(0, 600);

  const head = el("div", {});
  head.append(el("div", { className: "page-title" },
    el("h1", { textContent: `Search: “${qRaw}”` }),
    el("span", { className: "count",
      textContent: `${hits.length}${hits.length === 600 ? "+" : ""} results` })));
  const box = el("div", {});
  head.append(box);
  view.replaceChildren(head);

  // hydrate visible hits from per-system caches lazily
  const need = [...new Set(hits.slice(0, PAGE).map((r) => r[1]))];
  await Promise.all(need.map((id) => getSystem(id).catch(() => [])));
  if (token !== state.render) return;

  const toGame = (r) => (state.cache[r[1]] || []).find((x) => x.id === r[2])
    || { name: r[0], id: r[2], _sys: r[1], year: r[3] || null };
  const list = hits.map(toGame);
  renderGrid(box, list, PAGE);
}

/* ---------- movies ---------- */
function routeMovies() {
  ++state.render;
  const host = (() => { try { return new URL(MOVIES_URL).host; } catch { return MOVIES_URL; } })();
  view.replaceChildren(el("section", { className: "movies" },
    el("div", { className: "clapper", textContent: "🎬" }),
    el("h1", { textContent: "Movie library" }),
    el("p", { textContent: "The full film & TV collection, streamed straight from the home server. Opens the Jellyfin web player in a new tab — sign in with the shared account." }),
    el("a", { className: "open-btn", href: MOVIES_URL, target: "_blank", rel: "noopener",
      textContent: "Open the movie library ↗" }),
    el("div", { className: "hint" },
      el("span", { textContent: "Powered by Jellyfin at " }),
      el("code", { textContent: host }),
      el("span", { textContent: ". If it doesn't load, the server may be offline." }))));
}

/* ---------- modal ---------- */
const modal = $("#modal");
function openModal() { modal.hidden = false; document.body.style.overflow = "hidden"; }
function closeModal() {
  modal.hidden = true; document.body.style.overflow = "";
  if (location.hash.startsWith("#/g/")) history.back();
}
$(".modal-close").onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

/* ---------- router ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  return h.split("/").map(decodeURIComponent);
}
function setActiveNav(name) {
  document.querySelectorAll(".nav-link").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === name));
}
async function router() {
  const [a, b, c] = parseHash();
  if (a !== "g" && !modal.hidden) { modal.hidden = true; document.body.style.overflow = ""; }
  if (a === "movies") { setActiveNav("movies"); return routeMovies(); }
  setActiveNav("games");
  if (a === "s" && b) return routeSystem(b);
  if (a === "g" && b && c) return routeGame(b, c);
  if (a === "q" && b) return routeSearch(b);
  if (a === "" || a === undefined) { $("#q").value = ""; return routeHome(); }
  return routeHome();
}
window.addEventListener("hashchange", router);

/* ---------- search box ---------- */
const qInput = $("#q");
qInput.addEventListener("input", debounce(() => {
  const v = qInput.value.trim();
  if (v.length >= 2) location.hash = `#/q/${encodeURIComponent(v)}`;
  else if (!v && location.hash.startsWith("#/q/")) location.hash = "#/";
}, 250));

/* ---------- theme ---------- */
const themeBtn = $("#theme");
const savedTheme = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
themeBtn.onclick = () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
};

/* ---------- util ---------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

router();
