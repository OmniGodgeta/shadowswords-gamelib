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
from urllib.parse import quote

import time
NOW = time.time()
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
PHOTO_W = 560
WEBP_Q = 76

BIOS_SRC = HOME / "Games" / "bios"
PHOTO_CACHE = Path(__file__).parent / ".console-cache"

# ES-DE system id -> Wikipedia article title (for a photo of the actual hardware).
WIKI = {
    "3do": "3DO_Interactive_Multiplayer", "amiga": "Amiga_500", "amiga500": "Amiga_500",
    "amstradcpc": "Amstrad_CPC", "apple2": "Apple_II_(original)", "arcadia": "Arcadia_2001",
    "archimedes": "Acorn_Archimedes", "atari2600": "Atari_2600", "atari5200": "Atari_5200",
    "atari7800": "Atari_7800", "atari800": "Atari_8-bit_computers", "atarijaguar": "Atari_Jaguar",
    "atarijaguarcd": "Atari_Jaguar_CD", "atarilynx": "Atari_Lynx", "atarist": "Atari_ST",
    "atomiswave": "Sammy_Atomiswave", "bbcmicro": "BBC_Micro", "c64": "Commodore_64",
    "cdtv": "Commodore_CDTV", "channelf": "Fairchild_Channel_F", "coco": "TRS-80_Color_Computer",
    "colecovision": "ColecoVision", "cps1": "CP_System", "cps2": "CP_System_II",
    "crvision": "VTech_CreatiVision", "dos": "IBM_Personal_Computer", "dreamcast": "Dreamcast",
    "electron": "Acorn_Electron", "fds": "Family_Computer_Disk_System", "gamegear": "Game_Gear",
    "gb": "Game_Boy", "gba": "Game_Boy_Advance", "gbc": "Game_Boy_Color", "gc": "GameCube",
    "genesis": "Sega_Genesis", "gx4000": "Amstrad_GX4000", "intellivision": "Intellivision",
    "mame": "Arcade_video_game", "mastersystem": "Master_System", "megadrive": "Sega_Genesis",
    "megadrivejp": "Sega_Genesis", "megaduck": "Mega_Duck", "model2": "Sega_Model_2",
    "model3": "Sega_Model_3", "msx": "MSX", "msx1": "MSX", "msx2": "MSX2", "n3ds": "Nintendo_3DS",
    "n64": "Nintendo_64", "n64dd": "Nintendo_64DD", "naomi": "Sega_NAOMI",
    "neogeo": "Neo_Geo_(system)", "neogeocd": "Neo_Geo_CD", "nes": "Nintendo_Entertainment_System",
    "ngage": "N-Gage_(device)", "ngp": "Neo_Geo_Pocket", "ngpc": "Neo_Geo_Pocket_Color",
    "odyssey2": "Magnavox_Odyssey_2", "oric": "Oric", "pcecd": "TurboGrafx-CD",
    "pcengine": "TurboGrafx-16", "pcfx": "PC-FX", "pico": "Sega_Pico", "plus4": "Commodore_Plus/4",
    "pokemini": "Pok%C3%A9mon_Mini", "ps2": "PlayStation_2", "ps3": "PlayStation_3",
    "ps4": "PlayStation_4", "ps5": "PlayStation_5", "psp": "PlayStation_Portable",
    "psvita": "PlayStation_Vita", "psx": "PlayStation_(console)", "samcoupe": "SAM_Coup%C3%A9",
    "satellaview": "Satellaview", "scv": "Super_Cassette_Vision", "sega32x": "32X",
    "segacd": "Sega_CD", "sg-1000": "SG-1000", "snes": "Super_Nintendo_Entertainment_System",
    "sufami": "SuFami_Turbo", "supergrafx": "PC_Engine_SuperGrafx", "supervision": "Watara_Supervision",
    "switch": "Nintendo_Switch", "tg-cd": "TurboGrafx-CD", "vectrex": "Vectrex",
    "vic20": "Commodore_VIC-20", "videopac": "Magnavox_Odyssey_2", "virtualboy": "Virtual_Boy",
    "vsmile": "V.Smile", "wii": "Wii", "wiiu": "Wii_U", "wonderswan": "WonderSwan",
    "wonderswancolor": "WonderSwan_Color", "x68000": "X68000", "xbox": "Xbox_(console)",
    "xbox360": "Xbox_360", "zxspectrum": "ZX_Spectrum",
}

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

