package bee

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

// officialAPIPlatform is what differs between the official Platform keys a
// Provider may contribute: where the key is checked, how it is presented and
// under which name Hive registers it.
type officialAPIPlatform struct {
	name, label, code string
	target, origin    string
	statusPath        string
	secret            func(key string) tee.Secret
	listing           func(req *http.Request, key string)
	// page is the address of one page of the key's model listing, cursor
	// naming the page after the first; read takes a page apart into the
	// model IDs on it and the cursor of the next, empty after the last.
	page     func(origin, cursor string) string
	read     func(body io.Reader) (ids []string, next string, ok bool)
	register func(r *beewire.CredentialRegistration, k *beewire.OfficialAPIKey)
}

var (
	openaiAPI = officialAPIPlatform{
		name: "openai_api", label: "OpenAI API", code: "BEE-CONFIG-OPENAI-API",
		target: "api.openai.com:443", origin: "https://api.openai.com", statusPath: "/api/bee/openai-api/status",
		secret: func(key string) tee.Secret { return tee.Secret{Header: "authorization", Scheme: "Bearer", Token: key} },
		listing: func(req *http.Request, key string) {
			req.Header.Set("Authorization", "Bearer "+key)
		},
		page:     func(origin, _ string) string { return origin + "/v1/models" },
		read:     readDataListing,
		register: func(r *beewire.CredentialRegistration, k *beewire.OfficialAPIKey) { r.OpenAIAPI = k },
	}
	claudeAPI = officialAPIPlatform{
		name: "claude_api", label: "Claude API", code: "BEE-CONFIG-CLAUDE-API",
		target: "api.anthropic.com:443", origin: "https://api.anthropic.com", statusPath: "/api/bee/claude-api/status",
		// The Claude API takes its key bare in x-api-key, not as a bearer token.
		secret: func(key string) tee.Secret { return tee.Secret{Header: "x-api-key", Token: key} },
		listing: func(req *http.Request, key string) {
			req.Header.Set("X-Api-Key", key)
			req.Header.Set("Anthropic-Version", "2023-06-01")
		},
		page: func(origin, cursor string) string {
			target := origin + "/v1/models?limit=1000"
			if cursor != "" {
				target += "&after_id=" + url.QueryEscape(cursor)
			}
			return target
		},
		read:     readDataListing,
		register: func(r *beewire.CredentialRegistration, k *beewire.OfficialAPIKey) { r.ClaudeAPI = k },
	}
	// geminiAPI is a Gemini API key made in Google AI Studio. Google takes it
	// bare in x-goog-api-key and lists models as "models/<id>".
	geminiAPI = officialAPIPlatform{
		name: "gemini_api", label: "Gemini API", code: "BEE-CONFIG-GEMINI-API",
		target: "generativelanguage.googleapis.com:443", origin: "https://generativelanguage.googleapis.com", statusPath: "/api/bee/gemini-api/status",
		secret: func(key string) tee.Secret { return tee.Secret{Header: "x-goog-api-key", Token: key} },
		listing: func(req *http.Request, key string) {
			req.Header.Set("X-Goog-Api-Key", key)
		},
		page: func(origin, cursor string) string {
			target := origin + "/v1beta/models?pageSize=1000"
			if cursor != "" {
				target += "&pageToken=" + url.QueryEscape(cursor)
			}
			return target
		},
		read:     readGeminiListing,
		register: func(r *beewire.CredentialRegistration, k *beewire.OfficialAPIKey) { r.GeminiAPI = k },
	}
)

// readDataListing reads OpenAI's and Anthropic's listing: models under data,
// and with Anthropic's paging, the last ID as the next page's cursor.
func readDataListing(body io.Reader) ([]string, string, bool) {
	var listed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		HasMore bool   `json:"has_more"`
		LastID  string `json:"last_id"`
	}
	if json.NewDecoder(body).Decode(&listed) != nil {
		return nil, "", false
	}
	ids := make([]string, 0, len(listed.Data))
	for _, m := range listed.Data {
		ids = append(ids, m.ID)
	}
	if !listed.HasMore {
		return ids, "", true
	}
	return ids, listed.LastID, true
}

// readGeminiListing reads Google's listing, which names each model
// "models/<id>" and pages with a token.
func readGeminiListing(body io.Reader) ([]string, string, bool) {
	var listed struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
		NextPageToken string `json:"nextPageToken"`
	}
	if json.NewDecoder(body).Decode(&listed) != nil {
		return nil, "", false
	}
	ids := make([]string, 0, len(listed.Models))
	for _, m := range listed.Models {
		ids = append(ids, strings.TrimPrefix(m.Name, "models/"))
	}
	return ids, listed.NextPageToken, true
}

// officialAPISource contributes one official Platform key (Hive ADR 0033,
// 0037, 0050).
// The key file is read again on every cycle, so replacing it needs no restart.
type officialAPISource struct {
	LocalURL                       string   `json:"local_url,omitempty"`
	KeyFile                        string   `json:"key_file"`
	Models                         []string `json:"models"`
	platform                       *officialAPIPlatform
	transport                      http.RoundTripper
	registeredLease, registeredKey string
	reportedAt                     time.Time
	lastState                      string
}

// openaiAPISource is the name the OpenAI source was first introduced under.
type openaiAPISource = officialAPISource

func (s *officialAPISource) spec() *officialAPIPlatform {
	if s.platform == nil {
		return &openaiAPI
	}
	return s.platform
}

func (s *officialAPISource) key() (string, error) {
	return readStaticKeyFile(s.KeyFile, s.spec().code+"-KEY")
}

