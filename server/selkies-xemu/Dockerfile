# Original Xbox-in-browser: real xemu, GPU-accelerated, streamed over WebRTC
# via Selkies. Same architecture as server/selkies-ps2/ — READ THAT README
# FIRST (Selkies/nvidia-container-toolkit/tailscale setup, the credential
# scheme, the pkill-self-match trap, the AppImage-extract-at-build-time
# reasoning, the fork/relocate reasoning for killPattern-not-PID). This file
# only covers what's specific to xemu.
#
# xemu ships an official AppImage per release (xemu-project/xemu on GitHub —
# verified official org, unlike the current Switch-emulator landscape which
# is full of SEO-spam repos impersonating real projects; deliberately did NOT
# build a Switch container this round for that reason).
FROM ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ARG XEMU_VERSION=v0.8.136
RUN wget -q -O /opt/xemu.appimage \
      "https://github.com/xemu-project/xemu/releases/download/${XEMU_VERSION}/xemu-${XEMU_VERSION#v}-x86_64.AppImage" && \
    chmod +x /opt/xemu.appimage && \
    cd /opt && ./xemu.appimage --appimage-extract && \
    mv squashfs-root xemu-extracted && \
    rm xemu.appimage

# Config pointing at the BIOS/MCPX/HDD files mounted in at runtime
# (/home/ubuntu/xbox-bios, see docker run in the README) — same "your own
# dump, mounted, never copied into the image" pattern as PCSX2's BIOS. The
# owner already had a working xemu install (for Windows) with these files
# present, reused rather than resourced. xemu reads its config from
# ~/.local/share/xemu/xemu/xemu.toml, NOT portable-mode-next-to-the-binary
# (confirmed the hard way: placing it next to AppRun was silently ignored —
# log said "Config file not found" every time despite the file being right
# there).
RUN mkdir -p /home/ubuntu/.local/share/xemu/xemu
COPY xemu.toml /home/ubuntu/.local/share/xemu/xemu/xemu.toml
RUN chown -R ubuntu:ubuntu /home/ubuntu/.local

# Autostart xemu's own game browser in the streamed desktop session (LXQt
# honours XDG autostart) — launchStreamGame (arcade-server.mjs) relaunches it
# with a specific ISO on demand.
COPY xemu.desktop /etc/xdg/autostart/xemu.desktop

USER ubuntu