# ES-DE system id -> libretro-thumbnails repo name. Box art (and title/snap
# fallback) is hot-linked from raw.githubusercontent.com — no local storage.
LIBRETRO = {
    "nes": "Nintendo - Nintendo Entertainment System",
    "fds": "Nintendo - Family Computer Disk System",
    "snes": "Nintendo - Super Nintendo Entertainment System",
    "satellaview": "Nintendo - Satellaview", "sufami": "Nintendo - Sufami Turbo",
    "gb": "Nintendo - Game Boy", "gbc": "Nintendo - Game Boy Color",
    "gba": "Nintendo - Game Boy Advance", "n64": "Nintendo - Nintendo 64",
    "n64dd": "Nintendo - Nintendo 64DD", "nds": "Nintendo - Nintendo DS",
    "gc": "Nintendo - GameCube", "wii": "Nintendo - Wii", "wiiu": "Nintendo - Wii U",
    "n3ds": "Nintendo - Nintendo 3DS", "virtualboy": "Nintendo - Virtual Boy",
    "pokemini": "Nintendo - Pokemon Mini", "gamegear": "Sega - Game Gear",
    "mastersystem": "Sega - Master System - Mark III", "genesis": "Sega - Mega Drive - Genesis",
    "megadrive": "Sega - Mega Drive - Genesis", "megadrivejp": "Sega - Mega Drive - Genesis",
    "sega32x": "Sega - 32X", "segacd": "Sega - Mega-CD - Sega CD", "saturn": "Sega - Saturn",
    "dreamcast": "Sega - Dreamcast", "sg-1000": "Sega - SG-1000", "pico": "Sega - PICO",
    "pcengine": "NEC - PC Engine - TurboGrafx 16", "supergrafx": "NEC - PC Engine SuperGrafx",
    "pcecd": "NEC - PC Engine CD - TurboGrafx-CD", "tg-cd": "NEC - PC Engine CD - TurboGrafx-CD",
    "pcfx": "NEC - PC-FX", "atari2600": "Atari - 2600", "atari5200": "Atari - 5200",
    "atari7800": "Atari - 7800", "atarilynx": "Atari - Lynx", "atarijaguar": "Atari - Jaguar",
    "atarijaguarcd": "Atari - Jaguar", "atari800": "Atari - 8-bit", "atarist": "Atari - ST",
    "wonderswan": "Bandai - WonderSwan", "wonderswancolor": "Bandai - WonderSwan Color",
    "ngp": "SNK - Neo Geo Pocket", "ngpc": "SNK - Neo Geo Pocket Color", "neogeo": "SNK - Neo Geo",
    "neogeocd": "SNK - Neo Geo CD", "colecovision": "Coleco - ColecoVision",
    "c64": "Commodore - 64", "vic20": "Commodore - VIC-20", "amiga": "Commodore - Amiga",
    "amiga500": "Commodore - Amiga", "cdtv": "Commodore - CDTV", "plus4": "Commodore - Plus-4",
    "psx": "Sony - PlayStation", "ps2": "Sony - PlayStation 2", "psp": "Sony - PlayStation Portable",
    "psvita": "Sony - PlayStation Vita", "3do": "The 3DO Company - 3DO",
    "intellivision": "Mattel - Intellivision", "vectrex": "GCE - Vectrex",
    "channelf": "Fairchild - Channel F", "odyssey2": "Magnavox - Odyssey2",
    "msx": "Microsoft - MSX", "msx1": "Microsoft - MSX", "msx2": "Microsoft - MSX2",
    "zxspectrum": "Sinclair - ZX Spectrum", "amstradcpc": "Amstrad - CPC",
    "supervision": "Watara - Supervision", "gamecom": "Tiger - Game.com",
    "arcadia": "Emerson - Arcadia 2001", "megaduck": "Mega Duck", "scv": "Epoch - Super Cassette Vision",
    "x68000": "Sharp - X68000", "supracan": "Funtech - Super Acan", "vsmile": "VTech - V.Smile",
    "crvision": "VTech - CreatiVision", "gx4000": "Amstrad - GX4000",
    "apple2": "Apple - II", "bbcmicro": "Acorn - BBC Micro", "electron": "Acorn - Electron",
    "archimedes": "Acorn - Archimedes", "oric": "Tangerine - Oric", "samcoupe": "MGT - SAM Coupe",
    "pv1000": "Casio - PV-1000", "tic80": "TIC-80", "n-gage": "Nokia - N-Gage",
    "mame": "MAME", "dos": "DOS", "neogeo": "FBNeo - Arcade Games",
    "cps1": "FBNeo - Arcade Games", "cps2": "FBNeo - Arcade Games", "fbneo": "FBNeo - Arcade Games",
    "sega32x": "Sega - 32X", "sg-1000": "Sega - SG-1000", "gamegear": "Sega - Game Gear",
    "intellivision": "Mattel - Intellivision", "atarilynx": "Atari - Lynx", "atarijaguar": "Atari - Jaguar",
    "fds": "Nintendo - Family Computer Disk System",
}

