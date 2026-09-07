#!/usr/bin/env node
// shadowswords arcade — self-host server for `shadow`.
//   /                     -> static site  (docs/)
//   /roms/rom/<sys>/<rel> -> a ROM file, streamed with Range + CORS
//   /roms/health          -> "ok"
// Bound to localhost; published to the tailnet (and optionally the internet)
// by `tailscale serve` — see ~/setup-arcade-serving.sh.
//
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PORT = 8710;
const HOST = "127.0.0.1";
const SITE = path.join(os.homedir(), "Work", "shadowswords-gamelib", "docs");
const ROMS = path.join(os.homedir(), "Games", "roms");
const BIOS = path.join(os.homedir(), "Games", "bios");
const MUSIC = "/run/media/shadowswords/Game SSD/Music";
const DATA = path.join(os.homedir(), ".local", "share", "ssw-arcade");
const STATES = path.join(DATA, "states");
const EJS_CACHE = path.join(DATA, "ejs-cache");
const STATS_FILE = path.join(DATA, "stats.json");
const STATE_MAX = 96 * 1024 * 1024;   // reject absurd save-state uploads
for (const d of [STATES, EJS_CACHE]) {
  try { fs.mkdirSync(d, { recursive: true }); }
  catch (e) { console.warn("dir unavailable:", d, e.message); }
}

// ---- optional config: ~/.config/ssw-arcade/config.json --------------------
//   { "twitch": "shadowswords",
//     "discordWebhook": "https://discord.com/api/webhooks/…",
//     "jellyfinUrl": "http://127.0.0.1:8096", "jellyfinKey": "…" }
const CONFIG_FILE = path.join(os.homedir(), ".config", "ssw-arcade", "config.json");
let CONFIG = {}, configAt = 0;
function cfg() {
  if (Date.now() - configAt > 30000) {
    configAt = Date.now();
    try { CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
    catch { CONFIG = {}; }
  }
  return CONFIG;
}
cfg();
const AUDIO_EXT = new Set([".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".wma"]);
const AUDIO_MIME = {
  ".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav", ".wma": "audio/x-ms-wma",
};

// BIOS files the Play section may request (must match build.py BIOS map)
const BIOS_OK = new Set([
  "disksys.rom", "syscard3.pce", "bios_CD_U.bin", "panafz10.bin", "5200.rom",
  "colecovision.rom", "pcfx.rom", "neogeo.zip", "kick40068.A1200",
  "7800 BIOS (U).rom", "BS-X.bin", "scph5501.bin",
]);

// systems the Play section can emulate (must match EMU_CORE in build.py)
const PLAYABLE = new Set([
  "nes", "fds", "snes", "satellaview", "gb", "gbc", "gba", "n64", "nds",
  "genesis", "megadrive", "megadrivejp", "sega32x", "segacd", "mastersystem",
  "sg-1000", "gamegear", "pcengine", "supergrafx", "pcecd", "tg-cd", "pcfx",
  "atari2600", "atari5200", "atari7800", "atarilynx", "atarijaguar", "wonderswan",
  "wonderswancolor", "ngp", "ngpc", "virtualboy", "colecovision", "c64", "vic20",
  "plus4", "psx", "neogeo", "cps1", "cps2", "mame", "3do", "amiga",
]);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "range, content-type",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/\?.*$/, "");
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel.includes("..")) { res.writeHead(400).end("bad"); return; }
  const full = path.join(SITE, rel);
  if (!full.startsWith(SITE)) { res.writeHead(400).end("bad"); return; }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end("not found"); return; }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": st.size,
      "cache-control": (rel.startsWith("/media/") || rel.startsWith("/data/"))
        ? "public, max-age=3600"
        : "no-store",              // html/js/css: always fresh
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full).pipe(res);
  });
}

