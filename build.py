#!/usr/bin/env python3
"""Build the shadowswords arcade browse data from the ES-DE library.

Enumerates every system under ~/Games/roms (the ES-DE symlink farm — ~105
consoles), lists the ROM files in each, and merges in whatever metadata /
box-art the ES-DE gamelists have scraped for the systems that were scraped.

Writes into ./docs :
  data/systems.json          [{id,name,count,logo,withArt,genres,playable}]
  data/<system>.json         per-system [{id,name,year,genre,desc?,img?,...}]
  data/search.json           slim global index [[name,sys,id,year,hasImg]]
  media/logos/<id>.webp      console logo (from the cathode theme, resized)
  media/<system>/<id>.webp   box art (only for scraped systems)
"""
from __future__ import annotations

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
ROMS = HOME / "Games" / "roms"
LOGOS_SRC = ESDE / "themes" / "cathode-es-de" / "_inc" / "systems" / "logos"

OUT = Path(__file__).parent / "docs"
DATA_OUT = OUT / "data"
MEDIA_OUT = OUT / "media"

DL_SOURCES = ["covers", "miximages", "titlescreens", "screenshots", "marquees"]
GL_TAGS = ["image", "thumbnail", "marquee"]

IMG_W = 540
LOGO_W = 480
WEBP_Q = 76

# ---- ROM scanning --------------------------------------------------------
JUNK_EXT = {
    ".txt", ".nfo", ".md", ".xml", ".dat", ".jpg", ".jpeg", ".png", ".webp",
    ".gif", ".bmp", ".pdf", ".sav", ".srm", ".state", ".cfg", ".ini", ".db",
    ".json", ".log", ".bak", ".md5", ".sha1", ".aux", ".doc", ".url", ".lnk",
    ".ips", ".bps", ".ups", ".xdelta", ".scr", ".pok", ".hlp", ".reu", ".sub",
    ".exe", ".dll", ".so", ".ico", ".part", ".!ut", ".torrent",
}
JUNK_DIR = {
    "media", "images", "videos", "manuals", "downloaded_media", "bezels",
    "overlays", "cheats", "saves", "states", "patches", "artwork", "snaps",
    "titles", "boxart", "box", "marquees", "wheels", "screenshots", "covers",
    "gamelists", "system", "bios", "__macosx",
}
# a .bin/.iso/.img next to a .cue/.gdi/.m3u of the same stem is a track, not a game
DISC_INDEX = {".cue", ".gdi", ".m3u", ".ccd"}
DISC_TRACK = {".bin", ".iso", ".img", ".raw"}
DISC_RE = re.compile(r"\s*[\(\[](disc|disk|side|track|cd)\s*\w+[\)\]]", re.I)


def scan_system(root: Path) -> list[str]:
    """Return one representative rom path per distinct game under a system dir.

    Collapses format variants (game.tap / game.z80), regions/revisions, and
    multi-disc sets onto a single entry. A sub-folder holding just a few rom
    files is treated as one game (folder name); a folder holding many is a
    region/category bucket and its files are keyed individually.
    """
    by_dir: dict[str, list[str]] = {}      # dirpath -> [rel rom paths]
    disc_stems: set[str] = set()

    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        parts = Path(dirpath).relative_to(root).parts
        if len(parts) >= 3:
            dirnames[:] = []
        dirnames[:] = [d for d in dirnames if d.lower() not in JUNK_DIR and not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            ext = os.path.splitext(fn)[1].lower()
            if not ext or ext in JUNK_EXT:
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), root)
            by_dir.setdefault(dirpath, []).append(rel)
            if ext in DISC_INDEX:
                disc_stems.add(os.path.splitext(rel)[0])

    games: dict[str, str] = {}             # game key -> representative rel path

    def add(key: str, rel: str):
        ext = os.path.splitext(rel)[1].lower()
        cur = games.get(key)
        if cur is None or (
            os.path.splitext(cur)[1].lower() in DISC_TRACK and ext in DISC_INDEX
        ):
            games[key] = rel

    for dirpath, rels in by_dir.items():
        is_root = dirpath == str(root)
        rom_rels = [r for r in rels
                    if not (os.path.splitext(r)[1].lower() in DISC_TRACK
                            and os.path.splitext(r)[0] in disc_stems)]
        if not is_root and len(rom_rels) <= 4:
            # folder = one game
            gname = os.path.basename(dirpath)
            key = DISC_RE.sub("", strip_tags(gname)).strip().lower() or gname.lower()
            add(key, sorted(rom_rels or rels)[0])
        else:
            for rel in rom_rels:
                base = os.path.basename(os.path.splitext(rel)[0])
                key = DISC_RE.sub("", strip_tags(base)).strip().lower() or base.lower()
                add(key, rel)
    return sorted(games.values())


