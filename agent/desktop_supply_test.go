package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func desktopSupplyIdentity() beewire.Identity {
	return beewire.Identity{ID: "device-1", OwnerID: "owner-1", Name: "My Mac", OwnerEmail: "test@example.test"}
}

// Every fixture uses a separate private configuration and checks its exact bytes,
// including whitespace. No test contacts the user's configured Hive.
func desktopSupplyFixture(t *testing.T, handler http.HandlerFunc, mutate ...func(*localState)) *DesktopDevice {
	t.Helper()
	credential := "bee_" + strings.Repeat("b", 43)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+credential || r.Header.Get("X-Hive-Request") != "1" || r.Header.Get("Content-Type") != "application/json" || r.Header.Get("User-Agent") == "" {
			t.Error("request omitted existing authenticated Hive headers")
		}
		if strings.HasPrefix(r.URL.Path, "/api/bee/platforms/") {
			if r.URL.RawQuery != "reason_detail=1" {
				t.Errorf("desktop supply must opt in to details: method=%s query=%q", r.Method, r.URL.RawQuery)
			}
		} else if r.URL.RawQuery != "" {
			t.Error("unexpected query on identity request")
		}
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	identity := desktopSupplyIdentity()
	state := localState{Hive: server.URL, Name: "My Mac", Credential: credential, Identity: &identity}
	for _, change := range mutate {
		change(&state)
	}
	path := filepath.Join(t.TempDir(), "desktop.json")
	if err := saveState(path, state); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	original = append(original, '\n', ' ', '\n')
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(original, after) {
			t.Errorf("supply operation mutated configuration bytes: read_error=%v", err)
		}
	})
	return newDesktopTestDevice(t, path)
}

func desktopSupplyServeIdentity(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == "GET" && r.URL.Path == "/api/bee/identity" {
		json.NewEncoder(w).Encode(desktopSupplyIdentity())
		return true
	}
	return false
}

func TestDesktopSupplyPlatformIsolationExplicitFalseAndRestart(t *testing.T) {
	var mu sync.Mutex
	paused := map[string]bool{"openai": false, "claude": false}
	events := []string{}
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		events = append(events, r.Method+" "+r.URL.Path)
		if desktopSupplyServeIdentity(w, r) {
			return
		}
		platform := strings.TrimPrefix(r.URL.Path, "/api/bee/platforms/")
		if _, ok := paused[platform]; !ok {
			t.Error("unexpected supply URL")
			w.WriteHeader(500)
			return
		}
		if r.Method == "PUT" {
			body, _ := io.ReadAll(r.Body)
			if string(body) != `{"paused":true}` && string(body) != `{"paused":false}` {
				t.Errorf("PUT must contain exactly explicit paused boolean: %s", body)
			}
			var input struct {
				Paused bool `json:"paused"`
			}
			json.Unmarshal(body, &input)
			paused[platform] = input.Paused
		} else if r.Method != "GET" {
			t.Error("unexpected HTTP method")
		}
		reasons := []string{"offline", "not_configured"}
		if paused[platform] {
			reasons = append(reasons, "manually_paused")
		}
		json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: platform, Paused: paused[platform], Reasons: reasons})
	})
	before := time.Now().UTC().Truncate(time.Second)
	first, err := d.SupplyStatus(context.Background(), "openai")
	if err != nil || first.Paused || first.Ready || !reflect.DeepEqual(first.Reasons, []string{"offline", "not_configured"}) {
		t.Fatalf("status: %+v %v", first, err)
	}
	when, err := time.Parse(time.RFC3339, first.CheckedAt)
	if err != nil || !strings.HasSuffix(first.CheckedAt, "Z") || when.Before(before) || when.After(time.Now().UTC()) {
		t.Fatalf("UTC checked_at invalid: %q %v", first.CheckedAt, err)
	}
	state, _ := readState(d.path)
	if first.Hive != state.Hive || first.DeviceID != "device-1" || first.Platform != "openai" {
		t.Fatalf("result association wrong: %+v", first)
	}
	public, _ := json.Marshal(first)
	var fields map[string]any
	json.Unmarshal(public, &fields)
	if len(fields) != 7 || fields["reasons"] == nil || strings.Contains(string(public), state.Credential) {
		t.Fatalf("public schema invalid: %s", public)
	}
	result, err := d.SetPaused(context.Background(), "openai", true)
	if err != nil || !result.Paused || result.Ready {
		t.Fatalf("pause: %+v %v", result, err)
	}
	other, err := d.SupplyStatus(context.Background(), "claude")
	if err != nil || other.Paused {
		t.Fatalf("pause crossed platform: %+v %v", other, err)
	}
	closeDesktopTestDevice(t, d)
	restarted := newDesktopTestDevice(t, d.path)
	result, err = restarted.SupplyStatus(context.Background(), "openai")
	if err != nil || !result.Paused {
		t.Fatalf("restart must read persisted server state: %+v %v", result, err)
	}
	result, err = restarted.SetPaused(context.Background(), "openai", false)
	if err != nil || result.Paused || result.Ready || !reflect.DeepEqual(result.Reasons, []string{"offline", "not_configured"}) {
		t.Fatalf("resume must preserve other reasons: %+v %v", result, err)
	}
	mu.Lock()
	defer mu.Unlock()
	want := []string{"GET /api/bee/identity", "GET /api/bee/platforms/openai", "GET /api/bee/identity", "PUT /api/bee/platforms/openai", "GET /api/bee/platforms/openai", "GET /api/bee/identity", "GET /api/bee/platforms/claude", "GET /api/bee/identity", "GET /api/bee/platforms/openai", "GET /api/bee/identity", "PUT /api/bee/platforms/openai", "GET /api/bee/platforms/openai"}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("unexpected requests: %v", events)
	}
}

