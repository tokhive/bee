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

```sh
BEE_VERSION=0.1.0 sh scripts/package-macos.sh        # this machine's architecture
BEE_VERSION=0.1.0 sh scripts/package-macos.sh x64    # or arm64
```

This builds the window, the `bee` it bundles (reporting `BEE_VERSION`) and the
app, and leaves `Bee.app` and `Bee_<version>_<arch>.dmg` under
`src-tauri/target/<triple>/release/bundle/`. `BEE_VERSION` is
major.minor.patch and is the version of both the app and its `bee`; leave it
out for a development package, whose `bee` stays `dev` and so works against a
software TEE such as the Hive repository's `hive-local`. A `bee` with a release
version trusts only a real TEE's attestation. The app runs on macOS 12 and
later.

Without a certificate the bundle is signed ad hoc: it runs on the machine that
built it, and on another Mac Gatekeeper refuses it until the person opens it
from the context menu (Open). A release signs with a Developer ID certificate
and notarises, which Tauri does when these are set:

| Variable | Meaning |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | The certificate as a base64 `.p12` and its password, when it is not already in the keychain. |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Notarisation with an Apple ID and an app-specific password. |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` | Notarisation with an App Store Connect API key instead. |

Quitting the app from its menu, the Dock or the tray stops the `bee` it
started, whichever way macOS ends the process. A `bee` that was already
running, from the command line or a service, is left alone.

## Tests

```sh
cd desktop && npm test                 # the window: Vitest + Testing Library
cd desktop/src-tauri && cargo test     # the shell
```

The window's tests run against a fake shell; `src/test/explanations.json` is
Bee's catalog as `/v1/explanations` returns it, to refresh when it changes.
