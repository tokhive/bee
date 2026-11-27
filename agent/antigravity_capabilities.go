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
	// metadataLevels are the thinking levels the listing declares for each
	// model; metadataSpent the listed models whose own quota was spent, with
	// when it resets (fetchAvailableModels' quotaInfo).
	metadataLevels map[string][]string
	metadataSpent  map[string]time.Time
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
	plan, models, levels, spent, body := s.metadataPlan, s.metadataModels, s.metadataLevels, s.metadataSpent, map[string]string{"project": credential.ProjectID}
	metadataFresh := s.metadataAt.IsZero() || s.metadataStored != credential.Plan || !now.Before(s.metadataAt.Add(capabilityMetadataTTL))
	if metadataFresh {
		account, err := antigravityLoad(credential.AccessToken, antigravityOn(ctx, transport, credential.base(), credential.AccessToken))
		if err != nil {
			return refused(err)
		}
		plan = account.plan
		var listing struct {
			Models        map[string]json.RawMessage `json:"models"`
			GroupedModels map[string]json.RawMessage `json:"groupedModels"`
		}
		if err := antigravityFetchModels.post(ctx, transport, antigravityBase(beewire.AntigravityHostFor(plan)), credential.AccessToken, body, &listing); err != nil {
			return refused(err)
		}
		if listing.Models == nil {
			return fail("fetchAvailableModels lists no models")
		}
		models = antigravityModels(listing.Models)
		levels = antigravityThinkingLevels(listing.GroupedModels, models)
		spent = antigravitySpent(listing.Models, now)
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
	result.Models, result.ThinkingLevels = antigravityAvailable(models, levels, spent, now)
	result.MetadataObservedAt = s.metadataAt
	if metadataFresh {
		result.MetadataObservedAt = now
	}
	if !result.ValidFor(beewire.GooglePlatform, time.Now()) {
		return fail("capability snapshot failed validation")
	}
	if metadataFresh {
		s.metadataModels, s.metadataPlan, s.metadataStored, s.metadataAt = models, plan, credential.Plan, now
		s.metadataLevels, s.metadataSpent = levels, spent
	}
	s.cached, s.cachedAt = result, now
	return result
}

// antigravityModels are the Gemini and Claude text models of a listing, under
// the names the upstream serves them by: a thinking model is listed once per
// level, and Hive finds a catalog model among those names. Image models are
// metered apart and are not supplied, nor are the other partner models.
func antigravityModels(listed map[string]json.RawMessage) []string {
	models := []string{}
	for id := range listed {
		if (strings.HasPrefix(id, "gemini-") || beewire.GoogleClaudeModel(id)) && !strings.Contains(id, "image") && beewire.ValidModelIDs([]string{id}) {
			models = append(models, id)
		}
	}
	sort.Strings(models)
	return models[:min(len(models), 128)]
}

// antigravityThinkingLevels reads the thinking levels a listing declares for
// each model, under groupedModels: a model gemini-4-argon declaring the level
// "low" is listed as gemini-4-argon-low (CLIProxyAPI reads the same field).
// Only levels whose model-level name is among the models supplied are kept.
func antigravityThinkingLevels(grouped map[string]json.RawMessage, models []string) map[string][]string {
	listed := make(map[string]bool, len(models))
	for _, id := range models {
		listed[id] = true
	}
	levels := map[string][]string{}
	for model, raw := range grouped {
		var group struct {
			Levels []struct {
				Suffix string `json:"thinkingSuffix"`
			} `json:"supportedThinkingLevels"`
		}
		if json.Unmarshal(raw, &group) != nil {
			continue
		}
		for _, level := range group.Levels {
			suffix := strings.ToLower(level.Suffix)
			if suffix != "" && len(levels[model]) < 8 && listed[model+"-"+suffix] && !slices.Contains(levels[model], suffix) {
				levels[model] = append(levels[model], suffix)
			}
		}
	}
	if len(levels) == 0 {
		return nil
	}
	return levels
}

