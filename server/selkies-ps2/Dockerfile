# PS2-in-browser: real PCSX2, GPU-accelerated, streamed to a browser tab over
# WebRTC via Selkies (docs.selkies.io). Not part of the site build — this is
# a standalone container, run separately (see README.md).
#
# Base image already ships a full LXQt desktop + Selkies' own WebRTC/GStreamer
# streaming stack; we only add PCSX2 on top and autostart it.
FROM ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04

USER root

# PCSX2 ships as an AppImage upstream (no official .deb). ca-certificates for
# the download step; wget to fetch it. Extracted at BUILD time, not run via
# `--appimage-extract-and-run` at launch — that flag forks a genuinely
# separate child process for the real binary (confirmed the hard way while
# building server/selkies-dolphin/, which uses the identical pattern: the
# short-lived wrapper exits and the real process gets reparented to init
# within seconds, so a PID captured from the wrapper via `$!` is useless for
# killing it later — a relaunch left old sessions running instead of
# replacing them). Running the extracted AppRun directly makes `$!` the
# actual emulator process. This wasn't caught here originally because a
# quick manual PID check happened to look right — the discrepancy only
# showed up building Dolphin, where it's harder to miss.
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ARG PCSX2_VERSION=v2.8.2
RUN wget -q -O /opt/pcsx2.appimage \
      "https://github.com/PCSX2/pcsx2/releases/download/${PCSX2_VERSION}/pcsx2-${PCSX2_VERSION}-linux-appimage-x64-Qt.AppImage" && \
    chmod +x /opt/pcsx2.appimage && \
    cd /opt && ./pcsx2.appimage --appimage-extract && \
    mv squashfs-root pcsx2-extracted && \
    rm pcsx2.appimage

# Autostart PCSX2 in the streamed desktop session (LXQt honours XDG autostart).
COPY pcsx2.desktop /etc/xdg/autostart/pcsx2.desktop

USER ubuntu
