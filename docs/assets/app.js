"use strict";

/* ========================================================================
   retroverse — hash-routed vanilla JS, no build step.
   ⚠  Editing THIS file or style.css? Do the version-bump ritual:
      bump VERSION in sw.js + both ?v= in index.html + CHANGELOG, then deploy.
      Full operational notes: ../../AGENTS.md
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
/* Overlays and toasts must mount inside the player shell while a game is up:
   `.player` is the element setLandscape() puts in the Fullscreen API top layer,
   and only that element's descendants render above it. A `document.body`
   overlay (z-index 400) is invisible behind a fullscreen game. */
function uiRoot() {
  const p = document.querySelector(".player");
  return (window.__emuUp && p && p.isConnected) ? p : document.body;
}
let _toastT;
function toast(msg) {
  let t = document.getElementById("toast");
  const root = uiRoot();
  if (!t) t = el("div", { id: "toast" });
  if (t.parentNode !== root) root.append(t);
  t.textContent = msg; t.classList.add("show");
  clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---- config --------------------------------------------------------- */
const TS = "https://shadow-1.tail51f9d6.ts.net";
const SELF_HOSTED = location.hostname.endsWith(".ts.net");
const IN_APP = /ShadowSwordsApp|RetroVerseApp/.test(navigator.userAgent);   // native wrapper intercepts _blank → phone browser
if (IN_APP) document.documentElement.classList.add("in-app");
// EmulatorJS draws a hamburger (three bars) in the top-right of the game, but its
// only handler toggles EJS's own bottom menu bar, which sits under the touch
// controls — so it looks like it does nothing. Repurpose it: tapping it toggles
// our in-game control bar. Intercept in the capture phase so EJS's touchstart /
// mousedown / click handlers never fire.
if (IN_APP) {
  let sswHambLast = 0;
  const sswHamburger = (e) => {
    const t = e.target;
    if (!(t && t.closest && t.closest(".ejs_virtualGamepad_open"))) return;
    e.preventDefault(); e.stopPropagation();
    const now = Date.now();
    if (now - sswHambLast < 350) return;
    sswHambLast = now;
    window.__sswChromeToggle && window.__sswChromeToggle();
  };
  for (const ev of ["pointerdown", "touchstart", "touchend", "mousedown", "mouseup", "click"]) {
    document.addEventListener(ev, sswHamburger, true);
  }
}
const extTarget = { target: "_blank", rel: "noopener" };      // keep the signal the app hooks on
const ROM_BASE = SELF_HOSTED ? "/roms/" : TS + "/roms/";       // needs Funnel when off-tailnet
const MUSIC_BASE = SELF_HOSTED ? "/music/" : TS + "/music/";
const MOVIES_URL = TS + ":8443/";                               // opens in a new tab
const EMU_DATA_DEFAULT = SELF_HOSTED ? "/emulatorjs/" : "https://cdn.emulatorjs.org/stable/data/";
// the native wrapper may inject window.__ssEjsBase (a local http://127.0.0.1:<port>/emulatorjs/
// server backed by an on-device cache) to make the emulator itself work offline —
// EmulatorJS loads the core from a blob worker that a service worker can't reach.
const emuData = () => (typeof window.__ssEjsBase === "string" && window.__ssEjsBase) || EMU_DATA_DEFAULT;
const EMU_DATA = EMU_DATA_DEFAULT;   // back-compat for anything still referencing it directly
const STATE_BASE = SELF_HOSTED ? "/states/" : TS + "/states/";   // cloud save-states
const API = SELF_HOSTED ? "" : TS;                               // dynamic endpoints (search, stats, twitch…)
const VIDEO_BASE = SELF_HOSTED ? "/gamevideo/" : TS + "/gamevideo/"; // ES-DE game preview clips
const NETPLAY_URL = TS + ":8712/";                                // EmulatorJS netplay signalling (tailnet)
// ICE: keep STUN. Host-only candidates look clean on the tailnet, but browsers
// mDNS-obfuscate private IPs (100.x included) and those `.local` names don't
// resolve across the tailnet, so host-only ICE silently fails to connect for a
// remote peer. STUN gives srflx candidates; ICE still prefers a reachable direct
// host pair when there is one.
const NETPLAY_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];
// stable numeric id per game — EmulatorJS netplay requires a number, and 4.2.3
// hides the globe unless this is set. FNV-1a → 31-bit so it stays a real JS int.
function gameIdNum(sys, file) {
  const s = String(sys || "") + "\0" + String(file || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 1) || 1;
}
function netplayUrl() {
  if (prefs().netplay === false) return null;
  let raw;
  try { raw = localStorage.getItem("ssw:netplay"); } catch { raw = null; }
  if (raw == null) return NETPLAY_URL;
  let v = raw;
  try { v = JSON.parse(raw); } catch { /* accept a raw string from the console */ }
  if (v === "off" || v === false) return null;
  if (typeof v === "string" && v.trim()) return v.trim();
  return NETPLAY_URL;
}
function toggleTouchPad() {
  document.documentElement.classList.toggle("hide-touch");
  const on = document.documentElement.classList.contains("hide-touch");
  const b = document.getElementById("pad-btn");
  if (b) b.textContent = on ? "Show pad" : "Hide pad";
}
/* ---- per-system touch-pad layout -----------------------------------------
   Size / opacity / vertical position of the on-screen gamepad, saved per
   console (fighting games want it big; RPGs want it out of the way). Applied
   as CSS variables consumed by style.css. */
