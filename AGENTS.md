# AGENTS.md — read this before touching RetroVerse

Operational notes for anyone (human or agent) working on this site. Architecture
lives in `README.md`; change history in `CHANGELOG.md`. This file is the stuff
that will bite you if you don't know it.

**Companion docs:** `AGENT-MEMORY.md` (session log + the *why* behind recent
changes), `NETPLAY-UI-CONTRACT.md` (what netplay needs from the DOM), and
`FEATURE-BACKLOG.md` (roadmap ownership between agents).

---

## 1. The version-bump ritual — DO THIS on every `app.js` / `style.css` change

The service worker caches the app shell. If you change `docs/assets/app.js` or
`docs/assets/style.css` you MUST, in the same commit:

1. Bump `VERSION` in `docs/sw.js` (`ssw-vX.YZ` → next).
2. Bump **both** `?v=` query strings in `docs/index.html` (the `style.css` link
   and the `app.js` script — keep them equal to each other).
3. Add a `CHANGELOG.md` entry.
4. `git commit && git push`
5. `./deploy.sh` (pushes to the public mirror; the self-hosted copy is already
   live — see §2).

Skip the bump and users keep running the old bundle until a second reload, or
forever in the installed PWA / Android WebView.

The site version (`## [X.Y.Z]` in CHANGELOG), the SW `VERSION`, and the `?v=`
number are three different counters. Keep the SW `VERSION` and `?v=` in lockstep;
the CHANGELOG number moves independently.

## 2. Two deploy targets, different behaviour

| Target | URL | How it updates |
|---|---|---|
| **Self-hosted (primary)** | `https://shadow-1.tail51f9d6.ts.net/` | `~/arcade-server.mjs` serves `docs/` **live**. Editing a file in `docs/` IS the deploy. `python3 build.py` alone refreshes the data. |
| **Public mirror (browse-only)** | `https://omnigodgeta.github.io/shadowswords-gamelib/` | `./deploy.sh` runs `build.py` then force-pushes `docs/` to the `gh-pages` branch. ~30–60s GitHub Pages build lag after. |

`main` = source only. `docs/data/` and `docs/media/` are gitignored (build
output); `deploy.sh` copies the real files into its staging dir regardless.

Test on the self-hosted URL — it has everything (ROMs, stats, clip server,
Jellyfin). The mirror has no dynamic backend.

## 3. `~/arcade-server.mjs` is NOT in this repo

It's a standalone file on `shadow`, run as `arcade-server.service` (systemd
--user). It serves `docs/` + ROMs + the dynamic API (`/play/stats`, `/thumb/`,
`/gamevideo/`, `/emulatorjs/`, `/music/`, `/jellyfin/`, `/auth/`, …).

- Edits there are **live-only** — nothing in git records them. If you change it,
  note it in `CHANGELOG.md` and `systemctl --user restart arcade-server.service`.
- Some frontend behaviour is mirrored in both places (playable-system list,
  BIOS whitelist, `/data/` cache headers). Change one, check the other.

## 4. Public access (Funnel) is OFF and staying off

The owner's call (copyright, 2026-09-08). `tailscale serve` (tailnet-only) is
live; `tailscale funnel` (public) is not. Don't re-suggest Funnel unless the
owner raises it. The mirror is browse-only by design — Play/Movies need the
tailnet.

## 5. Frozen contracts with the Android app (`~/Work/shadowswords`)

The app is a WebView wrapper. These must not change shape without coordinating:

- `IN_APP` UA check — regex `/ShadowSwordsApp|RetroVerseApp/` in `app.js`.
- `window.SSMusic` (`{next,prev,toggle,play,pause,stop,seek,getState}`),
  `window.SSMediaBridge.update(json)`, the `ssmusic` `CustomEvent`.
- Player DOM ids: `#player`, `#player-audio`, `#game`.
- `window.__ssEjsBase` read behaviour (`emuData()`), `EJS_pathtodata`.
- `window.sswOfflineStats()`, `window.sswCores()`.
- PWA `manifest.json` `"id"` = `shadowswords-arcade` (kept through the rebrand
  so installed PWAs keep identity — change it and every install is orphaned).
- Top nav labels: Home / Play / Lounge / Library. Deep hashes `#/movies`
  `#/music` `#/videos` still work (Lounge children). Don't rename `#/play`.

