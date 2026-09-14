# TURN relay for RetroVerse netplay

RetroVerse netplay is peer-to-peer WebRTC. On the tailnet that is normally a
direct path, but when direct ICE cannot be established (phone on cellular,
carrier NAT, mDNS private candidates that don't cross the tailnet) the peers
stall at "Connecting as P2". A TURN server on `shadow` gives a guaranteed relay
path. It is only used when a direct pair is impossible.

## 1. Install coturn

```bash
sudo pacman -S --needed coturn        # Arch
# or: sudo apt install coturn         # Debian/Ubuntu
```

## 2. Config

Copy `turnserver.conf` (this directory) to `/etc/coturn/turnserver.conf` and
change the password:

```bash
sudo install -m 0640 server/turn/turnserver.conf /etc/coturn/turnserver.conf
sudo sed -i 's/CHANGE_ME/'"$(openssl rand -hex 16)"'/' /etc/coturn/turnserver.conf
sudo grep '^user=' /etc/coturn/turnserver.conf     # note the credential
```

## 3. Run it

```bash
sudo systemctl enable --now coturn
sudo systemctl status coturn --no-pager
```

Allow the port on the tailnet (and only the tailnet):

```bash
sudo tailscale serve --help >/dev/null   # (informational)
# ufw: sudo ufw allow in on tailscale0 to any port 3478 proto udp
```

## 4. Point RetroVerse at it

**Settings → Netplay relay** (on both devices):

| Field | Value |
|---|---|
| TURN URL | `turn:shadow-1.tail51f9d6.ts.net:3478` |
| TURN username | `retroverse` |
| TURN password | the value from step 2 |

Then reconnect netplay. The Netplay sheet's **Diagnostics** `cands=` line will
show a `relay×N` entry when the TURN path is in use (in addition to `host` /
`srflx`).

## Notes

- `turnserver.conf` binds the tailnet only; keep Funnel off (see AGENTS.md §4).
- If you put coturn behind the public internet instead, set `external-ip` to the
  public address and open UDP/TCP 3478.
- The relay adds ~1 RTT of latency versus a direct path. It is a fallback, not
  the default; ICE prefers direct candidates automatically.