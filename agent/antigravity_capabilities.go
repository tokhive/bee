package bee

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

type antigravityCapabilitySource struct {
	fingerprint    string
	retryAt        time.Time
	cached         beewire.Capabilities
	cachedAt       time.Time
	metadataModels []string
	metadataPlan   string
	metadataAt     time.Time
	// metadataStored is the stored plan the metadata was read for. The plan
	// reported is the one Google names, which a sign-in stored before a
	// change of subscription does not show until its next refresh.
	metadataStored string
	cooldown       cooldownStore
	restored       bool
	// failure is why the last observation came out unknown, empty when it
	// did not; logged is the failure the operator was last told about.
	failure, logged string
	// problem is Google refusing the account itself, which no later query
	// mends; announced is the one the operator was last shown.
	problem   error
	announced string
	// staleToken is the revision of an access token Google answered 401 to
	// although it has not expired. refreshRevision and refreshAt record the
	// last time Bee asked Hive to refresh for that, as for OpenAI.
	staleToken      string
	refreshRevision string
	refreshAt       time.Time
}

func (s *antigravityCapabilitySource) wantsRefresh(revision string, now time.Time) bool {
	return s.staleToken != "" && s.staleToken == revision && s.refreshRevision != revision &&
		(s.refreshAt.IsZero() || !now.Before(s.refreshAt.Add(staleRefreshInterval)))
}

func (s *antigravityCapabilitySource) askedRefresh(revision string, now time.Time) {
	s.refreshRevision, s.refreshAt = revision, now
}

// reusable reports whether the last query still describes the account: it must
// be recent, and no window it carries may have reset since it was read.
func (s *antigravityCapabilitySource) reusable(now time.Time) bool {
	if s.cached.Status != "ready" || s.cachedAt.IsZero() || !now.Before(s.cachedAt.Add(capabilityTTL)) || !now.Before(s.metadataAt.Add(capabilityMetadataTTL)) {
		return false
	}
	for _, window := range s.cached.Windows {
		if !now.Before(window.ResetAt) {
			return false
		}
	}
	return true
}

