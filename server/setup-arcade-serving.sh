#!/bin/bash
# Publish the arcade + movies over Tailscale from `shadow`.
#   ~/setup-arcade-serving.sh          # tailnet only (Serve)
#   ~/setup-arcade-serving.sh off      # tear down
#
# For PUBLIC (internet) access, this script prints the two commands to run —
# it does not run them for you.
set -uo pipefail
mode="${1:-lan}"

if [[ $mode == off ]]; then
  tailscale serve reset
  echo "torn down."
  exit 0
fi

systemctl --user start arcade-server.service 2>/dev/null || true
systemctl --user start arcade-netplay.service 2>/dev/null || true
tailscale serve --bg --https=443  http://127.0.0.1:8710
tailscale serve --bg --https=8443 http://127.0.0.1:8096
tailscale serve --bg --https=8712 http://127.0.0.1:8712   # EmulatorJS netplay

echo
tailscale serve status
cat <<'MSG'

Arcade  : https://retroverse.omni.net/
Movies  : https://retroverse.omni.net:8443/
Netplay : https://retroverse.omni.net:8712/  (signalling only)
(all reachable from any device on your tailnet — remote or on home wifi)

To also make them reachable from the public internet (no Tailscale needed on
the client), first click "Enable" at
  https://login.tailscale.com/f/funnel?node=nbPLc1nrhS11CNTRL
then run these two yourself:
  tailscale funnel --bg --https=443  http://127.0.0.1:8710
  tailscale funnel --bg --https=8443 http://127.0.0.1:8096
WARNING: that exposes the full ROM library and the Jellyfin login to anyone.
MSG
