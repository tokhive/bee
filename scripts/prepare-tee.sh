#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
revision=$(<"$root/TEE_REVISION")
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'TEE_REVISION must be a full commit hash.' >&2; exit 1; }
cache="$root/.cache"
mkdir -p "$cache"
source_repo=${TEE_SOURCE:-"$cache/tee-source"}
if ! git -C "$source_repo" rev-parse --git-dir >/dev/null 2>&1; then
  git clone --no-checkout https://github.com/openweb3/reclaim-tee.git "$source_repo"
fi
if ! git -C "$source_repo" cat-file -e "$revision^{commit}" 2>/dev/null; then
  echo "Fetching pinned TEE revision $revision"
  git -C "$source_repo" fetch --depth=1 origin "$revision"
fi
destination="$cache/reclaim-tee"
temporary=$(mktemp -d "$cache/tee-XXXXXX")
trap 'rm -rf "$temporary"' EXIT
git -C "$source_repo" archive "$revision" | tar -x -C "$temporary"
git -C "$source_repo" archive "$revision" | shasum -a 256 > "$temporary/.archive-sha256"
if [[ -e "$destination" ]]; then
  if ! diff -qr "$temporary" "$destination"; then
    echo 'TEE cache does not match the pinned commit; move .cache/reclaim-tee aside and retry.' >&2
    exit 1
  fi
  exit 0
fi
mv "$temporary" "$destination"
echo "TEE dependency pinned to $revision"
