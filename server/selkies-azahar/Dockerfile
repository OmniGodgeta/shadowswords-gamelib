# 3DS-in-browser: real Azahar (Citra's actual maintained successor —
# started as Lime3DS, briefly "Mandarine", settled on Azahar; the Lime3DS
# repos are now archived, development consolidated under this name),
# GPU-accelerated, streamed over WebRTC via Selkies. Same architecture as
# server/selkies-ps2/ — READ THAT README FIRST. This file only covers what's
# specific to Azahar.
#
# Verified official org: github.com/azahar-emu/azahar, actively maintained
# (release used here is 4 days old at build time). No BIOS/key file needed —
# unlike PS2/Xbox/WiiU, 3DS commercial dumps (.3ds/.cia) run via Azahar's
# HLE with no console-derived file required.
FROM ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ARG AZAHAR_VERSION=2126.1.1
ARG AZAHAR_SHA256=e445dabc18fe7665867e24a18a78e24e133261a9cc320fae6a4a45bd2e7c4783
RUN wget -q -O /opt/azahar.appimage \
      "https://github.com/azahar-emu/azahar/releases/download/${AZAHAR_VERSION}/azahar.AppImage" && \
    echo "${AZAHAR_SHA256}  /opt/azahar.appimage" | sha256sum -c - && \
    chmod +x /opt/azahar.appimage && \
    cd /opt && ./azahar.appimage --appimage-extract && \
    mv squashfs-root azahar-extracted && \
    rm azahar.appimage

# Autostart Azahar's own game browser in the streamed desktop session —
# launchStreamGame (arcade-server.mjs) relaunches it with a specific game on
# demand, same pattern as PS2/Dolphin/xemu/Cemu.
COPY azahar.desktop /etc/xdg/autostart/azahar.desktop

USER ubuntu
