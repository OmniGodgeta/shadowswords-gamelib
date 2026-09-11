# Changelog

All notable changes to the RetroVerse website.

## [2.20.0] — 2026-09-11 — Real WebRTC netplay (P1/P2), pad spacing, in-app controls

### Changed
- **Netplay is ours now**, not EmulatorJS 4.2.3's broken lockstep. Host and
  guest get a WebRTC datachannel on the tailnet. Host is Player 1, guest is
  Player 2. Inputs go out as they happen — no savestate freeze on every
  menu. Optional **Sync** still ships a one-shot state if you drift.
- Face buttons are 48px in a diamond (X / Y / A / B no longer stacked).
- Home previews autoplay in the app. ROM drop line is just "Load a ROM file".
- In the Android app, **🎮** (bottom-right) opens the same visual controller
  editor as the desktop site — not EmulatorJS's old list.

### Internal
- `POST/GET /np/room` + `/np/sig` signalling. SW `ssw-v2.35`.

## [2.19.1] — 2026-09-11 — Bigger pad, press glow, netplay Start resyncs

### Changed
- On-screen buttons are ~50% larger; they **light up cyan** while held; the
  analog stick knob is cyan and moves with your thumb. Fast/Slow/Rewind
  extras on the pad are hidden.
- **Hide pad** sits in the **bottom-left** so it isn't under EmulatorJS settings.

### Fixed
- Host pressing Start no longer leaves the guest on the title screen: we
  skip cloud auto-load during netplay and the host's Start triggers a
  savestate sync so both land in the game. A **Sync** button is on the
  pull-down bar if you still drift apart (brief freeze is normal).

### Internal
- SW `ssw-v2.34`.

## [2.19.0] — 2026-09-11 — Real-time netplay, invites that land, landscape

### Fixed
- **Netplay delay.** Inputs were going over Socket.IO *polling* on `:8712`
  (WebSocket upgrade often failed across that extra port), so the other
  player saw your move seconds later. Signalling is now same-origin on
  `:443` (`/socket.io` + `/list` proxied to arcade-netplay). ICE is host-
  candidates only (Tailscale 100.x) — public STUN was picking a CGNAT path.
  Watch-party JPEG upload pauses while you're in a room.
- **Invites on mobile.** Poll every 3s (and on tab-focus) via
  `GET /play/invites`, match by account as well as device id, and **Join
  room** actually opens Netplay and sits in the host's room.
- **Fullscreen stays portrait on phones.** Game start / the Landscape
  button / the Fullscreen API now `orientation.lock('landscape')` and tell
  the Android wrapper to lock the activity.

### Added
- Cleaner frosted on-screen pad; **Hide pad** (bar + corner button in the app).
- Rejoin: if you kill the app or refresh mid-game, we put you back in the
  same title and try the netplay room for 15 minutes. Explicit ‹ Exit clears
  that. The Android app restores the last game hash the same way.

### Internal
- SW `ssw-v2.33`. `/socket.io` and `/list` are never cached.

## [2.18.0] — 2026-09-11 — Exit for real, invites, phone chrome

### Fixed
- **Exit actually leaves.** "Exiting…" used to hang because we still called
  EmulatorJS `getState()` / `pause()` on the main thread (N64/PSX freeze it).
  Exit now strips the overlay and does a hard navigation to `#/play` — no WASM
  calls. A second tap force-retries. Same path for hash changes and the
  Android back button.
- **Site "Reload" toast** no longer waits on a stuck service worker; it
  cache-busts the page after 300ms.

### Added
- **Invite anyone online.** Presence ping while browsing; **Invite** on the
  player bar lists everyone on the tailnet (playing or just hanging around)
  and sends them a Join / Watch card. `POST /play/invite`.
- **Android in-game chrome is gone.** The top bar hides; a tiny ‹ exits and a
  nub at the top pulls the controls down for a few seconds. The native app
  locks **landscape** while a game is running (the old "all orientations"
  setting is why EmulatorJS fullscreen came up portrait).

### Internal
- SW `ssw-v2.32`, assets `?v=2.32`.

## [2.17.0] — 2026-09-11 — The floor, not the catalog