# ES-DE system id -> libretro-database name (for metadat/*.dat: genre, year, players…).
# Console/cartridge systems only — home-computer + disc collections have no flat dats.
LR_DB = {
    "nes": "Nintendo - Nintendo Entertainment System", "fds": "Nintendo - Family Computer Disk System",
    "snes": "Nintendo - Super Nintendo Entertainment System", "satellaview": "Nintendo - Satellaview",
    "sufami": "Nintendo - Sufami Turbo", "gb": "Nintendo - Game Boy", "gbc": "Nintendo - Game Boy Color",
    "gba": "Nintendo - Game Boy Advance", "n64": "Nintendo - Nintendo 64", "n64dd": "Nintendo - Nintendo 64DD",
    "nds": "Nintendo - Nintendo DS", "n3ds": "Nintendo - Nintendo 3DS", "virtualboy": "Nintendo - Virtual Boy",
    "genesis": "Sega - Mega Drive - Genesis", "megadrive": "Sega - Mega Drive - Genesis",
    "megadrivejp": "Sega - Mega Drive - Genesis", "mastersystem": "Sega - Master System - Mark III",
    "gamegear": "Sega - Game Gear", "sega32x": "Sega - 32X", "sg-1000": "Sega - SG-1000",
    "pcengine": "NEC - PC Engine - TurboGrafx 16", "supergrafx": "NEC - PC Engine SuperGrafx",
    "atari2600": "Atari - 2600", "atari5200": "Atari - 5200", "atari7800": "Atari - 7800",
    "atarilynx": "Atari - Lynx", "atarijaguar": "Atari - Jaguar",
    "wonderswan": "Bandai - WonderSwan", "wonderswancolor": "Bandai - WonderSwan Color",
    "ngp": "SNK - Neo Geo Pocket", "ngpc": "SNK - Neo Geo Pocket Color",
    "colecovision": "Coleco - ColecoVision", "intellivision": "Mattel - Intellivision",
    "vectrex": "GCE - Vectrex", "msx": "Microsoft - MSX", "msx1": "Microsoft - MSX", "msx2": "Microsoft - MSX2",
    "channelf": "Fairchild - Channel F", "odyssey2": "Magnavox - Odyssey2",
    "supervision": "Watara - Supervision", "gamecom": "Tiger - Game.com", "crvision": "VTech - CreatiVision",
    "arcadia": "Emerson - Arcadia 2001", "scv": "Epoch - Super Cassette Vision",
    "psp": "Sony - PlayStation Portable",
}
LR_META_ATTRS = {  # metadat folder -> (key in the .dat, output field)
    "genre": ("genre", "genre"), "releaseyear": ("releaseyear", "year"),
    "maxusers": ("users", "players"), "developer": ("developer", "developer"),
    "publisher": ("publisher", "publisher"), "franchise": ("franchise", "franchise"),
}
LR_TAG_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")
LR_CACHE = Path(__file__).parent / ".lr-cache"


def _lr_norm(s: str) -> str:
    """No-Intro forbidden-char substitution used by libretro thumbnail filenames."""
    return re.sub(r'[&*/:`<>?\\|"]', "_", s)