_TAGS_RE = re.compile(
    r"\s*[\(\[](U|E|J|JU|W|NA|EU|JP|USA|Europe|Japan|World|En|Fr|De|Es|It|Ja|"
    r"Rev [0-9A-F]|v[0-9][0-9.]*|!|b[0-9]*|a[0-9]*|f[0-9]*|h[0-9]*|o[0-9]*|p[0-9]*|"
    r"proto\w*|beta\w*|sample|demo|unl|unlicensed|aftermarket|hack|pirate|bad ?dump|"
    r"alt\w*|fix\w*|tr[ _-]?en|english|translat\w*|ntsc\w*|pal\w*|gc[0-9]*)[^\)\]]*[\)\]]",
    re.I,
)


def strip_tags(name: str) -> str:
    n = _TAGS_RE.sub(" ", name)
    n = re.sub(r"\s{2,}", " ", n).strip(" -_.")
    return n


def clean_name(rel: str) -> str:
    n = os.path.splitext(os.path.basename(rel.rstrip("/")))[0]
    return strip_tags(n) or os.path.basename(rel.rstrip("/"))


# ---- system names + logo aliases --------------------------------------
SYSTEM_NAMES = {
    "3do": "Panasonic 3DO", "aleck64": "Aleck64", "amiga": "Commodore Amiga",
    "amiga500": "Commodore Amiga 500", "amstradcpc": "Amstrad CPC", "apple2": "Apple II",
    "arcadia": "Emerson Arcadia 2001", "archimedes": "Acorn Archimedes",
    "atari2600": "Atari 2600", "atari5200": "Atari 5200", "atari7800": "Atari 7800",
    "atari800": "Atari 800", "atarijaguar": "Atari Jaguar", "atarijaguarcd": "Atari Jaguar CD",
    "atarilynx": "Atari Lynx", "atarist": "Atari ST", "atomiswave": "Sammy Atomiswave",
    "bbcmicro": "BBC Micro", "c64": "Commodore 64", "cdtv": "Commodore CDTV",
    "channelf": "Fairchild Channel F", "coco": "TRS-80 Color Computer",
    "colecovision": "ColecoVision", "cps1": "Capcom Play System", "cps2": "Capcom Play System 2",
    "crvision": "VTech CreatiVision", "dos": "MS-DOS", "dreamcast": "Sega Dreamcast",
    "electron": "Acorn Electron", "fds": "Famicom Disk System", "gamecom": "Tiger Game.com",
    "gamegear": "Sega Game Gear", "gb": "Nintendo Game Boy", "gba": "Game Boy Advance",
    "gbc": "Game Boy Color", "gc": "Nintendo GameCube", "genesis": "Sega Genesis",
    "gmaster": "Hartung Game Master", "gx4000": "Amstrad GX4000", "intellivision": "Mattel Intellivision",
    "mame": "Arcade (MAME)", "mastersystem": "Sega Master System", "megadrive": "Sega Mega Drive",
    "megadrivejp": "Sega Mega Drive (JP)", "megaduck": "Mega Duck", "model2": "Sega Model 2",
    "model3": "Sega Model 3", "moto": "Thomson MO/TO", "msx": "MSX", "msx1": "MSX",
    "msx2": "MSX2", "n3ds": "Nintendo 3DS", "n64": "Nintendo 64", "n64dd": "Nintendo 64DD",
    "naomi": "Sega NAOMI", "naomi2": "Sega NAOMI 2", "naomi_extra": "Sega NAOMI (extra)",
    "naomi-files": "Sega NAOMI (support)", "naomigd": "Sega NAOMI GD-ROM", "nds": "Nintendo DS",
    "neogeo": "SNK Neo Geo", "neogeocd": "SNK Neo Geo CD", "nes": "Nintendo Entertainment System",
    "ngage": "Nokia N-Gage", "ngp": "SNK Neo Geo Pocket", "ngpc": "Neo Geo Pocket Color",
    "odyssey2": "Magnavox Odyssey 2", "oric": "Oric", "pcecd": "PC Engine CD",
    "pcengine": "NEC PC Engine", "pcfx": "NEC PC-FX", "pico": "Sega Pico", "plus4": "Commodore Plus/4",
    "pokemini": "Pokémon Mini", "ps2": "Sony PlayStation 2", "ps3": "Sony PlayStation 3",
    "ps4": "Sony PlayStation 4", "ps5": "Sony PlayStation 5", "psp": "PlayStation Portable",
    "psvita": "PlayStation Vita", "psx": "Sony PlayStation", "pv1000": "Casio PV-1000",
    "samcoupe": "SAM Coupé", "satellaview": "Satellaview", "scv": "Epoch Super Cassette Vision",
    "sega32x": "Sega 32X", "segacd": "Sega CD", "sg-1000": "Sega SG-1000", "snes": "Super Nintendo",
    "sufami": "SuFami Turbo", "supergrafx": "NEC SuperGrafx", "supervision": "Watara Supervision",
    "supracan": "Super A'Can", "switch": "Nintendo Switch", "tg-cd": "TurboGrafx-CD",
    "tic80": "TIC-80", "vectrex": "GCE Vectrex", "vic20": "Commodore VIC-20",
    "videopac": "Philips Videopac", "virtualboy": "Nintendo Virtual Boy", "vsmile": "VTech V.Smile",
    "wii": "Nintendo Wii", "wiiu": "Nintendo Wii U", "wonderswan": "Bandai WonderSwan",
    "wonderswancolor": "WonderSwan Color", "x68000": "Sharp X68000", "xbox": "Microsoft Xbox",
    "xbox360": "Microsoft Xbox 360", "zxspectrum": "Sinclair ZX Spectrum",
}
LOGO_ALIAS = {
    "aleck64": "n64", "amiga500": "amiga", "naomi_extra": "naomi", "naomi-files": "naomi",
    "pcecd": "pcengine", "pico": "genesis", "ps5": "ps4", "megadrivejp": "megadrive",
    "msx1": "msx", "tg-cd": "pcengine", "n64dd": "n64", "amiga": "amiga",
}

