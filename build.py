#!/usr/bin/env python3
"""Build a static, browsable web gallery from an ES-DE (EmulationStation Desktop
Edition) library.

Reads:
  ~/ES-DE/gamelists/<system>/gamelist.xml      metadata
  ~/ES-DE/downloaded_media/<system>/<type>/    scraped art (ES-DE convention)

Writes into ./docs :
  data/index.json            systems + counts + genres
  data/<system>.json         per-system game records
  media/<system>/<hash>.webp  optimised card + detail art

The HTML/CSS/JS shell in ./docs is static and checked in; this script only
regenerates data/ and media/.
"""
from __future__ import annotations

import html
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HOME = Path.home()
ESDE = HOME / "ES-DE"
GAMELISTS = ESDE / "gamelists"
MEDIA_SRC = ESDE / "downloaded_media"
ROMS = HOME / "Games" / "roms"  # symlink farm -> game drives; holds ROM-adjacent art

OUT = Path(__file__).parent / "docs"
DATA_OUT = OUT / "data"
MEDIA_OUT = OUT / "media"

# ES-DE downloaded_media subfolders to try, best first.
DL_SOURCES = ["covers", "miximages", "titlescreens", "screenshots", "marquees"]
# gamelist media tags pointing at ROM-adjacent art, best first.
GL_TAGS = ["image", "thumbnail", "marquee"]

IMG_W = 540      # px, single image per game (used for card + detail)
WEBP_Q = 76

# short system id -> pretty name. Falls back to the folder name when missing.
SYSTEM_NAMES = {
    "3do": "Panasonic 3DO",
    "amstradcpc": "Amstrad CPC",
    "apple2": "Apple II",
    "archimedes": "Acorn Archimedes",
    "atari2600": "Atari 2600",
    "atarilynx": "Atari Lynx",
    "bbcmicro": "BBC Micro",
    "cps1": "Capcom Play System",
    "cps2": "Capcom Play System 2",
    "gb": "Nintendo Game Boy",
    "gba": "Nintendo Game Boy Advance",
    "genesis": "Sega Genesis / Mega Drive",
    "gx4000": "Amstrad GX4000",
    "mastersystem": "Sega Master System",
    "model2": "Sega Model 2",
    "model3": "Sega Model 3",
    "n3ds": "Nintendo 3DS",
    "naomi2": "Sega NAOMI 2",
    "naomi_extra": "Sega NAOMI (extra)",
    "naomigd": "Sega NAOMI GD-ROM",
    "neogeo": "SNK Neo Geo",
    "nes": "Nintendo Entertainment System",
    "odyssey2": "Magnavox Odyssey 2",
    "ps2": "Sony PlayStation 2",
    "ps3": "Sony PlayStation 3",
    "ps4": "Sony PlayStation 4",
    "ps5": "Sony PlayStation 5",
    "psp": "Sony PlayStation Portable",
    "psx": "Sony PlayStation",
    "snes": "Super Nintendo",
    "sufami": "SuFami Turbo",
    "switch": "Nintendo Switch",
    "wii": "Nintendo Wii",
    "wiiu": "Nintendo Wii U",
    "x68000": "Sharp X68000",
    "xbox": "Microsoft Xbox",
    "xbox360": "Microsoft Xbox 360",
    "zxspectrum": "Sinclair ZX Spectrum",
}


def text(node: ET.Element, tag: str) -> str:
    el = node.find(tag)
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def rom_stem(path: str) -> str:
    """gamelist <path> -> primary media stem (rom filename without extension)."""
    base = os.path.basename(path.strip().lstrip("./").rstrip("/"))
    return os.path.splitext(base)[0]


def media_candidates(path: str) -> list[str]:
    """ES-DE resolves scraped media a few different ways depending on whether a
    game is a plain file, a file inside region subdirs, or a folder treated as
    one game. Try all of them, most specific first."""
    rel = path.strip().lstrip("./").rstrip("/")
    noext = os.path.splitext(rel)[0]
    cands = [noext, os.path.basename(noext), os.path.dirname(rel)]
    seen, out = set(), []
    for c in cands:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def parse_year(raw: str) -> int | None:
    m = re.match(r"(\d{4})", raw or "")
    if not m:
        return None
    y = int(m.group(1))
    return y if 1950 <= y <= 2035 else None


def find_dl_media(system: str, cands: list[str]) -> Path | None:
    """ES-DE downloaded_media/<system>/<kind>/<stem>.<ext>."""
    for kind in DL_SOURCES:
        d = MEDIA_SRC / system / kind
        if not d.is_dir():
            continue
        for stem in cands:
            for ext in (".png", ".jpg", ".jpeg", ".webp"):
                p = d / f"{stem}{ext}"
                if p.is_file():
                    return p
    return None


