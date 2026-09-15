# PS2-in-browser — validated proof of concept (2026-09-16)

Real PCSX2, GPU-accelerated (Vulkan via the RTX 5070), streamed to any
browser tab over WebRTC by [Selkies](https://docs.selkies.io/) — no WASM
port, no partial compatibility. Games are read directly from the host's own
library; nothing is copied or re-downloaded.

**Status: validated, not yet integrated into the site.** This is a
standalone Docker container you reach directly; it is not linked from
RetroVerse's UI yet. See "Next steps" below for what that would take.

## What's running

```
docker run --name selkies-ps2 -d --restart unless-stopped --shm-size=2g \
  -p 8090:8080 \
  --gpus all --runtime nvidia \
  -e PASSWD=retroverse \
  -v ~/.config/PCSX2:/home/ubuntu/.config/PCSX2 \
  -v ~/Games/roms/ps2:/home/ubuntu/Games/ps2:ro \
  selkies-ps2:test
```

- Image built from `Dockerfile` in this directory (extends
  `ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04`, adds the
  official PCSX2 AppImage, autostarts it via `pcsx2.desktop`).
- `~/.config/PCSX2` is mounted **read-write** and **shared with the host's
  own desktop PCSX2 install** — same BIOS, same settings, same save state
  namespace. This was the simplest thing that worked for a proof of concept;
  a real deployment probably wants its own separate config volume so the
  two don't collide if both are used at once.
- `~/Games/roms/ps2` (the same symlink the rest of the library already
  uses → the external "Playstation 2/Games" drive) is mounted read-only.
  **The drive has to actually be connected** for the container to see any
  games — it showed empty when the drive wasn't mounted, populated
  correctly once it was.
- Password (`retroverse`) is a placeholder — change it before this is
  anything more than a local test (`-e PASSWD=...`).

## Verified end-to-end

1. GPU passthrough into Docker: `nvidia-container-toolkit` installed
   (`extra/nvidia-container-toolkit`, official repo, not even AUR),
   `nvidia-ctk runtime configure --runtime=docker` + restart. Confirmed with
   `docker run --gpus all nvidia/cuda:... nvidia-smi`.
2. Selkies' own base image runs clean, healthy, NVENC encoding active
   (`[pixelflux] Render node 0 encodes H264, AV1, H265 on nvenc`) — Selkies
   also bundles its own coturn (TURN) instance inside the container, so it
   doesn't even need the site's existing TURN server.
3. PCSX2 autostarts, correctly detects the mounted BIOS files (both a
   Europe and a USA BIOS showed up with correct version info) and scans the
   mounted game directory (400+ real games from the library, correct
   titles/regions/sizes/compatibility ratings pulled from PCSX2's own DB).
4. Launched **Bully** — boots to the Rockstar logo, **Vulkan renderer,
   640x448 native resolution, 60 FPS / 100% speed**. Screenshots taken via
   `docker exec ... import -window root` are in the session log, not
   committed here (throwaway diagnostics, not artifacts worth keeping).
5. Reachable over the tailnet: `https://<tailnet-ip>:8090/` returns 401
   (password prompt) — confirmed from `shadow` itself; not yet tested from
   an actual remote device.

## Gotchas hit along the way (don't redo this work)

- **Don't bind-mount just a subdirectory of a config tree that doesn't
  otherwise exist in the image.** First attempt mounted only
  `~/.config/PCSX2/bios` (read-only) into a path that didn't pre-exist —
  Docker auto-created the parent `/home/ubuntu/.config/PCSX2` as **root**,
  so PCSX2 couldn't `mkdir()` its own subdirectories (`inis/`, `sstates/`,
  etc.) and failed on first launch ("Failed to create data directory...
  Permission denied"). Mounting the whole `~/.config/PCSX2` tree read-write
  sidesteps this entirely (and happens to work permission-wise because the
  container's `ubuntu` user is UID 1000, same as the host user).
- **The base image's ENTRYPOINT ignores whatever command you pass** —
  `docker run <image> id -u ubuntu` doesn't print a uid, it just boots the
  full desktop session anyway. Use `--entrypoint` to override it if you need
  to run something one-off inside the image (e.g. checking the `ubuntu`
  user's UID before deciding how to mount things).
- PCSX2 ships only as an AppImage upstream — `--appimage-extract-and-run`
  avoids needing `/dev/fuse` in the container.
- The Setup Wizard's directory picker has a plain text "Directory:" field —
  type the path directly rather than clicking through the file browser.
- The BIOS list in the wizard needs an actual row **click** to select
  before "Next" — clicking Next with nothing selected pops a warning and
  does not advance.

## Next steps (not started)

- **Separate config volume** from the host's desktop PCSX2 (a named Docker
  volume, pre-seeded with just the BIOS) instead of sharing
  `~/.config/PCSX2` directly, so the two installs can't step on each other.
- **`tailscale serve` wiring** for a proper URL instead of a raw
  `https://<ip>:8090/` — same pattern already used for the main site
  (:443), Jellyfin (:8443), and netplay (:8712).
- **RetroVerse UI integration** — this is currently just a container you
  reach directly; nothing in `app.js` links to it. Wiring it in means
  deciding how a "PS2" entry in the library launches this stream instead of
  an EJS player, and how/whether the existing host-authoritative-video
  netplay pattern (`npStartHostStream`/`npShowHostVideo`) extends to a
  Selkies stream instead of an EJS canvas capture — same idea, different
  video source, not yet designed.
- **Generalizes directly to other consoles** — same Dockerfile shape (base
  image + one emulator + one autostart entry) should work for Dolphin
  (GameCube/Wii, has real official netplay) and is worth trying for Xemu
  (Xbox, no native netplay — would lean entirely on the host-stream
  approach) and Cemu/a Switch emulator (WiiU/Switch — GPU-heavier, whether
  "most of the library at full speed" holds needs actually trying it, not
  assumed from this one PS2 result).
