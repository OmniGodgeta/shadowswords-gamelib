# PS2-in-browser proof of concept: real PCSX2, GPU-accelerated, streamed to a
# browser tab over WebRTC via Selkies (docs.selkies.io). Not part of the site
# build — this is a standalone container, run separately (see README.md).
#
# Base image already ships a full LXQt desktop + Selkies' own WebRTC/GStreamer
# streaming stack; we only add PCSX2 on top and autostart it.
FROM ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04

USER root

# PCSX2 ships as an AppImage upstream (no official .deb). ca-certificates for
# the download step; wget to fetch it. Extract-and-run avoids needing FUSE
# (/dev/fuse often isn't available/permitted in a container).
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ARG PCSX2_VERSION=v2.8.2
RUN wget -q -O /opt/pcsx2.appimage \
      "https://github.com/PCSX2/pcsx2/releases/download/${PCSX2_VERSION}/pcsx2-${PCSX2_VERSION}-linux-appimage-x64-Qt.AppImage" && \
    chmod +x /opt/pcsx2.appimage

# Autostart PCSX2 in the streamed desktop session (LXQt honours XDG autostart).
COPY pcsx2.desktop /etc/xdg/autostart/pcsx2.desktop

USER ubuntu