## 6. Testing in the browser-automation tab — known lies

- Viewport is floored (~1280px, sometimes stuck narrower). `resize_window`
  reports success but the rendered viewport often doesn't follow. **Mobile
  breakpoints (`@media 720`/`900`) can't be visually verified here** — rule-parse
  + confirm desktop isn't broken, the owner checks phone layout.
- `<img loading="lazy">` frequently doesn't fire (tab not "visible"). To verify
  images resolve: set `loading='eager'` + re-assign `.src`, or `fetch()` the URL.
- `<video>` won't decode/play in the hidden tab. Verify clip features by DOM
  wiring + a `curl`/`fetch` of the media URL, not playback.
- The SW's HTTP cache is sticky across reloads. Force fresh:
  `for (const r of await navigator.serviceWorker.getRegistrations()) r.unregister();`
  `for (const k of await caches.keys()) caches.delete(k);` then `fetch(url,{cache:'reload'})`.

## 7. Data files (`docs/data/`, all build.py output)

| File | Shape | Notes |
|---|---|---|
| `systems.json` | `{systems:[{id,name,count,logo,photo,playable,core,bios,genres,withArt}], total}` | index; frontend reads `playable`/`core`/`bios` from here |
| `<sys>.json` | `[{id,name,file,year?,genre?,img?,desc?,…}]` | per-system, sorted by name. `img` = local `media/<sys>/<gid>.webp` OR a hot-linked `raw.githubusercontent.com/libretro-thumbnails/…` URL |
| `search.json` | `[[name,sys,gid,year,hasImg]]` | ~6 MB, 77k rows. `hasImg` is a 0/1 flag — **no image URL**, so you can't resolve a cover from here |
| `added.json` | `[[name,sys,gid,img,mtime]]` | "Recently added" — bucketed per system, art-first, ~10 systems round-robined (see build.py `write_discovery`) |
| `trending.json` | `[[name,sys,gid,img,count]]` | snapshot of live `/play/stats` at build time, so the mirror shows Trending too |
| `collections.json` / `franchises.json` | `[{id,title,note,items:[[name,sys,gid,img]]}]` | discovery shelves |
| `gamevideos.json` | `[{sys,file,name,gid,vid,img,year,play}]` | ES-DE preview snaps; ~12 systems; drives the hover previews + home showcase |
| `artgallery.json` / `videos.json` | — | showcase filmstrip / YouTube uploads |

## 8. Covers — how a tile gets its art (`app.js`)

- **`coverArt({img,name,sys,badge,fav,resolve,file,gid})`** is the single tile-art
  builder. Real `<img>` if `img`; else a generated **sleeve** (`.tile-art.noart`):
  console-tinted gradient (`--h` = `hue()`), the console hardware photo or
  wordmark ghosted behind (`.noart-bg`), title + system name. `gameTile` /
  `favTile` / `refTile` / the inline shelf builders all route through it.
- **`hydrateCovers(items,{save})`** — home/stats/saves shelves reference games
  whose per-system JSON isn't loaded, so they render sleeves first. This loads
  the referenced systems (capped, skips the huge home-computer sets) and swaps
  real art in. Pass `resolve` (an array) to `coverArt` to enrol a tile.
- **`hoverPreview(tile,art,sys,vid)`** — muted looping `<video>` on hover for
  Play lists. `HOVER_OK && SELF_HOSTED` gated, off in lite mode.

## 9. Playable systems

`EMU_CORE` in `build.py` maps sys → EmulatorJS `EJS_core`. These values are
verified against EmulatorJS `getCores()` — **make one up and you get "error
downloading core (X-legacy-wasm.data)"**. ~44 playable. The hard-blocked list
(no WASM core exists at all): PS2/3/4/5, Vita, PSP, GC/Wii/WiiU, Switch/3DS,
Xbox/360, Dreamcast/NAOMI/Model2-3, Atari800, X68000, DOS.

If you re-tune `_lr_loose()` (libretro fuzzy match) in build.py, `rm -rf
.lr-cache` or stale matches stick.

## 10. Open items (need the owner, not blockers)