def _lr_loose(s: str) -> str:
    s = LR_TAG_RE.sub("", s).lower().replace(" - ", " ")
    s = re.sub(r"\bthe\b", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def libretro_index(sid: str) -> dict:
    """{stem -> raw boxart URL} for a system, from its libretro-thumbnails repo.
    Cached to .lr-cache/<sid>.json. Skipped with --no-lr / --no-net."""
    repo = LIBRETRO.get(sid)
    if not repo:
        return {}
    LR_CACHE.mkdir(exist_ok=True)
    cache = LR_CACHE / f"{sid}.json"
    if cache.is_file():
        try:
            return json.loads(cache.read_text())
        except ValueError:
            pass
    if "--no-lr" in sys.argv or "--no-net" in sys.argv:
        return {}
    exact, loose = {}, {}
    for branch in ("master", "main"):
        r = subprocess.run(
            ["gh", "api", f"repos/libretro-thumbnails/{repo.replace(' ', '_')}"
             f"/git/trees/{branch}?recursive=1", "--jq",
             '.tree[] | select(.path | test("Named_(Boxarts|Titles|Snaps)/")) | .path'],
            capture_output=True, text=True,
        )
        if r.returncode == 0 and r.stdout.strip():
            paths = r.stdout.strip().split("\n")
            base = f"https://raw.githubusercontent.com/libretro-thumbnails/{repo.replace(' ', '_')}/{branch}/"
            # prefer boxart; fall back to title then snap
            rank = {"Named_Boxarts": 0, "Named_Titles": 1, "Named_Snaps": 2}
            for p in sorted(paths, key=lambda x: rank.get(x.split("/")[0], 3)):
                if not p.lower().endswith(".png"):
                    continue
                stem = p.split("/")[-1][:-4]
                url = base + "/".join(quote(seg) for seg in p.split("/"))
                exact.setdefault(stem.lower(), url)
                loose.setdefault(_lr_loose(stem), url)
            break
    idx = {"exact": exact, "loose": loose}
    try:
        cache.write_text(json.dumps(idx, separators=(",", ":")))
    except OSError:
        pass
    print(f"  libretro {sid}: {len(exact)} boxarts")
    return idx


def libretro_match(idx: dict, stem: str) -> str | None:
    if not idx:
        return None
    ex, lo = idx.get("exact", {}), idx.get("loose", {})
    return (ex.get(stem.lower()) or ex.get(_lr_norm(stem).lower())
            or lo.get(_lr_loose(stem)))


_GAME_SPLIT = re.compile(r"\ngame \(")


def _parse_dat(text: str, key: str) -> dict:
    """clrmamepro .dat -> {loose comment name: value}."""
    out = {}
    for block in _GAME_SPLIT.split(text)[1:]:
        mc = re.search(r'comment "([^"]+)"', block)
        mv = re.search(rf'\b{key}\s+"?([^"\n]+?)"?\s*\n', block)
        if mc and mv:
            out[_lr_loose(mc.group(1))] = mv.group(1).strip()
    return out


def libretro_metadata(sid: str) -> dict:
    """{loose name: {genre, year, players, developer, publisher, franchise}} from
    libretro-database metadat/*.dat.  Cached to .lr-cache/<sid>.meta.json."""
    repo = LR_DB.get(sid)
    if not repo:
        return {}
    LR_CACHE.mkdir(exist_ok=True)
    cache = LR_CACHE / f"{sid}.meta.json"
    if cache.is_file():
        try:
            return json.loads(cache.read_text())
        except ValueError:
            pass
    if "--no-lr" in sys.argv or "--no-net" in sys.argv:
        return {}
    import urllib.request
    import urllib.error
    merged: dict = {}
    got = 0
    for folder, (key, field) in LR_META_ATTRS.items():
        url = (f"https://raw.githubusercontent.com/libretro/libretro-database/master/"
               f"metadat/{folder}/{quote(repo)}.dat")
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": _UA}), timeout=30) as r:
                text = r.read().decode("utf-8", "replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            continue
        got += 1
        for name, val in _parse_dat(text, key).items():
            if field == "year":
                m = re.match(r"(\d{4})", val)
                val = int(m.group(1)) if m else None
            elif field == "players":
                val = val if not val.isdigit() else int(val)
            if val:
                merged.setdefault(name, {})[field] = val
    try:
        cache.write_text(json.dumps(merged, separators=(",", ":")))
    except OSError:
        pass
    if merged:
        print(f"  libretro-db {sid}: {len(merged)} games, {got}/6 attrs")
    return merged


# filename region / year hints for systems with no gamelist
REGION_RE = re.compile(r"[\(\[](USA|Europe|Japan|World|Australia|Korea|Brazil|"
                       r"USA, Europe|Japan, USA|En|U|E|J|JU|W)[,\)\]]", re.I)
YEAR_RE = re.compile(r"[\(\[](19[7-9]\d|20[0-2]\d)[\)\],]")
REGION_MAP = {"u": "USA", "e": "Europe", "j": "Japan", "w": "World", "ju": "Japan, USA",
              "en": "English"}

# name-prefix -> franchise label
FRANCHISES = {
    "Super Mario": "Mario", "Mario ": "Mario", "Dr. Mario": "Mario", "Mario Kart": "Mario",
    "Paper Mario": "Mario", "Mario Party": "Mario", "Luigi": "Mario",
    "The Legend of Zelda": "Zelda", "Zelda": "Zelda",
    "Sonic ": "Sonic the Hedgehog", "Final Fantasy": "Final Fantasy",
    "Dragon Quest": "Dragon Quest", "Dragon Warrior": "Dragon Quest",
    "Mega Man": "Mega Man", "Megaman": "Mega Man", "Rockman": "Mega Man",
    "Castlevania": "Castlevania", "Metroid": "Metroid", "Kirby": "Kirby",
    "Donkey Kong": "Donkey Kong", "Street Fighter": "Street Fighter",
    "Mortal Kombat": "Mortal Kombat", "Pokemon": "Pokémon", "Pokémon": "Pokémon",
    "Contra": "Contra", "Metal Gear": "Metal Gear", "Resident Evil": "Resident Evil",
    "Tekken": "Tekken", "Gran Turismo": "Gran Turismo", "Crash Bandicoot": "Crash Bandicoot",
    "Spyro": "Spyro", "Tomb Raider": "Tomb Raider", "Need for Speed": "Need for Speed",
    "Grand Theft Auto": "Grand Theft Auto", "The King of Fighters": "King of Fighters",
    "Bomberman": "Bomberman", "Prince of Persia": "Prince of Persia",
    "Star Wars": "Star Wars", "Teenage Mutant Ninja Turtles": "TMNT",
    "Double Dragon": "Double Dragon", "Gradius": "Gradius", "Ninja Gaiden": "Ninja Gaiden",
    "Worms": "Worms", "FIFA ": "FIFA", "NBA ": "NBA", "Tony Hawk": "Tony Hawk",
    "Silent Hill": "Silent Hill", "Devil May Cry": "Devil May Cry", "Halo": "Halo",
    "God of War": "God of War", "Ratchet": "Ratchet & Clank", "Jak": "Jak & Daxter",
}
CURATED = [
    ("Couch co-op classics", "co-op",
     ["Contra", "Streets of Rage 2", "Teenage Mutant Ninja Turtles", "Golden Axe",
      "Double Dragon", "River City Ransom", "Gauntlet", "The Simpsons", "Battletoads",
      "Sonic the Hedgehog 2", "Super Mario Bros. 3", "Bubble Bobble", "Micro Machines"]),
    ("Pick-up-and-play under 5 minutes", "quick",
     ["Tetris", "Pac-Man", "Dr. Mario", "Bomberman", "Galaga", "Dig Dug", "Bust-A-Move",
      "Columns", "Snake", "Arkanoid", "Mr. Driller", "Puyo Puyo"]),
    ("Halloween night", "spooky",
     ["Castlevania", "Super Castlevania IV", "Ghosts 'n Goblins", "Splatterhouse",
      "Zombies Ate My Neighbors", "Resident Evil", "Silent Hill", "Monster Party",
      "Ghouls 'n Ghosts", "Sweet Home"]),
    ("RPGs to sink a weekend into", "rpg",
     ["Chrono Trigger", "Final Fantasy VI", "Final Fantasy VII", "EarthBound",
      "Secret of Mana", "The Legend of Zelda: A Link to the Past", "Dragon Quest V",
      "Pokemon Red", "Super Mario RPG", "Phantasy Star IV"]),
]

# EmulatorJS "system" value (EJS_core) per ES-DE system. Verified against
# EmulatorJS getCores() + the cores/*.data files on cdn.emulatorjs.org/stable.
# Still impossible in-browser (no WASM core): ps2/ps3/ps4/ps5/psvita, gc/wii/wiiu,
# switch/n3ds, xbox/xbox360, dreamcast/naomi/model2/3, psp, atari800, x68000, dos.
EMU_CORE = {
    "nes": "nes", "fds": "nes",
    "snes": "snes", "satellaview": "snes",
    "gb": "gb", "gbc": "gb", "gba": "gba", "n64": "n64", "nds": "nds",
    "genesis": "segaMD", "megadrive": "segaMD", "megadrivejp": "segaMD",
    "sega32x": "sega32x", "segacd": "segaCD",
    "mastersystem": "segaMS", "sg-1000": "segaMS", "gamegear": "segaGG",
    "pcengine": "pce", "supergrafx": "pce", "pcecd": "pce", "tg-cd": "pce", "pcfx": "pcfx",
    "atari2600": "atari2600", "atari5200": "atari5200", "atari7800": "atari7800",
    "atarilynx": "lynx", "atarijaguar": "jaguar",
    "wonderswan": "ws", "wonderswancolor": "ws", "ngp": "ngp", "ngpc": "ngp",
    "virtualboy": "vb", "colecovision": "coleco",
    "c64": "c64", "vic20": "vic20", "plus4": "plus4",
    "psx": "psx", "neogeo": "arcade", "cps1": "arcade", "cps2": "arcade",
    "mame": "mame", "3do": "3do", "amiga": "amiga",
}
# 'sufami' dropped: needs the Sufami Turbo base cart (not in the BIOS pack) as a
# snes9x subsystem load, which EmulatorJS can't do.

# system -> BIOS file (relative to ~/Games/bios), served at /roms/bios/<name>,
# passed to EmulatorJS as EJS_biosUrl. One file only.
BIOS = {
    "fds": "disksys.rom", "pcecd": "syscard3.pce", "tg-cd": "syscard3.pce",
    "segacd": "bios_CD_U.bin", "3do": "panafz10.bin", "atari5200": "5200.rom",
    "colecovision": "colecovision.rom", "pcfx": "pcfx.rom", "psx": "scph5501.bin",
    "neogeo": "neogeo.zip", "amiga": "kick40068.A1200",
    "atari7800": "7800 BIOS (U).rom", "satellaview": "BS-X.bin",
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


_UA = "shadowswords-arcade/1.0 (https://github.com/OmniGodgeta/shadowswords-gamelib)"


def fetch_console_photos(sids):
    """Populate .console-cache/ with a photo of each console's hardware, using
    the batched MediaWiki pageimages API (few requests, no rate-limiting)."""
    import time
    import urllib.request
    import urllib.parse
    import urllib.error
    PHOTO_CACHE.mkdir(exist_ok=True)

    want = {}  # title -> [sids]
    for sid in sids:
        t = WIKI.get(sid)
        if not t:
            continue
        if next((p for p in PHOTO_CACHE.glob(f"{sid}.*") if p.suffix != ".miss"), None):
            continue
        want.setdefault(urllib.parse.unquote(t), []).append(sid)
    if not want:
        return

    def get(url):
        for attempt in range(6):
            try:
                return urllib.request.urlopen(
                    urllib.request.Request(url, headers={"User-Agent": _UA}), timeout=45).read()
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                time.sleep(3 * (attempt + 1))       # 429 / 5xx
            except Exception:
                time.sleep(2 * (attempt + 1))
        return b""                                   # exhausted -> transient, don't cache a miss

    titles = list(want)
    urls, seen = {}, set()
    for i in range(0, len(titles), 20):
        q = urllib.parse.urlencode({
            "action": "query", "format": "json", "formatversion": "2", "redirects": "1",
            "prop": "pageimages", "piprop": "original|thumbnail",
            "pithumbsize": "1000", "titles": "|".join(titles[i:i + 20]),
        })
        raw = get("https://en.wikipedia.org/w/api.php?" + q)
        if raw:
            d = json.loads(raw).get("query", {})
            # map every returned/resolved title back to the one we asked for
            chain = {}
            for hop in d.get("normalized", []) + d.get("redirects", []):
                chain[hop["to"]] = chain.get(hop["from"], hop["from"])
            for pg in d.get("pages", []):
                key = chain.get(pg["title"], pg["title"])
                seen.add(key)
                src = (pg.get("original") or pg.get("thumbnail") or {}).get("source")
                if src:
                    urls[key] = src
        time.sleep(1.2)

    for title, sid_list in want.items():
        src = urls.get(title)
        if not src:
            if title in seen:                        # API answered: page has no image
                for sid in sid_list:
                    (PHOTO_CACHE / f"{sid}.miss").touch()
            continue                                 # else transient -> retry next build
        if src.lower().split("?")[0].endswith(".svg"):
            for sid in sid_list:
                (PHOTO_CACHE / f"{sid}.miss").touch()
            continue
        src = re.sub(r"\?.*$", "", src)
        src = re.sub(r"/\d+px-([^/]+)$", r"/1000px-\1", src)
        ext = ".png" if ".png" in src.lower() else ".jpg"
        data = get(src)
        if not data:                                 # transient
            continue
        for sid in sid_list:
            (PHOTO_CACHE / f"{sid}{ext}").write_bytes(data)
            print(f"  photo {sid:16} <- {title}")
        time.sleep(1.3)


def console_photo_src(sid):
    return next((p for p in PHOTO_CACHE.glob(f"{sid}.*") if p.suffix != ".miss"), None)


YT_CHANNEL_ID = "UCcAaaApMLLJMU4zpfiI7FKA"  # @shadowswordsttv


def fetch_youtube_videos():
    """docs/data/videos.json from the channel RSS feed (no API key). Keeps the
    last-good file if the fetch fails."""
    import urllib.request
    out = DATA_OUT / "videos.json"
    try:
        req = urllib.request.Request(
            f"https://www.youtube.com/feeds/videos.xml?channel_id={YT_CHANNEL_ID}",
            headers={"User-Agent": _UA})
        xml = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")
        ids = re.findall(r"<yt:videoId>([^<]+)</yt:videoId>", xml)
        titles = re.findall(r"<media:title>([^<]+)</media:title>", xml)
        pubs = re.findall(r"<published>([^<]+)</published>", xml)
        import html as _html
        vids = [{"id": i, "title": _html.unescape(t), "date": (pubs[n][:10] if n < len(pubs) else "")}
                for n, (i, t) in enumerate(zip(ids, titles))]
        if vids:
            out.write_text(json.dumps(vids, ensure_ascii=False, separators=(",", ":")))
            print(f"  youtube: {len(vids)} videos")
            return
    except Exception as e:
        sys.stderr.write(f"  youtube fetch failed: {e}\n")
    old = Path(__file__).parent / "docs" / "data" / "videos.json"
    if old.is_file() and not out.exists():
        out.write_bytes(old.read_bytes())
    elif not out.exists():
        out.write_text("[]")


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


_ROMDIR_MEDIA_CACHE = {}


def find_romdir_media(system, stem):
    """ROM-adjacent art on the game drives: <romdir>/media/{boxes,box2dfront,
    covers,images}/<stem>*.png  (RetroBat-style, filename has a trailing hash)."""
    root = _ROMDIR_MEDIA_CACHE.get(system)
    if root is None:
        try:
            root = (ROMS / system).resolve()
        except OSError:
            root = False
        _ROMDIR_MEDIA_CACHE[system] = root
    if not root:
        return None
    for sub in ("media/boxes", "media/box2dfront", "media/covers", "media/images",
                "media/titlescreen", "images", "boxart"):
        d = root / sub
        if not d.is_dir():
            continue
        for cand in (f"{stem}.png", f"{stem}.jpg"):
            p = d / cand
            if p.is_file():
                return p
        hits = sorted(d.glob(f"{stem} *.png")) or sorted(d.glob(f"{stem}*.png"))
        if hits:
            return hits[0]
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


def write_discovery(all_games, newest):
    """data/collections.json, data/franchises.json, data/added.json.
    Each entry item is [name, sys, gid, img]."""
    def item(g):
        return [g[0], g[1], g[2], g[3]]

    PREF_SYS = {"snes": 0, "genesis": 1, "megadrive": 1, "nes": 2, "gba": 3, "psx": 3,
                "n64": 4, "gb": 5, "gbc": 5, "mastersystem": 6, "pcengine": 6}
    def dedup_best(rows):
        """collapse same title across systems, keep the one with art / preferred sys."""
        best = {}
        for g in rows:
            k = re.sub(r"\s+", " ", LR_TAG_RE.sub("", g[0])).strip().lower()
            score = (1 if g[3] else 0, -PREF_SYS.get(g[1], 9))
            if k not in best or score > best[k][1]:
                best[k] = (g, score)
        return [v[0] for v in best.values()]

    collections = []

    # by decade
    for lo in (1970, 1980, 1990, 2000, 2010):
        rows = [g for g in all_games if lo <= g[4] < lo + 10]
        rows = [g for g in dedup_best(rows) if g[3]]
        rows.sort(key=lambda g: g[0].lower())
        if len(rows) >= 12:
            collections.append({"id": f"decade-{lo}s", "title": f"The {lo}s",
                                "note": f"{len(rows):,} games with box art from the {lo}s",
                                "items": [item(g) for g in rows[:180]]})

    # by genre
    genre_rows = {}
    for g in all_games:
        if g[5] and g[3]:
            genre_rows.setdefault(g[5].split("/")[0].strip(), []).append(g)
    for gen, rows in sorted(genre_rows.items(), key=lambda kv: -len(kv[1]))[:14]:
        rows = dedup_best(rows)
        rows.sort(key=lambda g: g[0].lower())
        if len(rows) >= 15:
            collections.append({"id": "genre-" + slug(gen), "title": gen,
                                "note": f"{len(rows):,} {gen} games",
                                "items": [item(g) for g in rows[:180]]})

    # multiplayer
    mp = [g for g in all_games if g[6] and re.search(r"[2-9]|multi", str(g[6]), re.I) and g[3]]
    mp = dedup_best(mp); mp.sort(key=lambda g: g[0].lower())
    if len(mp) >= 12:
        collections.append({"id": "multiplayer", "title": "Multiplayer",
                            "note": f"{len(mp):,} games for two or more players",
                            "items": [item(g) for g in mp[:200]]})

    # curated (name substring match, prefer art)
    by_name = {}
    for g in all_games:
        by_name.setdefault(g[0].lower(), []).append(g)
    for title, cid, names in CURATED:
        picks = []
        for want in names:
            cands = [g for k, rows in by_name.items() if want.lower() in k for g in rows]
            cands = [g for g in cands if g[3]] or cands
            if cands:
                picks.append(sorted(cands, key=lambda g: (len(g[0]), -PREF_SYS.get(g[1], 9)))[0])
        if len(picks) >= 5:
            collections.append({"id": "curated-" + cid, "title": title, "curated": True,
                                "note": "", "items": [item(g) for g in picks]})

    (DATA_OUT / "collections.json").write_text(
        json.dumps(collections, ensure_ascii=False, separators=(",", ":")))

    # franchises
    fr = {}
    for g in all_games:
        for pref, label in FRANCHISES.items():
            if g[0].startswith(pref) or g[0].lower().startswith(pref.lower()):
                fr.setdefault(label, []).append(g)
                break
    franchises = []
    for label, rows in sorted(fr.items()):
        rows = dedup_best(rows)
        rows.sort(key=lambda g: (g[4] or 9999, g[0].lower()))
        if len(rows) >= 3:
            franchises.append({"id": "fr-" + slug(label), "title": label,
                               "note": f"{len(rows)} games",
                               "items": [item(g) for g in rows[:120]]})
    (DATA_OUT / "franchises.json").write_text(
        json.dumps(franchises, ensure_ascii=False, separators=(",", ":")))

    # recently added (by ROM file mtime)
    newest.sort(reverse=True)
    seen, added = set(), []
    span = (newest[0][0] - newest[-1][0]) if len(newest) > 50 else 0
    for mt, name, sysid, gid, img in newest:
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        added.append([name, sysid, gid, img, int(mt)])
        if len(added) >= 120:
            break
    # only meaningful if mtimes actually vary (a real "recently added" signal)
    if span < 3600:
        added = []
    (DATA_OUT / "added.json").write_text(
        json.dumps(added, ensure_ascii=False, separators=(",", ":")))
    print(f"discovery: {len(collections)} collections, {len(franchises)} franchises, "
          f"{len(added)} recently-added")


def main():
    if not ROMS.is_dir():
        sys.exit(f"no roms dir at {ROMS}")
    if DATA_OUT.exists():
        shutil.rmtree(DATA_OUT)
    DATA_OUT.mkdir(parents=True)
    (MEDIA_OUT / "logos").mkdir(parents=True, exist_ok=True)
    (MEDIA_OUT / "consoles").mkdir(parents=True, exist_ok=True)

    system_ids = sorted(
        p.name for p in ROMS.iterdir()
        if (p.is_dir() or p.is_symlink()) and not p.name.startswith(".")
    )
    if "--no-photos" not in sys.argv:
        fetch_console_photos(system_ids)
    if "--no-net" not in sys.argv:
        fetch_youtube_videos()
    systems_index, search_rows, jobs = [], [], []
    all_games = []          # {name,sys,gid,img,year,genre,players} for collections
    newest = []             # (mtime, name, sys, gid, img)

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
        lr = libretro_index(sid)
        lm = libretro_metadata(sid)
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

            # fill gaps from libretro-database (genre / year / players / dev / pub / franchise)
            md = lm.get(_lr_loose(base_stem)) if lm else None
            if md:
                for k, v in md.items():
                    rec.setdefault(k, v)

            # fill year / region from the filename when nothing else did
            if "year" not in rec:
                ym = YEAR_RE.search(rel)
                if ym:
                    rec["year"] = int(ym.group(1))
            rm = REGION_RE.search(rel)
            if rm:
                r = rm.group(1).lower()
                rec["region"] = REGION_MAP.get(r, rm.group(1).title())

            # box art: gamelist <image>, ES-DE downloaded_media, ROM-adjacent
            # media/, else a hot-linked libretro-thumbnails boxart.
            src = None
            if meta.get("_image"):
                p = Path(os.path.normpath(root / meta["_image"].lstrip("./")))
                if p.is_file():
                    src = p
            src = src or find_dl_media(sid, [base_stem]) or find_romdir_media(sid, base_stem)
            if src:
                rec["img"] = f"media/{sid}/{gid}.webp"
                jobs.append((src, MEDIA_OUT / sid / f"{gid}.webp", IMG_W))
                with_art += 1
            else:
                lr_url = libretro_match(lr, base_stem)
                if lr_url:
                    rec["img"] = lr_url          # remote, no conversion job
                    with_art += 1

            if rec.get("genre"):
                genres[rec["genre"]] = genres.get(rec["genre"], 0) + 1
            games.append(rec)
            search_rows.append([name, sid, gid, rec.get("year", 0), 1 if "img" in rec else 0])
            all_games.append((name, sid, gid, rec.get("img"), rec.get("year", 0),
                              rec.get("genre", ""), rec.get("players", "")))

            try:
                tp = root / rel.rstrip("/")
                mt = min(tp.stat().st_mtime, tp.lstat().st_mtime)
                if 946684800 < mt <= NOW + 86400:      # 2000-01-01 .. now (skip bogus NTFS stamps)
                    newest.append((mt, name, sid, gid, rec.get("img")))
            except OSError:
                pass

        games.sort(key=lambda r: r["name"].lower())
        (DATA_OUT / f"{sid}.json").write_text(json.dumps(games, ensure_ascii=False, separators=(",", ":")))

        # logo (wordmark) + photo (actual hardware)
        logo_src = LOGOS_SRC / f"{LOGO_ALIAS.get(sid, sid)}.webp"
        logo = None
        if logo_src.is_file():
            logo = f"media/logos/{sid}.webp"
            jobs.append((logo_src, MEDIA_OUT / "logos" / f"{sid}.webp", LOGO_W))
        photo = None
        psrc = console_photo_src(sid)
        if psrc:
            photo = f"media/consoles/{sid}.webp"
            jobs.append((psrc, MEDIA_OUT / "consoles" / f"{sid}.webp", PHOTO_W))

        bios = BIOS.get(sid) if core else None
        if bios and not (BIOS_SRC / bios).is_file():
            bios = None
        systems_index.append({
            "id": sid,
            "name": SYSTEM_NAMES.get(sid, sid.replace("-", " ").title()),
            "count": len(games),
            "withArt": with_art,
            "logo": logo,
            "photo": photo,
            "playable": bool(core),
            "core": core,
            "bios": bios,
            "genres": sorted(genres, key=lambda k: -genres[k])[:12],
        })
        print(f"{sid:16} {len(games):6}  art={with_art:<5} {'PLAY' if core else ''}")

    systems_index.sort(key=lambda s: s["name"])
    total = sum(s["count"] for s in systems_index)
    search_rows.sort(key=lambda r: r[0].lower())
    (DATA_OUT / "systems.json").write_text(json.dumps(
        {"systems": systems_index, "total": total}, ensure_ascii=False, separators=(",", ":")))
    (DATA_OUT / "search.json").write_text(json.dumps(search_rows, ensure_ascii=False, separators=(",", ":")))

    write_discovery(all_games, newest)

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