# EmulatorJS core per system — systems the Play section can actually run in-browser.
# Values are EmulatorJS core ids. Disc systems that need a BIOS are left out for now
# (psx runs fine HLE; segaCD/saturn/3do/pcecd would need a bundled BIOS).
EMU_CORE = {
    "nes": "nes", "fds": "nes", "snes": "snes", "sufami": "snes", "satellaview": "snes",
    "gb": "gb", "gbc": "gb", "gba": "gba", "n64": "n64", "nds": "nds",
    "genesis": "segaMD", "megadrive": "segaMD", "megadrivejp": "segaMD",
    "sega32x": "sega32x", "mastersystem": "segaMS", "gamegear": "segaGG", "sg-1000": "segaMS",
    "pcengine": "pce", "supergrafx": "pce",
    "atari2600": "atari2600", "atari5200": "atari5200", "atari7800": "atari7800",
    "atarilynx": "lynx", "atarijaguar": "jaguar",
    "wonderswan": "ws", "wonderswancolor": "ws", "ngp": "ngp", "ngpc": "ngp",
    "virtualboy": "vb", "colecovision": "coleco",
    "c64": "vice_x64sc", "vic20": "vice_xvic", "plus4": "vice_xplus4",
    "psx": "psx", "neogeo": "arcade", "cps1": "arcade", "cps2": "arcade",
    "mame": "arcade", "atari800": "atari800",
}


def text(node, tag):
    el = node.find(tag)
    return (el.text or "").strip() if el is not None and el.text else ""


def parse_year(raw):
    m = re.match(r"(\d{4})", raw or "")
    if m and 1950 <= int(m.group(1)) <= 2035:
        return int(m.group(1))
    return None


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def load_gamelist(system):
    """path-stem/name -> metadata dict, for systems that were scraped."""
    gl = GAMELISTS / system / "gamelist.xml"
    if not gl.is_file():
        return {}
    try:
        root = ET.parse(gl).getroot()
    except ET.ParseError:
        return {}
    by_key = {}
    for g in root.findall("game"):
        path = text(g, "path")
        rec = {
            "desc": re.sub(r"\s+\n", "\n", text(g, "desc")),
            "genre": text(g, "genre"),
            "year": parse_year(text(g, "releasedate")),
            "developer": text(g, "developer"),
            "publisher": text(g, "publisher"),
            "players": text(g, "players"),
            "_image": text(g, "image") or text(g, "thumbnail") or text(g, "marquee"),
            "_name": text(g, "name"),
        }
        stem = os.path.splitext(os.path.basename(path.strip().lstrip("./").rstrip("/")))[0]
        by_key[stem.lower()] = rec
        if rec["_name"]:
            by_key.setdefault(rec["_name"].lower(), rec)
    return by_key