- "welcome page icon be better organized on top" — unclarified since 2026-09-09.
- Custom domain (`DOMAIN.md`), MAME 2003-Plus romsets (`ARCADE.md`).
- `logo-lg.webp` — only used as the build source for `og.jpg` (manual), not
  referenced at runtime.
- Netplay: rollback/GGPO-style delay frames if fighting games still desync.
  Current path is input-forwarding over WebRTC (host P1, guest P2) — good on
  the tailnet, not lockstep. Optional host **Sync** sends a savestate.
- Netplay: more than 2 players; ICE TURN if someone is off Tailscale (they
  shouldn't be — Funnel is off).
- In-app: 🎮 / Netplay FABs vs EJS own settings gear overlapping on some cores.

**In-app chrome (2.22.0):** `html.in-app .bar` is **visible** (brand, ☰ menu, Sign in / avatar).
It is hidden only with `html.playing` while a game runs. Do not `display:none` the
header for all `in-app` — that's why users couldn't log in from the phone.

## 11. Exit (don't hang the player)

The ‹ Exit button must **not** `await` the cloud-save PUT or call
`EJS_emulator.pause()` / `getState()` — those freeze N64/PSX on the main
thread. `exitPlayer()` strips the overlay and `location.replace`s to `#/play`.
Android back button must call `window.exitPlayer`. EmulatorJS 4.2.3 fires
`exit` with nobody listening unless we hook it.

## 12. Netplay (as of 2.21.0) — READ THIS BEFORE TOUCHING IT

**Do not turn EmulatorJS netplay back on.** 4.2.3 lockstep is savestate-over-
Socket.IO, comments in their source say "control syncing - broken", guest
inputs stay on player 0, and every menu Start froze both clients.

**What we run instead** (see `NP` in `docs/assets/app.js`):

- Host taps **Netplay** (in-app: gold FAB, bottom-center) → `POST /np/room`
  then WebRTC `RTCPeerConnection` + datachannel. Host = player 0.
- Invite `POST /play/invite` **must include `room`** (the `/np/room` id).
- Guest taps **Join room** → `acceptInvite` → `npJoin(room)` which polls
  `GET /np/sig` and answers the offer. Guest = player 1.
- Inputs: wrap `gameManager.simulateInput` so local presses go to
  `functions.simulateInput(myP, …)` **and** `dc.send({t:'i',p,i,v})`.
- Signalling is **arcade-server** (`/np/room`, `/np/sig`), not `:8712`.
  Copy `~/arcade-server.mjs` ↔ `server/arcade-server.mjs` and restart
  `arcade-server.service` after changing it.

**Join-room bugs we already hit:**

- In-app player-bar is hidden (`transform: translateY(-110%)`). Anything
  the host needs (Netplay / Invite / Sync) **must be a FAB**, not only a
  `.pbtn` on `.player-bar`.
- If guest is **already in that game**, setting `location.hash` to the same
  play URL does nothing and `EJS_onGameStart` will not fire again. Join
  must call `npJoin` immediately (`acceptInvite` → `same` branch).
- Inviting before `npHost` produced `room: null`. `invitePicker` now
  creates the room first.

**How to test:** phone creates room + invites; PC (other account) Join
room while **already in the same game**; toast "Linked — you are Player 2";
P2 moves character 2, not P1.

## 13. Android app (`~/Work/shadowswords`)

Separate repo `OmniGodgeta/shadowswords`. WebView loads the live tailnet
site, so **site JS/CSS deploys without a new APK**. Rebuild the APK only
when Dart/Kotlin changes (landscape lock via `SSPlay`, in-app update
installer, last-game restore). Frozen contracts: §5.

Current APK: 1.6.3 (`v1.6.3` GitHub Release, `RetroVerse-1.6.3.apk`).

---
*Keep this file current. If you learn something the hard way, add it here.*

---

## Browser & App Netplay Fixes (2026-09-11) — Session Summary

**Issues fixed:**

1. **Browser Netplay controls were hidden** (RetroVerse v2.22.2)
   - **Root cause:** UI only showed Netplay/Create Room/Invite buttons when `SELF_HOSTED` was true (tailnet domain)
   - **Fix:** Removed the SELF_HOSTED gate; API requests still target the tailnet server
   - **Commits:** `35e2bf3` (shadowswords-gamelib)
   - **Testing:** Netplay controls now visible on both public (omnigodgeta.github.io) and self-hosted (shadow-1.tail51f9d6.ts.net) builds

2. **In-app Netplay button overlapped Start/Select controls**
   - **Root cause:** FAB positioned bottom-center, same zone as EmulatorJS touch pad
   - **Fix:** Moved to upper-right corner with safe-area insets
   - **Commit:** `a8aac2f` (shadowswords-gamelib)

3. **WebRTC room-join failures (ICE candidates before peer description)**
   - **Root cause:** Candidates arrived before remote SDP; RTCPeerConnection rejects them
   - **Fix:** Queue ICE candidates until remote description exists, then flush
   - **Commit:** `a8aac2f`

4. **App updater button does nothing** (RetroVerse v1.6.3+ → v1.6.4)
   - **Root causes:**
     - Permission flow opens settings, returns "needPermission", but doesn't retry automatically
     - Installer crashes (FileProvider/Intent errors) are silently caught and shown as generic "couldn't download" message
     - APK path not retained, so permission → grant → return to app = user must re-tap Install
   - **Fixes:**
     - Store APK path in `_pendingUpdatePath` field
     - Resume pending install in `didChangeAppLifecycleState(AppLifecycleState.resumed)`
     - Return structured error codes from Kotlin (e.g., "provider: FileNotFoundException", "installer: ActivityNotFoundException")
     - Display real installer error instead of generic message
   - **Commits:** `e0178a9` (shadowswords)

**Remaining work for next agent:**

- Test the app updater on a real device with unknown-app permission denied initially, then granted
- Verify release keystore signing (requires `android/key.properties`); debug-signed APKs cannot upgrade to release-signed or vice versa
- Consider adding logcat diagnostics for updater failures (currently only in-memory ring buffer)
- Test Netplay on actual tailnet: room creation, guest join, ICE connectivity, input sync
  (Do this only after Tailscale on `shadow` is stable — see §14.)

---

## 14. Tailscale stability on `shadow` (2026-09-11) — READ BEFORE “FIXING” NETPLAY

**Symptom agents mis-diagnose as netplay bugs:** phones lose
`https://shadow-1.tail51f9d6.ts.net/`, WebRTC signaling drops, toast
“Netplay disconnected”. Arcade + `/np/*` were fine; the tunnel was not.

**Root causes found on this host:**

1. **Broken WAN IPv6** — OS advertises IPv6 (`ipv6os=true`) but IPv6 routes
   fail (`network is unreachable`). `tailscaled` kept trying IPv6 DERP
   endpoints, flapped the Toronto relay (~30+/hour `no-derp-connection`
   errors), and clients dropped.
2. **Wi-Fi powersave** on `Helixx` / `wlp6s0` — brief disconnects make
   Tailscale re-STUN and can bounce DERP.
3. **Stale offline node** named `shadow` (8d+) vs live MagicDNS
   `shadow-1`. App/site must keep using `shadow-1.tail51f9d6.ts.net`.

**Hardening applied (do not revert without cause):**

| Change | Where |
|---|---|
| `TS_DEBUG_DISABLE_IPV6=true` | `/etc/systemd/system/tailscaled.service.d/ipv4.conf` |
| Wi-Fi powersave off | `nmcli connection modify Helixx 802-11-wireless.powersave 2` |
| App probes `/health` every 30s + reload on recovery | `shadowswords` commit `4ca0655` |
| `GET /health` → `{ok, uptime, timestamp}` | live `~/arcade-server.mjs` + repo `server/arcade-server.mjs` |

After apply: 90s window showed **0** DERP flaps (was oscillating every ~minutes).
Phone `s24-ultra-de-eric` stayed reachable; prefer same-Wi-Fi **direct**
`10.0.0.x` path when home (`tailscale ping s24-ultra-de-eric`).

**Checks before touching netplay JS again:**

```bash
systemctl is-active tailscaled arcade-server.service
tailscale status | head
tailscale netcheck | head -20
journalctl -u tailscaled --since '1 hour ago' | rg -c 'no-derp-connection.: error'  # want ~0
curl -sS https://shadow-1.tail51f9d6.ts.net/health
curl -sS https://shadow-1.tail51f9d6.ts.net/np/health
tailscale ping -c 3 s24-ultra-de-eric
```

Funnel stays **off** (§4). Don’t “fix” disconnects by re-enabling Funnel
or EmulatorJS `:8712` lockstep.

**File locations:**

| Repo | File | Change | Lines |
|------|------|--------|-------|
| shadowswords-gamelib | docs/assets/app.js | Netplay visibility gate removed, ICE queue added | 108, 189-201 |
| shadowswords-gamelib | docs/assets/style.css | FAB position changed | 1276-1278 |
| shadowswords-gamelib | server/arcade-server.mjs | /np/health endpoint added | 1078 |
| shadowswords | lib/main.dart | APK path retention + resume logic | 109, 436, 603, 615-621, 637-649 |
| shadowswords | android/app/src/main/kotlin/com/shadowswords/shadowswords/MainActivity.kt | Structured error codes | 122-138 |

**Build & test commands:**

```bash
# RetroVerse web (after changes)
cd /home/shadowswords/Work/shadowswords-gamelib
./deploy.sh

# RetroVerse app (after changes)
cd /home/shadowswords/Work/shadowswords
flutter pub get
flutter build apk --release  # requires android/key.properties
# or for debug:
flutter build apk --debug
adb install -r build/app/outputs/apk/debug/app-debug.apk
```

**Server status:**

- `arcade-server.service` (port 8710): running, serves site + netplay signaling
- `arcade-netplay.service` (port 8712): running, EmulatorJS relay (deprecated; we use WebRTC)
- Both auto-restart on boot via systemd `--user` units

All changes are live as of 2026-09-11T17:43 UTC.

---

## 15. Netplay UI layering + Player 2 input + state sync (2026-09-11) — READ BEFORE TOUCHING

**Symptom:** netplay sheet / invites / toasts "do nothing" or only appear after
quitting the game; Player 2 has no controls; host **Sync** toasts "Sync failed".

**Root causes:**

1. **Overlays behind a fullscreen game.** `goLandscape()` calls
   `requestFullscreen()` on `.player`. Under the Fullscreen API only that
   element's descendants render above it, so any `document.body` overlay
   (`#help-overlay`, `#invite-overlay`, `#toast`, `#ctrl-panel`) is hidden
   behind the canvas. **Fix:** mount UI via `uiRoot()` (`app.js`), which
   returns `.player` while `window.__emuUp`, else `document.body`. Use it for
   every overlay/toast append — do not append game UI to `document.body`.
2. **Guest joined mid-boot.** `npHookInput()` used to bail if
   `EJS_emulator.gameManager` wasn't ready yet, so a guest who joined while the
   ROM was still loading never got its `simulateInput` wrapper → Player 2 dead.
   **Fix:** `npHookInput()` now retries (up to ~20s) and is re-called from
   `EJS_onGameStart`.
3. **State sync too big for one datachannel message.** `resyncNetplay()` did a
   single `dc.send(state)`, but savestates dwarf the SCTP max message size
   (SNES ~0.4 MB, Genesis ~1 MB, NDS/PSX several MB) → `send` throws → “Sync
   failed”. **Fix:** `npSendState()` sends `{t:"sc",n}` then 16 KB chunks;
   `dc.onmessage` reassembles until `n` bytes, then `loadState`. Keep the legacy
   single-message path (`!NP.rxLen`) working. Do **not** go back to one `send`.
4. **ICE must include STUN.** We briefly ran host-only ICE (`NETPLAY_ICE = []`)
   on the theory that public STUN caused lag; that was wrong and it broke
   connectivity — browsers mDNS-obfuscate private IPs (100.x included) and those
   `.local` names do not resolve across the tailnet, so host-only ICE has no
   viable pair for a remote peer and the datachannel never opens ("Connecting as
   Player 2…" for 10s+). **Keep STUN** (`NETPLAY_ICE` = Google + Cloudflare);
   ICE still prefers a reachable direct host pair. If lag is a problem, add a
   TURN relay on `shadow` rather than removing STUN.
5. **Cores drift apart.** Two independent emulators sharing only inputs diverge
   within seconds. **Fix:** the host is authoritative — `NP.syncT` auto-pushes
   its state on link-up and every 6 s; the guest only applies. Toggle by editing
   the interval in `dc.onopen`, not by making the guest send state. NOTE: this
   only bounds drift; it does not eliminate it. Removing drift entirely needs a
   host-authoritative video stream or true frame-locked lockstep (EmulatorJS
   exposes `gameManager.getFrameNum()` + `Module.postMainLoop` if you go there).
6. **Interop / diagnostics.** `npLog()` appends to `window.__npLog` /
   `window.__npLast`; the Netplay sheet prints `diag role/pc/ice/dc/room/sent/recv`
   and the last event. Link handlers: `onicecandidateerror`,
   `oniceconnectionstatechange` (toast on `failed`), `onconnectionstatechange`
   (host re-pushes state on `connected`). Guest join retries once. Keep these
   when restyling — see `NETPLAY-UI-CONTRACT.md`.
7. **Host-authoritative video is now the default (v2.22.9).** The host builds a
   MediaStream with `EJS_emulator.collectScreenRecordingMediaTracks(canvas, 60)`
   (canvas video + a tap of the game's WebAudio) and `addTrack`s it in
   `npStartHostStream()` *before* the offer. The guest renders it in `#np-video`,
   mutes its own core, and only forwards presses (`npHookInput` sends `{p:1}`
   when `NP.video`). No state sync runs in this mode (`NP.syncT` gated on
   `!NP.video`). It falls back to the input-echo + 6 s resync path if capture
   fails or no track arrives. If you touch netplay, preserve `NP.video` plumbing
   and the `#np-video` overlay (guest controls pad must stay above it).
8. **Voice chat + RTT (v2.22.17).** Mic rides the same `RTCPeerConnection`
   (`npSetVoice()` → `getUserMedia` → `addTrack`; `onnegotiationneeded` set in
   `dc.onopen` re-offers when it toggles). Remote audio → `NP.remoteAudio` →
   `#np-remote-audio`. The host's game audio is a *separate* track from the video
   (video-only stream on `#np-video`), so the audio element plays game sound +
   voices. RTT = 2 s `{t:"ping"}/{t:"pong"}`, shown in `#np-live` and Diagnostics.
9. **Role-aware reconnect + ready gate (v2.22.18).** Host persists `ssw:hostNp`
   and, on game start after a reload/background, re-hosts the **same** room via
   `npHost({reuse})` (server `/np/room` accepts `reuse`). Guest auto-rejoins on
   link loss (`npScheduleReconnect`, ≤4 tries); host re-offers. `forgetSession()`
   (explicit Exit) clears `hostNp`; `beforeunload` does not, so a reloaded host
   does not become P2. Ready handshake: `{t:"ready"}`, shown as `✓ ready`.
   **Server change needs `arcade-server.service` restarted** (or just kill the
   node pid — the unit is `Restart=on-failure`).
10. **Push-to-talk + WebRTC watch party (v2.22.19).** PTT/mute: `npPTT` pref,
    floating `#np-ptt` (`MediaStreamTrack.enabled` toggle — no renegotiation).
    Watch party: `WNP` reuses the `/np/sig` room; host `wnpStartHost()` streams
    canvas + game audio, watcher `wnpStartWatch()` plays it; `/watch` entries
    carry a `room` field. The JPEG still-frame path is the fallback — keep it, or
    a watcher on a browser without the stream sees nothing.
11. **Native netplay invites (v2.22.20).** `notifyApp()` posts `{cid, origin, on}`
    to the app's `SSNotify` channel (load / `ssw-prefs` / `ssw-auth`). The app
    polls `/play/invites` natively while backgrounded and deep-links the join
    URL back. If you rename the channel or the payload keys, update
    `shadowswords/lib/main.dart` and `MainActivity.kt` together.

**Testing Player 2:** use a game with **simultaneous** 2P. DKC (SNES) is not
one — 1-Player ignores controller 2, and "2 Player Team" only hands control to
P2 via the in-game tag switch. Good picks: Super Mario Kart (battle), Bomberman,
Street Fighter II, Mario Party.

**Input mapping (unchanged, for reference):** host `myP=0`, guest `myP=1`; the
wrapper ignores EJS's local player index and sends the press as `myP`, applying
it to the same player number on both ends. **Sync is host→guest only** and is
manual (the **Sync** button); the guest never sends state back.
