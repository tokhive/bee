package bee

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/tokhive/bee/beewire"
)

func platformControl(ctx context.Context, client *http.Client, state localState, platform, command string, out io.Writer) error {
	method := "GET"
	var input any
	if command != "supply-status" {
		method = "PUT"
		input = map[string]bool{"paused": command == "pause"}
	}
	var result beewire.PlatformSupply
	err := call(ctx, client, state.Hive, "/api/bee/platforms/"+platform, method, state.Credential, input, &result)
	if err != nil {
		if method == "PUT" {
			return fmt.Errorf("operation result unconfirmed: %w; connect to Hive and run bee supply-status --platform %s to verify; the same operation can be retried", err, platform)
		}
		return err
	}
	if result.Platform != platform || (method == "PUT" && result.Paused != (command == "pause")) {
		return fmt.Errorf("Hive returned a state inconsistent with the operation; run bee supply-status --platform %s to verify again", platform)
	}
	if method == "PUT" {
		action := "manual pause cleared"
		if result.Paused {
			action = "manually paused"
		}
		fmt.Fprintf(out, "Hive confirmed %s %s\n", platform, action)
	}
	paused := "no"
	if result.Paused {
		paused = "yes"
	}
	fmt.Fprintf(out, "Platform: %s\nManually paused: %s\n", platform, paused)
	if result.Ready {
		fmt.Fprintln(out, "supply requirements satisfied")
	}
	for _, reason := range result.Reasons {
		label, ok := supplyReasonLabels[reason]
		if !ok {
			label = "supply requirements awaiting verification"
		}
		fmt.Fprintln(out, label)
	}
	return nil
}

// supplyReasonLabels says each reason Hive gives for not sending work in a
// few words, for bee supply-status and bee status.
var supplyReasonLabels = map[string]string{
		"capabilities_unknown": "account capabilities unknown or expired", "quota_unknown": "quota awaiting a new query", "quota_exhausted": "account quota exhausted", "rate_limited": "upstream rate limit cooldown active", "concurrency_full": "account concurrency limit reached",
		"manually_paused": "manually paused", "banned": "banned by administrator", "device_draining": "device being replaced; finishing in-flight execution and settlement", "plan_not_configured": "no concurrency limit configured for this plan", "offline": "Bee offline", "not_configured": "supply not configured",
		"model_unavailable": "model not tradable", "codex_authorization_rejected": "Codex authorization rejected by upstream",
		"authorization_unavailable":     "no valid online authorization envelope",
		"codex_source_unavailable":      "waiting for official Codex authorization recovery",
		"codex_confirmation_required":   "OpenAI account changed; awaiting explicit confirmation",
		"claude_authorization_rejected": "Claude authorization rejected by upstream",
		"claude_source_unavailable":     "waiting for official Claude Code authorization recovery",
		"claude_confirmation_required":  "Claude account changed; awaiting explicit confirmation",
	}
