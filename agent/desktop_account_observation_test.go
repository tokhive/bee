package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDesktopAccountsOfficial(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		for _, scenario := range []string{"ready", "source_changed", "token_changed", "expired", "no_scope", "429", "network", "null_quota", "120"} {
			t.Run(platform+"/"+scenario, func(t *testing.T) {
				dir := t.TempDir()
				name := "auth.json"
				if platform == "claude" {
					name = ".credentials.json"
				}
				expires := time.Now().Add(time.Hour)
				if scenario == "expired" {
					expires = time.Now()
				}
				raw := desktopCodexFixture(t, expires)
				if platform == "claude" {
					raw = claudeSample(expires)
					if scenario == "no_scope" {
						raw = []byte(strings.ReplaceAll(string(raw), "user:profile", "no:profile"))
					}
				}
				path := filepath.Join(dir, name)
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
				before, _ := os.Stat(path)
				calls := 0
				a := NewDesktopAccounts(nil)
				a.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
					calls++
					if r.Method != "GET" {
						t.Fatal("official write")
					}
					if scenario == "source_changed" || scenario == "token_changed" {
						next := []byte(`{}`)
						if scenario == "token_changed" {
							next = desktopCodexFixture(t, expires.Add(time.Minute))
							if platform == "claude" {
								next = []byte(strings.ReplaceAll(string(raw), "synthetic-claude-access", "synthetic-next-access"))
							}
						}
						if err := os.WriteFile(path, next, 0600); err != nil {
							t.Fatal(err)
						}
					}
					if scenario == "network" {
						return nil, &desktopSyntheticTransportError{}
					}
					if scenario == "429" {
						res := claudeProfileResponse(429, "synthetic-SECRET")
						res.Header.Set("Retry-After", "120")
						return res, nil
					}
					if r.URL.Path == "/api/oauth/profile" {
						return claudeProfileResponse(200, `{"account":{"uuid":"11111111-1111-1111-1111-111111111111","email":"synthetic@secret.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`), nil
					}
					if r.URL.Path == "/v1/models" {
						return claudeProfileResponse(200, claudeModelsFixture), nil
					}
					if r.URL.Path == "/api/oauth/usage" {
						usage := claudeQuotaFixture()
						if scenario == "120" {
							usage["five_hour"].(map[string]any)["utilization"] = 120
						}
						if scenario == "null_quota" {
							usage["five_hour"] = nil
						}
						b, _ := json.Marshal(usage)
						return claudeProfileResponse(200, string(b)), nil
					}
					if r.URL.Path == "/backend-api/codex/models" {
						return claudeProfileResponse(200, `{"models":[{"slug":"gpt-5.4"}]}`), nil
					}
					if r.URL.Path == "/backend-api/wham/usage" {
						used := "99"
						if scenario == "120" {
							used = "120"
						}
						if scenario == "null_quota" {
							used = "null"
						}
						body := map[string]any{"plan_type": "plus", "rate_limit": map[string]any{"allowed": true, "limit_reached": false, "primary_window": map[string]any{"used_percent": json.RawMessage(used), "limit_window_seconds": 18000, "reset_after_seconds": 1200, "reset_at": time.Now().Add(1200 * time.Second).Unix()}, "secondary_window": map[string]any{"used_percent": 20, "limit_window_seconds": 604800, "reset_after_seconds": 3600, "reset_at": time.Now().Add(time.Hour).Unix()}}}
						b, _ := json.Marshal(body)
						return claudeProfileResponse(200, string(b)), nil
					}
					t.Fatalf("unexpected official path=%s", r.URL.Path)
					return nil, nil
				})
				r := DesktopAccountDetectRequest{Platform: platform, Directory: &dir, Store: "file", Mode: "official"}
				s, err := a.Detect(context.Background(), r)
				if err != nil {
					t.Fatal(err)
				}
				if scenario == "ready" || scenario == "120" {
					if s.Capabilities[0].Status != "ready" {
						t.Fatalf("capabilities=%+v", s.Capabilities[0])
					}
					if s.Candidate.IdentityVerified != (platform == "claude") {
						t.Fatal("identity verification conflated with usage")
					}
					observed := *s.Capabilities[0].ObservedAt
					queries := calls
					cached, err := a.Detect(context.Background(), r)
					if err != nil || calls != queries || observed != *cached.Capabilities[0].ObservedAt {
						t.Fatalf("cache changed time or queried: calls=%d want=%d err=%v", calls, queries, err)
					}
					if scenario == "120" && *s.Capabilities[0].Windows[0].UsedPercent != 120 {
						t.Fatal("120% lost")
					}
				} else if scenario == "source_changed" || scenario == "token_changed" {
					if s.Candidate.Reference != nil || s.Capabilities[0].Status == "ready" {
						t.Fatal("source changed result accepted")
					}
				} else if scenario == "expired" || scenario == "no_scope" && platform == "claude" {
					if calls != 0 {
						t.Fatal("queried with unusable authorization")
					}
				}
				if scenario == "429" {
					count := calls
					again, e := a.Detect(context.Background(), r)
					if e != nil || calls != count || again.Capabilities[0].RetryAt == nil {
						t.Fatal("429 cooldown bypassed")
					}
				}
				if scenario != "source_changed" && scenario != "token_changed" {
					after, _ := os.ReadFile(path)
					info, _ := os.Stat(path)
					if string(after) != string(raw) || !info.ModTime().Equal(before.ModTime()) {
						t.Fatal("source written")
					}
				}
				public, _ := json.Marshal(s)
				for _, marker := range []string{"synthetic-SECRET", "synthetic@secret.test", "synthetic-claude-access", "transport-SECRET"} {
					if strings.Contains(string(public), marker) {
						t.Fatalf("official secret leaked: %s", marker)
					}
				}
			})
		}
	}
}

