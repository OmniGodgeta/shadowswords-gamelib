#!/usr/bin/env node
// shadowswords arcade — self-host server for `shadow`.
//   /                     -> static site  (docs/)
//   /roms/rom/<sys>/<rel> -> a ROM file, streamed with Range + CORS
//   /roms/health          -> "ok"
//   /gamevideo/<sys>/<f>  -> ES-DE preview clip, faststart-remuxed + cached
// Bound to localhost; published to the tailnet (and optionally the internet)
// by `tailscale serve` — see ~/setup-arcade-serving.sh.
//
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 8710;
const HOST = "127.0.0.1";
const SITE = path.join(os.homedir(), "Work", "shadowswords-gamelib", "docs");
const ROMS = path.join(os.homedir(), "Games", "roms");
const BIOS = path.join(os.homedir(), "Games", "bios");
const ESDE_MEDIA = path.join(os.homedir(), "ES-DE", "downloaded_media");
const MUSIC = "/run/media/shadowswords/Game SSD/Music";
const DATA = path.join(os.homedir(), ".local", "share", "ssw-arcade");
const STATES = path.join(DATA, "states");
const EJS_CACHE = path.join(DATA, "ejs-cache");
const GAMEVID_CACHE = path.join(DATA, "gamevid-cache");   // faststart-remuxed previews
const STATS_FILE = path.join(DATA, "stats.json");
const ACCOUNTS_FILE = path.join(DATA, "accounts.json");
const STATE_MAX = 96 * 1024 * 1024;   // reject absurd save-state uploads
for (const d of [STATES, EJS_CACHE, GAMEVID_CACHE]) {
  try { fs.mkdirSync(d, { recursive: true }); }
  catch (e) { console.warn("dir unavailable:", d, e.message); }
}

// ---- accounts + auth ------------------------------------------------------
// accounts.json: { secret, users: { <lcname>: {id, name, display, avatar, pwHash, salt, created, settings} } }
let ACCT = null;
function accts() {
  if (ACCT) return ACCT;
  try { ACCT = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8")); }
  catch { ACCT = { secret: crypto.randomBytes(32).toString("hex"), users: {} }; }
  ACCT.users ||= {};
  if (!ACCT.secret) ACCT.secret = crypto.randomBytes(32).toString("hex");
  return ACCT;
}
function saveAccts() {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accts(), null, 2), { mode: 0o600 }); }
  catch (e) { console.warn("accounts write failed:", e.message); }
}
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
const b64u = (b) => Buffer.from(b).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");
function mkToken(uid) {
  const body = b64u(JSON.stringify({ u: uid, e: Date.now() + 45 * 864e5 }));
  const sig = crypto.createHmac("sha256", accts().secret).update(body).digest("base64url");
  return body + "." + sig;
}
function readToken(tok) {
  if (!tok || tok.indexOf(".") < 0) return null;
  const [body, sig] = tok.split(".");
  const want = crypto.createHmac("sha256", accts().secret).update(body).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(unb64u(body).toString());
    if (!p.u || p.e < Date.now()) return null;
    return p.u;
  } catch { return null; }
}
function userByToken(req) {
  let tok = req.headers["x-ssw-auth"] || "";
  if (!tok) {
    try { tok = new URL(req.url, "http://x").searchParams.get("a") || ""; } catch { tok = ""; }
  }
  const uid = readToken(tok);
  if (!uid) return null;
  return Object.values(accts().users).find((u) => u.id === uid) || null;
}
const pubUser = (u) => u && ({ id: u.id, name: u.name, display: u.display || u.name,
  avatar: u.avatar || "🎮", created: u.created, settings: u.settings || {}, admin: isAdmin(u) });

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
  "access-control-allow-headers": "range, content-type, x-ssw-token, x-ssw-auth",
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
      "cache-control": rel.startsWith("/media/")
        ? "public, max-age=86400"                 // box art: content-stable, cache hard
        : rel.startsWith("/data/")
          ? "public, max-age=300, must-revalidate" // browse data: a rebuild should land fast
          : "no-store",                            // html/js/css: always fresh
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

// ---- game preview videos (ES-DE video snaps) -----------------------------
// The ES-DE .mp4s put their moov atom at the end, which stalls progressive
// <video> playback. On first request we remux (-c copy, ~50ms) to a faststart
// copy in the cache and serve that from then on.
const gvInflight = new Map();
function faststart(src, dst) {
  if (gvInflight.has(dst)) return gvInflight.get(dst);
  const p = new Promise((resolve) => {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    execFile("ffmpeg", ["-y", "-v", "error", "-i", src, "-c", "copy",
      "-movflags", "+faststart", "-f", "mp4", dst + ".tmp"], { timeout: 20000 }, (err) => {
      if (err) { try { fs.unlinkSync(dst + ".tmp"); } catch { /* */ } resolve(src); return; }
      try { fs.renameSync(dst + ".tmp", dst); resolve(dst); }
      catch { resolve(src); }
    });
  }).finally(() => gvInflight.delete(dst));
  gvInflight.set(dst, p);
  return p;
}
async function serveGameVideo(req, res, sys, name) {
  if (/[/\\]/.test(sys) || name.includes("..") || name.includes("/")) {
    res.writeHead(400, CORS).end("bad path"); return;
  }
  const src = path.join(ESDE_MEDIA, sys, "videos", name);
  if (!src.startsWith(path.join(ESDE_MEDIA, sys, "videos") + path.sep)) {
    res.writeHead(400, CORS).end("escape"); return;
  }
  let srcSt;
  try { srcSt = fs.statSync(src); } catch { res.writeHead(404, CORS).end("not found"); return; }
  if (!srcSt.isFile()) { res.writeHead(404, CORS).end("not found"); return; }

  const cached = path.join(GAMEVID_CACHE, sys, name);
  let full = src;
  try {
    const cSt = fs.statSync(cached);
    if (cSt.mtimeMs >= srcSt.mtimeMs) full = cached;
  } catch {
    full = await faststart(src, cached);
  }
  let st;
  try { st = fs.statSync(full); } catch { res.writeHead(404, CORS).end("not found"); return; }
  const ext = path.extname(full).toLowerCase();
  const ct = ext === ".webm" ? "video/webm" : "video/mp4";
  const base = { ...CORS, "content-type": ct, "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
    "access-control-expose-headers": "content-length, content-range, accept-ranges" };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? +m[2] : st.size - 1;
    if (start >= st.size || end >= st.size || start > end) {
      res.writeHead(416, { ...CORS, "content-range": `bytes */${st.size}` }).end(); return;
    }
    res.writeHead(206, { ...base, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...base, "content-length": st.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full).pipe(res);
  }
}

