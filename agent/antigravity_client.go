package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/tokhive/bee/beewire"
)

// antigravityCall is one method of the interface Antigravity keeps its
// account state behind (v1internal), with the bounds Bee puts on an answer.
type antigravityCall struct {
	name    string
	limit   int64
	timeout time.Duration
}

var (
	antigravityLoadCodeAssist = antigravityCall{"loadCodeAssist", 1 << 20, 10 * time.Second}
	antigravityOnboardUser    = antigravityCall{"onboardUser", 1 << 20, 10 * time.Second}
	// A model listing approaches a mebibyte.
	antigravityFetchModels  = antigravityCall{"fetchAvailableModels", 4 << 20, 30 * time.Second}
	antigravityQuotaSummary = antigravityCall{"retrieveUserQuotaSummary", 1 << 20, 10 * time.Second}
)

// antigravityOnboardPoll is how long an onboarding still in progress is left
// before it is asked about again; tests shorten it.
var antigravityOnboardPoll = 2 * time.Second

// antigravityFailure is an account call Google did not answer with a result.
type antigravityFailure struct {
	call string
	// status is 0 when no response arrived.
	status int
	detail string
	// retry is how long a 429 asked to be left alone, 0 when it named no time.
	retry time.Duration
	// refusal classes a 403 as validation, violation or forbidden; link is
	// the address its body gives for verifying the account or appealing.
	refusal, link string
}

func (e *antigravityFailure) Error() string {
	if e.status == 0 {
		return "Google " + e.call + " " + e.detail
	}
	return fmt.Sprintf("Google %s answered HTTP %d: %s", e.call, e.status, e.detail)
}

// elsewhere reports a failure the other endpoint may not share: no answer, or
// an answer that says this one cannot serve the call now.
func (e *antigravityFailure) elsewhere() bool {
	return e.status == 0 || e.status == 404 || e.status == 408 || e.status == 429 || e.status >= 500
}

func antigravityHTTP(transport http.RoundTripper, timeout time.Duration) *http.Client {
	return &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// post sends one call to one endpoint. The endpoints are fixed; a transport
// is injectable only for synthetic tests.
func (c antigravityCall) post(ctx context.Context, transport http.RoundTripper, base, token string, body, target any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1internal:"+c.name, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", beewire.AntigravityUserAgent(beewire.AntigravityClientVersion))
	res, err := antigravityHTTP(transport, c.timeout).Do(req)
	if err != nil {
		return &antigravityFailure{call: c.name, detail: safeText(capabilityTransportFailure(err), token)}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 65536))
		failure := &antigravityFailure{call: c.name, status: res.StatusCode, detail: safeResponseBody(raw, token)}
		switch res.StatusCode {
		case http.StatusTooManyRequests:
			failure.retry = googleRetryDelay(raw)
		case http.StatusForbidden:
			failure.refusal, failure.link = googleRefusal(raw)
		}
		return failure
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, c.limit+1))
	if err != nil || int64(len(raw)) > c.limit || json.Unmarshal(raw, target) != nil {
		return &antigravityFailure{call: c.name, status: res.StatusCode, detail: "response not understood"}
	}
	return nil
}

// antigravityPost makes one call for a caller that has chosen where it goes.
type antigravityPost func(call antigravityCall, body, target any) error

// antigravityOn makes calls on one endpoint. Google counts quota apart on
// each, so what describes an account's supply is read from its own.
func antigravityOn(ctx context.Context, transport http.RoundTripper, base, token string) antigravityPost {
	return func(call antigravityCall, body, target any) error {
		return call.post(ctx, transport, base, token, body, target)
	}
}

// antigravityAnywhere makes calls about the account itself, which read no
// quota and so may be answered by either endpoint: production, then daily
// when production did not answer for it.
func antigravityAnywhere(ctx context.Context, transport http.RoundTripper, token string) antigravityPost {
	return func(call antigravityCall, body, target any) error {
		var err error
		for _, host := range []string{beewire.AntigravityHost, beewire.AntigravityDailyHost} {
			if err = call.post(ctx, transport, antigravityBase(host), token, body, target); err == nil {
				return nil
			}
			var failure *antigravityFailure
			if !errors.As(err, &failure) || !failure.elsewhere() || ctx.Err() != nil {
				return err
			}
		}
		return err
	}
}

