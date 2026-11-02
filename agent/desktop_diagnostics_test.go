package bee

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func waitDiagnostics(t *testing.T, d *DesktopDiagnostics, id string) DesktopDiagnosticReport {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		report, err := d.Snapshot(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if report.State != "running" {
			return report
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("diagnostic report remained running beyond test deadline")
	return DesktopDiagnosticReport{}
}
func diagnosticCheck(t *testing.T, r DesktopDiagnosticReport, id, platform string) DiagnosticCheck {
	t.Helper()
	for _, c := range r.Checks {
		if c.ID == id && (platform == "" && c.Platform == nil || c.Platform != nil && *c.Platform == platform) {
			return c
		}
	}
	t.Fatalf("missing check=%s platform=%s", id, platform)
	return DiagnosticCheck{}
}
func diagnosticFixture(t *testing.T, handler http.HandlerFunc, selected bool) (*DesktopDiagnostics, *DesktopDevice, *DesktopAccounts, *DesktopRuntime) {
	t.Helper()
	d := desktopRuntimeDeviceFixture(t, handler)
	a := NewDesktopAccounts(d)
	t.Cleanup(a.Close)
	if selected {
		desktopRuntimeSelectionFixture(t, d, a)
	}
	r := NewDesktopRuntime(context.Background(), d, a)
	t.Cleanup(r.Close)
	service := NewDesktopDiagnostics(context.Background(), d, a, r)
	t.Cleanup(service.Close)
	return service, d, a, r
}
func diagnosticReadyHandler(w http.ResponseWriter, q *http.Request) {
	if desktopSupplyServeIdentity(w, q) {
		return
	}
	switch {
	case strings.HasSuffix(q.URL.Path, "/account"):
		json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "ready", AccountFingerprint: strings.Repeat("a", 64), CredentialRevision: strings.Repeat("b", 64), Generation: 1})
	case strings.HasSuffix(q.URL.Path, "/capabilities"):
		json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
	default:
		json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Ready: false, Reasons: []string{beewire.ReasonManuallyPaused}})
	}
}

func TestDesktopDiagnosticsStartCapturesRuntimeContextBeforeDeviceChecks(t *testing.T) {
	service, device, _, runtime := diagnosticFixture(t, diagnosticReadyHandler, false)
	original, err := os.ReadFile(device.path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.WriteFile(device.path, original, 0600) })
	if err := saveState(device.path, localState{}); err != nil {
		t.Fatal(err)
	}
	runtime.mu.Lock()
	runtime.snapshot.NetworkRevision = 7
	runtime.snapshot.RunID = accountString(strings.Repeat("c", 32))
	runtime.mu.Unlock()
	first, err := service.Start(context.Background(), strings.Repeat("1", 32))
	if err != nil {
		t.Fatal(err)
	}
	for _, report := range []DesktopDiagnosticReport{first, waitDiagnostics(t, service, first.ID)} {
		if report.NetworkRevision != 7 || report.RunID == nil || *report.RunID != strings.Repeat("c", 32) {
			t.Fatalf("report lost start context: revision=%d run_present=%t", report.NetworkRevision, report.RunID != nil)
		}
	}
}

func TestDesktopDiagnosticsNetworkChangeKeepsOriginalReportContext(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	service, _, _, runtime := diagnosticFixture(t, func(w http.ResponseWriter, q *http.Request) {
		close(entered)
		<-release
		diagnosticReadyHandler(w, q)
	}, false)
	runtime.mu.Lock()
	runtime.snapshot.NetworkRevision = 2
	runtime.mu.Unlock()
	first, err := service.Start(context.Background(), strings.Repeat("1", 32))
	if err != nil {
		t.Fatal(err)
	}
	<-entered
	runtime.mu.Lock()
	runtime.snapshot.NetworkRevision = 3
	runtime.mu.Unlock()
	close(release)
	report := waitDiagnostics(t, service, first.ID)
	if first.NetworkRevision != 2 || report.NetworkRevision != 2 {
		t.Fatalf("report context relabelled: initial=%d final=%d; required=2", first.NetworkRevision, report.NetworkRevision)
	}
	if check := diagnosticCheck(t, report, "proxy", ""); check.Status == "pass" || check.Code != "network_changed" {
		t.Fatalf("changed network passed: status=%s code=%s", check.Status, check.Code)
	}
}