// ---- music ----------------------------------------------------------------
const FOLDER_ART = ["cover.jpg", "folder.jpg", "front.jpg", "album.jpg", "cover.png", "folder.png",
  "front.png", "Cover.jpg", "Folder.jpg", "AlbumArtSmall.jpg", "AlbumArt.jpg"];
const IMG_EXT_RE = /\.(jpe?g|png|webp)$/i;

// pull embedded cover art from the first track (ID3v2 APIC / FLAC PICTURE)
function embeddedArt(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0);
    if (head.slice(0, 3).toString("latin1") === "ID3") {
      const sz = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
      const buf = Buffer.alloc(Math.min(sz + 10, 4 << 20)); fs.readSync(fd, buf, 0, buf.length, 0);
      let p = 10;
      while (p + 10 < buf.length) {
        const id = buf.slice(p, p + 4).toString("latin1");
        const fsz = buf.readUInt32BE(p + 4);
        if (!/^[A-Z0-9]{4}$/.test(id) || fsz <= 0 || p + 10 + fsz > buf.length) break;
        if (id === "APIC") {
          let q = p + 10; q++;                                  // text encoding
          while (q < buf.length && buf[q] !== 0) q++; q++;      // MIME (latin1, null-term)
          q++;                                                  // picture type
          while (q < buf.length && buf[q] !== 0) q++; q++;      // description
          return { mime: "image/jpeg", data: buf.slice(q, p + 10 + fsz) };
        }
        p += 10 + fsz;
      }
    } else if (head.slice(0, 4).toString("latin1") === "fLaC") {
      let p = 4;
      const b = Buffer.alloc(4 << 20); fs.readSync(fd, b, 0, b.length, 0);
      while (p + 4 < b.length) {
        const last = b[p] & 0x80, type = b[p] & 0x7f;
        const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
        p += 4;
        if (type === 6) {
          let q = p + 4;
          const mlen = b.readUInt32BE(q); q += 4;
          const mime = b.slice(q, q + mlen).toString("latin1"); q += mlen;
          const dlen = b.readUInt32BE(q); q += 4 + dlen;
          q += 16;                                              // w/h/depth/colors
          const ilen = b.readUInt32BE(q); q += 4;
          return { mime, data: b.slice(q, q + ilen) };
        }
        p += len;
        if (last) break;
      }
    }
  } catch { /* */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ } }
  return null;
}

const artCacheDir = path.join(DATA, "music-art");
try { fs.mkdirSync(artCacheDir, { recursive: true }); } catch { /* */ }

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
        let folderImg = null;
        const walk = (d, prefix) => {
          for (const t of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (t.name.startsWith(".")) continue;
            const rel = prefix ? `${prefix}/${t.name}` : t.name;
            if (t.isDirectory()) walk(path.join(d, t.name), rel);
            else if (AUDIO_EXT.has(path.extname(t.name).toLowerCase())) {
              tracks.push({ title: t.name.replace(/\.[^.]+$/, "").replace(/^\d+[\s.\-_]+/, ""), file: `${ent.name}/${rel}` });
            } else if (!folderImg && IMG_EXT_RE.test(t.name)) {
              folderImg = `${ent.name}/${rel}`;
            }
          }
        };
        walk(dir, "");
        // prefer a well-known cover filename at the album root
        for (const c of FOLDER_ART) { if (fs.existsSync(path.join(dir, c))) { folderImg = `${ent.name}/${c}`; break; } }
        if (tracks.length) {
          const hasArt = !!folderImg || (fs.existsSync(path.join(artCacheDir, encodeURIComponent(ent.name) + ".jpg")));
          albums.push({ name: ent.name, tracks, art: hasArt || undefined });
        }
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

