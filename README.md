# shadowswords — game library site

A static, browsable web gallery generated from the local **ES-DE**
(EmulationStation Desktop Edition) library. Pick a system, filter/sort, search
across every system, click a game for art + full metadata. Dark/light, works on
mobile, no server or build toolchain — plain HTML/CSS/JS.

**Live:** https://omnigodgeta.github.io/shadowswords-gamelib/

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

## Notes / limits

- Only art actually present on disk is included; videos and manuals are skipped
  to keep the site light. Games with no art show a placeholder.
- `data/search.json` (~340 KB) is fetched once on the first search.
- Regenerate and redeploy whenever the ES-DE library changes — the site is a
  snapshot, it does not read ES-DE live.