const PAD_DEFAULTS = { scale: 1, opacity: 1, bottom: 12 };
function padStore() {
  const s = LS.get("padPresets", null);
  return (s && typeof s === "object") ? { def: s.def || {}, sys: s.sys || {} } : { def: {}, sys: {} };
}
function padPresetFor(sys) {
  const s = padStore();
  return { ...PAD_DEFAULTS, ...(s.def || {}), ...((s.sys || {})[sys] || {}) };
}
function applyPadVals(p) {
  const r = document.documentElement.style;
  r.setProperty("--pad-scale", String(p.scale));
  r.setProperty("--pad-opacity", String(p.opacity));
  r.setProperty("--pad-bottom", p.bottom + "px");
}
function applyPadPreset(sys) { applyPadVals(padPresetFor(sys)); }
function savePadPreset(sys, patch, asDefault) {
  const s = padStore();
  if (asDefault) s.def = { ...(s.def || {}), ...patch };
  else s.sys = { ...(s.sys || {}), [sys]: { ...((s.sys || {})[sys] || {}), ...patch } };
  LS.set("padPresets", s);
  applyPadPreset(sys);
}
function padLayoutPanel(sys) {
  const o = el("div", { id: "help-overlay", onclick: (e) => { if (e.target.id === "help-overlay") o.remove(); } });
  const cur = { ...padPresetFor(sys) };
  const refs = [];
  const sync = () => refs.forEach((f) => f());
  const commit = () => applyPadVals(cur);
  const slider = (key, label, min, max, step, fmt) => {
    const inp = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(cur[key]) });
    const out = el("span", { className: "hint", textContent: fmt(cur[key]) });
    inp.oninput = () => { cur[key] = +inp.value; out.textContent = fmt(cur[key]); commit(); };
    refs.push(() => { inp.value = String(cur[key]); out.textContent = fmt(cur[key]); });
    return el("label", { style: "display:block;margin:12px 0" },
      el("div", { style: "font-weight:700", textContent: label }), inp, out);
  };
  const preset = (label, scale, opacity) => el("button", { className: "btn btn-ghost", style: "margin-right:6px",
    textContent: label, onclick: () => { cur.scale = scale; cur.opacity = opacity; commit(); sync(); } });
  o.append(el("div", { className: "help-card" },
    el("h3", { textContent: "Touch pad layout" }),
    el("p", { className: "hint", textContent: `Size, opacity and height for ${sysName(sys)}. Saved on this device.` }),
    el("div", { style: "margin:8px 0 4px" }, preset("Small", 0.8, 0.9), preset("Medium", 1, 1), preset("Large", 1.25, 1)),
    slider("scale", "Size", 0.6, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`),
    slider("opacity", "Opacity", 0.3, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
    slider("bottom", "Height from bottom", 0, 120, 4, (v) => `${v}px`),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px" },
      el("button", { className: "btn btn-primary", textContent: `Save for ${sysName(sys)}`,
        onclick: () => { savePadPreset(sys, cur, false); toast(`Pad layout saved for ${sysName(sys)}`); o.remove(); } }),
      el("button", { className: "btn btn-ghost", textContent: "Use for all consoles",
        onclick: () => { savePadPreset(sys, cur, true); toast("Default pad layout saved"); o.remove(); } }),
      el("button", { className: "btn btn-ghost", textContent: "Reset",
        onclick: () => { Object.assign(cur, PAD_DEFAULTS); commit(); sync(); } }),
      el("button", { className: "btn btn-ghost", textContent: "Close", onclick: () => o.remove() }))));
  uiRoot().append(o);
}
function landNow() {
  try { return matchMedia("(orientation: landscape)").matches; } catch { return false; }
}
function setLandscape(wantLandscape) {
  if (IN_APP) {
    // The wrapper owns rotation (window.SSPlay): "1" = landscape, "0" = portrait.
    // It ignores a repeat of the state it already has, so send the opposite first
    // to force a genuine change, then the target.
    try {
      window.SSPlay && window.SSPlay.postMessage("0");
      if (wantLandscape) setTimeout(() => { try { window.SSPlay && window.SSPlay.postMessage("1"); } catch { /* */ } }, 60);
    } catch { /* */ }
  } else {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (fs) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      else {
        const node = document.querySelector(".player") || document.documentElement;
        (node.requestFullscreen || node.webkitRequestFullscreen)?.call(node);
      }
    } catch { /* */ }
    try { if (wantLandscape) screen.orientation.lock("landscape").catch(() => {}); else screen.orientation.unlock?.(); } catch { /* */ }
  }
}
document.addEventListener("fullscreenchange", () => {
  document.documentElement.classList.toggle("ejs-fs", !!document.fullscreenElement);
  if (document.fullscreenElement) {
    try { screen.orientation.lock("landscape").catch(() => {}); } catch { /* */ }
    try { window.SSPlay && window.SSPlay.postMessage("1"); } catch { /* */ }
  }
});
function rememberSession(extra) {
  if (!extra || !extra.sys || extra.sys === "upload") return;
  const prev = LS.get("lastSession", {}) || {};
  LS.set("lastSession", Object.assign({}, prev, extra, { t: Date.now() }));
}
function forgetSession() {
  try { localStorage.removeItem("ssw:lastSession"); } catch { /* */ }
  try { localStorage.removeItem("ssw:joinNp"); } catch { /* */ }
  try { localStorage.removeItem("ssw:hostNp"); } catch { /* */ }   // explicit exit = stop hosting
}
function snapshotNetplay(sys, file, name) {
  const np = window.EJS_emulator?.netplay;
  const room = (np && (np.extra?.room_name || np.roomName)) || window.__npRoom || null;
  if (room) window.__npRoom = room;
  if (np && (np.owner || np.extra)) {
    window.__inNetplay = true;
    if (window.__watchT) { clearInterval(window.__watchT); window.__watchT = 0; }
  }
  rememberSession({ sys, file, name, room, np: !!window.__inNetplay });
}
/* WebRTC netplay — replaces EmulatorJS's broken savestate lockstep.
   Host = player 1, guest = player 2. Inputs ride a datachannel on the tailnet. */
const NP = { role: null, room: null, pc: null, dc: null, myP: 0, after: 0, pollT: 0, alive: false, pendingIce: [], rxLen: 0, rxGot: 0, rxChunks: [], syncT: 0, sent: 0, recv: 0, video: false, hostStream: null, mic: null, micTrack: null, micSender: null, remoteAudio: null, pingT: 0, rtt: 0, meReady: false, peerReady: false, micMuted: false };

// Netplay diagnostics: kept in memory and shown in the Netplay sheet so a
// failure can be read off a phone with no devtools.
function npLog(msg) {
  const line = `${new Date().toLocaleTimeString()} ${msg}`;
  (window.__npLog ||= []).push(line);
  if (window.__npLog.length > 200) window.__npLog.shift();
  window.__npLast = line;
  try { console.log("[netplay]", msg); } catch { /* */ }
}

// Small live badge so the host can see P2 actually linked (not just a toast).
function npIndicator() {
  let text = null;
  const open = NP.dc?.readyState === "open";
  const ping = (open && NP.rtt) ? ` · ${NP.rtt} ms` : "";
  const ready = (open && NP.peerReady) ? " ✓ ready" : "";
  if (NP.role === "host") text = open ? `● P2 connected${ping}${ready}` : (NP.room ? "○ Waiting for P2" : null);
  else if (NP.role === "guest") text = open ? `● Watching P1${ping}${ready}` : "○ Connecting…";
  let b = document.getElementById("np-live");
  if (!text) { b?.remove(); return; }
  if (!b) {
    b = el("div", { id: "np-live", style: "position:fixed;right:max(8px,env(safe-area-inset-right));top:max(8px,env(safe-area-inset-top));z-index:1000;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.04em;background:rgba(6,6,12,.82);border:1px solid var(--gold,#ffd23d);color:var(--gold,#ffd23d);pointer-events:none" });
    uiRoot().append(b);
  }
  b.textContent = text;
}
function npCore(p, i, v) {
  const fn = window.EJS_emulator?.gameManager?.functions?.simulateInput;
  if (typeof fn === "function") fn(p, i, v);
}
function npHookInput(tries = 0) {
  const gm = window.EJS_emulator?.gameManager;
  // A guest that joins while the ROM is still booting has no gameManager yet;
  // without retrying here its local input is never wired to player 2.
  if (!gm || typeof gm.simulateInput !== "function") {
    if (tries < 80) setTimeout(() => npHookInput(tries + 1), 250);
    return;
  }
  if (gm.__sswRtc) return;
  gm.__sswRtc = true;
  const orig = gm.simulateInput.bind(gm);
  gm.simulateInput = (p, i, v) => {
    if (!NP.dc || NP.dc.readyState !== "open") return orig(p, i, v);
    if ([24, 25, 26, 27, 28, 29].includes(i)) return orig(p, i, v);
    const me = NP.myP;
    if (NP.video) {
      // Host-authoritative: only the host simulates. The host applies its own
      // P1 presses locally; the guest forwards its presses to the host and
      // applies nothing (it just renders the host's stream).
      if (me === 0) npCore(0, i, v);
      else { try { NP.dc.send(JSON.stringify({ t: "i", p: 1, i, v })); } catch { /* */ } }
      return;
    }
    npCore(me, i, v);
    try { NP.dc.send(JSON.stringify({ t: "i", p: me, i, v })); } catch { /* */ }
  };
}
function npBindDc(dc) {
  NP.dc = dc;
  dc.onopen = () => {
    window.__inNetplay = true;
    npLog(`dc open role=${NP.role}`);
    npIndicator();
    _npReconnect = 0;
    NP.meReady = false; NP.peerReady = false;
    npHookInput();
    toast(NP.role === "host" ? "P2 can join — you are Player 1" : "Linked — you are Player 2");
    // The host is the reference. Push its screen to the guest once on link-up,
    // then keep nudging it back in step: without a shared frame clock the two
    // cores drift apart after a few seconds. The guest only ever applies.
    if (NP.role === "host" && !NP.video) {
      clearInterval(NP.syncT);
      NP.syncT = setInterval(() => { if (NP.dc && NP.dc.readyState === "open") npSendState(); }, 6000);
      setTimeout(() => { if (NP.dc && NP.dc.readyState === "open") npSendState(); }, 1200);
    }
    // Renegotiate only after the link is up (adding/removing the mic track
    // after this point triggers a fresh offer; the peer answers).
    if (NP.pc) NP.pc.onnegotiationneeded = async () => {
      if (!NP.alive || !NP.pc || NP.pc.signalingState !== "stable") return;
      try {
        const o = await NP.pc.createOffer();
        await NP.pc.setLocalDescription(o);
        npSendLocalSdp();
        npLog("renegotiate: offer sent");
      } catch (e) { npLog(`renegotiate err ${e?.message || e}`); }
    };
    if (prefs().npVoice === true) npSetVoice(true).then(() => { npUpdatePtt(); npIndicator?.(); });
    // Live RTT readout (shown in the sheet + badge).
    clearInterval(NP.pingT);
    NP.pingT = setInterval(() => {
      if (NP.dc && NP.dc.readyState === "open") { try { NP.dc.send(JSON.stringify({ t: "ping", ts: Date.now() })); } catch { /* */ } npIndicator(); }
    }, 2000);
  };
  dc.onclose = () => {
    window.__inNetplay = false;
    npLog("dc closed");
    clearInterval(NP.syncT); NP.syncT = 0;
    clearInterval(NP.pingT); NP.pingT = 0;
    npIndicator();
    if (NP.alive) { toast("Netplay disconnected"); npScheduleReconnect(); }
  };
  dc.onmessage = (e) => {
    if (typeof e.data !== "string") {
      // Savestate bytes. A state can be far larger than the datachannel's max
      // message size (SNES ~0.4 MB, Genesis ~1 MB, NDS ~6 MB), so the sender
      // chunks it — reassemble here before loading.
      const gm = window.EJS_emulator?.gameManager;
      if (!NP.rxLen) {                        // legacy single-message state
        if (gm?.loadState) try { gm.loadState(new Uint8Array(e.data)); NP.recv++; } catch { /* */ }
        return;
      }
      NP.rxChunks.push(new Uint8Array(e.data));
      NP.rxGot += e.data.byteLength;
      if (NP.rxGot >= NP.rxLen) {
        const total = new Uint8Array(NP.rxGot);
        let o = 0;
        for (const c of NP.rxChunks) { total.set(c, o); o += c.length; }
        NP.rxChunks = []; NP.rxGot = 0; NP.rxLen = 0;
        if (gm?.loadState) try { gm.loadState(total); NP.recv++; npLog(`state applied ${total.length}B`); } catch { /* */ }
      }
      return;
    }
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === "i") npCore(m.p, m.i, m.v);
    else if (m.t === "sc") { NP.rxLen = m.n | 0; NP.rxGot = 0; NP.rxChunks = []; }
    else if (m.t === "ping") { try { NP.dc.send(JSON.stringify({ t: "pong", ts: m.ts })); } catch { /* */ } }
    else if (m.t === "pong") { NP.rtt = Math.max(0, Date.now() - m.ts); }
    else if (m.t === "ready") { NP.peerReady = !!m.r; npIndicator(); }
  };
}
async function npSendSig(payload) {
  if (!NP.room) return;
  await fetch(`${API}/np/sig`, { method: "POST", headers: { "content-type": "application/json", ...authHdr() },
    body: JSON.stringify({ room: NP.room, from: CID, payload }) }).catch(() => {});
}
function npSendLocalSdp() {
  const d = NP.pc && NP.pc.localDescription;
  if (!d) return;
  npSendSig({ sdp: { type: d.type, sdp: d.sdp } });
}
// Host-authoritative video. EmulatorJS can build a MediaStream of the canvas +
// a tap of the game's WebAudio; add both tracks to the peer connection so the
// guest sees and hears the host's game (perfect sync, guest lag ≈ 1 RTT).
function npStartHostStream() {
  NP.video = false;
  try {
    const canvas = document.querySelector("#game canvas");
    if (!canvas) { npLog("host stream: no canvas"); return; }
    const emu = window.EJS_emulator;
    let stream = null;
    if (emu && typeof emu.collectScreenRecordingMediaTracks === "function") {
      stream = emu.collectScreenRecordingMediaTracks(canvas, 60);
    }
    if (!stream || !stream.getTracks().length) {
      stream = typeof canvas.captureStream === "function" ? canvas.captureStream(60) : null;
    }
    if (!stream || !stream.getTracks().length) { npLog("host stream: capture failed"); return; }
    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0];
    if (vt) NP.pc.addTrack(vt, new MediaStream([vt]));   // video-only stream for #np-video
    if (at) NP.pc.addTrack(at);                          // game audio → remote <audio>
    NP.hostStream = stream;
    NP.video = true;
    npLog(`host stream on (${stream.getVideoTracks().length}v/${stream.getAudioTracks().length}a)`);
  } catch (e) { npLog(`host stream error ${e?.message || e}`); }
}
// Guest side: show the host's stream over the (now irrelevant) local canvas and
// mute the local core so only the host's audio plays. The EJS touch pad still
// renders above the video, so the guest keeps its controls.
function npShowHostVideo(stream) {
  NP.video = true;
  clearInterval(NP.syncT); NP.syncT = 0;
  let v = document.getElementById("np-video");
  if (!v) {
    v = el("video", { id: "np-video", autoplay: true, playsInline: true, muted: true,
      style: "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1" });
    v.setAttribute("playsinline", "");
    const stage = document.querySelector(".player-stage") || document.querySelector(".player") || document.body;
    stage.append(v);
    v.onclick = () => { v.muted = false; v.play?.().catch(() => {}); };
  }
  v.srcObject = stream;
  const autoUnmute = prefs().npAutoUnmute !== false;
  v.play?.().then(() => { if (autoUnmute) v.muted = false; toast(autoUnmute ? "You are Player 2 — playing on P1's screen" : "Player 2 — tap the screen to unmute"); })
    .catch(() => { v.muted = true; v.play?.().catch(() => {}); toast("Tap the screen to unmute"); });
  try { window.EJS_emulator?.setVolume?.(0); } catch { /* */ }
  const cv = document.querySelector("#game canvas");
  if (cv) cv.style.visibility = "hidden";   // the video covers it anyway
}
// ---- voice chat (mic track on the same RTCPeerConnection) ----------------
function npRemoteAudioEl() {
  let a = document.getElementById("np-remote-audio");
  if (!a) {
    a = el("audio", { id: "np-remote-audio", autoplay: true, playsInline: true, style: "display:none" });
    a.setAttribute("autoplay", "");
    uiRoot().append(a);
    a.onclick = () => a.play?.().catch(() => {});
  }
  return a;
}
function npAttachRemoteAudio() {
  if (!NP.remoteAudio || !NP.remoteAudio.getAudioTracks().length) return;
  const a = npRemoteAudioEl();
  a.srcObject = NP.remoteAudio;
  a.play?.().catch(() => { document.addEventListener("pointerdown", () => a.play?.().catch(() => {}), { once: true }); });
}
// Enable/disable the local mic. Used by the netplay sheet toggle and auto-run
// on link if prefs().npVoice. Renegotiation is handled by onnegotiationneeded.
// Inside the Android app the OS prompt only appears after the app is told to
// request RECORD_AUDIO, so we signal first and retry getUserMedia once.
async function npGetMic() {
  const ask = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const app = window.SSNotify;
  if (app) { try { app.postMessage(JSON.stringify({ mic: true, cid: CID, origin: location.origin, on: prefs().netplay !== false })); } catch { /* */ } }
  try { return await ask(); }
  catch (e) {
    if (!app) throw e;
    await new Promise((r) => setTimeout(r, 1800));
    return await ask();
  }
}
async function npSetVoice(on) {
  if (on) {
    if (NP.mic) return true;
    try {
      NP.mic = await npGetMic();
    } catch (e) { toast("Mic permission denied"); npLog(`mic denied ${e?.name || e}`); return false; }
    NP.micTrack = NP.mic.getAudioTracks()[0] || null;
    if (NP.micTrack && NP.pc) {
      try { NP.micSender = NP.pc.addTrack(NP.micTrack, new MediaStream([NP.micTrack])); } catch { /* */ }
    }
    NP.micMuted = prefs().npPTT === true;   // PTT starts muted
    npApplyMicMute();
    npLog("mic on");
    return true;
  }
  try { if (NP.micSender && NP.pc) NP.pc.removeTrack(NP.micSender); } catch { /* */ }
  try { NP.mic?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
  NP.mic = null; NP.micTrack = null; NP.micSender = null; NP.micMuted = false;
  npUpdatePtt();
  npLog("mic off");
  return true;
}
// Mic mute / push-to-talk. `enabled=false` mutes without dropping the track.
function npApplyMicMute() {
  try { if (NP.micTrack) NP.micTrack.enabled = !NP.micMuted; } catch { /* */ }
  npUpdatePtt();
}
function npUpdatePtt() {
  let b = document.getElementById("np-ptt");
  const active = NP.dc?.readyState === "open" && NP.mic;
  if (!active) { b?.remove(); return; }
  if (!b) {
    b = el("button", { id: "np-ptt", type: "button",
      style: "position:fixed;left:max(8px,env(safe-area-inset-left));top:50%;transform:translateY(-50%);z-index:1000;width:46px;height:46px;border-radius:50%;font-size:20px;line-height:1;background:rgba(6,6,12,.82);border:1px solid var(--gold,#ffd23d);color:var(--gold,#ffd23d)" });
    uiRoot().append(b);
  }
  const ptt = prefs().npPTT === true;
  b.textContent = NP.micMuted ? "🔇" : "🎙";
  b.title = ptt ? "Hold to talk" : "Mute / unmute mic";
  b.onclick = b.onpointerdown = b.onpointerup = b.onpointerleave = null;
  if (ptt) {
    b.onpointerdown = (e) => { e.preventDefault(); NP.micMuted = false; npApplyMicMute(); };
    b.onpointerup = b.onpointerleave = () => { NP.micMuted = true; npApplyMicMute(); };
  } else {
    b.onclick = () => { NP.micMuted = !NP.micMuted; npApplyMicMute(); };
  }
}
function npStartPc(isHost) {
  NP.pc = new RTCPeerConnection({ iceServers: NETPLAY_ICE });
  NP.pc.onicecandidate = (e) => {
    if (!e.candidate) { npLog("ice gathering complete"); return; }
    const c = e.candidate;
    npLog(`ice cand ${c.type || "?"} ${c.protocol || ""} ${c.address || ""}`);
    npSendSig({ ice: c.toJSON?.() || c });
  };
  NP.pc.onicecandidateerror = (e) => npLog(`ice candidate error ${e.errorCode || "?"} ${e.url || ""}`);
  NP.pc.oniceconnectionstatechange = () => {
    npLog(`ice ${NP.pc.iceConnectionState}`);
    if (NP.pc.iceConnectionState === "failed") toast("Netplay link failed — try again");
  };
  NP.pc.onconnectionstatechange = () => {
    npLog(`pc ${NP.pc.connectionState}`);
    if (NP.pc.connectionState === "connected" && NP.role === "host" && !NP.video) setTimeout(() => npSendState(), 300);
  };
  NP.pc.ontrack = (e) => {
    npLog(`track ${e.track.kind}`);
    if (e.track.kind === "video") {
      if (NP.role === "guest") npShowHostVideo((e.streams && e.streams[0]) || new MediaStream([e.track]));
    } else if (e.track.kind === "audio") {
      (NP.remoteAudio ||= new MediaStream()).addTrack(e.track);
      npAttachRemoteAudio();
    }
  };
  const sendSdpSoon = () => {
    if (NP.pc.iceGatheringState === "complete") npSendLocalSdp();
    else {
      const t = setTimeout(npSendLocalSdp, 1200);
      NP.pc.addEventListener("icegatheringstatechange", () => {
        if (NP.pc.iceGatheringState === "complete") { clearTimeout(t); npSendLocalSdp(); }
      });
    }
  };
  if (isHost) {
    npStartHostStream();     // canvas + tapped game audio, added before the offer
    const dc = NP.pc.createDataChannel("np", { ordered: true });
    npBindDc(dc);
    NP.pc.createOffer().then((o) => NP.pc.setLocalDescription(o)).then(sendSdpSoon);
  } else {
    NP.pc.ondatachannel = (e) => npBindDc(e.channel);
  }
}
async function npHandleSig(m) {
  if (!m || m.from === CID || !NP.pc || !m.payload) return;
  const pl = m.payload;
  if (pl.sdp) {
    const desc = pl.sdp;
    if (NP.pc.signalingState === "stable" && desc.type === "answer") return;
    await NP.pc.setRemoteDescription(desc);
    if (desc.type === "offer") {
      const ans = await NP.pc.createAnswer();
      await NP.pc.setLocalDescription(ans);
      npSendLocalSdp();
    }
  }
  if (pl.ice) {
    if (!NP.pc.remoteDescription) {
      NP.pendingIce.push(pl.ice);
      return;
    }
    await NP.pc.addIceCandidate(pl.ice);
  }
  if (NP.pc.remoteDescription && NP.pendingIce.length) {
    const pending = NP.pendingIce.splice(0);
    for (const ice of pending) await NP.pc.addIceCandidate(ice);
  }
}
function npPoll() {
  if (!NP.alive || !NP.room) return;
  fetch(`${API}/np/sig?room=${encodeURIComponent(NP.room)}&after=${NP.after}`, { cache: "no-store" })
    .then((r) => r.json()).then(async (d) => {
      if (!d || d.error) return;
      NP.after = d.after || NP.after;
      for (const m of (d.msgs || [])) await npHandleSig(m);
    }).catch(() => {}).finally(() => { if (NP.alive) NP.pollT = setTimeout(npPoll, 300); });
}
async function npHost({ sys, file, name, reuse }) {
  const d = await fetch(`${API}/np/room`, { method: "POST", headers: { "content-type": "application/json", ...authHdr() },
    body: JSON.stringify({ sys, file, name, cid: CID, reuse: reuse || undefined }) }).then((r) => r.json());
  NP.room = d.id; NP.role = "host"; NP.myP = 0; NP.after = 0; NP.alive = true;
  window.__npRoom = d.id;
  // Remember we are the host so a reload/background re-hosts instead of
  // becoming Player 2. Cleared on an explicit leave (see npForgetHost).
  LS.set("hostNp", { room: d.id, sys, file, t: Date.now() });
  npStartPc(true);
  npPoll();
  npIndicator();
  return d.id;
}
function npForgetHost() { try { localStorage.removeItem("ssw:hostNp"); } catch { /* */ } }
let _npReconnect = 0;
// Role-aware auto-reconnect. Guest re-joins the room; host re-offers so a
// returning guest can answer. Prevents a reloaded host from becoming Player 2.
function npScheduleReconnect() {
  if (!NP.alive || !NP.room) return;
  if (NP.role === "guest") {
    if (_npReconnect >= 4) { toast("Netplay lost — tap Netplay to rejoin"); return; }
    _npReconnect++;
    const room = NP.room;
    setTimeout(async () => {
      if (!NP.alive || NP.role !== "guest") return;
      if (NP.dc && NP.dc.readyState === "open") { _npReconnect = 0; return; }
      npLog(`guest reconnect ${_npReconnect}`);
      try { await npJoin(room); _npReconnect = 0; toast("Reconnected to P1"); }
      catch { npScheduleReconnect(); }
    }, 1500 * _npReconnect);
  } else if (NP.role === "host") {
    setTimeout(() => {
      if (!NP.alive || NP.role !== "host") return;
      if (NP.dc && NP.dc.readyState === "open") return;
      try { NP.pc?.close(); } catch { /* */ }
      npLog("host re-offer");
      npStartPc(true);
      npIndicator();
    }, 1500);
  }
}
function npWaitLinked(ms = 25000) {
  return new Promise((resolve, reject) => {
    if (NP.dc && NP.dc.readyState === "open") return resolve();
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (NP.dc && NP.dc.readyState === "open") { clearInterval(iv); resolve(); }
      else if (NP.pc && NP.pc.connectionState === "failed") { clearInterval(iv); reject(new Error("ice failed")); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error("timeout")); }
    }, 200);
  });
}
async function npJoin(room) {
  if (!room) throw new Error("no room");
  if (NP.room === room && NP.dc && NP.dc.readyState === "open") return;
  npStop();
  npForgetHost();   // we are the guest now — don't re-host on next load
  NP.room = room; NP.role = "guest"; NP.myP = 1; NP.after = 0; NP.alive = true;
  window.__npRoom = room;
  npLog(`join room ${room}`);
  npStartPc(false);
  npPoll();
  npIndicator();
  toast("Connecting as Player 2…");
  await npWaitLinked();
  npLog("linked");
}
function npStop() {
  NP.alive = false; clearTimeout(NP.pollT);
  clearInterval(NP.syncT); NP.syncT = 0;
  try { NP.dc && NP.dc.close(); } catch { /* */ }
  try { NP.pc && NP.pc.close(); } catch { /* */ }
  try { NP.hostStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
  try { NP.mic?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
  NP.mic = null; NP.micTrack = null; NP.micSender = null; NP.micMuted = false;
  NP.remoteAudio = null;
  clearInterval(NP.pingT); NP.pingT = 0; NP.rtt = 0;
  NP.hostStream = null; NP.video = false;
  document.getElementById("np-video")?.remove();
  document.getElementById("np-remote-audio")?.remove();
  document.getElementById("np-ptt")?.remove();
  npIndicator();
  const cv = document.querySelector("#game canvas");
  if (cv) cv.style.visibility = "";
  NP.dc = NP.pc = NP.room = NP.role = null; NP.myP = 0; NP.pendingIce = [];
  window.__inNetplay = false; window.__npRoom = null;
}
// ---- watch-party over WebRTC (additive; the JPEG stream stays as fallback) ----
const WNP = { room: null, pc: null, stream: null, after: 0, pollT: 0, alive: false, pendingIce: [] };
function wnpSendSig(payload) {
  if (!WNP.room) return;
  fetch(`${API}/np/sig`, { method: "POST", headers: { "content-type": "application/json", ...authHdr() },
    body: JSON.stringify({ room: WNP.room, from: CID, payload }) }).catch(() => {});
}
async function wnpHandleSig(m) {
  if (!m || m.from === CID || !WNP.pc || !m.payload) return;
  const pl = m.payload;
  if (pl.sdp) {
    if (WNP.pc.signalingState === "stable" && pl.sdp.type === "answer") return;
    await WNP.pc.setRemoteDescription(pl.sdp);
    if (pl.sdp.type === "offer") {
      await WNP.pc.setLocalDescription(await WNP.pc.createAnswer());
      const d = WNP.pc.localDescription; if (d) wnpSendSig({ sdp: { type: d.type, sdp: d.sdp } });
    }
  }
  if (pl.ice) {
    if (!WNP.pc.remoteDescription) WNP.pendingIce.push(pl.ice);
    else await WNP.pc.addIceCandidate(pl.ice);
  }
  if (WNP.pc.remoteDescription && WNP.pendingIce.length) {
    for (const ice of WNP.pendingIce.splice(0)) await WNP.pc.addIceCandidate(ice);
  }
}
function wnpPoll() {
  if (!WNP.alive || !WNP.room) return;
  fetch(`${API}/np/sig?room=${encodeURIComponent(WNP.room)}&after=${WNP.after}`, { cache: "no-store" })
    .then((r) => r.json()).then(async (d) => { if (!d || d.error) return; WNP.after = d.after || WNP.after; for (const m of (d.msgs || [])) await wnpHandleSig(m); })
    .catch(() => {}).finally(() => { if (WNP.alive) WNP.pollT = setTimeout(wnpPoll, 300); });
}
function wnpStop() {
  WNP.alive = false; clearTimeout(WNP.pollT);
  try { WNP.pc?.close(); } catch { /* */ }
  try { WNP.stream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
  WNP.pc = null; WNP.stream = null; WNP.room = null; WNP.pendingIce = [];
  document.getElementById("wnp-video")?.remove();
}
async function wnpStartHost() {
  const d = await fetch(`${API}/np/room`, { method: "POST", headers: { "content-type": "application/json", ...authHdr() },
    body: JSON.stringify({ sys: window.__playSys, file: window.__playFile, name: document.title, cid: CID, watch: true }) }).then((r) => r.json());
  WNP.room = d.id; WNP.after = 0; WNP.alive = true;
  WNP.pc = new RTCPeerConnection({ iceServers: NETPLAY_ICE });
  WNP.pc.onicecandidate = (e) => { if (e.candidate) wnpSendSig({ ice: e.candidate }); };
  let stream = null;
  try {
    const canvas = document.querySelector("#game canvas");
    stream = window.EJS_emulator?.collectScreenRecordingMediaTracks?.(canvas, 60) || canvas?.captureStream?.(60) || null;
  } catch { /* */ }
  if (!stream || !stream.getTracks().length) { wnpStop(); return null; }
  WNP.stream = stream;
  for (const t of stream.getTracks()) WNP.pc.addTrack(t, stream);
  await WNP.pc.setLocalDescription(await WNP.pc.createOffer());
  const ld = WNP.pc.localDescription; if (ld) wnpSendSig({ sdp: { type: ld.type, sdp: ld.sdp } });
  wnpPoll();
  return WNP.room;
}
function wnpStartWatch(room, onStream) {
  WNP.room = room; WNP.after = 0; WNP.alive = true;
  WNP.pc = new RTCPeerConnection({ iceServers: NETPLAY_ICE });
  WNP.pc.onicecandidate = (e) => { if (e.candidate) wnpSendSig({ ice: e.candidate }); };
  WNP.pc.ontrack = (e) => onStream((e.streams && e.streams[0]) || new MediaStream([e.track]));
  wnpPoll();
}
async function autoJoinNetplay(wantRoom) {
  if (!wantRoom) { toast("Host hasn't created a room yet — they need to tap Netplay first"); return; }
  try { await npJoin(wantRoom); return; } catch { /* retry once */ }
  npLog("join failed — retrying");
  try { toast("Link failed — retrying as Player 2…"); await npJoin(wantRoom); }
  catch { toast("Couldn't link — host should tap Netplay, then Invite again"); }
}
function acceptInvite(inv) {
  const room = inv.room;
  const playHref = `#/play/${inv.sys}/${String(inv.file || "").split("/").map(encodeURIComponent).join("/")}`;
  if (!room) { toast("Host hasn't created a room yet"); return; }
  const same = window.__emuUp && window.__playSys === inv.sys && window.__playFile === inv.file;
  if (same) { autoJoinNetplay(room); return; }
  LS.set("joinNp", { sys: inv.sys, file: inv.file, room, t: Date.now() });
  if (location.hash === playHref) autoJoinNetplay(room);
  else location.hash = playHref;
}
// A link that opens the game and auto-joins the host's room (?join=<room> is
// consumed by the router, then the play route picks up ssw:joinNp).
function npInviteLink(sys, file, room) {
  const path = (location.pathname || "/").replace(/\?.*$/, "");
  const hash = `#/play/${encodeURIComponent(sys)}/${String(file || "").split("/").map(encodeURIComponent).join("/")}`;
  return `${location.origin}${path}?join=${encodeURIComponent(room || "")}${hash}`;
}
async function copyInviteLink(sys, file, room) {
  const link = npInviteLink(sys, file, room || window.__npRoom || NP.room);
  try { await navigator.clipboard.writeText(link); toast("Invite link copied — send it to your friend"); }
  catch { toast(link); }
}
function openNetplaySheet(sys, file, name) {
  const o = el("div", { id: "help-overlay", onclick: (e) => { if (e.target.id === "help-overlay") o.remove(); } });
  const linked = NP.dc && NP.dc.readyState === "open";
  const role = NP.role === "host" ? "Player 1 · host" : NP.role === "guest" ? "Player 2 · guest" : null;
  const status = linked
    ? `Linked — you are ${role}.` + (NP.video
        ? (NP.role === "host" ? " P2 is watching your screen." : " You're watching P1's screen.")
        : " Sharing inputs (best-effort sync).")
    : (NP.room ? "Room is up — Player 2 taps Join room from the invite." : "Create a room, then invite someone online.");
  const kids = [el("h3", { textContent: "Netplay" }), el("p", { className: "hint", textContent: status })];

  if (!linked && NP.role === "host" && NP.video) {
    kids.push(el("p", { className: "hint", style: "font-size:11px;opacity:.7", textContent: "Streaming is on — waiting for P2 to reconnect." }));
  }
  if (NP.role !== "guest") {
    kids.push(el("button", { className: prefs().npHostByDefault !== false ? "btn btn-primary" : "btn btn-ghost", style: "width:100%;margin:10px 0 6px",
      textContent: NP.room ? "Invite Player 2" : "Create room",
      onclick: async () => {
        o.remove();
        if (window.__watchT) { clearInterval(window.__watchT); window.__watchT = 0; }
        try {
          if (!NP.room) { await npHost({ sys, file, name }); toast("Room created — you are Player 1"); }
          const sb = document.getElementById("np-sync-btn");
          if (sb && !NP.video) { sb.hidden = false; sb.onclick = resyncNetplay; }
          ping(false);
          invitePicker({ sys, file, name, watch: window.__watchId });
        } catch { toast("Couldn't create a room"); }
      } }));
  }
  if (NP.role === "host" && !NP.video) {
    kids.push(el("button", { className: "btn btn-ghost", style: "width:100%;margin:6px 0", textContent: "Sync screens",
      onclick: () => { o.remove(); resyncNetplay(); } }));
  }
  if (NP.room && NP.role !== "guest") {
    kids.push(el("button", { className: "btn btn-ghost", style: "width:100%;margin:6px 0", textContent: "🔗 Copy invite link",
      title: "Share a link that opens this game and auto-joins the room",
      onclick: () => copyInviteLink(sys, file, NP.room) }));
  }
  if (linked) {
    const voiceOn = !!NP.mic;
    const vb = el("button", { className: "btn " + (voiceOn ? "btn-primary" : "btn-ghost"), style: "width:100%;margin:6px 0",
      textContent: voiceOn ? "🎙 Voice chat on" : "🎙 Voice chat",
      title: "Talk to each other over the same connection" });
    vb.onclick = async () => {
      const on = !NP.mic;
      if (!await npSetVoice(on)) return;
      setPref("npVoice", on);
      vb.classList.toggle("btn-primary", on); vb.classList.toggle("btn-ghost", !on);
      vb.textContent = on ? "🎙 Voice chat on" : "🎙 Voice chat";
      toast(on ? "Voice chat on" : "Voice chat off");
    };
    kids.push(vb);
    const rb = el("button", { className: "btn " + (NP.meReady ? "btn-primary" : "btn-ghost"), style: "width:100%;margin:6px 0",
      textContent: NP.meReady ? "✓ Ready — waiting for " + (NP.role === "host" ? "P2" : "P1") : "I'm ready",
      title: "Tell the other player you're set" });
    rb.onclick = () => {
      NP.meReady = !NP.meReady;
      try { NP.dc.send(JSON.stringify({ t: "ready", r: NP.meReady })); } catch { /* */ }
      rb.classList.toggle("btn-primary", NP.meReady); rb.classList.toggle("btn-ghost", !NP.meReady);
      rb.textContent = NP.meReady ? "✓ Ready — waiting for " + (NP.role === "host" ? "P2" : "P1") : "I'm ready";
      if (NP.meReady && NP.peerReady) toast("Both ready — go!");
    };
    kids.push(rb);
    if (NP.mic) {
      const mb = el("button", { className: "btn btn-ghost", style: "width:100%;margin:6px 0",
        textContent: NP.micMuted ? "🔇 Mic muted — tap to unmute" : "🎙 Mic live — tap to mute",
        title: "Mute or unmute your microphone" });
      mb.onclick = () => {
        NP.micMuted = !NP.micMuted; npApplyMicMute();
        mb.textContent = NP.micMuted ? "🔇 Mic muted — tap to unmute" : "🎙 Mic live — tap to mute";
        toast(NP.micMuted ? "Mic muted" : "Mic live");
      };
      kids.push(mb);
    }
  }
  if (NP.role && (linked || NP.room)) {
    kids.push(el("button", { className: "btn btn-ghost", style: "width:100%;margin:6px 0;color:var(--pink,#ff5fa2)",
      textContent: "Leave netplay", title: "Disconnect and stop sharing",
      onclick: () => { npStop(); npForgetHost(); o.remove(); toast("Left netplay"); } }));
  }

  const prefRow = (label, key) => {
    const inp = el("input", { type: "checkbox", checked: prefs()[key] !== false });
    inp.onchange = () => { setPref(key, inp.checked); npLog(`${key}=${inp.checked}`); };
    return el("label", { style: "display:flex;gap:8px;align-items:center;margin:6px 0;font-size:12px;cursor:pointer" }, inp, label);
  };
  kids.push(el("div", { style: "margin-top:10px;padding-top:10px;border-top:1px solid var(--line,#232330)" },
    prefRow("Auto-unmute P2's video", "npAutoUnmute"),
    prefRow("Push-to-talk (hold 🎙 on the left)", "npPTT"),
    prefRow("I usually host", "npHostByDefault")));

  const diag = el("details", { style: "margin-top:12px" },
    el("summary", { className: "hint", style: "cursor:pointer", textContent: "Diagnostics" }),
    el("p", { className: "hint", style: "font-size:11px;opacity:.8;margin:8px 0 2px",
      textContent: `role=${NP.role || "-"} mode=${NP.video ? "host-video" : "input-echo"} pc=${NP.pc?.connectionState || "-"} ice=${NP.pc?.iceConnectionState || "-"} dc=${NP.dc?.readyState || "-"} room=${NP.room || "-"} rtt=${NP.rtt || "-"}ms sent=${NP.sent} recv=${NP.recv}` }));
  if (window.__npLast) diag.append(el("p", { className: "hint", style: "font-size:11px;opacity:.6", textContent: "last: " + window.__npLast }));
  kids.push(diag);
  kids.push(el("button", { className: "btn btn-ghost", style: "width:100%;margin:8px 0 0", textContent: "Close", onclick: () => o.remove() }));
  o.append(el("div", { className: "help-card" }, ...kids));
  uiRoot().append(o);
}
function resyncNetplay() {
  if (NP.video) { toast("Not needed — P2 mirrors your screen"); return; }
  if (NP.role !== "host") { toast("Only the host can sync"); return; }
  if (!NP.dc || NP.dc.readyState !== "open") { toast("Netplay isn't linked yet"); return; }
  if (npSendState()) toast("Sent your screen to P2");
  else toast("Sync failed");
}
// Send the host's current savestate, chunked to stay under the datachannel's
// max message size (a single dc.send of a >256 KB state throws).
function npSendState() {
  const gm = window.EJS_emulator?.gameManager;
  if (NP.role !== "host") return false;
  if (!gm?.getState) { npLog("sync skip: no getState"); return false; }
  if (!NP.dc || NP.dc.readyState !== "open") { npLog("sync skip: dc not open"); return false; }
  try {
    const st = gm.getState();
    const buf = st instanceof Uint8Array ? st : new Uint8Array(st);
    if (!buf.length) { npLog("sync skip: empty state"); return false; }
    const CH = 16384;
    NP.dc.send(JSON.stringify({ t: "sc", n: buf.length }));
    for (let o = 0; o < buf.length; o += CH) NP.dc.send(buf.subarray(o, o + CH));
    NP.sent++;
    npLog(`state sent ${buf.length}B`);
    return true;
  } catch (e) { npLog(`state send error ${e?.message || e}`); return false; }
}
function maybeResumeSession() {
  const s = LS.get("lastSession", null);
  if (!s || !s.sys || !s.file || s.sys === "upload") return false;
  if (Date.now() - (s.t || 0) > 15 * 60 * 1000) return false;
  const h = (location.hash || "").replace(/^#\/?/, "");
  if (h && h !== "play") return false;
  LS.set("joinNp", { sys: s.sys, file: s.file, room: s.room || null, t: Date.now() });
  location.replace("#/play/" + encodeURIComponent(s.sys) + "/" + String(s.file).split("/").map(encodeURIComponent).join("/"));
  return true;
}
const CID = (() => {
  try {
    let c = localStorage.getItem("ssw:cid");
    if (!c) { c = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("ssw:cid", c); }
    return c;
  } catch { return "anon"; }
})();
// In the Android app, hand our presence id to the native side so it can watch
// for netplay invites natively while the WebView is backgrounded/throttled.
function notifyApp() {
  if (!window.SSNotify) return;
  try { window.SSNotify.postMessage(JSON.stringify({ cid: CID, origin: location.origin, on: prefs().netplay !== false })); } catch { /* */ }
}
addEventListener("ssw-prefs", notifyApp);
addEventListener("ssw-auth", notifyApp);
addEventListener("load", () => setTimeout(notifyApp, 800));
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

// curated couch / netplay night — files verified against this library
const MULTIPLAYER_PICKS = [
  { sys: "n64", file: "Mario Kart 64 (NA).z64", tag: "4P" },
  { sys: "n64", file: "Super Smash Bros. (NA).z64", tag: "4P" },
  { sys: "n64", file: "Mario Party (NA).z64", tag: "4P" },
  { sys: "n64", file: "GoldenEye 007 (NA).z64", tag: "4P" },
  { sys: "n64", file: "Diddy Kong Racing (NA, Rev 1).z64", tag: "4P" },
  { sys: "n64", file: "Mario Tennis (NA).z64", tag: "4P" },
  { sys: "snes", file: "Super Mario Kart (NA).sfc", tag: "2P" },
  { sys: "snes", file: "Super Bomberman (NA).sfc", tag: "4P" },
  { sys: "snes", file: "NBA Jam (NA, Rev 1).sfc", tag: "2P" },
  { sys: "snes", file: "Contra III - The Alien Wars (NA).sfc", tag: "2P" },
  { sys: "snes", file: "Kirby Super Star (NA).sfc", tag: "2P" },
  { sys: "snes", file: "Micro Machines (NA).sfc", tag: "2P" },
  { sys: "genesis", file: "Streets of Rage 2 (U) [!].zip", tag: "2P" },
  { sys: "genesis", file: "Golden Axe (JU) (REV 00) [!].zip", tag: "2P" },
  { sys: "nes", file: "Teenage Mutant Ninja Turtles (U) [!].nes", tag: "2P" },
  { sys: "nes", file: "Double Dragon II - The Revenge (U) (PRG1) [!].nes", tag: "2P" },
  { sys: "gba", file: "Advance Wars (NA, Rev 1).gba", tag: "2P" },
  { sys: "psx", file: "Crash Team Racing.img", tag: "4P" },
];
const SYS_NOTES = {
  cps1: "Needs an FBNeo-era romset. Current dumps often fail with “missing files for THIS VERSION”.",
  cps2: "Needs an FBNeo-era romset. Current dumps often fail with “missing files for THIS VERSION”.",
  mame: "Needs a MAME 2003-Plus (0.78) set. Newer romsets won't load.",
  neogeo: "Needs a matching FBNeo set plus neogeo.zip in BIOS.",
  amiga: "PUAE is experimental here — WHDLoad/ADF titles often won't boot.",
  pcecd: "Boots via syscard3; multi-track .cue discs are hit-or-miss.",
  "tg-cd": "Boots via syscard3; multi-track .cue discs are hit-or-miss.",
  segacd: "Needs the region BIOS. Multi-track .cue images sometimes hang black.",
  n64: "Heavy core. Fast-forward helps menus; netplay wants a fast local link.",
  psx: "Heavy core. Disc images (.cue/.bin) beat .img when they exist.",
  nds: "Touch screen is the mouse. Dual-screen layout lives in the emulator menu.",
};
const TITLE_NOTES = [
  { sys: "n64", re: /smash/i, n: "4 players. Extra pads map to P2–P4 automatically." },
  { sys: "n64", re: /mario kart/i, n: "4 players. Mirror mode is in the Grand Prix menu." },
  { sys: "n64", re: /goldeneye|perfect dark/i, n: "4 players. Start a multiplayer match from the title, not the campaign." },
  { sys: "n64", re: /mario party/i, n: "4 players. Mini-games need all pads plugged in before the board." },
  { sys: "snes", re: /bomberman/i, n: "Up to 4 players. Battle mode is the netplay one." },
  { sys: "snes", re: /mario kart/i, n: "2 players. Battle mode is VS on the title." },
  { sys: "genesis", re: /streets of rage/i, n: "2 players. P2 joins at the character select." },
];
function notesFor(sys, file, name) {
  const out = [];
  if (SYS_NOTES[sys]) out.push(SYS_NOTES[sys]);
  const hay = `${name || ""} ${file || ""}`;
  for (const t of TITLE_NOTES) if (t.sys === sys && t.re.test(hay)) out.push(t.n);
  return out;
}

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
  region: "", playingToasts: true, confirmOverwrite: false, previewSound: true,
  netplay: true, netplayName: "", npAutoUnmute: true, npHostByDefault: true, npVoice: false, npPTT: false,
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
  AUTH.isAdmin = !!(user && user.admin);
  if (token) LS.set("auth", token);
  window.dispatchEvent(new Event("ssw-auth"));
  applyPrefs();
}
function signOut() {
  AUTH.token = null; AUTH.user = null; AUTH.isAdmin = false;
  try { localStorage.removeItem("ssw:auth"); } catch { /* */ }
  window.dispatchEvent(new Event("ssw-auth"));
  toast("Signed out");
}
async function hydrateAuth() {
  if (!AUTH.token) { applyPrefs(); return; }
  try { const { user } = await apiAuth("me"); setSession(null, user); }
  catch (e) { if (e.status === 401) signOut(); applyPrefs(); }
}
const ACCENTS = { cyan: "#1fe6ff", pink: "#ff2bd0", green: "#38f5a8", orange: "#ff9d3d", purple: "#b568ff", gold: "#ffd23d" };
function applyPrefs() {
  const p = prefs();
  document.body.classList.toggle("lite", p.lite === true);
  const a = ACCENTS[p.accent];
  const r = document.documentElement.style;
  // "cyan" is the stylesheet default — let the CSS token own it, only override for the rest
  if (a && p.accent && p.accent !== "cyan") { r.setProperty("--cyan", a); r.setProperty("--accent-2", a); }
  else { r.removeProperty("--cyan"); r.removeProperty("--accent-2"); }
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
// Play-page backdrop: a curated set of famous titles across generations
// (data/spotlight.json from build.py); falls back to the random collage.
async function spotlightArt(n = 24) {
  try {
    const rows = await fetch("data/spotlight.json").then((r) => r.json());
    const imgs = rows.map((r) => (r && r[3]) ? artUrl(r[3]) : null).filter(Boolean);
    if (imgs.length >= 6) {
      for (let i = imgs.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [imgs[i], imgs[j]] = [imgs[j], imgs[i]]; }
      return collage(imgs.slice(0, n));
    }
  } catch { /* */ }
  return collageArt(n);
}

function hero({ kicker, title, desc, meta: metaLine, art, actions = [], mod }) {
  const artBox = el("div", { className: "hero-art" });
  if (art) artBox.append(art);
  return el("section", { className: "hero" + (mod ? " " + mod : "") }, artBox,
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

// Home showcase: rotating game preview video (muted, from the ES-DE snaps) with
// a slider to flip to an era-ordered box-art gallery. Falls back to art-only
// when there is no video server (the public GitHub Pages mirror).
function heroShowcase(vids, { title, desc, actions }) {
  const stage = el("div", { className: "hero-art sc-stage" });
  const chip = el("div", { className: "sc-chip", hidden: true });
  const toggle = el("div", { className: "sc-toggle" });
  let mode = "video";                       // home always starts on Preview
  let i = (Math.random() * vids.length) | 0;
  let timer = 0;
  let sound = prefs().previewSound !== false;
  // lower the site music player while a preview with its own audio is playing
  let duckPrev = null;
  const duck = (on) => {
    const ai = MP.ai;
    if (!ai) return;
    if (on) { if (duckPrev == null) duckPrev = ai.volume; ai.volume = Math.min(duckPrev, 0.12); }
    else if (duckPrev != null) { ai.volume = duckPrev; duckPrev = null; }
  };
  const link = (v) => v.play
    ? `#/play/${v.sys}/${v.file.split("/").map(encodeURIComponent).join("/")}`
    : (v.gid ? `#/g/${v.sys}/${v.gid}` : `#/s/${v.sys}`);

  const showVideo = () => {
    clearTimeout(timer);
    const v = vids[i % vids.length];
    const src = VIDEO_BASE + encodeURIComponent(v.sys) + "/" + encodeURIComponent(v.vid);
    const vd = el("video", { className: "sc-v", src, autoplay: true, loop: false,
      playsInline: true, preload: "metadata", poster: v.img ? artUrl(v.img) : null });
    vd.muted = !sound; vd.defaultMuted = !sound; vd.volume = sound ? 0.65 : 0;
    vd.onended = next;
    vd.onerror = () => setMode("art", false);   // don't let a bad clip lock us to art
    timer = setTimeout(next, 34000);
    stage.replaceChildren(vd);
    // Autoplay with sound stays blocked until the page has a user gesture: start
    // muted and unmute on the first tap so the clip's game audio comes through.
    vd.play?.().catch(() => {
      vd.muted = true;
      vd.play?.().catch(() => {});
      if (sound) {
        const unlock = () => { vd.muted = false; vd.volume = 0.65; vd.play?.().catch(() => {}); };
        document.addEventListener("pointerdown", unlock, { once: true });
      }
    });
    chip.replaceChildren(
      el("div", { className: "sc-chip-name", textContent: v.name }),
      el("div", { className: "sc-chip-sub", textContent: [sysName(v.sys), v.year].filter(Boolean).join(" · ") }),
      el("div", { className: "sc-chip-row" },
        el("a", { className: "btn btn-primary sm", href: link(v), textContent: v.play ? "▶ Play this" : "View game" }),
        el("button", { className: "sc-next", ariaLabel: "Next game", textContent: "⏭", onclick: next })));
    chip.hidden = false;
  };
  const next = () => { if (!sec.isConnected) { clearTimeout(timer); return; } i++; if (mode === "video") showVideo(); };
  let gallery = null;
  const showArt = async () => {
    clearTimeout(timer);
    chip.hidden = true;
    if (!gallery) {
      stage.replaceChildren(el("div", { className: "sc-strip-load", textContent: "Loading box art…" }));
      gallery = await fetch("data/artgallery.json").then((r) => r.json()).catch(() => vids);
    }
    if (mode !== "art") return;
    const strip = el("div", { className: "sc-strip" });
    for (const g of gallery) {
      if (!g.img) continue;
      strip.append(el("a", { className: "sc-cover", href: link(g), title: `${g.name} · ${sysName(g.sys)}` },
        el("img", { src: artUrl(g.img), loading: "lazy", alt: g.name }),
        el("span", { textContent: g.year || sysName(g.sys) })));
    }
    stage.replaceChildren(strip);
  };
  const setMode = (m, persist = true) => {
    mode = m; if (persist) LS.set("scMode", m);
    sec.dataset.mode = m;
    stage.querySelector("video")?.pause();
    toggle.querySelectorAll("button[data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    duck(m === "video" && sound);
    (m === "video" ? showVideo : showArt)();
  };
  const soundBtn = el("button", { className: "sc-tg sc-snd", title: "Game sound on previews",
    textContent: sound ? "🔊 Sound" : "🔇 Muted",
    onclick: () => {
      sound = !sound; setPref("previewSound", sound);
      soundBtn.textContent = sound ? "🔊 Sound" : "🔇 Muted";
      const vd = stage.querySelector("video");
      if (vd) { vd.muted = !sound; vd.volume = sound ? 0.65 : 0; if (sound) vd.play?.().catch(() => {}); }
      duck(sound && sec.dataset.mode === "video");
    } });
  toggle.append(
    el("button", { className: "sc-tg", dataset: { m: "video" }, textContent: "▶ Preview", onclick: () => setMode("video") }),
    el("button", { className: "sc-tg", dataset: { m: "art" }, textContent: "▦ Box art", onclick: () => setMode("art") }),
    soundBtn);

  const body = el("div", { className: "hero-body" },
    el("p", { className: "hero-kicker", textContent: "retroverse" }),
    el("h1", { className: "hero-title", textContent: title }),
    el("p", { className: "hero-desc", textContent: desc }),
    el("div", { className: "hero-actions" }, ...actions.map((a) =>
      el("a", { className: "btn " + (a.primary ? "btn-primary" : "btn-ghost"),
        href: a.href || "javascript:void 0", onclick: a.onClick || null, textContent: a.label }))));

  // order: title + actions, then the preview, then the (small) mode toggle
  // directly under it. On desktop `stage` is an absolute backdrop and `toggle`
  // is pinned bottom-left; on mobile they flow in this order.
  const sec = el("section", { className: "hero hero-sc" }, body, stage, toggle, chip);
  setMode(mode);
  return sec;
}

function shelf({ title, count, moreHref, tiles, note }) {
  const track = el("div", { className: "shelf-track" }, ...tiles);
  [...track.children].forEach((t, i) => t.style && t.style.setProperty("--i", Math.min(i, 16)));
  const scroll = (d) => track.scrollBy({ left: d * track.clientWidth * 0.85, behavior: "smooth" });
  return el("section", { className: "shelf" },
    el("div", { className: "shelf-head" },
      el("h2", { textContent: title }),
      count != null && el("span", { className: "count", textContent: count.toLocaleString() }),
      moreHref && el("a", { href: moreHref, textContent: "See all ›" })),
    note && el("p", { className: "shelf-note hint", textContent: note }),
    track,
    el("button", { className: "shelf-nav prev", ariaLabel: "left", textContent: "‹", onclick: () => scroll(-1) }),
    el("button", { className: "shelf-nav next", ariaLabel: "right", textContent: "›", onclick: () => scroll(1) }));
}

function consoleTile(s, { play = false, offline = 0 } = {}) {
  const art = el("div", { className: "tile-art console" });
  if (s.photo) art.append(el("img", { className: "console-photo", src: s.photo, loading: "lazy", alt: s.name }));
  else if (s.logo) art.append(el("img", { className: "console-logo", src: s.logo, loading: "lazy", alt: s.name }));
  else art.append(el("div", { className: "ph", textContent: s.name }));
  return el("a", { className: "tile", href: play ? `#/play/${s.id}` : `#/s/${s.id}`,
      ariaLabel: `${s.name}, ${s.count.toLocaleString()} games${play && s.playable ? ", playable in browser" : ""}` },
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
// deterministic hue from a string — tints the generated sleeves consistently
const hue = (s) => {
  let h = 5381; s = String(s || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
};

// Sports titles get a themed generated sleeve — a sport hue plus a big ghost
// glyph — so an art-less NHL/NBA/NFL/FIFA tile still reads at a glance.
const SPORTS = [
  [/\b(nhl|hockey)\b/i, "🏒", 205],
  [/\b(nba|basketball|ncaa)\b/i, "🏀", 28],
  [/\b(nfl|madden)\b/i, "🏈", 95],
  [/\b(fifa|soccer|mls|world cup)\b/i, "⚽", 145],
  [/\b(mlb|baseball)\b/i, "⚾", 6],
  [/\b(nascar|formula|grand prix|need for speed|racing)\b/i, "🏎", 330],
  [/\b(boxing|wwe|wrestling)\b/i, "🥊", 350],
  [/\b(tennis|golf|skate|surf|snowboard)\b/i, "🏆", 262],
];

// One game cover. Real box art when we have it; otherwise a generated "sleeve"
// (console-tinted, the hardware photo or system wordmark ghosted behind the
// title) so an art-less tile still reads as a shelved game case, not an empty
// slot. Pass `resolve` (an array) to register it for a later hydrateCovers() pass.
function coverArt({ img, name, sys, badge, fav, resolve, file, gid }) {
  const art = el("div", { className: "tile-art" });
  if (img) {
    art.append(el("img", { src: artUrl(img), loading: "lazy", alt: name }));
  } else {
    art.classList.add("noart");
    const sp = SPORTS.find(([re]) => re.test(name || ""));
    art.style.setProperty("--h", sp ? sp[2] : hue(sys || name));
    const m = sys ? meta(sys) : null;
    if (sp) art.append(el("div", { className: "noart-sport", textContent: sp[1] }));
    else if (m && m.photo) art.append(el("img", { className: "noart-bg photo", src: m.photo, loading: "lazy", alt: "" }));
    else if (m && m.logo) art.append(el("img", { className: "noart-bg logo", src: m.logo, loading: "lazy", alt: "" }));
    art.append(el("div", { className: "noart-t", textContent: name }));
    if (m && m.name) art.append(el("div", { className: "noart-s", textContent: m.name }));
    if (resolve && sys && (file || gid)) resolve.push({ sys, file, gid, name, art });
  }
  // badges removed per request (no overlays on tile art)
  if (fav) art.append(heartBtn(fav));
  return art;
}

// Load the systems referenced by art-less tiles and swap real box art in where
// it exists (most cartridge games have libretro art; the per-system JSON just
// isn't loaded on the home page). Capped; skips the giant home-computer sets.
const HYDRATE_SKIP = new Set(["zxspectrum", "amstradcpc", "atari800", "bbcmicro", "x68000"]);
async function hydrateCovers(items, { save } = {}) {
  const bySys = {};
  for (const it of items) if (it.art.classList.contains("noart")) (bySys[it.sys] ||= []).push(it);
  const found = [];
  for (const sid of Object.keys(bySys).slice(0, 10)) {
    if (HYDRATE_SKIP.has(sid)) continue;
    let list;
    try { list = await getSystem(sid); } catch { continue; }
    const bf = new Map(), bi = new Map();
    for (const g of list) { if (g.file) bf.set(g.file, g); bi.set(g.id, g); }
    for (const it of bySys[sid]) {
      const g = (it.file && bf.get(it.file)) || (it.gid && bi.get(it.gid));
      if (!g || !g.img) continue;
      found.push({ sys: sid, file: it.file || (g.file || null), img: g.img });
      if (!it.art.isConnected || !it.art.classList.contains("noart")) continue;
      const im = el("img", { src: artUrl(g.img), loading: "lazy", alt: it.name });
      im.style.animation = "tile-in .3s ease";
      for (const c of [...it.art.children])
        if (!c.classList.contains("badge") && !c.classList.contains("heart")) c.remove();
      it.art.classList.remove("noart");
      it.art.style.removeProperty("--h");
      it.art.prepend(im);
    }
  }
  if (save && found.length) save(found);
}
// backfill resolved art into the "recently played" store so it sticks next time
function backfillRecent(found) {
  const l = recentList(); let changed = false;
  for (const r of l) {
    if (r.img) continue;
    const hit = found.find((f) => f.sys === r.sys && f.file === r.file);
    if (hit && hit.img) { r.img = hit.img; changed = true; }
  }
  if (changed) LS.set("recent", l);
}

function gameTile(g, { play = false, previews = null } = {}) {
  const href = play ? `#/play/${g._sys}/${g.file.split("/").map(encodeURIComponent).join("/")}`
    : `#/g/${g._sys}/${g.id}`;
  const art = coverArt({
    img: g.img, name: g.name, sys: g._sys,
    badge: play ? "Play" : null, fav: g.id ? g : null,
  });
  const tile = el("a", { className: "tile wide", href, ariaLabel: `${g.name}${play ? " — playable" : ""}` },
    art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: g.name }),
      el("div", { className: "s", textContent: [g.year, g.genre].filter(Boolean).join(" · ") || (play ? sysName(g._sys) : "") })));
  const vid = previews && g.file && previews[g._sys + "|" + g.file];
  if (vid) hoverPreview(tile, art, g._sys, vid);
  return tile;
}

// gameplay-clip preview on hover (self-hosted only — the mirror has no clip
// server). One <video> per tile, created on first hover, muted + looping.
const HOVER_OK = typeof matchMedia === "function" && matchMedia("(hover: hover)").matches;
let _gvMap;
const gameVideoMap = () => (_gvMap ||= fetch("data/gamevideos.json").then((r) => r.json())
  .then((l) => Object.fromEntries(l.map((v) => [v.sys + "|" + v.file, v.vid]))).catch(() => ({})));
function hoverPreview(tile, art, sys, vid) {
  if (!SELF_HOSTED && !API) return;
  if (!HOVER_OK && !IN_APP) return;
  let v, leaveT;
  const start = () => {
    if (prefs().lite) return;
    clearTimeout(leaveT);
    if (v) { v.play?.().catch(() => {}); v.classList.add("on"); return; }
    v = el("video", { className: "tile-prev", loop: true, playsInline: true, muted: true, preload: "metadata",
      src: VIDEO_BASE + encodeURIComponent(sys) + "/" + encodeURIComponent(vid) });
    v.muted = true; v.defaultMuted = true;
    v.addEventListener("playing", () => v.classList.add("on"), { once: true });
    v.onerror = () => { v.remove(); v = null; };
    art.append(v);
    v.play?.().catch(() => {});
  };
  const stop = () => { leaveT = setTimeout(() => { if (v) { v.classList.remove("on"); v.pause?.(); } }, 140); };
  if (IN_APP && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) start(); else stop(); });
    }, { threshold: 0.55 });
    io.observe(tile);
    return;
  }
  if (!HOVER_OK) return;
  tile.addEventListener("mouseenter", start);
  tile.addEventListener("mouseleave", stop);
}

const spinner = () => view.replaceChildren(el("div", { className: "spinner", textContent: "Loading…" }));

function tileGrid(container, list, shown, opts = {}) {
  const grid = el("div", { className: "tile-grid" });
  // append (never rebuild) on "show more" so already-shown tiles don't re-animate
  const fill = (from, to) => {
    for (let i = from; i < to && i < list.length; i++) {
      const t = gameTile(list[i], opts);
      t.style.setProperty("--i", Math.min(i - from, 20));
      grid.append(t);
    }
  };
  fill(0, shown);
  const parts = [grid];
  if (list.length > shown) {
    const btn = el("button", { className: "more", onclick: () => {
      const was = grid.children.length;
      fill(was, was + PAGE);
      const left = list.length - grid.children.length;
      if (left <= 0) btn.remove();
      else btn.textContent = `Show more · ${left.toLocaleString()} left`;
    } });
    btn.textContent = `Show more · ${(list.length - shown).toLocaleString()} left`;
    parts.push(btn);
  } else if (!list.length) { parts.length = 0; parts.push(el("div", { className: "empty-state", textContent: "Nothing here." })); }
  container.replaceChildren(...parts);
}

/* ---- routes: browse --------------------------------------------- */
async function routeHome() {
  const token = ++state.render;
  spinner();
  await getSystems().catch(() => {});
  if (token !== state.render) return;
  const { systems, total } = state.sys;
  const playable = systems.filter((s) => s.playable).sort((a, b) => b.count - a.count);

  const frag = document.createDocumentFragment();
  const heroCopy = {
    title: "Come in, Grab a controller.",
    desc: `${total.toLocaleString()} games on the floor — ${playable.length} of them run in the browser. Continue where you left off, or grab a pad.`,
    actions: [
      { label: "▶ Play now", href: "#/play", primary: true },
      { label: "🎲 Surprise me", href: "#/play/random" },
    ],
  };
  const gv = await fetch("data/gamevideos.json").then((r) => r.json()).catch(() => null);
  if (token !== state.render) return;
  if (gv && gv.length) {
    frag.append(heroShowcase(gv, heroCopy));
  } else {
    frag.append(hero({ kicker: "retroverse", ...heroCopy, art: await collageArt(22) }));
    if (token !== state.render) return;
  }

  const resolve = [];
  const recent = recentList();
  if (recent.length) frag.append(shelf({
    title: "Continue playing", count: recent.length,
    note: "Pick up where you left off — cloud saves load automatically.",
    tiles: recent.map((r) => {
      const art = coverArt({ img: r.img, name: r.name, sys: r.sys, badge: "Resume", file: r.file, resolve });
      return el("a", { className: "tile wide",
        href: `#/resume/${r.sys}/${r.file.split("/").map(encodeURIComponent).join("/")}` }, art,
        el("div", { className: "tile-cap" },
          el("div", { className: "t", textContent: r.name }),
          el("div", { className: "s", textContent: sysName(r.sys) })));
    }),
  }));

  const liveAnchor = el("div");
  frag.append(liveAnchor);

  frag.append(shelf({
    title: "Play now", count: playable.length, moreHref: "#/play",
    note: "Consoles that run right here in the browser.",
    tiles: playable.slice(0, 24).map((s) => consoleTile(s, { play: true })),
  }));

  const trendAnchor = el("div");
  frag.append(trendAnchor);

  const mpAnchor = el("div");
  frag.append(mpAnchor);

  const moviesAnchor = el("div");
  frag.append(moviesAnchor);
  const musicAnchor = el("div");
  frag.append(musicAnchor);

  frag.append(el("section", { className: "shelf" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "The rest of the floor" })),
    el("div", { className: "wrap", style: "padding-bottom:28px" },
      el("div", { className: "cab-dock" },
        ...[
          ["#/lounge", "🎬", "Lounge", "Movies, music, videos"],
          ["#/library", "🗂", "Library", "Every console & collection"],
          ["#/favorites", "♥", "Favorites", "Starred games"],
          ["#/saves", "☁", "Saves", "Cloud states"],
          ["#/netplay", "🌐", "Netplay", "Play with a friend"],
          ["#/profile", "👤", "You", signedIn() ? AUTH.user.display : "Sign in"],
        ].map(([href, k, t, s]) => el("a", { className: "cab-plaque", href },
          el("span", { className: "cab-k", textContent: k }),
          el("span", { className: "cab-t", textContent: t }),
          el("span", { className: "cab-s", textContent: s })))))));

  view.replaceChildren(frag);

  fetch(`${API}/play/stats`).then((r) => r.json()).then((ps) => {
    if (token !== state.render) return;
    const live = (ps && ps.nowPlaying) || [];
    if (!live.length) return;
    liveAnchor.replaceWith(el("section", { className: "shelf" },
      el("div", { className: "shelf-head" },
        el("h2", { textContent: "On the floor" }),
        el("span", { className: "count", textContent: `${live.length} playing` })),
      el("p", { className: "shelf-note hint", textContent: "People on the tailnet right now — join their room or start the same game." }),
      el("div", { className: "wrap", style: "padding-bottom:8px" },
        el("div", { className: "live-row" }, ...live.map((x) => {
          const playHref = x.sys && x.file
            ? `#/play/${x.sys}/${x.file.split("/").map(encodeURIComponent).join("/")}` : "#/play";
          return el("div", { className: "live-card" },
            el("div", { className: "live-who" }, el("span", { className: "live-dot" }), x.who),
            el("div", { className: "live-game", textContent: x.game }),
            el("div", { className: "live-sys", textContent: x.sys ? sysName(x.sys) : ""}),
            el("div", { className: "live-acts" },
              el("a", { className: "btn btn-primary sm", href: playHref,
                onclick: x.netplay && x.room
                  ? () => { LS.set("joinNp", { sys: x.sys, file: x.file, room: x.room, t: Date.now() }); }
                  : null,
                textContent: x.netplay ? "Join room" : "Play too" }),
              x.watch && el("a", { className: "btn btn-ghost sm", href: `#/watch/${x.watch}`, textContent: "Watch" })));
        })))));
  }).catch(() => {});

  Promise.all([
    fetch(`${API}/play/stats`).then((r) => r.json()).catch(() => null),
    getJSON("trending"),
  ]).then(([ps, trendSnap]) => {
    if (token !== state.render) return;
    let trend = ps && (ps.trending && ps.trending.length ? ps.trending : ps.top) || [];
    if (trend.length < 4 && trendSnap && trendSnap.length) {
      trend = trendSnap.map(([name, sys, gid, img, count]) => ({ name, sys, gid, img, count, snap: true }));
    }
    if (trend.length < 4) { trendAnchor.remove(); return; }
    trendAnchor.replaceWith(shelf({ title: "Trending", count: trend.length,
      note: "What's getting played on the server right now.",
      tiles: trend.map((p) => {
        const gm = !p.snap && (state.cache[p.sys] || []).find((x) => x.file === p.file);
        const art = coverArt({ img: p.img || (gm && gm.img), name: p.name, sys: p.sys, badge: "Play",
          file: p.file, gid: p.gid, resolve });
        const href = p.snap ? `#/g/${p.sys}/${p.gid}`
          : `#/play/${p.sys}/${p.file.split("/").map(encodeURIComponent).join("/")}`;
        return el("a", { className: "tile wide", href }, art,
          el("div", { className: "tile-cap" },
            el("div", { className: "t", textContent: p.name }),
            el("div", { className: "s", textContent: `${sysName(p.sys)} · ${p.count} play${p.count === 1 ? "" : "s"}` })));
      }) }));
    hydrateCovers(resolve, { save: backfillRecent });
  });

  const mpSys = [...new Set(MULTIPLAYER_PICKS.map((p) => p.sys))];
  Promise.all(mpSys.map((id) => getSystem(id).catch(() => []))).then(() => {
    if (token !== state.render) return;
    const tiles = [];
    for (const p of MULTIPLAYER_PICKS) {
      const g = (state.cache[p.sys] || []).find((x) => x.file === p.file);
      if (!g) continue;
      const art = coverArt({ img: g.img, name: g.name, sys: p.sys, badge: p.tag, file: g.file, resolve });
      tiles.push(el("a", { className: "tile wide",
        href: `#/play/${p.sys}/${g.file.split("/").map(encodeURIComponent).join("/")}` }, art,
        el("div", { className: "tile-cap" },
          el("div", { className: "t", textContent: g.name }),
          el("div", { className: "s", textContent: `${sysName(p.sys)} · ${p.tag}` }))));
    }
    if (!tiles.length) { mpAnchor.remove(); return; }
    mpAnchor.replaceWith(shelf({ title: "Two-player night", count: tiles.length, moreHref: "#/netplay", tiles,
      note: "Couch and netplay picks for two." }));
    hydrateCovers(resolve, { save: backfillRecent });
  });

  homeMoviesShelf().then((s) => { if (!s || token !== state.render) { moviesAnchor.remove(); return; } moviesAnchor.replaceWith(s); });
  homeMusicShelf().then((s) => { if (!s || token !== state.render) { musicAnchor.remove(); return; } musicAnchor.replaceWith(s); });
}

