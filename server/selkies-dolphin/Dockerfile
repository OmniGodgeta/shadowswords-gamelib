# GameCube/Wii-in-browser: real Dolphin, GPU-accelerated, streamed over
# WebRTC via Selkies. Same shape as server/selkies-ps2/ — see that README
# for the gotchas that also apply here (entrypoint quirks, tailscale serve
# --bg) plus one Dolphin-specific one below.
#
# Ubuntu's own `dolphin-emu` package (universe repo) installs and *launches*
# fine but hangs forever past its own splash screen — floods the log with
# "QObject::connect(...): signal not found" (a Qt6 ABI mismatch against the
# container's system Qt) and never reaches a game, confirmed with two
# different titles and 30+ seconds each. The unofficial AppImage
# (github.com/pkgforge-dev/Dolphin-emu-AppImage) bundles its own compatible
# Qt and worked immediately — same self-contained-bundle shape that already
# worked for PCSX2, so use that pattern here too rather than the apt package.
#
# Extracted at BUILD time (`--appimage-extract`), not run via
# `--appimage-extract-and-run` at launch time: that flag re-extracts to a
# fresh /tmp dir on every run AND — the actual bug this caused — forks a
# genuinely separate child process for the real dolphin-emu binary, which
# then gets reparented to init once the short-lived wrapper exits. A PID
# recorded from the wrapper (`$!`) is worthless within seconds; killing it
# doesn't touch the orphaned real process, so launches piled up instead of
# replacing each other. Running the extracted AppRun directly makes `$!` the
# actual emulator process, same as PCSX2's AppImage already behaves.
FROM ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ARG DOLPHIN_RELEASE=2606a%402026-09-01_1788278367
ARG DOLPHIN_ASSET=Dolphin_Emulator-2606a-anylinux-x86_64.AppImage
RUN wget -q -O /opt/dolphin.appimage \
      "https://github.com/pkgforge-dev/Dolphin-emu-AppImage/releases/download/${DOLPHIN_RELEASE}/${DOLPHIN_ASSET}" && \
    chmod +x /opt/dolphin.appimage && \
    cd /opt && ./dolphin.appimage --appimage-extract && \
    mv squashfs-root dolphin-extracted && \
    rm dolphin.appimage

# Autostart Dolphin's own game browser in the streamed desktop session (LXQt
# honours XDG autostart) — launchStreamGame (arcade-server.mjs) relaunches it
# batch-mode with -e <path> to boot a specific game on demand.
COPY dolphin.desktop /etc/xdg/autostart/dolphin.desktop

USER ubuntu