func TestDesktopDiagnosticsOnlyReadsSelectedSourcesAndDoesNotChangeGlobalLogger(t *testing.T) {
	var mu sync.Mutex
	var requests []string
	service, d, a, r := diagnosticFixture(t, func(w http.ResponseWriter, q *http.Request) {
		mu.Lock()
		requests = append(requests, q.Method+" "+q.URL.Path)
		mu.Unlock()
		diagnosticReadyHandler(w, q)
	}, true)
	// A shared acquired session remains usable while an owned runtime is active.
	_, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	r.mu.Lock()
	r.snapshot.Local = "running"
	r.snapshot.Connection = "connected"
	r.mu.Unlock()
	a.readKeyring = func(context.Context, string) ([]byte, error) {
		t.Error("unselected Claude source accessed")
		return nil, errors.New("forbidden")
	}
	a.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
		if q.Method != "GET" {
			t.Errorf("official write=%s", q.Method)
		}
		return claudeProfileResponse(401, `{"error":{"message":"Authorization=MARKER-TOKEN Cookie=MARKER-COOKIE /Users/private/marker"}}`), nil
	})
	path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
	before, _ := os.ReadFile(path)
	logger := slog.Default()
	first, err := service.Start(context.Background(), strings.Repeat("1", 32))
	if err != nil {
		t.Fatal(err)
	}
	report := waitDiagnostics(t, service, first.ID)
	if report.State != "completed" || report.FinishedAt == nil || report.Instance != strings.Repeat("1", 32) {
		t.Fatalf("unexpected report=%+v", report)
	}
	if diagnosticCheck(t, report, "source", "claude").Status != "skipped" {
		t.Fatal("unselected source was checked")
	}
	if diagnosticCheck(t, report, "runtime", "").Status != "pass" {
		t.Fatal("shared owned runtime not recognized")
	}
	if diagnosticCheck(t, report, "authorization", "openai").Status == "pass" {
		t.Fatal("HTTP 401 authorization passed")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("diagnostics changed persisted account selection")
	}
	if slog.Default() != logger {
		t.Fatal("desktop diagnostics replaced CLI global logger")
	}
	mu.Lock()
	defer mu.Unlock()
	for _, q := range requests {
		if !strings.HasPrefix(q, "GET ") || strings.Contains(q, "pairing") || strings.Contains(q, "agent") {
			t.Fatalf("business write/start observed: %s", q)
		}
	}
	raw, _ := json.Marshal(report)
	for _, secret := range []string{"MARKER-TOKEN", "MARKER-COOKIE", "/Users/", strings.Repeat("a", 64), "confirmation_id", "Bearer ", "bee_" + strings.Repeat("b", 43)} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("report leaked marker=%s", secret)
		}
	}
	report.Checks[0].Evidence["mutation"] = "outside"
	fresh, _ := service.Snapshot(context.Background(), first.ID)
	if fresh.Checks[0].Evidence["mutation"] != "" {
		t.Fatal("snapshot aliases retained report")
	}
}
func TestDesktopDiagnosticsHiveFailuresKeepSpecificSafeEvidence(t *testing.T) {
	for _, tc := range []struct {
		status     int
		code, want string
	}{{401, "invalid_device_credential", "http_rejected"}, {409, "device_replaced", "device_replaced"}, {429, "rate_limited", "rate_limited"}} {
		t.Run(tc.want, func(t *testing.T) {
			service, _, _, _ := diagnosticFixture(t, func(w http.ResponseWriter, q *http.Request) {
				w.WriteHeader(tc.status)
				json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": tc.code, "message": "token=MARKER-SECRET"}})
			}, false)
			first, err := service.Start(context.Background(), strings.Repeat("1", 32))
			if err != nil {
				t.Fatal(err)
			}
			report := waitDiagnostics(t, service, first.ID)
			c := diagnosticCheck(t, report, "hive", "")
			if c.Status != "fail" || c.Code != tc.want || c.Evidence["http_status"] != strconv.Itoa(tc.status) || c.Evidence["path"] != "/api/bee/identity" {
				t.Fatalf("failure evidence lost: %+v", c)
			}
		})
	}
}
func TestDesktopDiagnosticsCancelAndTimeoutPreserveCompletedChecks(t *testing.T) {
	for _, cancelled := range []bool{true, false} {
		t.Run(map[bool]string{true: "cancel", false: "timeout"}[cancelled], func(t *testing.T) {
			entered := make(chan struct{})
			service, _, _, _ := diagnosticFixture(t, func(w http.ResponseWriter, q *http.Request) { close(entered); <-q.Context().Done() }, false)
			if !cancelled {
				service.timeout = 30 * time.Millisecond
			}
			first, err := service.Start(context.Background(), strings.Repeat("1", 32))
			if err != nil {
				t.Fatal(err)
			}
			<-entered
			if _, err := service.Start(context.Background(), strings.Repeat("1", 32)); err == nil {
				t.Fatal("overlapping diagnostic run admitted")
			}
			if cancelled {
				if _, err := service.Cancel(context.Background(), first.ID); err != nil {
					t.Fatal(err)
				}
			}
			report := waitDiagnostics(t, service, first.ID)
			if diagnosticCheck(t, report, "device", "").Status != "pass" || diagnosticCheck(t, report, "hive", "").Status == "pass" {
				t.Fatalf("partial checks discarded or falsely passed: %+v", report)
			}
			if cancelled && report.State != "cancelled" {
				t.Fatalf("cancel state=%s", report.State)
			}
			for _, c := range report.Checks {
				if c.Code == "pending" {
					t.Fatal("terminal report has unfinished pending check")
				}
			}
		})
	}
}
func TestDesktopDiagnosticsClassifiesTransportFailuresWithoutRawErrors(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		err        error
	}{
		{"dns", "dns_failed", &net.DNSError{Err: "token=MARKER", Name: "personal.invalid", IsNotFound: true}},
		{"tls", "tls_failed", &tls.CertificateVerificationError{Err: errors.New("Cookie=MARKER")}},
		{"connection", "connection_failed", &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("/Users/secret/MARKER")}},
		{"unknown", "unknown_failure", errors.New("Authorization=MARKER")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service, _, _, _ := diagnosticFixture(t, diagnosticReadyHandler, false)
			service.hiveTransport = claudeTransport(func(*http.Request) (*http.Response, error) { return nil, tc.err })
			first, err := service.Start(context.Background(), strings.Repeat("1", 32))
			if err != nil {
				t.Fatal(err)
			}
			report := waitDiagnostics(t, service, first.ID)
			c := diagnosticCheck(t, report, "hive", "")
			if c.Status != "fail" || c.Code != tc.want {
				t.Fatalf("wrong classified evidence: %+v", c)
			}
			raw, _ := json.Marshal(report)
			if strings.Contains(string(raw), "MARKER") {
				t.Fatal("raw transport error leaked")
			}
		})
	}
}
func TestDesktopDiagnosticsRejectsUnknownReportsAndUntrustedInstance(t *testing.T) {
	service, _, _, _ := diagnosticFixture(t, diagnosticReadyHandler, false)
	if _, err := service.Snapshot(context.Background(), strings.Repeat("f", 48)); err == nil {
		t.Fatal("unknown report accepted")
	}
	if _, err := service.Cancel(context.Background(), "token=MARKER"); err == nil || strings.Contains(err.Error(), "MARKER") {
		t.Fatal("unknown report error missing or leaked input")
	}
	if _, err := service.Start(context.Background(), "/Users/MARKER"); err == nil || strings.Contains(err.Error(), "MARKER") {
		t.Fatal("untrusted instance accepted or leaked")
	}
}
func TestDesktopDiagnosticsUnknownAndInconsistentSupplyNeverPass(t *testing.T) {
	for _, supply := range []beewire.PlatformSupply{{Platform: "openai", Ready: false}, {Platform: "openai", Ready: false, Reasons: []string{"token=MARKER"}}, {Platform: "openai", Ready: true, Paused: true}} {
		checks := doctorSupplyChecks("openai", supply, "")
		if len(checks) == 0 || checks[0].Status == "pass" {
			t.Fatalf("unknown supply passed: %+v", checks)
		}
	}
}
func TestDesktopDiagnosticsRealTLSFailure(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(diagnosticReadyHandler))
	defer server.Close()
	service, d, _, _ := diagnosticFixture(t, diagnosticReadyHandler, false)
	state, err := readState(d.path)
	if err != nil {
		t.Fatal(err)
	}
	original := state
	defer saveState(d.path, original)
	state.Hive = server.URL
	if err := saveState(d.path, state); err != nil {
		t.Fatal(err)
	}
	first, err := service.Start(context.Background(), strings.Repeat("1", 32))
	if err != nil {
		t.Fatal(err)
	}
	report := waitDiagnostics(t, service, first.ID)
	if c := diagnosticCheck(t, report, "hive", ""); c.Code != "tls_failed" {
		t.Fatalf("real TLS failure misclassified: %+v", c)
	}
}

