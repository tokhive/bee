# Bee desktop app

The desktop app is a Tauri 2 shell around Bee. It keeps a Bee background
service running, mirrors its state in the tray and serves it to a React window
through Bee's local control interface (see the main README's *Local control
interface*).

```text
desktop/
├── src/            React + TypeScript window (Tailwind, shadcn/ui-style Radix components)
├── src-tauri/      Rust shell: background service, tray, single instance
├── mock-bee/       a stand-in for bee run --desktop with canned scenarios
└── scripts/        build helpers
```

## Requirements

- Node.js 20+ and npm
- Rust (the version in `rust-toolchain.toml` is installed by rustup on first use)
- Go, to build the bundled `bee`

## The background service

On start the shell looks for a Bee answering the control socket of the device
configuration (`tokhive/bee.json` in the user configuration directory, or
`BEE_DESKTOP_CONFIG`):

- If one answers, for example a Bee started from the command line or a system
  service, the app uses it and never stops it.
- Otherwise it starts its bundled `bee run --desktop`, restarts it with backoff
  from 1 to 30 seconds when it exits, and on quit asks it to stop (SIGTERM) so
  it can tell Hive and finish its requests, killing it only after 15 seconds.

Closing the window keeps the app in the tray; the first time, a notification
says Bee is still sharing. On a Linux desktop that shows no tray icons (GNOME
without an extension) closing minimises instead, and with *keep in tray* turned
off closing quits. Quitting from the tray, the Dock or the app menu stops the
app's own Bee; the tray's Quit first asks in the window, since that stops
sharing, unless the Bee was started elsewhere. Opening the app again shows
the running one.

## Settings, start at login and notifications

The app keeps its preferences in `settings.json` in its config directory
(`~/Library/Application Support/ai.tokhive.bee` on macOS): start at login, keep
in tray, notifications and language (`system`, `zh` or `en`). The window reads
and changes them with the `get_settings` and `set_settings` commands.

- **Start at login** is on by default: a release enables the login item the
  first time it runs, which starts the app with `--background`, tray only.
  Development builds never touch login items unless the setting is changed.
- **Notifications** are raised only for what the person must handle (a sign-in
  to renew, an account switch to confirm, an account used elsewhere, a TokHive
  restriction, a revoked device, or a background service stopped for over a
  minute), never for what clears by itself, and the same problem at most once a
  day, also across restarts (`notifications.json`). Their words come from Bee's
  `/v1/explanations`.

## Logs

The app keeps the output of the `bee` it starts in `bee.log` (rotated at 5 MB
to `bee.log.1`) in `~/Library/Logs/ai.tokhive.bee` on macOS, the user's state
directory elsewhere, or `logs/` under `BEE_DESKTOP_DATA` when that is set.
Settings has a button that opens the folder, and the technical information
there names it, so a person can find the log to send with a diagnostic report.
A `bee` the app did not start writes where its own starter sends it.

## Develop against the mock

The mock serves the control interface with scenarios, so the window and tray
can be worked on without a Hive or real accounts. Keep the configuration path
short: Unix socket paths are limited to about 100 bytes.

```sh
go run ./desktop/mock-bee -config /tmp/beedev/bee.json -scenario sharing
```

```sh
cd desktop && npm install && npm run bee:build
BEE_DESKTOP_CONFIG=/tmp/beedev/bee.json BEE_DESKTOP_ATTACH_ONLY=1 npm run tauri dev
```

Switch the running mock to another scenario (`-list` prints them, `-v` logs
every request):

```sh
go run ./desktop/mock-bee -config /tmp/beedev/bee.json -switch paused
```

The scenarios cover what the window shows: `unpaired` (first run; the code is
confirmed five seconds after pairing starts), `pairexpired` and `pairoffline`
(pairing that expires or cannot reach TokHive), `sharing`, `empty`, `syncing`,
`paused`, `quota`, `auth` and `authimport` (a sign-in to renew, here or
imported), `switched` (the official client changed accounts), `inuse`,
`restricted`, `opfail` (pause, resume, remove and switch fail), `reconnect`,
`replaced`, `invalid` and `cli` (a Bee run from the command line). The mock
answers `/v1/explanations` with Bee's own catalog. An import is judged by the
file's name: `auth.json` or `.credentials.json` imports, a name containing
`expired` or `scope` fails as such, and any other name is not a credential
file. Stop the mock to see the background service stopped.

