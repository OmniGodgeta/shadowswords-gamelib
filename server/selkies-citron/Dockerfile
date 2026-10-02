# Switch-in-browser: the owner's own Citron (Windows build) under Wine,
# GPU-accelerated, streamed over WebRTC via Selkies. Same architecture as
# server/selkies-ps2/ — READ THAT README FIRST (Selkies/nvidia-container-
# toolkit/tailscale setup, the credential scheme, the pkill-self-match trap).
# This file only covers what's specific to Citron + Wine.
#
# Why Wine and not a Linux build: Citron's official source (git.citron-emu.org)
# doesn't resolve (DMCA activity), so there is nothing to verify a download
# against. The owner chose to run the exact portable Windows build they already
# use (see AGENT-MEMORY.md round 10). No DXVK needed: Citron renders through
# Vulkan, and Wine's winevulkan hands that straight to the NVIDIA driver the
# container toolkit injects.
#
# Build context: ./citron/ is a copy of the portable folder MINUS its user/
# dir (gitignored — copy it yourself, see README). user/nand, user/keys and
# user/load are bind-mounted at runtime instead, so saves stay shared with
# the owner's desktop install and nothing licensed is baked into the image.
FROM ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04

USER root
RUN dpkg --add-architecture i386 && apt-get update && \
    apt-get install -y --no-install-recommends wine wine64 cabextract wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY citron/ /opt/citron/
RUN mkdir -p /opt/citron/user/config /opt/citron/user/nand /opt/citron/user/keys \
             /opt/citron/user/load /opt/citron/user/sdmc && \
    chown -R ubuntu:ubuntu /opt/citron

# The owner's own qt-config.ini, with every Y:/ path rewritten to where this
# container mounts things (Z:/ = Wine's view of /) and Discord presence off.
# Baked rather than mounted so in-container changes never write back to the
# desktop install's settings.
COPY --chown=ubuntu:ubuntu qt-config.ini /opt/citron/user/config/qt-config.ini

# Pre-create the Wine prefix at build time — otherwise the first launch in a
# fresh container spends ~30s in wineboot (and pops Mono/Gecko installers).
# Built AS ROOT on purpose: in this Selkies image the whole desktop session
# (Xvfb, openbox, autostart) and every `docker exec` run as root, and Wine
# refuses a prefix owned by anyone else ("'/home/ubuntu/.wine' is not owned
# by you") — confirmed live, autostart silently did nothing until this.
ENV WINEPREFIX=/opt/wineprefix WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="
RUN mkdir -p /opt/wineprefix && chown root:root /opt/wineprefix && wineboot -i && "$(find /usr/lib/wine /usr/lib/x86_64-linux-gnu/wine -name "wineserver*" -type f 2>/dev/null | head -1)" -w

# Microsoft's real VC++ 2015-2022 runtime, x64 DLLs only, dropped next to
# citron.exe (app-local, which Windows' loader checks first). Wine 10's builtin
# msvcp140_atomic_wait lacks __std_tzdb_get_time_zones, which Citron calls the
# moment a game boots — confirmed live: the game list worked, every launch
# aborted with "unimplemented function
# msvcp140_atomic_wait.dll.__std_tzdb_get_time_zones". Not via winetricks
# vcrun2022: its pinned checksum is stale (Microsoft updates this permalink in
# place) and its 32-bit half won't run here; Citron is 64-bit only anyway.
# Cab a12 inside the bundle holds the *_amd64 copies (a11 = arm64).
RUN cd /tmp && wget -q -O vc.exe https://aka.ms/vs/17/release/vc_redist.x64.exe && \
    mkdir vc && cabextract -q -d vc vc.exe && cabextract -q -d vcdll vc/a12 && \
    for f in vcdll/*_amd64; do b=$(basename "$f" _amd64); cp "$f" "/opt/citron/$b"; done && \
    ls /opt/citron/msvcp140_atomic_wait.dll && rm -rf /tmp/vc /tmp/vcdll /tmp/vc.exe
# n,b = native (the files above) first, Wine's builtin as fallback.
ENV WINEDLLOVERRIDES="mscoree,mshtml=;msvcp140,msvcp140_1,msvcp140_2,msvcp140_atomic_wait,msvcp140_codecvt_ids,vcruntime140,vcruntime140_1,vcruntime140_threads=n,b"

# Autostart Citron's own game list in the streamed desktop session —
# launchStreamGame (arcade-server.mjs) relaunches it with a specific game.
COPY citron.desktop /etc/xdg/autostart/citron.desktop