function serveMusicArt(req, res, albumName) {
  if (albumName.includes("..") || albumName.includes("/")) { res.writeHead(400, CORS).end("bad"); return; }
  const dir = path.join(MUSIC, albumName);
  const send = (buf, mime) => res.writeHead(200, { ...CORS, "content-type": mime || "image/jpeg",
    "content-length": buf.length, "cache-control": "public, max-age=86400" })
    .end(req.method === "HEAD" ? undefined : buf);
  // 1: a cover file in the album folder
  try {
    let img = null;
    for (const c of FOLDER_ART) { if (fs.existsSync(path.join(dir, c))) { img = path.join(dir, c); break; } }
    if (!img) {
      const anyImg = fs.readdirSync(dir).find((f) => IMG_EXT_RE.test(f));
      if (anyImg) img = path.join(dir, anyImg);
    }
    if (img) { const ext = path.extname(img).toLowerCase();
      return send(fs.readFileSync(img), ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg"); }
  } catch { /* */ }
  // 2: embedded art from the first track, cached to disk
  const cache = path.join(artCacheDir, encodeURIComponent(albumName) + ".jpg");
  try { return send(fs.readFileSync(cache)); } catch { /* */ }
  try {
    const first = fs.readdirSync(dir).sort().find((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));
    if (first) {
      const art = embeddedArt(path.join(dir, first));
      if (art && art.data && art.data.length > 200) {
        try { fs.writeFileSync(cache, art.data); } catch { /* */ }
        return send(art.data, art.mime);
      }
    }
  } catch { /* */ }
  res.writeHead(404, CORS).end("no art");
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

// ---- cloud save-states (per-account namespaces) ------------------------
// layout: STATES/<ns>/<sys>/<base64url(rompath)>.state
//   ns = user id when signed in, else "_shared" (the pre-accounts pool)
const stateSys = (s) => /^[a-z0-9-]+$/i.test(s) && PLAYABLE.has(s);
const nsFor = (req) => { const u = userByToken(req); return u ? u.id : "_shared"; };
const slotOf = (u0) => (u0.searchParams.get("s") || "auto").replace(/[^a-z0-9_ -]/gi, "").slice(0, 24) || "auto";
// STATES/<ns>/<sys>/<base64url(rompath)>/<slot>.state
const stateDir = (ns, sys, rel) => path.join(STATES, ns, sys, Buffer.from(rel).toString("base64url"));
const stateFile = (ns, sys, rel, slot) => path.join(stateDir(ns, sys, rel), (slot || "auto") + ".state");
const shotFile = (ns, sys, rel, slot) => path.join(stateDir(ns, sys, rel), (slot || "auto") + ".jpg");
const SHOT_MAX = 512 * 1024;

// migrations: legacy STATES/<sys>/ -> _shared/<sys>/ ; then <b64>.state file -> <b64>/auto.state
(function migrateStates() {
  try {
    for (const e of fs.readdirSync(STATES)) {
      if (!stateSys(e)) continue;
      const to = path.join(STATES, "_shared", e);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(path.join(STATES, e), to);
      console.log("migrated legacy save-states:", e, "-> _shared/");
    }
  } catch { /* */ }
  try {
    for (const ns of fs.readdirSync(STATES)) {
      const nsd = path.join(STATES, ns);
      if (!fs.statSync(nsd).isDirectory()) continue;
      for (const sys of fs.readdirSync(nsd)) {
        const sd = path.join(nsd, sys);
        if (!fs.statSync(sd).isDirectory()) continue;
        for (const f of fs.readdirSync(sd)) {
          if (!f.endsWith(".state") || !fs.statSync(path.join(sd, f)).isFile()) continue;
          const b64 = f.slice(0, -6), gd = path.join(sd, b64);
          fs.mkdirSync(gd, { recursive: true });
          fs.renameSync(path.join(sd, f), path.join(gd, "auto.state"));
        }
      }
    }
  } catch { /* */ }
})();

function nsList(ns, shared) {
  const out = [];
  const scan = (base, isShared) => {
    let sysDirs = [];
    try { sysDirs = fs.readdirSync(base); } catch { return; }
    for (const sys of sysDirs) {
      const sd = path.join(base, sys);
      try { if (!fs.statSync(sd).isDirectory()) continue; } catch { continue; }
      for (const b64 of fs.readdirSync(sd)) {
        const gd = path.join(sd, b64);
        let rel;
        try { if (!fs.statSync(gd).isDirectory()) continue; rel = Buffer.from(b64, "base64url").toString("utf8"); } catch { continue; }
        const slots = [];
        for (const sf of fs.readdirSync(gd)) {
          if (!sf.endsWith(".state")) continue;
          const st = fs.statSync(path.join(gd, sf));
          const slot = sf.slice(0, -6);
          const hasShot = fs.existsSync(path.join(gd, slot + ".jpg"));
          slots.push({ slot, size: st.size, mtime: st.mtimeMs, shot: hasShot || undefined });
        }
        if (!slots.length) continue;
        slots.sort((a, b) => b.mtime - a.mtime);
        out.push({ sys, file: rel, name: rel.split("/").pop().replace(/\.[^.]+$/, ""),
          slots, size: slots[0].size, mtime: slots[0].mtime, shared: isShared || undefined });
      }
    }
  };
  scan(path.join(STATES, ns), false);
  if (shared && ns !== "_shared") scan(path.join(STATES, "_shared"), true);
  return out;
}
function statesList(req, res) {
  const ns = nsFor(req);
  res.writeHead(200, { ...CORS, "content-type": "application/json", "cache-control": "no-store" })
    .end(JSON.stringify(nsList(ns, true)));
}

function stateGet(req, res, sys, rel, u0) {
  if (!stateSys(sys) || rel.split(/[/\\]/).includes("..")) { res.writeHead(400, CORS).end("bad"); return; }
  const ns = nsFor(req), slot = slotOf(u0);
  const wantShot = u0.searchParams.get("shot");
  const pick = (nspace) => wantShot ? shotFile(nspace, sys, rel, slot) : stateFile(nspace, sys, rel, slot);
  let full = pick(ns), st;
  try { st = fs.statSync(full); }
  catch {
    if (ns !== "_shared") { full = pick("_shared"); try { st = fs.statSync(full); } catch { /* */ } }
    if (!st) { res.writeHead(404, CORS).end("no save"); return; }
  }
  res.writeHead(200, { ...CORS, "content-type": wantShot ? "image/jpeg" : "application/octet-stream",
    "content-length": st.size, "cache-control": "no-store" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(full).pipe(res);
}

function statePut(req, res, sys, rel, u0) {
  if (!stateSys(sys) || rel.split(/[/\\]/).includes("..")) { res.writeHead(400, CORS).end("bad"); return; }
  const isShot = u0.searchParams.get("shot");
  const full = isShot ? shotFile(nsFor(req), sys, rel, slotOf(u0)) : stateFile(nsFor(req), sys, rel, slotOf(u0));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const max = isShot ? SHOT_MAX : STATE_MAX;
  const chunks = []; let n = 0;
  req.on("data", (c) => {
    n += c.length;
    if (n > max) { req.destroy(); res.writeHead(413, CORS).end("too big"); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    try { fs.writeFileSync(full, Buffer.concat(chunks)); res.writeHead(200, { ...CORS, "content-type": "application/json" }).end('{"ok":true}'); }
    catch (e) { res.writeHead(500, CORS).end("write failed"); }
  });
}

function stateDelete(req, res, sys, rel, u0) {
  if (!stateSys(sys) || rel.split(/[/\\]/).includes("..")) { res.writeHead(400, CORS).end("bad"); return; }
  const ns = nsFor(req), slot = slotOf(u0);
  try { fs.unlinkSync(stateFile(ns, sys, rel, slot)); } catch { /* already gone */ }
  try { fs.unlinkSync(shotFile(ns, sys, rel, slot)); } catch { /* */ }
  try { fs.rmdirSync(stateDir(ns, sys, rel)); } catch { /* not empty */ }
  res.writeHead(200, { ...CORS, "content-type": "application/json" }).end('{"ok":true}');
}

// ---- watch party: last JPEG frame per room, tailnet spectators poll it ----
const WATCH = new Map();   // id -> { sys, file, name, host, at, frame, ctype }
const WATCH_MAX = 400 * 1024;
function pruneWatch() {
  const cut = now() - 25000;
  for (const [id, w] of WATCH) if (w.at < cut) WATCH.delete(id);
}
setInterval(pruneWatch, 8000).unref?.();
function watchMeta(id, w) {
  return { id, sys: w.sys, file: w.file, name: w.name, host: w.host, at: w.at, live: !!w.frame, room: w.room || null };
}

// ---- WebRTC netplay signalling (game traffic is peer-to-peer) ----
const NP_SIG = new Map(); // id -> { host, sys, file, name, n, msgs, at }
// Lounge chat — a single shared room, in memory. Recent messages only.
const CHAT = [];          // { id, who, text, at, uid }
const CHAT_MAX = 200;
function pruneNp() {
  const cut = now() - 30 * 60 * 1000;
  for (const [id, r] of NP_SIG) if (r.at < cut) NP_SIG.delete(id);
}
setInterval(pruneNp, 60000).unref?.();

// ---- auth endpoints ---------------------------------------------------
const NAME_RE = /^[a-z0-9_.-]{2,24}$/i;
async function authRegister(req, res) {
  if (cfg().registration === "closed" && Object.keys(accts().users).length) {
    return jsonRes(res, 403, { error: "registration is closed" });
  }
  let b = {};
  try { b = JSON.parse((await readBody(req, 4096)).toString() || "{}"); } catch { return jsonRes(res, 400, { error: "bad request" }); }
  const name = String(b.username || "").trim();
  const pw = String(b.password || "");
  if (!NAME_RE.test(name)) return jsonRes(res, 400, { error: "username must be 2–24 letters / digits / . _ -" });
  if (pw.length < 4) return jsonRes(res, 400, { error: "password must be at least 4 characters" });
  const A = accts();
  if (A.users[name.toLowerCase()]) return jsonRes(res, 409, { error: "that username is taken" });
  const salt = crypto.randomBytes(16).toString("hex");
  const u = { id: "u_" + crypto.randomBytes(8).toString("hex"), name, display: name,
    avatar: (b.avatar || "🎮"), pwHash: hashPw(pw, salt), salt, created: Date.now(), settings: {} };
  A.users[name.toLowerCase()] = u; saveAccts();
  jsonRes(res, 200, { token: mkToken(u.id), user: pubUser(u) });
}
async function authLogin(req, res) {
  let b = {};
  try { b = JSON.parse((await readBody(req, 4096)).toString() || "{}"); } catch { return jsonRes(res, 400, { error: "bad request" }); }
  const u = accts().users[String(b.username || "").trim().toLowerCase()];
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password || ""), u.salt)), Buffer.from(u.pwHash));
  if (!ok) return jsonRes(res, 401, { error: "wrong username or password" });
  jsonRes(res, 200, { token: mkToken(u.id), user: pubUser(u) });
}
function authMe(req, res) {
  const u = userByToken(req);
  if (!u) return jsonRes(res, 401, { error: "not signed in" });
  jsonRes(res, 200, { user: pubUser(u) });
}
async function authUpdate(req, res) {
  const u = userByToken(req);
  if (!u) return jsonRes(res, 401, { error: "not signed in" });
  let b = {};
  try { b = JSON.parse((await readBody(req, 8192)).toString() || "{}"); } catch { return jsonRes(res, 400, { error: "bad request" }); }
  if (typeof b.display === "string") u.display = b.display.trim().slice(0, 40) || u.name;
  if (typeof b.avatar === "string") u.avatar = [...b.avatar].slice(0, 2).join("") || u.avatar;
  if (b.settings && typeof b.settings === "object") u.settings = { ...u.settings, ...b.settings };
  if (b.newPassword) {
    const cur = accts().users[u.name.toLowerCase()];
    const ok = crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password || ""), cur.salt)), Buffer.from(cur.pwHash));
    if (!ok) return jsonRes(res, 403, { error: "current password is wrong" });
    if (String(b.newPassword).length < 4) return jsonRes(res, 400, { error: "new password too short" });
    u.salt = crypto.randomBytes(16).toString("hex");
    u.pwHash = hashPw(String(b.newPassword), u.salt);
  }
  saveAccts();
  jsonRes(res, 200, { user: pubUser(u), ...(b.newPassword ? { token: mkToken(u.id) } : {}) });
}

