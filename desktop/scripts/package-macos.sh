#!/bin/sh
# Builds Bee.app and its .dmg for one macOS architecture.
#
#   sh scripts/package-macos.sh [arm64|x64]    (default: this machine's)
#
# BEE_VERSION is the version of the app and of the bee it bundles, as
# major.minor.patch. Without it the app is 0.0.0 and the bee stays "dev", the
# build that talks to a software TEE such as hive-local: a bee with a release
# version only trusts a real TEE's attestation. The output is under
# src-tauri/target/<triple>/release/bundle/.
#
# Signing and notarising use Tauri's own environment. Without it the whole
# bundle is signed ad hoc (identity "-"): it is consistent and runs on the
# machine that built it, but Gatekeeper rejects it elsewhere until the person
# opens it from the context menu. For a release set:
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: Name (TEAMID)"
#   APPLE_CERTIFICATE        the certificate as base64 .p12 (when not already
#   APPLE_CERTIFICATE_PASSWORD   in the keychain)
# and for notarisation, either
#   APPLE_ID, APPLE_PASSWORD (an app-specific password), APPLE_TEAM_ID
# or
#   APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_KEY_PATH
set -eu
cd "$(dirname "$0")/.."

case "${1:-$(uname -m | sed 's/x86_64/x64/')}" in
  arm64) triple=aarch64-apple-darwin ;;
  x64) triple=x86_64-apple-darwin ;;
  *) echo "usage: $0 [arm64|x64]" >&2; exit 2 ;;
esac
version=${BEE_VERSION:-0.0.0}
case "$version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "BEE_VERSION must be major.minor.patch, got $version" >&2; exit 2 ;;
esac
export BEE_VERSION=${BEE_VERSION:-dev}

# No certificate: sign the whole bundle ad hoc rather than leave the
# executable's linker signature alone, which does not cover the bundle.
export APPLE_SIGNING_IDENTITY=${APPLE_SIGNING_IDENTITY:--}
rustup target add "$triple" >/dev/null
BEE_TARGET_TRIPLE=$triple sh scripts/build-bee.sh
npm run tauri -- build --target "$triple" --bundles app,dmg --config "{\"version\":\"$version\"}"
echo
ls -d "src-tauri/target/$triple/release/bundle"/*/*.app "src-tauri/target/$triple/release/bundle"/dmg/*.dmg
