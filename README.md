# shadowswords — game library site

A static, browsable web gallery generated from the local **ES-DE**
(EmulationStation Desktop Edition) library. Pick a system, filter/sort, search
across every system, click a game for art + full metadata. Dark/light, works on
mobile, no server or build toolchain — plain HTML/CSS/JS.

```
build.py          generator: reads ~/ES-DE, writes site/data + site/media
site/             the deployable static site  <-- this is what you host
  index.html
  assets/         style.css, app.js  (hand-written, not generated)
  data/           index.json, search.json, <system>.json   (generated)
  media/          optimised .webp art                       (generated)
```

## Rebuild after scraping more games in ES-DE

```sh
cd ~/Work/shadowswords-gamelib
python3 build.py                # full rebuild (wipes site/data + site/media)
python3 build.py --keep-media   # faster: keep already-converted images
```

Needs `python3` and ImageMagick (`magick`). It reads:

- `~/ES-DE/gamelists/<system>/gamelist.xml` — metadata
- `~/ES-DE/downloaded_media/<system>/…` — ES-DE's own scraped art
- `~/Games/roms/<system>/…` — ROM-adjacent art referenced by the gamelists
  (the game drives must be mounted, or those systems just get no art)

Current output: ~4,350 games across 38 systems, ~3,650 with art, ~110 MB.

To add a prettier name for a system, edit `SYSTEM_NAMES` in `build.py`.

## Deploy

The site uses hash routing (`#/s/atari2600`), so **no SPA redirect rules are
needed** and it works from any subfolder.

### Netlify (drag & drop — no account command line)

1. Go to https://app.netlify.com/drop
2. Drag the **`site/`** folder onto the page.
3. It gets a random `*.netlify.app` URL immediately. Site settings →
   **Domain management** → add your custom domain there once you own one.

### GitHub Pages

```sh
cd ~/Work/shadowswords-gamelib
git init && git add -A && git commit -m "game library site"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then repo **Settings → Pages → Build and deployment**: Source = *Deploy from a
branch*, Branch = `main`, folder = `/site`. `.nojekyll` is already in place.
Add the custom domain under Settings → Pages → Custom domain (this writes a
`site/CNAME` file for you).

### Custom domain

`shadowswords.xcom` is not a real top-level domain, so it can't be pointed
anywhere as-is. Register something real (e.g. `shadowswords.com`, or a
`.gg` / `.games` / `.dev`), then:

- **Netlify**: add the domain in Domain management; it gives you the DNS records
  (or use Netlify DNS).
- **Pages**: add it as the Custom domain, then at your registrar create a
  `CNAME` record for `www` → `<you>.github.io`, and the four `A` records for the
  apex domain that GitHub documents.

## Notes / limits

- Only art actually present on disk is included; videos and manuals are skipped
  to keep the site light. Games with no art show a placeholder.
- `data/search.json` (~340 KB) is fetched once on the first search.
- Regenerate and redeploy whenever the ES-DE library changes — the site is a
  snapshot, it does not read ES-DE live.