// googleErrorDetails are the parts of a Google API error body Bee reads.
type googleErrorDetails struct {
	Error struct {
		Details []struct {
			Metadata   map[string]any `json:"metadata"`
			RetryDelay string         `json:"retryDelay"`
		} `json:"details"`
	} `json:"error"`
}

// googleRetryDelay is how long a 429 body asks to be left alone: the quota
// reset it names, else its RetryInfo, else 0.
func googleRetryDelay(raw []byte) time.Duration {
	var body googleErrorDetails
	if json.Unmarshal(raw, &body) != nil {
		return 0
	}
	for _, detail := range body.Error.Details {
		if named, _ := detail.Metadata["quotaResetDelay"].(string); named != "" {
			if delay, err := time.ParseDuration(named); err == nil && delay > 0 {
				return delay
			}
		}
	}
	for _, detail := range body.Error.Details {
		if delay, err := time.ParseDuration(detail.RetryDelay); err == nil && delay > 0 {
			return delay
		}
	}
	return 0
}

var googleLink = regexp.MustCompile(`https://[^\s"'\\]+`)

// googleRefusal classes a 403 body. Google names no stable reason for these,
// so the class comes from the words it uses: asking the person to verify the
// account, citing its terms, or anything else.
func googleRefusal(raw []byte) (class, link string) {
	text := string(raw)
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "validation_required") || strings.Contains(lower, "verify your account") || strings.Contains(lower, "validation_url"):
		class = "validation"
	case strings.Contains(lower, "terms of service") || strings.Contains(lower, "violation"):
		class = "violation"
	default:
		class = "forbidden"
	}
	var body googleErrorDetails
	if json.Unmarshal(raw, &body) == nil {
		for _, detail := range body.Error.Details {
			for _, key := range []string{"validation_url", "appeal_url"} {
				if named, _ := detail.Metadata[key].(string); link == "" {
					link = named
				}
			}
		}
	}
	if link == "" && (strings.Contains(lower, "validation") || strings.Contains(lower, "verify") || strings.Contains(lower, "appeal")) {
		link = googleLink.FindString(strings.ReplaceAll(text, `&`, "&"))
	}
	// The address is shown for the person to open, so it has to be one.
	if u, err := url.Parse(link); err != nil || u.Scheme != "https" || u.Host == "" || len(link) > 2048 || strings.IndexFunc(link, func(r rune) bool { return unicode.IsControl(r) || unicode.IsSpace(r) }) >= 0 {
		link = ""
	}
	return class, link
}

// antigravityID reads an id Google writes either bare or as {"id": ...}.
type antigravityID string

func (id *antigravityID) UnmarshalJSON(raw []byte) error {
	var bare string
	if json.Unmarshal(raw, &bare) == nil {
		*id = antigravityID(strings.TrimSpace(bare))
		return nil
	}
	var object struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &object); err != nil {
		return err
	}
	*id = antigravityID(strings.TrimSpace(object.ID))
	return nil
}

// antigravityAccount is what Google says of an account's place in Antigravity.
type antigravityAccount struct {
	project, tier, plan string
	// onboarding is the tier Google would onboard the account with.
	onboarding string
}

