# AGENT-MEMORY.md — session log & handoff for future agents

Long-form memory for people/agents working on **RetroVerse**. `AGENTS.md` is the
operational rulebook; this file is the *why* and the *what-happened*, so a new
agent can pick up context without re-deriving it. Read `AGENTS.md` first, then
this. (Netplay internals: `NETPLAY-UI-CONTRACT.md`. Roadmap split:
`FEATURE-BACKLOG.md`.)

## Session 2026-09-13 — party calls, per-console graphics, mic handshake
- **Mic fix (2.99)**: `npGetMic` retried once after 1.8s, so answering the
  Android permission dialog late showed "denied". It now retries up to 6 times
  while the app dialog is open (`maxAttempts = window.SSNotify ? 6 : 1`), and
  the app dispatches `ssw-mic` with the OS result. App commit adds the bridge.
- **Party calls (3.0)**: server `PARTY` map + `/party`, `/party/ping`,
  `/party/leave`, `/party/sig` (directed or broadcast, monotonic `n`, 45s
  member heartbeat, 30min empty-room GC). Web `PARTY` module is a mesh: the
  lower CID offers, the higher answers; `partyCallUI()` sits at the top of the
  chat panel. Watchers join with `watcher:true` (no mic track). The room ID is
  posted to chat so others can join by code.
- **Android party**: `PartyService.kt` (foreground, `microphone` type) +
  draggable `TYPE_APPLICATION_OVERLAY` bubble; `MainActivity` methods
  `partyStart/partyStop/partyMute/canOverlay/requestOverlay`; Dart forwards
  `SSNotify {party, muted}` to the service and the service's `partyAction` back
  into `window.__sswPartyAction`. Manifest adds `FOREGROUND_SERVICE_MICROPHONE`
  + `SYSTEM_ALERT_WINDOW` and the `<service>` entry.
  **Limitation**: swiping the app away still tears the process down and ends the
  call. True persistence needs the call engine moved into the service (headless
  WebView). Do not claim otherwise.
- **Per-console graphics**: `gfxFilterFor(sys)` / `saveGfxFilter()` ("gfxPresets"
  LS key, mirrors `padPresets`), used by `routePlayGame` for the EJS shader +
  `data-vf`. Panel: `gfxPanel(sys)` from the in-game `🖼 Graphics` entry. Deeper
  per-core options (resolution, texture filter) remain in EJS's own menu.
- Restarted `arcade-server.service` after the live `~/arcade-server.mjs` edits
  (party + uname). `kill` is an unsupported builtin in this shell — use
  `pkill -9 -f arcade-server.mjs`; systemd `Restart=on-failure` brings it back.
- Flutter is at `~/development/flutter/bin` (not on PATH); `flutter analyze`
  and `flutter build apk --release` both work here.

## Session 2026-09-13 — IPTV, toolbar/input, chat profiles, RA groundwork
- `live-tv.json` only ever held 3 playable channels plus a pointer to the whole
  iptv-org m3u, so Live TV looked like "4 channels". `routeTv` now fetches
  `https://iptv-org.github.io/iptv/index.m3u` (2.5 MB, CORS `*`), parses it
  (`parseM3U`), caches it in the `ssw-iptv` Cache API cache, and renders a
  searchable, group-filtered list (200 at a time). Browser playback is an
  in-page `playStream()` overlay using hls.js (CDN, lazily loaded) for `.m3u8`;
  the Android path still posts to `window.SSTV` (VLC). `curatedChannels()`
  filters the playlist pointer out of the featured tiles.
- In-game toolbar: `padLayoutBtn` removed; "Pad layout…" now lives inside the
  controller panel, which is relabelled **Input settings** and receives `sys`
  (`controlsPanel(core, sys)`).
- Chat profile links: server chat messages and presence now carry `uname`
  (username). `chatWidget.push` and the party panel link names to `#/u/<uname>`
  when present. Applied to tracked `server/arcade-server.mjs` **and** the live
  `~/arcade-server.mjs`; **restart `arcade-server.service`** to activate.
- RetroAchievements: the self-hosted EmulatorJS `stable` build has no `cheevos`
  (grep found none), so unlocking needs either an EJS build with RA or an
  rcheevos wasm path. For now `raSettingsForm()` (profile Settings + in-game
  Achievements panel) stores `raEnabled/raUser/raKey` in prefs. RA's web API
  needs an API key; password login is only available via the rcheevos library
  (how ES-DE does it), so a future build must call that.