// ---- disk cache housekeeping (LRU by mtime, run hourly) ---------------
function pruneCache(dir, capBytes) {
  try {
    const files = [];
    const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else { const st = fs.statSync(f); files.push({ f, size: st.size, mtime: st.mtimeMs }); }
    } };
    walk(dir);
    let total = files.reduce((n, x) => n + x.size, 0);
    if (total <= capBytes) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const x of files) {
      if (total <= capBytes) break;
      try { fs.unlinkSync(x.f); total -= x.size; } catch { /* */ }
    }
    console.log(`pruned ${path.basename(dir)} to ${(total / 1048576) | 0} MB`);
  } catch { /* */ }
}
setInterval(() => {
  pruneCache(EJS_CACHE, 300 * 1048576);      // 300 MB of emulator files
  pruneCache(path.join(DATA, "thumb-cache"), 800 * 1048576);
  pruneCache(path.join(DATA, "music-art"), 200 * 1048576);
  pruneCache(GAMEVID_CACHE, 600 * 1048576);  // faststart preview clips
}, 3600_000).unref?.();

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

// ---- libretro-thumbnails proxy ----------------------------------------
// Best-effort: serve from the disk cache if we have it, otherwise 302 the
// browser straight to raw.githubusercontent.com (never make the user wait on
// our fetch) and warm the cache in the background at low concurrency.
const THUMBS = path.join(DATA, "thumb-cache");
try { fs.mkdirSync(THUMBS, { recursive: true }); } catch { /* */ }
const thumbDisk = (rel) => path.join(THUMBS, rel.replace(/[^A-Za-z0-9._/%() -]/g, "_"));
let warmActive = 0; const warmSeen = new Set();
async function warmThumb(rel) {
  if (warmActive >= 3 || warmSeen.has(rel)) return;
  warmSeen.add(rel); warmActive++;
  try {
    const r = await fetch("https://raw.githubusercontent.com/libretro-thumbnails/" + rel,
      { signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const disk = thumbDisk(rel);
      fs.mkdirSync(path.dirname(disk), { recursive: true });
      fs.writeFileSync(disk, buf);
    } else if (r.status !== 429) { warmSeen.add(rel); }  // permanent miss
  } catch { warmSeen.delete(rel); }                       // transient — allow a retry later
  finally { warmActive--; }
}
function serveThumb(req, res, rel) {
  if (rel.includes("..") || !rel.endsWith(".png")) { res.writeHead(400, CORS).end("bad"); return; }
  const disk = thumbDisk(rel);
  try {
    const buf = fs.readFileSync(disk);
    res.writeHead(200, { ...CORS, "content-type": "image/png", "content-length": buf.length,
      "cache-control": "public, max-age=2592000" }).end(req.method === "HEAD" ? undefined : buf);
    return;
  } catch { /* miss */ }
  warmThumb(rel);
  res.writeHead(302, { ...CORS, location: "https://raw.githubusercontent.com/libretro-thumbnails/" + rel,
    "cache-control": "no-store" }).end();
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
  catch { STATS = {}; }
  STATS.plays ||= {}; STATS.sessions ||= {}; STATS.reports ||= {};
  STATS.requests ||= []; STATS.userPlays ||= {}; STATS.banner ??= null;
  STATS.invites ||= [];
  return STATS;
}
// first account created is the owner; also cfg().admins (usernames)
function isAdmin(u) {
  if (!u) return false;
  const A = accts();
  const first = Object.values(A.users).sort((a, b) => a.created - b.created)[0];
  return (first && first.id === u.id) || (Array.isArray(cfg().admins) && cfg().admins.includes(u.name));
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
  const u = userByToken(req);
  if (body.bye && body.cid) {
    delete s.sessions[body.cid];
    statsDirty = true;
    jsonRes(res, 200, { ok: true }); return;
  }
  const key = `${body.sys}/${body.file}`;
  if (body.sys && body.file && PLAYABLE.has(body.sys)) {
    const p = s.plays[key] || { sys: body.sys, file: body.file, name: body.name || body.file, count: 0, last: 0 };
    if (body.start) {
      p.count++;
      if (u) {
        const up = (s.userPlays[u.id] ||= {});
        const e = (up[key] ||= { sys: body.sys, file: body.file, name: body.name || body.file, count: 0, last: 0 });
        e.count++; e.last = now(); e.name = body.name || e.name;
      }
    }
    p.last = now(); p.name = body.name || p.name;
    s.plays[key] = p;
  }
  if (body.cid) {
    const idle = !!body.idle;
    s.sessions[body.cid] = {
      cid: body.cid,
      uid: u ? u.id : null,
      game: idle ? null : (body.name || null), at: now(),
      who: u ? u.display : (body.who || null),
      sys: idle ? null : (body.sys || null),
      file: idle ? null : (body.file || null),
      watch: idle ? null : (body.watch || null),
      netplay: idle ? false : !!body.netplay,
      room: idle ? null : (body.room || null),
      idle,
    };
  }
  statsDirty = true;
  jsonRes(res, 200, { ok: true, invites: invitesFor(body.cid, u) });
}
function invitesFor(cid, u) {
  const cut = now() - 180000;
  return (stats().invites || []).filter((i) => i.at > cut && (
    (cid && i.to === cid) || (u && i.toUser && i.toUser === u.id)
  ));
}
function playStats(req, res) {
  const s = stats();
  const top = Object.values(s.plays).sort((a, b) => b.count - a.count).slice(0, 24)
    .map(({ sys, file, name, count }) => ({ sys, file, name, count }));
  const week = now() - 7 * 864e5;
  const trending = Object.values(s.plays).filter((p) => p.last > week)
    .sort((a, b) => b.last - a.last).slice(0, 60)
    .sort((a, b) => (b.recent || b.count) - (a.recent || a.count)).slice(0, 18)
    .map(({ sys, file, name, count }) => ({ sys, file, name, count }));
  const reported = Object.values(s.reports).filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n).slice(0, 30)
    .map(({ sys, file, name, n, issues }) => ({ sys, file, name, n, issues }));
  const cutoff = now() - 90000;
  const live = Object.values(s.sessions).filter((x) => x.at > cutoff);
  const playing = live.filter((x) => x.game);
  const pack = (x) => ({
    cid: x.cid || null, uid: x.uid || null,
    who: x.who || "Someone",
    game: x.game || null,
    sys: x.sys || null, file: x.file || null,
    watch: x.watch || null, netplay: !!x.netplay, room: x.room || null, idle: !x.game,
  });
  jsonRes(res, 200, { top, trending, reported, playingNow: playing.length,
    nowPlaying: playing.map(pack).slice(0, 16),
    online: live.map(pack).slice(0, 40) });
}