func TestDesktopDiagnosticsQuotaUsesWholePercentAndRequiresFreshReset(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		used  int
		reset time.Time
		want  string
	}{{99, now.Add(time.Hour), "pass"}, {100, now.Add(time.Hour), "fail"}, {101, now.Add(time.Hour), "fail"}, {0, now, "skipped"}} {
		reset := tc.reset.Format(time.RFC3339Nano)
		caps := DesktopAccountCapabilities{Status: "ready", ValidUntil: accountTime(now.Add(time.Minute)), Windows: []DesktopAccountWindow{{UsedPercent: &tc.used, ResetAt: &reset}}}
		status, _, _ := diagnosticQuotaResult(caps, now)
		if status != tc.want {
			t.Fatalf("used_percent=%d reset_future=%t status=%s want=%s", tc.used, tc.reset.After(now), status, tc.want)
		}
	}
	status, _, _ := diagnosticQuotaResult(DesktopAccountCapabilities{Status: "unknown"}, now)
	if status == "pass" {
		t.Fatal("unknown quota passed")
	}
}
func TestDesktopDiagnosticsHiveAccountSandwichPreventsMixedAccountPass(t *testing.T) {
	var selection desktopAccountSelection
	calls := 0
	service, d, a, _ := diagnosticFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		if strings.HasSuffix(q.URL.Path, "/account") {
			calls++
			fingerprint := selection.Fingerprint
			if calls > 1 {
				fingerprint = strings.Repeat("f", 64)
			}
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "ready", AccountFingerprint: fingerprint, CredentialRevision: selection.CredentialRevision, Generation: selection.Generation})
			return
		}
		if strings.HasSuffix(q.URL.Path, "/capabilities") {
			json.NewEncoder(w).Encode(beewire.Capabilities{Status: "ready", ObservedAt: time.Now(), MetadataObservedAt: time.Now(), Models: []string{"gpt-5.4"}, Windows: []beewire.QuotaWindow{}})
			return
		}
		json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Ready: true, Reasons: []string{}})
	}, true)
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	state, err := session.read()
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.selectionScope(session, state, func(scope *desktopAccountScope) error {
		selection = scope.Selections["openai"]
		selection.Generation = 1
		scope.Selections["openai"] = selection
		return nil
	})
	release()
	if err != nil {
		t.Fatal(err)
	}
	a.transport = claudeTransport(func(*http.Request) (*http.Response, error) { return claudeProfileResponse(401, `{}`), nil })
	first, err := service.Start(context.Background(), strings.Repeat("1", 32))
	if err != nil {
		t.Fatal(err)
	}
	report := waitDiagnostics(t, service, first.ID)
	if c := diagnosticCheck(t, report, "account", "openai"); c.Status != "fail" || c.Code != "account_changed" {
		t.Fatalf("mixed account observation not rejected: %+v", c)
	}
	if diagnosticCheck(t, report, "capabilities", "openai").Status == "pass" || diagnosticCheck(t, report, "supply", "openai").Status == "pass" {
		t.Fatal("dependent mixed account result passed")
	}
}
func TestDesktopDiagnosticsUnselectedSourceDoesNotReadDefaultsAndRetentionIsBounded(t *testing.T) {
	service, _, a, _ := diagnosticFixture(t, diagnosticReadyHandler, false)
	t.Setenv("CODEX_HOME", "/Users/MARKER-do-not-read")
	t.Setenv("CLAUDE_CONFIG_DIR", "/Users/MARKER-do-not-read")
	a.transport = claudeTransport(func(*http.Request) (*http.Response, error) {
		t.Error("unselected official source queried")
		return nil, errors.New("forbidden")
	})
	var first string
	for i := 0; i < 9; i++ {
		r, err := service.Start(context.Background(), strings.Repeat("1", 32))
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = r.ID
		}
		r = waitDiagnostics(t, service, r.ID)
		if diagnosticCheck(t, r, "source", "openai").Code != "source_not_selected" {
			t.Fatal("unselected OpenAI source read")
		}
	}
	if _, err := service.Snapshot(context.Background(), first); err == nil {
		t.Fatal("report retention exceeded eight reports")
	}
}

