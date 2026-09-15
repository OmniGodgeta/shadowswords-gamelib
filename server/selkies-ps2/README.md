# PS2-in-browser (2026-09-16)

Real PCSX2, GPU-accelerated (Vulkan via the RTX 5070), streamed to any
browser tab over WebRTC by [Selkies](https://docs.selkies.io/) — no WASM
port, no partial compatibility. Games are read directly from the host's own
library; nothing is copied or re-downloaded. Sibling doc:
`server/selkies-dolphin/README.md` (GameCube/Wii) shares this whole
architecture — read this one first, that one only documents what's different.

**Status: live on the site.** Play → "Streamed consoles" → PlayStation 2 in
RetroVerse lists the library and launches a picked game directly on the
container's PCSX2 (`serveStreamList`/`launchStreamGame` in
`arcade-server.mjs`, routes `/stream/ps2/list` + `/stream/launch`). The
stream itself is reachable at `https://retroverse.tail51f9d6.ts.net:8722/`
(wired via `tailscale serve --bg --https=8722 https+insecure://127.0.0.1:8090`
— a trusted tailnet cert instead of Selkies' own self-signed one), with login
credentials embedded right in the URL RetroVerse hands out so every visitor
is pre-authorized. One game runs at a time; launching a new one kills
whatever's running first — the picker shows who/what is currently running.

## What's running

```
docker run --name selkies-ps2 -d --restart unless-stopped --shm-size=2g \
  -p 8090:8080 \
  --gpus all --runtime nvidia \
  -e SELKIES_BASIC_AUTH_USER=ShadowSwords \
  -e SELKIES_BASIC_AUTH_PASSWORD=Allo1234 \
  -v ~/.config/PCSX2:/home/ubuntu/.config/PCSX2 \
  -v ~/Games/roms/ps2:/home/ubuntu/Games/ps2:ro \
  selkies-ps2:test
```

- Image built from `Dockerfile` in this directory (extends
  `ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04`, adds the
  official PCSX2 AppImage — **extracted at build time**, see Gotchas —
  autostarts it via `pcsx2.desktop`).
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
- `SELKIES_BASIC_AUTH_USER`/`_PASSWORD` are the owner's own chosen
  credentials (not a placeholder). `arcade-server.mjs`'s `STREAM_SYSTEMS.
  ps2.url` embeds them (`https://user:pass@host/`) so browsers auto-
  authenticate — rotate in both places together if this ever needs to change.

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
   mounted game directory (600+ real games from the library, correct
   titles/regions/sizes/compatibility ratings pulled from PCSX2's own DB).
4. Launched **Bully** — boots to the Rockstar logo, **Vulkan renderer,
   640x448 native resolution, 60 FPS / 100% speed**.
5. Reachable over the tailnet at the trusted-cert `tailscale serve` URL —
   confirmed from `shadow` itself with embedded credentials (200, no
   browser prompt); not yet tested from an actual remote device.
6. Launch-and-replace verified clean: launched two different games back to
   back through the real `/stream/launch` endpoint, confirmed via `ps aux`
   inside the container that exactly one emulator process exists after each
   launch — no orphaned processes piling up (see Gotchas — this needed two
   real fixes to get right, not just the first thing that appeared to work).

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
  to run something one-off inside the image.
- **`--appimage-extract-and-run` at launch time is the wrong call for a
  long-running, kill-and-relaunch-able process.** It re-extracts to a fresh
  `/tmp` directory on *every* invocation, and — the actual bug this caused —
  its wrapper process can fork a genuinely separate child for the real
  binary and then exit, which reparents that child to init. A PID captured
  via `$!` right after launching is only good for a few seconds; by the time
  a later request tries to kill "the game currently running," that PID may
  already be gone or may only be the (already-exited) wrapper, leaving the
  real emulator orphaned. Symptom: launching a second game left the first
  one *also* still running — two windows, two GPU sessions, confirmed via
  `ps aux` inside the container. Fixed two ways at once: (1) the AppImage is
  extracted **once, at Docker build time** (`--appimage-extract`, then
  reference `<extracted-dir>/AppRun` directly — no wrapper, no per-launch
  re-extraction), and (2) killing uses `pkill -f <pattern>` as its own
  **separate** `docker exec` (see next point for why it can't be in the same
  command as the launch), not a tracked PID.
- **A `pkill -f` that matches its own command line kills itself.** The very
  first version concatenated `kill` and the new `launch` into one `bash -c`
  string — but that string's own text contains the emulator's name (it's
  right there in the launch command that follows), so the pattern-matching
  kill also matched — and killed — its own parent shell before the new
  launch ever ran (exit 137/SIGKILL, first attempt). Splitting kill and
  launch into two separate `docker exec` calls fixes this: `pkill -f` in its
  own standalone invocation only sees `pkill -f <pattern>` as its command
  line, which pkill's own self-exclusion already handles safely.
- The Setup Wizard's directory picker has a plain text "Directory:" field —
  type the path directly rather than clicking through the file browser.
- The BIOS list in the wizard needs an actual row **click** to select
  before "Next" — clicking Next with nothing selected pops a warning and
  does not advance.
- Embedding `user:pass@host` in the URL only pre-authenticates a **top-level
  navigation** (a real link/tab open) — it does not work the same way for an
  iframe. `launchStream()` on the frontend deliberately always opens a new
  tab for this reason.
- **Neither PCSX2's own `-fullscreen` flag nor Dolphin's default window
  reliably fills Selkies' virtual display** — confirmed via a user screenshot
  showing the emulator window as a small rectangle in the corner, black space
  everywhere else, despite `-fullscreen` being passed. Fixed at the window-
  manager level instead of trusting either app's own fullscreen handling:
  every launch now also runs `wmctrl -r :ACTIVE: -b add,fullscreen` (delayed
  ~4s, backgrounded, see `FULLSCREEN_FORCER` in `arcade-server.mjs`) after
  starting the emulator. This is deliberately app-agnostic — it forces
  *whatever window is currently active* to fullscreen, so the same one-liner
  covers PCSX2, Dolphin, and xemu without needing per-app flag research.
  Verified via before/after screenshots (before: small window with visible
  black borders; after: game content filling the full captured frame).

## Known issues (open, from live user testing)

- **Controller not detected.** Root-caused by inspecting
  `~/.config/PCSX2/inis/PCSX2.ini`'s `[Pad1]` section inside the running
  container — it only has keyboard bindings (`Up = Keyboard/Up`, etc.), zero
  SDL/gamepad bindings. This is a real, unfixed gap: PCSX2 (and Dolphin) need
  actual SDL controller-binding config written in, and that needs validating
  against a real controller — not something to fake from code alone without
  a way to confirm button-mapping correctness live. Deferred rather than
  guessed at.
- **No on-screen touch controls, unlike the EmulatorJS-based emulators.**
  Selkies actually ships one already: a **"Universal Touch Gamepad" overlay**
  (Ctrl+Shift+G, or the hamburger side menu inside the stream itself) — it's
  not surfaced anywhere in RetroVerse's own UI yet, so a first-time visitor
  has no reason to know it exists. Also worth trying:
  `SELKIES_GAMEPAD_ON_START=true` as a container env var, to have it appear
  automatically instead of requiring the shortcut. Neither has been wired
  into RetroVerse's own onboarding/UI yet — purely a communication/discovery
  gap right now, not a missing feature.

## Next steps

- **Separate config volume** from the host's desktop PCSX2 (a named Docker
  volume, pre-seeded with just the BIOS) instead of sharing
  `~/.config/PCSX2` directly, so the two installs can't step on each other.
- **Box art / real library metadata** — `serveStreamList` currently just
  lists filenames off disk (name = filename minus extension). No build.py
  integration, no box art, no per-game compatibility notes surfaced in the
  UI (PCSX2 itself shows compatibility ratings once you're in its own list,
  but RetroVerse's picker doesn't know about them).
- **A real "someone else is playing" guard** exists now (`streamNowPlaying`,
  keyed by container, shown in the picker + a confirm() before interrupting)
  but it's informational only, not a lock — nothing stops two requests
  racing.
- **2-player netplay — investigated, not resolved.** Selkies is built as a
  1:1 remote desktop tool (one controlling client), not a broadcast/
  multiplayer platform — there's an open, unresolved upstream issue
  ([selkies#39](https://github.com/selkies-project/selkies-gstreamer/issues/39))
  about exactly this ("multiple users connected simultaneously... isolated
  sessions"). It's genuinely unknown whether two separate browsers
  connecting to the same Selkies session get input routed to *different*
  virtual controllers or collide on the same one — that needs an actual
  two-client test, not something inferable from the code or docs. The
  obvious-looking fallback (reuse this site's own N64-style host-
  authoritative-video netplay: capture the Selkies `<video>` element with
  `captureStream()` and rebroadcast it, forward guest presses over the
  existing datachannel) hits a real wall on the receiving end — there's no
  way to synthesize fake Gamepad API state from JS in a standard browser,
  so a guest's forwarded input can't be turned back into something the
  *host's own* Selkies connection would inject. Any working answer likely
  means both players' input reaching the **same** Selkies session directly
  (server-side), not routed through RetroVerse's browser-side netplay layer
  at all — untested, and the honest next step is trying it with two real
  clients before designing further.
- **Xbox: done** — see `server/selkies-xemu/README.md`. Confirmed working
  end-to-end (BIOS/MCPX/HDD chain, real game booted to its title screen).
- **WiiU (Cemu) and 3DS** — same container shape, not yet built. Cemu ships
  an official AppImage (`cemu-project/Cemu`, e.g. `v2.6`,
  `Cemu-2.6-x86_64.AppImage`) so the source-trust question that blocked
  Switch doesn't apply here. WiiU is meaningfully more GPU-demanding than
  anything tried so far — whether "most of the library at full speed" holds
  needs actually trying it. 3DS needs its own source-verification pass
  first (likely Azahar or Lime3DS as Citra's actual maintained successor —
  not yet researched).
- **Switch: deliberately deferred.** A GitHub search for the current
  yuzu-fork successor ("Eden") turned up SEO-spam repos with keyword-stuffed
  descriptions matching a known malware-impersonation pattern; the
  seemingly-legitimate self-hosted `git.eden-emu.dev` returned HTTP 403
  (likely JS-gated, blocking scrapers) so it couldn't be verified as the
  real source either. Didn't download from any of the unverified ones —
  revisit only once a trustworthy official source can actually be confirmed.
