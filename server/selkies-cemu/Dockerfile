# WiiU-in-browser: real Cemu, GPU-accelerated, streamed over WebRTC via
# Selkies. Same architecture as server/selkies-ps2/ — READ THAT README FIRST
# (Selkies/nvidia-container-toolkit/tailscale setup, the credential scheme,
# the pkill-self-match trap, the AppImage-extract-at-build-time reasoning).
# This file only covers what's specific to Cemu.
#
# Cemu ships an official AppImage per release (cemu-project/Cemu on GitHub —
# verified official org). CAUTION, and why the version is pinned exactly:
# the Linux AppImage/zip assets attached to the official Cemu 2.6 GitHub
# release were compromised with credential-stealing malware between
# 2026-05-06 and 2026-05-12 (Cemu team confirmed; Windows/macOS/Flatpak were
# untouched). The Cemu-2.6-x86_64.AppImage asset currently on that release
# was re-uploaded 2026-05-12 (its GitHub-reported sha256 is pinned below) —
# this is the post-incident clean replacement, not the compromised one, but
# re-verify the digest yourself before trusting this pin indefinitely:
# `gh api repos/cemu-project/Cemu/releases/tags/v2.6 --jq '.assets[] |
# select(.name=="Cemu-2.6-x86_64.AppImage") | {digest,updated_at}'`
FROM ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ARG CEMU_VERSION=v2.6
ARG CEMU_SHA256=0c20c4aeb800bb13d9bab9474ef45a6f8fcde6402cad9b32ac2a1bbd03186313
RUN wget -q -O /opt/cemu.appimage \
      "https://github.com/cemu-project/Cemu/releases/download/${CEMU_VERSION}/Cemu-2.6-x86_64.AppImage" && \
    echo "${CEMU_SHA256}  /opt/cemu.appimage" | sha256sum -c - && \
    chmod +x /opt/cemu.appimage && \
    cd /opt && ./cemu.appimage --appimage-extract && \
    mv squashfs-root cemu-extracted && \
    rm cemu.appimage

# keys.txt is the same legal category as a PS2 BIOS dump / Xbox MCPX+HDD —
# the owner's own console's title keys, never bundled, always mounted
# read-only at runtime (see the docker run in README.md). Confirmed the hard
# way (web docs disagree and are wrong): Cemu 2.6 actually reads it from
# `~/.config/Cemu/keys.txt` — NOT `~/.local/share/Cemu/` as multiple guides
# claim. Both locations get a keys/ subfolder pre-created and the same host
# file bind-mounted onto all of them at runtime (see README) since it's free
# to cover the alternate path too.
RUN mkdir -p /home/ubuntu/.config/Cemu/keys /home/ubuntu/.local/share/Cemu/keys && \
    chown -R ubuntu:ubuntu /home/ubuntu/.config /home/ubuntu/.local

# Baked-in settings.xml (fullscreen=true, wizard already completed, Vulkan
# api=1) — Cemu's first-run "Getting started" wizard has no CLI/env skip
# flag, so without this every fresh container shows it (and blocks direct
# `-g` game launches behind it, confirmed live). Produced by actually
# clicking through it once and copying the result — see README.
RUN mkdir -p /home/ubuntu/.config/Cemu
COPY settings.xml /home/ubuntu/.config/Cemu/settings.xml

RUN chown -R ubuntu:ubuntu /home/ubuntu/.config

# Autostart Cemu's own game browser in the streamed desktop session —
# launchStreamGame (arcade-server.mjs) relaunches it with a specific game
# on demand, same pattern as PS2/Dolphin/xemu.
COPY cemu.desktop /etc/xdg/autostart/cemu.desktop

USER ubuntu