async function playInvite(req, res) {
  let b = {};
  try { b = JSON.parse((await readBody(req, 4096)).toString() || "{}"); } catch { /* */ }
  if (!b.to || !b.sys || !b.file) return jsonRes(res, 400, { error: "need to, sys, file" });
  const u = userByToken(req);
  const s = stats();
  s.invites = (s.invites || []).filter((i) => i.at > now() - 120000);
  const inv = {
    id: crypto.randomBytes(4).toString("hex"),
    to: String(b.to), toUser: b.toUser || null, from: String(b.from || ""),
    fromName: u ? u.display : (b.fromName || "Someone"),
    sys: b.sys, file: b.file, name: b.name || b.file,
    watch: b.watch || null, room: b.room || null, np: b.np !== false,
    at: now(),
  };
  s.invites.push(inv);
  statsDirty = true;
  jsonRes(res, 200, { ok: true, id: inv.id });
}
async function playInviteAck(req, res) {
  let b = {};
  try { b = JSON.parse((await readBody(req, 4096)).toString() || "{}"); } catch { /* */ }
  const s = stats();
  s.invites = (s.invites || []).filter((i) => i.id !== b.id);
  statsDirty = true;
  jsonRes(res, 200, { ok: true });
}

// ---- public profile -------------------------------------------------
function publicProfile(req, res, name) {
  const u = accts().users[String(name || "").toLowerCase()];
  if (!u || !(u.settings && u.settings.publicProfile)) return jsonRes(res, 404, { error: "no public profile" });
  const s = stats();
  const mine = Object.values(s.userPlays[u.id] || {});
  const top = mine.sort((a, b) => b.count - a.count).slice(0, 24)
    .map(({ sys, file, name: n, count }) => ({ sys, file, name: n, count }));
  jsonRes(res, 200, {
    display: u.display || u.name, name: u.name, avatar: u.avatar || "🎮", created: u.created,
    accent: (u.settings || {}).accent || null,
    stats: { games: new Set(mine.map((p) => p.file)).size, plays: mine.reduce((a, p) => a + p.count, 0),
      systems: new Set(mine.map((p) => p.sys)).size },
    top,
  });
}