- Android wordmark: `html.in-app` sets `--bar-h:76px` and `.brand .logo`
  height 62px with a small upward nudge.

## Session 2026-09-13 — browser-only overlay flicker
- Reproduced the site in a real-GPU Chromium (`/usr/bin/chromium --remote-debugging-port=9222` on the Wayland display) and captured the N64 canvas over time. The browser-only difference over the game is `.scanlines`: a fixed full-screen `mix-blend-mode: multiply` overlay at z-index 100, **above** `.player` (z 60). The app hides it (`html.in-app .scanlines`), the browser did not. Cache version `2.97` adds `html.playing .scanlines { display: none }`; the emulator's own CRT filter covers the look.
- Also throttled `invitePoll` (was every 3s, even in-game) to ~12s while `__emuUp`; it was the only 2-3s main-thread timer during play.
- N64 specifics: forcing WebGL2 for N64 (`?ejs-webgl=enabled`) renders static/garbage on this RTX 5070 + ANGLE, confirming the AGENTS §15 note; WebGL1 (`mupen64plus_next-legacy`) is correct. A/B of `image-rendering: pixelated` vs `auto` showed no meaningful difference, so pixelated stays.
- If flicker persists, capture with CDP: `Page.captureScreenshot` at ~20Hz and diff `meanBrightness` (see the throwaway `/tmp/rv-*.mjs` harness approach). A live Chrome needs `--remote-debugging-port`; without it there is no way to inspect.

## Session 2026-09-13 — playback buttons, Play page trim, GPU artefact hunt
- Removed the `.player-bar` rewind/fast-forward buttons (`#ff-btn`, `#rw-btn`).
  R2/L2 playback is unchanged: `pollGameplayPad` reads gamepad buttons from
  `PAD_BINDS` (defaults 7/6) via `loadPadBinds()`, which caches `prefs()` and
  refreshes on `ssw-prefs`. Controller setup has a "Playback (RetroVerse)"
  group that captures the next controller button for `ffPadButton`/
  `slowPadButton`. Fast-forward/slow are RetroVerse features, not EmulatorJS
  controls, so they use their own capture (`listeningPad`), not `listening`.
- Desktop browser now defaults to `webgl2Enabled: "disabled"` (WebGL1/2D) for
  all cores; `?ejs-webgl=enabled` opts back in. Rationale: the documented
  desktop WebGL2 corruption/flicker, and the Android WebView (WebGL2) is
  known-good. The boot-failure retry button now says "Retry with WebGL2".
- Found via a headless CDP trace of a NES game: the only periodic canvas
  readback was our own cloud-save thumbnail (`canvas.toBlob` in `putSlot`),
  which forces a GPU ReadPixels stall each auto-save. `putSlot` now takes
  `{shot}` and auto-save passes `shot:false`; thumbnails are manual-save only.
- Play page: dropped the `play-tools` ("Choose how to play") section and the
  showcase's title/desc/actions. `heroShowcase` now renders title/desc/actions
  only when supplied. The ROM input lives in a hidden `dropzone()` and a
  one-time document drop handler preserves drag-and-drop.
- NOTE: a live Chrome without `--remote-debugging-port` can't be inspected.
  To reproduce GPU artefacts, relaunch Chrome with the flag and attach at
  `http://127.0.0.1:9222`.

## Session 2026-09-13 — netplay freeze + in-game chrome cleanup
- Symptom: after invite → accept, the acceptor (Player 2) could still control
  its character but its screen froze. Root cause: host-authoritative video hid
  the guest's local canvas and relied on the WebRTC video track, which can
  connect but never present a frame (or stall). Cache version `2.95` keeps the
  local canvas visible until the video actually plays, and if it stalls the
  guest sends `{t:"mode",video:false}` so the host also drops video and starts
  savestate sync; both then run input-echo. The old fallback showed a local
  core that had received no P1 inputs, so it was still frozen.
- Reopening the app/reloading a hosted game now shows `npRecoveryPrompt`
  (continue hosting / new room / single player) instead of silently re-hosting.
  `hostNp` + `lastSession.np/role=host` still gate it to a fresh 15 min window.
- In-game bar is now Exit · rewind/FF · `☁ Saves` menu · Netplay menu · `⋯`
  menu. Saves (save/slot/load/delete) are one submenu; controller, pad layout,
  note and report moved under `⋯`. Netplay actions unchanged.
