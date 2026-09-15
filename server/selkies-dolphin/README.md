# GameCube/Wii-in-browser (2026-09-16)

Real Dolphin, GPU-accelerated, streamed over WebRTC by Selkies. Same
architecture as `server/selkies-ps2/` — **read that README first**, it
covers Selkies/`nvidia-container-toolkit`/`tailscale serve` setup, the
shared credential scheme, the `pkill`-self-match trap, and the launch/kill
design in full. This file only covers what's specific to Dolphin.

**Status: live on the site.** Play → "Streamed consoles" → GameCube or Wii.
`gc` and `wii` are two RetroVerse system ids that share **one** Dolphin
container/instance (`STREAM_SYSTEMS.gc`/`.wii` in `arcade-server.mjs`, both
pointing at `container: "selkies-dolphin"`) — launching a Wii game correctly
kills a running GameCube one, since it's the same emulator either way.
Stream URL: `https://retroverse.tail51f9d6.ts.net:8723/` (`tailscale serve
--bg --https=8723 https+insecure://127.0.0.1:8092`), same embedded-credential
scheme as PS2.

## What's running

```
docker run --name selkies-dolphin -d --restart unless-stopped --shm-size=2g \
  -p 8092:8080 \
  --gpus all --runtime nvidia \
  -e SELKIES_BASIC_AUTH_USER=ShadowSwords \
  -e SELKIES_BASIC_AUTH_PASSWORD=Allo1234 \
  -v ~/Games/roms/gc:/home/ubuntu/Games/gc:ro \
  -v ~/Games/roms/wii:/home/ubuntu/Games/wii:ro \
  selkies-dolphin:test
```

No BIOS mount — GameCube boots fine HLE (high-level emulation, no BIOS dump
needed) by default, unlike PS2 which hard-requires one. No writable config
volume either (yet) — Dolphin creates its own default config on first run
inside the container's own filesystem, which is **not persisted** across a
container recreate (fine for now; revisit if per-game settings matter later).

## Dolphin-specific gotchas

- **Ubuntu's own `dolphin-emu` package (universe repo, no PPA needed —
  `apt-get install dolphin-emu` just works) installs and launches, but hangs
  forever on its own splash screen.** The log floods with
  `QObject::connect(...): signal not found` — a Qt6 ABI mismatch between the
  compiled package and the container's system Qt. Confirmed hung 30+ seconds
  on two different games, 0% GPU utilization the whole time (not doing real
  work, just stuck). The **unofficial AppImage**
  ([pkgforge-dev/Dolphin-emu-AppImage](https://github.com/pkgforge-dev/Dolphin-emu-AppImage))
  bundles its own compatible Qt and worked immediately — same
  self-contained-bundle reasoning that already justified PCSX2's AppImage
  over any .deb. **Use the AppImage, not the apt package.**
- **Its AppRun forks+relocates rather than exec-replacing itself** — this is
  *worse* than PCSX2's AppImage in the same respect (which stays visible
  under its own extracted path). Dolphin's real running process shows up as
  `/opt/AppDir/bin/dolphin-emu`, a path that only exists once AppRun has
  actually run and relocated things — not the `dolphin-extracted/` path this
  image extracts it to at build time. This is exactly why the kill mechanism
  matches on `killPattern: "dolphin-emu"` (a stable substring of the real
  running path) rather than a tracked PID — see the PS2 README's gotchas for
  the full story of why PID tracking doesn't work here at all.
- Boot time varies wildly by game — Animal Crossing sat on the Nintendo logo
  for 30+ seconds (its real-time-clock/memory-card check is slow even on
  real hardware); 007: Nightfire reached its own publisher splash in under
  10. Don't read "still on a logo after N seconds" as broken without
  comparing against a snappier title first.

## Verified end-to-end

Launched Animal Crossing (GC) — reached actual rendered 3D gameplay
(character sprites, a house interior), not just a boot logo. Launched 007:
Nightfire (GC) as a relaunch — confirmed via `ps aux` inside the container
that the Animal Crossing process was fully gone and exactly one Nightfire
process existed afterward. Cross-system relaunch also verified: launched a
GameCube game, then a **Wii** game — correctly killed the GameCube one first
(same shared container/kill pattern).

## Known issues (open, from live user testing)

Same as PS2's — see `server/selkies-ps2/README.md`'s "Known issues" section:
**not fullscreen** (fixed — `wmctrl` forcer, see that README's Gotchas),
**controller not detected** (still open — Dolphin's own config needs real
SDL bindings, not yet done), **no on-screen touch controls** (Selkies'
built-in Universal Touch Gamepad overlay answers this but isn't surfaced in
RetroVerse's UI yet).

## Next steps

Same list as `server/selkies-ps2/README.md`'s (box art, a real lock instead
of just a visibility guard, 2-player netplay unresolved) applies here too.
Wii-specific and not yet looked at: whether any titles need NAND/Wii Remote
setup beyond what HLE + Dolphin's default GameCube-controller-as-Wii-input
mapping already covers — untested, only GameCube titles were actually
launched this round.
