#!/usr/bin/env bash
# Install and start a tailnet-only TURN relay for RetroVerse netplay.
# Run as root on `shadow`:  sudo bash tools/setup-turn.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash tools/setup-turn.sh)" >&2; exit 1
fi

if command -v pacman >/dev/null; then pacman -S --needed --noconfirm coturn
elif command -v apt-get >/dev/null; then apt-get update && apt-get install -y coturn
else echo "Install coturn manually, then copy server/turn/turnserver.conf" >&2; exit 1; fi

install -d -m 0750 /etc/coturn
if [[ ! -f /etc/coturn/turnserver.conf ]]; then
  install -m 0640 server/turn/turnserver.conf /etc/coturn/turnserver.conf
  sed -i "s/CHANGE_ME/$(openssl rand -hex 16)/" /etc/coturn/turnserver.conf
fi

systemctl enable --now coturn
systemctl status coturn --no-pager | head -n 8
echo
echo "TURN credentials:"
grep '^user=' /etc/coturn/turnserver.conf
echo
echo "In RetroVerse Settings → Netplay relay use:"
echo "  URL: turn:$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": "\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//'):3478"
echo "  user/password: from the line above"