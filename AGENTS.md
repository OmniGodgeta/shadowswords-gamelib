# AGENTS.md — read this before touching RetroVerse

Operational notes for anyone (human or agent) working on this site. Architecture
lives in `README.md`; change history in `CHANGELOG.md`. This file is the stuff
that will bite you if you don't know it.

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

---
*Keep this file current. If you learn something the hard way, add it here.*