function serveRom(req, res, sys, rel) {
  if (!PLAYABLE.has(sys)) { res.writeHead(404, CORS).end("system not playable"); return; }
  if (rel.startsWith("/") || rel.split(/[/\\]/).includes("..")) {
    res.writeHead(400, CORS).end("bad path"); return;
  }
  // realpath the system DIR (many are symlinks into the NTFS drive); the game
  // files themselves may be curated symlinks pointing back out, so don't realpath them.
  let realBase, full;
  try {
    realBase = fs.realpathSync(path.join(ROMS, sys));
    full = path.resolve(realBase, rel);
  } catch { res.writeHead(404, CORS).end("not found"); return; }
  if (full !== realBase && !full.startsWith(realBase + path.sep)) {
    res.writeHead(400, CORS).end("escape"); return;
  }

  let st;
  try { st = fs.statSync(full); } catch { res.writeHead(404, CORS).end("not found"); return; }
  if (!st.isFile()) { res.writeHead(404, CORS).end("not found"); return; }

  const base = {
    ...CORS, "content-type": "application/octet-stream",
    "accept-ranges": "bytes", "cache-control": "public, max-age=86400",
    "access-control-expose-headers": "content-length, content-range, accept-ranges",
  };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? +m[2] : st.size - 1;
    if (start >= st.size || end >= st.size || start > end) {
      res.writeHead(416, { ...CORS, "content-range": `bytes */${st.size}` }).end(); return;
    }
    res.writeHead(206, { ...base, "content-range": `bytes ${start}-${end}/${st.size}`,
      "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...base, "content-length": st.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full).pipe(res);
  }
}

// ---- music ----------------------------------------------------------------
let musicCache = null, musicAt = 0;
function musicIndex(req, res) {
  if (musicCache && Date.now() - musicAt < 120000) {
    res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(musicCache);
    return;
  }
  const albums = [];
  const loose = [];
  try {
    for (const ent of fs.readdirSync(MUSIC, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.name.startsWith(".")) continue;
      if (ent.isDirectory()) {
        const dir = path.join(MUSIC, ent.name);
        const tracks = [];
        const walk = (d, prefix) => {
          for (const t of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (t.name.startsWith(".")) continue;
            const rel = prefix ? `${prefix}/${t.name}` : t.name;
            if (t.isDirectory()) walk(path.join(d, t.name), rel);
            else if (AUDIO_EXT.has(path.extname(t.name).toLowerCase())) {
              tracks.push({ title: t.name.replace(/\.[^.]+$/, "").replace(/^\d+[\s.\-_]+/, ""), file: `${ent.name}/${rel}` });
            }
          }
        };
        walk(dir, "");
        if (tracks.length) albums.push({ name: ent.name, tracks });
      } else if (AUDIO_EXT.has(path.extname(ent.name).toLowerCase())) {
        loose.push({ title: ent.name.replace(/\.[^.]+$/, ""), file: ent.name });
      }
    }
    if (loose.length) albums.unshift({ name: "Singles", tracks: loose });
  } catch (e) { /* dir missing */ }
  musicCache = JSON.stringify({ albums });
  musicAt = Date.now();
  res.writeHead(200, { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=120" }).end(musicCache);
}
function serveMusic(req, res, rel) {
  if (rel.startsWith("/") || rel.split(/[/\\]/).includes("..")) { res.writeHead(400, CORS).end("bad"); return; }
  const full = path.join(MUSIC, rel);
  if (!full.startsWith(MUSIC + path.sep)) { res.writeHead(400, CORS).end("bad"); return; }
  let st;
  try { st = fs.statSync(full); } catch { res.writeHead(404, CORS).end("no"); return; }
  if (!st.isFile() || !AUDIO_EXT.has(path.extname(full).toLowerCase())) { res.writeHead(404, CORS).end("no"); return; }
  const ct = AUDIO_MIME[path.extname(full).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { ...CORS, "content-range": `bytes */${st.size}` }).end(); return; }
    res.writeHead(206, { ...CORS, "content-type": ct, "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...CORS, "content-type": ct, "accept-ranges": "bytes", "content-length": st.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full).pipe(res);
  }
}

// ---- cloud save-states --------------------------------------------------
const stateSys = (s) => /^[a-z0-9-]+$/i.test(s) && PLAYABLE.has(s);
const stateFile = (sys, rel) => path.join(STATES, sys, Buffer.from(rel).toString("base64url") + ".state");

function statesList(req, res) {
  const out = [];
  try {
    for (const sys of fs.readdirSync(STATES)) {
      const dir = path.join(STATES, sys);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".state")) continue;
        let rel;
        try { rel = Buffer.from(f.slice(0, -6), "base64url").toString("utf8"); } catch { continue; }
        const st = fs.statSync(path.join(dir, f));
        out.push({ sys, file: rel, name: rel.split("/").pop().replace(/\.[^.]+$/, ""),
          size: st.size, mtime: st.mtimeMs });
      }
    }
  } catch { /* none yet */ }
  res.writeHead(200, { ...CORS, "content-type": "application/json", "cache-control": "no-store" })
    .end(JSON.stringify(out));
}

