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
  -v "/run/media/shadowswords/Game SSD/Switch (decompressed NSZ):/home/ubuntu/Games/switch-nsp:ro" \
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
3. **`.nsz`/`.xcz` aren't supported by this Citron build** (nor by the
   owner's newer Citron "Nightly 21.0.0", tested 2026-10-02: also 74/74).
   All 33 are decompressed losslessly (`nsz -D --keys <owner's prod.keys>`,
   venv `~/.local/share/nsz-venv`) into `/run/media/shadowswords/Game
   SSD/Switch (decompressed NSZ)/`. It's mounted read-only at
   `/home/ubuntu/Games/switch-nsp` and listed as `Decompressed/…` via
   `extraRoots` in arcade-server. The NTFS library is untouched; it's 95%
   full, so the copies live on the Game SSD. Earlier note: Its own game
   list shows 74 of the 107 files and skips all 33 `.nsz`. arcade-server
   lists only `.nsp`/`.xci`. To play those, decompress them with
   `nsz -D` (needs `prod.keys`) into `.nsp`.
4. `killPattern` is `citron.exe`. Under Wine the process cmdline is the
   `.exe` path, so this matches only the real emulator.

## Not done yet

- ~~Controller input unverified.~~ **Works (2026-10-02).** Toad walked when
  the virtual pad's stick was held. Chain: Selkies pad, interposer
  (`SESSION_ENV`), Wine's winebus SDL backend, XInput, then Citron's SDL2.
  Citron turns SDL **RawInput off**, so it sees the XInput driver, and it
  writes the GUID with the name-CRC bytes zeroed:
  **`030000005e0400008e02000014017801`**, players told apart by `port:0-3`.
  Raw indices: buttons A0 B1 X2 Y3 LB4 RB5 Back6 Start7 LS8 RS9 Guide10,
  D-pad `hat:0`, axes LX0 LY1 **LT2** RX3 RY4 RT5. All 4 players are bound,
  Pro Controller type, player 1 connected. Gotcha: every key has a
  `key\default=true` companion that makes Citron ignore your value, and it
  re-saves the whole file on each boot. Edit a value and its `\default=false`
  together. Pokémon Let's Go rejects the Pro Controller (Joy-Con/handheld
  only). That's the game, not the setup.
- Sustained-play performance through Wine hasn't been measured (it boots
  and renders smoothly at the title, but not benchmarked).
