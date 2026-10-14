# Bee

Bee is the provider agent of [TokHive](https://github.com/tokhive), an open marketplace for AI subscription capacity. If your ChatGPT or Claude subscription has quota you don't use, Bee lets you contribute it to the market. Buyers get first-party model access at a lower price, and you earn from capacity that would otherwise go to waste.

Bee runs on your own machine and connects to a **Hive**, the marketplace service that matches buyers with providers. Bee does three things:

- **Device identity.** You pair Bee once with your Hive account. After that it keeps an authenticated connection open and reports that it is online.
- **Authorization upkeep.** Bee reads the login of the official client you already use (Codex for OpenAI, Claude Code for Anthropic). It never sends your tokens to Hive in plaintext. Instead it seals your access token to a Trusted Execution Environment (TEE) and reports only the sealed envelope plus account metadata: account fingerprint, expiry, model list and quota windows. Your refresh token stays in the official client's local store.
- **Encrypted egress.** Buyer requests run inside the TEE, which opens its own TLS session to the upstream platform. Bee only relays that already-encrypted traffic to an allowlisted set of hosts. It cannot read buyer prompts or model responses.

## Requirements

- macOS or Linux, including Linux machines without a desktop or browser.
- Claude subscriptions are supported on macOS only, because Bee reads the Claude Code login from the Keychain.
- Go 1.27 or newer, plus `git` and `bash`, to build from source.
- An account on a Hive. You confirm pairing in that Hive's web console.

## Installation

```sh
git clone https://github.com/tokhive/bee.git
cd bee
make build        # fetches the pinned TEE client library, then builds bin/bee
```

`make build` runs `scripts/prepare-tee.sh` first. The script downloads the TEE client library at the commit pinned in `TEE_REVISION` and places it in `.cache/reclaim-tee`. That library can't be fetched through the Go module proxy, so `go.mod` points to the local copy. After the first run you can also build with plain `go build -o bin/bee ./cmd/bee`.

To run the tests:

```sh
make test
```

## Getting started

**1. Pair with your Hive.**

```sh
./bin/bee login --hive https://hive.example.com --name "my-laptop"
```

Bee prints a short code such as `ABCD-EFGH` and a pairing link. Open `/devices/pair` on your Hive in any browser and sign in. Enter the code, check the device name, then confirm. The code is valid for 10 minutes and can be used once. `--name` defaults to the host name.

A remote Hive must be reached over HTTPS; plain HTTP is accepted only for `localhost` and loopback addresses.

**2. Choose which subscriptions to contribute.**

```sh
./bin/bee setup
```

`setup` looks for the official clients you are already signed in to. It only reads, and never changes their logins. For each account it finds, it asks whether to contribute it, then writes `egress.json` next to the device configuration. Use `--platform openai,claude --yes` in scripts. Running `setup` again is safe, and is how you add or remove a platform.

- **OpenAI:** Bee reads the Codex login from `--codex-home`, `$CODEX_HOME` or `~/.codex`, in that order. On macOS it falls back to the Keychain.
- **Claude:** Bee reads the Claude Code login from the macOS Keychain. `--claude-config-dir` selects a non-default Claude Code configuration.

**3. Run Bee.**

```sh
./bin/bee run
```

Once each platform has synchronized, Bee prints `<platform> ready: taking new work`. If it can't take work yet, it prints one `WARN` line per reason, with an error code and a fix. Being online on the devices page doesn't mean an account is ready. Admission also depends on the account's authorization, models, quota and the plan settings in Hive.

## Commands

| Command | Purpose |
| --- | --- |
| `bee login [--hive URL] [--name NAME]` | Pair this machine with a Hive account, or resume a pairing that was interrupted. |
| `bee setup [--platform openai,claude] [--yes]` | Detect local subscription logins and write the egress configuration. |
| `bee run [--egress-config PATH]` | Stay connected and serve work in the foreground. Stops on SIGINT or SIGTERM. |
| `bee status` | Check the paired identity with Hive. |
| `bee doctor [--egress-config PATH] [--json]` | Run every check in order and report `ok`, `WARN`, `FAIL` or `skip`, each with a fix. Read-only, so it is safe to run while `bee run` is running. |
| `bee supply-status --platform P` | Show whether Hive is currently sending work to the account on platform `P`, and why not. |
| `bee pause` / `bee resume --platform P` | Stop or restart new work for one platform. |
| `bee account-status --platform P` | Show the confirmed account and any account change waiting for confirmation. |
| `bee confirm-account --platform P --account-fingerprint FP` | Accept a new account after you switched accounts in the official client. |
| `bee codex-status` / `bee claude-status` | Inspect the local official login without contacting Hive. |

Every command accepts `--config PATH` to use a device configuration other than the default.

## Configuration

The device configuration is stored by default in `tokhive/bee.json` under the user configuration directory:

- macOS: `~/Library/Application Support/tokhive/bee.json`
- Linux: `~/.config/tokhive/bee.json`, which respects `XDG_CONFIG_HOME`

The file holds the device secret and is the only proof of the pairing. Bee writes it with mode `0600` using atomic replacement, and refuses symbolic links and files that other users can read or write. **Do not delete it to retry a failed login.** Run `bee login` again with the same file and Bee resumes where it stopped. Keep the file out of version control, logs and screenshots. A configuration file is tied to one Hive; to connect to a different Hive, use a separate file.

While running, `login` and `run` hold a lock file next to the configuration, so the same configuration can't be used by two processes at once.

### Egress configuration

`bee setup` writes the egress configuration for you. To write it by hand, the file must have mode `0600`:

```json
{
  "targets": ["chatgpt.com:443", "api.anthropic.com:443"],
  "codex": {"home": "/absolute/path/to/codex-home", "store": "file"},
  "capabilities": {},
  "claude": {"store": "keychain", "capabilities": true, "refresh": false}
}
```

- `targets` is the allowlist of upstream hosts Bee will open connections to for the TEE.
- `codex` selects the Codex login. `store` is `file`, `keyring` or `auto`. The top-level `capabilities` enables model and quota reports for OpenAI.
- `claude` selects the Claude Code login. `capabilities` enables model and quota reports, which are required for taking work. With `refresh: true`, Hive may also schedule token refreshes, and Bee writes the refreshed token back to the official store. The default `false` only re-seals tokens that the official client has refreshed. `config_dir` selects a non-default Claude Code configuration.
- `connect_proxy` (optional, for example `http://127.0.0.1:7890`) sends Bee's outbound connections through a local HTTP proxy.

To contribute only one platform, remove the other platform's entry and its target. Pass the file with `bee run --egress-config PATH`. Without the flag, Bee uses the `egress.json` that `setup` wrote. If neither exists, Bee stays online but serves nothing and prints `BEE-SETUP-NEEDED`.

### Environment variables

| Variable | Effect |
| --- | --- |
| `TOKHIVE_LOG_LEVEL` | `debug`, `info` (default), `warn` or `error`. |
| `TOKHIVE_LOG_MODULES` | Comma-separated list of log modules to keep, for example `sync,connect`. |
| `BEE_DEBUG` | Any value turns on debug logging. |
| `BEE_METRICS_ADDR` | Serve Prometheus metrics on this address, for example `127.0.0.1:9464`. |
| `HTTPS_PROXY` | Standard proxy setting. It takes precedence over `connect_proxy`. |

## Running as a service

`bee run` runs in the foreground. To keep it running, use a user-level service manager, run it as the user who paired the device, and give absolute paths. A systemd unit for Linux:

```ini
[Unit]
Description=TokHive Bee

[Service]
ExecStart=/absolute/path/bin/bee run --config /absolute/path/bee.json
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

Save it as `~/.config/systemd/user/tokhive-bee.service`, then run `systemctl --user daemon-reload && systemctl --user enable --now tokhive-bee`. If the service must run while nobody is logged in, enable lingering for the user. On macOS, use a LaunchAgent with the same arguments, `RunAtLoad` and `KeepAlive`.

If the network drops, Bee reconnects with exponential backoff from 1 to 30 seconds, so it can be started before Hive is reachable. When you pair a new machine to replace this one, the old Bee finishes the work it already has and then exits.

## Troubleshooting

If Bee is online but takes no work, or fails at startup, run:

```sh
./bin/bee doctor --egress-config /absolute/path/egress.json
```

It checks the device configuration, the egress configuration, each platform's local login, the connection to Hive and the device identity, and finally each platform's account and supply state on the Hive side. Checks that need administrator action are marked `fix (administrator)`.

Errors that Bee reports have stable codes such as `BEE-CONFIG-TARGET-MISSING`. [docs/errors.md](docs/errors.md) explains every code and every reason Hive gives for not sending work, and how to fix each one.

## Repository layout

```text
cmd/bee/     command-line entry point
agent/       pairing, authorization sync, egress relay, setup and doctor
beewire/     wire types shared by Bee and Hive
relay/       multiplexed tunnel sessions over WebSocket
logx/        structured logging
telemetry/   metrics and diagnostic timing logs
docs/        error code reference
```

## License

[MIT](LICENSE)