// Home shelves: a movie wall (Jellyfin posters) and the album wall.
async function homeMoviesShelf() {
  try {
    const r = await fetch(`${JF}Items?IncludeItemTypes=Movie&Recursive=true&SortBy=Random&Limit=18&Fields=ProductionYear,OfficialRating&EnableImageTypes=Primary`);
    if (!r.ok) return null;
    const d = await r.json();
    const items = d.Items || [];
    if (!items.length) return null;
    return shelf({ title: "Movies", count: d.TotalRecordCount || items.length, moreHref: "#/movies",
      note: "From the Jellyfin library on the home server.",
      tiles: items.slice(0, 18).map((it) => movieCard(it)) });
  } catch { return null; }
}
async function homeMusicShelf() {
  try {
    const d = await mpData();
    if (!d || !d.albums || !d.albums.length) return null;
    const albums = d.albums.map((a, i) => [a, i]).filter(([a]) => a.art).slice(0, 18);
    if (!albums.length) return null;
    return shelf({ title: "Music", count: d.albums.length, moreHref: "#/music",
      note: "The album wall — plays while you browse.",
      tiles: albums.map(([a, i]) => {
        const m = parseAlbum(a.name);
        return el("a", { className: "tile wide", href: `#/music/${i}` },
          el("div", { className: "tile-art" }, el("img", { src: musicArtUrl(a.name), loading: "lazy", alt: m.album })),
          el("div", { className: "tile-cap" },
            el("div", { className: "t", textContent: m.album }),
            el("div", { className: "s", textContent: m.artist })));
      }) });
  } catch { return null; }
}