- EmulatorJS's native top-right three-bar button (`.ejs_virtualGamepad_open`)
  is hidden in-app only; it toggled EJS's own pad menu and looked dead.
- `#help-overlay` (used by the Netplay sheet and help) is now a scrollable
  flex overlay with a bounded `.help-card`, so phone users can reach the lower
  buttons. Menu popovers get `max-height` + `overflow-y` on coarse pointers.
- Browser rendering: `.player-load`/`.player-stage` are solid black and the
  canvas is `image-rendering: pixelated` unless the smooth/CRT filter is set,
  reducing boot artefacts and scaling shimmer.

## Session 2026-09-13 — N64 save-state regression

- Cache version `2.94` disables N64 automatic recovery loads and background
  auto-saves. `gameManager.getState()` can block Chrome while serializing N64
  memory, and stale recovery states can produce a black screen.
- The player save controls now expose a `Saves` picker and a trash action that
  deletes all cloud slots for the current game.
- The N64 retry action now correctly reaches the ROM cache key and can remove a
  failed cached download before retrying.

## Session 2026-09-13 — N64 launch hardening and netplay cleanup

- Cache version `2.93` validates complete ROM bodies before caching or booting.
  Interrupted or truncated cached ROMs are deleted and downloaded again.
- Emulator startup now has a bounded watchdog with a visible retry action;
  desktop N64 retries with WebGL2 when the normal legacy-WebGL path does not
  initialize.
- `/np/sig` exposes the active guest CID so clients can reject accidentally
  joining their own host room. Ready handshakes reject same-role peers.
- Diagnostics now include peer role and sync failure reason. Explicit Leave
  cancels reconnect timers and clears guest/host recovery state.

## Session 2026-09-13 — auth diagnostics

- The live `/auth/login` and `/auth/register` endpoints are healthy and
  registration is open. Unauthenticated `/auth/me` returning 401 is expected.
- The public GitHub Pages mirror reaches the account API through the Tailnet
  hostname; users outside the Tailnet cannot authenticate there because Funnel
  is intentionally disabled.
- Cache version `2.88` now preserves non-JSON auth responses and reports
  network, rate-limit, and server errors directly in the sign-in form.

## Session 2026-09-13 — netplay signaling isolation

- The previous `/np/sig` implementation replayed one append-only message list
  to both peers. Reconnects could therefore apply stale SDP/ICE from an earlier
  guest session.
- Cache version `2.89` adds an active `guest` CID per room, routes host traffic
  only to that guest and guest traffic only to the host, and clears the old
  message list when a different guest takes over. Sequence numbers remain
  monotonic so existing host polls do not miss replacement offers.
- The tracked server and live `~/arcade-server.mjs` must stay identical; restart
  `arcade-server.service` after backend changes.

## Session 2026-09-13 — state synchronization transport

- Connection and signaling can succeed while the two local emulator cores
  drift. The old sync path sent every 16 KB state chunk immediately, allowed
  overlapping transfers, and hid `loadState` errors.
- Cache version `2.90` adds a transfer ID, one-transfer-at-a-time locking,
  WebRTC bufferedAmount backpressure, bounded receive sizes, and visible state
  send/apply diagnostics.

## Session 2026-09-13 — auth throttle and phantom rooms

- The auth limiter previously keyed requests by the first `x-forwarded-for`
  address. Behind a shared reverse proxy this could make all users receive
  `slow down` after one client's attempts. Version `2.91` sends the existing
  per-browser CID as `x-ssw-client` and scopes auth limits to that client.
- Normal launches were also creating a Netplay room automatically, which made
  a fresh update appear to be waiting for P2. Version `2.91` removes implicit
  room creation and only resumes hosting when `lastSession.np=true` and the
  prior role was explicitly host.
- Add `x-ssw-client` to CORS allow-headers if changing the server CORS policy.

## Session 2026-09-13 — Player 2 role and controls

- Cache version `2.92` distinguishes normal invited guests from watch-only
  spectators: the normal netplay badge says `Playing as P2`.
- Host-stream input now calls the original host emulator handler for P1 and
  forwards P2 inputs explicitly, with sent/applied input counters in the
  diagnostics panel.
- Host video tracks request detail-preserving delivery up to 8 Mbps/60 FPS;
  the guest stream no longer intercepts touch input.

