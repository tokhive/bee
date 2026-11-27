#!/bin/sh
# Builds, signs and checks Bee for one macOS architecture: Bee.app, its .dmg
# and the update archive the app's updater installs.
#
#   sh scripts/package-macos.sh [arm64|x64]    (default: this machine's)
#
# The release files go to out/macos-<arch>/:
#   Bee_<version>_<arch>.dmg               what people download
#   Bee_<version>_<arch>.app.tar.gz(.sig)  the update archive and its signature
#   darwin-<aarch64|x86_64>.json           this architecture's entry of the
#                                          update manifest (scripts/updater-manifest.mjs)
#
# BEE_VERSION is the version of the app and of the bee it bundles, as
# major.minor.patch. Without it the app is 0.0.0 and the bee stays "dev", the
# build that talks to a software TEE such as hive-local: a bee with a release
# version only trusts a real TEE's attestation.
#
# Signing. Credentials are named, never passed: the certificate stays in the
# keychain and the notary credentials in a notarytool keychain profile.
#   BEE_SIGN_IDENTITY   a Developer ID Application certificate in the keychain,
#                       e.g. "Developer ID Application: Name (TEAMID)". Without
#                       it everything is signed ad hoc: the app runs on the
#                       machine that built it, and Gatekeeper refuses it
#                       elsewhere until the person opens it from the context menu.
#   BEE_NOTARY_PROFILE  a profile saved with `xcrun notarytool store-credentials`
#                       (e.g. bee-notary). With it the app and the dmg are
#                       notarised, stapled and checked with spctl. Needs
#                       BEE_SIGN_IDENTITY. BEE_NOTARY_KEYCHAIN names the
#                       keychain that holds the profile when it is not the
#                       default one.
# The background service inside the app is signed with the fixed identifier
# ai.tokhive.bee.service, so a keychain "Always Allow" given to it survives
# updates signed by the same team.
#
# Updates. The update archive is signed with the updater key Tauri reads from
# TAURI_SIGNING_PRIVATE_KEY_PATH (or TAURI_SIGNING_PRIVATE_KEY) and
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD; without a key there is no archive. The
# app accepts only archives signed by the key whose public half is in
# tauri.conf.json. For a local test of updating, and only for that:
#   BEE_UPDATER_PUBKEY    the public key of a temporary key pair
#   BEE_UPDATER_ENDPOINT  another manifest address, e.g. http://127.0.0.1:8765/latest.json
set -eu
cd "$(dirname "$0")/.."

case "${1:-$(uname -m | sed 's/x86_64/x64/')}" in
  arm64) triple=aarch64-apple-darwin arch=aarch64 platform=darwin-aarch64 ;;
  x64) triple=x86_64-apple-darwin arch=x64 platform=darwin-x86_64 ;;
  *) echo "usage: $0 [arm64|x64]" >&2; exit 2 ;;
esac
version=${BEE_VERSION:-0.0.0}
case "$version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "BEE_VERSION must be major.minor.patch, got $version" >&2; exit 2 ;;
esac
export BEE_VERSION="${BEE_VERSION:-dev}"

identity=${BEE_SIGN_IDENTITY:--}
profile=${BEE_NOTARY_PROFILE:-}
if [ -n "$profile" ] && [ "$identity" = - ]; then
  echo "BEE_NOTARY_PROFILE needs BEE_SIGN_IDENTITY: Apple notarises only Developer ID signed apps" >&2
  exit 2
fi
if [ "$identity" = - ]; then timestamp=--timestamp=none; else timestamp=--timestamp; fi
service_id=ai.tokhive.bee.service

# This script signs and notarises; Tauri does neither, so nothing is signed
# twice or notarised before the service's identifier is set.
unset APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_PATH