// ---- site banner (owner-set) --------------------------------------
function getBanner(req, res) {
  const b = stats().banner;
  jsonRes(res, 200, (b && (!b.until || b.until > now())) ? b : null);
}

// ---- admin ---------------------------------------------------------
async function admin(req, res, action, u0) {
  const u = userByToken(req);
  if (!isAdmin(u)) return jsonRes(res, 403, { error: "not an admin" });
  const s = stats(), A = accts();
  if (action === "summary" && req.method === "GET") {
    return jsonRes(res, 200, {
      users: Object.values(A.users).map((x) => ({ name: x.name, display: x.display, avatar: x.avatar,
        created: x.created, admin: isAdmin(x) })),
      registration: cfg().registration === "closed" ? "closed" : "open",
      requests: s.requests.filter((r) => !r.done).slice(-50).reverse(),
      reports: Object.entries(s.reports).filter(([, r]) => !r.done && r.n > 0)
        .map(([k, r]) => ({ key: k, ...r })).sort((a, b) => b.last - a.last).slice(0, 50),
      banner: s.banner,
      diskMB: dirSizeMB(DATA),
    });
  }
  const body = await readBody(req, 8192).then((b) => { try { return JSON.parse(b.toString() || "{}"); } catch { return {}; } });
  if (action === "resolve" && req.method === "POST") {
    if (body.request != null && s.requests[body.request]) s.requests[body.request].done = true;
    if (body.report && s.reports[body.report]) s.reports[body.report].done = true;
    statsDirty = true; return jsonRes(res, 200, { ok: true });
  }
  if (action === "banner" && req.method === "POST") {
    s.banner = body.text ? { text: String(body.text).slice(0, 300), kind: body.kind || "info",
      until: body.hours ? now() + body.hours * 36e5 : 0, at: now() } : null;
    statsDirty = true; saveStats(); return jsonRes(res, 200, { ok: true, banner: s.banner });
  }
  if (action === "registration" && req.method === "POST") {
    // write to the config file
    try {
      const c = { ...cfg() }; c.registration = body.open ? "open" : "closed";
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
      configAt = 0;
      return jsonRes(res, 200, { ok: true, registration: c.registration });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }
  jsonRes(res, 400, { error: "bad admin action" });
}
function dirSizeMB(d) {
  let n = 0;
  const walk = (p) => { try { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) walk(f); else try { n += fs.statSync(f).size; } catch { /* */ }
  } } catch { /* */ } };
  walk(d);
  return Math.round(n / 1048576);
}

// ---- report a broken game ------------------------------------------
async function gameReport(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req, 4096)).toString() || "{}"); } catch { return jsonRes(res, 400, { ok: false }); }
  const sys = String(body.sys || "").slice(0, 40), file = String(body.file || "").slice(0, 300);
  const issue = String(body.issue || "won't boot").slice(0, 60);
  if (!sys || !file) return jsonRes(res, 400, { ok: false });
  const s = stats();
  const key = `${sys}/${file}`;
  const r = s.reports[key] || { sys, file, name: body.name || file, n: 0, issues: {}, last: 0, done: false };
  if (r.done && r.n > 0) { r.done = false; }   // reopen on a new report
  r.n++; r.issues[issue] = (r.issues[issue] || 0) + 1; r.last = now(); r.name = body.name || r.name;
  s.reports[key] = r; statsDirty = true;
  const hook = cfg().discordWebhook;
  if (hook && r.n <= 3) {
    fetch(hook, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `⚠️ **Broken game report** — ${r.name} (${sys}) · "${issue}" · ${r.n}× total` }) }).catch(() => {});
  }
  jsonRes(res, 200, { ok: true });
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

// ---- request-a-game -> stored + optional Discord webhook -----------
async function gameRequest(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req, 8192)).toString() || "{}"); } catch { return jsonRes(res, 400, { ok: false }); }
  const title = String(body.title || "").trim().slice(0, 200);
  const note = String(body.note || "").trim().slice(0, 500);
  const u = userByToken(req);
  const who = (u ? u.display : String(body.who || "").trim()).slice(0, 60) || "anon";
  if (!title) return jsonRes(res, 400, { ok: false, error: "no title" });
  const s = stats();
  s.requests.push({ title, note, who, at: now(), done: false });
  if (s.requests.length > 500) s.requests = s.requests.slice(-500);
  statsDirty = true; saveStats();
  const hook = cfg().discordWebhook;
  if (hook) fetch(hook, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: `🎮 **Game request** from **${who}**\n> ${title}${note ? `\n> _${note}_` : ""}` }) }).catch(() => {});
  jsonRes(res, 200, { ok: true });
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

