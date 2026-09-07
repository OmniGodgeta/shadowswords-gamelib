# Changelog

All notable changes to the ShadowSwords Arcade website.

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