Home was a pile of the same shelf eleven times. It's a cabinet floor now.

### Changed
- **Top nav is four items:** Home · Play · Lounge · Library. Movies / music /
  videos live under Lounge; every console, collection and franchise under
  Library. Favorites, saves, contact sit in the drawer and a compact dock
  at the bottom of Home — not a second wall of identical tiles.
- **Home keeps what you liked:** Continue playing, Play now (consoles),
  Trending. Dropped the random collections, franchises, "all consoles" and
  "More" dump that repeated the same games.

### Added
- **On the floor** — live "who's playing" cards with Play too / Join /
  Watch when a watch-party is up.
- **Two-player night** — curated couch & netplay picks (Kart, Smash,
  Bomberman, Streets of Rage, CTR…).
- **Watch party** — 👁 Watch on the player bar copies a tailnet link;
  `#/watch/<id>` spectates the canvas a few times a second. No public
  streaming, signalling stays on the tailnet.
- **Rewind / fast-forward** on the player bar (hold ⏪, toggle ⏩).
- **Per-game notes** — a Note chip when a title or core has a known
  quirk (BIOS, 4-player, romset version).
- **Save-state timeline** — cloud saves store a JPEG snapshot next to
  the state; the load picker and Saves page show the picture.
- **Phone player chrome** — bigger Exit, wrapping bar, scaled on-screen pad.

### Internal
- SW `ssw-v2.31`, assets `?v=2.31`.
- `arcade-server`: `/watch` rooms + frame PUT/GET, session pings carry
  sys/file/watch/netplay, save slots grow a `.jpg` sidecar.

## [2.16.0] — 2026-09-11 — Exit actually exits, netplay actually netplays

### Fixed
- **Exit from a game now works.** The ‹ Exit button awaited the cloud auto-save
  PUT; if that fetch stalled, the click did nothing and you were stuck. Exit
  now leaves immediately (save still fires in the background), shows
  “Exiting…”, and **Escape** does the same. The emulator's own exit button is
  hooked too — EmulatorJS 4.2.3 fired an `exit` event with nobody listening.

### Added
- **Netplay that shows up.** EmulatorJS 4.2.3 hides the globe unless
  `EJS_gameID` is a unique number *and* then still gates it behind debug
  flags. We now set a stable per-game id, STUN servers, force-enable the
  menu, and put a **Netplay** button on the player bar. Host / join a room
  with anyone on the tailnet running the same game.
- **`#/netplay`** — short how-to plus a live check of the signalling server
  (`arcade-netplay` on `:8712`). Linked from the Play page.
- Settings: toggle netplay, and a **Netplay name** (defaults to your account
  display name).

### Internal
- SW `ssw-v2.30`, assets `?v=2.30`.

## [2.15.1] — 2026-09-10 — AGENTS.md

### Added
- **`AGENTS.md`** — operational guide for anyone working on the site: the
  version-bump ritual, the two deploy targets, `arcade-server.mjs` (not in git),
  frozen contracts with the Android app, browser-automation testing gotchas,
  data-file shapes, the cover pipeline. `CLAUDE.md` + `README.md` + top-of-file
  comments in `app.js` / `style.css` / `sw.js` / `build.py` point at it.
- No behaviour change (SW `ssw-v2.29` / `?v=2.29` only because the header
  comments in `app.js` / `style.css` moved).

## [2.15.0] — 2026-09-10 — Hover previews, hardware-photo sleeves, varied "Recently added", trending snapshot

### Added
- **Gameplay-clip preview on hover** in the Play lists (`#/play/<system>`) —
  hover a tile and, where an ES-DE snap exists (`gamevideos.json`), a muted
  looping clip fades in over the cover. Self-hosted only (the mirror has no
  clip server); pointer devices only; off in lite mode.
- **Trending on the public mirror.** `build.py` writes `data/trending.json`
  (a snapshot of the live `/play/stats` list, with resolved cover art); the
  home page falls back to it when there's no stats server.
- Proper **social share image** — `assets/img/og.jpg` (1200×630, the neon
  wordmark on the dark ground), wired into `og:image` / `twitter:image`
  (were pointing at the square 512 icon, wrong for `summary_large_image`).
  Generated from the previously-unused `logo-lg.webp`.