// ---- rate limiting + optional write token ------------------------------
const rl = new Map();   // ip -> [timestamps]
function rateLimited(req, res, max, windowMs) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket.remoteAddress || "?";
  const t = now(), arr = (rl.get(ip) || []).filter((x) => x > t - windowMs);
  arr.push(t); rl.set(ip, arr);
  if (rl.size > 5000) for (const [k, v] of rl) if (!v.some((x) => x > t - 60000)) rl.delete(k);
  if (arr.length > max) { res.writeHead(429, { ...CORS, "retry-after": "30" }).end("slow down"); return true; }
  return false;
}
function tokenOK(req) {
  const want = cfg().writeToken;
  if (!want) return true;                      // no token configured -> open (tailnet mode)
  const got = req.headers["x-ssw-token"] || new URL(req.url, "http://x").searchParams.get("t");
  return got === want;
}

function proxyToNetplay(req, res) {
  const p = http.request({
    hostname: "127.0.0.1", port: 8712, path: req.url, method: req.method,
    headers: { ...req.headers, host: "127.0.0.1:8712" },
  }, (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
  p.on("error", () => { if (!res.headersSent) res.writeHead(502, CORS).end("netplay down"); });
  req.pipe(p);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { ...CORS, "access-control-max-age": "86400", "access-control-allow-headers": "range, content-type, x-ssw-token, x-ssw-auth" }).end(); return; }

  {
    const u0 = new URL(req.url, "http://x");
    const P = u0.pathname;

    // same-origin netplay (websocket on :443). Cross-port :8712 often falls
    // back to HTTP polling and inputs arrive seconds late.
    if (P.startsWith("/socket.io") || (P === "/list" && u0.searchParams.has("game_id"))) {
      proxyToNetplay(req, res); return;
    }

    // ---- auth ----
    if (P === "/auth/register" && req.method === "POST") { if (rateLimited(req, res, 10, 60000)) return; authRegister(req, res); return; }
    if (P === "/auth/login" && req.method === "POST") { if (rateLimited(req, res, 12, 60000)) return; authLogin(req, res); return; }
    if (P === "/auth/me" && req.method === "GET") { authMe(req, res); return; }
    if (P === "/auth/update" && req.method === "POST") { if (rateLimited(req, res, 20, 60000)) return; authUpdate(req, res); return; }
    const pp = P.match(/^\/u\/([^/]+)$/);
    if (pp && req.method === "GET") { publicProfile(req, res, decodeURIComponent(pp[1])); return; }
    if (P === "/banner" && req.method === "GET") { getBanner(req, res); return; }
    const am = P.match(/^\/admin\/([a-z]+)$/);
    if (am) { if (rateLimited(req, res, 60, 60000)) return; admin(req, res, am[1], u0); return; }

    // ---- health check (for app recovery probe) ----
    if (P === "/health" && req.method === "GET") {
      jsonRes(res, 200, { ok: true, uptime: Math.floor(process.uptime()), timestamp: now() });
      return;
    }

    // ---- WebRTC netplay signalling ----
    if (P === "/np/health" && req.method === "GET") { jsonRes(res, 200, { ok: true }); return; }
    if (P === "/np/room" && req.method === "POST") {
      if (rateLimited(req, res, 30, 60000)) return;
      let b = {};
      try { b = JSON.parse((await readBody(req, 4096)).toString() || "{}"); } catch { /* */ }
      // `reuse` lets a host that reloaded/backgrounded reclaim the same room id
      // (guests keep polling it). Any other value gets a fresh id.
      const reuse = (typeof b.reuse === "string" && /^[0-9a-f]{4,32}$/i.test(b.reuse)) ? b.reuse : null;
      const id = reuse || crypto.randomBytes(4).toString("hex");
      NP_SIG.set(id, { id, host: b.cid || "", sys: b.sys, file: b.file, name: b.name || "Game",
        n: 0, msgs: [], at: now() });
      jsonRes(res, 200, { id }); return;
    }
    if (P === "/np/sig" && req.method === "POST") {
      let b = {};
      try { b = JSON.parse((await readBody(req, 65536)).toString() || "{}"); } catch { /* */ }
      const r = NP_SIG.get(b.room);
      if (!r) { jsonRes(res, 404, { error: "no room" }); return; }
      r.n++; r.at = now();
      r.msgs.push({ n: r.n, from: b.from, payload: b.payload });
      if (r.msgs.length > 80) r.msgs.splice(0, r.msgs.length - 40);
      jsonRes(res, 200, { ok: true, n: r.n }); return;
    }
    if (P === "/np/sig" && req.method === "GET") {
      const room = u0.searchParams.get("room");
      const after = +u0.searchParams.get("after") || 0;
      const r = NP_SIG.get(room);
      if (!r) { jsonRes(res, 404, { error: "no room" }); return; }
      jsonRes(res, 200, { host: r.host, sys: r.sys, file: r.file, name: r.name,
        after: r.n, msgs: r.msgs.filter((m) => m.n > after) });
      return;
    }

    // ---- lounge chat (one shared room, in memory) ----
    if (P === "/chat" && req.method === "POST") {
      if (rateLimited(req, res, 60, 60000)) return;
      let b = {};
      try { b = JSON.parse((await readBody(req, 8192)).toString() || "{}"); } catch { /* */ }
      const text = String(b.text || "").trim().slice(0, 500);
      if (!text) { jsonRes(res, 400, { error: "empty message" }); return; }
      const u = userByToken(req);
      CHAT.push({ id: crypto.randomBytes(4).toString("hex"),
        who: (u ? u.display : String(b.who || "Guest")).slice(0, 40),
        text, at: Date.now(), uid: u ? u.id : null });
      if (CHAT.length > CHAT_MAX) CHAT.splice(0, CHAT.length - CHAT_MAX);
      jsonRes(res, 200, { ok: true }); return;
    }
    if (P === "/chat" && req.method === "GET") {
      const after = +u0.searchParams.get("after") || 0;
      jsonRes(res, 200, { msgs: CHAT.filter((m) => m.at > after) }); return;
    }

    // ---- watch party (before the write-token gate; frames are jpeg, not saves) ----
    if (P === "/watch" && req.method === "POST") {
      if (rateLimited(req, res, 20, 60000)) return;
      let b = {};
      try { b = JSON.parse((await readBody(req, 4096)).toString() || "{}"); } catch { /* */ }
      const id = crypto.randomBytes(4).toString("hex");
      const u = userByToken(req);
      WATCH.set(id, { sys: b.sys || null, file: b.file || null, name: b.name || "Game",
        host: u ? u.display : (b.who || "Host"), at: now(), frame: null, ctype: "image/jpeg",
        room: (typeof b.room === "string" && /^[0-9a-f]{4,32}$/i.test(b.room)) ? b.room : null });
      jsonRes(res, 200, { id, url: `/#/watch/${id}` }); return;
    }
    if (P === "/watch/list" && req.method === "GET") {
      pruneWatch();
      jsonRes(res, 200, [...WATCH.entries()].filter(([, w]) => w.frame).map(([id, w]) => watchMeta(id, w)));
      return;
    }
    const wm = P.match(/^\/watch\/([a-z0-9]+)(?:\/(frame))?$/i);
    if (wm) {
      const id = wm[1], kind = wm[2];
      const w = WATCH.get(id);
      if (req.method === "PUT" && kind === "frame") {
        if (rateLimited(req, res, 240, 60000)) return;
        if (!w) { res.writeHead(404, CORS).end("no room"); return; }
        const chunks = []; let n = 0;
        req.on("data", (c) => {
          n += c.length;
          if (n > WATCH_MAX) { req.destroy(); res.writeHead(413, CORS).end("too big"); return; }
          chunks.push(c);
        });
        req.on("end", () => {
          if (res.writableEnded) return;
          w.frame = Buffer.concat(chunks); w.at = now();
          w.ctype = (req.headers["content-type"] || "image/jpeg").split(";")[0];
          res.writeHead(200, { ...CORS, "content-type": "application/json" }).end('{"ok":true}');
        });
        return;
      }
      if (req.method === "DELETE") {
        WATCH.delete(id); jsonRes(res, 200, { ok: true }); return;
      }
      if (!w) { res.writeHead(404, CORS).end("no room"); return; }
      if (kind === "frame" && (req.method === "GET" || req.method === "HEAD")) {
        if (!w.frame) { res.writeHead(204, CORS).end(); return; }
        res.writeHead(200, { ...CORS, "content-type": w.ctype || "image/jpeg",
          "content-length": w.frame.length, "cache-control": "no-store" });
        if (req.method === "HEAD") return res.end();
        res.end(w.frame); return;
      }
      if (req.method === "GET") { jsonRes(res, 200, watchMeta(id, w)); return; }
    }

    const writeEP = req.method === "PUT" || req.method === "DELETE"
      || (req.method === "POST" && (P === "/request" || P === "/report"));
    if (writeEP && rateLimited(req, res, 40, 60000)) return;
    // a valid account token also authorises writes when a writeToken is configured
    if (writeEP && !tokenOK(req) && !userByToken(req)) { res.writeHead(401, CORS).end("token required"); return; }

    if (P === "/states/list" && req.method === "GET") { statesList(req, res); return; }
    const sm = P.match(/^\/states\/([^/]+)\/(.+)$/);
    if (sm) {
      const sys = decodeURIComponent(sm[1]), rel = decodeURIComponent(sm[2].replace(/\?.*$/, ""));
      if (req.method === "GET" || req.method === "HEAD") { stateGet(req, res, sys, rel, u0); return; }
      if (req.method === "PUT") { statePut(req, res, sys, rel, u0); return; }
      if (req.method === "DELETE") { stateDelete(req, res, sys, rel, u0); return; }
      res.writeHead(405, CORS).end("no"); return;
    }
    // POST/GET dynamic endpoints
    if (P === "/play/ping" && req.method === "POST") { if (rateLimited(req, res, 120, 60000)) return; playPing(req, res); return; }
    if (P === "/play/stats" && req.method === "GET") { playStats(req, res); return; }
    if (P === "/play/invite" && req.method === "POST") { if (rateLimited(req, res, 40, 60000)) return; playInvite(req, res); return; }
    if (P === "/play/invite/ack" && req.method === "POST") { playInviteAck(req, res); return; }
    if (P === "/play/invites" && req.method === "GET") {
      const cid = u0.searchParams.get("cid") || "";
      jsonRes(res, 200, { invites: invitesFor(cid, userByToken(req)) }); return;
    }
    if (P === "/report" && req.method === "POST") { gameReport(req, res); return; }
    if (P === "/twitch/status" && req.method === "GET") { twitchStatus(req, res); return; }
    if (P === "/discord/info" && req.method === "GET") { discordInfo(req, res); return; }
    if (P === "/request" && req.method === "POST") { gameRequest(req, res); return; }
    if (P === "/search" && req.method === "GET") { serveSearch(req, res, u0); return; }
    const ma = P.match(/^\/music\/art\/(.+)$/);
    if (ma && (req.method === "GET" || req.method === "HEAD")) { serveMusicArt(req, res, decodeURIComponent(ma[1])); return; }
    const ejs = P.match(/^\/emulatorjs\/(.+)$/);
    if (ejs && (req.method === "GET" || req.method === "HEAD")) { serveEjs(req, res, decodeURIComponent(ejs[1])); return; }
    const th = P.match(/^\/thumb\/(.+)$/);
    if (th && (req.method === "GET" || req.method === "HEAD")) { serveThumb(req, res, th[1]); return; }
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

  const gv = p.match(/^\/gamevideo\/([^/]+)\/(.+)$/);
  if (gv) { serveGameVideo(req, res, decodeURIComponent(gv[1]), decodeURIComponent(gv[2])); return; }

  serveStatic(req, res, p + u.search);
});
server.on("upgrade", (req, socket, head) => {
  const pth = (req.url || "").split("?")[0];
  if (!pth.startsWith("/socket.io")) { socket.destroy(); return; }
  const headers = { ...req.headers, host: "127.0.0.1:8712" };
  const p = net.connect(8712, "127.0.0.1", () => {
    p.write(`${req.method} ${req.url} HTTP/1.1\r\n` +
      Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") +
      "\r\n\r\n");
    if (head && head.length) p.write(head);
    p.pipe(socket); socket.pipe(p);
  });
  p.on("error", () => socket.destroy());
  socket.on("error", () => p.destroy());
});
server.listen(PORT, HOST, () => console.log(`arcade-server  http://${HOST}:${PORT}  site=${SITE}`));
