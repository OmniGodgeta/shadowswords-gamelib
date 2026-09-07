#!/bin/bash
# Publish, over Tailscale, from `shadow`:
#   https://shadow-1.tail51f9d6.ts.net/         -> the arcade site + ROM server (127.0.0.1:8710)
#   https://shadow-1.tail51f9d6.ts.net:8443/    -> Jellyfin / movies      (127.0.0.1:8096)
#
# Run WITHOUT sudo (you are a Tailscale operator).
#   ~/setup-arcade-serving.sh          # serve on the tailnet + Funnel (public)
#   ~/setup-arcade-serving.sh lan      # serve on the tailnet only
#   ~/setup-arcade-serving.sh off      # tear it all down
#
# One-time prereqs — click "Enable" on each:
#   Serve : https://login.tailscale.com/f/serve?node=nbPLc1nrhS11CNTRL   (done)
#   Funnel: https://login.tailscale.com/f/funnel?node=nbPLc1nrhS11CNTRL
set -uo pipefail
mode="${1:-public}"

if [[ $mode == off ]]; then
  tailscale funnel --https=443 off  2>/dev/null || true
  tailscale funnel --https=8443 off 2>/dev/null || true
  tailscale serve reset
  echo "torn down."; exit 0
fi

systemctl --user start arcade-server.service 2>/dev/null || true
tailscale serve --bg --https=443  http://127.0.0.1:8710
tailscale serve --bg --https=8443 http://127.0.0.1:8096

if [[ $mode != lan ]]; then
  tailscale funnel --bg --https=443  on
  tailscale funnel --bg --https=8443 on
fi

echo
tailscale serve status
tailscale funnel status 2>/dev/null || true
echo
echo "Arcade : https://shadow-1.tail51f9d6.ts.net/"
echo "Movies : https://shadow-1.tail51f9d6.ts.net:8443/"
