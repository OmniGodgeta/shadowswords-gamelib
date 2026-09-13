# AGENT-MEMORY.md — session log & handoff for future agents

Long-form memory for people/agents working on **RetroVerse**. `AGENTS.md` is the
operational rulebook; this file is the *why* and the *what-happened*, so a new
agent can pick up context without re-deriving it. Read `AGENTS.md` first, then
this. (Netplay internals: `NETPLAY-UI-CONTRACT.md`. Roadmap split:
`FEATURE-BACKLOG.md`.)

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
