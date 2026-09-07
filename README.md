# shadowswords — arcade

A static, browsable **webRcade-style** gallery of the local **ES-DE** library:
hero banners, horizontal carousels, dark 10-foot UI. Three sections:

- **Home / Consoles** — browse 4,350 games across 38 systems (art from ES-DE scrape)
- **Play** — NES & SNES in-browser via [EmulatorJS]; ROMs stream from the home
  ROM server over Tailscale, or load-your-own via file picker
- **Movies** — opens the Jellyfin library (also via Tailscale)

Plain HTML/CSS/JS, no build toolchain for the frontend.

**Live:** https://omnigodgeta.github.io/shadowswords-gamelib/

[EmulatorJS]: https://emulatorjs.org/

## Play section — the moving parts

| Piece | Where | What |
|-------|-------|------|
| `~/rom-server.mjs` | `shadow`, `127.0.0.1:8710` | read-only NES/SNES ROM + `catalog.json` server, CORS + Range. systemd user unit `rom-server.service`. |
| `tailscale serve` | `shadow` | fronts Jellyfin at `:443`, the ROM server at `:8443`, with real HTTPS certs |
| `tailscale funnel` | `shadow` | makes both public (so non-tailnet visitors can play) |
| `~/setup-arcade-serving.sh` | `shadow` | one command to wire serve+funnel up (`off` / `lan` args) |
| `MOVIES_URL`, `ROM_BASE` | `docs/assets/app.js` | the two URLs the frontend points at — change here if the node/tailnet changes |

The ROM catalog is derived live from `~/Games/roms/{nes,snes}/`; no ROMs are in
this repo (copyright — GitHub would DMCA them). If `ROM_BASE` is unreachable the
Play section still works with the file picker.

```
build.py          generator: reads ~/ES-DE, writes docs/data + docs/media
docs/             the deployable static site  <-- GitHub Pages serves this
  index.html
  assets/         style.css, app.js  (hand-written, not generated)
  data/           index.json, search.json, <system>.json   (generated)
  media/          optimised .webp art                       (generated)
```

## Rebuild after scraping more games in ES-DE

```sh
cd ~/Work/shadowswords-gamelib
python3 build.py                # full rebuild (wipes docs/data + docs/media)
python3 build.py --keep-media   # faster: keep already-converted images
git add -A && git commit -m "refresh library" && git push   # redeploys Pages
```

Needs `python3` and ImageMagick (`magick`). It reads:

- `~/ES-DE/gamelists/<system>/gamelist.xml` — metadata
- `~/ES-DE/downloaded_media/<system>/…` — ES-DE's own scraped art
- `~/Games/roms/<system>/…` — ROM-adjacent art referenced by the gamelists
  (the game drives must be mounted, or those systems just get no art)

Current output: ~4,350 games across 38 systems, ~3,650 with art, ~110 MB.

To add a prettier name for a system, edit `SYSTEM_NAMES` in `build.py`.

## Deploy

Already wired up: repo `OmniGodgeta/shadowswords-gamelib`, GitHub Pages set to
*Deploy from a branch* → `main` / `/docs`. Every `git push` to `main`
redeploys. `.nojekyll` is in `docs/` so the build is served as-is.

The site uses hash routing (`#/s/atari2600`), so it needs no SPA redirect rules
and works fine from the `/shadowswords-gamelib/` subpath.

### Preview locally

```sh
cd ~/Work/shadowswords-gamelib/docs && python3 -m http.server 8765
# open http://localhost:8765/
```

### Custom domain

`shadowswords.xcom` is not a real top-level domain, so it can't be pointed
anywhere as-is. Register something real (e.g. `shadowswords.com`, or a
`.gg` / `.games` / `.dev`), then in repo **Settings → Pages → Custom domain**
enter it — GitHub writes a `docs/CNAME` file. At the registrar:

- apex domain (`example.com`): four `A` records to GitHub's Pages IPs
  (185.199.108–111.153) plus an `AAAA` set, per GitHub's docs.
- `www` subdomain: a `CNAME` record → `omnigodgeta.github.io`.

## First-time serving setup (Play + Movies)

On `shadow`, one-time, click **Enable** on each (opens the Tailscale account):

- Serve:  `https://login.tailscale.com/f/serve?node=nbPLc1nrhS11CNTRL`
- Funnel: `https://login.tailscale.com/f/funnel?node=nbPLc1nrhS11CNTRL`

Then:

```sh
~/setup-arcade-serving.sh          # serve + public funnel for Jellyfin + ROM server
~/setup-arcade-serving.sh lan      # tailnet-only (no public funnel)
~/setup-arcade-serving.sh off      # tear down
```

`rom-server.service` (systemd --user) starts the ROM server on boot.
⚠️ Public funnel exposes the full commercial ROM library to the internet from
this machine — that is ROM distribution; keep it `lan` if that's a concern.

## Notes / limits

- Frontend is dark-only (webRcade style); the old light theme + modal were removed.
- Only art actually present on disk is included; NES/SNES have none, so Play tiles
  and no-art games use a styled name placeholder.
- `data/search.json` (~340 KB) is fetched once on the first search.
- Regenerate + `git push` whenever the ES-DE library changes — the browse data is
  a snapshot. The Play catalog *is* live (read from disk each request).