func TestDesktopSupplyRejectsUntrustedIdentityBeforeAnySupplyRequest(t *testing.T) {
	for _, check := range []string{"revoked", "device_changed", "owner_changed", "invalid_fields", "credential_in_identity", "pairing_token_in_identity"} {
		t.Run(check, func(t *testing.T) {
			var calls atomic.Int32
			d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/bee/identity" {
					calls.Add(1)
					w.WriteHeader(500)
					return
				}
				identity := desktopSupplyIdentity()
				switch check {
				case "revoked":
					w.WriteHeader(401)
					w.Write([]byte(`{"error":{"code":"device_replaced","message":"maintenance; token=secret-marker"}}`))
					return
				case "device_changed":
					identity.ID = "other-device"
				case "owner_changed":
					identity.OwnerID = "other-owner"
				case "invalid_fields":
					identity.Name = ""
				case "credential_in_identity":
					identity.Name = "bee_" + strings.Repeat("b", 43)
				case "pairing_token_in_identity":
					identity.Name = "beep_" + strings.Repeat("c", 43)
				}
				json.NewEncoder(w).Encode(identity)
			}, func(state *localState) {
				if check == "pairing_token_in_identity" {
					state.Pairing = &beewire.Pairing{PairingToken: "beep_" + strings.Repeat("c", 43)}
				}
			})
			for _, write := range []bool{false, true} {
				var err error
				if write {
					_, err = d.SetPaused(context.Background(), "openai", true)
				} else {
					_, err = d.SupplyStatus(context.Background(), "openai")
				}
				if err == nil || strings.Contains(err.Error(), "secret-marker") || strings.Contains(err.Error(), "bee_") || strings.Contains(err.Error(), "beep_") {
					t.Fatalf("identity failure missing or leaked: %v", err)
				}
				if check == "revoked" && !strings.Contains(err.Error(), "401") {
					t.Fatalf("HTTP evidence omitted: %v", err)
				}
			}
			if calls.Load() != 0 {
				t.Fatal("untrusted identity reached supply/pairing endpoint")
			}
		})
	}
}

func TestDesktopSupplyRequiresBoundCanonicalProtectedConfiguration(t *testing.T) {
	cases := map[string]func(*localState){
		"unbound":            func(s *localState) { *s = localState{} },
		"pending":            func(s *localState) { s.Identity = nil },
		"bad_credential":     func(s *localState) { s.Credential = "secret-marker" },
		"unsafe_hive":        func(s *localState) { s.Hive = "http://remote.example" },
		"noncanonical_hive":  func(s *localState) { s.Hive += "/" },
		"bad_saved_identity": func(s *localState) { s.Identity.ID = "" },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) }, change)
			if _, err := d.SetPaused(context.Background(), "openai", true); err == nil || strings.Contains(err.Error(), "secret-marker") {
				t.Fatalf("unsafe config accepted or leaked: %v", err)
			}
			if calls.Load() != 0 {
				t.Fatal("unsafe configuration sent a request")
			}
		})
	}
}

