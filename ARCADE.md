# Getting arcade games to actually run

Arcade emulation in the browser (EmulatorJS) is the one area that mostly
*doesn't* "just work", and it's not a bug in this site — it's romset versioning.

## Why it fails

EmulatorJS bundles **two** arcade cores, each pinned to one exact romset version:

| System on the site | Core | Romset it needs |
|--------------------|------|-----------------|
| Arcade (MAME) | `mame2003-plus` | **MAME 0.78** ("2003-plus") sets |
| Neo Geo, CPS1, CPS2 | `fbneo` | **FBNeo** sets from roughly the same era as the core build |

A modern collection is almost always MAME 0.24x or current-FBNeo. Loading one of
those gives *"missing files for THIS version of MAME/FBNeo"* or a silent drop to
the core menu. The ROM isn't broken — it's the wrong edition.

## Fixing it

1. **Get a MAME 0.78 / 2003-plus romset.** Search for "MAME 2003-Plus reference
   romset" — it's a well-known, fixed list (~2600 games). Put those `.zip` files
   (keep them zipped, keep the exact filenames like `mslug.zip`) in
   `~/Games/roms/mame/`.
2. **BIOS files matter.** `neogeo.zip` (the 2003-plus version) must sit alongside
   the games for any Neo Geo title. CPS games don't need a separate BIOS.
3. Re-run `python3 build.py` and the games become playable.
4. For FBNeo (Neo Geo / CPS), you need FBNeo sets matching EmulatorJS's build.
   The pragmatic move is to route Neo Geo through `mame2003-plus` instead — it
   plays most of the library and only needs the one romset above. To do that,
   change `neogeo` / `cps1` / `cps2` in `build.py`'s `EMU_CORE` from `"arcade"`
   to `"mame"` and supply 2003-plus sets for them.

## Free / homebrew arcade (works out of the box)

If you just want *something* on the arcade shelf that always runs, these are
freely redistributable and load in `mame2003-plus` or `fbneo`:

- **Gridlee** (`gridlee.zip`) — 1982, released to the public domain by the authors.
- **Robby Roto** (`robby.zip`) — Bally/Midway released it freely.
- **Teeter Torture** (`teetert.zip`) — prototype, public domain.
- **Poly-Play** (`polyplay.zip`) — East German arcade machine, abandonware.
- **Homebrew CPS/NeoGeo demos** from the FBNeo homebrew list.

Drop those into `~/Games/roms/mame/` and they'll work without hunting a full
romset.
