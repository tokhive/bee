#!/bin/sh
# Regenerates the app and menu bar icons from the SVG sources in
# src-tauri/icons/src. Needs rsvg-convert (librsvg) and the Tauri CLI.
#   sh scripts/build-icons.sh
set -eu
cd "$(dirname "$0")/.."
icons=src-tauri/icons
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Menu bar: 44 px, which macOS shows at 22 pt on a Retina display.
for state in good attention paused off; do
  rsvg-convert -w 44 -h 44 "$icons/src/tray-$state.svg" -o "$icons/tray-$state.png"
done

# App icon: every size the bundle lists, from one 1024 px rendering.
rsvg-convert -w 1024 -h 1024 "$icons/src/app.svg" -o "$icons/source.png"
npx tauri icon "$icons/source.png" -o "$work" >/dev/null 2>&1
for name in 32x32.png 64x64.png 128x128.png 128x128@2x.png icon.png icon.icns icon.ico; do
  cp "$work/$name" "$icons/$name"
done
echo "icons written to $icons"