func (s *officialAPISource) validate() error {
	code := s.spec().code
	if s.LocalURL != "" {
		u, err := url.Parse(s.LocalURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
			return fail(code, "local_url must be a loopback test endpoint")
		}
	}
	if len(s.Models) == 0 || !beewire.ValidModelIDs(s.Models) {
		return fail(code, "models must select 1 to 512 distinct model IDs")
	}
	_, err := s.key()
	return err
}

func (s *officialAPISource) message(out io.Writer, state, message string) {
	if s.lastState != state {
		notify(out, supplyStateLevel(state), "sync", message, "platform", s.spec().name, "state", state)
		s.lastState = state
	}
}

func (cfg *egressConfig) synchronizeOpenAIAPI(ctx context.Context, state localState, lease string, out io.Writer, force bool) error {
	return cfg.OpenAIAPI.synchronize(ctx, state, lease, out, force, cfg.InboxKeyID)
}

func (cfg *egressConfig) synchronizeClaudeAPI(ctx context.Context, state localState, lease string, out io.Writer, force bool) error {
	return cfg.ClaudeAPI.synchronize(ctx, state, lease, out, force, cfg.InboxKeyID)
}

func (cfg *egressConfig) synchronizeGeminiAPI(ctx context.Context, state localState, lease string, out io.Writer, force bool) error {
	return cfg.GeminiAPI.synchronize(ctx, state, lease, out, force, cfg.InboxKeyID)
}

func (s *officialAPISource) synchronize(ctx context.Context, state localState, lease string, out io.Writer, force bool, inboxKeyID string) error {
	p := s.spec()
	key, err := s.key()
	if err != nil {
		// Expire supply immediately when the local file is removed, rather than
		// waiting for the source lease to time out.
		if s.registeredKey != "" {
			_ = callState(ctx, httpClient(), state, p.statusPath, "POST", beewire.OfficialAPIStatus{Lease: lease, KeyFingerprint: s.registeredKey, Models: []string{}}, nil)
		}
		s.message(out, "source_unavailable", p.label+" key file unavailable; supply paused")
		return nil
	}
	print := fingerprint(key)
	// Re-seal periodically as well as on rotation, so TEE inbox rotation does
	// not leave a long-lived static key bound to an obsolete recipient.
	if !(force || s.registeredLease != lease || s.registeredKey != print || time.Since(s.reportedAt) >= 10*time.Second) {
		return nil
	}
	inbox, err := fetchInboxKey(ctx, state, inboxKeyID)
	if err != nil {
		return err
	}
	envelope, err := tee.EncryptCredential(inbox, beewire.ProviderID(state.Identity.ID), p.secret(key))
	if err != nil {
		return errInboxIdentity
	}
	registration := beewire.CredentialRegistration{Lease: lease, Envelope: envelope}
	p.register(&registration, &beewire.OfficialAPIKey{KeyFingerprint: print})
	if err = callState(ctx, httpClient(), state, "/api/bee/credentials", "POST", registration, nil); err != nil {
		return err
	}
	s.registeredLease, s.registeredKey = lease, print
	report := beewire.OfficialAPIStatus{Lease: lease, KeyFingerprint: print, Models: s.listModels(ctx, key)}
	report.Ready = report.Models != nil
	if report.Models == nil {
		report.Models = []string{}
	}
	if err = callState(ctx, httpClient(), state, p.statusPath, "POST", report, nil); err != nil {
		return err
	}
	s.reportedAt = time.Now()
	if report.Ready {
		s.message(out, "ready", p.label+" key synchronized")
	} else {
		s.message(out, "source_unavailable", p.label+" model access unavailable; supply paused")
	}
	return nil
}

// listModels returns the selected models the key's official listing shows,
// or nil when the listing cannot be read. The Claude and Gemini listings are
// paged; a listing may name an unpinned alias by its dated snapshot, which
// counts as the alias the Provider selected.
func (s *officialAPISource) listModels(ctx context.Context, key string) []string {
	p := s.spec()
	observe, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	origin := p.origin
	if s.LocalURL != "" {
		origin = s.LocalURL
	}
	client := &http.Client{Transport: s.transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	found := []string{}
	cursor := ""
	for page := 0; page < 10; page++ {
		req, _ := http.NewRequestWithContext(observe, http.MethodGet, p.page(origin, cursor), nil)
		p.listing(req, key)
		res, err := client.Do(req)
		if err != nil {
			return nil
		}
		var ids []string
		var next string
		ok := res.StatusCode == 200
		if ok {
			ids, next, ok = p.read(io.LimitReader(res.Body, 2<<20))
		}
		res.Body.Close()
		if !ok {
			return nil
		}
		for _, id := range ids {
			if selected := s.selected(id); selected != "" && !slices.Contains(found, selected) {
				found = append(found, selected)
			}
		}
		if next == "" || next == cursor {
			return found
		}
		cursor = next
	}
	return found
}

// selected maps a listed model to the Provider's selection: the same name, or
// a selected alias the listing shows as its dated snapshot.
func (s *officialAPISource) selected(listed string) string {
	if slices.Contains(s.Models, listed) {
		return listed
	}
	for _, model := range s.Models {
		if suffix, ok := strings.CutPrefix(listed, model+"-"); ok && datedSnapshot(suffix) {
			return model
		}
	}
	return ""
}

// datedSnapshot reports a snapshot suffix: 2025-08-07 (OpenAI) or 20251001
// (Anthropic).
func datedSnapshot(suffix string) bool {
	if _, err := time.Parse("2006-01-02", suffix); err == nil {
		return true
	}
	_, err := time.Parse("20060102", suffix)
	return len(suffix) == 8 && err == nil
}
