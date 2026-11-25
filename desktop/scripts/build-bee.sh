#!/bin/sh
# Builds the bee command the app bundles as its sidecar, named for the target
# triple as Tauri expects: src-tauri/binaries/bee-<triple>.
set -eu
cd "$(dirname "$0")/.."
triple=${BEE_TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}
case "$triple" in
  aarch64-apple-darwin) goos=darwin goarch=arm64 ;;
  x86_64-apple-darwin) goos=darwin goarch=amd64 ;;
  x86_64-unknown-linux-gnu) goos=linux goarch=amd64 ;;
  aarch64-unknown-linux-gnu) goos=linux goarch=arm64 ;;
  *) echo "unsupported target $triple" >&2; exit 1 ;;
esac
mkdir -p src-tauri/binaries
GOOS=$goos GOARCH=$goarch CGO_ENABLED=0 go build -trimpath -o "src-tauri/binaries/bee-$triple" ../cmd/bee
echo "built src-tauri/binaries/bee-$triple"