type desktopSyntheticTransportError struct{}

func (*desktopSyntheticTransportError) Error() string { return "transport-SECRET" }

func TestDesktopAccountsOfficialDefaultSourceChanges(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	raw := claudeSample(time.Now().Add(time.Hour))
	for _, dir := range []string{first, second} {
		if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("CLAUDE_CONFIG_DIR", first)
	t.Setenv("CLAUDE_SECURESTORAGE_CONFIG_DIR", first)
	a := NewDesktopAccounts(nil)
	a.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		t.Setenv("CLAUDE_CONFIG_DIR", second)
		t.Setenv("CLAUDE_SECURESTORAGE_CONFIG_DIR", second)
		return claudeProfileResponse(403, "synthetic-SECRET"), nil
	})
	s, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "claude", Store: "file", Mode: "official"})
	if err != nil || s.Candidate.State != "source_changed" || s.Candidate.Reference != nil {
		t.Fatalf("default namespace change accepted: %+v %v", s.Candidate, err)
	}
}

func TestDesktopAccountsOfficialCacheBoundaries(t *testing.T) {
	now := time.Now()
	until := now.Add(6 * time.Minute)
	reset := now.Add(time.Hour)
	o := &desktopOfficialObservation{at: now, metadataAt: now, capabilities: DesktopAccountCapabilities{Status: "ready", ObservedAt: accountTime(now), ValidUntil: accountTime(until), Windows: []DesktopAccountWindow{{ResetAt: accountTime(reset)}}}}
	if !o.reusable(now.Add(5*time.Minute-time.Nanosecond)) || o.reusable(now.Add(5*time.Minute)) {
		t.Fatal("5-minute boundary")
	}
	o.metadataAt = now.Add(-5 * time.Hour)
	if o.reusable(now) {
		t.Fatal("expired metadata reused")
	}
	o.metadataAt = now
	o.capabilities.Windows[0].ResetAt = accountTime(now)
	if o.reusable(now) {
		t.Fatal("reset window reused")
	}
	c := o.capabilities
	expireOfficialCapabilities(&c, until)
	if c.Status != "stale" {
		t.Fatal("6-minute boundary")
	}
}

func TestDesktopAccountsOfficialReadbackFailureIsUnconfirmed(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), claudeSample(time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := NewDesktopAccounts(nil)
	a.transport = claudeTransport(func(*http.Request) (*http.Response, error) {
		cancel()
		return claudeProfileResponse(503, "synthetic-SECRET"), nil
	})
	s, err := a.Detect(ctx, DesktopAccountDetectRequest{Platform: "claude", Directory: &dir, Store: "file", Mode: "official"})
	if err != nil || s.Candidate.State != "unconfirmed" || s.Candidate.Error == nil || s.Candidate.Error.Check != "source_readback" {
		t.Fatalf("failed readback reported as proven source change: %+v %v", s.Candidate, err)
	}
}

func TestDesktopAccountsOfficialRetainsValidQuotaOnProfileFailure(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), claudeSample(time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	a := NewDesktopAccounts(nil)
	r := DesktopAccountDetectRequest{Platform: "claude", Directory: &dir, Store: "file", Mode: "official"}
	read, failure := a.readAccountSource(context.Background(), r)
	if failure != nil {
		t.Fatal(failure)
	}
	defer read.clear()
	now := time.Now()
	observed := now.Add(-5*time.Minute - 10*time.Second)
	used := 42
	fp := strings.Repeat("a", 64)
	p := a.platforms["claude"]
	p.official = &desktopOfficialObservation{key: desktopObservationKey(read), at: observed, metadataAt: observed, fingerprint: &fp, identityVerified: true, capabilities: DesktopAccountCapabilities{Origin: "official", Status: "ready", ObservedAt: accountTime(observed), ValidUntil: accountTime(observed.Add(6 * time.Minute)), MetadataObservedAt: accountTime(observed), Windows: []DesktopAccountWindow{{Seconds: 18000, UsedPercent: &used, ResetAt: accountTime(now.Add(time.Hour))}}, Models: []DesktopAccountModel{}}}
	a.transport = claudeTransport(func(*http.Request) (*http.Response, error) {
		return claudeProfileResponse(503, "synthetic-SECRET"), nil
	})
	s, err := a.Detect(context.Background(), r)
	if err != nil || len(s.Capabilities[0].Windows) != 1 || s.Capabilities[0].ObservedAt == nil || *s.Capabilities[0].ObservedAt != *accountTime(observed) || s.Capabilities[0].Error == nil || !p.official.metadataAt.Equal(observed) {
		t.Fatalf("valid independent quota erased: %+v %v", s.Capabilities[0], err)
	}
}

func TestDesktopAccountsOfficialProfileSchemaEvidence(t *testing.T) {
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	_, err := queryClaudeProfile(context.Background(), credential, claudeTransport(func(*http.Request) (*http.Response, error) {
		return claudeProfileResponse(200, `{"account":{"uuid":[],"email":"private@secret.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`), nil
	}))
	if err == nil || !strings.Contains(err.Error(), "account.uuid") || !strings.Contains(err.Error(), "array") || strings.Contains(err.Error(), "private@secret.test") {
		t.Fatalf("schema error lacks safe evidence: %v", err)
	}
}
