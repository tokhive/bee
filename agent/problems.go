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
		privateFilePermissionFix,
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
		`add a "codex", "claude" or "antigravity" section naming the sign-in to supply`,
	},
	"BEE-CONFIG-STATIC-MIXED": {
		"an official account source is combined with a static credential",
		`remove "credential"; codex, claude and antigravity sources may be configured together`,
	},
	"BEE-CONFIG-STATIC-CREDENTIAL": {
		"the static credential is incomplete or malformed",
		"give the credential a token, header and scheme, or use an official account source instead",
	},
	"BEE-CONFIG-INBOX-KEY": {
		"inbox_key_id is not a 64-character hex key ID",
		"remove it to trust the TEE's attested key, or write the key ID printed by the TEE if this deployment pins one",
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
	"BEE-CONFIG-OPENAI-API": {
		"official OpenAI API supply configuration is invalid",
		"select 1 to 512 distinct model IDs; local_url is only for loopback test fixtures",
	},
	"BEE-CONFIG-OPENAI-API-KEY": {
		"the official API key file is missing, unreadable, open to other users or does not hold a single key",
		"set openai_api.key_file to an absolute path holding only the key, with permissions 600",
	},
	"BEE-CONFIG-CLAUDE-API": {
		"official Claude API supply configuration is invalid",
		"select 1 to 512 distinct model IDs; local_url is only for loopback test fixtures",
	},
	"BEE-CONFIG-CLAUDE-API-KEY": {
		"the official Claude API key file is missing, unreadable, open to other users or does not hold a single key",
		"set claude_api.key_file to an absolute path holding only the key, with permissions 600",
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
		"configuration kept; fix the reported JSON or path issue; " + privateFilePermissionFix + "; then start again",
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
	"BEE-ANTIGRAVITY-SOURCE": {
		"Bee has no usable Antigravity sign-in",
		"run bee antigravity-login and sign in with the Google account to supply",
	},
	"BEE-ANTIGRAVITY-SIGNIN": {
		"Google no longer accepts the stored Antigravity sign-in",
		"run bee antigravity-login to sign in again; the running Bee picks the new sign-in up automatically",
	},
	"BEE-ANTIGRAVITY-EXPIRED": {
		"the Antigravity access token has expired",
		"keep bee run connected so Hive can schedule a refresh; if supply does not resume, run bee antigravity-login",
	},
	"BEE-ANTIGRAVITY-LOGIN": {
		"the Google sign-in did not complete",
		"run bee antigravity-login again and finish the sign-in in the browser; with --no-browser, paste the whole address the browser was sent to",
	},
	"BEE-ANTIGRAVITY-STORE": {
		"Bee could not save the Antigravity sign-in",
		"check that the directory of the device configuration belongs to the user running Bee and that its accounts directory is not a link, then run bee antigravity-login again",
	},
	"BEE-ANTIGRAVITY-TIER": {
		"this Google account's Antigravity tier is not one Bee supplies",
		"sign in with a personal Google account on the free tier, Google AI Pro or Google AI Ultra",
	},
	"BEE-ANTIGRAVITY-INELIGIBLE": {
		"Google does not admit this account to Antigravity",
		"check the account in the Antigravity app; an account Google does not admit cannot supply",
	},
	"BEE-ANTIGRAVITY-PROJECT": {
		"Google gave this account no Antigravity project",
		"open the Antigravity app once with this account so Google finishes setting it up, then run bee antigravity-login again",
	},
	"BEE-ANTIGRAVITY-VERIFY": {
		"Google asks you to verify this account before it can use Antigravity",
		"open the reported address in a browser signed in to this account and finish the verification; Bee tries again by itself",
	},
	"BEE-ANTIGRAVITY-DISABLED": {
		"Google has disabled Antigravity for this account",
		"the account cannot supply while Google keeps it disabled; if an address is reported, appeal there",
	},
	"BEE-ANTIGRAVITY-FORBIDDEN": {
		"Google refused this account's Antigravity request",
		"check that the account can use Antigravity in the official app; if it can, run bee antigravity-login to sign in again",
	},
	"BEE-ANTIGRAVITY-UPSTREAM": {
		"a request to Google for the Antigravity sign-in failed",
		"check the network and HTTPS_PROXY, or connect_proxy in the egress configuration, then try again",
	},
	"BEE-SETUP-PLATFORM": {
		"--platform names a platform Bee does not supply",
		"use openai, claude or google, or several separated by commas",
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
	cause  error
}

func fail(code, detail string) error {
	if _, ok := problems[code]; !ok {
		panic("bee: uncatalogued error code " + code)
	}
	return &codedError{code: code, detail: detail}
}

// failCause preserves the typed cause for menu presentation while keeping the
// established English CLI/JSON format and including the response evidence.
func failCause(code string, cause error) error {
	e := fail(code, cause.Error()).(*codedError)
	e.cause = cause
	if api, ok := cause.(*apiFailure); ok {
		e.detail += fmt.Sprintf(" (HTTP %d; code=%s)", api.Status, api.Code)
	}
	return e
}
func (e *codedError) Unwrap() error { return e.cause }

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
