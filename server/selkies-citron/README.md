# selkies-citron — Nintendo Switch, streamed

The owner's own **Citron** (Windows Canary build 0.6.1, portable folder)
running under **Wine 10** inside a Selkies container, GPU-accelerated (Vulkan
straight through winevulkan to the NVIDIA driver; no DXVK), streamed over
WebRTC. Same outer shape as every other stream. **Read
`../selkies-ps2/README.md` first** for Selkies, nvidia-container-toolkit,
tailscale, the credential scheme and the pkill-self-match trap.

Verified live 2026-10-02: Captain Toad: Treasure Tracker booted into gameplay
fullscreen on the RTX 5070 (Citron log: `Driver: NVIDIA 610.57`, `Vulkan:
1.4.341`, the game's v0.3.0 update applied from the mounted NAND), launched
through arcade-server's `/stream/launch`. Pokémon Let's Go Eevee also booted
(its controller-select screen), which proved apostrophes in filenames work.

## Build

The binaries aren't in git (`citron/` is gitignored). Copy the portable
folder **without** its 62 GB `user/`:

```bash
C="/run/media/shadowswords/Programs and OS/Emulators/Nintendo Switch/Citron-Windows-Canary-Refresh_0.6.1"
rsync -a --exclude user "$C/" server/selkies-citron/citron/
docker build -t selkies-citron:test server/selkies-citron
```

`qt-config.ini` is the owner's own config with every `Y:/…` path rewritten
to the container's mounts (`Z:/` is Wine's view of `/`), recent files
cleared, and Discord presence off. It's baked in, not mounted, so anything
changed inside the container never writes back to the desktop install.

## Run

```bash
U="/run/media/shadowswords/Programs and OS/Emulators/Nintendo Switch/Citron-Windows-Canary-Refresh_0.6.1/user"
docker run --name selkies-citron -d --restart unless-stopped --shm-size=2g \
  -p 127.0.0.1:8098:8080 --gpus all --runtime nvidia -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e SELKIES_BASIC_AUTH_USER=ShadowSwords -e SELKIES_BASIC_AUTH_PASSWORD=Allo1234 \
  -v "$U/nand:/opt/citron/user/nand" \
  -v "$U/keys:/opt/citron/user/keys:ro" \
  -v "$HOME/Games/roms/switch:/home/ubuntu/Games/switch:ro" \
  selkies-citron:test
tailscale serve --bg --https=8731 https+insecure://127.0.0.1:8098
```

- **`nand` is read-write and shared with the desktop install**: saves,
  installed updates and DLC. Don't run a game here and on the desktop
  Citron at the same time.
- `keys` are the owner's own `prod.keys`/`title.keys`, read-only, never baked in.
- **Don't mount `user/load` read-only.** Citron creates
  `load/<title-id>` while booting a game. On a read-only mount it logs
  "Access denied" and then null-derefs (`Unhandled page fault … 0000000000000000`).
  The owner's `load/` was empty, so the container keeps its own.
- Port 8098 is bound to `127.0.0.1` only. Unlike the older containers, it
  isn't on `0.0.0.0`, so tailscale serve is the only way in.
- Tailnet port **8731**: 8728/8729 belong to other services on this host.
- `../selkies-start.service` starts it at boot once the ROM drive is
  mounted. Docker's own restart policy fires too early (see that file).

## Gotchas found building this

1. **The Selkies session runs as root.** Xvfb, openbox, the autostart, and
   every `docker exec` all run as root. Wine refuses a prefix owned by
   anyone else (`'/home/ubuntu/.wine' is not owned by you`). That's why the
   prefix is built as root at `/opt/wineprefix`. Before this fix the
   autostart silently did nothing.
2. **Wine 10's builtin `msvcp140_atomic_wait` lacks
   `__std_tzdb_get_time_zones`**, which Citron calls the moment a game
   boots. The game list worked, but every launch aborted. Fixed by dropping
   Microsoft's real x64 VC++ DLLs (cab `a12` of `vc_redist.x64.exe`) next to
   `citron.exe` with `WINEDLLOVERRIDES=…=n,b`. `winetricks vcrun2022`
   failed here: its pinned checksum is stale (Microsoft updates the
   permalink in place) and its 32-bit installer exits 126.
3. **`.nsz`/`.xcz` aren't supported by this Citron build.** Its own game
   list shows 74 of the 107 files and skips all 33 `.nsz`. arcade-server
   lists only `.nsp`/`.xci`. To play those, decompress them with
   `nsz -D` (needs `prod.keys`) into `.nsp`.
4. `killPattern` is `citron.exe`. Under Wine the process cmdline is the
   `.exe` path, so this matches only the real emulator.

## Not done yet

- **Controller input from the stream is unverified**, the same open gap as
  PS2/GC/Wii/Wii U (see the PS2 README). Player 1 in the copied config is
  bound to the owner's desktop **Switch Pro Controller** (SDL GUID
  `…7e0500000920…`). Selkies presents a virtual **Xbox 360 pad** through its
  LD_PRELOAD interposer, so binding it needs one session with a real
  controller in the browser: open Citron's Controls in the stream, bind,
  then copy the resulting `player_0_*` lines back into `qt-config.ini` and
  rebuild.
- Sustained-play performance through Wine hasn't been measured (it boots
  and renders smoothly at the title, but not benchmarked).
