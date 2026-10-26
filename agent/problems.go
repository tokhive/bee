package bee

import (
	"errors"
	"fmt"
	"strings"

	"github.com/tokhive/bee/beewire"
)

// problem is one entry of the Bee error catalog: a stable code a provider can
// quote or look up in docs/errors.md, what went wrong, and what to do.
// Codes never change once released; the wording may.
type problem struct {
	cause, fix string
}

var problems = map[string]problem{
	"BEE-CONFIG-NOT-FOUND": {
		"egress configuration file does not exist",
		"check the --egress-config path, or create the file",
	},
	"BEE-CONFIG-NOT-REGULAR": {
		"egress configuration is not a regular file",
		"point --egress-config at the file itself, not a directory or symbolic link",
	},
	"BEE-CONFIG-PERMISSIONS": {
		"egress configuration is readable or writable by other users",
		"run chmod 600 on the file; it must be accessible only to the user running Bee",
	},
	"BEE-CONFIG-UNREADABLE": {
		"egress configuration cannot be read",
		"check that the user running Bee owns the file and can read it",
	},
	"BEE-CONFIG-TOO-LARGE": {
		"egress configuration exceeds 64 KiB",
		"remove content that does not belong in the egress configuration",
	},
	"BEE-CONFIG-SYNTAX": {
		"egress configuration is not valid JSON",
		"fix the JSON at the reported line and column",
	},
	"BEE-CONFIG-UNKNOWN-FIELD": {
		"egress configuration has a field Bee does not recognize",
		"remove the field or correct its spelling; see docs/errors.md for the accepted fields",
	},
	"BEE-CONFIG-FIELD-TYPE": {
		"an egress configuration field has the wrong type",
		"give the field a value of the expected type",
	},
	"BEE-CONFIG-TRAILING-DATA": {
		"egress configuration has content after its JSON object",
		"keep exactly one JSON object in the file",
	},
	"BEE-CONFIG-NO-TARGETS": {
		"egress configuration lists no targets",
		"list the upstream addresses this Bee may reach in targets, for example chatgpt.com:443 for OpenAI and api.anthropic.com:443 for Claude",
	},
	"BEE-CONFIG-TOO-MANY-TARGETS": {
		"egress configuration lists more than 16 targets",
		"keep only the upstream addresses of the platforms you supply",
	},
	"BEE-CONFIG-TARGET-FORMAT": {
		"an egress target is not an exact host:port",
		"write each target as host:port, for example chatgpt.com:443",
	},
	"BEE-CONFIG-TARGET-MISSING": {
		"a configured platform's upstream address is missing from targets",
		"add the reported address to targets; without it Bee registers the account but refuses every connection Hive sends it",
	},
	"BEE-CONFIG-NO-SOURCE": {
		"egress configuration has neither an official account source nor a static credential",
		`add a "codex" or "claude" section naming the official sign-in to supply`,
	},
	"BEE-CONFIG-STATIC-MIXED": {
		"an official account source is combined with a static credential",
		`remove "credential"; codex and claude sources may be configured together`,
	},
	"BEE-CONFIG-STATIC-CREDENTIAL": {
		"the static credential is incomplete or malformed",
		"give the credential a token, header and scheme, or use an official account source instead",
	},
	"BEE-CONFIG-INBOX-KEY": {
		"inbox_key_id is missing or is not a 64-character hex key ID",
		"static credentials need the TEE inbox public key ID verified through an independent channel; official account sources may omit it",
	},
	"BEE-CONFIG-PROXY": {
		"connect_proxy is not an unauthenticated HTTP proxy at a loopback IP address and port",
		"write connect_proxy as http://127.0.0.1:PORT, or remove it and use HTTPS_PROXY",
	},
	"BEE-CONFIG-CAPABILITIES-SOURCE": {
		`"capabilities" needs an official Codex source`,
		`add a "codex" section, or remove "capabilities"; Claude capability reporting is enabled with claude.capabilities`,
	},
	"BEE-CONFIG-CAPABILITIES-URL": {
		"capabilities.local_url is not an HTTP address at a loopback IP",
		"remove local_url; it exists only for local test fixtures",
	},
	"BEE-CONFIG-RESELLER": {
		"reseller names an API reseller Bee does not know",
		"set reseller.reseller to a supported reseller, such as wokey",
	},
	"BEE-CONFIG-RESELLER-KEY": {
		"the reseller key file is missing, unreadable, open to other users or does not hold a single key",
		"set reseller.key_file to an absolute path of a file holding only the key, and run chmod 600 on it",
	},
	"BEE-CONFIG-CLAUDE-STORE": {
		`claude.store is neither "keychain" nor "file"`,
		`set claude.store to "keychain" on macOS or "file" on Linux, or run bee setup to write it`,
	},
	"BEE-DEVICE-CONFIG": {
		"the Bee device configuration cannot be used",
		"check the --config path; the file must be accessible only to the user running Bee (chmod 600)",
	},
	"BEE-DEVICE-NOT-PAIRED": {
		"this Bee is not paired with Hive",
		"run bee login and confirm the pairing code in the web console",
	},
	"BEE-DEVICE-REPLACED": {
		"another Bee has replaced this device",
		"run the new Bee, or pair this one again with bee login",
	},
	"BEE-HIVE-UNREACHABLE": {
		"Bee cannot reach Hive",
		"check the network and the Hive address in the device configuration; Hive may also be down",
	},
	"BEE-HIVE-CREDENTIAL": {
		"Hive rejected this Bee's device credential",
		"check that the device configuration belongs to this Hive, or pair again with bee login",
	},
	"BEE-HIVE-ERROR": {
		"Hive returned an unexpected error",
		"retry; if it persists, report the code and time to the market administrator",
	},
	"BEE-CODEX-SOURCE": {
		"Bee cannot read the official Codex sign-in",
		"sign in with the official Codex client, and check codex.home and codex.store in the egress configuration",
	},
	"BEE-CODEX-EXPIRED": {
		"the Codex access token has expired",
		"keep bee run connected so Hive can schedule a refresh; if supply does not resume, sign in again in the official Codex client",
	},
	"BEE-CLAUDE-UNSUPPORTED": {
		"the Claude Code Keychain exists only on macOS",
		`set claude.store to "file" to read Claude Code's .credentials.json, or run bee setup again`,
	},
	"BEE-CLAUDE-SOURCE": {
		"Bee cannot read the Claude Code sign-in",
		"sign in with Claude Code as the user running Bee; on macOS unlock the Keychain and allow Bee to read it; check claude.config_dir if you set one",
	},
	"BEE-CLAUDE-EXPIRED": {
		"the Claude Code access token has expired",
		"open Claude Code so it renews the sign-in, or enable claude.refresh; the running Bee synchronizes automatically",
	},
	"BEE-CLAUDE-SCOPE": {
		"the Claude Code sign-in lacks the user:inference scope",
		"sign in again in Claude Code with a subscription account",
	},
	"BEE-SETUP-PLATFORM": {
		"--platform names a platform Bee does not supply",
		"use openai, claude, or both separated by a comma",
	},
	"BEE-SETUP-CODEX-NOT-FOUND": {
		"no official Codex directory was found",
		"sign in with the official Codex client first, or pass its directory with --codex-home",
	},
	"BEE-SETUP-NO-ANSWER": {
		"bee setup needs an answer but standard input is closed",
		"run it in a terminal, or pass --yes to supply every account found",
	},
	"BEE-SETUP-NOTHING": {
		"no account was selected, so no configuration was written",
		"sign in with an official client and run bee setup again, answering yes for the account to supply",
	},
	"BEE-SETUP-WRITE": {
		"bee setup could not write the egress configuration",
		"check that the configuration directory exists and belongs to the user running Bee",
	},
	"BEE-SETUP-MANUAL": {
		"the existing egress configuration uses settings bee setup does not manage",
		"edit that file by hand, or pass --egress-config to write a new one elsewhere",
	},
	"BEE-SETUP-NEEDED": {
		"bee run has no egress configuration, so this Bee stays online but supplies no account",
		"run bee setup to choose the accounts to supply, then restart bee run",
	},
	"BEE-START-HIVE": {
		"bee start needs the Hive address to pair this machine",
		"copy the bee start command from your Hive's Devices page, or run bee start --hive https://your-hive",
	},
}

