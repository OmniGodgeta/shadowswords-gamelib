#!/bin/bash
# Build the browse data, then force-push docs/ to the gh-pages branch.
# GitHub Pages is set to serve from  gh-pages  branch, root.
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
tmp=$(mktemp -d)
cp -r docs/. "$tmp/"
touch "$tmp/.nojekyll"
git -C "$tmp" init -q
git -C "$tmp" add -A
git -C "$tmp" -c user.email=noreply@local -c user.name=deploy commit -qm "deploy $(date -u +%FT%TZ)"
git -C "$tmp" push -qf "$(git remote get-url origin)" HEAD:gh-pages
rm -rf "$tmp"
echo "deployed to gh-pages -> https://omnigodgeta.github.io/shadowswords-gamelib/"
