# AGENT-MEMORY.md — session log & handoff for future agents

Long-form memory for people/agents working on **RetroVerse**. `AGENTS.md` is the
operational rulebook; this file is the *why* and the *what-happened*, so a new
agent can pick up context without re-deriving it. Read `AGENTS.md` first, then
this. (Netplay internals: `NETPLAY-UI-CONTRACT.md`. Roadmap split:
`FEATURE-BACKLOG.md`.)

## Session 2026-09-13 — media reliability and diagnostics

- Added track-level search, genre filtering, persistent music favorites, volume
  control, and music requests in `docs/assets/app.js`; the Android bridge
  contract (`window.SSMusic`) is unchanged.
- Added IPTV source attribution/retry messaging and Music/IPTV checks to
  `#/status`.
- Cloud recovery saves now retry transient failures with backoff and record
  `ssw:lastCloudSave` metadata; save slots remain server-authoritative.
- Movie filters use compact themed controls; cache version is `2.73`.
- Remaining follow-up: live device validation of VLC URI handling and further
  save conflict UI (timestamps/origin comparison).

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