## Session 2026-09-13 — media reliability and diagnostics

- Added track-level search, genre filtering, persistent music favorites, volume
  control, and music requests in `docs/assets/app.js`; the Android bridge
  contract (`window.SSMusic`) is unchanged.
- Added IPTV source attribution/retry messaging and Music/IPTV checks to
  `#/status`.
- Cloud recovery saves now retry transient failures with backoff and record
  `ssw:lastCloudSave` metadata; save slots remain server-authoritative.
- Movie filters use compact themed controls; cache version is `2.74`.
- Movie dialogs now expose dialog semantics and close on Escape; save-slot
  loading warns when the local recovery timestamp is newer.
- Remaining follow-up: live device validation of VLC URI handling and further
  save conflict UI (timestamps/origin comparison).

## Session 2026-09-13 — netplay toolbar and watcher UX

- The in-game player bar now groups transport, saves, and Netplay controls.
  Invite, Watch, Sync, and room controls are inside the responsive Netplay
  submenu; the `#player`, `#game`, and `window.SSMusic` contracts are unchanged.
- The Netplay sheet can start a watch party explicitly, allowing viewers to
  join without occupying Player 2. Home/Play presence cards continue to show
  Watch once the host starts the party.
- Signaling polling now surfaces room expiry and repeated server failures
  instead of silently swallowing them. Cache version is `2.75`.

## Session 2026-09-13 — floating chat and friends

- The persistent floating Chat button is draggable on desktop and touch
  devices. Its position is saved in `ssw:chatFabPosition`; dragging to the
  bottom X target hides it until reload.
- The chat window now includes active players from `/play/stats`, with
  `Join as P2` when a room is open and `Watch` when a watch-party link exists.
  The existing `/chat` and watch/netplay transports remain unchanged. Cache
  version is `2.76`.

## Session 2026-09-13 — Play landing page organization

- Reordered `#/play`: main actions, Friends/On the floor presence, preview
  slider, upload/browse/netplay tools, then playable console shelves.
- Added `play-hero`, `play-preview`, and `play-tools` responsive styles to
  keep the page compact and usable on mobile. Cache version is `2.77`.

## Session 2026-09-13 — netplay room/join diagnostics

- Netplay room creation now validates non-2xx and malformed responses rather
  than hiding them behind “Couldn't create a room”.
- The Netplay sheet shows the host's room code and provides an explicit Join
  room field for guests.
- Guest joins validate the room first and retry WebRTC signaling up to six
  times with visible status messages. Cache version is `2.78`.

## Session 2026-09-13 — N64 netplay reliability audit

- Verified the live signaling service, N64 metadata, Mario Kart 64 ROM, and
  `mupen64plus_next` core assets are reachable.
- N64 now skips host canvas-video negotiation and uses the existing local
  input/state-sync path, avoiding the heavier WebRTC media setup that was
  leaving Android guests stuck at Connecting. Cache version is `2.79`.
- Signaling send/offer failures are now recorded in the Netplay diagnostics.
- Floating-chat presence polling exits cleanly once its panel is closed.

## Session 2026-09-13 — in-game toolbar alignment

- Desktop `.player-bar` controls are centered with a desktop-only media query;
  touch devices retain the existing scrollable layout. Cache version is `2.80`.

## Session 2026-09-13 — Android update and playback regression fixes

- Service-worker update activation now performs one reload after `skipWaiting`
  instead of two competing timers, which was especially visible in Android
  WebView.
- Emulator speed is reset to normal at game start; gamepad trigger values must
  exceed 0.65 for R2 fast-forward or L2 slow motion.
- Presence cards use “Join as P2” and show an explicit Watch-unavailable state
  when no watch-party ID exists. Cache version is `2.81`.
- The speed reset is also performed from `EJS_onGameStart`, after the emulator
  instance exists; cache version is now `2.82`.
- Browser N64 boot now maps the metadata alias `n64` to
  `mupen64plus_next`. Failed guest joins close the peer and clear stale guest
  recovery hints; signaling message failures no longer stop polling. Cache
  version is `2.83`.
- Deep audit found stale rooms accumulating because `/np/sig` polling did not
  refresh room activity and `/play/ping bye` did not remove host rooms. Client
  polls now include the CID, and both tracked and live server copies remove
  host rooms on exit. Cache version is `2.84`.
