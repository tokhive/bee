package bee

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"sync/atomic"
	"testing"
	"time"

	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
	"github.com/tokhive/bee/beewire"
)

type claudeRefreshAcceptanceTransport struct {
	base                        http.RoundTripper
	refreshes, profiles, status atomic.Int32
	onRefresh                   func()
}

func (g *claudeRefreshAcceptanceTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	refresh := r.Method == "POST" && r.URL.String() == "https://platform.claude.com/v1/oauth/token"
	profile := r.Method == "GET" && r.URL.String() == "https://api.anthropic.com/api/oauth/profile"
	if !refresh && !profile || refresh && g.refreshes.Add(1) != 1 || profile && g.profiles.Add(1) > 2 {
		return nil, errors.New("Claude acceptance endpoint or request budget rejected")
	}
	if refresh && g.onRefresh != nil {
		g.onRefresh()
	}
	response, err := g.base.RoundTrip(r)
	if refresh && response != nil {
		g.status.Store(int32(response.StatusCode))
	}
	return response, err
}

func TestClaudeRefreshAcceptanceBudget(t *testing.T) {
	calls := 0
	guard := &claudeRefreshAcceptanceTransport{base: claudeTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return claudeProfileResponse(200, "{}"), nil
	})}
	for _, tc := range []struct {
		method, url string
		allowed     bool
	}{
		{"POST", "https://other.example/v1/oauth/token", false},
		{"GET", "https://api.anthropic.com/api/oauth/profile", true},
		{"POST", "https://platform.claude.com/v1/oauth/token", true},
		{"POST", "https://platform.claude.com/v1/oauth/token", false},
		{"GET", "https://api.anthropic.com/api/oauth/profile", true},
		{"GET", "https://api.anthropic.com/api/oauth/profile", false},
		{"POST", "https://api.anthropic.com/v1/messages", false},
	} {
		req, _ := http.NewRequest(tc.method, tc.url, nil)
		res, err := guard.RoundTrip(req)
		if res != nil {
			res.Body.Close()
		}
		if (err == nil) != tc.allowed {
			t.Fatal("acceptance request budget mismatch")
		}
	}
	if calls != 3 {
		t.Fatal("rejected request reached upstream")
	}
}

func TestClaudeRefreshAcceptanceSynthetic(t *testing.T) {
	m, store, _, _ := claudeRefreshFixture(t)
	transport := claudeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "platform.claude.com" {
			return claudeProfileResponse(200, claudeRefreshResponse), nil
		}
		return claudeProfileResponse(200, claudeTestProfile), nil
	})
	source := claudeSource{Refresh: true, maintenance: m, transport: transport, read: func(ctx context.Context) (claudeCredential, error) {
		raw, err := store.read(ctx)
		defer clear(raw)
		if err != nil {
			return claudeCredential{}, err
		}
		return parseClaudeCredential(raw)
	}}
	testClaudeRefreshAcceptance(t, source)
}

func TestLiveClaudeRefreshAcceptance(t *testing.T) {
	if os.Getenv("TEST_LIVE_CLAUDE_REFRESH") != "1" {
		t.Skip("set TEST_LIVE_CLAUDE_REFRESH=1 only for authorized OAuth and Keychain writeback acceptance")
	}
	testClaudeRefreshAcceptance(t, claudeSource{Store: "keychain", Refresh: true, transport: http.DefaultTransport})
}

// officialClaudeTurn runs one short turn of the fixed official client against the
// same official storage, so Bee's refresh happens while that client is active.
type officialClaudeTurn struct {
	done      chan struct{}
	started   atomic.Bool
	completed atomic.Bool
	failure   atomic.Bool
}

func startOfficialClaudeTurn(t *testing.T, ctx context.Context) *officialClaudeTurn {
	t.Helper()
	model := os.Getenv("TEST_LIVE_CLAUDE_MODEL")
	if model == "" {
		t.Fatal("concurrent official acceptance requires TEST_LIVE_CLAUDE_MODEL")
	}
	turn := &officialClaudeTurn{done: make(chan struct{})}
	// The official client keeps its default configuration directory, so both
	// clients share one Keychain namespace and one storage lock.
	command := exec.CommandContext(ctx, "claude", "--print", "--model", model, "--output-format", "stream-json", "--verbose",
		"--permission-mode", "plan", "Reply with exactly OK. Do not use tools.")
	command.Dir = t.TempDir()
	// USER is required: the official client derives its Keychain namespace from it.
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.Getenv("HOME"), "USER=" + os.Getenv("USER"), "TMPDIR=" + os.TempDir(),
		"HTTPS_PROXY=" + os.Getenv("HTTPS_PROXY"), "HTTP_PROXY=" + os.Getenv("HTTPS_PROXY"), "NO_PROXY=localhost,127.0.0.1"}
	command.Stderr = io.Discard
	stdout, err := command.StdoutPipe()
	if err != nil || command.Start() != nil {
		t.Fatal("concurrent official Claude client could not start")
	}
	turn.started.Store(true)
	ready := make(chan struct{}, 1)
	go func() {
		defer close(turn.done)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 1<<20)
		for scanner.Scan() {
			var event struct {
				Type    string `json:"type"`
				Subtype string `json:"subtype"`
				IsError bool   `json:"is_error"`
			}
			if json.Unmarshal(scanner.Bytes(), &event) != nil {
				continue
			}
			if event.Type == "system" && event.Subtype == "init" {
				select {
				case ready <- struct{}{}:
				default:
				}
			}
			if event.Type == "result" {
				turn.completed.Store(true)
				turn.failure.Store(event.IsError || event.Subtype != "success")
			}
		}
		_ = command.Wait()
	}()
	select {
	case <-ready:
	case <-turn.done:
		t.Fatal("concurrent official Claude client exited before starting a session (output omitted)")
	case <-time.After(30 * time.Second):
		t.Fatal("concurrent official Claude client did not start a session")
	}
	return turn
}

