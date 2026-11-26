package bee

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/tokhive/bee/beewire"
)

func antigravityStatusCommand(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee antigravity-status", flag.ContinueOnError)
	flags.SetOutput(out)
	configPath := flags.String("config", "", "device configuration file; the sign-in is kept in its directory")
	verify := flags.Bool("verify", false, "read-only verification of the account and its Antigravity tier with Google, using the current access token")
	capabilities := flags.Bool("capabilities", false, "read-only query of the account's Gemini and Claude models and quota windows")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("antigravity-status accepts no extra arguments")
	}
	directory, err := antigravityDirectory(*configPath)
	if err != nil {
		return err
	}
	store := antigravityStoreIn(directory)
	if *capabilities {
		return inspectAntigravityCapabilities(ctx, store, antigravityTransport(ctx, directory), out)
	}
	var transport http.RoundTripper
	if *verify {
		transport = antigravityTransport(ctx, directory)
	}
	report, err := readAntigravityStatus(ctx, store, *verify, transport)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(report)
}

// readAntigravityStatus describes the stored sign-in. Unless asked to verify
// it contacts no one.
func readAntigravityStatus(ctx context.Context, store antigravityStore, verify bool, transport http.RoundTripper) (map[string]any, error) {
	credential, err := store.read()
	if err != nil {
		return nil, failCause("BEE-ANTIGRAVITY-SOURCE", err)
	}
	state := "available"
	switch {
	case credential.Rejected != "":
		state = "sign_in_rejected"
	case !credential.available(time.Now()):
		state = "expired"
	}
	status := map[string]any{
		"source": store.path, "status": state, "email": credential.Email, "plan": credential.Plan, "tier": credential.Tier,
		"project_id": credential.ProjectID, "account_fingerprint": credential.fingerprint(),
		"expires_at":            credential.ExpiresAt.Format(time.RFC3339),
		"refresh_token_present": credential.RefreshToken != "",
		"validation":            "local_structure_only",
	}
	if !verify {
		return status, nil
	}
	if state != "available" {
		return nil, antigravityStoredProblem(credential)
	}
	id, _, err := antigravityUser(ctx, transport, credential.AccessToken)
	if err != nil {
		return nil, antigravityProblem(err)
	}
	if id != credential.UserID {
		return nil, fail("BEE-ANTIGRAVITY-SOURCE", "Google names another account for this sign-in than the one stored with it")
	}
	account, err := antigravityLoad(credential.AccessToken, antigravityAnywhere(ctx, transport, credential.AccessToken))
	if err != nil {
		return nil, antigravityProblem(err)
	}
	if current, err := store.read(); err != nil || !current.same(credential) {
		return nil, errAntigravitySourceChanged
	}
	status["validation"], status["plan"], status["tier"] = "google_account_verified", account.plan, account.tier
	return status, nil
}

// renewable reports a sign-in whose only fault is an access token that has run
// out, which a running Bee has Hive renew.
func (c antigravityCredential) renewable(now time.Time) bool {
	return c.Rejected == "" && beewire.KnownPlan(beewire.GooglePlatform, c.Plan) && c.RefreshToken != "" && !c.available(now)
}

// antigravityStoredProblem catalogues what keeps a stored sign-in from
// supplying as it stands, nil when nothing does.
func antigravityStoredProblem(credential antigravityCredential) error {
	switch {
	case credential.Rejected != "":
		return failf("BEE-ANTIGRAVITY-SIGNIN", "Google answered %s", credential.Rejected)
	case !beewire.KnownPlan(beewire.GooglePlatform, credential.Plan):
		return failf("BEE-ANTIGRAVITY-TIER", "tier %q", credential.Tier)
	case !credential.available(time.Now()):
		detail := fmt.Sprintf("expired %s", credential.ExpiresAt.Local().Format(time.RFC3339))
		if credential.RefreshToken == "" {
			detail += "; no refresh token is stored"
		}
		return fail("BEE-ANTIGRAVITY-EXPIRED", detail)
	}
	return nil
}
