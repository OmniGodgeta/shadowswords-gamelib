# Putting the arcade on a real domain

Right now the site answers on two hostnames:

| URL | Reaches | Needs |
|-----|---------|-------|
| `https://retroverse.omni.net/` | the self-hosted instance (ROMs, music, saves, netplay) | DNS/proxy route to the server |
| `https://omnigodgeta.github.io/shadowswords-gamelib/` | the public browse+play mirror | nothing |

A custom domain (e.g. `arcade.shadowswords.com`) can front **either** one.

---

## Option A — custom domain in front of GitHub Pages (free, public, browse+play only)

1. Buy the domain (Cloudflare Registrar, Porkbun, Namecheap — ~$10/yr).
2. In the DNS zone add, for a subdomain `arcade`:
   ```
   CNAME  arcade  omnigodgeta.github.io.
   ```
   (For an apex/root domain use the four `A` records GitHub lists instead.)
3. Put the hostname in `docs/CNAME` (one line, no scheme):
   ```
   arcade.shadowswords.com
   ```
   `deploy.sh` copies `docs/` verbatim, so it ships automatically. **A committed
   `docs/CNAME` is why this file isn't created for you — add it once you own the
   domain.**
4. Repo → Settings → Pages → Custom domain → enter it → tick *Enforce HTTPS*.

The ROM stream / music / saves still come from the tailnet URL hard-coded in
`docs/assets/app.js` (`TS`), so those only work for tailnet clients or with
Funnel on. Everything else is public.

---

## Option B — custom domain in front of the self-hosted instance (full features, public)

This needs **Tailscale Funnel** (only `tailscale`, not Claude, can turn it on):

1. Enable Funnel for the node:
   <https://login.tailscale.com/f/funnel?node=nbPLc1nrhS11CNTRL>
2. ```bash
   tailscale funnel --bg --https=443  http://127.0.0.1:8710
   tailscale funnel --bg --https=8443 http://127.0.0.1:8096   # Jellyfin
   ```
   The node remains reachable at its Tailscale hostname; the canonical site is
   `https://retroverse.omni.net/`.
3. Point your domain at it with a CNAME:
   ```
   CNAME  retroverse  retroverse.tail51f9d6.ts.net.
   ```
   Tailscale serves a valid Let's Encrypt cert for the `ts.net` name; browsers
   that follow the CNAME will still see that cert, so for a clean padlock on
   *your* name put **Cloudflare** in front (orange-cloud proxy, SSL mode "Full")
   or a small nginx/Caddy reverse proxy on any always-on box.
4. Update `TS` in `docs/assets/app.js` to `https://arcade.shadowswords.com` and
   redeploy so the ROM/music/save URLs use your domain too.

⚠️ Funnel exposes the **entire ROM library and the Jellyfin login page** to the
open internet. Consider a Cloudflare Access policy or HTTP basic-auth in front
if that matters.

---

## Netplay on a public domain

`arcade-netplay` currently listens on `:8712`, which Funnel can't publish
(Funnel only does 443/8443/10000). To make netplay public, move it behind one of
those ports or a reverse proxy, then set in the browser console:
```js
localStorage['ssw:netplay'] = 'https://arcade.shadowswords.com:10000/'
```
