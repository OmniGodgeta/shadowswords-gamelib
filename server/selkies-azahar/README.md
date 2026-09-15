# 3DS-in-browser (2026-09-15)

Real Azahar, streamed to any browser tab over WebRTC by
[Selkies](https://docs.selkies.io/). Same architecture as
`server/selkies-ps2/` — **read that README first**. This file only covers
what's specific to Azahar.

**Status: container built, wired into the site, structurally verified —
but no game in the owner's current library can actually be played yet.**
See "The real blocker" below; this is not a bug in the container, it's a
deliberate policy of the Azahar project itself.

## Why Azahar, not Citra

Citra was shut down in 2024 following Nintendo's legal action; **Azahar is
its actual maintained open-source successor** — it started as a fork named
Lime3DS, was briefly rebranded Mandarine, and settled on Azahar, with the
Lime3DS repos now formally archived and development consolidated here.
Verified official org: [azahar-emu/azahar](https://github.com/azahar-emu/azahar)
(actively maintained — the release pinned here was 4 days old at build
time). This is the same kind of source-trust verification that led to
*not* building a Switch container this round — see the PS2 README's "Next
steps" for that reasoning; Azahar cleared the bar Switch's "Eden" didn't.

## What's running

```
docker run --name selkies-azahar -d --restart unless-stopped --shm-size=2g \
  -p 8095:8080 \
  --gpus all --runtime nvidia \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e SELKIES_BASIC_AUTH_USER=ShadowSwords \
  -e SELKIES_BASIC_AUTH_PASSWORD=Allo1234 \
  -v ~/Games/roms/n3ds:/home/ubuntu/Games/n3ds:ro \
  selkies-azahar:test
```

No BIOS or key file mount — unlike PS2/Xbox/WiiU, Azahar's own emulation
doesn't require one. (That almost made this the simplest container yet;
see below for why it isn't.)

## The real blocker — every game in the library is refused

Azahar (like the Citra codebase it's built on, post-2026) shows an
**"Encrypted application"** dialog for essentially all standard retail
`.3ds`/`.cci`/`.cia` dumps: *"Encrypted applications are not supported.
Please check our blog for more info."* This is a **deliberate feature
removal**, announced directly by the Azahar project
([their own post](https://x.com/azaharemu/status/1903231658989588512)):
built-in decryption-key support was pulled for legal-exposure reasons.
Their stated position: `.3ds` files must be renamed to `.cci`, and
encrypted files "must be decrypted manually (if allowed by your
legislation)" — i.e. Azahar will only load a dump that's *already*
decrypted going in, using tools run against the owner's own physical 3DS
(GodMode9 and similar), the same "your own hardware, your own dump" rule as
every BIOS/key file elsewhere in this project, just a heavier lift (a full
decrypt pass over the library, not a single key file).

**Tested, not assumed**: two different games (Resident Evil: Revelations,
Retro City Rampage) both hit the identical error. Also tried the literal
`.3ds`→`.cci` rename Azahar's own announcement describes (via a symlink,
not touching the real file) on the theory that some dumps might already be
decrypted despite the extension — **same error either way**, confirming
the owner's current library is genuinely still encrypted, not just
mis-named. Did not go looking for pre-decrypted dumps from any other
source — that's the same download-provenance line already drawn for BIOS
files and the Switch-emulator decision.

**So right now: nothing in this library launches**, and that's expected
given the above, not a sign anything is misconfigured. This is the most
"structurally complete but content-blocked" of the four Selkies containers
built this round — the pipeline (build, autostart, kill/relaunch,
fullscreen, credential embedding) is the same proven shape as PS2/Dolphin/
xemu/Cemu, just never got to prove itself against an actual playable file.

## Azahar-specific notes

- **CLI is simple**: positional `<path>` + `-f` for fullscreen (`azahar
  --help`, confirmed live) — no BIOS/game-path flag juggling like Cemu's
  `-g`.
- **AppRun exec-replaces itself in place**, like PCSX2/xemu/Cemu (confirmed
  via `ps auxf`) — `killPattern: "azahar-extracted"` is a stable match.
- Logs at `~/.local/share/azahar-emu/log/azahar_log.txt` inside the
  container — useful for confirming *why* something didn't launch (as
  above) rather than guessing from the on-screen dialog alone.
- **GPU rendering not yet confirmed** — every launch attempt errored before
  actually reaching the emulation core, so unlike PS2 (Vulkan)/Dolphin
  (OpenGL)/xemu (llvmpipe, a known issue)/Cemu (Vulkan), there's no log line
  yet showing Azahar's real renderer against a running game. Re-check once
  the key/decryption blocker is cleared.

## Next steps

- **A decrypted library, or the tools/keys to decrypt one** — squarely the
  owner's move, same as WiiU's `keys.txt` gap; nothing to build here until
  that happens.
- Once something actually boots: confirm GPU rendering, screenshot real
  gameplay, and only then consider this container "verified end-to-end"
  the way the other three are.
- Same shared list as `server/selkies-ps2/README.md` otherwise (box art, a
  real lock, 2-player netplay unresolved, controller detection untested).
