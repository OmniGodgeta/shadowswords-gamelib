# 3DS-in-browser, take two: real Panda3DS (internal name "Alber"), GPU-
# accelerated, streamed over WebRTC via Selkies. Built after Azahar (see
# server/selkies-azahar/) turned out to refuse every encrypted ROM in the
# owner's library — confirmed a deliberate, permanent policy of that whole
# codebase lineage (Citra -> Lime3DS -> Mandarine -> Azahar), dropped in
# the very first azahar-emu/azahar release and never present in that repo's
# history at all. Panda3DS is a from-scratch reimplementation (not a Citra
# fork), unaffected by that specific lineage's decision, and still supports
# encrypted ROMs via the classic sysdata/aes_keys.txt file.
#
# Verified official org: wheremyfoodat/Panda3DS (1.4k stars, real active
# development — a commit landed ~5 weeks before this was built), same
# architecture as server/selkies-ps2/ — READ THAT README FIRST.
FROM ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# No newer tagged release has a Linux build as of this writing (last tag
# v0.9 is Dec 2024; development continues on main without new tags) — using
# the latest official tagged release rather than building from source.
# GitHub didn't compute a content digest for this old asset (added later),
# so the sha256 pinned here is simply the actual byte-for-byte hash of what
# was downloaded and verified locally before ever using it — re-derive it
# yourself with `sha256sum` on a fresh download if you ever bump ZIP_URL,
# same principle as the GitHub-native digests used for xemu/Cemu/Azahar.
ARG ZIP_URL=https://github.com/wheremyfoodat/Panda3DS/releases/download/v0.9/Linux-Qt.zip
ARG ZIP_SHA256=6ee79765434dd4bed62549f559ba8691cf90d7351a94fdd44bc31a9016e67c8b
RUN mkdir /opt/panda3ds-unzipped && cd /opt/panda3ds-unzipped && \
    wget -q -O panda3ds.zip "${ZIP_URL}" && \
    echo "${ZIP_SHA256}  panda3ds.zip" | sha256sum -c - && \
    unzip -q panda3ds.zip && \
    chmod +x Alber-x86_64.AppImage && \
    ./Alber-x86_64.AppImage --appimage-extract >/dev/null && \
    mv squashfs-root /opt/panda3ds-extracted && \
    cd / && rm -rf /opt/panda3ds-unzipped

# sysdata/aes_keys.txt is the owner's own console's decryption keys — same
# "your own dump, mounted, never bundled" rule as every BIOS/key file
# elsewhere in this project. Confirmed via source (src/core/loader/ncch.cpp)
# that Panda3DS reads it from <app data folder>/sysdata/aes_keys.txt; the
# exact app data folder is confirmed empirically at first run (see README)
# and pre-created here so the runtime bind-mount always has somewhere to
# land.
RUN mkdir -p /home/ubuntu/.local/share/Alber/sysdata && \
    chown -R ubuntu:ubuntu /home/ubuntu/.local

# Autostart Panda3DS's own game browser — launchStreamGame (arcade-server.mjs)
# relaunches it with a specific game on demand, same pattern as every other
# streamed console.
COPY panda3ds.desktop /etc/xdg/autostart/panda3ds.desktop

USER ubuntu