The window also runs in an ordinary browser against the mock, which is quicker
for working on pages: the dev server forwards `/__bee/v1/...` to the control
socket of `BEE_DEV_CONFIG`, and a stand-in for the shell keeps settings in
local storage (file choice asks for a path).

```sh
cd desktop && BEE_DEV_CONFIG=/tmp/beedev/bee.json npm run dev   # http://localhost:1420
```

| Variable | Effect |
| --- | --- |
| `BEE_DESKTOP_CONFIG` | Device configuration whose control socket the app uses. |
| `BEE_DESKTOP_ATTACH_ONLY` | Never start the bundled Bee; only use one already running. |
| `BEE_DESKTOP_DATA` | Directory for the app's own settings and notification history, so a development run leaves the installed app's alone. |
| `BEE_DESKTOP_EXIT_AFTER` | Debug builds only: quit through the normal path after this many seconds. |

`npm run bee:build` builds `src-tauri/binaries/bee-<target triple>`, which
Tauri bundles next to the app; a build needs it even when developing against
the mock.

## Package for macOS

From the repository root, one command installs the dependencies and builds:

```sh
make desktop-macos                                   # development package
make desktop-macos BEE_VERSION=0.1.0 ARCH=x64        # release version, other architecture
```

Or run the script directly from `desktop/`:

```sh
BEE_VERSION=0.1.0 sh scripts/package-macos.sh        # this machine's architecture
BEE_VERSION=0.1.0 sh scripts/package-macos.sh x64    # or arm64
```

This builds the window, the `bee` it bundles (reporting `BEE_VERSION`) and the
app, signs and checks it, and leaves the release files in `out/macos-<arch>/`
(`aarch64` or `x64`): `Bee_<version>_<arch>.dmg` and, with the updater key,
the update archive `Bee_<version>_<arch>.app.tar.gz`, its `.sig` and this
architecture's manifest entry `darwin-<aarch64|x86_64>.json`. `BEE_VERSION` is
major.minor.patch and is the version of both the app and its `bee`; leave it
out for a development package, whose `bee` stays `dev` and so works against a
software TEE such as the Hive repository's `hive-local`. A `bee` with a release
version trusts only a real TEE's attestation. The app runs on macOS 12 and
later.

### Signing and notarisation

The script signs; Tauri's own `APPLE_*` variables are ignored. Credentials are
referred to by name only, never passed in the environment:

| Variable | Meaning |
| --- | --- |
| `BEE_SIGN_IDENTITY` | A Developer ID Application certificate in the keychain, `Developer ID Application: Name (TEAMID)`. Without it everything is signed ad hoc. |
| `BEE_NOTARY_PROFILE` | A `notarytool` keychain profile, for example `bee-notary`. With it the app and the dmg are notarised, stapled and assessed with `spctl`; the script fails unless Apple accepts them. |
| `BEE_NOTARY_KEYCHAIN` | The keychain holding that profile, when it is not the default one. |

Create the profile once, entering the app-specific password at the prompt:

```sh
xcrun notarytool store-credentials bee-notary --apple-id <Apple ID> --team-id <TEAMID>
```

```sh
BEE_VERSION=0.1.0 BEE_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" BEE_NOTARY_PROFILE=bee-notary sh scripts/package-macos.sh arm64
```

The background service inside the app (`Contents/MacOS/bee`) is always signed
with the identifier `ai.tokhive.bee.service` and the app with
`ai.tokhive.bee`, so the keychain's *Always Allow* for reading a Claude login,
which macOS ties to identifier and team, survives updates. Without a
certificate the bundle is signed ad hoc: it runs on the machine that built it,
and on another Mac Gatekeeper refuses it until the person opens it from the
context menu (Open).

Quitting the app from its menu, the Dock or the tray stops the `bee` it
started, whichever way macOS ends the process. A `bee` that was already
running, from the command line or a service, is left alone.

