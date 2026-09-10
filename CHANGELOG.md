# Changelog

All notable changes to the RetroVerse website.

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
