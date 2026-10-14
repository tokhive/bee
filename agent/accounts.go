package bee

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

// accountStateLabels names each account state a provider can be in, for
// `bee account-status`.
var accountStateLabels = map[string]string{
	"not_configured":         "no registered account",
	"ready":                  "authorization synchronized",
	"source_unavailable":     "waiting for official authorization recovery or synchronization",
	"confirmation_required":  "account changed; awaiting explicit confirmation",
	"authorization_rejected": "authorization rejected by upstream; waiting for an official client update",
}

// reportReadiness states, once per connection, whether a platform takes new
// work and if not why, in the words bee doctor uses.
//
// Otherwise the log says nothing about a platform until its account state
// changes, and the states a provider is most likely to be stuck in — no
// registered account, a plan the market has no limit for, a pause they forgot
// — produce no change message at all. A provider then sees a connected Bee,
// no errors, and no dispatch, with nothing in the log accounting for it.
//
// It runs after the platform's first synchronization, so that Hive already
// holds this connection's authorization and the report is not a stale
// "no authorization" from the moment before.
func reportReadiness(ctx context.Context, state localState, platform string, out io.Writer) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var report doctorReport
	checkPlatform(ctx, &report, state, platform, true)
	if ctx.Err() != nil && errors.Is(ctx.Err(), context.Canceled) {
		return
	}
	account := ""
	ready := true
	for _, c := range report.Checks {
		switch {
		case c.Status == "fail":
			ready = false
			attrs := []any{"platform", platform, "code", c.Code, "fix", c.Fix}
			if c.Admin {
				attrs = append(attrs, "owner", "administrator")
			}
			notify(out, slog.LevelWarn, "ready", platform+" not taking new work: "+c.Detail, attrs...)
		case c.Name == "account":
			account = c.Detail
		}
	}
	if ready {
		notify(out, slog.LevelInfo, "ready", platform+" ready: taking new work", "platform", platform, "account", account)
	}
}

func accountControl(ctx context.Context, state localState, platform, fingerprint string, confirm bool, out io.Writer) error {
	path := "/api/bee/platforms/" + platform + "/account"
	var account beewire.PlatformAccount
	if err := call(ctx, httpClient(), state.Hive, path, "GET", state.Credential, nil, &account); err != nil {
		return err
	}
	if account.Platform != platform {
		return errors.New("Hive returned an unexpected account platform")
	}
	if confirm {
		fingerprint = strings.ToLower(fingerprint)
		decoded, err := hex.DecodeString(fingerprint)
		if err != nil || len(decoded) != 32 {
			return errors.New("--account-fingerprint must specify the full account fingerprint to confirm")
		}
		if account.PendingFingerprint != fingerprint || account.ConfirmationID == "" || account.Status != "confirmation_required" {
			if account.AccountFingerprint == fingerprint && account.PendingFingerprint == "" {
				fmt.Fprintln(out, "account already confirmed")
			} else {
				return errors.New("pending account changed or expired; run bee account-status again")
			}
		} else {
			input := map[string]string{"account_fingerprint": fingerprint, "confirmation_id": account.ConfirmationID}
			if err := call(ctx, httpClient(), state.Hive, path+"/confirm", "POST", state.Credential, input, &account); err != nil {
				return fmt.Errorf("account confirmation result unconfirmed; query account status again: %w", err)
			}
			if account.Platform != platform || account.AccountFingerprint != fingerprint {
				return errors.New("unexpected Hive account confirmation result; query again")
			}
			fmt.Fprintln(out, "Hive confirmed the account switch; waiting for the running Bee to synchronize authorization; manual pause state is preserved")
		}
	}
	label, ok := accountStateLabels[account.Status]
	if !ok {
		return errors.New("Hive returned an unknown account state")
	}
	fmt.Fprintf(out, "Platform: %s\nAccount state: %s\nConfirmed account fingerprint: %s\nAccount generation: %d\n", platform, label, account.AccountFingerprint, account.Generation)
	if account.PendingFingerprint != "" {
		fmt.Fprintf(out, "Pending account fingerprint: %s\n", account.PendingFingerprint)
	}
	return nil
}
