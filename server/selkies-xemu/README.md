# Original Xbox-in-browser (2026-09-15)

Real xemu, streamed to any browser tab over WebRTC by
[Selkies](https://docs.selkies.io/). Same architecture as
`server/selkies-ps2/` — **read that README first**, it covers
Selkies/`nvidia-container-toolkit`/`tailscale serve` setup, the shared
credential scheme, the `pkill`-self-match trap, and the launch/kill design
in full. This file only covers what's specific to xemu.

**Status: live on the site.** Play → "Streamed consoles" → Xbox. `xbox` is
RetroVerse's system id (`STREAM_SYSTEMS.xbox` in `arcade-server.mjs`,
`container: "selkies-xemu"`). Stream URL:
`https://retroverse.tail51f9d6.ts.net:8724/` (`tailscale serve --bg
--https=8724 https+insecure://127.0.0.1:8093`), same embedded-credential
scheme as PS2/Dolphin.

xemu ships an **official** AppImage per release
([xemu-project/xemu](https://github.com/xemu-project/xemu) on GitHub) — a
verified official org, unlike the current Switch-emulator landscape, which
is full of SEO-spam repos impersonating real projects (see the PS2 README's
"Next steps" for why Switch was deliberately skipped this round).

## What's running

```
docker run --name selkies-xemu -d --restart unless-stopped --shm-size=2g \
  -p 8093:8080 \
  --gpus all --runtime nvidia \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e SELKIES_BASIC_AUTH_USER=ShadowSwords \
  -e SELKIES_BASIC_AUTH_PASSWORD=Allo1234 \
  -v "<path to your own mcpx_1.0.bin>:/home/ubuntu/xbox-bios/mcpx_1.0.bin:ro" \
  -v "<path to your own Complex_4627.bin>:/home/ubuntu/xbox-bios/Complex_4627.bin:ro" \
  -v selkies-xemu-hdd:/home/ubuntu/xbox-bios \
  -v ~/Games/roms/xbox:/home/ubuntu/Games/xbox:ro \
  selkies-xemu:test
```

- Image built from `Dockerfile` in this directory (extends
  `ghcr.io/selkies-project/selkies/desktop:main-ubuntu26.04`, adds the
  official xemu AppImage — **extracted at build time**, same reasoning as
  PS2/Dolphin — autostarts it via `xemu.desktop`).
- **BIOS/MCPX/HDD are the same legal category as the PS2 BIOS**: your own
  console dumps, never bundled in the image, always supplied at container-run
  time. The owner already had a working Windows-xemu install with these
  files present — reused, not resourced from anywhere else.
- The HDD image (`xbox_hdd.qcow2`, writable Xbox dashboard/save state) is
  **not** bind-mounted directly from the original file — see Gotchas below
  for why, and the one-time copy-into-a-named-volume step that avoids ever
  risking corrupting the user's original.
- `SELKIES_BASIC_AUTH_USER`/`_PASSWORD` and `~/Games/roms/xbox` follow the
  exact same pattern as PS2/Dolphin — see that README if anything here is
  unclear.

## xemu-specific gotchas

- **Config file location is not "next to the AppImage" (portable mode).**
  Placing a `xemu.toml` next to the extracted `AppRun` binary was silently
  ignored — the log said "Config file not found" every single launch despite
  the file being right there. xemu actually reads from
  `~/.local/share/xemu/xemu/xemu.toml`. Confirmed the hard way, fixed by
  baking the file into that exact path via the Dockerfile (`RUN mkdir -p
  ~/.local/share/xemu/xemu` + `COPY xemu.toml ...` + `RUN chown -R
  ubuntu:ubuntu ~/.local`, all still as `USER root`, before the final `USER
  ubuntu`) so it survives container recreates — an earlier manual runtime
  fix was lost the first time the container got recreated.
- **The original HDD image can't be bind-mounted read-write directly if it's
  also the file the user's Windows xemu install uses** — bind-mounting it
  `:ro` (the safe default for "don't ever risk the original") then fails
  with `Could not open '...xbox_hdd.qcow2': Read-only file system` the
  moment xemu tries to write to it (which it does immediately, dashboard
  state). Fixed by copying the original **once** into a separate
  Docker-managed named volume (`selkies-xemu-hdd`) via a one-off `docker run
  --rm -v selkies-xemu-hdd:/dst -v <original>:/src:ro alpine cp /src
  /dst/xbox_hdd.qcow2`-style step, then mounting *that volume*
  read-write — the user's original file is never opened for writing, ever.
- **"Failed to get 'write' lock. Is another process using the image?"** — hit
  once after an improperly-killed test run left a stray xemu process still
  holding the qcow2 lock. `ps aux | grep xemu` inside the container found
  and killed it; a clean `killPattern`-based relaunch (see below) doesn't hit
  this in normal use, only really-abnormal states like a container-level
  crash mid-session.
- **AppRun exec-replaces itself in place, like PCSX2 — unlike Dolphin.**
  Confirmed via `ps auxf` inside the running container: exactly one process,
  shown as `/opt/xemu-extracted/AppRun -full-screen -dvd_path ...`, not
  reparented to init. So `killPattern: "xemu-extracted"` in
  `arcade-server.mjs` is a stable match with no fork/relocate trap to worry
  about (contrast with Dolphin's README, which explains why its own
  `killPattern` had to target a *different* relocated path).
- **Renders in software (`GL_RENDERER: llvmpipe`), not hardware-accelerated,
  and this is still unresolved.** Unlike PCSX2 (got real Vulkan) and Dolphin
  (got real Mesa/NVIDIA OpenGL), xemu inside this container falls back to
  llvmpipe. Tried adding `-e NVIDIA_DRIVER_CAPABILITIES=all` — rebuilt,
  retested, **still llvmpipe**, so that alone doesn't fix it. The game still
  boots and renders correctly (confirmed via screenshot — 007: Nightfire
  reached its title screen) — just presumably slower than GPU-accelerated
  would be. Worth investigating: whether xemu's Vulkan renderer needs to be
  explicitly selected in `xemu.toml` (`[display.window] fullscreen` /
  renderer settings), or whether it's a GL context/EGL selection issue
  specific to how Selkies' virtual display advertises itself.

## Verified end-to-end

Launched **007: Nightfire** — booted through xemu, BIOS/MCPX/HDD chain all
loaded correctly, reached the game's own "Press START" title screen
(confirmed via screenshot). Relaunch verified clean via `ps auxf` inside the
container: launching a second game correctly killed the first (exactly one
xemu process after each launch, no orphans). Reachable over the tailnet at
the trusted-cert `tailscale serve` URL with embedded credentials (`curl`
confirmed `HTTP 200`, no browser prompt).

## Next steps

Same shared list as `server/selkies-ps2/README.md`'s Next steps (2-player
netplay unresolved — worth noting xemu has **no native netplay at all**,
unlike Dolphin, so any multiplayer answer here leans entirely on whatever
Selkies-level multi-client answer eventually comes out of that
investigation). Xemu-specific and still open:

- **Software rendering (llvmpipe) instead of GPU-accelerated** — see
  Gotchas above. Not blocking (games run, just presumably slower), but
  worth real investigation rather than leaving as-is indefinitely.
- **Controller detection** — not yet tested with xemu specifically (PS2/GC/
  Wii's controller gap is documented as open in the PS2 README; xemu's own
  input config hasn't been looked at at all yet).
- No box art / real per-game metadata in the picker yet, same gap as every
  other streamed system.
