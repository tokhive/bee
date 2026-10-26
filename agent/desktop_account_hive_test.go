package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestDesktopAccountsHive(t *testing.T) {
	for _, scenario := range []string{"ready", "unbound", "identity_changed", "revoked", "fingerprint_changed", "generation_changed", "revision_changed", "unknown", "quota_exhausted", "rate_limited", "stale", "old_rate_limited", "pending"} {
		t.Run(scenario, func(t *testing.T) {
			reads := 0
			events := []string{}
			d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
				events = append(events, r.Method+" "+r.URL.Path)
				if r.Method != "GET" {
					t.Fatal("Hive write from account snapshot")
				}
				if r.URL.Path == "/api/bee/identity" {
					if scenario == "revoked" {
						w.WriteHeader(401)
						return
					}
					identity := desktopSupplyIdentity()
					if scenario == "identity_changed" {
						identity.OwnerID = "other-owner"
					}
					json.NewEncoder(w).Encode(identity)
					return
				}
				if strings.HasSuffix(r.URL.Path, "/account") {
					reads++
					account := beewire.PlatformAccount{Platform: "openai", Status: "ready", AccountFingerprint: strings.Repeat("a", 64), Generation: 1, CredentialRevision: strings.Repeat("b", 64), ConfirmationID: "confirmation-SECRET"}
					if scenario == "pending" {
						account.Status = "confirmation_required"
						account.PendingFingerprint = strings.Repeat("c", 64)
					}
					if reads == 2 {
						switch scenario {
						case "fingerprint_changed":
							account.AccountFingerprint = strings.Repeat("c", 64)
						case "generation_changed":
							account.Generation++
						case "revision_changed":
							account.CredentialRevision = strings.Repeat("d", 64)
						}
					}
					json.NewEncoder(w).Encode(account)
					return
				}
				if strings.HasSuffix(r.URL.Path, "/capabilities") {
					percent := 120
					observed := time.Now()
					status := "ready"
					if scenario == "stale" {
						observed = observed.Add(-7 * time.Minute)
					}
					if scenario == "old_rate_limited" {
						observed = observed.Add(-7 * time.Minute)
						status = "rate_limited"
					}
					if scenario == "unknown" || scenario == "quota_exhausted" || scenario == "rate_limited" {
						status = scenario
					}
					json.NewEncoder(w).Encode(beewire.Capabilities{Status: status, Sequence: 1, ObservedAt: observed, MetadataObservedAt: observed, Plan: "plus", Models: []string{"gpt-5.4"}, Windows: []beewire.QuotaWindow{{Seconds: 18000, UsedPercent: &percent, ResetAt: time.Now().Add(time.Hour)}}})
					return
				}
				t.Fatalf("unexpected path %s", r.URL.Path)
			})
			if scenario == "unbound" {
				d = nil
			}
			a := NewDesktopAccounts(d)
			s, err := a.Snapshot(context.Background(), "openai", true)
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "pending":
				public, _ := json.Marshal(s.Hive)
				var fields map[string]any
				json.Unmarshal(public, &fields)
				if fields["pending_fingerprint"] != strings.Repeat("c", 64) || fields["generation"] != float64(1) {
					t.Fatalf("missing safe pending facts: %s", public)
				}
			case "ready", "unknown", "quota_exhausted", "rate_limited", "stale", "old_rate_limited":
				if s.Hive.State != "ready" || s.Hive.Fingerprint == nil || reads != 2 {
					t.Fatalf("hive=%+v reads=%d", s.Hive, reads)
				}
				want := scenario
				if scenario == "old_rate_limited" {
					want = "rate_limited"
				}
				if scenario == "stale" {
					want = "stale"
				}
				if s.Capabilities[1].Status != want {
					t.Fatalf("status=%s want=%s", s.Capabilities[1].Status, want)
				}
				if s.Selection.State != "not_selected" {
					t.Fatal("Hive account became local selection")
				}
			case "unbound":
				if s.Hive.State != "unbound" || len(events) != 0 {
					t.Fatalf("unbound Hive queried: %v %+v", events, s.Hive)
				}
			default:
				if s.Hive.Error == nil || s.Hive.Fingerprint != nil || s.Capabilities[1].Status == "ready" {
					t.Fatalf("unconfirmed Hive account accepted: %+v", s)
				}
			}
			public, _ := json.Marshal(s)
			if strings.Contains(string(public), "SECRET") || strings.Contains(string(public), "test@example.test") {
				t.Fatal("private Hive fields exposed")
			}
		})
	}
}

func TestDesktopAccountsHiveScopedQuotaIsNotPlatformExhaustion(t *testing.T) {
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if desktopSupplyServeIdentity(w, r) {
			return
		}
		if strings.HasSuffix(r.URL.Path, "/account") {
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "claude", Status: "ready", AccountFingerprint: strings.Repeat("a", 64), CredentialRevision: strings.Repeat("b", 64), Generation: 1})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/capabilities") {
			free, full := 25, 100
			now := time.Now()
			json.NewEncoder(w).Encode(beewire.Capabilities{Status: "ready", ObservedAt: now, MetadataObservedAt: now, Plan: "pro", Models: []string{"claude-sonnet-4-6"}, Windows: []beewire.QuotaWindow{{Seconds: 18000, UsedPercent: &free, ResetAt: now.Add(time.Hour)}, {Seconds: 604800, UsedPercent: &free, ResetAt: now.Add(24 * time.Hour)}, {Scope: "opus", Seconds: 604800, UsedPercent: &full, ResetAt: now.Add(24 * time.Hour)}}})
			return
		}
		t.Fatal("unexpected Hive path")
	})
	s, err := NewDesktopAccounts(d).Snapshot(context.Background(), "claude", true)
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range s.Issues {
		if issue.Code == "quota_exhausted" {
			t.Fatal("scoped quota became platform exhaustion")
		}
	}
}
