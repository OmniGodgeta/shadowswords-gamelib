# Self-hosting `shadow`

The public GitHub Pages mirror is browse + play only. The **self-hosted**
instance on `shadow` (`https://shadow-1.tail51f9d6.ts.net/`) adds the ROM
stream, BIOS, music, cloud save-states and netplay.

## Pieces

| File | What it is | Runs as |
|------|-----------|---------|
| `arcade-server.mjs` | Zero-dependency Node server: static site + `/roms/…` (Range) + `/roms/bios/…` + `/music/…` + `/states/…` (cloud save-states). Binds `127.0.0.1:8710`. | `arcade-server.service` (user unit) |
| `arcade-server.service` | systemd **user** unit. `ProtectHome=read-only` + `ReadWritePaths=%h/.local/share/ssw-arcade` so only the save-state dir is writable. | — |
| `arcade-netplay/` | EmulatorJS netplay signalling server (`express` + `socket.io` + `cors`, from [EmulatorJS/EmulatorJS-Netplay](https://github.com/EmulatorJS/EmulatorJS-Netplay), patched to bind `127.0.0.1:8712`). | `arcade-netplay.service` (user unit) |
| `setup-arcade-serving.sh` | Publishes 8710 / 8096 / 8712 to the tailnet via `tailscale serve`, and prints the Funnel commands for public access. | run by hand |

## Install

```bash
# 1. server + save-states
cp arcade-server.mjs ~/arcade-server.mjs
cp arcade-server.service ~/.config/systemd/user/
mkdir -p ~/.local/share/ssw-arcade/states
systemctl --user daemon-reload
systemctl --user enable --now arcade-server.service

# 2. netplay (optional)
mkdir -p ~/arcade-netplay && cp arcade-netplay/* ~/arcade-netplay/
cd ~/arcade-netplay && npm install --omit=dev
cp ../arcade-netplay.service ~/.config/systemd/user/     # adjust path if needed
systemctl --user daemon-reload
systemctl --user enable --now arcade-netplay.service

# 3. publish to the tailnet
./setup-arcade-serving.sh
```

Save-states are written to `~/.local/share/ssw-arcade/states/<system>/<base64url(rompath)>.state`
and listed at `GET /states/list`. The front end sets `EJS_loadStateURL` from
there when you open a game from the **Cloud saves** page.

Netplay defaults to `https://shadow-1.tail51f9d6.ts.net:8712/`. Override in the
browser console with `localStorage['ssw:netplay'] = 'https://…/'` or disable it
with `localStorage['ssw:netplay'] = 'off'`.