// antigravitySpent are the listed models whose own quota is spent, with when
// it resets: quotaInfo with nothing remaining (a fraction left out is zero, as
// in the quota summary) and a reset still to come. sub2api reads the same.
func antigravitySpent(listed map[string]json.RawMessage, now time.Time) map[string]time.Time {
	spent := map[string]time.Time{}
	for id, raw := range listed {
		var model struct {
			Quota *struct {
				Remaining float64 `json:"remainingFraction"`
				Reset     string  `json:"resetTime"`
			} `json:"quotaInfo"`
		}
		if json.Unmarshal(raw, &model) != nil || model.Quota == nil || model.Quota.Remaining > 0 {
			continue
		}
		if reset, err := time.Parse(time.RFC3339, model.Quota.Reset); err == nil && reset.After(now) {
			spent[id] = reset
		}
	}
	return spent
}

// antigravityAvailable are the models to report now, and their declared
// levels: a model whose quota is spent is left out until it resets, so Hive
// sends it no request the upstream would refuse.
func antigravityAvailable(models []string, levels map[string][]string, spent map[string]time.Time, now time.Time) ([]string, map[string][]string) {
	available := make([]string, 0, len(models))
	kept := map[string]bool{}
	for _, id := range models {
		if reset, ok := spent[id]; ok && now.Before(reset) {
			continue
		}
		available = append(available, id)
		kept[id] = true
	}
	var declared map[string][]string
	for model, suffixes := range levels {
		for _, suffix := range suffixes {
			if kept[model+"-"+suffix] {
				if declared == nil {
					declared = map[string][]string{}
				}
				declared[model] = append(declared[model], suffix)
			}
		}
	}
	return available, declared
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

// antigravityQuotaGroups are the quota groups a Google account supplies from,
// by the prefix of their bucket ids, and the scope their windows are reported
// under: Gemini's unscoped, and the group Antigravity's Claude models share
// with its other partner models as "claude".
var antigravityQuotaGroups = map[string]string{"gemini-": "", "3p-": beewire.GoogleClaudeScope}

// parseAntigravityQuota reads the five-hour and weekly windows of the groups
// a Google account supplies from. A window nothing has used carries no reset
// time: the first request starts it, and it cannot reset later than one full
// window from now.
func parseAntigravityQuota(summary antigravityQuota, now time.Time) ([]beewire.QuotaWindow, string) {
	var windows []beewire.QuotaWindow
	for _, group := range summary.Groups {
		for _, bucket := range group.Buckets {
			seconds := map[string]int{"5h": 18000, "weekly": 604800}[bucket.Window]
			scope, supplied := "", false
			for prefix, groupScope := range antigravityQuotaGroups {
				if strings.HasPrefix(bucket.ID, prefix) {
					scope, supplied = groupScope, true
				}
			}
			if !supplied || seconds == 0 {
				continue
			}
			if slices.ContainsFunc(windows, func(w beewire.QuotaWindow) bool { return w.Seconds == seconds && w.Scope == scope }) {
				return nil, "the " + bucket.ID + " window is reported twice"
			}
			reset := now.Add(time.Duration(seconds) * time.Second)
			if bucket.Reset != "" {
				var err error
				if reset, err = time.Parse(time.RFC3339, bucket.Reset); err != nil || !reset.After(now) {
					return nil, bucket.ID + " has no future reset time"
				}
			}
			used := min(max(int(math.Round((1-bucket.Remaining)*100)), 0), 100)
			windows = append(windows, beewire.QuotaWindow{Scope: scope, Seconds: seconds, UsedPercent: &used, ResetAt: reset})
		}
	}
	if len(windows) == 0 {
		return nil, "no Gemini or Claude quota window"
	}
	sort.Slice(windows, func(i, j int) bool {
		if windows[i].Scope != windows[j].Scope {
			return windows[i].Scope < windows[j].Scope
		}
		return windows[i].Seconds < windows[j].Seconds
	})
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
