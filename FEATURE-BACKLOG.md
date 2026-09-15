# RetroVerse feature backlog

**Status 2026-09-11 late:** the layout agent has finished and is gone; the
netplay agent now owns all remaining work. Netplay internals are `NP`, `np*()`,
`handlePingReply`, `acceptInvite`, `/np/*`, `/play/invite*`.

## Done (netplay agent)

1. ✅ **Voice chat** (2.22.17) — mic on the same `RTCPeerConnection`, 🎙 toggle in
   the sheet, `npVoice` pref, `#np-remote-audio` playback, renegotiation via
   `onnegotiationneeded`. The `#np-video` element is video-only now; game audio +
   voices share the audio element.
2. ✅ **Live RTT / persistent status** (2.22.17 + 2.22.12) — 2 s datachannel
   ping/pong shown in the `#np-live` badge and Diagnostic line; link state is a
   badge, not a 5 s toast.
3. ✅ **Host-authoritative video** (2.22.9) — supersedes the old input-echo drift
   fix. `NP.video` path streams canvas + game audio to the guest.
4. ✅ **Role-aware auto-reconnect** (2.22.18) — host persists `ssw:hostNp` and
   re-hosts the same room (server `reuse`); guest re-joins on link loss; explicit
   exit clears it, reload does not.
5. ✅ **"Both ready" gate** (2.22.18) — `{t:"ready"}` handshake, `✓ ready` in the
   badge, both-ready toast.
6. ✅ **Push-to-talk / mic mute** (2.22.19) — `npPTT` pref, floating `#np-ptt`
   (hold-to-talk or tap-to-mute), `MediaStreamTrack.enabled` mute.
7. ✅ **Watch-party WebRTC transport** (2.22.19) — `WNP`: host streams canvas +
   game audio over a signaling room; watcher plays it. JPEG stream kept as
   fallback.

## Superseded / will likely not do

- **Rollback / input-delay netcode** — was item 2. With host-authoritative video
  the guest renders the host's screen, so there is no drift to roll back. Only
  revisit if a future mode runs two cores again (then use
  `gameManager.getFrameNum()` + `Module.postMainLoop`).

## Remaining (netplay agent)

1. **Native push invite — code done (2.22.20), needs an APK build.** Site posts
   `{cid,origin,on}` to the app's `SSNotify`; `MainActivity` polls
   `/play/invites` while backgrounded and deep-links back. Build/test the APK;
   Android 13+ needs the `POST_NOTIFICATIONS` grant.
2. **Push-to-talk — done (2.22.19).**
3. Longer term: invite history, spectator→player promote, TURN relay on `shadow`
   if remote peers ever fail to connect.

## UI pass (2026-09-12, "netplay agent")

Done in 2.22.21, all in `docs/assets` + `build.py`:

- Transparent, larger logo; header icons (menu/search/profile) 2× and matching
  SVGs; `--bar-h` 68 px.
- `build.py` strips the white background from `media/consoles/*.webp`
  (`strip_light_bg`) so console tiles aren't white-boxed.
- Mobile now-playing chip no longer overlaps the Preview/Box-art toggle;
  [View game] centred, next at the right.

Left to do (not started): true box-art for art-less **games** is the existing
generated sleeve (`coverArt` → `.tile-art.noart`) — could be upgraded to a
per-game procedural cover if it still looks flat.

## Follow-up UI batch (2026-09-12)

- The Play landing page now has the curated popular-games backdrop; home has
  Movies and Music shelves; and desktop has a secondary left rail.
- Lounge chat is a deliberately small shared `/chat` feed, including the
  floating party-chat window. Do not add another transport for that feature.
- Tile-art badges are gone. Art-less sports games use the themed generated
  sleeves. In the in-app player, the floating pad control remains the one
  place to hide/show the touch pad; the duplicate top-menu Pad/Portrait items
  were removed and games explicitly enter landscape.

## Do not

- Re-enable Tailscale Funnel (§4) or EmulatorJS `:8712` lockstep (§12).
- Empty `NETPLAY_ICE` — host-only ICE cannot cross the tailnet (mDNS). See
  `NETPLAY-UI-CONTRACT.md`.
- Break the `#np-video` stacking (touch pad must stay above it) or the
  `<details>` Diagnostics in the netplay sheet.

## Planned 2026-09-13 — owner's priorities

Owner decisions: **party calls = native Android** (survives app close, OS
floating bubble); **RetroAchievements = web login now + cheevos unlocks after**;
**graphics = per-console options**.

### A. Party calls (Discord-like) — started
- ✅ Server party room on `arcade-server.mjs`: `/party` (create/join),
  `/party/ping`, `/party/leave`, `/party/sig` (directed/broadcast). Members have
  a 45s heartbeat; empty rooms are GC'd after 30 min.
- ✅ Web `PARTY` mesh (voice, lower CID offers) + call UI at the top of the chat
  panel; watchers join as listeners; room code is posted to chat.
- ✅ Android `PartyService` (foreground, mic type) + draggable overlay bubble,
  notification mute/leave, `partyStart/partyStop/partyMute/canOverlay/
  requestOverlay` bridge, `window.__sswPartyAction`.
- ⏳ **Not done — true persistence after swipe-away.** The call still lives in
  the Activity WebView; pressing back while on a call now backgrounds the app
  (`backgroundApp`/`moveTaskToBack`) so the call + bubble survive, but a
  force-stop/swipe-away still ends it. To finish: host the party call in a
  headless WebView owned by `PartyService`, hand the call over from the Activity
  when it backgrounds, and expose the bubble's mute via the service.