function stateGet(req, res, sys, rel) {
  if (!stateSys(sys) || rel.split(/[/\\]/).includes("..")) { res.writeHead(400, CORS).end("bad"); return; }
  let st, full = stateFile(sys, rel);
  try { st = fs.statSync(full); } catch { res.writeHead(404, CORS).end("no save"); return; }
  res.writeHead(200, { ...CORS, "content-type": "application/octet-stream",
    "content-length": st.size, "cache-control": "no-store" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(full).pipe(res);
}

function statePut(req, res, sys, rel) {
  if (!stateSys(sys) || rel.split(/[/\\]/).includes("..")) { res.writeHead(400, CORS).end("bad"); return; }
  const full = stateFile(sys, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const chunks = []; let n = 0;
  req.on("data", (c) => {
    n += c.length;
    if (n > STATE_MAX) { req.destroy(); res.writeHead(413, CORS).end("too big"); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    try { fs.writeFileSync(full, Buffer.concat(chunks)); res.writeHead(200, { ...CORS, "content-type": "application/json" }).end('{"ok":true}'); }
    catch (e) { res.writeHead(500, CORS).end("write failed"); }
  });
}

function stateDelete(req, res, sys, rel) {
  if (!stateSys(sys) || rel.split(/[/\\]/).includes("..")) { res.writeHead(400, CORS).end("bad"); return; }
  try { fs.unlinkSync(stateFile(sys, rel)); } catch { /* already gone */ }
  res.writeHead(200, { ...CORS, "content-type": "application/json" }).end('{"ok":true}');
}

// ---- read a (small) request body ----------------------------------------
function readBody(req, cap = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > cap) { req.destroy(); reject(new Error("too big")); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const jsonRes = (res, code, obj) =>
  res.writeHead(code, { ...CORS, "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(obj));

// ---- self-hosted EmulatorJS (transparent caching proxy of the CDN) -------
const EJS_CDN = "https://cdn.emulatorjs.org/stable/data/";
async function serveEjs(req, res, rel) {
  if (rel.includes("..") || rel.startsWith("/")) { res.writeHead(400, CORS).end("bad"); return; }
  const disk = path.join(EJS_CACHE, rel);
  const ext = path.extname(rel).toLowerCase();
  const ct = MIME[ext] || (ext === ".data" || ext === ".wasm" ? "application/octet-stream"
    : ext === ".mem" ? "application/octet-stream" : "application/octet-stream");
  const send = (buf) => {
    res.writeHead(200, { ...CORS, "content-type": ct, "content-length": buf.length,
      "cache-control": "public, max-age=604800" });
    res.end(req.method === "HEAD" ? undefined : buf);
  };
  try { return send(fs.readFileSync(disk)); } catch { /* miss -> fetch */ }
  try {
    const r = await fetch(EJS_CDN + rel, { redirect: "follow" });
    if (!r.ok) { res.writeHead(r.status, CORS).end("upstream " + r.status); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    try { fs.mkdirSync(path.dirname(disk), { recursive: true }); fs.writeFileSync(disk, buf); } catch { /* rw */ }
    send(buf);
  } catch (e) { res.writeHead(502, CORS).end("ejs proxy: " + e.message); }
}

// ---- server-side search over docs/data/search.json ----------------------
let SEARCH = null;
function loadSearch() {
  if (SEARCH) return SEARCH;
  try { SEARCH = JSON.parse(fs.readFileSync(path.join(SITE, "data", "search.json"), "utf8")); }
  catch { SEARCH = []; }
  return SEARCH;
}
function serveSearch(req, res, u) {
  const q = (u.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(300, +u.searchParams.get("limit") || 60);
  if (q.length < 2) return jsonRes(res, 200, []);
  const terms = q.split(/\s+/).filter(Boolean);
  const rows = loadSearch()
    .filter((r) => terms.every((t) => r[0].toLowerCase().includes(t)))
    .sort((a, b) => (b[4] || 0) - (a[4] || 0) || a[0].localeCompare(b[0]))
    .slice(0, limit);
  jsonRes(res, 200, rows);
}

// ---- play stats + "playing now" ---------------------------------------
let STATS = null;
const now = () => Date.now();
function stats() {
  if (STATS) return STATS;
  try { STATS = JSON.parse(fs.readFileSync(STATS_FILE, "utf8")); }
  catch { STATS = { plays: {}, sessions: {} }; }
  STATS.plays ||= {}; STATS.sessions ||= {};
  return STATS;
}
let statsDirty = false;
function saveStats() {
  if (!statsDirty) return; statsDirty = false;
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats())); } catch { /* rw */ }
}
setInterval(saveStats, 15000).unref?.();
async function playPing(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req, 4096)).toString() || "{}"); } catch { /* */ }
  const s = stats();
  const key = `${body.sys}/${body.file}`;
  if (body.sys && body.file && PLAYABLE.has(body.sys)) {
    const p = s.plays[key] || { sys: body.sys, file: body.file, name: body.name || body.file, count: 0, last: 0 };
    if (body.start) { p.count++; }
    p.last = now(); p.name = body.name || p.name;
    s.plays[key] = p;
  }
  if (body.cid) s.sessions[body.cid] = { game: body.name || null, at: now() };
  statsDirty = true;
  jsonRes(res, 200, { ok: true });
}
function playStats(req, res) {
  const s = stats();
  const top = Object.values(s.plays).sort((a, b) => b.count - a.count).slice(0, 24)
    .map(({ sys, file, name, count }) => ({ sys, file, name, count }));
  const cutoff = now() - 90000;
  const playingNow = Object.values(s.sessions).filter((x) => x.at > cutoff).length;
  jsonRes(res, 200, { top, playingNow });
}

// ---- twitch live status (via decapi.me, no API key) ------------------
let twCache = { at: 0, live: false, title: "" };
async function twitchStatus(req, res) {
  const user = (cfg().twitch || "").replace(/[^\w]/g, "");
  if (!user) return jsonRes(res, 200, { configured: false, live: false });
  if (now() - twCache.at < 60000) return jsonRes(res, 200, { configured: true, ...twCache, user });
  try {
    const up = await fetch(`https://decapi.me/twitch/uptime/${user}`).then((r) => r.text());
    const live = !/offline|not live|error/i.test(up);
    let title = "";
    if (live) title = await fetch(`https://decapi.me/twitch/title/${user}`).then((r) => r.text()).catch(() => "");
    twCache = { at: now(), live, title: title.slice(0, 140) };
  } catch { twCache = { at: now(), live: false, title: "" }; }
  jsonRes(res, 200, { configured: true, ...twCache, user });
}

// ---- request-a-game -> Discord webhook -------------------------------
async function gameRequest(req, res) {
  const hook = cfg().discordWebhook;
  if (!hook) return jsonRes(res, 501, { ok: false, error: "not configured" });
  let body = {};
  try { body = JSON.parse((await readBody(req, 8192)).toString() || "{}"); } catch { return jsonRes(res, 400, { ok: false }); }
  const title = String(body.title || "").trim().slice(0, 200);
  const note = String(body.note || "").trim().slice(0, 500);
  const who = String(body.who || "anon").trim().slice(0, 60);
  if (!title) return jsonRes(res, 400, { ok: false, error: "no title" });
  try {
    await fetch(hook, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `🎮 **Game request** from **${who}**\n> ${title}${note ? `\n> _${note}_` : ""}` }),
    });
    jsonRes(res, 200, { ok: true });
  } catch { jsonRes(res, 502, { ok: false }); }
}