func TestDesktopDiagnosticsOfficialReadbackAndQuota(t *testing.T) {
	for _, scenario := range []string{"ready", "exhausted", "source_changed", "malformed"} {
		t.Run(scenario, func(t *testing.T) {
			service, d, a, _ := diagnosticFixture(t, diagnosticReadyHandler, true)
			state, err := readState(d.path)
			if err != nil {
				t.Fatal(err)
			}
			disk, err := readDesktopAccountState(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"))
			if err != nil {
				t.Fatal(err)
			}
			selection := disk.Scopes[desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)].Selections["openai"]
			original, _ := os.ReadFile(filepath.Join(*selection.Source.Directory, "auth.json"))
			a.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
				if q.Method != "GET" {
					t.Errorf("official write method=%s", q.Method)
				}
				if strings.Contains(q.URL.Path, "models") {
					return claudeProfileResponse(200, `{"models":[{"slug":"gpt-5.4"}]}`), nil
				}
				if scenario == "source_changed" {
					if err := os.WriteFile(filepath.Join(*selection.Source.Directory, "auth.json"), desktopCodexFixture(t, time.Now().Add(2*time.Hour)), 0600); err != nil {
						t.Fatal(err)
					}
				}
				if scenario == "malformed" {
					return claudeProfileResponse(200, `{"Authorization":"MARKER-TOKEN","input":"MARKER-INPUT","output":"MARKER-OUTPUT"}`), nil
				}
				used := 99
				if scenario == "exhausted" {
					used = 100
				}
				window := func(seconds, reset int) map[string]any {
					return map[string]any{"used_percent": used, "limit_window_seconds": seconds, "reset_after_seconds": reset, "reset_at": time.Now().Add(time.Duration(reset) * time.Second).Unix()}
				}
				raw, _ := json.Marshal(map[string]any{"plan_type": "plus", "rate_limit": map[string]any{"allowed": true, "limit_reached": false, "primary_window": window(18000, 1200), "secondary_window": window(604800, 3600)}})
				return claudeProfileResponse(200, string(raw)), nil
			})
			first, err := service.Start(context.Background(), strings.Repeat("1", 32))
			if err != nil {
				t.Fatal(err)
			}
			report := waitDiagnostics(t, service, first.ID)
			auth := diagnosticCheck(t, report, "authorization", "openai")
			quota := diagnosticCheck(t, report, "quota", "openai")
			switch scenario {
			case "ready":
				if auth.Status != "pass" || quota.Status != "pass" {
					t.Fatalf("read-only official ready evidence failed: auth=%+v quota=%+v", auth, quota)
				}
			case "exhausted":
				if auth.Status != "pass" || quota.Status != "fail" || quota.Code != "quota_exhausted" {
					t.Fatalf("whole-percent quota failure not recognized: %+v %+v", auth, quota)
				}
			case "source_changed":
				if auth.Status == "pass" || auth.Code != "source_changed" {
					t.Fatalf("changed source result retained: %+v", auth)
				}
			case "malformed":
				if auth.Status == "pass" || quota.Status == "pass" {
					t.Fatal("unknown official body passed")
				}
			}
			if scenario != "source_changed" {
				after, _ := os.ReadFile(filepath.Join(*selection.Source.Directory, "auth.json"))
				if string(after) != string(original) {
					t.Fatal("diagnostic refreshed or changed official authorization")
				}
			}
			raw, _ := json.Marshal(report)
			for _, marker := range []string{"MARKER-TOKEN", "MARKER-INPUT", "MARKER-OUTPUT"} {
				if strings.Contains(string(raw), marker) {
					t.Fatal("ordinary official error leaked sensitive body")
				}
			}
		})
	}
}

