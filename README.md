# shadowswords arcade

A **webRcade-style** browser for the whole ES-DE library on `shadow` —
~108 consoles, ~77k games, box art where it's scraped, console logos for every
system. Three sections:

- **Home / Browse** — every system, filter, search across all of them
- **Play** — 39 systems emulated in-browser via [EmulatorJS]; ROMs stream from
  the home server, or load-your-own with the file picker
- **Movies** — opens the Jellyfin library

Dark 10-foot UI, hash-routed vanilla JS, no frontend build step.

[EmulatorJS]: https://emulatorjs.org/

## Where it runs

| URL | Serves | Notes |
|-----|--------|-------|
| `https://shadow-1.tail51f9d6.ts.net/` | the arcade + ROMs (same origin) | **primary.** tailnet always; public if Funnel is on |
| `https://shadow-1.tail51f9d6.ts.net:8443/` | Jellyfin (movies) | ditto |
| `https://omnigodgeta.github.io/shadowswords-gamelib/` | public mirror (browse only) | Play needs Funnel; Movies needs Funnel |

The Android app (`~/Work/shadowswords`, another repo) is a WebView wrapper
pointed at the tailnet URL.

## Machine-side pieces (`shadow`)

| Piece | What |
|-------|------|
| `~/arcade-server.mjs` + `arcade-server.service` (systemd --user) | serves `docs/` at `/` **and** ROMs at `/roms/rom/<sys>/<file>` (Range + CORS + path-safety) from `127.0.0.1:8710`. Reads ROMs live from `~/Games/roms/`. |
| `~/setup-arcade-serving.sh` | `tailscale serve` the arcade on `:443` + Jellyfin on `:8443`; `tailscale funnel` both. Args: `lan` (no funnel), `off`. |
| `~/rom-server.mjs` | retired — replaced by `arcade-server.mjs`. |

One-time Tailscale enable (per node): `login.tailscale.com/f/serve?node=nbPLc1nrhS11CNTRL`
and `.../f/funnel?node=nbPLc1nrhS11CNTRL`.

## Rebuild + deploy

```sh
cd ~/Work/shadowswords-gamelib
python3 build.py     # regenerate docs/data + docs/media from ~/Games/roms + ~/ES-DE
./deploy.sh          # runs build.py, then force-pushes docs/ to the gh-pages branch
```

The self-hosted copy needs no deploy — `arcade-server` serves `docs/` live, so
`python3 build.py` alone refreshes it. `deploy.sh` is only for the public mirror.

`build.py` enumerates every directory in `~/Games/roms/` as a console, walks it
(2 levels, dedups format/region/disc variants, folder-of-few-files = one game),
merges metadata + box art from `~/ES-DE/gamelists/<sys>/` where it was scraped,
and pulls console logos from `~/ES-DE/themes/cathode-es-de/_inc/systems/logos/`.
Needs `python3` + ImageMagick.

`docs/data/` and `docs/media/` are **gitignored** — they're build output, not
source. `main` holds source; `gh-pages` holds the built site.

## Frontend config

`docs/assets/app.js`, top of file:

- `TS` — the tailnet base URL
- `ROM_BASE` — `/roms/` when self-hosted, `TS + "/roms/"` on the public mirror
- `MOVIES_URL` — Jellyfin (`TS + ":8443/"`)
- `EMU_DATA` — EmulatorJS CDN (`cdn.emulatorjs.org/stable/data/`)

Playable systems + their EmulatorJS core are in `EMU_CORE` in `build.py`
(`EJS_core` values, verified against EmulatorJS `getCores()` — get these wrong
and you get "error downloading core (X-legacy-wasm.data)"). Mirrored as
`PLAYABLE` in `arcade-server.mjs`; the frontend reads `core` / `playable` /
`bios` straight out of `data/systems.json`. **~44 playable systems.**

BIOS-dependent cores (FDS, Sega CD, PC-Engine CD, 3DO, Atari 5200, ColecoVision,
Neo Geo, Amiga, PC-FX) get their BIOS from `~/Games/bios` via
`/roms/bios/<file>` (`BIOS` map in `build.py`, `BIOS_OK` whitelist in the
server) and `EJS_biosUrl`.

**Cannot run in a browser** (no WASM core exists): PS2/PS3/PS4/PS5/Vita, PSP,
GameCube/Wii/Wii U, Switch/3DS, Xbox/360, Dreamcast/NAOMI/Model 2-3, Atari 800,
X68000, DOS. These stay browse-only — it's a hard EmulatorJS limitation.

## Console images

`build.py` fetches a photo of each console's actual hardware from Wikipedia
(batched `pageimages` API), cached in `.console-cache/` (gitignored). Wikimedia
rate-limits image downloads hard, so a fresh cache fills over 2-3 `deploy.sh`
runs; `.miss` files mark pages with genuinely no image. Falls back to the
cathode-theme wordmark logo (rendered white) when there's no photo.

## Controller support

EmulatorJS has full **Gamepad API** support — plug in a controller and it's
detected automatically; remap in its in-game settings menu (gear icon). Works
for keyboard too. The site's own menus are mouse/touch/keyboard (not yet
gamepad-navigable).

## Notes / limits

- No ROMs or BIOS in this repo (copyright). The server only exposes
  `~/Games/roms/` (for `PLAYABLE` systems) and the whitelisted BIOS files.
- `data/search.json` is ~6 MB (77k entries) — fetched once on first search.
- If `shadow` is off, Play (full library) and Movies are unavailable; the file
  picker still works anywhere.
