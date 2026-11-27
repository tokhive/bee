#!/bin/sh
# Publishes a built macOS release of the desktop app on GitHub.
#
#   BEE_VERSION=1.2.3 sh scripts/publish-macos.sh
#
# It expects both architectures built by scripts/package-macos.sh with that
# version, the updater key and, for a real release, the Developer ID
# certificate and notary profile: out/macos-aarch64/ and out/macos-x64/. Then:
#
# 1. checks that the tag desktop-v<version> is on the same commit as the
#    command-line release v<version>: the app bundles that bee;
# 2. creates the release desktop-v<version> with the dmgs and the update
#    archives, never marked Latest, which stays the command-line release that
#    install.sh downloads;
# 3. only then points the app's updater at it, replacing latest.json in the
#    release desktop-latest, whose address is built into the app.
#
# BEE_RELEASE_NOTES names a file of notes the app shows with the update.
# BEE_PUBLISH_UNNOTARISED=1 skips the notarisation check, for trying the
# script out; never for a release.
# Needs gh signed in with write access to the repository.
set -eu
cd "$(dirname "$0")/.."

version=${BEE_VERSION:?set BEE_VERSION=major.minor.patch}
repo=${BEE_REPOSITORY:-tokhive/bee}
tag=desktop-v$version
manifest_tag="desktop-latest"

cli=$(git rev-parse --verify --quiet "refs/tags/v$version^{commit}") || { echo "no tag v$version" >&2; exit 1; }
desktop=$(git rev-parse --verify --quiet "refs/tags/$tag^{commit}") || { echo "no tag $tag" >&2; exit 1; }
if [ "$cli" != "$desktop" ]; then
  echo "$tag ($desktop) is not on the commit of v$version ($cli)" >&2
  exit 1
fi

files=
for arch in aarch64 x64; do
  dir=out/macos-$arch
  for file in "$dir/Bee_${version}_$arch.dmg" "$dir/Bee_${version}_$arch.app.tar.gz" "$dir/Bee_${version}_$arch.app.tar.gz.sig"; do
    [ -f "$file" ] || { echo "missing $file; build it with scripts/package-macos.sh" >&2; exit 1; }
    files="$files $file"
  done
  # Built here, the dmg must carry its notarisation ticket. (The release
  # workflow publishes from Linux after its macOS builds checked it.)
  if command -v xcrun >/dev/null && [ -z "${BEE_PUBLISH_UNNOTARISED:-}" ]; then
    xcrun stapler validate -q "$dir/Bee_${version}_$arch.dmg" || { echo "$dir/Bee_${version}_$arch.dmg is not notarised" >&2; exit 1; }
  fi
done

notes=${BEE_RELEASE_NOTES:-}
set --
[ -n "$notes" ] && set -- --notes "$notes"
node scripts/updater-manifest.mjs --version "$version" --base-url "https://github.com/$repo/releases/download/$tag" "$@" out/macos-aarch64/darwin-aarch64.json out/macos-x64/darwin-x86_64.json >out/latest.json

body=out/release-notes.md
{
  echo "Bee desktop app $version for macOS 12 or later, bundling Bee v$version."
  echo
  echo "- Apple silicon: \`Bee_${version}_aarch64.dmg\`"
  echo "- Intel: \`Bee_${version}_x64.dmg\`"
  echo
  echo "The app updates itself from this release. For the command-line Bee, see [v$version](https://github.com/$repo/releases/tag/v$version)."
  if [ -n "$notes" ]; then
    echo
    cat "$notes"
  fi
} >"$body"

# shellcheck disable=SC2086 # the file list is split on purpose
gh release create "$tag" --repo "$repo" --verify-tag --latest=false --title "Bee desktop $version" --notes-file "$body" $files

if ! gh release view "$manifest_tag" --repo "$repo" >/dev/null 2>&1; then
  gh release create "$manifest_tag" --repo "$repo" --prerelease --latest=false --target "$desktop" \
    --title "Bee desktop: update manifest" \
    --notes "Holds latest.json, which installed Bee desktop apps read to find updates. Download the app from the desktop-v* releases."
fi
gh release upload "$manifest_tag" --repo "$repo" --clobber out/latest.json
echo "published $tag; the updater now offers $version"