func TestDesktopDiagnosticsLocalReadFailureKeepsSafeCause(t *testing.T) {
	service, d, a, _ := diagnosticFixture(t, diagnosticReadyHandler, true)
	state, err := readState(d.path)
	if err != nil {
		t.Fatal(err)
	}
	disk, err := readDesktopAccountState(filepath.Join(filepath.Dir(d.path), "ai-accounts.json"))
	if err != nil {
		t.Fatal(err)
	}
	selection := disk.Scopes[desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)].Selections["openai"]
	if err := os.Remove(filepath.Join(*selection.Source.Directory, "auth.json")); err != nil {
		t.Fatal(err)
	}
	a.transport = claudeTransport(func(*http.Request) (*http.Response, error) {
		t.Error("unreadable source reached official endpoint")
		return nil, errors.New("forbidden")
	})
	first, err := service.Start(context.Background(), strings.Repeat("1", 32))
	if err != nil {
		t.Fatal(err)
	}
	report := waitDiagnostics(t, service, first.ID)
	c := diagnosticCheck(t, report, "source", "openai")
	if c.Status != "fail" || c.Code != "source_missing" || c.Evidence["not_found"] != "true" {
		t.Fatalf("source failure cause lost: %+v", c)
	}
	raw, _ := json.Marshal(report)
	if strings.Contains(string(raw), *selection.Source.Directory) {
		t.Fatal("local read error exposed private path")
	}
}