### Changed
- **Art-less sleeves now use the console's hardware photo** as a faint
  luminosity-blended background where we have one (`noart-bg.photo`), falling
  back to the ghosted wordmark — more visual variety across systems.
- **"Recently added" is no longer a wall of one console.** A bulk ROM sync
  leaves near-uniform mtimes, so `build.py` now buckets per system, sorts
  cover-art-first within each, picks the ~10 systems with the most art among
  their recent additions, and round-robins ~6 deep. Result: a varied,
  mostly-covered shelf instead of 120 c64 rows (or one game from all 100
  systems).
- **BIOS / machine-variant dumps dropped library-wide**, not just from the
  shelf — `[BIOS] …` filenames (No-Intro convention) are skipped in the main
  scan (≈42 entries across c64/plus4/vic20/…).
- Reduced-motion users now get the staged reveal as an **opacity-only fade**
  (was: no animation at all).

### Internal
- SW `ssw-v2.28`, assets `?v=2.28`.
- `coverArt()` takes `photo`; new `hoverPreview()` / `gameVideoMap()` /
  `HOVER_OK`; `gameTile` takes `{previews}`; `tileGrid` threads it through.
- `build.py`: `game_index` `(sys,rel)->(gid,img,name)` + `write_trending()`.

## [2.14.0] — 2026-09-10 — Home & Play shelves: real covers, generated sleeves, assemble animation

### Changed
- **Every game tile now shows a cover.** Where we have box art it's used;
  where we don't, the tile draws a generated "sleeve" — console-tinted, with
  the system wordmark ghosted behind the title — instead of an identical dark
  box with just text. Kills the "same empty cases" look on Trending /
  Recently added / Continue playing / Play.
- **Covers are hydrated after render.** The home shelves reference games whose
  per-system data isn't loaded, so Trending / Continue playing / Recently
  added / Cloud saves / Stats used to fall back to placeholders even for games
  that *do* have art. `hydrateCovers()` now loads the referenced systems
  (capped, skips the giant home-computer sets) and swaps the real box art in;
  resolved art for "Continue playing" is written back to local storage.
- **Library "assemble" animation.** Tiles slide onto the shelf in sequence
  (staggered, capped; off in lite mode / reduced-motion).
- **"Show more" appends** instead of rebuilding the grid, so already-shown
  tiles don't re-animate.

### Fixed
- **BIOS / machine-variant dumps no longer swamp "Recently added".** ES-DE
  lists e.g. `[BIOS] Commodore 1541` as a c64 "game"; a fresh sync stamped
  them all recent and they filled the shelf. `build.py` now skips them there
  and caps any one system to 30 entries so the shelf stays varied.
- **Rebuilt browse data lands promptly.** `/data/*.json` was cached for an
  hour (`max-age=3600`); a `build.py` rebuild wasn't visible until it expired.
  Now `max-age=300, must-revalidate`, and the service worker revalidates
  `/data/` on every fetch (cheap 304 when unchanged). Box art (`/media/`)
  still caches hard.

### Internal
- SW `ssw-v2.27`, assets `?v=2.27`.
- New `coverArt()` / `hue()` / `hydrateCovers()` / `backfillRecent()` in
  `app.js`; `gameTile` / `favTile` / `refTile` / the inline shelf builders all
  route through `coverArt()`.

## [2.13.0] — 2026-09-09 — Rebrand: ShadowSwords Arcade → RetroVerse

### Changed
- **The site is now "RetroVerse".** New neon joystick logo in the header
  (`logo.webp`), new favicon + PWA/`apple-touch` icons (`icon-192/512/maskable`,
  `favicon.png`) cropped from the RetroVerse mark. `<title>`, meta/OG/Twitter
  tags, the hero kicker, every per-route `document.title`, the manifest
  `name`/`short_name`/`description`, and the SW banner comment all updated.
- PWA manifest `id` is **unchanged** (`shadowswords-arcade`) so existing
  installs keep their identity and just pick up the new name/icons.
