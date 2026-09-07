#!/bin/bash
# Rebuild browse data, then publish docs/ to the gh-pages branch (GitHub Pages
# serves that branch's root). Self-hosting on `shadow` doesn't need this — it
# serves docs/ live via arcade-server.mjs — this is only for the public mirror.
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
n=$(ls docs/data | wc -l)
[ "$n" -ge 10 ] || { echo "build looks empty ($n data files) — aborting"; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -a docs/. "$tmp/"
touch "$tmp/.nojekyll"
[ -s "$tmp/data/systems.json" ] || { echo "no systems.json in staging — aborting"; exit 1; }

git -C "$tmp" init -q
git -C "$tmp" add -A
git -C "$tmp" -c user.email=noreply@local -c user.name=deploy commit -qm "deploy $(date -u +%FT%TZ)"
git -C "$tmp" push -qf "$(git remote get-url origin)" HEAD:gh-pages
echo "deployed $(git -C "$tmp" ls-files | wc -l) files -> https://omnigodgeta.github.io/shadowswords-gamelib/"