// The control peer issues one bound Hive task; only the refresh and storage worker can be live.
func testClaudeRefreshAcceptance(t *testing.T, source claudeSource) {
	t.Helper()
	timeout := 75 * time.Second
	concurrent := os.Getenv("TEST_LIVE_CLAUDE_OFFICIAL") == "1"
	if concurrent {
		timeout = 210 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	guard := &claudeRefreshAcceptanceTransport{base: source.transport}
	source.transport = guard
	if source.maintenance != nil {
		source.maintenance.transport = guard
	}
	_, auth, err := source.authorization(ctx)
	if err != nil || source.maintenance == nil {
		t.Fatal("Claude refresh preflight failed (details omitted)")
	}
	m := source.maintenance
	before, err := m.read(ctx)
	defer clear(before.raw)
	if err != nil {
		t.Fatal("Claude refresh source unavailable")
	}
	inbox, err := tee.GenerateInboxKey()
	if err != nil {
		t.Fatal("acceptance inbox unavailable")
	}
	const device = "aaaaaaaa-0000-4000-8000-000000000021"
	task := beewire.MaintenanceTask{ID: "claude-refresh-acceptance", Kind: "refresh_authorization", Platform: "claude", DeviceID: device, AccountGeneration: 1, AccountFingerprint: auth.AccountFingerprint, CredentialRevision: auth.CredentialRevision, KeyVersion: 1, Key: inbox.Public()}
	var uploads, stopped atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/bee/platforms/claude/account":
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "claude", Generation: 1, CredentialRevision: auth.CredentialRevision})
		case "/api/bee/maintenance":
			json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: beewire.PlatformAccount{Platform: "claude", Generation: 1}, Task: &task})
		case "/api/bee/credential-key":
			json.NewEncoder(w).Encode(task.Key)
		case "/api/bee/platforms/claude/account/source":
			stopped.Add(1)
			w.WriteHeader(200)
		case "/api/bee/credentials":
			raw, err := io.ReadAll(io.LimitReader(r.Body, 65537))
			defer clear(raw)
			current, readErr := m.read(ctx)
			defer clear(current.raw)
			var input beewire.CredentialRegistration
			valid := err == nil && readErr == nil && len(raw) <= 65536 && json.Unmarshal(raw, &input) == nil && input.Claude != nil && input.Codex == nil && input.TaskID == task.ID
			for _, token := range []string{before.secret.Token, before.refresh, current.secret.Token, current.refresh} {
				if token != "" && bytes.Contains(raw, []byte(token)) {
					valid = false
				}
			}
			opened, _, openErr := inbox.Open(input.Envelope)
			valid = valid && openErr == nil && opened.Token == current.secret.Token && current.secret.Token != before.secret.Token
			if valid {
				valid = input.Claude.AccountFingerprint == auth.AccountFingerprint && input.Claude.CredentialRevision == claudeDigest(current.secret.Token)
			}
			if !valid {
				t.Error("refresh upload invalid or unsaved (details omitted)")
				w.WriteHeader(400)
				return
			}
			uploads.Add(1)
			json.NewEncoder(w).Encode(map[string]int{"account_generation": 1})
		default:
			t.Error("unexpected refresh control operation")
			w.WriteHeader(400)
		}
	}))
	defer peer.Close()
	state := localState{Hive: peer.URL, Credential: "synthetic-device-credential", Identity: &beewire.Identity{ID: device}}
	// The official client runs on the same storage while Bee refreshes; the
	// observation records whether it was still active at the OAuth request.
	var official *officialClaudeTurn
	var overlapped atomic.Bool
	if concurrent {
		official = startOfficialClaudeTurn(t, ctx)
		guard.onRefresh = func() { overlapped.Store(official.started.Load() && !official.completed.Load()) }
	}
	err = source.synchronize(ctx, state, "synthetic-lease", io.Discard, true)
	if official != nil {
		select {
		case <-official.done:
		case <-time.After(120 * time.Second):
			t.Fatal("the concurrent official Claude client did not finish")
		}
		t.Logf("official client: turn_completed=%t turn_failed=%t official_active_at_oauth=%t", official.completed.Load(), official.failure.Load(), overlapped.Load())
		if !official.completed.Load() || official.failure.Load() {
			t.Fatal("the official Claude client did not complete its turn while Bee refreshed")
		}
	}
	t.Logf("Claude refresh: OAuth attempts=%d status=%d profiles=%d saved_uploads=%d stopped=%t", guard.refreshes.Load(), guard.status.Load(), guard.profiles.Load(), uploads.Load(), stopped.Load() != 0)
	if err != nil || stopped.Load() != 0 || uploads.Load() != 1 || guard.refreshes.Load() != 1 || guard.status.Load() != 200 {
		t.Fatal("Claude refresh acceptance failed; preserve official storage and maintenance journal (details omitted)")
	}
	current, binding, err := m.binding(ctx)
	journal, journalErr := readRefreshJournal(m.path("maintenance"))
	if err != nil || journalErr != nil || !current.available(time.Now()) || binding.AccountFingerprint != auth.AccountFingerprint || journal.State != "saved" || journal.ResultRevision != binding.CredentialRevision {
		t.Fatal("saved refresh metadata could not be verified")
	}
	if _, _, err := m.execute(ctx, task, auth); err == nil || guard.refreshes.Load() != 1 {
		t.Fatal("old refresh task replay was not rejected")
	}
}