- `IN_APP` UA check now also accepts `RetroVerseApp` (the renamed Android
  wrapper), still accepts `ShadowSwordsApp` for already-installed apps.
- Repo name, package/PWA id, cloud-save namespaces, Discord/socials and the
  tailnet URL are untouched.
- SW `ssw-v2.26`, assets `?v=2.26`.

## [2.12.0] — 2026-09-09 — Update prompt + hero overlay fixes

### Fixed
- **"New version → Reload" now works.** The old prompt reloaded before the new
  version took control, so nothing changed. Now: Reload shows "Updating…" +
  a progress bar, waits for the new version to activate, then reloads (5s
  safety fallback). Re-prompts if an update was left pending; checks on
  tab focus + hourly.
- **Shadow over the home preview.** A decorative gradient overlay sat on top
  of the preview area with no `pointer-events: none` — it dimmed the clip and,
  on phones, blocked taps on the Preview / Box-art toggle. It's now
  click-through everywhere and removed entirely on phones; on desktop it's
  just a faint left-edge fade for title legibility.
- Header no longer casts a pink drop-shadow onto the top of the preview.

## [2.11.0] — 2026-09-09 — Home hero reorg

### Changed
- Home hero: **Play now** and **Surprise me** only, sitting right above the
  preview; the mode toggle is smaller and moved **below** the title/actions,
  and flows under the clip on phones.
- **Browse all** moved off the home page — it's now on the **Play** page
  ("Browse all games") next to "Pick a ROM file".

## [2.10.0] — 2026-09-09 — Mobile polish

### Changed
- **Mobile menu** — "Offline & cache" moved out of the drawer into
  Settings (where it belongs); a divider now separates the nav links from
  the account link.
- **Profile card on phones** — the name / handle / buttons were colliding;
  the card now stacks cleanly (avatar + name on top, full-width buttons
  below) and the name field no longer clips.
- **Home hero on phones** — smaller title, 2-line blurb, and much smaller
  Play / Surprise me / Browse all buttons + SHOWCASE toggle, so the game
  preview clip is visible without scrolling.

## [2.9.0] — 2026-09-09 — Home showcase, neon pass, layout fixes

### Added
- **Home showcase** — the hero now rotates through **gameplay preview clips**
  (from the ES-DE video snaps, streamed and remuxed faststart on the fly by the
  self-hosted server) with the game name + a Play/View button. A **SHOWCASE
  slider** flips it to a **box-art gallery** — an era-ordered filmstrip of
  covers from Atari 2600 through the modern systems, each linking straight to
  the game. Falls back to art-only on the public mirror (no video server).

### Changed
- **Neon-retro colour pass** — deeper blacks, more saturated cyan/magenta,
  stronger glow on interactive elements, a subtle CRT vignette + phosphor tint.
- Opaque panel background token — fixes panels bleeding through on scroll.

### Fixed
- **Music page overlap on phones** — the album column was a sticky overlay that
  the track list scrolled *underneath*; it now scrolls with the page.
- **Contact page** — long social URLs overflowed their cards and collided with
  neighbours; they truncate now, and the grid reflows 3→2→1 columns.

## [2.8.0] — 2026-09-09 — Visual controller setup