- Isolated Chromium reproduced N64 core initialization stalling at
  “Decompress Game Core” with no canvas. Version `2.85` adds a desktop-only
  `webgl2Enabled: "disabled"` fallback; Android keeps WebGL2.
- Version `2.86` fixes the room-creation regression caused by
  `openNetplaySheet()` calling the locally scoped `ping()` function. The
  presence ping is now exposed as `window.__playPing`, and invite failures
  include diagnostics.
- Version `2.87` hardens SDP handling for reconnects, adds a ready handshake,
  and exposes peer/ICE state in timeout diagnostics. Stale offers are ignored
  according to host/guest role.

---

## Session 2026-09-12 — final handoff recovery

- **Menu split:** `.chrome-peek` opens the RetroVerse in-game toolbar. Do not
  intercept `.ejs_virtualGamepad_open`; the top-right EmulatorJS button must
  retain its native audio/video/FPS and save import/export menu.
- **Toolbar layout:** `.player-chrome` wraps the controls above the small game
  title strip. Keep `#player-title` outside `.player-bar`; the Exit button is a
  regular `.pbtn.exit` so it visually matches the other controls.
- **Navigation sizing:** the home `.cab-dock` cards receive desktop-only sizing
  at 1024 px and above. Mobile hides the header search button; Play supplies
  the `.play-search` action so the logo can grow without crowding the header.
- **Desktop navigation:** removed the left rail entirely. Favorites and Cloud
  saves belong under Profile; Netplay is reached from Play/in-game. Keep the
  hamburger drawer intact for its mobile navigation.
- **Mobile drawer:** SVG taps are stopped before the document-level outside-click
  handler runs. `toggleDrawer()` owns its hidden state and keeps
  `#menu-btn[aria-expanded]` correct; drawer links and genuine outside taps
  close it.
- **In-game controls:** the 2.22.22 player bar is deliberately ordered as Exit ·
  title · rewind/fast-forward · saves · netplay · controller / notes / report /
  pad layout. It has **no** duplicate Portrait control and **no** Hide pad
  control. The Android in-game shell retains its separate bottom-left
  `.fab-pad`, the only Hide/Show pad control.
- **Android bridge status:** native background invite polling and WebView
  microphone permission support are committed in companion repo `shadowswords`
  at `02eec03`. They require an APK build and device test; this workspace has
  no `flutter` executable on `PATH`.

---

## Session 2026-09-11 — "layout agent"

### Context
Two agents worked the repo at once on 2026-09-11:
- **netplay agent** — owned netplay internals (`NP`, `np*()`, `/np/*`,
  `/play/invite*`, `handlePingReply`, `openNetplaySheet`, `npJoin`, video
  streaming). It was editing `docs/assets/app.js` continuously, and bumped
  versions `ssw-v2.44 … v2.50` and CHANGELOG `[2.22.6] … [2.22.15]` while I worked.
- **layout agent (this session)** — owned the in-game chrome, home showcase,
  library/discovery, accessibility, offline UI and backup. Shipped `v2.45 →
  v2.51`, CHANGELOG `[2.22.7]`, `[2.22.11]`, `[2.22.13]`, `[2.22.14]`, `[2.22.16]`.

**Coordination rule that emerged:** one writer per area, re-read the exact
region immediately before every edit (the file changes under you), and keep a
note in the shared docs. Version bumps race — always read `docs/sw.js` +
`docs/index.html` right before bumping and take the *next* number.

### What this session changed (all in `docs/assets/`)

