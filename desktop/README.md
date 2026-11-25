# Bee desktop app

The desktop app is a Tauri 2 shell around Bee. It keeps a Bee background
service running, mirrors its state in the tray and serves it to a React window
through Bee's local control interface (see the main README's *Local control
interface*).

```text
desktop/
├── src/            React + TypeScript window
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

Closing the window keeps the app in the tray. Quitting from the tray, the Dock
or the app menu stops the app's own Bee. Opening the app again shows the
running one.

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

Switch the running mock to another scenario (`-list` prints them):

```sh
go run ./desktop/mock-bee -config /tmp/beedev/bee.json -switch paused
```

| Variable | Effect |
| --- | --- |
| `BEE_DESKTOP_CONFIG` | Device configuration whose control socket the app uses. |
| `BEE_DESKTOP_ATTACH_ONLY` | Never start the bundled Bee; only use one already running. |
| `BEE_DESKTOP_EXIT_AFTER` | Debug builds only: quit through the normal path after this many seconds. |

`npm run bee:build` builds `src-tauri/binaries/bee-<target triple>`, which
Tauri bundles next to the app; a build needs it even when developing against
the mock.

## Tests

```sh
cd desktop/src-tauri && cargo test
```