// antigravityLoad asks for the account's project and tier. An account that
// cannot supply, by its tier or by Google's own word, is an error.
func antigravityLoad(token string, post antigravityPost) (antigravityAccount, error) {
	var loaded struct {
		Project    antigravityID `json:"cloudaicompanionProject"`
		Current    antigravityID `json:"currentTier"`
		Paid       antigravityID `json:"paidTier"`
		Ineligible []struct {
			Code    string `json:"reasonCode"`
			Message string `json:"reasonMessage"`
		} `json:"ineligibleTiers"`
		Allowed []struct {
			ID      string `json:"id"`
			Default bool   `json:"isDefault"`
		} `json:"allowedTiers"`
	}
	metadata := map[string]string{"ideType": "ANTIGRAVITY", "ideVersion": beewire.AntigravityClientVersion, "ideName": "antigravity"}
	if err := post(antigravityLoadCodeAssist, map[string]any{"metadata": metadata}, &loaded); err != nil {
		return antigravityAccount{}, err
	}
	account := antigravityAccount{project: string(loaded.Project), tier: string(loaded.Paid)}
	if account.tier == "" {
		account.tier = string(loaded.Current)
	}
	for _, allowed := range loaded.Allowed {
		if allowed.Default && account.onboarding == "" {
			account.onboarding = strings.TrimSpace(allowed.ID)
		}
	}
	// With no default tier named, the account is onboarded with the tier it
	// is on, and failing that the free tier, as CLIProxyAPI does.
	if account.onboarding == "" {
		account.onboarding = strings.TrimSpace(string(loaded.Current))
	}
	if account.onboarding == "" {
		account.onboarding = "free-tier"
	}
	account.plan = antigravityPlan(account.tier)
	if account.plan == "" {
		return account, failf("BEE-ANTIGRAVITY-TIER", "tier %s", strconv.Quote(boundedFailureText(safeText(account.tier, token), 64)))
	}
	// Google lists the tiers it will not admit an account to; with no paid
	// tier beside them, that is the account's whole standing.
	if len(loaded.Ineligible) > 0 && account.plan == "free" {
		reason := strings.TrimSpace(loaded.Ineligible[0].Code + " " + loaded.Ineligible[0].Message)
		return account, fail("BEE-ANTIGRAVITY-INELIGIBLE", boundedFailureText(safeText(reason, token), 512))
	}
	return account, nil
}

// antigravityOnboard gets an account Google has no project for yet its
// project, which Google creates while the call is repeated.
func antigravityOnboard(ctx context.Context, account antigravityAccount, post antigravityPost) (string, error) {
	if account.onboarding == "" {
		return "", fail("BEE-ANTIGRAVITY-PROJECT", "Google names no project and no default tier to onboard the account with")
	}
	request := map[string]any{"tierId": account.onboarding, "metadata": map[string]string{"ideType": "ANTIGRAVITY", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI"}}
	for range 5 {
		var onboarded struct {
			Done     bool `json:"done"`
			Response struct {
				Project antigravityID `json:"cloudaicompanionProject"`
			} `json:"response"`
		}
		if err := post(antigravityOnboardUser, request, &onboarded); err != nil {
			return "", err
		}
		if onboarded.Done {
			if project := string(onboarded.Response.Project); beewire.ValidProjectID(project) {
				return project, nil
			}
			break
		}
		if err := pause(ctx, antigravityOnboardPoll); err != nil {
			return "", err
		}
	}
	return "", fail("BEE-ANTIGRAVITY-PROJECT", "onboarding did not finish with a usable project")
}

// antigravityUser asks Google which account an access token belongs to.
func antigravityUser(ctx context.Context, transport http.RoundTripper, token string) (id, email string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := antigravityHTTP(transport, 10*time.Second).Do(req)
	if err != nil {
		return "", "", &antigravityFailure{call: "userinfo", detail: safeText(capabilityTransportFailure(err), token)}
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	if res.StatusCode != http.StatusOK {
		return "", "", &antigravityFailure{call: "userinfo", status: res.StatusCode, detail: safeResponseBody(raw[:min(len(raw), 65536)], token)}
	}
	var user struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	if err != nil || len(raw) > 65536 || json.Unmarshal(raw, &user) != nil || !beewire.ValidCodexIdentity(user.ID) {
		return "", "", &antigravityFailure{call: "userinfo", status: res.StatusCode, detail: "response names no usable account id"}
	}
	return user.ID, strings.TrimSpace(user.Email), nil
}