| Area | Change | Where |
|---|---|---|
| In-game bar | Regrouped button order; single scroll row in-app | `app.js` `routePlayGame` |
| Landscape | `goLandscape()` is now a real toggle (SSPlay "0"/"1"); label flips Landscape/Portrait; browser path toggles fullscreen | `app.js` `landNow`/`syncLandLabel`/`goLandscape` |
| Netplay in bar | Removed the in-app `.fab-np`; netplay lives in the hideable bar; reveal handle `.chrome-peek` doubled to 112×32 with a chevron | `app.js`, `style.css` |
| Hamburger | EJS's top-right three-bar button (`.ejs_virtualGamepad_open`) now toggles our control bar; capture-phase interceptor suppresses EJS's own handlers | `app.js` `sswHamburger`, `__sswChromeToggle` |
| Preview audio | Home showcase clips unmute (they carry AAC game audio); `previewSound` pref + chip toggle; ducks the site music player to 12% while previewing | `app.js` `heroShowcase` |
| Invites | Shareable `…?join=<room>#/play/<sys>/<file>` link; "Copy invite link" in the sheet + picker; router consumes `?join` | `app.js` `npInviteLink`/`copyInviteLink`, router |
| Playable filter | "playable only" checkbox on Library + Browse console lists | `app.js` `routeLibrary`/`routeBrowse` |
| Pad presets | Per-console size/opacity/height presets, live preview, save-for-console / for-all; CSS vars `--pad-scale`, `--pad-opacity`, `--pad-bottom` | `app.js` `padLayoutPanel`, `style.css` |
| Accessibility | `:focus-visible` outlines, `prefers-reduced-motion`, tile `aria-label`s | `style.css`, `coverArt`/tiles |
| Backup | Export/Import now carries `settings` + `padPresets` | `app.js` `routeProfile` |
| Offline UI | "Saved for offline" per-console list on `#/cache`; `⤓ N offline` badge on console tiles; Play page shows cached count | `app.js` `romCacheBySys`, `consoleTile`, `routeCache`, `routePlaySystem` |
| Row notes | One-line explanation under home shelves | `app.js` `shelf({ note })` |
| Keyboard | Arrow keys rove focus across `a.tile`, Enter opens | `app.js` global keydown |
| Presence | Home "On the floor" Join button sets `ssw:joinNp` then deep-links into the room | `app.js` `routeHome` |
| Status page | `#/status` live checks (`/health`, `/np/health`, `/roms/health`) | `app.js` `routeStatus` |

### Gotchas discovered (worth remembering)
- **`#/play/...` route + `ssw:joinNp`** is how a guest auto-joins: set the LS key,
  then navigate. The play route reads it and calls `autoJoinNetplay` (~1.4 s
  after EJS start). Invite links exploit this via `?join=<room>`.
- **The native wrapper's `window.SSPlay`** only understands `"1"` (landscape) /
  `"0"` (portrait) and *ignores a repeat of its current state* — so forcing a
  change means posting the opposite first, then the target. See `goLandscape`.
- **EJS hamburger** is `.ejs_virtualGamepad_open` (three-bar SVG, top-right
  `top:5px;right:5px`), and its built-in handler only toggles EJS's *bottom*
  menu bar — useless under our touch pad. We repurpose it.
- **Overlays must mount via `uiRoot()`** (inside `.player`), not `document.body`,
  because `goLandscape()` fullscreens `.player` (Fullscreen API top layer).
- **EJS preview clips have AAC audio** — unmuting the `<video>` gives game music;
  autoplay-with-sound needs a user gesture, so start muted and unmute on first
  tap. Snaps live at `/gamevideo/<sys>/<file>` (faststart-remuxed cache).
- **`romaCache` IndexedDB keys** are `<sys>/<file>`; use `romCacheBySys()` for
  offline counts.
- **Version bump ritual** (§1 of AGENTS.md) is mandatory or clients keep the old
  bundle: `docs/sw.js` VERSION **and both** `?v=` in `docs/index.html`.
- **`deploy.sh` force-pushes `docs/` to `gh-pages`** (public mirror). The
  self-hosted server serves `docs/` live — editing it *is* the deploy there.

### Deploy / verify
```bash
cd /home/shadowswords/Work/shadowswords-gamelib
node --check docs/assets/app.js && node --check docs/sw.js   # always
./deploy.sh                                                  # build + push gh-pages
# self-hosted check:
python3 -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8710/index.html').read()[:150])"
```

### Open / next
- Everything I offered that's netplay-related is assigned in
  `FEATURE-BACKLOG.md` (voice chat, rollback netcode, role-aware host reconnect,
  lobby ping/ready, watch-party WebRTC video, native push invite).
- Unclaimed ideas from the same list: row explanations are done; still open —
  friends/presence list, "because you played X", game→OST linking, per-game
  save-conflict prompts, MAME/arcade notes.
- Offline UI is shipped; a *download queue* with progress persistence across
  navigation wasn't built (the per-console "Save all for offline" flow has its own
  progress dialog).

### Source-of-truth for frozen app contracts
`AGENTS.md` §5 (`window.SSMusic`, `#player-audio`, `#game`, `IN_APP` UA, PWA
manifest id, nav labels) and §12/§15 for netplay. Do not change those shapes
without coordinating a new APK.

_Last updated 2026-09-11 by the layout agent (Crush)._
