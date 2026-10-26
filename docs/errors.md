# Bee error codes

When something goes wrong, run `bee doctor` first. It checks every category below in order; see [README · Troubleshooting](../README.md#troubleshooting).

Errors that Bee shows to providers have three parts: an error code, a cause and a fix. A one-shot command prints two lines in the terminal:

```text
[BEE-CONFIG-TARGET-MISSING] a configured platform's upstream address is missing from targets: "claude" is configured but targets lacks api.anthropic.com:443
fix: add the reported address to targets; without it Bee registers the account but refuses every connection Hive sends it
```

When `bee run` exits because of an error, its log line carries three attributes: `code`, `error` and `fix`. Once an error code is published it does not change, so you can use it to look it up on this page or to report a problem to an administrator. The terminal wording may change.

The error catalog is defined in `agent/problems.go`, and a test keeps this page and the catalog in sync. Every code added to the catalog needs its own section here.

## Egress configuration

Errors from reading the egress configuration given to `bee run --egress-config <path>`. The format is described in [README · Egress configuration](../README.md#egress-configuration).

### BEE-CONFIG-NOT-FOUND

The egress configuration file does not exist. Check the path given to `--egress-config`.

### BEE-CONFIG-NOT-REGULAR

The path points to a directory or a symbolic link. Bee reads only regular files and does not follow symbolic links, so `--egress-config` must point to the file itself.

### BEE-CONFIG-PERMISSIONS

Other users can read or write the egress configuration. The configuration may contain credentials, so run `chmod 600 <file>` so that only the user running Bee can access it. The error shows the current permissions.

### BEE-CONFIG-UNREADABLE

The file exists but can't be read. Usually it belongs to a user other than the one running Bee.

### BEE-CONFIG-TOO-LARGE

The file is larger than 64 KiB. An egress configuration has only a few fields, so a file this large contains something unrelated.

### BEE-CONFIG-SYNTAX

The file is not valid JSON. The error gives the line and column of the problem. Common causes are a missing comma, a trailing comma, or unbalanced quotes.

### BEE-CONFIG-UNKNOWN-FIELD

The file contains a field that Bee doesn't recognize, and the error gives its name and position. Bee rejects unknown fields so that a misspelled field is never silently ignored. For example, writing `hom` instead of `home` would otherwise leave the Codex directory unset. The accepted fields are:

| Location | Fields |
| --- | --- |
| Top level | `targets`, `codex`, `claude`, `reseller`, `capabilities`, `connect_proxy`, `inbox_key_id`, `credential` |
| `codex` | `home`, `store`, `keyring_backend` |
| `claude` | `store`, `config_dir`, `refresh`, `capabilities` |
| `capabilities` | `local_url` (only for local test fixtures) |
| `reseller` | `reseller`, `key_file` |

### BEE-CONFIG-FIELD-TYPE

A field has the wrong type. The error gives the field path, the expected type and the position. For example, `targets` must be a list, such as `["chatgpt.com:443"]`, not a string.

### BEE-CONFIG-TRAILING-DATA

There is more content after the JSON object ends. The file must contain exactly one JSON object.

### BEE-CONFIG-NO-TARGETS

`targets` is empty or missing. `targets` lists the upstream addresses this Bee may connect to on behalf of the TEE: `chatgpt.com:443` for OpenAI and `api.anthropic.com:443` for Claude.

### BEE-CONFIG-TOO-MANY-TARGETS

`targets` has more than 16 entries. Keep only the upstream addresses of the platforms you contribute.

### BEE-CONFIG-TARGET-FORMAT

A target is not an exact `host:port`; for example, the port is missing. The error shows the target.

### BEE-CONFIG-TARGET-MISSING

An account source is configured for a platform, but `targets` lacks that platform's upstream address. `codex` requires `chatgpt.com:443`, and `claude` requires `api.anthropic.com:443`.

If Bee didn't stop here, it would still report the platform's account to Hive, and Hive would still send work. Bee would then close every connection at the egress allowlist check, which shows up as executions failing with no visible cause. Add the reported address to `targets`.

A configuration where every target is a loopback IP is a local acceptance fixture: it uses a local upstream in place of the official address, and this check is skipped.

### BEE-CONFIG-NO-SOURCE

The configuration has no official account source (`codex` or `claude`) and no static `credential`. Add the source for each platform you want to contribute.

### BEE-CONFIG-STATIC-MIXED

The configuration has both an official account source and a static `credential`. The two can't be combined, so remove `credential`. `codex` and `claude` can be configured together.

### BEE-CONFIG-STATIC-CREDENTIAL

The static `credential` is incomplete or malformed. It needs a token, a header and a scheme. Static credentials are only for synthetic acceptance tests; real supply uses an official account source.

### BEE-CONFIG-INBOX-KEY

`inbox_key_id` is missing or is not 64 hexadecimal characters. A static credential must name a TEE inbox key ID that was verified through a separate channel. Official account sources may omit the field, but if it is present it must be well formed.

### BEE-CONFIG-PROXY

`connect_proxy` is not an unauthenticated HTTP proxy on a loopback IP. Write it as `http://127.0.0.1:<port>`, or remove the field and use `HTTPS_PROXY` instead.

### BEE-CONFIG-CAPABILITIES-SOURCE

The top-level `capabilities` only enables model and quota reports for Codex, so it requires `codex` to be configured. For Claude, enable capability reports with `claude.capabilities: true`.

### BEE-CONFIG-CAPABILITIES-URL

`capabilities.local_url` is not an HTTP address on a loopback IP. The field is only for local test fixtures; remove it for real supply.

### BEE-CONFIG-RESELLER

`reseller.reseller` names an API reseller Bee does not know. The only supported reseller is `wokey`. An API reseller is the market's fallback supply and only a Bee signed in to the platform's administrator account may supply one; see [API resellers](../README.md#api-resellers).

### BEE-CONFIG-RESELLER-KEY

The reseller key file can't be used. `reseller.key_file` must be an absolute path to a regular file that holds only the key, readable by the user running Bee alone (`chmod 600`). Bee reads it on every synchronization, so replacing the key needs no restart. The key is never printed.

### BEE-CONFIG-CLAUDE-STORE

`claude.store` is neither `keychain` nor `file`. Use `"keychain"` on macOS, where Claude Code keeps its login in the Keychain, and `"file"` on Linux, where it keeps it in `.credentials.json` in its configuration directory. Running `bee setup` writes the right value.

## Setup

Errors from `bee setup`, and from `bee run` when it has no egress configuration. For the steps, see [README · Getting started](../README.md#getting-started).

### BEE-SETUP-NEEDED

`bee run` was given no `--egress-config`, and there is no `egress.json` next to the device configuration. Bee stays online but contributes no accounts. This is a warning, and `bee run` keeps running. Run `bee setup` to choose the accounts to contribute, then restart `bee run`.

### BEE-START-HIVE

This machine is not paired yet, and `bee start` doesn't know which Hive to pair it with. Copy the command from the Devices page of your Hive, which already contains its address, or run `bee start --hive https://your-hive`. The address is remembered, so later runs of `bee start` don't need it.

### BEE-SETUP-PLATFORM

`--platform` names a platform that Bee doesn't support. Use `openai`, `claude`, or both separated by a comma.

### BEE-SETUP-CODEX-NOT-FOUND

Bee can't find the official Codex directory: none of `--codex-home`, `$CODEX_HOME` or `~/.codex` exists. Sign in with the official Codex client first. If the directory is somewhere else, pass it with `--codex-home`.

### BEE-SETUP-NO-ANSWER

`bee setup` needs you to confirm whether to contribute an account, but standard input is closed, for example because it is running in a script or a pipe. Run it in a terminal, or add `--yes` to contribute every account it finds.

### BEE-SETUP-NOTHING

No account was selected, so no egress configuration was written. Make sure the official clients are signed in, then run `bee setup` again and answer yes for the accounts you want to contribute.

### BEE-SETUP-WRITE

Bee could not write the egress configuration. Usually the configuration directory does not exist or belongs to a different user than the one running Bee.

### BEE-SETUP-MANUAL

The existing egress configuration uses settings that `bee setup` doesn't manage (a static `credential` or `capabilities.local_url`). To avoid overwriting them, `bee setup` leaves the file alone. Edit the file by hand, or use `--egress-config` to write to a different location.

## Device and Hive

Errors from `bee doctor` while it checks the device configuration and the connection to Hive.

### BEE-DEVICE-CONFIG

The device configuration (`bee.json`) can't be used. Its permissions are not `0600`, it is not a regular file, its contents are corrupted, or its Hive address or device credential is malformed. Check the `--config` path and the file permissions. Do not delete the configuration while troubleshooting: you would lose the only valid device credential. See [README · Configuration](../README.md#configuration).

### BEE-DEVICE-NOT-PAIRED

This configuration has not finished pairing. Run `bee login` and confirm the pairing code in the web console.

### BEE-DEVICE-REPLACED

Another Bee has replaced this device, and this device's credential has been revoked. Run the new Bee. To let this machine take work again, pair it again with `bee login`.

### BEE-HIVE-UNREACHABLE

Bee can't connect to Hive. Check this machine's network and the Hive address in the device configuration. Hive itself may also be temporarily unavailable.

### BEE-HIVE-CREDENTIAL

Hive rejected this device's credential with HTTP 401 or 403. Make sure this configuration belongs to the current Hive. If that doesn't help, pair again with `bee login`.

### BEE-HIVE-ERROR

Hive returned an unexpected error. Try again later. If it keeps happening, report the error code, the HTTP status and the time to the marketplace administrator.

## Local authorization

Errors from `bee doctor` while it reads each platform's official login named in the egress configuration.

### BEE-CODEX-SOURCE

Bee can't read the official Codex login. The error gives the specific reason, for example `auth.json` is missing, the wrong store was chosen, or the login is not a ChatGPT login. Sign in with the official Codex client, and check `codex.home` and `codex.store` in the egress configuration. The rules are in [README · Egress configuration](../README.md#egress-configuration).

### BEE-CODEX-EXPIRED

The Codex access token has expired. This is a warning, not a failure: while `bee run` is online, Hive schedules a refresh. If supply doesn't recover, sign in again with the official Codex client.

### BEE-CLAUDE-UNSUPPORTED

The egress configuration says `"store": "keychain"`, but the Keychain exists only on macOS. On Linux, Claude Code keeps its login in `.credentials.json`: set `claude.store` to `"file"`, or run `bee setup` again.

### BEE-CLAUDE-SOURCE

Bee can't read the Claude Code login. Sign in with Claude Code as the user that runs Bee. On macOS, unlock the Keychain and allow Bee to read it. On Linux, the login is `~/.claude/.credentials.json` (or `.credentials.json` under `$CLAUDE_CONFIG_DIR`); it must be a regular file, not a symbolic link, readable by that user. If `claude.config_dir` is set, make sure it matches the directory Claude Code uses; see [README · Egress configuration](../README.md#egress-configuration).

### BEE-CLAUDE-EXPIRED

The Claude Code access token has expired. Open Claude Code so that it renews the login, or enable `claude.refresh` in the egress configuration; a running Bee picks up the change automatically. When automatic refresh is enabled, this is only a warning.

### BEE-CLAUDE-SCOPE

The Claude Code login lacks the `user:inference` scope, so it can't be used for inference. Sign in to Claude Code again with a subscription account.

## Egress connections

When `bee run` fails to open a connection to an upstream platform on behalf of the TEE, it logs a `WARN` line with an error code at the default log level, so `BEE_DEBUG` is not needed. The line carries `code`, `host` and `fix`. A network outage makes every connection fail, so the same code and address are logged at most once a minute; the next line reports how many were left out in its `repeated` attribute. These failures are not tied to a particular buyer request.

About every 10 seconds, the logged events are reported to Hive in batches (`POST /api/bee/events`, authenticated with the device credential, at most 20 per batch). An event contains only the time, the error code, the target address and the merged count; it never contains traffic or the proxy address. While Hive is unreachable, Bee keeps at most 100 events in memory and drops the oldest first. Administrators see every provider's events on the Supply Failures page (`/admin/supply-failures`) and can filter them by provider email. Next to a failed attempt in a call's details, they also see that provider's events from one minute before to one minute after the attempt. Providers read their own Bee's local log. Hive keeps the most recent 7 days of events, at most 200 per device.

### BEE-EGRESS-NOT-ALLOWED

Hive asked this Bee to connect to an address that is not in `targets`, and Bee refused. If the address belongs to a platform you contribute, add it to `targets`. Otherwise there is nothing to do: the egress allowlist is working as designed. A configured platform whose address is missing from `targets` is already caught at startup by `BEE-CONFIG-TARGET-MISSING`.

### BEE-EGRESS-DIAL

Bee can't connect to the upstream platform. The log includes the reason the operating system gave, such as a DNS failure (`no such host`), a timeout or a refused connection. Check this machine's network, DNS and firewall. If this machine needs a proxy to reach the platform, set `connect_proxy` in the egress configuration.

### BEE-EGRESS-PROXY

Bee could not open a tunnel through `connect_proxy`. For example, the proxy isn't running, the handshake failed, or the proxy refused the CONNECT. Make sure the proxy is running and allows CONNECT to the platform's address. The log does not include the proxy address.

### BEE-EGRESS-METADATA

Bee couldn't understand a connection request from Hive. This usually means the Bee version doesn't match the marketplace. Update Bee. If it keeps happening, report the error code and the time to the marketplace administrator.

## Supply reasons

These are the reasons Hive gives when a platform can't take new work. They appear in `bee supply-status` and in `reasons` on the devices page of the web console. Reason codes have no `BEE-` prefix; Hive defines them and their names don't change. Reasons marked **administrator** need the marketplace administrator. The provider handles all the others.

### `manually_paused`

Supply for this platform has been paused on this Bee. To take work again, run `bee resume --platform <platform>`.

### `banned`

An administrator has banned supply for this platform. Handled by the **administrator**.

### `device_draining`

This device is being replaced, so it only finishes the work it already has. Run the new Bee; it takes over automatically once the old device has drained.

### `offline`

Hive doesn't see this Bee online. Start `bee run` and make sure it can reach Hive.

### `not_configured`

The platform has no registered account, or the marketplace doesn't offer this platform. If the egress configuration has no account source for the platform, add one and restart `bee run`. If it is already configured, ask the administrator whether the marketplace offers this platform.

### `model_unavailable`

None of the models the marketplace offers is available to this account. Check the account's plan in the official client. If the plan should qualify, ask the administrator which models the marketplace offers.

### `authorization_unavailable`

Hive has no usable sealed authorization from this Bee. Keep `bee run` online. If it persists, sign in again with the official client.

### `capabilities_unknown`

Hive has no recent model and quota report for this account. Keep `bee run` online with capability reports enabled; a report usually arrives within a few minutes.

### `rate_limited`

The upstream platform is rate limiting this account. Supply resumes automatically when the cooldown ends.

### `quota_unknown`

The account's quota windows can't be read. Keep `bee run` online; Bee retries the quota query.

### `quota_exhausted`

The account's subscription quota is used up. Supply resumes automatically when the quota window resets.

### `plan_not_configured`

The marketplace has not set a concurrency limit for this account's plan. Handled by the **administrator**.

### `concurrency_full`

The account is already running as many requests as its plan allows. Nothing to do; it takes new work as requests in flight finish.

### `codex_source_unavailable`

Bee can't currently read the Codex login. Sign in again with the official Codex client; a running Bee picks it up automatically.

### `codex_confirmation_required`

The Codex login switched to a different account, and the change must be confirmed before it takes effect. Run `bee account-status --platform openai` to see the pending fingerprint, then confirm it with `bee confirm-account`.

### `codex_authorization_rejected`

OpenAI rejected the account's authorization. Sign in again with the official Codex client.

### `claude_source_unavailable`

Bee can't currently read the Claude Code login. Sign in to Claude Code again; a running Bee picks it up automatically.

### `claude_confirmation_required`

The Claude Code login switched to a different account, and the change must be confirmed before it takes effect. Run `bee account-status --platform claude` to see the pending fingerprint, then confirm it with `bee confirm-account`.

### `claude_authorization_rejected`

Anthropic rejected the account's authorization. Sign in to Claude Code again.