func TestDesktopSupplyRejectsPlatformBeforeNetwork(t *testing.T) {
	var calls atomic.Int32
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) })
	for _, platform := range []string{"", "OpenAI", "anthropic", "openai/claude", "openai?secret=secret-marker"} {
		if _, err := d.SupplyStatus(context.Background(), platform); err == nil || strings.Contains(err.Error(), "secret-marker") {
			t.Fatalf("invalid platform accepted/leaked: %v", err)
		}
		if _, err := d.SetPaused(context.Background(), platform, true); err == nil {
			t.Fatal("invalid write platform accepted")
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid platform reached network")
	}
}

func TestDesktopSupplyTypeErrorsIncludeSafeActualType(t *testing.T) {
	for _, tc := range []struct {
		field, value, actual string
	}{
		{"platform", `50000003`, "number"},
		{"platform", `true`, "boolean"},
		{"paused", `"secret-marker"`, "string"},
		{"paused", `50000003`, "number"},
		{"ready", `[]`, "array"},
		{"reasons", `{}`, "object"},
		{"reasons", `[50000003]`, "number"},
	} {
		t.Run(tc.field+"_"+tc.actual, func(t *testing.T) {
			fields := map[string]json.RawMessage{"platform": json.RawMessage(`"openai"`), "paused": json.RawMessage(`false`), "ready": json.RawMessage(`true`), "reasons": json.RawMessage(`[]`)}
			fields[tc.field] = json.RawMessage(tc.value)
			payload, err := json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			_, err = decodeDesktopSupply(payload, "openai")
			if err == nil || !strings.Contains(err.Error(), "field="+tc.field) || !strings.Contains(err.Error(), "actual_type="+tc.actual) || !strings.Contains(err.Error(), "byte=") {
				t.Fatalf("missing safe type evidence: %v", err)
			}
			if strings.Contains(err.Error(), "secret-marker") || strings.Contains(err.Error(), "50000003") {
				t.Fatalf("type error leaked raw value: %v", err)
			}
		})
	}
}

func TestDesktopSupplyRejectsResponseSchemaAndInvariantViolations(t *testing.T) {
	cases := map[string]string{
		"missing_platform":           `{"paused":false,"ready":true,"reasons":[]}`,
		"missing_paused":             `{"platform":"openai","ready":true,"reasons":[]}`,
		"missing_ready":              `{"platform":"openai","paused":false,"reasons":[]}`,
		"missing_reasons":            `{"platform":"openai","paused":false,"ready":true}`,
		"null_platform":              `{"platform":null,"paused":false,"ready":true,"reasons":[]}`,
		"null_paused":                `{"platform":"openai","paused":null,"ready":true,"reasons":[]}`,
		"null_ready":                 `{"platform":"openai","paused":false,"ready":null,"reasons":[]}`,
		"null_reasons":               `{"platform":"openai","paused":false,"ready":true,"reasons":null}`,
		"platform_type":              `{"platform":4,"paused":false,"ready":true,"reasons":[]}`,
		"paused_type":                `{"platform":"openai","paused":"false","ready":true,"reasons":[]}`,
		"ready_type":                 `{"platform":"openai","paused":false,"ready":0,"reasons":[]}`,
		"reasons_type":               `{"platform":"openai","paused":false,"ready":true,"reasons":{}}`,
		"reason_type":                `{"platform":"openai","paused":false,"ready":false,"reasons":[1]}`,
		"reason_null":                `{"platform":"openai","paused":false,"ready":false,"reasons":[null]}`,
		"wrong_platform":             `{"platform":"claude","paused":false,"ready":true,"reasons":[]}`,
		"unknown_field":              `{"platform":"openai","paused":false,"ready":true,"reasons":[],"secret-marker":"secret-marker"}`,
		"unknown_reason":             `{"platform":"openai","paused":false,"ready":false,"reasons":["secret-marker"]}`,
		"duplicate_reason":           `{"platform":"openai","paused":false,"ready":false,"reasons":["offline","offline"]}`,
		"ready_with_reasons":         `{"platform":"openai","paused":false,"ready":true,"reasons":["offline"]}`,
		"not_ready_without_reason":   `{"platform":"openai","paused":false,"ready":false,"reasons":[]}`,
		"paused_without_reason":      `{"platform":"openai","paused":true,"ready":false,"reasons":["offline"]}`,
		"pause_reason_without_pause": `{"platform":"openai","paused":false,"ready":false,"reasons":["manually_paused"]}`,
		"invalid_json":               `{"secret-marker":`,
		"trailing_json":              `{"platform":"openai","paused":false,"ready":true,"reasons":[]} {"secret-marker":1}`,
		"non_object":                 `[]`,
		"null_object":                `null`,
		"oversized":                  strings.Repeat(" ", 65537),
	}
	for _, field := range []string{"platform", "paused", "ready", "reasons"} {
		value := map[string]string{"platform": `"openai"`, "paused": `false`, "ready": `true`, "reasons": `[]`}[field]
		cases["duplicate_"+field] = `{"platform":"openai","paused":false,"ready":true,"reasons":[],"` + field + `":` + value + `}`
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if desktopSupplyServeIdentity(w, r) {
					return
				}
				w.Write([]byte(payload))
			})
			for _, write := range []bool{false, true} {
				var err error
				if write {
					_, err = d.SetPaused(context.Background(), "openai", true)
				} else {
					_, err = d.SupplyStatus(context.Background(), "openai")
				}
				if err == nil || strings.Contains(err.Error(), "secret-marker") {
					t.Fatalf("bad response accepted or payload leaked: %v", err)
				}
				if !strings.Contains(err.Error(), "HTTP 200") {
					t.Fatalf("missing response evidence: %v", err)
				}
			}
		})
	}
}