def find_gl_media(system: str, g: ET.Element) -> Path | None:
    """Media path stored in the gamelist, relative to the ROM folder."""
    for tag in GL_TAGS:
        rel = text(g, tag)
        if not rel:
            continue
        p = Path(os.path.normpath(ROMS / system / rel.lstrip("./")))
        if p.is_file():
            return p
    return None


def convert(src: Path, dst: Path, width: int) -> bool:
    if dst.exists():
        return True
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "magick", str(src),
        "-auto-orient",
        "-resize", f"{width}x{width}>",
        "-strip",
        "-quality", str(WEBP_Q),
        str(dst),
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.stderr.write(f"  ! convert failed {src}: {r.stderr.decode()[:200]}\n")
        return False
    return True


def slug(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "x"


def main() -> None:
    if not GAMELISTS.is_dir():
        sys.exit(f"no gamelists at {GAMELISTS}")

    fresh = "--keep-media" not in sys.argv
    if fresh and MEDIA_OUT.exists():
        shutil.rmtree(MEDIA_OUT)
    if DATA_OUT.exists():
        shutil.rmtree(DATA_OUT)
    DATA_OUT.mkdir(parents=True)
    MEDIA_OUT.mkdir(parents=True, exist_ok=True)

    systems_index = []
    search_rows: list[list] = []
    convert_jobs: list[tuple[Path, Path, int]] = []

    for sysdir in sorted(GAMELISTS.iterdir()):
        gl = sysdir / "gamelist.xml"
        if not gl.is_file():
            continue
        system = sysdir.name
        try:
            root = ET.parse(gl).getroot()
        except ET.ParseError as e:
            sys.stderr.write(f"skip {system}: {e}\n")
            continue

        games = []
        genres: dict[str, int] = {}
        with_art = 0

        for idx, g in enumerate(root.findall("game")):
            path = text(g, "path")
            name = text(g, "name") or rom_stem(path) or "Unknown"
            cands = media_candidates(path)
            gid = f"{idx:04d}-{slug(cands[0] if cands else name)[:70]}"
            genre = text(g, "genre")
            year = parse_year(text(g, "releasedate"))
            rating = text(g, "rating")
            try:
                rating_val = round(float(rating) * 5, 1) if rating else None
            except ValueError:
                rating_val = None

            rec = {
                "id": gid,
                "name": name,
                "desc": re.sub(r"\s+\n", "\n", text(g, "desc")),
                "genre": genre,
                "year": year,
                "developer": text(g, "developer"),
                "publisher": text(g, "publisher"),
                "players": text(g, "players"),
                "rating": rating_val,
            }

            src = find_dl_media(system, cands) or find_gl_media(system, g)
            if src:
                rec["img"] = f"media/{system}/{gid}.webp"
                convert_jobs.append((src, MEDIA_OUT / system / f"{gid}.webp", IMG_W))
                with_art += 1
            if genre:
                genres[genre] = genres.get(genre, 0) + 1
            games.append(rec)
            # slim global-search row: [name, system, id, year, hasImg]
            search_rows.append(
                [name, system, gid, rec["year"] or 0, 1 if "img" in rec else 0]
            )

        games.sort(key=lambda r: r["name"].lower())
        (DATA_OUT / f"{system}.json").write_text(
            json.dumps(games, ensure_ascii=False, separators=(",", ":"))
        )
        systems_index.append(
            {
                "id": system,
                "name": SYSTEM_NAMES.get(system, system),
                "count": len(games),
                "withArt": with_art,
                "genres": sorted(genres, key=lambda k: -genres[k])[:12],
            }
        )
        print(f"{system:14} {len(games):5} games  {with_art:4} with art")

    systems_index.sort(key=lambda s: s["name"])
    total = sum(s["count"] for s in systems_index)
    search_rows.sort(key=lambda r: r[0].lower())
    (DATA_OUT / "search.json").write_text(
        json.dumps(search_rows, ensure_ascii=False, separators=(",", ":"))
    )
    (DATA_OUT / "index.json").write_text(
        json.dumps(
            {"systems": systems_index, "total": total},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )

    print(f"\n{len(convert_jobs)} images -> webp ...")
    ok = 0
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        for r in ex.map(lambda j: convert(*j), convert_jobs):
            ok += bool(r)
    print(f"  {ok}/{len(convert_jobs)} converted")

    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"\n{total} games across {len(systems_index)} systems")
    print(f"docs/ is {size/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