async function routeLounge() {
  ++state.render;
  document.title = "Lounge — RetroVerse";
  view.replaceChildren(el("div", { className: "wrap", style: "padding-top:28px" },
    el("h1", { textContent: "Lounge" }),
    el("p", { className: "hint", style: "margin:0 0 18px", textContent: "Step off the cabinets. Movies on Jellyfin, the album wall, and the YouTube uploads." }),
    el("div", { className: "lounge-grid" },
      el("a", { className: "lounge-card", href: "#/movies", dataset: { k: "movies" } },
        el("div", { className: "lg-k", textContent: "🎬" }),
        el("div", { className: "lg-t", textContent: "Movies" }),
        el("div", { className: "lg-s", textContent: "The Jellyfin library — popcorn, couch, dim the scanlines." })),
      el("a", { className: "lounge-card", href: "#/music", dataset: { k: "music" } },
        el("div", { className: "lg-k", textContent: "🎧" }),
        el("div", { className: "lg-t", textContent: "Music" }),
        el("div", { className: "lg-s", textContent: "Albums on the home server. Plays in the background while you browse." })),
      el("a", { className: "lounge-card", href: "#/videos", dataset: { k: "videos" } },
        el("div", { className: "lg-k", textContent: "▶" }),
        el("div", { className: "lg-t", textContent: "Videos" }),
        el("div", { className: "lg-s", textContent: "Latest uploads from the YouTube channel." }))),
    el("section", { className: "shelf", style: "padding-top:26px" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: "Lounge chat" })),
      el("p", { className: "shelf-note hint", textContent: "Everyone on the tailnet sees this. (The same feed is meant to power a floating party chat — see FEATURE-BACKLOG.)" }),
      loungeChat())));
}

// Shared lounge chat. Polls GET /chat; POST /chat to send. The same widget is
// used by the Lounge page and the optional floating party-chat window.
function chatWidget() {
  const list = el("div", { className: "chat-log" });
  const input = el("input", { type: "text", placeholder: "Say something…", maxLength: 500, className: "chat-input" });
  const send = el("button", { className: "btn btn-primary sm", textContent: "Send" });
  const who = () => AUTH.user?.display || prefs().netplayName || "Guest";
  let after = 0, timer = 0, alive = true;
  const push = (m) => {
    list.append(el("div", { className: "chat-msg" },
      el("span", { className: "chat-who", textContent: m.who || "Guest" }),
      el("span", { className: "chat-text", textContent: m.text })));
    list.scrollTop = list.scrollHeight;
  };
  const poll = async () => {
    if (!alive) return;
    try {
      const d = await fetch(`${API}/chat?after=${after}`, { cache: "no-store" }).then((r) => r.json());
      for (const m of (d.msgs || [])) { after = Math.max(after, m.at); push(m); }
    } catch { /* offline */ }
    timer = setTimeout(poll, 2000);
  };
  const doSend = async () => {
    const text = input.value.trim(); if (!text) return;
    input.value = "";
    try {
      await fetch(`${API}/chat`, { method: "POST", headers: { "content-type": "application/json", ...authHdr() },
        body: JSON.stringify({ text, who: who() }) });
    } catch { /* */ }
    poll();
  };
  send.onclick = doSend;
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); doSend(); } };
  const box = el("div", { className: "chat-box" }, list, el("div", { className: "chat-row" }, input, send));
  const obs = new MutationObserver(() => { if (!box.isConnected) { alive = false; clearTimeout(timer); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });
  poll();
  return box;
}
const loungeChat = () => chatWidget();

let partyChatPanel = null;
function closePartyChat() {
  partyChatPanel?.remove(); partyChatPanel = null;
  const fab = $("#party-chat-fab");
  if (fab) fab.setAttribute("aria-expanded", "false");
}
function openPartyChat() {
  if (partyChatPanel?.isConnected) { closePartyChat(); return; }
  const close = el("button", { type: "button", className: "party-chat-close", textContent: "×", ariaLabel: "Close party chat", title: "Close" });
  close.onclick = closePartyChat;
  partyChatPanel = el("section", { className: "party-chat", role: "dialog", ariaLabel: "Party chat" },
    el("div", { className: "party-chat-head" }, el("strong", { textContent: "Party chat" }), close),
    chatWidget());
  document.body.append(partyChatPanel);
  $("#party-chat-fab")?.setAttribute("aria-expanded", "true");
  partyChatPanel.querySelector("input")?.focus();
}