func TestDesktopSupplyAcceptsKnownReasonsAndEmptyReadyReasons(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		for _, reason := range append([]string{""}, beewire.DetailedSupplyReasons()...) {
			if (platform == "openai" && strings.HasPrefix(reason, "claude_")) || (platform == "claude" && strings.HasPrefix(reason, "codex_")) {
				continue
			}
			t.Run(platform+"/"+reason, func(t *testing.T) {
				d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
					if desktopSupplyServeIdentity(w, r) {
						return
					}
					reasons := []string{}
					if reason != "" {
						reasons = append(reasons, reason)
					}
					json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: platform, Paused: reason == "manually_paused", Ready: reason == "", Reasons: reasons})
				})
				result, err := d.SupplyStatus(context.Background(), platform)
				if err != nil || result.Reasons == nil || result.Ready != (reason == "") {
					t.Fatalf("known response rejected: %+v %v", result, err)
				}
			})
		}
	}
}

func TestDesktopSupplyRejectsReasonsFromOtherPlatform(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		t.Run(platform, func(t *testing.T) {
			other := "claude"
			if platform == "claude" {
				other = "openai"
			}
			d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if desktopSupplyServeIdentity(w, r) {
					return
				}
				json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: platform, Reasons: []string{beewire.AccountReason(other, "authorization_rejected")}})
			})
			if _, err := d.SupplyStatus(context.Background(), platform); err == nil {
				t.Fatal("accepted account reason belonging to the other platform")
			}
		})
	}
}