// Control queries use the stored access token only; they neither refresh it
// nor see buyer traffic.
func (s *antigravityCapabilitySource) observe(ctx context.Context, credential antigravityCredential, sequence int64, transport http.RoundTripper) beewire.Capabilities {
	now := wallNow()
	unknown := beewire.Capabilities{Sequence: sequence, ObservedAt: now, Status: "unknown", Models: []string{}, Windows: []beewire.QuotaWindow{}}
	s.failure, s.problem, s.staleToken = "", nil, ""
	fail := func(reason string) beewire.Capabilities {
		s.failure = reason
		return unknown
	}
	fingerprint := credential.fingerprint()
	if s.fingerprint != fingerprint {
		s.fingerprint, s.retryAt, s.cached, s.cachedAt = fingerprint, time.Time{}, beewire.Capabilities{}, time.Time{}
		s.metadataModels, s.metadataPlan, s.metadataStored, s.metadataAt, s.restored = nil, "", "", time.Time{}, false
	}
	// A cooldown this account was already serving is adopted once, so a
	// restart does not hand the endpoint a query it asked not to receive.
	if !s.restored {
		s.restored = true
		s.retryAt = s.cooldown.load(beewire.GooglePlatform, fingerprint, now)
	}
	limited := func() beewire.Capabilities {
		result := unknown
		at := s.retryAt
		result.Status, result.RetryAt = "rate_limited", &at
		return result
	}
	if now.Before(s.retryAt) {
		return limited()
	}
	if s.reusable(now) && s.metadataStored == credential.Plan {
		result := s.cached
		result.Sequence, result.ObservedAt = sequence, now
		result.Models = append([]string(nil), s.cached.Models...)
		result.Windows = append([]beewire.QuotaWindow(nil), s.cached.Windows...)
		if result.ValidFor(beewire.GooglePlatform, now) {
			return result
		}
		s.cached, s.cachedAt = beewire.Capabilities{}, time.Time{}
	}
	if !credential.available(now) {
		return fail("Antigravity access token expired or about to expire")
	}
	s.retryAt = time.Time{}
	refused := func(err error) beewire.Capabilities {
		// A tier Bee does not supply, or Google's word that it will not
		// admit the account.
		if _, summary, _, coded := Coded(err); coded {
			s.problem = err
			return fail(summary)
		}
		var failure *antigravityFailure
		if errors.As(err, &failure) {
			switch failure.status {
			case http.StatusTooManyRequests:
				// A wait Google names is kept, within what Hive accepts of a
				// report; one it does not name is the usual backoff.
				delay := failure.retry
				if delay <= 0 {
					delay = capabilityBackoff
				}
				s.retryAt = wallNow().Add(min(max(delay, 30*time.Second), time.Hour))
				s.cooldown.save(beewire.GooglePlatform, fingerprint, s.retryAt)
				return limited()
			case http.StatusUnauthorized:
				// The token has time left and Google no longer honours it;
				// a refreshed one is what Hive is asked for.
				s.staleToken = antigravityDigest(credential.AccessToken)
			case http.StatusForbidden:
				s.problem = antigravityProblem(err)
			}
		}
		return fail(err.Error())
	}
	// Google counts quota apart on each endpoint, so models and quota are read
	// from the one that serves this account's requests and from no other. The
	// plan decides which; it is asked for where the stored plan is served,
	// which is the same endpoint unless the subscription has just changed.
	plan, models, body := s.metadataPlan, s.metadataModels, map[string]string{"project": credential.ProjectID}
	metadataFresh := s.metadataAt.IsZero() || s.metadataStored != credential.Plan || !now.Before(s.metadataAt.Add(capabilityMetadataTTL))
	if metadataFresh {
		account, err := antigravityLoad(credential.AccessToken, antigravityOn(ctx, transport, credential.base(), credential.AccessToken))
		if err != nil {
			return refused(err)
		}
		plan = account.plan
		var listing struct {
			Models map[string]json.RawMessage `json:"models"`
		}
		if err := antigravityFetchModels.post(ctx, transport, antigravityBase(beewire.AntigravityHostFor(plan)), credential.AccessToken, body, &listing); err != nil {
			return refused(err)
		}
		if listing.Models == nil {
			return fail("fetchAvailableModels lists no models")
		}
		models = antigravityModels(listing.Models)
	}
	var summary antigravityQuota
	if err := antigravityQuotaSummary.post(ctx, transport, antigravityBase(beewire.AntigravityHostFor(plan)), credential.AccessToken, body, &summary); err != nil {
		return refused(err)
	}
	s.cooldown.save(beewire.GooglePlatform, fingerprint, time.Time{})
	windows, reason := parseAntigravityQuota(summary, now)
	if reason != "" {
		return fail("retrieveUserQuotaSummary quota windows not understood: " + reason)
	}
	result := unknown
	result.Status, result.Plan, result.Windows = "ready", plan, windows
	result.Models = append(result.Models, models...)
	result.MetadataObservedAt = s.metadataAt
	if metadataFresh {
		result.MetadataObservedAt = now
	}
	if !result.ValidFor(beewire.GooglePlatform, time.Now()) {
		return fail("capability snapshot failed validation")
	}
	if metadataFresh {
		s.metadataModels, s.metadataPlan, s.metadataStored, s.metadataAt = models, plan, credential.Plan, now
	}
	s.cached, s.cachedAt = result, now
	return result
}

// antigravityModels are the Gemini text models of a listing, under the names
// the upstream serves them by: a thinking model is listed once per level, and
// Hive finds a catalog model among those names. Image models are metered
// apart and are not supplied.
func antigravityModels(listed map[string]json.RawMessage) []string {
	models := []string{}
	for id := range listed {
		if strings.HasPrefix(id, "gemini-") && !strings.Contains(id, "image") && beewire.ValidModelIDs([]string{id}) {
			models = append(models, id)
		}
	}
	sort.Strings(models)
	return models[:min(len(models), 128)]
}

// antigravityQuota is retrieveUserQuotaSummary's answer: for each group of
// models that share their limits, a bucket per window.
type antigravityQuota struct {
	Groups []struct {
		Buckets []struct {
			ID     string `json:"bucketId"`
			Window string `json:"window"`
			Reset  string `json:"resetTime"`
			// A fraction left out is zero: nothing remains.
			Remaining float64 `json:"remainingFraction"`
		} `json:"buckets"`
	} `json:"groups"`
}