// The egress codes are also reported to Hive as supply events, so their text
// lives with the event definitions both sides read.
func init() {
	for _, code := range beewire.EventCodes() {
		if explained, _ := beewire.ExplainEvent(code); strings.HasPrefix(code, "BEE-") {
			problems[code] = problem{explained.Cause, explained.Fix}
		}
	}
}

// codedError is an error from the catalog, with the detail of this occurrence.
type codedError struct {
	code   string
	detail string
}

func fail(code, detail string) error {
	if _, ok := problems[code]; !ok {
		panic("bee: uncatalogued error code " + code)
	}
	return &codedError{code: code, detail: detail}
}

func failf(code, format string, args ...any) error {
	return fail(code, fmt.Sprintf(format, args...))
}

// Summary is the one-line form: code, cause and this occurrence's detail.
func (e *codedError) Summary() string {
	text := "[" + e.code + "] " + problems[e.code].cause
	if e.detail != "" {
		text += ": " + e.detail
	}
	return text
}

func (e *codedError) Code() string { return e.code }
func (e *codedError) Fix() string  { return problems[e.code].fix }

func (e *codedError) Error() string { return e.Summary() + "\nfix: " + e.Fix() }

// Coded reports the catalog code, summary and fix of err, if it has one.
func Coded(err error) (code, summary, fix string, ok bool) {
	var coded *codedError
	if !errors.As(err, &coded) {
		return "", "", "", false
	}
	return coded.code, coded.Summary(), coded.Fix(), true
}
