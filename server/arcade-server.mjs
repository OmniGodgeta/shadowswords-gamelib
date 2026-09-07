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
const STATES = path.join(os.homedir(), ".local", "share", "ssw-arcade", "states");
const STATE_MAX = 96 * 1024 * 1024;   // reject absurd save-state uploads
try { fs.mkdirSync(STATES, { recursive: true }); }
catch (e) { console.warn("save-states dir unavailable:", e.message); }
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
  "access-control-allow-methods": "GET, HEAD, PUT, DELETE, OPTIONS",
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

http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { ...CORS, "access-control-max-age": "86400" }).end(); return; }

  {
    const u0 = new URL(req.url, "http://x");
    if (u0.pathname === "/states/list" && req.method === "GET") { statesList(req, res); return; }
    const sm = u0.pathname.match(/^\/states\/([^/]+)\/(.+)$/);
    if (sm) {
      const sys = decodeURIComponent(sm[1]), rel = decodeURIComponent(sm[2]);
      if (req.method === "GET" || req.method === "HEAD") { stateGet(req, res, sys, rel); return; }
      if (req.method === "PUT") { statePut(req, res, sys, rel); return; }
      if (req.method === "DELETE") { stateDelete(req, res, sys, rel); return; }
      res.writeHead(405, CORS).end("no"); return;
    }
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
