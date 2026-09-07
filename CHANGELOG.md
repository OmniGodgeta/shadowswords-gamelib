# Changelog

All notable changes to the ShadowSwords Arcade website.

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