async function routeLibrary() {
  ++state.render;
  spinner();
  await getSystems().catch(() => {});
  document.title = "Library — RetroVerse";
  const q = el("input", { type: "search", placeholder: "Filter consoles…" });
  const playOnly = el("label", { className: "chk" }, el("input", { type: "checkbox" }), " playable only");
  const grid = el("div", { className: "tile-grid" });
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const po = playOnly.querySelector("input").checked;
    grid.replaceChildren(...state.sys.systems
      .filter((s) => (!t || s.name.toLowerCase().includes(t) || s.id.includes(t)) && (!po || s.playable))
      .map((s) => consoleTile(s)));
  };
  q.oninput = debounce(draw, 120);
  playOnly.querySelector("input").onchange = draw;
  view.replaceChildren(el("div", { className: "wrap", style: "padding-top:22px" },
    el("div", { className: "shelf-head", style: "padding:0 0 12px" },
      el("h1", { textContent: "Library" }),
      el("span", { className: "count", textContent: `${state.sys.systems.length} systems` })),
    el("p", { className: "hint", style: "margin:0 0 14px" },
      el("a", { href: "#/collections", textContent: "Collections" }), " · ",
      el("a", { href: "#/franchises", textContent: "Franchises" }), " · ",
      el("a", { href: "#/browse", textContent: "Just the consoles" })),
    el("div", { className: "grid-tools", style: "padding:0" }, q),
    grid));
  draw();
}

async function routeWatch(id) {
  ++state.render;
  document.title = "Watch party — RetroVerse";
  const vid = el("video", { autoplay: true, playsInline: true, muted: true,
    style: "width:100%;max-height:72vh;background:#000;border-radius:12px;display:none" });
  vid.setAttribute("playsinline", "");
  const img = el("img", { alt: "Live play" });
  const meta = el("div", { className: "watch-meta" },
    el("span", { className: "live-dot" }),
    el("strong", { id: "watch-title", textContent: "Connecting…" }),
    el("span", { className: "hint", id: "watch-host" }));
  const playLink = el("a", { className: "btn btn-primary sm", hidden: true, textContent: "Play this too" });
  view.replaceChildren(el("div", { className: "watch-stage" },
    el("h1", { textContent: "Watch party" }),
    meta, playLink, vid, img,
    el("p", { className: "hint", textContent: "Live stream from the host — smooth video with sound (falls back to still frames if the stream can't connect)." })));
  wnpStop();
  let dead = 0;
  const token = state.render;
  const poll = async () => {
    if (token !== state.render) { wnpStop(); return; }
    try {
      const info = await fetch(`${API}/watch/${id}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : null);
      if (!info) { dead++; if (dead > 8) { $("#watch-title").textContent = "This party ended."; return; } }
      else {
        dead = 0;
        $("#watch-title").textContent = info.name || "Live";
        $("#watch-host").textContent = info.host ? `hosted by ${info.host}` : "";
        if (info.sys && info.file) {
          playLink.hidden = false;
          playLink.href = `#/play/${info.sys}/${info.file.split("/").map(encodeURIComponent).join("/")}`;
        }
        // Prefer the WebRTC stream; keep the JPEG frame as a fallback poster.
        if (info.room && !WNP.alive) {
          wnpStartWatch(info.room, (stream) => {
            vid.srcObject = stream;
            vid.style.display = "block";
            img.style.display = "none";
            vid.play?.().then(() => { vid.muted = false; }).catch(() => { /* tap to unmute */ });
          });
        }
        if (!info.room || !WNP.alive || vid.style.display === "none") img.src = `${API}/watch/${id}/frame?t=${Date.now()}`;
      }
    } catch { dead++; }
    if (token === state.render) setTimeout(poll, 180);
  };
  poll();
}

async function routeBrowse() {
  ++state.render;
  await getSystems().catch(() => {});
  const q = el("input", { type: "search", placeholder: "Filter consoles…" });
  const playOnly = el("label", { className: "chk" }, el("input", { type: "checkbox" }), " playable only");
  const grid = el("div", { className: "tile-grid" });
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const po = playOnly.querySelector("input").checked;
    grid.replaceChildren(...state.sys.systems
      .filter((s) => (!t || s.name.toLowerCase().includes(t) || s.id.includes(t)) && (!po || s.playable))
      .map((s) => consoleTile(s)));
  };
  q.oninput = debounce(draw, 120);
  playOnly.querySelector("input").onchange = draw;
  view.replaceChildren(el("div", { className: "wrap" },
    el("section", { className: "shelf", style: "padding:24px 0 0" },
      el("div", { className: "shelf-head" }, el("h2", { textContent: "All consoles" }),
        el("span", { className: "count", textContent: `${state.sys.systems.length}` })),
      el("div", { className: "grid-tools", style: "padding:0" }, q, playOnly),
      grid)));
  draw();
}

async function routeSystem(id) {
  const token = ++state.render;
  spinner();
  await getSystems().catch(() => {});
  const games = await getSystem(id).catch(() => []);
  if (token !== state.render) return;
  const m = meta(id);
  document.title = `${m.name} — RetroVerse`;
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
  await getSystems().catch(() => {});
  const games = await getSystem(sysId).catch(() => []);
  const g = games.find((x) => x.id === gid);
  if (token !== state.render) return;
  if (!g) { location.hash = `#/s/${sysId}`; return; }
  const m = meta(sysId);

  const actions = [];
  if (m.playable) actions.push({ label: "▶ Play", primary: true,
    href: `#/play/${sysId}/${g.file.split("/").map(encodeURIComponent).join("/")}` });
  actions.push({ label: `All ${m.name}`, href: `#/s/${sysId}` });
  const tips = notesFor(sysId, g.file, g.name);
  const desc = [g.desc || "No description scraped for this title.", tips.length ? "Note: " + tips.join(" ") : ""]
    .filter(Boolean).join(" ");

  view.replaceChildren(hero({
    kicker: [m.name, g.year].filter(Boolean).join(" · "),
    title: g.name,
    desc,
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
    el("div", {}, el("strong", { textContent: "Load a ROM file" })));
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
  await getSystems().catch(() => {});
  if (token !== state.render) return;
  const playable = state.sys.systems.filter((s) => s.playable).sort((a, b) => b.count - a.count);
  const total = playable.reduce((n, s) => n + s.count, 0);
  const bySys = await romCacheBySys().catch(() => ({}));

  const frag = document.createDocumentFragment();
  frag.append(hero({
    mod: "hero-top",
    title: "Play in your browser",
    desc: `${total.toLocaleString()} games across ${playable.length} systems, emulated right here. Pick a console below, or drop in a ROM from your device.`,
    art: await spotlightArt(24),
    actions: [
      { label: "Pick a ROM file", primary: true, onClick: () => $("#rom-input")?.click() },
      { label: "Browse all games", href: "#/browse" },
      { label: "Netplay", href: "#/netplay" },
    ],
  }));
  frag.append(el("div", { className: "wrap", style: "padding-bottom:6px" }, dropzone()));
  frag.append(el("div", { className: "shelf" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Playable consoles" }),
      el("span", { className: "count", textContent: `${playable.length}` })),
    el("div", { className: "tile-grid", style: "padding:0" },
      ...playable.map((s) => consoleTile(s, { play: true, offline: bySys[s.id] || 0 })))));
  view.replaceChildren(frag);
}

async function routeNetplay() {
  ++state.render;
  document.title = "Netplay — RetroVerse";
  const np = netplayUrl();
  const status = el("p", { className: "hint", textContent: np ? "Checking the netplay server…" : "Netplay is turned off in Settings." });
  const steps = el("ol", { className: "np-steps" },
    el("li", { textContent: "You and a friend both open the same game on the tailnet." }),
    el("li", { textContent: "Click Netplay in the top bar (or the globe in the emulator menu)." }),
    el("li", { textContent: "One person creates a room; the other hits Join. Same ROM, same core — that's it." }));
  view.replaceChildren(el("section", { className: "pane", style: "max-width:720px;margin:0 auto;padding:28px var(--pad) 60px" },
    el("div", { className: "big-emoji", textContent: "🌐" }),
    el("h1", { textContent: "Play with a friend" }),
    el("p", { textContent: "Netplay is peer-to-peer on the tailnet. Host taps Netplay (Player 1), then Invite. Guest taps Join room and is Player 2. No savestate freeze on every input." }),
    status, steps,
    el("p", { className: "hint", textContent: "Works great for NES, SNES, Genesis, GB/GBA, and most 2D systems. Heavier cores (N64, PSX, NDS) are laggy unless you're on a fast local link." }),
    el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin-top:18px" },
      el("a", { className: "btn btn-primary", href: "#/play", textContent: "Pick a game" }),
      el("a", { className: "btn btn-ghost", href: "#/profile", textContent: "Netplay name & settings" }))));
  if (!np) return;
  try {
    const r = await fetch(`${API}/np/health`, { cache: "no-store" });
    if (!r.ok) throw 0;
    status.textContent = "Netplay server is up. Open a game and hit Netplay.";
    status.style.color = "var(--cyan)";
  } catch {
    status.textContent = "Couldn't reach the netplay server. You need to be on the tailnet, and arcade-netplay has to be running on shadow.";
    status.style.color = "var(--pink)";
  }
}

async function routePlaySystem(id) {
  const token = ++state.render;
  spinner();
  await getSystems().catch(() => {});
  const m = meta(id);
  if (!m.playable) { location.hash = `#/s/${id}`; return; }
  const games = await getSystem(id).catch(() => []);
  if (token !== state.render) return;

  const CART_SYS = new Set(["nes", "fds", "snes", "satellaview", "gb", "gbc", "gba", "genesis",
    "megadrive", "megadrivejp", "mastersystem", "sg-1000", "gamegear", "pcengine", "supergrafx",
    "atari2600", "atari5200", "atari7800", "atarilynx", "wonderswan", "wonderswancolor",
    "ngp", "ngpc", "virtualboy", "colecovision", "sega32x"]);
  const canOffline = CART_SYS.has(id) && games.length <= 600 && !meta(id).bios;
  const cachedN = (await romCacheBySys().catch(() => ({})))[id] || 0;

  const frag = document.createDocumentFragment();
  frag.append(hero({
    kicker: "Play", title: m.name,
    desc: `${games.length.toLocaleString()} games, ready to run. Streamed from the home server — pick one.`,
    art: sysArt(m),
    actions: [
      { label: "🎲 Random game", primary: true, onClick: () => surpriseMe(id) },
      canOffline ? { label: cachedN ? `✓ ${cachedN} saved offline` : "⬇ Save all for offline", onClick: () => offlineDownload(id, games) } : null,
      cachedN ? { label: "Manage offline", href: "#/cache" } : null,
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

  let previews = null;
  const apply = () => {
    const q = fText.value.trim().toLowerCase();
    tileGrid(box, games.filter((g) => !q || g.name.toLowerCase().includes(q)), PAGE, { play: true, previews });
  };
  fText.oninput = debounce(apply, 150);
  apply();
  if (SELF_HOSTED && (HOVER_OK || IN_APP)) gameVideoMap().then((m) => {
    if (Object.keys(m).some((k) => k.startsWith(id + "|"))) { previews = m; apply(); }
  });
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
// how many cached ROMs each console has, for the offline UI
async function romCacheBySys() {
  const e = await romCacheEntries().catch(() => []);
  const m = {};
  for (const x of e) { const s = String(x.key).split("/")[0]; m[s] = (m[s] || 0) + 1; }
  return m;
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
// pin a system's browse data so you can still navigate to it offline
async function warmOfflineData(sys) {
  if (!("caches" in window)) return;
  try {
    const c = await caches.open("ssw-data");
    for (const u of ["data/systems.json", `data/${sys}.json`, "data/collections.json", "data/franchises.json"]) {
      if (await c.match(u)) continue;
      const r = await fetch(u); if (r.ok) await c.put(u, r.clone());
    }
  } catch { /* */ }
}
// exposed for the native wrapper's offline UX
window.sswOfflineStats = async () => {
  const [rom, ejs] = await Promise.all([romCacheStats(), ejsCacheStats()]);
  return { rom, ejs, offlineReady: ejs.count > 2 };
};
// EJS_core value -> default libretro core (from EmulatorJS getCores(), stable channel)
const EJS_LIBRETRO = {
  nes: "fceumm", snes: "snes9x", gb: "gambatte", gba: "mgba", n64: "mupen64plus_next",
  nds: "melonds", segaMD: "genesis_plus_gx", segaMS: "smsplus", segaGG: "genesis_plus_gx",
  segaCD: "genesis_plus_gx", sega32x: "picodrive", pce: "mednafen_pce", pcfx: "mednafen_pcfx",
  atari2600: "stella2014", atari5200: "a5200", atari7800: "prosystem", lynx: "handy",
  jaguar: "virtualjaguar", ws: "mednafen_wswan", ngp: "mednafen_ngp", vb: "beetle_vb",
  coleco: "gearcoleco", c64: "vice_x64sc", vic20: "vice_xvic", plus4: "vice_xplus4",
  psx: "pcsx_rearmed", arcade: "fbneo", mame: "mame2003_plus", "3do": "opera", amiga: "puae",
};
// libretro core names for every playable system — for the app's "download all cores" list
window.sswCores = async () => {
  await getSystems().catch(() => {});
  const cores = new Set();
  for (const s of (state.sys?.systems || [])) {
    if (!s.playable || !s.core) continue;
    cores.add(EJS_LIBRETRO[s.core] || s.core);
  }
  return [...cores].sort();
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
  uiRoot().append(o);
  await warmOfflineData(sys);
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
  uiRoot().append(o);
}
const tokenHdr = () => { const t = LS.get("token", ""); return t ? { "x-ssw-token": t } : {}; };

async function routePlayGame(sys, romParam, resume = false) {
  ++state.render;
  if (window.__emuUp) { location.reload(); return; }
  window.__emuUp = true;
  document.documentElement.classList.add("playing");
  if (MP.ai && !MP.ai.paused) { MP.ai.pause(); toast("Music paused for the game"); }
  await getSystems().catch(() => {});

  const loadEl = el("div", { className: "player-load", id: "player-load" }, "Booting emulator…");
  const saveBtn = el("button", { className: "pbtn", id: "cloud-save", textContent: "☁ Save", title: "Save state (right-click / long-press to name a slot)", hidden: true });
  const saveAsBtn = el("button", { className: "pbtn", id: "cloud-save-as", textContent: "＋", title: "Save to a named slot", hidden: true });
  const loadBtn = el("button", { className: "pbtn", id: "cloud-load", textContent: "☁ Load", title: "Load a save slot", hidden: true });
  const ctrlBtn = el("button", { className: "pbtn", id: "ctrl-btn", textContent: "🎮", title: "Controller setup — see & remap buttons", hidden: true });
  const ffBtn = el("button", { className: "pbtn", id: "ff-btn", textContent: "⏩", title: "Fast-forward", hidden: true });
  const rwBtn = el("button", { className: "pbtn", id: "rw-btn", textContent: "⏪", title: "Hold to rewind", hidden: true });
  const watchBtn = el("button", { className: "pbtn", id: "watch-btn", textContent: "Watch", title: "Start a watch party — others on the tailnet can spectate", hidden: true });
  const noteBtn = el("button", { className: "note-chip", textContent: "Note", title: "Tips for this game", hidden: true });
  const npBtn = el("button", { className: "pbtn", id: "np-btn", textContent: "Netplay", title: "Host or join a netplay room for this game", hidden: true });
  const syncBtn = el("button", { className: "pbtn", id: "np-sync-btn", textContent: "Sync", title: "Force both players onto this screen (host only)", hidden: true });
  const invBtn = el("button", { className: "pbtn", id: "inv-btn", textContent: "Invite", title: "Invite someone who's online", hidden: true });
  const flagBtn = el("button", { className: "pbtn", id: "flag-btn", textContent: "⚑", title: "Report a problem with this game" });
  const padLayoutBtn = el("button", { className: "pbtn", id: "pad-layout-btn", textContent: "Pad", title: "Touch pad size, opacity and position", hidden: true });
  if (sys !== "upload") flagBtn.onclick = () => reportGame(sys, file, romName);
  else flagBtn.hidden = true;
  const shell = el("div", { className: "player" + (IN_APP ? " in-app-player" : "") },
    el("div", { className: "player-bar" },
      el("button", { type: "button", className: "exit", textContent: "‹ Exit", onclick: (e) => { e.preventDefault(); exitPlayer(); } }),
      el("div", { className: "title", id: "player-title", textContent: "Loading…" }),
      rwBtn, ffBtn,
      saveBtn, saveAsBtn, loadBtn,
      npBtn, syncBtn, invBtn, watchBtn,
      ctrlBtn, noteBtn, flagBtn, padLayoutBtn),
    el("div", { className: "player-stage" },
      el("div", { id: "game" }), loadEl));
  if (IN_APP) {
    const hideChrome = () => shell.classList.remove("show-chrome");
    let hideT;
    const showChrome = () => {
      shell.classList.add("show-chrome");
      clearTimeout(hideT);
      hideT = setTimeout(hideChrome, 5000);
    };
    window.__sswChromeToggle = () => {
      if (shell.classList.contains("show-chrome")) { clearTimeout(hideT); hideChrome(); }
      else showChrome();
    };
    shell.append(
      el("button", { type: "button", className: "fab-exit", textContent: "‹", title: "Exit game",
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); exitPlayer(); } }),
      el("button", { type: "button", className: "chrome-peek", title: "Show controls",
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); showChrome(); } }),
      el("button", { type: "button", className: "fab-pad", title: "Hide or show touch controls",
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); toggleTouchPad(); } }),
      el("button", { type: "button", className: "fab-ctrl", textContent: "🎮", title: "Controller setup",
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); controlsPanel(core); } }));
  }
  document.body.append(shell);
  view.replaceChildren();

  const file = sys === "upload" ? null : romParam;
  window.__playSys = sys; window.__playFile = file;
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
  const ejsBase = emuData();
  window.EJS_pathtodata = ejsBase;
  window.EJS_startOnLoaded = true;
  const bios = sys !== "upload" && meta(sys).bios;
  if (bios) window.EJS_biosUrl = ROM_BASE + "bios/" + encodeURIComponent(bios);
  window.EJS_Buttons = { restart: true, settings: true, fullscreen: true, saveState: true,
    loadState: true, screenshot: true, cheat: true, gamepad: true, netplay: false,
    exitEmulation: true };
  const vf = prefs().videoFilter;
  window.EJS_defaultOptions = Object.assign(
    { rewindEnabled: "enabled" },
    vf === "crt" ? { shader: "crt-aperture.glslp" }
      : vf === "smooth" ? { shader: "bicubic.glslp" } : {});
  window.EJS_color = "#1fe6ff";
  window.EJS_gameID = gameIdNum(sys, file || romName);
  // Our own WebRTC netplay — EmulatorJS 4.2.3 lockstep is broken ("control syncing").
  const np = netplayUrl();

  // cloud save-states — the stable EmulatorJS build has no onSaveState hook, so
  // we drive it ourselves via gameManager.getState()/loadState() + our own buttons.
  // named slots via ?s=<slot>; "auto" is the default / auto-save / resume slot.
  const key = sys === "upload" ? null : stateKey(sys, file);
  const slotUrl = (slot) => key + "?s=" + encodeURIComponent(slot || "auto") + (AUTH.token ? "&a=" + encodeURIComponent(AUTH.token) : "");
  const wantResume = resume || prefs().autoResume;
  let hasCloudSave = false;
  if (key && wantResume) {
    try { hasCloudSave = (await fetch(slotUrl("auto"), { method: "HEAD", headers: authHdr() })).ok; } catch { /* offline */ }
  }
  const putSlot = async (slot) => {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm || !key) return false;
    try {
      await fetch(slotUrl(slot), { method: "PUT", keepalive: true,
        headers: { "content-type": "application/octet-stream", ...tokenHdr(), ...authHdr() }, body: gm.getState() });
      hasCloudSave = true;
      const canvas = document.querySelector("#game canvas");
      if (canvas && canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) return;
          fetch(slotUrl(slot) + "&shot=1", { method: "PUT", keepalive: true,
            headers: { "content-type": "image/jpeg", ...tokenHdr(), ...authHdr() }, body: blob }).catch(() => {});
        }, "image/jpeg", 0.72);
      }
      return true;
    } catch { return false; }
  };
  const cloudSave = async () => {
    if (prefs().confirmOverwrite && hasCloudSave && !confirm("Overwrite your “auto” cloud save?")) return;
    toast(await putSlot("auto") ? "Saved to the server ☁" : "Cloud save failed");
  };
  const cloudSaveAs = async () => {
    const name = (prompt("Name this save slot (e.g. “before boss”):", "") || "").trim().replace(/[^a-z0-9_ -]/gi, "").slice(0, 24);
    if (!name || name === "auto") return;
    toast(await putSlot(name) ? `Saved to “${name}” ☁` : "Cloud save failed");
  };
  const cloudLoad = async (slot) => {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm) return;
    if (slot === undefined) return slotPicker();
    try {
      const buf = await fetch(slotUrl(slot), { headers: authHdr() }).then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); });
      gm.loadState(new Uint8Array(buf));
      toast(slot === "auto" ? "Server save loaded" : `Loaded “${slot}”`);
    } catch { toast("Couldn't load that save"); }
  };
  const slotPicker = async () => {
    let slots = [];
    try {
      const list = await fetch(STATE_BASE + "list", { headers: authHdr() }).then((r) => r.json());
      slots = (list.find((x) => x.sys === sys && x.file === file) || {}).slots || [];
    } catch { /* */ }
    const o = el("div", { id: "help-overlay", onclick: (e) => { if (e.target.id === "help-overlay") o.remove(); } },
      el("div", { className: "help-card" }, el("h3", { textContent: "Load a save" }),
        slots.length ? el("div", {}, ...slots.map((s) => el("div", { className: "slot-row" },
          s.shot ? el("img", { className: "slot-shot", alt: "", src: slotUrl(s.slot) + "&shot=1" }) : el("div", { className: "slot-shot" }),
          el("button", { className: "btn btn-ghost", style: "flex:1;text-align:left",
            textContent: `${s.slot === "auto" ? "Auto-save" : s.slot} · ${new Date(s.mtime).toLocaleString()}`,
            onclick: () => { o.remove(); cloudLoad(s.slot); } }),
          el("button", { className: "btn btn-ghost", textContent: "✕", title: "Delete",
            onclick: async () => { await fetch(slotUrl(s.slot), { method: "DELETE", headers: { ...tokenHdr(), ...authHdr() } }); o.remove(); toast("Slot deleted"); } }))))
          : el("p", { className: "hint", textContent: "No saves for this game yet." }),
        el("button", { className: "btn btn-ghost", style: "margin-top:10px", textContent: "Cancel", onclick: () => o.remove() })));
    uiRoot().append(o);
  };

  // silent cloud auto-save (no toast) — on a timer and on exit, to "auto"
  const autoSave = () => putSlot("auto");
  window.__emuAutoSave = autoSave;

  // play-stats ping + local playtime accounting
  const ptKey = sys === "upload" ? null : `${sys}/${file}`;
  let ptStart = 0;
  const ping = (start) => fetch(`${API}/play/ping`, {
    method: "POST", headers: { "content-type": "application/json", ...authHdr() },
    body: JSON.stringify({
      sys, file, name: romName, start, cid: CID,
      who: AUTH.user?.display || prefs().netplayName || null,
      watch: window.__watchId || null,
      netplay: !!window.__inNetplay,
      room: window.__npRoom || null,
    }),
  }).then((r) => r.json()).then(handlePingReply).catch(() => {});
  const flushPlaytime = () => {
    if (!ptKey || !ptStart) return;
    const secs = Math.round((Date.now() - ptStart) / 1000);
    ptStart = Date.now();
    if (secs > 0 && secs < 7200) {
      const pt = LS.get("playtime", {}); pt[ptKey] = (pt[ptKey] || 0) + secs; LS.set("playtime", pt);
    }
  };

  window.EJS_ready = () => {
    const emu = window.EJS_emulator;
    if (!emu) return;
    emu.on("exit", () => { if (window.__emuUp) exitPlayer(); });
  };
  window.EJS_onGameStart = () => {
    $("#player-load")?.remove();
    ptStart = Date.now();
    ping(true);
    if (NP.role) npHookInput();   // re-wire input for a guest that joined mid-boot
    // Gameplay always starts landscape. The app owns rotation; the browser
    // requests fullscreen/orientation where supported. There is deliberately
    // no duplicate Portrait control in the top player menu.
    setLandscape(true);
    applyPadPreset(sys);
    padLayoutBtn.hidden = false;
    padLayoutBtn.onclick = () => padLayoutPanel(sys);
    rememberSession({ sys, file, name: romName });
    window.__npSnapT = setInterval(() => snapshotNetplay(sys, file, romName), 4000);
    try { window.SSPlay && window.SSPlay.postMessage("1"); } catch { /* */ }
    const joinHint = LS.get("joinNp", null);
    if (joinHint && joinHint.sys === sys && (!joinHint.file || joinHint.file === file)) {
      LS.set("joinNp", null);
      setTimeout(() => autoJoinNetplay(joinHint.room), 1400);
    } else {
      // We were hosting this game before a reload/background — re-host the same
      // room (server `reuse`) so P2 can reconnect instead of us becoming P2.
      const hostHint = LS.get("hostNp", null);
      if (hostHint && hostHint.room && hostHint.sys === sys
          && (!hostHint.file || hostHint.file === file)
          && Date.now() - (hostHint.t || 0) < 15 * 60 * 1000) {
        setTimeout(async () => {
          if (NP.role || window.__inNetplay) return;
          try { await npHost({ sys, file, name: romName, reuse: hostHint.room }); toast("Re-hosting — P2 can reconnect"); }
          catch { /* */ }
        }, 1600);
      }
    }
    window.__emuHeartbeat = setInterval(() => { ping(false); flushPlaytime(); }, 15000);
    window.__emuAutoSaveT = key ? setInterval(autoSave, 180000) : 0;
    ctrlBtn.hidden = false;
    ctrlBtn.onclick = () => controlsPanel(core);
    ffBtn.hidden = false;
    ffBtn.onclick = () => {
      const emu = window.EJS_emulator;
      if (!emu?.gameManager?.toggleFastForward) return;
      emu.isFastForward = !emu.isFastForward;
      emu.gameManager.toggleFastForward(emu.isFastForward ? 1 : 0);
      ffBtn.classList.toggle("on", !!emu.isFastForward);
      ffBtn.title = emu.isFastForward ? "Fast-forward on" : "Fast-forward";
    };
    rwBtn.hidden = false;
    const rewind = (on) => {
      const gm = window.EJS_emulator?.gameManager;
      if (!gm) return;
      if (typeof gm.simulateInput === "function") gm.simulateInput(0, 28, on ? 1 : 0);
    };
    rwBtn.onpointerdown = (e) => { e.preventDefault(); rewind(true); };
    rwBtn.onpointerup = rwBtn.onpointerleave = () => rewind(false);
    watchBtn.hidden = false;
    watchBtn.onclick = async () => {
      if (window.__watchId) {
        try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/watch/${window.__watchId}`); } catch { /* */ }
        toast("Watch-party link copied again");
        return;
      }
      try {
        // Build the WebRTC watch room first; fall back to JPEG-only if capture fails.
        const room = await wnpStartHost().catch(() => null);
        const d = await fetch(`${API}/watch`, { method: "POST",
          headers: { "content-type": "application/json", ...authHdr() },
          body: JSON.stringify({ sys, file, name: romName, who: AUTH.user?.display || prefs().netplayName || "Host", room }),
        }).then((r) => r.json());
        window.__watchId = d.id;
        const link = `${location.origin}${location.pathname}#/watch/${d.id}`;
        try { await navigator.clipboard.writeText(link); } catch { /* */ }
        toast("Watch-party link copied — anyone on the tailnet can spectate");
        watchBtn.textContent = "Live";
        watchBtn.classList.add("on");
        ping(false);
        const grab = () => document.querySelector("#game canvas");
        window.__watchT = setInterval(() => {
          const c = grab();
          if (!c || !window.__watchId || !c.toBlob) return;
          c.toBlob((blob) => {
            if (!blob) return;
            fetch(`${API}/watch/${window.__watchId}/frame`, { method: "PUT", body: blob, keepalive: true }).catch(() => {});
          }, "image/jpeg", 0.55);
        }, 160);
      } catch { toast("Couldn't start a watch party"); }
    };
    const tips = notesFor(sys, file, romName);
    if (tips.length) {
      noteBtn.hidden = false;
      noteBtn.onclick = () => {
        const o = el("div", { id: "help-overlay", onclick: (e) => { if (e.target.id === "help-overlay") o.remove(); } },
          el("div", { className: "help-card" },
            el("h3", { textContent: "Before you play" }),
            ...tips.map((t) => el("p", { textContent: t })),
            el("button", { className: "btn btn-ghost", textContent: "Got it", onclick: () => o.remove() })));
        uiRoot().append(o);
      };
    }
    window.__playSys = sys; window.__playFile = file;
    if (np && sys !== "upload") {
      npBtn.hidden = false;
      npBtn.onclick = () => openNetplaySheet(sys, file, romName);
      invBtn.hidden = false;
      invBtn.onclick = () => invitePicker({ sys, file, name: romName, watch: window.__watchId });
    }
    if (sys !== "upload") {
      invBtn.hidden = false;
      invBtn.onclick = () => invitePicker({ sys, file, name: romName, watch: window.__watchId });
    }
    if (key) {
      saveBtn.hidden = false;
      saveBtn.onclick = cloudSave;
      saveBtn.oncontextmenu = (e) => { e.preventDefault(); cloudSaveAs(); };
      saveAsBtn.hidden = false; saveAsBtn.onclick = cloudSaveAs;
      loadBtn.hidden = false; loadBtn.onclick = () => cloudLoad();
      // never auto-load a save once netplay is (or will be) on — that puts the
      // host in-game while the guest is still on the title screen.
      if (hasCloudSave && !LS.get("joinNp") && !window.__inNetplay) {
        setTimeout(() => { if (!window.__inNetplay) cloudLoad("auto"); }, 800);
      }
    }
    // stash this core's binary in the ssw-ejs cache so the native wrapper can
    // serve it offline (EmulatorJS loads it from a blob worker that bypasses the SW).
    // skipped when __ssEjsBase is set — the app's local server owns caching then.
    if (SELF_HOSTED && !window.__ssEjsBase && (IN_APP || LS.get("settings", {}).offlineCores)) setTimeout(async () => {
      const cn = window.EJS_emulator && window.EJS_emulator.coreName;
      if (!cn) return;
      try {
        const c = await caches.open("ssw-ejs");
        for (const v of ["-wasm.data", "-legacy-wasm.data"]) {
          const u = `/emulatorjs/cores/${cn}${v}`;
          if (!(await c.match(u))) { const r = await fetch(u); if (r.ok) c.put(u, r.clone()); }
        }
      } catch { /* */ }
    }, 4000);
    if (sys !== "upload") warmOfflineData(sys);   // so you can navigate to this console offline
  };
  window.__emuFlush = flushPlaytime;

  // Load EmulatorJS. If the self-hosted copy fails (server unreachable), fall
  // back to the public CDN; if that also fails, offer a retry instead of a
  // dead "CDN blocked?" label.
  const loadEjs = (base, isFallback) => {
    window.EJS_pathtodata = base;
    const s = el("script", { src: base + "loader.js" });
    s.onerror = () => {
      if (!isFallback) { npLog?.("ejs: local loader failed, trying CDN"); loadEjs("https://cdn.emulatorjs.org/stable/data/", true); return; }
      const l = $("#player-load");
      if (l) l.replaceChildren(
        el("div", { textContent: "Emulator failed to load — the server or CDN is unreachable." }),
        el("button", { className: "btn btn-primary", style: "margin-top:12px", textContent: "Retry",
          onclick: () => location.reload() }));
    };
    document.body.append(s);
  };
  loadEjs(ejsBase, false);
}
function emuCleanup() {
  document.documentElement.classList.remove("playing");
  clearInterval(window.__emuHeartbeat); clearInterval(window.__emuAutoSaveT);
  clearInterval(window.__watchT); clearInterval(window.__npSnapT);
  if (window.__watchId) fetch(`${API}/watch/${window.__watchId}`, { method: "DELETE", keepalive: true }).catch(() => {});
  try { wnpStop(); } catch { /* */ }
  window.__watchId = null; window.__inNetplay = false; window.__npRoom = null;
  try { npStop(); } catch { /* */ }
  try { window.SSPlay && window.SSPlay.postMessage("0"); } catch { /* */ }
  try { screen.orientation.unlock(); } catch { /* */ }
  try { window.__emuFlush?.(); } catch { /* */ }
}
let _exiting = false;
function _exitDest(hash) {
  return location.pathname + "?_=" + Date.now() + (hash || "#/play");
}
// Kill the player without touching the WASM core. getState()/pause() can freeze
// the JS thread (N64/PSX especially), which is why "Exiting…" used to stick.
function exitPlayer() {
  window.__emuUp = false;
  document.documentElement.classList.remove("playing");
  forgetSession();
  const btn = document.querySelector(".player-bar .exit");
  if (btn) { btn.textContent = "Exiting…"; btn.disabled = true; }
  try { emuCleanup(); } catch { /* */ }
  try { document.querySelector(".player")?.remove(); } catch { /* */ }
  if (_exiting) { location.replace(_exitDest("#/play")); return; }
  _exiting = true;
  location.replace(_exitDest("#/play"));
}
window.exitPlayer = exitPlayer;
window.addEventListener("beforeunload", () => { if (window.__emuUp) { emuCleanup(); navigator.sendBeacon?.(`${API}/play/ping`, JSON.stringify({ cid: CID, bye: true })); } });