// parseAntigravityQuota reads the five-hour and weekly windows the Gemini
// models share. The other groups meter models this account is not supplied
// for. A window nothing has used carries no reset time: the first request
// starts it, and it cannot reset later than one full window from now.
func parseAntigravityQuota(summary antigravityQuota, now time.Time) ([]beewire.QuotaWindow, string) {
	var windows []beewire.QuotaWindow
	for _, group := range summary.Groups {
		for _, bucket := range group.Buckets {
			seconds := map[string]int{"5h": 18000, "weekly": 604800}[bucket.Window]
			if !strings.HasPrefix(bucket.ID, "gemini-") || seconds == 0 {
				continue
			}
			if slices.ContainsFunc(windows, func(w beewire.QuotaWindow) bool { return w.Seconds == seconds }) {
				return nil, "the " + bucket.Window + " window is reported twice"
			}
			reset := now.Add(time.Duration(seconds) * time.Second)
			if bucket.Reset != "" {
				var err error
				if reset, err = time.Parse(time.RFC3339, bucket.Reset); err != nil || !reset.After(now) {
					return nil, bucket.ID + " has no future reset time"
				}
			}
			used := min(max(int(math.Round((1-bucket.Remaining)*100)), 0), 100)
			windows = append(windows, beewire.QuotaWindow{Seconds: seconds, UsedPercent: &used, ResetAt: reset})
		}
	}
	if len(windows) == 0 {
		return nil, "no Gemini quota window"
	}
	sort.Slice(windows, func(i, j int) bool { return windows[i].Seconds < windows[j].Seconds })
	return windows, ""
}

// announce shows the operator, once, that Google refuses the account and what
// to do about it. Hive only ever hears that the capabilities are unknown.
func (s *antigravityCapabilitySource) announce(out io.Writer) {
	code, summary, fix, _ := Coded(s.problem)
	if summary == s.announced {
		return
	}
	s.announced = summary
	if summary != "" {
		notify(out, slog.LevelError, "capabilities", summary, "platform", beewire.GooglePlatform, "code", code, "fix", fix)
	}
}

// antigravityProblem catalogues a failed Google call. A 403 is Google
// refusing the account, and which refusal decides what the Provider can do.
func antigravityProblem(err error) error {
	if _, _, _, coded := Coded(err); coded {
		return err
	}
	var failure *antigravityFailure
	if !errors.As(err, &failure) || failure.status != http.StatusForbidden {
		return failCause("BEE-ANTIGRAVITY-UPSTREAM", err)
	}
	code := map[string]string{"validation": "BEE-ANTIGRAVITY-VERIFY", "violation": "BEE-ANTIGRAVITY-DISABLED"}[failure.refusal]
	if code == "" {
		code = "BEE-ANTIGRAVITY-FORBIDDEN"
	}
	detail := boundedFailureText(failure.Error(), 2000)
	if failure.link != "" {
		detail = failure.link + " (" + detail + ")"
	}
	return fail(code, detail)
}

func inspectAntigravityCapabilities(ctx context.Context, store antigravityStore, transport http.RoundTripper, out io.Writer) error {
	snapshot, err := readAntigravityCapabilities(ctx, store, transport)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(snapshot)
}

func readAntigravityCapabilities(ctx context.Context, store antigravityStore, transport http.RoundTripper) (beewire.Capabilities, error) {
	credential, err := store.read()
	if err != nil {
		return beewire.Capabilities{}, failCause("BEE-ANTIGRAVITY-SOURCE", err)
	}
	var source antigravityCapabilitySource
	snapshot := source.observe(ctx, credential, 1, transport)
	if current, err := store.read(); err != nil || !current.same(credential) {
		return beewire.Capabilities{}, errAntigravitySourceChanged
	}
	switch {
	case source.problem != nil:
		return beewire.Capabilities{}, source.problem
	case snapshot.Status == "rate_limited":
		return beewire.Capabilities{}, errors.New("Google is limiting account queries; try again after " + snapshot.RetryAt.Local().Format(time.RFC3339))
	case snapshot.Status != "ready":
		return beewire.Capabilities{}, errors.New("Antigravity capability query failed; quota remains unknown: " + source.failure)
	}
	return snapshot, nil
}