### Added
- **Controller setup panel** — a new 🎮 button in the player bar opens a
  redesigned control screen that replaces EmulatorJS's plain list:
  - A **live controller diagram** that lights each button as you press it,
    from the Gamepad API or a held keyboard key — so you can see exactly which
    input you're about to map.
  - **Click any button** (on the diagram or in the list) then press a key *or* a
    gamepad button to rebind it; Esc cancels.
  - Per-console layouts — a SNES pad shows A/B/X/Y + shoulders, an NES pad shows
    just A/B, PlayStation shows ✕○□△, etc. P1–P4 tabs. "Reset to defaults".
  - Bindings save per game (EmulatorJS's own storage) and apply immediately;
    the game pauses while the panel is open.

## [2.7.0] — 2026-09-08 — Metadata, save slots, public profiles, admin

### Added
- **Game metadata for ~35 more systems** — genre, year, player count, developer,
  publisher and franchise pulled from the libretro database for the cartridge
  consoles ES-DE never scraped (NES, SNES, Genesis, Game Boy, PC Engine, Atari,
  WonderSwan, Neo Geo Pocket, ColecoVision, MSX and more). Filters, sorting,
  collections and "2+ players" now work across far more of the library.
  (Home-computer and disc collections still have no free metadata source.)
- **Named save slots** — the ☁ Save button has a "＋" for a named slot ("before
  boss", "co-op run"), and ☁ Load opens a slot picker with delete. Auto-save and
  auto-resume still use the "auto" slot.
- **Public profiles** — turn on "Public profile" in settings and your avatar,
  name and most-played games are visible at `/#/u/<name>`.
- **Admin panel** (`#/admin`, owner only) — review and clear the game-request
  and broken-report queues, open/close registration, and post a **site-wide
  banner** (info / warn / hype).
- **"Playing right now"** on the Stats page — who's in a game (signed-in users).
- **Accent colour** picker in settings — cyan / pink / green / orange / purple /
  gold.
- A proper "page not found" screen for bad links.
- More box art — MAME, DOS, FBNeo, and a looser name-match added a few thousand.

### Changed
- Cloud saves are stored per-game-per-slot; existing saves migrated to "auto".
- Game requests are now stored (and shown in the admin panel), not just relayed
  to Discord.
- The server prunes its emulator / thumbnail / album-art disk caches hourly.
- **RetroAchievements** was investigated and dropped — the stable EmulatorJS
  build has no support for it, and moving to the nightly channel would break the
  offline-play caching. Revisit if EmulatorJS backports it.

## [2.6.0] — 2026-09-08 — Accounts & profile settings

### Added
- **Accounts** — create a username + password, and your **cloud save-states,
  favorites and settings are tied to your account** and follow you to every
  device. Sign in from the account chip in the header or `#/login`.
  - Cloud saves are now stored per-account (`states/<user>/…`). Pre-account
    saves still work — they live in a shared pool everyone can read, and any
    old save you had still resumes until you make a fresh one.
  - Registration is open to anyone on the tailnet; set
    `"registration": "closed"` in the server config to lock it to existing
    accounts.
- **Profile & settings page** (`#/profile`) — avatar (emoji), display name,
  change password, sign out, plus:
  - **Emulator video filter** — pixel-perfect / smooth / CRT-scanlines
  - **Prefer game region** — USA / Europe / Japan (used by "Surprise me")
  - **Auto-resume cloud saves** — load your last save when you open a game
  - **Shuffle albums by default**
  - **Lite mode** (moved here from the footer)
  - **"People playing now" popups** on/off
  - **Confirm before overwriting a cloud save**
  - Settings sync to your account; when signed out they're per-device.
- Account chip in the header showing your avatar + name.

### Security
- Passwords hashed with scrypt; sessions are signed HMAC tokens (45-day),
  stored only in your browser. Auth endpoints are rate-limited.

## [2.5.0] — 2026-09-08 — Music player rework

### Added
- **Proper play queue.** "Play" or "Shuffle" an album builds a real queue you
  can see ("Up next"), reorder into, and jump around. Shuffle keeps the current
  track and reshuffles the rest; turning it off restores album order.
- **Shuffle album** button on every album (next to Play), plus **Shuffle
  everything** across the whole library.
- **Repeat** — off / repeat album / repeat one track, toggled from the player.
- **Seekable progress bar** with elapsed / total time in the mini-player.
- **Artist / album split** — album folders like "AC-DC - Discography…" now show
  the artist separately, in the list, the header, and (importantly) in the
  `mediaSession` metadata — so a **car's Bluetooth display and steering-wheel
  next/previous buttons** show the right artist and work. Also wired
  `seekforward` / `seekbackward` / `setPositionState` for car head-units.
- **Filter box** for the album list.
- Now-playing album is marked in the list.

### Changed
- The music section is reorganised: searchable album column, album header with
  artwork + artist + Play/Shuffle, queue, then track list.

### Added
- **Trending shelf** on the home page — the games people actually played this week.
- **Movies: "Continue watching" + "Just added"** rows at the top of the Movies
  page (Jellyfin resume state + newest-first).
- **Album art** — the music section now shows real cover art (folder image or
  embedded ID3/FLAC), in the album list, the album header, and the mini-player.
- **Lock-screen / notification music controls** — the mini-player drives the
  `mediaSession` API (metadata, artwork, play/pause/prev/next/seek), so the
  installed app and OS media keys control playback and it survives backgrounding.
- **"Save all for offline"** on cartridge consoles (NES, GB/GBC/GBA, Genesis,
  SMS, PCE, Atari, WonderSwan…) — bulk-downloads the whole system into the
  browser ROM cache so it plays with no server. Capped, cancellable.
- **Report a problem** — a ⚑ button in the player logs broken games to the
  server (and pings Discord for the first few reports).
- **Stats page** (`#/stats`) — most played and reported-problem games across
  everyone.
- **Unified search** — the results page now also shows matching movies.
- **Server-unreachable banner** — clear "browse-only mode" notice when off the
  tailnet, instead of features failing silently.
- **Export / import** your favorites, recently-played and playtime as JSON
  (Profile page).
- **Rate limiting** on all write endpoints, and an **optional access token**
  (`writeToken` in the server config + a field on the Offline page) that gates
  save-states, requests and reports — set it before exposing the instance
  publicly with Funnel.

### Fixed
- Service worker never caches the dynamic API paths (added `/music/art`).

## [2.3.0] — 2026-09-08 — In-site movie browser

### Added
- **Movies is now a real in-site browser** — a poster wall of the whole Jellyfin
  library (2,500+ films) with search, genre filter, and sort (A–Z / newest /
  recently added / shuffle / top rated). Click a poster for a detail card
  (backdrop, runtime, rating, synopsis) and "Play in Jellyfin". Falls back to
  the plain link-out when the Jellyfin key isn't set or you're off the tailnet.
- **Request-a-game form is live** — posts straight to the Discord.

### Fixed
- Service worker no longer caches any of the dynamic API paths
  (`/jellyfin`, `/emulatorjs`, `/thumb`, `/play`, `/twitch`, `/discord`,
  `/search`, `/request`) — a stale "not configured" response could stick.

## [2.2.0] — 2026-09-08 — Box art everywhere, collections, discovery, streamer bits

### Added
- **Box art for ~34,000 games** (was ~4,000). `build.py` now hot-links
  box art from the [libretro-thumbnails](https://github.com/libretro-thumbnails)
  repos by name-match when ES-DE has nothing scraped — no extra storage, 44% of
  the whole library now has art (ZX Spectrum, X68000, TIC-80, Amiga, Vic-20,
  Atari 8-bit and dozens more went from nothing to near-complete).
- **Collections** (`#/collections`) — auto-built by decade and genre, plus a
  "Multiplayer" set and hand-curated lists (Couch co-op, Pick-up-and-play,
  Halloween night, Weekend RPGs). Cover mosaics, three rotate onto the home page.
- **Franchises** (`#/franchises`) — Mario, Zelda, Sonic, Final Fantasy, Mega Man
  and ~35 more, grouped across every system, ordered by year.
- **Recently added** shelf on the home page (newest ROM files by mtime).
- **Filters** on every console page — era, genre, "box art only", "2+ players",
  plus the existing sort. Filename year/region parsing fills the gaps where
  there's no gamelist.
- **Search autocomplete** — a live dropdown under the search box; ↑/↓/Enter to
  pick. Self-host uses a server-side search endpoint instead of the 6 MB index.
- **Persistent music mini-player** — a bottom bar that keeps playing as you
  browse, with prev/next, shuffle, "shuffle all", a neon spectrum visualizer on
  the Music page, and OS media-key support.
- **Self-hosted EmulatorJS** — the self-host now proxies and caches
  `cdn.emulatorjs.org` at `/emulatorjs/`, so Play works with no CDN dependency
  and can run offline once cached.
- **Cloud auto-save** — the emulator state is pushed to the server every 3
  minutes and on exit, on top of the manual ☁ Save. `#/resume/…` still
  auto-loads it.
- **Screenshot & cheats** buttons enabled in the emulator menu;
  RetroAchievements login enabled where the build supports it.
- **Twitch "🔴 LIVE" badge** in the header when
  [twitch.tv/shadowswords](https://twitch.tv/shadowswords) is streaming (via
  decapi.me, no API key).
- **Request-a-game form** on the Contact page → posts to a Discord webhook
  (set `discordWebhook` in `~/.config/ssw-arcade/config.json`).
- **Live Discord counts** on the Contact page (members / online now).
- **"Playing now" counter** — a heads-up when other people are in a game.
- **Profile page** (`#/profile`) — browser playtime, games launched, favorites,
  systems touched, cache size.
- **Keyboard shortcuts** (`/`, `g h/p/m/v/f`, `r`, `l`, `?`) with a help overlay.
- **Lite mode** — drops the scanlines, glows and animations for low-end devices;
  respects `prefers-reduced-motion`. Toggle in the footer or with `l`.
- **PWA update prompt** — "New version available — reload" when the service
  worker finds an update.
- Per-route page titles; Open Graph / Twitter card meta for shared links.
- In-app link handling: the native wrapper's `ShadowSwordsApp` UA drops the
  "opens in a new tab" affordance.

### Server (`arcade-server`)
- New endpoints: `/emulatorjs/*` (caching CDN proxy), `/search`, `/play/ping`
  + `/play/stats`, `/twitch/status`, `/discord/info`, `/request` (Discord
  webhook), `/jellyfin/*` (proxy, config-gated). Config file:
  `~/.config/ssw-arcade/config.json`.

## [2.1.0] — 2026-09-08 — Cache, favorites, cloud saves, PWA, netplay

### Added
- **Browser ROM cache** — a downloaded ROM is kept in IndexedDB (1.5 GB budget,
  oldest evicted first), so the second launch of a game is instant and works
  offline. Shows a real download-progress bar while fetching, and "Loaded from
  cache" on a hit. New **Offline & cache** page (`#/cache`) shows usage and has a
  Clear button.
- **Favorites** — a ♥ on every game tile (localStorage). New **Favorites** page
  (`#/favorites`) and a home-page shelf.
- **Continue playing** — the home page now has a shelf of the last 24 games you
  launched; each resumes straight into the emulator.
- **Cloud save-states** — an **☁ Save** / **☁ Load** pair in the player bar
  pushes/pulls the emulator state to the home server
  (`~/.local/share/ssw-arcade/states/`). New **Cloud saves** page (`#/saves`)
  lists every server save with a one-click **Resume**; opening a game from there
  auto-loads its state. Play on your phone, finish on the PC.
- **Netplay** — EmulatorJS netplay is wired to a self-hosted signalling server
  (`arcade-netplay`, `express`+`socket.io`, tailnet `:8712`). The netplay button
  appears in the emulator menu; disable with `localStorage['ssw:netplay']='off'`.
- **Installable PWA** — `manifest.json` + service worker + app icons. "Install" /
  "Add to Home Screen" gives a full-screen app; the shell and browse data work
  offline. Home-screen shortcuts for Play / Favorites / Cloud saves / Surprise me.
- **Controller navigation for the menus** — a connected gamepad now drives focus
  around the site itself (D-pad / left-stick to move, A to select, B to go back),
  not just in-game.
- **Random game** — "🎲 Surprise me" on the home hero (any playable system) and
  "🎲 Random game" on each console's Play page.
- `DOMAIN.md` (how to point a real domain at the site) and `ARCADE.md` (how to
  get arcade romsets to actually load).

### Changed
- ROM downloads for catalog games now go through the cache layer with a progress
  bar instead of EmulatorJS's opaque loader.
- `arcade-server` gained `PUT/GET/DELETE /states/<sys>/<rom>` and
  `/states/list`; the systemd unit now grants write access to just
  `~/.local/share/ssw-arcade`.
- Nav gained **Favorites** and **Saves**; the mobile drawer also has
  **Offline & cache**.

## [2.0.0] — 2026-09-08 — Neon retro + Music / Videos / Contact

### Added
- **Neon-retro redesign** — dark UI with a scan-line CRT overlay, animated grid
  background, cyan/pink neon accents and glows throughout.
- **ShadowSwords neon logo** in the header (replaces the text wordmark).
- **Music** section (`#/music`) — browses albums from the home Music drive,
  streams tracks in-browser (FLAC/MP3/M4A/OGG…), sequential auto-play, sticky
  now-playing bar. Served by `arcade-server` at `/music/`.
- **Videos** section (`#/videos`) — the latest 15 uploads from the
  [@shadowswordsttv](https://www.youtube.com/@shadowswordsttv) YouTube channel,
  embedded. Refreshed from the channel RSS on every build (`data/videos.json`).
- **Contact** section (`#/contact`) — Facebook, Instagram, YouTube, TikTok, X,
  Rumble, and a Discord call-to-action.
- **Console hardware photos** — ~80 systems now show a photo of the actual
  console (Wikipedia), with the neon wordmark logo as the fallback.
- **BIOS support** for disc / BIOS-locked cores — FDS, Sega CD, PC-Engine CD,
  TurboGrafx-CD, 3DO, Atari 5200, Atari 7800, ColecoVision, PC-FX, Neo Geo,
  Satellaview (BS-X), PSX. Served from the RetroBat BIOS pack via `/roms/bios/`
  and passed to EmulatorJS as `EJS_biosUrl`.
- **More box art** — the build now also pulls art from
  `~/ES-DE/downloaded_media/` (N64, PSX freshly scraped) and ROM-adjacent
  `media/boxes` folders on the game drives.
- Mobile nav drawer (☰) for the new sections.

### Fixed
- **PC Engine CD / Sega CD "Network Error"** — the ROM server rejected the
  hand-curated symlink-farm systems (`pcecd`, `segacd`, …) as a path escape.
  It now resolves the *system* directory only and follows game symlinks.
- Stale-CSS caching (`no-store` on HTML/JS/CSS from the self-host server).
- `el()` helper crashed on `dataset` — needed by the music track list.

### Changed
- **Playable systems: ~44.** `sufami` (Sufami Turbo) removed — it needs a base
  cartridge subsystem load EmulatorJS can't do.
- Arcade systems (CPS1/CPS2/MAME/Neo Geo) now show a "romset version" heads-up —
  EmulatorJS's FBNeo/MAME build needs romsets matching *its* version, which is
  usually not what a modern collection ships. Not fixable server-side.
- Amiga flagged as experimental (PUAE rarely boots ADF/WHDLoad in-browser).

### Known limits
- **No browser core exists** for PS2/PS3/PS4/PS5/Vita, PSP, GameCube/Wii/Wii U,
  Switch/3DS, Xbox/360, Dreamcast/NAOMI/Model 2-3, Atari 800, X68000, DOS —
  these stay browse-only.

## [1.1.0] — 2026-09-07 — Full library + self-hosting

### Added
- `build.py` now enumerates **every** system under `~/Games/roms` (~108
  consoles / ~77,000 games), not just the 38 that were scraped into gamelists.
- Console logos for every system (cathode ES-DE theme), rendered white.
- **Self-hosted** at `https://shadow-1.tail51f9d6.ts.net/` via `arcade-server.mjs`
  + `tailscale serve` — the site and the ROM files are one origin (no CORS).
- **Play** section — NES, SNES, GB/GBC/GBA, N64, DS, Genesis/32X, Master System,
  Game Gear, PC Engine, Atari 2600/7800, Lynx, Jaguar, WonderSwan, Neo Geo
  Pocket, Virtual Boy, ColecoVision, C64/VIC-20, PSX and more via EmulatorJS.
  ROMs stream from the home server or load-your-own via file picker.
- **Movies** link to the Jellyfin library (Tailscale, port 8443).
- GitHub Pages moved to a `gh-pages` branch (built by `./deploy.sh`); generated
  `docs/data` + `docs/media` are gitignored.

### Changed
- Redesigned to a webRcade-style 10-foot UI (later superseded by the neon look).

## [1.0.0] — 2026-09-07 — First release

- Static webRcade-style gallery of the ES-DE library on GitHub Pages.
- `build.py` reads gamelists + scraped art, emits a hash-routed vanilla-JS SPA.
- ~4,350 games across 38 systems.