config=$(node -e '
  const [version, pubkey, endpoint] = process.argv.slice(1);
  const config = { version };
  if (pubkey || endpoint) {
    const updater = {};
    if (pubkey) updater.pubkey = pubkey;
    if (endpoint) {
      updater.endpoints = [endpoint];
      updater.dangerousInsecureTransportProtocol = endpoint.startsWith("http:");
    }
    config.plugins = { updater };
  }
  process.stdout.write(JSON.stringify(config));
' "$version" "${BEE_UPDATER_PUBKEY:-}" "${BEE_UPDATER_ENDPOINT:-}")
if [ -n "${BEE_UPDATER_PUBKEY:-}${BEE_UPDATER_ENDPOINT:-}" ]; then
  echo "warning: test build with another update key or address; do not publish it" >&2
fi

rustup target add "$triple" >/dev/null
BEE_TARGET_TRIPLE=$triple sh scripts/build-bee.sh
npm run tauri -- build --target "$triple" --bundles app --config "$config"

app=src-tauri/target/$triple/release/bundle/macos/Bee.app
out=out/macos-$arch
work=$out/work
rm -rf "$out"
mkdir -p "$work"

echo "signing with ${identity}"
# Inside out: the service first, then the bundle, which seals it.
codesign --force --options runtime $timestamp --sign "$identity" --identifier "$service_id" "$app/Contents/MacOS/bee"
codesign --force --options runtime $timestamp --sign "$identity" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
signed_id() { codesign -d --verbose=2 "$1" 2>&1 | sed -n 's/^Identifier=//p'; }
team() { codesign -d --verbose=2 "$1" 2>&1 | sed -n 's/^TeamIdentifier=//p'; }
[ "$(signed_id "$app")" = ai.tokhive.bee ] || { echo "the app is signed as $(signed_id "$app")" >&2; exit 1; }
[ "$(signed_id "$app/Contents/MacOS/bee")" = "$service_id" ] || { echo "the service is signed as $(signed_id "$app/Contents/MacOS/bee")" >&2; exit 1; }
[ "$(team "$app")" = "$(team "$app/Contents/MacOS/bee")" ] || { echo "the app and the service are signed by different teams" >&2; exit 1; }

# Notarises a zip or dmg and fails unless Apple accepts it.
notarise() {
  result=$work/notary-$(basename "$1").plist
  set -- "$1" --keychain-profile "$profile"
  [ -n "${BEE_NOTARY_KEYCHAIN:-}" ] && set -- "$@" --keychain "$BEE_NOTARY_KEYCHAIN"
  xcrun notarytool submit "$@" --wait --output-format plist >"$result"
  status=$(/usr/libexec/PlistBuddy -c 'Print :status' "$result")
  if [ "$status" != Accepted ]; then
    id=$(/usr/libexec/PlistBuddy -c 'Print :id' "$result")
    echo "notarisation of $(basename "$1"): $status; see xcrun notarytool log $id --keychain-profile $profile" >&2
    exit 1
  fi
}

if [ -n "$profile" ]; then
  echo "notarising Bee.app"
  ditto -c -k --keepParent "$app" "$work/Bee.zip"
  notarise "$work/Bee.zip"
  xcrun stapler staple "$app"
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=2 "$app"
fi

dmg=$out/Bee_${version}_$arch.dmg
mkdir -p "$work/dmg"
ditto "$app" "$work/dmg/Bee.app"
ln -s /Applications "$work/dmg/Applications"
hdiutil create -quiet -volname Bee -srcfolder "$work/dmg" -fs HFS+ -format UDZO -ov "$dmg"
if [ "$identity" != - ]; then
  codesign --force $timestamp --sign "$identity" "$dmg"
fi
if [ -n "$profile" ]; then
  echo "notarising $(basename "$dmg")"
  notarise "$dmg"
  xcrun stapler staple "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
fi
hdiutil verify -quiet "$dmg"

# The update archive holds Bee.app at its top, without macOS metadata files,
# which would break the signature once unpacked.
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  archive=$out/Bee_${version}_$arch.app.tar.gz
  COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "$archive" -C "$(dirname "$app")" Bee.app
  npm run --silent tauri -- signer sign --app-version "$version" "$archive" >/dev/null
  node -e '
    const fs = require("fs");
    const [archive, entry] = process.argv.slice(1);
    const signature = fs.readFileSync(archive + ".sig", "utf8").trim();
    fs.writeFileSync(entry, JSON.stringify({ signature, file: require("path").basename(archive) }, null, 2) + "\n");
  ' "$archive" "$out/$platform.json"
else
  echo "no updater key (TAURI_SIGNING_PRIVATE_KEY_PATH): no update archive" >&2
fi

rm -rf "$work"
echo
ls -l "$out"