## Updates

The app updates itself with the Tauri updater. It checks 30 seconds after it
starts and then daily, and Settings → About checks on request; a found update
marks the settings button and is installed from About, which downloads it,
replaces the app and restarts it (stopping and restarting the app's own `bee`,
and showing the window even when the app had started at login).

Installed apps read the manifest at
`https://github.com/tokhive/bee/releases/download/desktop-latest/latest.json`
(`plugins.updater` in `src-tauri/tauri.conf.json`). The updater accepts an
archive only with a valid signature by the update key for the very version the
manifest announces (`requireSignedVersion`), so neither a tampered archive nor
an older release under a newer number installs. A build without a public key
in `tauri.conf.json` cannot check, and says so in About.

**The update key.** Generate it once, on a trusted machine, with a password:

```sh
cd desktop && npx tauri signer generate -w ~/.tauri/bee-updater.key
```

Commit the public key (`~/.tauri/bee-updater.key.pub`, one base64 line) as
`plugins.updater.pubkey`. Keep the private key and its password out of the
repository: in a password manager with an offline backup, and as the
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets of
the release workflow. Losing it means installed apps can no longer be updated;
they would have to download a new app by hand. To sign locally, point the
script at it:

```sh
TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/bee-updater.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... BEE_VERSION=0.1.0 sh scripts/package-macos.sh
```

**Trying an update locally.** Build two versions against a temporary key and a
local manifest, install the older one and check for updates in About:

```sh
npx tauri signer generate --ci -w /tmp/bee-test.key
for v in 0.1.0 0.1.1; do
  BEE_VERSION=$v TAURI_SIGNING_PRIVATE_KEY_PATH=/tmp/bee-test.key BEE_UPDATER_PUBKEY="$(cat /tmp/bee-test.key.pub)" \
    BEE_UPDATER_ENDPOINT=http://127.0.0.1:8765/latest.json sh scripts/package-macos.sh && cp -R out/macos-aarch64 /tmp/bee-$v
done
mkdir -p /tmp/bee-updates && cp /tmp/bee-0.1.1/*.app.tar.gz /tmp/bee-updates/
node scripts/updater-manifest.mjs --version 0.1.1 --base-url http://127.0.0.1:8765 /tmp/bee-0.1.1/darwin-aarch64.json >/tmp/bee-updates/latest.json
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/bee-updates
```

`BEE_UPDATER_PUBKEY` and `BEE_UPDATER_ENDPOINT` exist only for this; never
publish such a build.

## Release

A desktop release has the version of the command-line release whose commit it
is built from: tag `desktop-vX.Y.Z` on the commit of `vX.Y.Z`. When only the
app needs a fix, both get a new version.

Pushing the tag runs the [desktop release workflow](../.github/workflows/desktop-release.yml):
it builds, signs and notarises both architectures and runs
`scripts/publish-macos.sh`, which creates the release `desktop-vX.Y.Z` with
the dmgs and update archives, never marked *Latest* (that stays the
command-line release, which `install.sh` downloads), and only then replaces
`latest.json` in the release `desktop-latest`. Without Actions, do the same by
hand on a Mac with the certificate, notary profile and update key:

```sh
git tag desktop-v0.1.0 v0.1.0^{commit} && git push origin desktop-v0.1.0
for arch in arm64 x64; do BEE_VERSION=0.1.0 BEE_SIGN_IDENTITY=... BEE_NOTARY_PROFILE=bee-notary TAURI_SIGNING_PRIVATE_KEY_PATH=... sh scripts/package-macos.sh $arch; done
BEE_VERSION=0.1.0 sh scripts/publish-macos.sh
```

The publish script refuses dmgs without a notarisation ticket. Notes in a file
named by `BEE_RELEASE_NOTES` go into the release and are shown in About with
the update.

## Tests

```sh
cd desktop && npm test                 # the window: Vitest + Testing Library
cd desktop/src-tauri && cargo test     # the shell
```

The window's tests run against a fake shell; `src/test/explanations.json` is
Bee's catalog as `/v1/explanations` returns it, to refresh when it changes.