const _seenInv = new Set();
function handlePingReply(d) {
  if (!d || !Array.isArray(d.invites)) return;
  for (const inv of d.invites) {
    if (!inv || !inv.id || _seenInv.has(inv.id)) continue;
    _seenInv.add(inv.id);
    showInvite(inv);
    break;
  }
}
function ackInvite(id) {
  fetch(`${API}/play/invite/ack`, { method: "POST", headers: { "content-type": "application/json", ...authHdr() },
    body: JSON.stringify({ id }) }).catch(() => {});
}
function showInvite(inv) {
  if (document.getElementById("invite-overlay")) return;
  const o = el("div", { id: "invite-overlay", className: "help-overlay", onclick: (e) => { if (e.target.id === "invite-overlay") { o.remove(); ackInvite(inv.id); } } },
    el("div", { className: "help-card" },
      el("h3", { textContent: "You're invited" }),
      el("p", { textContent: `${inv.fromName || "Someone"} wants you to play ${inv.name || "a game"}.` }),
      el("p", { className: "hint", textContent: inv.room ? "You'll join as Player 2." : "Host still needs to tap Netplay to create a room." }),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px" },
        el("button", { className: "btn btn-primary", textContent: "Join room",
          onclick: () => { o.remove(); ackInvite(inv.id); acceptInvite(inv); } }),
        inv.watch && el("button", { className: "btn btn-ghost", textContent: "Watch",
          onclick: () => { ackInvite(inv.id); o.remove(); location.hash = `#/watch/${inv.watch}`; } }),
        el("button", { className: "btn btn-ghost", textContent: "Not now",
          onclick: () => { ackInvite(inv.id); o.remove(); } }))));
  uiRoot().append(o);
}
async function invitePicker({ sys, file, name, watch }) {
  if (!NP.room) {
    try { await npHost({ sys, file, name }); toast("Room created — pick Player 2"); }
    catch { toast("Couldn't create a room"); return; }
  }
  const ps = await fetch(`${API}/play/stats`).then((r) => r.json()).catch(() => null);
  const people = ((ps && ps.online) || (ps && ps.nowPlaying) || [])
    .filter((x) => x.cid && x.cid !== CID);
  const o = el("div", { id: "help-overlay", onclick: (e) => { if (e.target.id === "help-overlay") o.remove(); } });
  const list = people.length
    ? people.map((p) => el("button", { className: "btn btn-ghost", style: "display:block;width:100%;margin:6px 0;text-align:left",
      textContent: p.game ? `${p.who} — playing ${p.game}` : `${p.who} — browsing`,
      onclick: async () => {
        o.remove();
        try {
          await fetch(`${API}/play/invite`, { method: "POST",
            headers: { "content-type": "application/json", ...authHdr() },
            body: JSON.stringify({ to: p.cid, toUser: p.uid || null, from: CID,
              fromName: AUTH.user?.display || prefs().netplayName || "Someone",
              sys, file, name, watch: watch || null, room: NP.room || window.__npRoom || null, np: true }) });
          toast(`Invited ${p.who}`);
        } catch { toast("Couldn't send the invite"); }
      } }))
    : [el("p", { className: "hint", textContent: "Nobody else is on the tailnet right now." })];
  o.append(el("div", { className: "help-card" },
    el("h3", { textContent: "Invite someone" }),
    el("p", { className: "hint", textContent: "Anyone online can jump into this game." }),
    ...list,
    el("button", { className: "btn btn-ghost", style: "display:block;width:100%;margin:6px 0", textContent: "🔗 Copy invite link",
      title: "Share a link that opens this game and auto-joins the room",
      onclick: () => copyInviteLink(sys, file, NP.room) }),
    el("button", { className: "btn btn-ghost", style: "margin-top:8px", textContent: "Cancel", onclick: () => o.remove() })));
  uiRoot().append(o);
}
function presenceTick() {
  if (!SELF_HOSTED && !API) return;
  if (window.__emuUp) return;
  fetch(`${API}/play/ping`, {
    method: "POST", headers: { "content-type": "application/json", ...authHdr() },
    body: JSON.stringify({ cid: CID, who: AUTH.user?.display || prefs().netplayName || null, idle: true }),
  }).then((r) => r.json()).then(handlePingReply).catch(() => {});
}
function invitePoll() {
  if (!SELF_HOSTED && !API) return;
  fetch(`${API}/play/invites?cid=${encodeURIComponent(CID)}`, { headers: authHdr(), cache: "no-store" })
    .then((r) => r.json()).then((d) => handlePingReply({ invites: d.invites || [] })).catch(() => {});
}
setInterval(presenceTick, 20000);
setInterval(invitePoll, 3000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { presenceTick(); invitePoll(); } });
addEventListener("load", () => { setTimeout(presenceTick, 400); setTimeout(invitePoll, 600); });

/* ---- controller setup panel -------------------------------------------------
   A visual, restylable alternative to EmulatorJS's stock Controls submenu.
   The pad diagram lights up live from the Gamepad API + held keyboard keys;
   click any button to rebind it (next key OR gamepad button is captured).
   Writes straight into EJS_emulator.controls and persists via its saveSettings. */
// gamepad standard button index -> EmulatorJS binding string
const EJS_STD_LABEL = { 0: "BUTTON_1", 1: "BUTTON_2", 2: "BUTTON_3", 3: "BUTTON_4",
  4: "LEFT_TOP_SHOULDER", 5: "RIGHT_TOP_SHOULDER", 6: "LEFT_BOTTOM_SHOULDER", 7: "RIGHT_BOTTOM_SHOULDER",
  8: "SELECT", 9: "START", 10: "LEFT_STICK", 11: "RIGHT_STICK",
  12: "DPAD_UP", 13: "DPAD_DOWN", 14: "DPAD_LEFT", 15: "DPAD_RIGHT" };
// gamepad standard button index -> diagram slot
const STD_SLOT = { 0: "fd", 1: "fr", 2: "fl", 3: "fu", 4: "lb", 5: "rb", 6: "lt", 7: "rt",
  8: "se", 9: "st", 10: "ls", 11: "rs", 12: "du", 13: "dd", 14: "dl", 15: "dr" };
// diagram slot -> EmulatorJS RetroPad button id
const SLOT_ID = { du: 4, dd: 5, dl: 6, dr: 7, fu: 9, fr: 8, fd: 0, fl: 1,
  lb: 10, rb: 11, lt: 12, rt: 13, ls: 14, rs: 15, se: 2, st: 3 };
// EJS_core -> face-button labels [bottom, right, left, top]
const FACE_LBL = {
  nes: ["B", "A"], fds: ["B", "A"], gb: ["B", "A"], gba: ["B", "A"], segaMS: ["1", "2"],
  segaGG: ["1", "2"], pce: ["II", "I"], pcfx: ["II", "I"], ngp: ["B", "A"], ws: ["B", "A"],
  vb: ["B", "A"], lynx: ["B", "A"], atari2600: ["Fire"], atari7800: ["1", "2"], coleco: ["L", "R"],
  snes: ["B", "A", "Y", "X"], nds: ["B", "A", "Y", "X"], n64: ["B", "A"],
  segaMD: ["A", "B", "X", "C"], segaCD: ["A", "B", "X", "C"], sega32x: ["A", "B", "X", "C"],
  psx: ["✕", "○", "□", "△"], "3do": ["A", "B", "C"], jaguar: ["A", "B", "C"], amiga: ["Fire", "2nd"],
};
const CORE_SHOULDERS = new Set(["snes", "nds", "gba", "n64", "psx", "3do", "jaguar", "segaMD", "segaCD", "sega32x", "amiga", "c64", "coleco"]);
const CORE_TRIGGERS = new Set(["nds", "psx", "3do", "n64"]);
const CORE_STICKS = new Set(["nds", "psx", "3do", "n64"]);
const padGlyph = (v) => ({ BUTTON_1: "A", BUTTON_2: "B", BUTTON_3: "X", BUTTON_4: "Y", SELECT: "Sel", START: "Start",
  LEFT_TOP_SHOULDER: "LB", RIGHT_TOP_SHOULDER: "RB", LEFT_BOTTOM_SHOULDER: "LT", RIGHT_BOTTOM_SHOULDER: "RT",
  LEFT_STICK: "L3", RIGHT_STICK: "R3", DPAD_UP: "▲", DPAD_DOWN: "▼", DPAD_LEFT: "◀", DPAD_RIGHT: "▶" }[v]
  || (v || "").replace(/_/g, " "));