def find_dl_media(system, stems):
    for kind in DL_SOURCES:
        d = MEDIA_SRC / system / kind
        if not d.is_dir():
            continue
        for stem in stems:
            for ext in (".png", ".jpg", ".jpeg", ".webp"):
                p = d / f"{stem}{ext}"
                if p.is_file():
                    return p
    return None


def convert(src, dst, width):
    if dst.exists():
        return True
    dst.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["magick", str(src), "-auto-orient", "-resize", f"{width}x{width}>",
         "-strip", "-quality", str(WEBP_Q), str(dst)],
        capture_output=True,
    )
    return r.returncode == 0


def main():
    if not ROMS.is_dir():
        sys.exit(f"no roms dir at {ROMS}")
    if DATA_OUT.exists():
        shutil.rmtree(DATA_OUT)
    DATA_OUT.mkdir(parents=True)
    (MEDIA_OUT / "logos").mkdir(parents=True, exist_ok=True)

    system_ids = sorted(
        p.name for p in ROMS.iterdir()
        if (p.is_dir() or p.is_symlink()) and not p.name.startswith(".")
    )
    systems_index, search_rows, jobs = [], [], []

    for sid in system_ids:
        root = ROMS / sid
        try:
            rels = scan_system(root)
        except OSError as e:
            sys.stderr.write(f"skip {sid}: {e}\n")
            continue
        if not rels:
            continue

        gl = load_gamelist(sid)
        core = EMU_CORE.get(sid)
        games, genres, with_art = [], {}, 0
        seen_ids = set()

        for i, rel in enumerate(rels):
            base_stem = os.path.splitext(os.path.basename(rel))[0]
            meta = gl.get(base_stem.lower()) or {}
            name = meta.get("_name") or clean_name(rel)
            gid = f"{i:05d}-{slug(base_stem)[:60]}"
            while gid in seen_ids:
                gid += "x"
            seen_ids.add(gid)

            rec = {"id": gid, "name": name, "file": rel}
            if meta:
                if meta["year"]:
                    rec["year"] = meta["year"]
                for k in ("genre", "developer", "publisher", "players"):
                    if meta[k]:
                        rec[k] = meta[k]
                if meta["desc"]:
                    rec["desc"] = meta["desc"][:1200]
                # art
                src = None
                img_rel = meta["_image"]
                if img_rel:
                    p = Path(os.path.normpath(root / img_rel.lstrip("./")))
                    if p.is_file():
                        src = p
                if not src:
                    src = find_dl_media(sid, [base_stem])
                if src:
                    rec["img"] = f"media/{sid}/{gid}.webp"
                    jobs.append((src, MEDIA_OUT / sid / f"{gid}.webp", IMG_W))
                    with_art += 1
            if rec.get("genre"):
                genres[rec["genre"]] = genres.get(rec["genre"], 0) + 1
            games.append(rec)
            search_rows.append([name, sid, gid, rec.get("year", 0), 1 if "img" in rec else 0])

        games.sort(key=lambda r: r["name"].lower())
        (DATA_OUT / f"{sid}.json").write_text(json.dumps(games, ensure_ascii=False, separators=(",", ":")))

        # logo
        logo_src = LOGOS_SRC / f"{LOGO_ALIAS.get(sid, sid)}.webp"
        logo = None
        if logo_src.is_file():
            logo = f"media/logos/{sid}.webp"
            jobs.append((logo_src, MEDIA_OUT / "logos" / f"{sid}.webp", LOGO_W))

        systems_index.append({
            "id": sid,
            "name": SYSTEM_NAMES.get(sid, sid.replace("-", " ").title()),
            "count": len(games),
            "withArt": with_art,
            "logo": logo,
            "playable": bool(core),
            "core": core,
            "genres": sorted(genres, key=lambda k: -genres[k])[:12],
        })
        print(f"{sid:16} {len(games):6}  art={with_art:<5} {'PLAY' if core else ''}")

    systems_index.sort(key=lambda s: s["name"])
    total = sum(s["count"] for s in systems_index)
    search_rows.sort(key=lambda r: r[0].lower())
    (DATA_OUT / "systems.json").write_text(json.dumps(
        {"systems": systems_index, "total": total}, ensure_ascii=False, separators=(",", ":")))
    (DATA_OUT / "search.json").write_text(json.dumps(search_rows, ensure_ascii=False, separators=(",", ":")))

    print(f"\n{len(jobs)} images -> webp ...")
    ok = 0
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        for r in ex.map(lambda j: convert(*j), jobs):
            ok += bool(r)
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"  {ok}/{len(jobs)} converted")
    print(f"\n{total:,} games / {len(systems_index)} systems · docs/ is {size/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