- ✅ Watcher → talker: `🎙 Use microphone` rebuilds the peers with a mic track.
- ✅ In-game access: `💬 Chat & party` in the `⋯` menu shows the panel above the
  game (mounted via `uiRoot()`).
- ✅ Watch/invite → call: `/watch` and `/play/invite` carry `party`; accepting
  or opening a watch link joins the party as a listener.
- ⏳ Unify the netplay `#np-*` voice with the party call so a watcher joining a
  netplay session lands on the same call.

### B. RetroAchievements
- Done: `raSettingsForm()` (prefs `raEnabled/raUser/raKey`) in profile Settings
  and the in-game Achievements panel, plus a **Test connection** button
  (`raTest()` → `API_GetUserProfile.php`; RA sends CORS `*`, no proxy needed).
- Next: list a game's achievements (needs the RA game id from the ROM MD5:
  `dorequest.php?r=gameid&m=<md5>`, then `API_GetGameInfoAndUserProgress.php`).
- In-game unlocks/popups still need a cheevos-capable emulator build (the
  self-hosted `stable` EJS has none) or rcheevos wasm. Render popups via a
  `uiRoot()` overlay (`raToast({title,desc,points,icon})`).

### C. Per-console graphics — started
- ✅ `gfxFilterFor(sys)`/`saveGfxFilter()` (LS `gfxPresets`, like padPresets),
  applied in `routePlayGame`; `gfxPanel(sys)` from the in-game `🖼 Graphics`
  entry (Pixel-perfect / Smooth / CRT per console).
- Next: per-core internal-resolution + texture-filter options where EJS/core
  exposes them (N64 stays WebGL1).

## Research: PS2 / GameCube / Xbox feasibility (2026-09-16)

Owner asked to start researching bringing these systems (and their netplay)
into RetroVerse, with the existing per-console auto-mapped-controls pattern
(`CORE_SHOULDERS`/`CORE_TRIGGERS`/`CORE_STICKS` in app.js, `controlsPanel()`)
extended to them. Findings below are desk research only — **nothing
implemented, nothing installed**. Ranked by how real the path is:

**Xbox (original) — effectively not feasible today.** No WASM/browser port
exists, and none is in progress as far as could be found. The reference
emulator ([xemu](https://xemu.app/)) is QEMU-based — it dynamically
recompiles x86 machine code at runtime, which is fundamentally incompatible
with the browser sandbox's ban on self-modifying/JIT-generated code. This
isn't "hasn't been done yet", it's the same wall EmulatorJS itself cites for
why PS2/GameCube/Wii/3DS aren't on their roadmap either (GPU drivers, JIT,
RAM). Park this one; revisit only if WASM JIT sandboxing rules genuinely
change upstream (unlikely on any near-term horizon).

**PlayStation 2 — the most promising path, still early.** [Play!](https://github.com/jpd002/Play-)
(jpd002) has an actual, working WASM build with a public demo
(playjs.purei.org), built via Emscripten. ~49% of its ~2,642 tested games are
rated fully playable — real, but well below desktop PCSX2's compatibility, so
"PS2 games work" would need to become "*some* PS2 games work" as the honest
framing. It is **not** a libretro/EJS core — it has its own bespoke JS API,
so nothing about our current EJS wiring (`simulateInput`, `getState`/
`loadState`, `EJS_Buttons`, the whole netplay layer) carries over for free;
integrating it means a second, parallel "player" implementation alongside the
EJS one, and building netplay for it from scratch (no built-in netplay in
Play! itself — same host-authoritative-video or input-sync approach we
already built for EJS would need porting to Play!'s API, not reused as-is).

**GameCube — a narrower experimental path.** [wasm-dolphin](https://github.com/dougchansan/wasm-dolphin)
compiles upstream Dolphin via Emscripten with a custom PowerPC→WASM JIT and a
**WebGPU** presentation path. WebGPU is the catch for us specifically: Android
WebView's WebGPU support is still patchy/version-dependent, and the app is a
WebView wrapper — this could easily work in a desktop browser and not in the
Android app on the exact hardware it needs to work on. Best-documented result
is Super Smash Bros. Melee near-100% speed on a modern desktop browser;
broader GameCube/Wii compatibility beyond that isn't characterized. GPLv2+
licensing (same family as Dolphin) — fine for private/self-hosted use
(copyleft triggers on distribution, not on running it), just don't ship the
core as part of a distributed release without the sources.

**Controls auto-mapping, if any of this lands**: the existing pattern
(`CORE_SHOULDERS`/`CORE_TRIGGERS`/`CORE_STICKS` sets in app.js gate which
button groups `controlsPanel()`/`padSvg()` show per system; RetroPad slot ids
0-15 already cover face buttons, d-pad, shoulders, triggers, and both sticks)
extends cleanly in *shape* to PS2/GameCube/Xbox controllers — all three use a
D-pad + twin analog sticks + shoulders + triggers, same slot set as
N64/PSX/3DO already in `CORE_STICKS`. The real work isn't the mapping UI,
it's that neither Play! nor wasm-dolphin speaks the EJS `gameManager.
simulateInput(player, retropadId, value)` contract this app currently hooks
everywhere (netplay input included) — each would need its own input-binding
translation layer written from its own JS API outward.

**Bottom line**: PS2 (via Play!) is the only one worth a real prototype spike
if this is pursued — partial compatibility and real integration work, but
real. GameCube (via wasm-dolphin) is a maybe, gated on Android WebView WebGPU
support actually being there when tested on-device. Xbox isn't actionable
with current browser technology. None of the three have any existing netplay
to build on — that part would be built from scratch on each project's own
API, reusing only the *design* (not the code) of the existing EJS netplay
layer.