function padSvg(lbl, showSet) {
  const on = (s) => showSet.has(s);
  const face = (slot, cx, cy) => on(slot)
    ? `<circle class="pad-btn" data-slot="${slot}" cx="${cx}" cy="${cy}" r="14"/>` +
      `<text class="pad-t" x="${cx}" y="${cy + 4}">${lbl[slot] || ""}</text>` : "";
  return `<svg viewBox="0 0 360 210" class="pad-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path class="pad-shell" d="M44 62 Q72 32 132 36 L228 36 Q288 32 316 62 Q344 100 328 142 Q312 184 270 178 Q246 174 234 150 L126 150 Q114 174 90 178 Q48 184 32 142 Q16 100 44 62 Z"/>
  ${on("lb") ? '<rect class="pad-btn" data-slot="lb" x="74" y="22" width="66" height="14" rx="7"/>' : ""}
  ${on("rb") ? '<rect class="pad-btn" data-slot="rb" x="220" y="22" width="66" height="14" rx="7"/>' : ""}
  ${on("lt") ? '<rect class="pad-btn" data-slot="lt" x="86" y="8" width="42" height="11" rx="5"/>' : ""}
  ${on("rt") ? '<rect class="pad-btn" data-slot="rt" x="232" y="8" width="42" height="11" rx="5"/>' : ""}
  <rect class="pad-btn" data-slot="du" x="86" y="70" width="20" height="22" rx="4"/>
  <rect class="pad-btn" data-slot="dd" x="86" y="112" width="20" height="22" rx="4"/>
  <rect class="pad-btn" data-slot="dl" x="64" y="92" width="22" height="20" rx="4"/>
  <rect class="pad-btn" data-slot="dr" x="106" y="92" width="22" height="20" rx="4"/>
  ${face("fu", 288, 74)}${face("fd", 288, 122)}${face("fl", 264, 98)}${face("fr", 312, 98)}
  ${on("ls") ? '<circle class="pad-btn pad-stk" data-slot="ls" cx="150" cy="122" r="17"/>' : ""}
  ${on("rs") ? '<circle class="pad-btn pad-stk" data-slot="rs" cx="210" cy="122" r="17"/>' : ""}
  <rect class="pad-btn" data-slot="se" x="140" y="66" width="24" height="10" rx="5"/>
  <rect class="pad-btn" data-slot="st" x="196" y="66" width="24" height="10" rx="5"/>
</svg>`;
}

function controlsPanel(core) {
  const emu = window.EJS_emulator;
  if (!emu || !emu.controls) { toast("Emulator still loading…"); return; }
  if ($("#ctrl-panel")) return;
  const wasPlaying = !emu.paused;
  try { emu.pause(true); } catch { /* */ }

  let player = 0, listening = null;
  let prevBtns = [], padIndex = null, rafId = 0;
  const active = {};                         // slot -> Set<source>
  const face = FACE_LBL[core] || ["B", "A", "Y", "X"];
  const lbl = { du: "Up", dd: "Down", dl: "Left", dr: "Right",
    fd: face[0] || "", fr: face[1] || "", fl: face[2] || "", fu: face[3] || "",
    lb: "L", rb: "R", lt: "L2", rt: "R2", ls: "L3", rs: "R3", se: "Select", st: "Start" };

  const rows = [{ g: "D-Pad", s: ["du", "dd", "dl", "dr"] },
    { g: "Buttons", s: ["fd", "fr", "fl", "fu"].filter((x) => lbl[x]) }];
  if (CORE_SHOULDERS.has(core)) {
    rows.push({ g: "Shoulders", s: CORE_TRIGGERS.has(core) ? ["lb", "rb", "lt", "rt"] : ["lb", "rb"] });
  }
  if (CORE_STICKS.has(core)) rows.push({ g: "Stick press", s: ["ls", "rs"] });
  rows.push({ g: "System", s: ["st", "se"] });
  const showSet = new Set(rows.flatMap((r) => r.s));

  const node = (slot) => svgWrap.querySelector(`[data-slot="${slot}"]`);
  const setSlot = (slot, isOn, src) => {
    const set = active[slot] || (active[slot] = new Set());
    isOn ? set.add(src) : set.delete(src);
    node(slot)?.classList.toggle("on", set.size > 0);
  };
  const tilt = (slot, x, y) => { const n = node(slot); if (n) n.style.transform = `translate(${(x * 7).toFixed(1)}px,${(y * 7).toFixed(1)}px)`; };
  const ctrls = () => emu.controls;
  const apply = () => { try { emu.setupKeys(); emu.checkGamepadInputs(); emu.saveSettings(); } catch { /* */ } render(); };
  const bind = (id, k, v) => { const c = ctrls()[player]; c[id] = Object.assign({}, c[id]); c[id][k] = v; listening = null; apply(); };
  const begin = (id, slot) => { listening = { id, label: lbl[slot] || slot }; render(); };
  const cancel = () => { listening = null; render(); };
  // EmulatorJS stores .value as a numeric keyCode — pretty-print it
  const KEY_SHORT = { "up arrow": "↑", "down arrow": "↓", "left arrow": "←", "right arrow": "→",
    space: "Space", enter: "Enter", backspace: "⌫", shift: "Shift", ctrl: "Ctrl", alt: "Alt", tab: "Tab", escape: "Esc" };
  const keyName = (v) => (emu.keyMap && emu.keyMap[v]) || (typeof v === "string" ? v : "");
  const kc = (v) => { const n = keyName(v); return KEY_SHORT[n] || (n ? n.toUpperCase() : "—"); };
  // physical gamepad button index -> diagram slot, via the RetroPad binding it drives
  const padSlot = (stdIndex) => {
    const label = EJS_STD_LABEL[stdIndex];
    if (!label) return null;
    const c = ctrls()[player] || {};
    for (const [slot, id] of Object.entries(SLOT_ID)) if (c[id] && c[id].value2 === label) return slot;
    return STD_SLOT[stdIndex] || null;
  };

  const onKey = (e, down) => {
    if (listening && down) {
      if (e.key === "Escape") return;
      e.preventDefault(); e.stopPropagation();
      bind(listening.id, "value", e.keyCode);
      return;
    }
    const c = ctrls()[player];
    if (!c) return;
    for (const [slot, id] of Object.entries(SLOT_ID)) if (c[id] && c[id].value === e.keyCode) setSlot(slot, down, "key");
  };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  const esc = (e) => { if (e.key === "Escape" && listening) { e.preventDefault(); e.stopPropagation(); cancel(); } };

  const poll = () => {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    const gp = (padIndex != null && pads[padIndex]) || pads.find(Boolean);
    if (gp) {
      padIndex = gp.index;
      gp.buttons.forEach((b, i) => { const s = padSlot(i); if (s) setSlot(s, b.pressed || b.value > 0.35, "pad"); });
      const ax = gp.axes || [];
      tilt("ls", ax[0] || 0, ax[1] || 0); tilt("rs", ax[2] || 0, ax[3] || 0);
      if (listening) {
        const i = gp.buttons.findIndex((b, j) => (b.pressed || b.value > 0.5) && !prevBtns[j]);
        if (i >= 0 && EJS_STD_LABEL[i]) bind(listening.id, "value2", EJS_STD_LABEL[i]);
      }
      prevBtns = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    }
    rafId = requestAnimationFrame(poll);
  };

  const close = () => {
    cancelAnimationFrame(rafId);
    removeEventListener("keydown", kd, true); removeEventListener("keyup", ku, true); removeEventListener("keydown", esc, true);
    panel.remove();
    if (wasPlaying) { try { emu.play(true); } catch { /* */ } }
  };

  const svgWrap = el("div", { className: "pad-svg-wrap" });
  const mapWrap = el("div", { className: "pad-map" });
  const hint = el("div", { className: "pad-hint" });
  const panel = el("div", { id: "ctrl-panel", onclick: (e) => { if (e.target.id === "ctrl-panel") close(); } });

  function render() {
    svgWrap.innerHTML = padSvg(lbl, showSet);
    svgWrap.querySelectorAll("[data-slot]").forEach((n) => {
      n.classList.add("clickable");
      n.onclick = () => begin(SLOT_ID[n.dataset.slot], n.dataset.slot);
    });
    mapWrap.replaceChildren(
      el("div", { className: "pad-players" }, ...[0, 1, 2, 3].map((p) =>
        el("button", { className: "pp" + (p === player ? " on" : ""), textContent: "P" + (p + 1),
          onclick: () => { player = p; render(); } }))),
      ...rows.map((r) => el("div", { className: "pad-grp" }, el("h4", { textContent: r.g }),
        ...r.s.map((slot) => {
          const id = SLOT_ID[slot], c = (ctrls()[player] && ctrls()[player][id]) || {};
          const isL = listening && listening.id === id;
          return el("div", { className: "pad-row" + (isL ? " listening" : "") },
            el("span", { className: "pr-name", textContent: lbl[slot] || slot }),
            el("button", { className: "pr-chip kbd" + (c.value ? "" : " empty"), title: "Keyboard — click, then press a key",
              textContent: isL ? "press…" : kc(c.value), onclick: () => begin(id, slot) }),
            el("button", { className: "pr-chip pad" + (c.value2 ? "" : " empty"), title: "Gamepad — click, then press a button",
              textContent: c.value2 ? padGlyph(c.value2) : "—", onclick: () => begin(id, slot) }));
        }))),
      el("div", { className: "pad-acts" },
        el("button", { className: "btn btn-ghost sm", textContent: "Reset to defaults",
          onclick: () => { try { emu.controls = JSON.parse(JSON.stringify(emu.defaultControllers)); } catch { /* */ } apply(); toast("Controls reset to defaults"); } }),
        el("button", { className: "btn btn-primary sm", textContent: "Done", onclick: close })));
    hint.textContent = listening
      ? `Press a key or controller button for “${listening.label}” — Esc to cancel`
      : "Press buttons on your controller to see them light up. Click any button to rebind it.";
    hint.classList.toggle("live", !!listening);
  }

  panel.append(el("div", { className: "ctrl-card" },
    el("div", { className: "cc-head" }, el("h3", { textContent: "Controller setup" }),
      el("button", { className: "cc-x", ariaLabel: "Close", textContent: "✕", onclick: close })),
    el("div", { className: "cc-body" }, svgWrap, mapWrap), hint));
  uiRoot().append(panel);
  addEventListener("keydown", kd, true); addEventListener("keyup", ku, true); addEventListener("keydown", esc, true);
  render();
  poll();
}

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
  uiRoot().append(o);
}

async function routeMovies() {
  const token = ++state.render;
  spinner();
  document.title = "Movies — RetroVerse";
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
      title: tr.title, album: meta.album, artist: meta.artist || "RetroVerse", artwork: art });
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
  document.title = `▶ ${tk.title} — RetroVerse`;
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
      artist: m.artist || "RetroVerse",
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
  document.title = "Music — RetroVerse";
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
  document.title = "Contact — RetroVerse";
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
    el("p", { textContent: "Follow RetroVerse everywhere, or jump into the Discord to chat, request games, or report anything broken." }),
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
function refTile(r, resolve) {
  const [name, sys, gid, img] = r;
  const art = coverArt({
    img, name, sys, gid, resolve,
    badge: meta(sys).playable ? "Play" : null,
    fav: { _sys: sys, id: gid, name, img: img || null },
  });
  return el("a", { className: "tile wide", href: `#/g/${sys}/${gid}` }, art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: name }),
      el("div", { className: "s", textContent: sysName(sys) })));
}
function refGrid(box, items, shown = PAGE) {
  const grid = el("div", { className: "tile-grid" });
  const resolve = [];
  const fill = (from, to) => {
    for (let i = from; i < to && i < items.length; i++) {
      const t = refTile(items[i], resolve);
      t.style.setProperty("--i", Math.min(i - from, 20));
      grid.append(t);
    }
  };
  fill(0, shown);
  const parts = [grid];
  if (items.length > shown) {
    const btn = el("button", { className: "more", onclick: () => {
      const was = grid.children.length;
      fill(was, was + PAGE);
      const left = items.length - grid.children.length;
      if (left <= 0) btn.remove();
      else btn.textContent = `Show more · ${left.toLocaleString()} left`;
      hydrateCovers(resolve);
    } });
    btn.textContent = `Show more · ${(items.length - shown).toLocaleString()} left`;
    parts.push(btn);
  }
  box.replaceChildren(...parts);
  hydrateCovers(resolve);
}

async function routeStatus() {
  ++state.render;
  document.title = "Status — RetroVerse";
  const body = el("div", { className: "set-list" });
  const row = (label, val, ok) => el("div", { className: "set-row" },
    el("div", {}, el("div", { textContent: label })),
    el("span", { style: ok === false ? "color:var(--pink);font-weight:700" : (ok ? "color:var(--cyan);font-weight:700" : ""), textContent: val }));
  const check = async (label, url, pick) => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      body.append(row(label, r.ok ? pick(d) : `HTTP ${r.status}`, r.ok));
    } catch { body.append(row(label, "unreachable", false)); }
  };
  view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "📡" }),
    el("h1", { textContent: "System status" }),
    el("p", { className: "hint", textContent: "Live checks against the home server." }),
    body));
  await check("Arcade server", `${API}/health`, (d) => `up ${Math.round(d.uptime || 0)}s`);
  await check("Netplay signalling", `${API}/np/health`, (d) => d.ok ? "ok" : "down");
  await check("ROM service", `${API}/roms/health`, () => "ok");
}
async function routeStats() {
  ++state.render; spinner();
  await getSystems().catch(() => {});
  document.title = "Stats — RetroVerse";
  const s = await fetch(`${API}/play/stats`).then((r) => r.json()).catch(() => null);
  if (!s) { view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "📊" }), el("h1", { textContent: "Stats" }),
    el("p", { textContent: "Can't reach the stats server — you may be off the tailnet." }))); return; }
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Library stats" }),
      s.playingNow ? el("span", { className: "count", textContent: `${s.playingNow} playing now` }) : null)));
  const statResolve = [];
  const gtile = (p, extra) => {
    const gm = (state.cache[p.sys] || []).find((x) => x.file === p.file);
    const art = coverArt({ img: gm && gm.img, name: p.name, sys: p.sys, file: p.file, resolve: statResolve,
      badge: meta(p.sys).playable ? "Play" : null });
    return el("a", { className: "tile wide",
      href: `#/play/${p.sys}/${p.file.split("/").map(encodeURIComponent).join("/")}` }, art,
      el("div", { className: "tile-cap" }, el("div", { className: "t", textContent: p.name }),
        el("div", { className: "s", textContent: `${sysName(p.sys)} · ${extra(p)}` })));
  };
  if (s.nowPlaying && s.nowPlaying.length) frag.append(el("div", { className: "wrap" },
    el("h3", { style: "margin:14px 0 8px", textContent: "Playing right now" }),
    el("div", { className: "np-list" }, ...s.nowPlaying.map((x) =>
      el("div", { className: "np-item" }, el("span", { className: "np-dot" }),
        el("strong", { textContent: x.who }), " — ", el("span", { textContent: x.game }))))));
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
  hydrateCovers(statResolve);
}

async function routeCollections() {
  ++state.render; spinner();
  await getSystems().catch(() => {});
  const cols = await getJSON("collections") || [];
  document.title = "Collections — RetroVerse";
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
  document.title = `${c.title} — RetroVerse`;
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
  document.title = "Franchises — RetroVerse";
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
  const art = coverArt({
    img: f.img, name: f.name, sys: f.sys, badge: play ? "Play" : null,
    fav: { _sys: f.sys, id: f.id, name: f.name, img: f.img, file: f.file, year: f.year, genre: f.genre },
  });
  const href = play
    ? `#/play/${f.sys}/${f.file.split("/").map(encodeURIComponent).join("/")}`
    : `#/g/${f.sys}/${f.id}`;
  return el("a", { className: "tile wide", href, ariaLabel: f.name }, art,
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

function cloudSaveTile(s, resolve) {
  const gm = (state.cache[s.sys] || []).find((x) => x.file === s.file);
  const shot = (s.slots || []).find((x) => x.shot);
  const shotUrl = shot ? (STATE_BASE + encodeURIComponent(s.sys) + "/" + s.file.split("/").map(encodeURIComponent).join("/")
    + "?s=" + encodeURIComponent(shot.slot) + "&shot=1" + (AUTH.token ? "&a=" + encodeURIComponent(AUTH.token) : "")) : null;
  const art = coverArt({ img: shotUrl || (gm && gm.img), name: s.name, sys: s.sys, file: s.file,
    resolve: shotUrl ? null : resolve, badge: s.shared ? "Shared" : "Resume" });
  return el("a", { className: "tile wide", href: `#/resume/${s.sys}/${s.file.split("/").map(encodeURIComponent).join("/")}` }, art,
    el("div", { className: "tile-cap" },
      el("div", { className: "t", textContent: s.name }),
      el("div", { className: "s", textContent: `${sysName(s.sys)} · ${(s.slots || []).length} slot${(s.slots || []).length === 1 ? "" : "s"} · ${new Date(s.mtime).toLocaleDateString()}` })));
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
    var saveResolve = [];
    saves.sort((a, b) => b.mtime - a.mtime).forEach((s) => grid.append(cloudSaveTile(s, saveResolve)));
  }
  frag.append(el("div", { className: "wrap" }, grid));
  view.replaceChildren(frag);
  if (typeof saveResolve !== "undefined") hydrateCovers(saveResolve);
}

async function routeCache() {
  ++state.render;
  document.title = "Offline & cache — RetroVerse";
  const [st, ejs, bySys] = await Promise.all([romCacheStats(), ejsCacheStats(), romCacheBySys().catch(() => ({}))]);
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

    section("Saved for offline", (() => {
      const rows = Object.entries(bySys).sort((a, b) => b[1] - a[1]).slice(0, 24)
        .map(([sid, n]) => el("a", { className: "set-row set-link", href: `#/play/${sid}` },
          el("div", {}, el("div", { textContent: sysName(sid) }),
            el("div", { className: "hint", textContent: `${n} game${n === 1 ? "" : "s"} cached` })),
          el("span", { className: "set-chev", textContent: "›" })));
      return rows.length ? el("div", { className: "set-list" }, ...rows)
        : el("p", { className: "hint", style: "margin:0", textContent: "Nothing yet — open a playable console and tap “Save all for offline”." });
    })()),

    section("Play offline", el("div", {},
      el("p", { className: "hint", style: "margin:0 0 6px" },
        IN_APP
          ? "In the app, each console's emulator is saved the first time you play a game on it. A saved emulator + a cached ROM (use “Save all for offline” on a console page) = plays with no connection."
          : "The site shell and your cached ROMs work offline, but a browser can't fully cache the emulator itself — the RetroVerse app can. Install it for true offline play."),
      el("p", { className: "hint", style: "margin:0 0 10px" },
        `${ejs.count} emulator file${ejs.count === 1 ? "" : "s"} saved · ${fmtBytes(ejs.bytes)}`),
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
      el("div", { className: "acct-head" },
        el("div", { className: "acct-av", textContent: u.avatar }),
        el("div", { className: "acct-id" }, nameIn,
          el("div", { className: "hint", textContent: `@${u.name} · joined ${new Date(u.created).toLocaleDateString()}` }))),
      el("div", { className: "acct-actions" },
        saveName,
        AUTH.isAdmin ? el("a", { className: "btn btn-ghost sm", href: "#/admin", textContent: "Admin" }) : null,
        el("button", { className: "btn btn-ghost sm", textContent: "Sign out",
          onclick: () => { signOut(); routeProfile(); } }))),
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
  const accentRow = el("div", { className: "set-row" },
    el("div", { className: "accent-picker" }, ...Object.entries(ACCENTS).map(([k, hex]) =>
      el("button", { className: "accent-dot" + ((p.accent || "cyan") === k ? " on" : ""),
        style: `background:${hex}`, title: k, onclick: () => { setPref("accent", k); routeProfile(); } }))),
    el("div", {}, el("div", { textContent: "Accent colour" })));
  return el("div", {},
    el("h3", { style: "margin:22px 0 10px", textContent: "Settings" }),
    el("div", { className: "set-list" },
      select("videoFilter", "Emulator video filter", [["pixel", "Pixel-perfect"], ["smooth", "Smooth"], ["crt", "CRT / scanlines"]]),
      select("region", "Prefer game region", [["", "No preference"], ["USA", "USA"], ["Europe", "Europe"], ["Japan", "Japan"]]),
      accentRow,
      toggle("autoResume", "Auto-resume cloud saves", "Load your last save automatically when you open a game"),
      toggle("netplay", "Netplay", "Show Host / Join on the player bar so you can play with someone on the tailnet"),
      (() => {
        const inp = el("input", { type: "text", maxLength: 20, placeholder: AUTH.user?.display || "Player",
          value: p.netplayName || "", style: "width:140px" });
        inp.onchange = () => setPref("netplayName", inp.value.trim().slice(0, 20));
        return el("label", { className: "set-row" }, inp,
          el("div", {}, el("div", { textContent: "Netplay name" }),
            el("div", { className: "hint", textContent: "Shown to the other player when you host or join a room" })));
      })(),
      toggle("musicShuffle", "Shuffle albums by default", "Start an album shuffled when you hit Play"),
      toggle("previewSound", "Game sound on home previews", "Play each showcase clip's own audio"),
      toggle("lite", "Lite mode", "Drop the scanlines, glow and animations"),
      toggle("playingToasts", "Show “people playing now” popups", ""),
      toggle("confirmOverwrite", "Confirm before overwriting a cloud save", ""),
      signedIn() ? toggle("publicProfile", "Public profile",
        "Let anyone see your avatar, name and most-played games at " + location.host + "/#/u/" + AUTH.user.name) : null,
      el("a", { className: "set-row set-link", href: "#/cache" },
        el("div", {}, el("div", { textContent: "Offline & cache" }),
          el("div", { className: "hint", textContent: "Install the app, manage the ROM & emulator cache" })),
        el("span", { className: "set-chev", textContent: "›" })),
      el("a", { className: "set-row set-link", href: "#/status" },
        el("div", {}, el("div", { textContent: "System status" }),
          el("div", { className: "hint", textContent: "Server, netplay and ROM service health" })),
        el("span", { className: "set-chev", textContent: "›" }))),
    signedIn()
      ? el("div", { className: "hint", style: "margin-top:8px", textContent: "Settings are saved to your account and sync across devices." })
      : el("div", { className: "hint", style: "margin-top:8px" }, "Settings are stored on this device. ",
        el("a", { href: "#/login", textContent: "Sign in" }), " to sync them."));
}

async function routePublicProfile(name) {
  ++state.render; spinner();
  await getSystems().catch(() => {});
  const d = await fetch(`${API}/u/${encodeURIComponent(name)}`).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (!d) { view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "🕶️" }), el("h1", { textContent: "No public profile" }),
    el("p", { textContent: `@${name} either doesn't exist or keeps their profile private.` }))); return; }
  document.title = `${d.display} — RetroVerse`;
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: d.display }))),
    el("div", { className: "wrap" }, el("div", { className: "acct-card" },
      el("div", { className: "acct-av", textContent: d.avatar }),
      el("div", { style: "flex:1" }, el("strong", { style: "font-size:16px", textContent: d.display }),
        el("div", { className: "hint", textContent: `@${d.name} · joined ${new Date(d.created).toLocaleDateString()}` })),
      el("div", { className: "stat-row", style: "flex:0" },
        ...[[d.stats.plays, "plays"], [d.stats.games, "games"], [d.stats.systems, "systems"]].map(([n, l]) =>
          el("div", { className: "stat", style: "flex:0 0 90px" },
            el("div", { className: "stat-n", textContent: n }), el("div", { className: "stat-l", textContent: l })))))));
  if (d.top && d.top.length) frag.append(shelf({ title: "Most played", count: d.top.length,
    tiles: d.top.map((p) => favTile({ sys: p.sys, id: null, name: p.name, img: null, file: p.file })) }));
  view.replaceChildren(frag);
}