// ---- Discord invite counts (public, no auth) ------------------------
let dcCache = { at: 0, data: null };
async function discordInfo(req, res) {
  const inv = (cfg().discordInvite || "QnMc35rUdB").replace(/[^\w-]/g, "");
  if (now() - dcCache.at < 120000 && dcCache.data)
    return jsonRes(res, 200, dcCache.data);
  try {
    const j = await fetch(`https://discord.com/api/v10/invites/${inv}?with_counts=true`).then((r) => r.json());
    dcCache = { at: now(), data: {
      name: j.guild?.name || null,
      members: j.approximate_member_count || null,
      online: j.approximate_presence_count || null,
      invite: `https://discord.gg/${inv}`,
    } };
    jsonRes(res, 200, dcCache.data);
  } catch { jsonRes(res, 502, { error: "discord unreachable" }); }
}

// ---- Jellyfin proxy (config-gated) ----------------------------------
async function jellyfinProxy(req, res, rest, u) {
  const base = cfg().jellyfinUrl || "http://127.0.0.1:8096";
  const key = cfg().jellyfinKey;
  if (!key) return jsonRes(res, 501, { error: "jellyfin not configured" });
  const target = base.replace(/\/$/, "") + "/" + rest + (u.search || "");
  try {
    const r = await fetch(target, { headers: { "X-Emby-Token": key } });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...CORS, "content-type": r.headers.get("content-type") || "application/octet-stream",
      "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : buf);
  } catch (e) { res.writeHead(502, CORS).end("jellyfin: " + e.message); }
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { ...CORS, "access-control-max-age": "86400" }).end(); return; }

  {
    const u0 = new URL(req.url, "http://x");
    const P = u0.pathname;
    if (P === "/states/list" && req.method === "GET") { statesList(req, res); return; }
    const sm = P.match(/^\/states\/([^/]+)\/(.+)$/);
    if (sm) {
      const sys = decodeURIComponent(sm[1]), rel = decodeURIComponent(sm[2]);
      if (req.method === "GET" || req.method === "HEAD") { stateGet(req, res, sys, rel); return; }
      if (req.method === "PUT") { statePut(req, res, sys, rel); return; }
      if (req.method === "DELETE") { stateDelete(req, res, sys, rel); return; }
      res.writeHead(405, CORS).end("no"); return;
    }
    // POST/GET dynamic endpoints
    if (P === "/play/ping" && req.method === "POST") { playPing(req, res); return; }
    if (P === "/play/stats" && req.method === "GET") { playStats(req, res); return; }
    if (P === "/twitch/status" && req.method === "GET") { twitchStatus(req, res); return; }
    if (P === "/discord/info" && req.method === "GET") { discordInfo(req, res); return; }
    if (P === "/request" && req.method === "POST") { gameRequest(req, res); return; }
    if (P === "/search" && req.method === "GET") { serveSearch(req, res, u0); return; }
    const ejs = P.match(/^\/emulatorjs\/(.+)$/);
    if (ejs && (req.method === "GET" || req.method === "HEAD")) { serveEjs(req, res, decodeURIComponent(ejs[1])); return; }
    const jf = P.match(/^\/jellyfin\/(.*)$/);
    if (jf && (req.method === "GET" || req.method === "HEAD")) { jellyfinProxy(req, res, jf[1], u0); return; }
  }

  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end("GET only"); return; }

  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  if (p === "/roms/health" || p === "/roms" || p === "/roms/") {
    res.writeHead(200, { ...CORS, "content-type": "text/plain" }).end("ok"); return;
  }
  const rm = p.match(/^\/roms\/rom\/([^/]+)\/(.+)$/);
  if (rm) { serveRom(req, res, decodeURIComponent(rm[1]), decodeURIComponent(rm[2])); return; }

  const bm = p.match(/^\/roms\/bios\/(.+)$/);
  if (bm) {
    const name = decodeURIComponent(bm[1]);
    if (!BIOS_OK.has(name)) { res.writeHead(404, CORS).end("no"); return; }
    try {
      const full = path.join(BIOS, name);
      const st = fs.statSync(full);
      res.writeHead(200, { ...CORS, "content-type": "application/octet-stream",
        "content-length": st.size, "cache-control": "public, max-age=604800" });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(full).pipe(res);
    } catch { res.writeHead(404, CORS).end("no"); }
    return;
  }

  if (p === "/music/index.json") { musicIndex(req, res); return; }
  const mf = p.match(/^\/music\/file\/(.+)$/);
  if (mf) { serveMusic(req, res, decodeURIComponent(mf[1])); return; }

  serveStatic(req, res, p + u.search);
}).listen(PORT, HOST, () => console.log(`arcade-server  http://${HOST}:${PORT}  site=${SITE}`));
