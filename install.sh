#!/bin/sh
# Installs the latest Bee release for this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/tokhive/bee/main/install.sh | sh
#
# BEE_VERSION=v0.1.0 picks a release; BEE_INSTALL_DIR (default ~/.local/bin)
# picks where bee goes.
set -eu

repository=tokhive/bee
directory=${BEE_INSTALL_DIR:-"$HOME/.local/bin"}

fail() {
	echo "install.sh: $*" >&2
	exit 1
}

case $(uname -s) in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) fail "Bee runs on macOS and Linux; this is $(uname -s)" ;;
esac
case $(uname -m) in
x86_64 | amd64) arch=amd64 ;;
arm64 | aarch64) arch=arm64 ;;
*) fail "no Bee build for $(uname -m)" ;;
esac

if [ -n "${BEE_VERSION:-}" ]; then
	base="https://github.com/$repository/releases/download/$BEE_VERSION"
else
	base="https://github.com/$repository/releases/latest/download"
fi
archive="bee_${os}_${arch}.tar.gz"

if command -v sha256sum >/dev/null 2>&1; then
	sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
	sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
	fail "need sha256sum or shasum to verify the download"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo "Downloading $base/$archive"
curl -fsSL -o "$work/$archive" "$base/$archive" || fail "download failed"
curl -fsSL -o "$work/checksums.txt" "$base/checksums.txt" || fail "checksum download failed"
expected=$(awk -v name="$archive" '$2 == name { print $1 }' "$work/checksums.txt")
[ -n "$expected" ] || fail "$archive is not listed in checksums.txt"
[ "$(sha256 "$work/$archive")" = "$expected" ] || fail "checksum mismatch for $archive"

tar -xzf "$work/$archive" -C "$work" bee
mkdir -p "$directory"
# Replace through a rename, so a running bee keeps its old file.
cp "$work/bee" "$directory/.bee.new"
chmod 755 "$directory/.bee.new"
mv -f "$directory/.bee.new" "$directory/bee"
echo "Installed $("$directory/bee" version) to $directory/bee"

case ":$PATH:" in
*":$directory:"*) ;;
*) echo "Add $directory to your PATH, for example: export PATH=\"$directory:\$PATH\"" ;;
esac