async function routeAdmin() {
  ++state.render; spinner();
  document.title = "Admin — RetroVerse";
  const d = await fetch(`${API}/admin/summary`, { headers: authHdr() }).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (!d) { view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "🔒" }), el("h1", { textContent: "Admin" }),
    el("p", { textContent: signedIn() ? "Only the site owner can see this." : "Sign in as the owner." }),
    el("a", { className: "btn btn-ghost", href: "#/", textContent: "Home" }))); return; }
  const post = (action, body) => fetch(`${API}/admin/${action}`, { method: "POST",
    headers: { "content-type": "application/json", ...authHdr() }, body: JSON.stringify(body) });
  const frag = document.createDocumentFragment();
  frag.append(el("section", { className: "shelf", style: "padding:22px var(--pad) 0" },
    el("div", { className: "shelf-head" }, el("h2", { textContent: "Admin" }),
      el("span", { className: "hint", textContent: `${d.users.length} accounts · ${d.diskMB} MB on disk` }))));
  const wrap = el("div", { className: "wrap", style: "display:flex;flex-direction:column;gap:24px;padding-bottom:50px" });

  // banner
  const bText = el("input", { type: "text", placeholder: "Site-wide banner message (blank = none)",
    value: d.banner?.text || "", style: "flex:1" });
  const bKind = el("select", {}, ...["info", "warn", "hype"].map((k) => el("option", { value: k, textContent: k, selected: d.banner?.kind === k })));
  wrap.append(el("div", { className: "adm-card" }, el("h3", { textContent: "Banner" }),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, bText, bKind,
      el("button", { className: "btn btn-primary sm", textContent: "Save", onclick: async () => {
        await post("banner", { text: bText.value, kind: bKind.value }); toast("Banner updated"); checkBanner();
      } }))));

  // registration
  wrap.append(el("div", { className: "adm-card" }, el("h3", { textContent: "Registration" }),
    el("label", { className: "set-row" },
      (() => { const cb = el("input", { type: "checkbox", checked: d.registration === "open" });
        cb.onchange = async () => { await post("registration", { open: cb.checked }); toast(cb.checked ? "Registration open" : "Registration closed"); };
        return cb; })(),
      el("div", {}, el("div", { textContent: "Allow new accounts" })))));

  // requests
  wrap.append(el("div", { className: "adm-card" }, el("h3", { textContent: `Game requests (${d.requests.length})` }),
    d.requests.length ? el("div", {}, ...d.requests.map((r, i) => el("div", { className: "adm-row" },
      el("div", { style: "flex:1" }, el("strong", { textContent: r.title }),
        el("div", { className: "hint", textContent: `${r.who}${r.note ? " · " + r.note : ""} · ${new Date(r.at).toLocaleDateString()}` })),
      el("button", { className: "btn btn-ghost sm", textContent: "Done",
        onclick: async (e) => { await post("resolve", { request: d.requests.length - 1 - i }); e.target.closest(".adm-row").remove(); } }))))
      : el("p", { className: "hint", textContent: "None pending." })));

  // reports
  wrap.append(el("div", { className: "adm-card" }, el("h3", { textContent: `Broken-game reports (${d.reports.length})` }),
    d.reports.length ? el("div", {}, ...d.reports.map((r) => el("div", { className: "adm-row" },
      el("div", { style: "flex:1" }, el("strong", { textContent: r.name }),
        el("div", { className: "hint", textContent: `${r.sys} · ${r.n}× · ${Object.keys(r.issues || {}).join(", ")}` })),
      el("a", { className: "btn btn-ghost sm", href: `#/g/${r.sys}/`, textContent: r.sys }),
      el("button", { className: "btn btn-ghost sm", textContent: "Dismiss",
        onclick: async (e) => { await post("resolve", { report: r.key }); e.target.closest(".adm-row").remove(); } }))))
      : el("p", { className: "hint", textContent: "None pending." })));

  frag.append(wrap);
  view.replaceChildren(frag);
}

async function routeLogin() {
  ++state.render;
  document.title = "Sign in — RetroVerse";
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
    document.title = (mode === "in" ? "Sign in" : "Create account") + " — RetroVerse";
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
  const savesP = fetch(STATE_BASE + "list", { headers: authHdr() }).then((r) => r.json()).catch(() => null);
  await getSystems().catch(() => {});
  document.title = "Your profile — RetroVerse";
  const favs = favList(), recent = recentList();
  const saves = await savesP;
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

  frag.append(
    el("div", { className: "wrap" },
      el("h3", { style: "margin:22px 0 10px", textContent: "Activity" }),
      el("div", { className: "stat-row" },
        stat(hrs >= 1 ? hrs.toFixed(1) + " h" : Math.round(totalSec / 60) + " m", "played in browser"),
        stat(recent.length, "games launched"),
        stat(favs.length, "favorites"),
        stat(systemsTouched, "systems"),
        stat(fmtBytes(rc.bytes), "ROMs cached")),
      el("h3", { style: "margin:4px 0 10px", textContent: "Your library" }),
      el("div", { className: "profile-hub" },
        el("a", { href: "#/favorites" },
          el("span", { className: "hub-k", textContent: "♥" }),
          el("span", {}, el("span", { className: "hub-t", textContent: "Favorites" }),
            el("span", { className: "hub-s", textContent: `${favs.length} saved game${favs.length === 1 ? "" : "s"}` }))),
        el("a", { href: "#/saves" },
          el("span", { className: "hub-k", textContent: "☁" }),
          el("span", {}, el("span", { className: "hub-t", textContent: "Cloud saves" }),
            el("span", { className: "hub-s", textContent: saves ? `${saves.length} game${saves.length === 1 ? "" : "s"} with saves` : "Check your connection" }))))));
  if (recent.length) frag.append(shelf({ title: "Continue playing", count: recent.length,
    tiles: recent.map((r) => favTile({ sys: r.sys, id: null, name: r.name, img: r.img, file: r.file })) }));
  if (favs.length) frag.append(shelf({ title: "Favorites", count: favs.length, moreHref: "#/favorites",
    tiles: favs.slice(0, 24).map((f) => favTile(f)) }));
  const saveResolve = [];
  if (saves?.length) frag.append(shelf({ title: "Cloud saves", count: saves.length, moreHref: "#/saves",
    tiles: saves.slice().sort((a, b) => b.mtime - a.mtime).slice(0, 12).map((s) => cloudSaveTile(s, saveResolve)) }));
  frag.append(el("div", { className: "wrap" }, settingsCard()));
  const impInput = el("input", { type: "file", accept: ".json", hidden: true });
  impInput.onchange = async () => {
    const f = impInput.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (Array.isArray(d.favs)) LS.set("favs", d.favs);
      if (Array.isArray(d.recent)) LS.set("recent", d.recent);
      if (d.playtime) LS.set("playtime", d.playtime);
      if (d.netplay) LS.set("netplay", d.netplay);
      if (d.settings && typeof d.settings === "object") LS.set("settings", d.settings);
      if (d.padPresets && typeof d.padPresets === "object") LS.set("padPresets", d.padPresets);
      toast("Imported — reloading"); setTimeout(() => location.reload(), 800);
    } catch { toast("That's not a valid export file"); }
  };
  frag.append(el("div", { className: "wrap", style: "padding:8px var(--pad) 40px;display:flex;gap:10px;flex-wrap:wrap" },
    el("a", { className: "btn btn-ghost", href: "#/cache", textContent: "Manage offline cache" }),
    el("button", { className: "btn btn-ghost", textContent: "Export data", onclick: () => {
      const blob = new Blob([JSON.stringify({ favs: favList(), recent: recentList(),
        playtime: LS.get("playtime", {}), settings: LS.get("settings", {}),
        padPresets: LS.get("padPresets", null), netplay: LS.get("netplay", null),
        exported: new Date().toISOString() }, null, 2)], { type: "application/json" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "retroverse-profile.json" });
      document.body.append(a); a.click(); a.remove();
    } }),
    el("button", { className: "btn btn-ghost", textContent: "Import", onclick: () => impInput.click() }), impInput));
  view.replaceChildren(frag);
  hydrateCovers(saveResolve);
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
  document.title = `“${qRaw}” — RetroVerse`;
  await getSystems().catch(() => {});
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
const TOP_NAV = new Set(["home", "play", "lounge", "library"]);
function setNav(name) {
  $$(".bar-link, .drawer a, .side-nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
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
    window.__emuUp = false;
    try { emuCleanup(); } catch { /* */ }
    try { document.querySelector(".player")?.remove(); } catch { /* */ }
    location.replace(_exitDest(location.hash || "#/play"));
    return;
  }
  if (!window.__emuUp && (!a || a === "play") && !b && maybeResumeSession()) return;
  // ?join=<room> deep-link — a shared invite opens the game and auto-joins.
  if (!window.__emuUp) {
    const _join = new URLSearchParams(location.search).get("join");
    if (_join && a === "play" && b && parts.length > 2) {
      LS.set("joinNp", { sys: b, file: parts.slice(2).join("/"), room: _join, t: Date.now() });
      try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* */ }
    }
  }
  if (a !== "q") $("#bar-search").hidden = true;
  window.scrollTo(0, 0);
  document.title = "RetroVerse";
  if (a === "s" && b) { setNav(null); return routeSystem(b); }
  if (a === "g" && b && parts[2]) { setNav(null); return routeGame(b, parts[2]); }
  if (a === "resume" && b && parts.length > 2) { setNav("play"); return routePlayGame(b, parts.slice(2).join("/"), true); }
  if (a === "play" && b && parts.length > 2) { setNav("play"); return routePlayGame(b, parts.slice(2).join("/")); }
  if (a === "play" && b === "random") { setNav("play"); return surpriseMe(); }
  if (a === "play" && b) { setNav("play"); return routePlaySystem(b); }
  if (a === "play") { setNav("play"); return routePlay(); }
  if (a === "netplay") { setNav("play"); return routeNetplay(); }
  if (a === "watch" && b) { setNav("play"); return routeWatch(b); }
  if (a === "lounge") { setNav("lounge"); return routeLounge(); }
  if (a === "library") { setNav("library"); return routeLibrary(); }
  if (a === "favorites") { setNav(null); return routeFavorites(); }
  if (a === "saves") { setNav(null); return routeSaves(); }
  if (a === "cache") { setNav(null); return routeCache(); }
  if (a === "profile") { setNav(null); return routeProfile(); }
  if (a === "status") { setNav(null); return routeStatus(); }
  if (a === "login") { setNav(null); return routeLogin(); }
  if (a === "stats") { setNav(null); return routeStats(); }
  if (a === "admin") { setNav(null); return routeAdmin(); }
  if (a === "u" && b) { setNav(null); return routePublicProfile(b); }
  if (a === "collections") { setNav("library"); return routeCollections(); }
  if (a === "collection" && b) { setNav("library"); return routeCollection(b); }
  if (a === "franchises") { setNav("library"); return routeFranchises(); }
  if (a === "franchise" && b) { setNav("library"); return routeFranchise(b); }
  if (a === "movies") { setNav("lounge"); return routeMovies(); }
  if (a === "music") { setNav("lounge"); return routeMusic(b); }
  if (a === "videos") { setNav("lounge"); return routeVideos(); }
  if (a === "contact") { setNav(null); return routeContact(); }
  if (a === "browse") { setNav("library"); return routeBrowse(); }
  if (a === "q" && b) { setNav(null); return routeSearch(b); }
  if (a && a !== "") { setNav(null); return route404(); }
  setNav("home"); $("#q").value = ""; return routeHome();
}
function route404() {
  ++state.render;
  document.title = "Not found — RetroVerse";
  view.replaceChildren(el("section", { className: "pane center" },
    el("div", { className: "big-emoji", textContent: "🕹️" }),
    el("h1", { textContent: "Nothing here" }),
    el("p", { textContent: "That page doesn't exist — maybe an old link." }),
    el("a", { className: "btn btn-primary", href: "#/", textContent: "Back to the arcade" })));
}
window.addEventListener("hashchange", router);

/* ---- chrome ----------------------------------------------- */
$("#back-btn").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));
const drawer = $("#drawer");
$("#menu-btn").onclick = () => { drawer.hidden = !drawer.hidden; };
$("#party-chat-fab").onclick = openPartyChat;
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
    c = el("a", { id: "acct-chip", href: "#/profile", title: AUTH.user ? "Profile" : "Sign in" });
    ($(".bar-left") || $("#bar")).prepend(c);   // sign-in lives top-left
  }
  c.replaceChildren(el("span", { className: "ac-av", textContent: AUTH.user ? AUTH.user.avatar : "👤" }),
    el("span", { className: "ac-name", textContent: AUTH.user ? AUTH.user.display : "Sign in" }));
  c.href = AUTH.user ? "#/profile" : "#/login";
  c.title = AUTH.user ? "Profile" : "Sign in";
  const dl = $("#drawer-acct");
  if (dl) {
    dl.className = "drawer-acct" + (AUTH.user ? "" : " signin");
    dl.href = AUTH.user ? "#/profile" : "#/login";
    dl.replaceChildren(
      el("span", { className: "ac-av", textContent: AUTH.user ? AUTH.user.avatar : "👤" }),
      el("span", { textContent: AUTH.user ? AUTH.user.display : "Sign in" }));
  }
  const prof = $('#drawer a[data-nav="profile"]');
  if (prof) prof.textContent = AUTH.user ? "Profile & settings" : "Sign in / Profile";
}
addEventListener("ssw-auth", renderAcctChip);
addEventListener("ssw-prefs", applyPrefs);
renderAcctChip();
hydrateAuth();

/* ---- keyboard shortcuts ------------------------------------- */
const HELP = [["/", "search"], ["g h", "home"], ["g p", "play"], ["g l", "lounge"], ["g b", "library"],
  ["g f", "favorites"], ["r", "random game"], ["l", "toggle lite mode"],
  ["Esc", "exit a game"], ["?", "this help"]];
let _kchord = 0;
addEventListener("keydown", (e) => {
  if (window.__emuUp && e.key === "Escape") { e.preventDefault(); exitPlayer(); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || window.__emuUp || e.metaKey || e.ctrlKey || e.altKey) return;
  // roving focus across tiles: arrows move, Enter opens (Tab still works natively)
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
    const tiles = [...document.querySelectorAll("a.tile")].filter((t) => t.offsetParent !== null);
    if (!tiles.length) return;
    const i = tiles.indexOf(document.activeElement);
    if (e.key === "Enter") { if (i >= 0) { e.preventDefault(); document.activeElement.click?.(); } return; }
    if (i < 0) {
      if (e.key === "ArrowDown" && document.activeElement === document.body) { e.preventDefault(); tiles[0].focus(); }
      return;
    }
    const perRow = Math.max(1, tiles.filter((t) => Math.abs(t.offsetTop - tiles[i].offsetTop) < 4).length);
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -perRow : perRow;
    e.preventDefault();
    const n = Math.min(tiles.length - 1, Math.max(0, i + step));
    tiles[n].focus();
    tiles[n].scrollIntoView({ block: "nearest", inline: "nearest" });
    return;
  }
  const now = Date.now();
  if (_kchord && now - _kchord < 900) {
    _kchord = 0;
    const map = { h: "#/", p: "#/play", m: "#/music", v: "#/videos", f: "#/favorites", c: "#/contact", s: "#/saves", l: "#/lounge", b: "#/library" };
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
  uiRoot().append(o);
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

/* ---- owner-set site banner --------------------------------- */
async function checkBanner() {
  try {
    const b = await fetch(`${API}/banner`, { cache: "no-store" }).then((r) => r.json());
    const ex = $("#site-banner");
    if (b && b.text && LS.get("bannerseen", "") !== b.at + b.text) {
      const bar = ex || el("div", { id: "site-banner" });
      bar.className = "kind-" + (b.kind || "info");
      bar.replaceChildren(el("span", { textContent: b.text }),
        el("button", { textContent: "✕", onclick: () => { bar.remove(); LS.set("bannerseen", b.at + b.text); } }));
      if (!ex) document.body.prepend(bar);
    } else if (!b && ex) ex.remove();
  } catch { /* */ }
}
checkBanner();
setInterval(checkBanner, 300000);

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
    let reg;
    try { reg = await navigator.serviceWorker.register("sw.js"); } catch { return; }

    let reloading = false, updateClicked = false;
    const doReload = () => {
      if (reloading) return;
      reloading = true;
      try { window.__emuUp = false; } catch { /* */ }
      location.replace(location.pathname + "?_=" + Date.now() + (location.hash || "#/"));
    };
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (updateClicked) doReload(); });

    const promptUpdate = (worker) => {
      if (!worker || document.getElementById("sw-toast")) return;
      const btn = el("button", { textContent: "Reload" });
      const bar = el("i", { className: "sw-bar", hidden: true });
      const t = el("div", { id: "sw-toast" }, el("span", { textContent: "New version ready. " }), btn, bar);
      btn.onclick = () => {
        updateClicked = true;
        btn.disabled = true;
        btn.textContent = "Updating…";
        bar.hidden = false;
        try { (reg.waiting || worker).postMessage("skip"); } catch { /* */ }
        setTimeout(doReload, 300);
        setTimeout(doReload, 2500);
      };
      uiRoot().append(t);
    };

    // idempotent — prompts whenever a new worker is installed and waiting
    const checkWaiting = () => {
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    };
    checkWaiting();                                   // waiting from a previous visit
    reg.addEventListener("updatefound", () => {
      reg.installing?.addEventListener("statechange", checkWaiting);
      checkWaiting();
    });
    navigator.serviceWorker.addEventListener("message", checkWaiting);

    // check for a new build on focus + hourly while the tab stays open
    const poll = () => reg.update().then(checkWaiting).catch(() => {});
    addEventListener("focus", poll);
    setInterval(poll, 3600000);
  });
}

router();