func TestDesktopSupplyUnconfirmedWritesNeverReplay(t *testing.T) {
	for _, failure := range []string{"lost_put_response", "put_http_error", "put_wrong_target", "get_http_error", "get_lost_response", "get_opposite", "get_invalid_schema"} {
		t.Run(failure, func(t *testing.T) {
			var puts, gets atomic.Int32
			d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if desktopSupplyServeIdentity(w, r) {
					return
				}
				if r.Method == "PUT" {
					puts.Add(1)
					switch failure {
					case "lost_put_response":
						connection, _, err := w.(http.Hijacker).Hijack()
						if err != nil {
							t.Error(err)
							return
						}
						connection.Close()
						return
					case "put_http_error":
						w.WriteHeader(503)
						w.Write([]byte(`{"error":{"code":"unavailable","message":"maintenance; token=secret-marker"}}`))
						return
					case "put_wrong_target":
						w.Write([]byte(`{"platform":"openai","paused":false,"ready":true,"reasons":[]}`))
						return
					}
				} else {
					gets.Add(1)
					switch failure {
					case "get_http_error":
						w.WriteHeader(503)
						return
					case "get_lost_response":
						// Start the response before truncating it. A connection closed
						// before any headers is retried transparently for GET by Go.
						w.Header().Set("Content-Length", "1000")
						w.WriteHeader(http.StatusOK)
						w.Write([]byte(`{`))
						w.(http.Flusher).Flush()
						connection, _, err := w.(http.Hijacker).Hijack()
						if err != nil {
							t.Error(err)
							return
						}
						connection.Close()
						return
					case "get_opposite":
						w.Write([]byte(`{"platform":"openai","paused":false,"ready":true,"reasons":[]}`))
						return
					case "get_invalid_schema":
						w.Write([]byte(`{"secret-marker":1}`))
						return
					}
				}
				w.Write([]byte(`{"platform":"openai","paused":true,"ready":false,"reasons":["manually_paused"]}`))
			})
			if _, err := d.SetPaused(context.Background(), "openai", true); err == nil || !strings.Contains(err.Error(), "unconfirmed") || strings.Contains(err.Error(), "secret-marker") {
				t.Fatalf("uncertain write not identified: %v", err)
			}
			if puts.Load() != 1 {
				t.Fatalf("PUT replayed: count=%d", puts.Load())
			}
			wantGets := int32(1)
			if strings.HasPrefix(failure, "put_") || failure == "lost_put_response" {
				wantGets = 0
			}
			if gets.Load() != wantGets {
				t.Fatalf("unexpected recovery/readback GETs: %d", gets.Load())
			}
			// Manual recheck and service restart are read-only, never replaying intent.
			closeDesktopTestDevice(t, d)
			_, _ = (newDesktopTestDevice(t, d.path)).SupplyStatus(context.Background(), "openai")
			if puts.Load() != 1 {
				t.Fatal("manual recheck replayed write")
			}
		})
	}
}

func TestDesktopSupplyLockAndCallerDeadlineBlockWrites(t *testing.T) {
	var calls atomic.Int32
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); <-r.Context().Done() })
	unlock, err := lockState(d.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.SetPaused(context.Background(), "openai", true); err == nil || !strings.Contains(err.Error(), "lock") {
		t.Fatalf("configuration lock not honored: %v", err)
	}
	unlock()
	if calls.Load() != 0 {
		t.Fatal("request escaped held configuration lock")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err = d.SetPaused(ctx, "openai", true); err == nil {
		t.Fatal("expired identity check allowed write")
	}
	if time.Since(start) > time.Second || calls.Load() != 1 {
		t.Fatal("caller deadline was ignored or write escaped failed identity check")
	}
}

func TestDesktopSupplyDetailedReasonsPreserveStrictContract(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		for _, reason := range []string{"account_not_registered", "market_not_open", "supply_not_enabled", "supply_device_restricted", "account_not_admitted"} {
			t.Run(platform+"/"+reason, func(t *testing.T) {
				payload, _ := json.Marshal(beewire.PlatformSupply{Platform: platform, Reasons: []string{reason}})
				if _, err := decodeDesktopSupply(payload, platform); err != nil {
					t.Fatalf("defined detailed reason rejected: %v", err)
				}
				for name, supply := range map[string]beewire.PlatformSupply{
					"duplicate":                  {Platform: platform, Reasons: []string{reason, reason}},
					"ready_with_blocker":         {Platform: platform, Ready: true, Reasons: []string{reason}},
					"paused_without_reason":      {Platform: platform, Paused: true, Reasons: []string{reason}},
					"pause_reason_without_pause": {Platform: platform, Reasons: []string{reason, "manually_paused"}},
					"cross_platform":             {Platform: platform, Reasons: []string{reason, beewire.AccountReason(map[string]string{"openai": "claude", "claude": "openai"}[platform], "source_unavailable")}},
					"unknown":                    {Platform: platform, Reasons: []string{reason, "unrecognized_reason"}},
				} {
					payload, _ := json.Marshal(supply)
					if _, err := decodeDesktopSupply(payload, platform); err == nil {
						t.Errorf("invalid detailed supply accepted: case=%s", name)
					}
				}
			})
		}
	}
}