func TestDesktopDiagnosticsBindingChangeInvalidatesReportWithoutRelabelling(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	service, device, _, _ := diagnosticFixture(t, func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(entered) })
		<-release
		diagnosticReadyHandler(w, r)
	}, false)
	original, _ := os.ReadFile(device.path)
	t.Cleanup(func() { _ = os.WriteFile(device.path, original, 0600) })
	first, err := service.Start(context.Background(), strings.Repeat("1", 32))
	if err != nil {
		t.Fatal(err)
	}
	<-entered
	raw, _ := json.Marshal(first)
	var public map[string]any
	json.Unmarshal(raw, &public)
	if _, ok := public["binding_revision"]; !ok {
		close(release)
		t.Fatal("diagnostic report has no captured binding_revision")
	}
	session, done, err := device.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	state, err := session.read()
	if err != nil {
		t.Fatal(err)
	}
	state.Identity.ID = "replacement"
	err = session.save(state)
	done()
	if err != nil {
		t.Fatal(err)
	}
	close(release)
	if _, err = service.Snapshot(context.Background(), first.ID); err == nil {
		t.Fatal("old binding report remained usable after replacement")
	}
}

func TestDesktopDiagnosticsAbsentAndCorruptRecordsShareContextRevision(t *testing.T) {
	d := newDesktopTestDevice(t, filepath.Join(t.TempDir(), "device.json"))
	a := NewDesktopAccounts(d)
	defer a.Close()
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	diagnostics := NewDesktopDiagnostics(context.Background(), d, a, r)
	defer diagnostics.Close()
	for _, raw := range []string{"", `{"unexpected":true}`} {
		if raw != "" {
			if err := os.WriteFile(d.path, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
		}
		local, err := d.Context(context.Background())
		if err == nil || local.BindingRevision <= 0 {
			t.Fatalf("expected observed local failure: %+v %v", local, err)
		}
		report, err := diagnostics.Start(context.Background(), strings.Repeat("a", 32))
		if err != nil {
			t.Fatal(err)
		}
		if report.BindingRevision != local.BindingRevision {
			t.Fatalf("diagnostic binding revision=%d context=%d", report.BindingRevision, local.BindingRevision)
		}
		final := waitDiagnostics(t, diagnostics, report.ID)
		if final.BindingRevision != local.BindingRevision {
			t.Fatal("diagnostic lost observed revision")
		}
	}
}
