# WiiU-in-browser (2026-09-15)

Real Cemu, GPU-accelerated (Vulkan on the RTX 5070), streamed to any browser
tab over WebRTC by [Selkies](https://docs.selkies.io/). Same architecture as
`server/selkies-ps2/` — **read that README first**. This file only covers
what's specific to Cemu.

**Status: live on the site**, with a real, verified limitation on part of
the library — see "What actually plays" below before assuming a game that
won't launch is broken. Play → "Streamed consoles" → Wii U. Stream URL:
`https://retroverse.tail51f9d6.ts.net:8725/` (`tailscale serve --bg
--https=8725 https+insecure://127.0.0.1:8094`), same embedded-credential
scheme as PS2/Dolphin/xemu.

## Security note — read before touching the pinned version

The Linux AppImage/zip assets attached to the **official** Cemu 2.6 GitHub
release were compromised with credential-stealing malware between
2026-05-06 and 2026-05-12 (Cemu team confirmed; Windows/macOS/Flatpak were
untouched). The Dockerfile pins both the exact version **and** a sha256
digest (`CEMU_SHA256`) for `Cemu-2.6-x86_64.AppImage`, taken from GitHub's
own asset metadata — that digest corresponds to the asset re-uploaded
**2026-05-12** (the post-incident clean replacement), not the compromised
one, verified via `gh api repos/cemu-project/Cemu/releases/tags/v2.6 --jq
'.assets[] | {name,digest,updated_at}'` before ever using it. The build
fails closed (`sha256sum -c -`) if the download ever doesn't match. If you
ever bump `CEMU_VERSION`, re-derive the digest from GitHub's API the same
way rather than trusting whatever the new AppImage's own reported hash is.

## What's running

```
docker run --name selkies-cemu -d --restart unless-stopped --shm-size=2g \
  -p 8094:8080 \
  --gpus all --runtime nvidia \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e SELKIES_BASIC_AUTH_USER=ShadowSwords \
  -e SELKIES_BASIC_AUTH_PASSWORD=Allo1234 \
  -v "<path to your own keys.txt>:/home/ubuntu/.config/Cemu/keys.txt:ro" \
  -v "<path to your own keys.txt>:/home/ubuntu/.config/Cemu/keys/keys.txt:ro" \
  -v "<path to your own keys.txt>:/home/ubuntu/.local/share/Cemu/keys.txt:ro" \
  -v "<path to your own keys.txt>:/home/ubuntu/.local/share/Cemu/keys/keys.txt:ro" \
  -v ~/Games/roms/wiiu:/home/ubuntu/Games/wiiu:ro \
  selkies-cemu:test
```

Same "your own dump, mounted, never bundled" rule as every BIOS/key file
elsewhere in this project — `keys.txt` holds title decryption keys derived
from the owner's own Wii U, never sourced from anywhere else. It's mounted
at **four** paths because sources disagree on where Cemu actually reads it
from and being wrong is silent (Cemu just says "could not decrypt", not
"keys.txt not found") — see Gotchas.

## What actually plays — the real, verified limitation

Wii U games on disk come in two shapes, and only one of them works out of
the box:

- **"loadiine"-style extracted dumps** (a folder with `code/`, `content/`,
  `meta/` subfolders — the majority of a typical library, e.g. Bayonetta,
  Hyrule Warriors, Mario Kart 8) are **pre-decrypted** and launch straight
  through Cemu with no key needed at all. **Verified end-to-end**: Bayonetta
  and Hyrule Warriors both booted to real rendered 3D gameplay via the
  actual `/stream/launch` API, Vulkan confirmed active
  (`Using GPU: NVIDIA GeForce RTX 5070` in Cemu's own log).
- **Single-file disc images** (`.wud`/`.wux`, e.g. a straight disc dump like
  "Amazing Spider-Man 2 The (USA) (EnFr).wux") are **encrypted** and need a
  real per-title (or common) key in `keys.txt` — Cemu's own error is exact
  and unambiguous: *"Could not decrypt title. Make sure that keys.txt
  contains the correct disc key for this title."* The owner's current
  `keys.txt` only has the **placeholder example key that ships in Cemu's
  own template** (`541b9889519b27d363cd21604b97c67a # example key (can be
  deleted)`) — not a real one. This is a genuine, unresolved gap, not a
  container bug: a real key can only come from the owner's own Wii U
  hardware (the same "your own dump" rule as every other BIOS/key file in
  this project) — did not search for or insert one from anywhere else.

So right now: loadiine-format games in the library play immediately;
`.wud`/`.wux` disc dumps won't until a real key is added to `keys.txt`.

## Cemu-specific gotchas

- **`~/.local/share/Cemu/` is NOT where keys.txt goes**, despite that being
  what most current web guides say. Confirmed the hard way: Cemu 2.6
  actually reads (and writes its own settings) from **`~/.config/Cemu/`**
  (`~/.config/Cemu/keys.txt`, verified via the exact "could not decrypt"
  error appearing — meaning it *did* find and parse the file — only once
  mounted there). Both locations get a `keys/` subfolder pre-created at
  build time and the same host file gets bind-mounted onto all four
  candidate paths at runtime, since covering the wrong one costs nothing.
- **The first-run "Getting started" wizard has no CLI/env skip flag**, and
  blocks even a direct `-g <path>` launch behind it — confirmed live,
  `docker exec ... AppRun -g <game> -f` just shows the wizard, not the
  game, on a fresh container. No documented way to script past it. Fixed
  the same way as xemu's config: click through it once for real (the
  "Start games with fullscreen" checkbox is worth checking while there),
  then `docker cp` the resulting `~/.config/Cemu/settings.xml` out and bake
  it into the image (`COPY settings.xml ...` in the Dockerfile) so every
  future container starts past it already.
- **AppRun exec-replaces itself in place**, like PCSX2/xemu — confirmed via
  `ps auxf` (`/opt/cemu-extracted/AppRun.wrapped`, not reparented to init).
  `killPattern: "cemu-extracted"` is a stable match, no relocate trap.
- **Loadiine-format games need a different launch path than the folder
  itself** — Cemu's `-g` wants the actual `.rpx` inside `<folder>/code/`,
  not the folder. `STREAM_SYSTEMS.wiiu.resolveLaunchPath` in
  `arcade-server.mjs` (a small generic hook `launchStreamGame` calls when a
  system defines it) finds that `.rpx` at request time; `folderMarker:
  "code"` in the same config tells `listStreamGames` to treat a directory
  containing a `code/` subfolder as one game rather than recursing into it.
- **"Encrypted disc" errors are exact, not vague** — Cemu tells you
  precisely that it's a key problem, not a corrupt-file or wrong-format
  problem. Don't mistake it for a container/mount issue; it's real and
  matches the theory above every single time it was tested.

## Verified end-to-end

Bayonetta and Hyrule Warriors (both loadiine-format) launched through the
real `/stream/launch` HTTP endpoint (not just a manual `docker exec`),
reached actual rendered 3D gameplay, Vulkan-on-RTX-5070 confirmed in Cemu's
own log. Relaunch verified clean (`ps auxf` showed exactly one Cemu process
after the second launch replaced the first). A `.wux` disc image
(Amazing Spider-Man 2) correctly and predictably failed on the missing-key
case described above — not a crash, a clean, on-screen, well-worded error.

## Next steps

- **A real common/title key** — the owner's move; would unlock every
  `.wud`/`.wux` disc dump in the library at once (it's the same key across
  titles for Wii U discs, unlike per-title-only schemes).
- **Controller detection** — not yet tested at all for Cemu specifically
  (the PS2/GC/Wii gap is documented in the PS2 README; Cemu's own gamepad
  config hasn't been looked at).
- Same shared list as `server/selkies-ps2/README.md` otherwise (box art,
  a real lock, 2-player netplay unresolved — worth noting Cemu's own
  netplay-adjacent multiplayer options haven't been investigated either).
