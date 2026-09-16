# 3DS-in-browser, take two (2026-09-16)

**This is the active n3ds backend** (`server/selkies-azahar/` is built but
stopped — read that README first for why, this one only covers what's
different). Real [Panda3DS](https://github.com/wheremyfoodat/Panda3DS)
(internal name "Alber"), streamed over WebRTC via Selkies.

## Why a second 3DS emulator

Azahar (Citra's actual maintained successor) refuses every encrypted ROM —
confirmed to be a **permanent, deliberate policy of that entire codebase
lineage**, not a config gap: `gh api repos/azahar-emu/azahar/releases`
shows "Support for encrypted applications has been dropped" in `2120-rc1`,
the **very first** release in that repo's history. Tested both the latest
(2126.1.1) and the version sitting next to the owner's own `aes_keys.txt`
(2126.0) with that real key file mounted at the documented path — identical
refusal on both. There is no version of Azahar to install that has this
back; it predates the repo.

Panda3DS is **not a Citra fork** — a from-scratch reimplementation (real,
active project: [wheremyfoodat/Panda3DS](https://github.com/wheremyfoodat/Panda3DS),
1.4k stars, a commit landed 5 weeks before this was built) — so it was
never subject to whatever legal reasoning led Citra's lineage to drop
decryption, and it still supports encrypted ROMs the classic way, via a
user-supplied `sysdata/aes_keys.txt`. **Verified live**: mounted the
owner's real key file (already sitting in their `Nintendo 3DS` emulator
folder, used with some other/older setup) and a real encrypted `.3ds` dump
reached the genuine 3DS **"AUTOSAVE WARNING — do not remove any storage
devices..."** boot screen — unambiguous proof of successful decryption,
something Azahar never got close to for the exact same file.

## What's running

```
docker run --name selkies-panda3ds -d --restart unless-stopped --shm-size=2g \
  -p 8097:8080 \
  --gpus all --runtime nvidia \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e SELKIES_BASIC_AUTH_USER=ShadowSwords \
  -e SELKIES_BASIC_AUTH_PASSWORD=Allo1234 \
  -v "<path to your own aes_keys.txt>:/home/ubuntu/.local/share/Alber/sysdata/aes_keys.txt:ro" \
  -v ~/Games/roms/n3ds:/home/ubuntu/Games/n3ds:ro \
  selkies-panda3ds:test
```

`aes_keys.txt` is the same legal category as every other BIOS/key file in
this project — the owner's own console's keys, never bundled, always
mounted read-only.

## Panda3DS-specific gotchas

- **No official Linux binary newer than v0.9 (Dec 2024)** — development
  continues on `main` (a commit 5 weeks before this was built) but hasn't
  been tagged/released since. Used the latest official tagged release
  rather than building from source. GitHub never computed a content digest
  for this old asset (added to the API later), so the sha256 pinned in the
  Dockerfile is simply what was actually downloaded and verified locally,
  not an official published hash — re-derive it yourself with `sha256sum`
  if `ZIP_URL` ever changes.
- **The zip contains an AppImage** (`Alber-x86_64.AppImage`), not a raw
  binary — same extract-once-at-build-time treatment as every other
  emulator here (`--appimage-extract`, reference `AppRun` directly).
  `mv squashfs-root/* .` **fails on hidden AppImage metadata files**
  (`rmdir: Directory not empty`) — rename the whole `squashfs-root`
  directory instead of trying to flatten it, same fix already documented
  implicitly by every other Dockerfile here just never needing to be
  written down until this one broke it.
- **CLI is a bare positional path** — `AppRun <rom path>`, confirmed from
  source (`src/panda_qt/main_window.cpp`: `QCoreApplication::arguments()`,
  `args.at(1)`) rather than by guessing, since `--help` hangs (tries to
  init the Qt GUI even for `--help`, with nothing to show it against
  outside a real DISPLAY). No fullscreen CLI flag — relies entirely on the
  shared `wmctrl` `FULLSCREEN_FORCER` loop, same as everything else here.
- **AppRun.wrapped stays under its own extracted path** (confirmed via
  `ps auxf`: `/opt/panda3ds-extracted/AppRun.wrapped <rompath>`, not
  reparented/relocated) — despite the ".wrapped" naming looking like
  Dolphin's fork-and-relocate case, this one behaves like Cemu/PCSX2/xemu:
  `killPattern: "panda3ds-extracted"` is a stable match.
- **Renders in software (llvmpipe), not hardware-accelerated** — same
  category of open issue as xemu's. The log shows `X11 Error:
  GLXBadFBConfig` immediately before falling back
  (`GL_RENDERER: llvmpipe`), on the exact same base image/GPU that gives
  PCSX2 real Vulkan and Dolphin/Cemu real OpenGL — so it's something about
  how this Qt build negotiates its GLX framebuffer config, not a
  driver-availability problem. Not investigated further this round.
  Config has `Renderer = "opengl"` in `~/config.toml`; unclear from a quick
  look whether this v0.9 Linux build even ships a Vulkan backend, or
  whether one exists but needs explicit selection.

## Verified, honestly

**Decryption/boot: yes, unambiguously** — the real "AUTOSAVE WARNING" 3DS
system screen appeared for Retro City Rampage, both from a direct
`docker exec` test and through the real `/stream/launch` HTTP API.
**Sustained gameplay: not yet confirmed** — llvmpipe is extremely CPU-heavy
(observed 500-600% CPU) and a follow-up screenshot of the same session (and
a separate attempt with Resident Evil: Revelations) showed a solid black
screen rather than visible gameplay. Could be: still slowly rendering an
early dark cutscene under software rendering, a renderer-specific black-
screen bug in this build, or something else not yet isolated. Don't take
"boots past the encryption/autosave screen" as "confirmed playable" the way
PS2/GC/Xbox/WiiU were — this one needs a longer real session (and ideally
the GPU-rendering issue fixed first) before making that claim.

## Next steps

- **Fix GPU rendering** (see GLXBadFBConfig above) — the actual FPS-at-scale
  question depends entirely on this; software rendering may simply be too
  slow to be enjoyable regardless of correctness.
- **Confirm sustained gameplay**, not just the boot screen, once rendering
  is sorted.
- Same shared list as `server/selkies-ps2/README.md` otherwise (box art, a
  real lock, 2-player netplay unresolved, controller detection untested).
