package bee

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tunnel"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/relay"
)

type desktopAutoMaintenanceFixture struct {
	t                *testing.T
	accounts         *DesktopAccounts
	runtime          *DesktopRuntime
	mu               sync.Mutex
	paused           map[string]bool
	account          map[string]beewire.PlatformAccount
	uploads          map[string]int
	peer             *relay.Session
	connections      atomic.Int32
	resumeWrites     atomic.Int32
	pauseWrites      atomic.Int32
	dispatchOnUpload bool
	dispatchResults  chan error
	beforeRequest    func(http.ResponseWriter, *http.Request) bool
}

func newDesktopAutoMaintenanceFixture(t *testing.T) *desktopAutoMaintenanceFixture {
	t.Helper()
	f := &desktopAutoMaintenanceFixture{t: t, paused: map[string]bool{}, account: map[string]beewire.PlatformAccount{}, uploads: map[string]int{}, dispatchResults: make(chan error, 4)}
	for _, platform := range []string{"openai", "claude"} {
		f.paused[platform] = true
		f.account[platform] = beewire.PlatformAccount{Platform: platform, Status: "not_configured"}
	}
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		if q.Method != "CONNECT" || (q.Host != "chatgpt.com:443" && q.Host != "api.anthropic.com:443") {
			t.Errorf("relay request=%s %s; required=CONNECT to selected platform", q.Method, q.Host)
			w.WriteHeader(http.StatusForbidden)
			return
		}
		conn, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		io.WriteString(conn, "HTTP/1.1 200 Connection established\r\n\r\n")
		io.Copy(conn, buffer)
	}))
	t.Cleanup(proxy.Close)
	inbox, err := tee.GenerateInboxKey()
	if err != nil {
		t.Fatal(err)
	}
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		if q.Method == "PUT" && (q.URL.Path == "/api/bee/platforms/openai" || q.URL.Path == "/api/bee/platforms/claude") {
			f.pauseWrites.Add(1)
		}
		f.mu.Lock()
		beforeRequest := f.beforeRequest
		f.mu.Unlock()
		if beforeRequest != nil && beforeRequest(w, q) {
			return
		}
		if q.URL.Path == "/api/bee/connect" {
			conn, err := websocket.Accept(w, q, nil)
			if err != nil {
				return
			}
			defer conn.CloseNow()
			<-conn.CloseRead(q.Context()).Done()
			return
		}
		if q.URL.Path == "/api/bee/agent" {
			f.connections.Add(1)
			w.Header().Set("X-Bee-Lease", "auto-maintenance-lease")
			conn, err := websocket.Accept(w, q, nil)
			if err != nil {
				return
			}
			peer := relay.New(q.Context(), conn, tunnel.Low, nil, relay.Options{})
			defer peer.Close()
			f.mu.Lock()
			f.peer = peer
			f.mu.Unlock()
			<-peer.Context.Done()
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		for _, platform := range []string{"openai", "claude"} {
			base := "/api/bee/platforms/" + platform
			switch q.URL.Path {
			case base:
				if q.Method == "PUT" {
					var input struct {
						Paused bool `json:"paused"`
					}
					if err := json.NewDecoder(q.Body).Decode(&input); err != nil {
						t.Error(err)
					}
					f.paused[platform] = input.Paused
					if !input.Paused {
						f.resumeWrites.Add(1)
					}
				}
				reasons := []string{}
				if f.paused[platform] {
					reasons = append(reasons, "manually_paused")
				}
				if f.uploads[platform] == 0 {
					reasons = append(reasons, "not_configured")
				}
				json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: platform, Paused: f.paused[platform], Ready: len(reasons) == 0, Reasons: reasons})
				return
			case base + "/account":
				json.NewEncoder(w).Encode(f.account[platform])
				return
			case base + "/capabilities":
				if q.Method == "GET" {
					json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
				} else {
					json.NewEncoder(w).Encode(map[string]bool{"ok": true})
				}
				return
			}
		}
		switch q.URL.Path {
		case "/api/bee/maintenance":
			var input beewire.MaintenanceRequest
			if err := json.NewDecoder(q.Body).Decode(&input); err != nil {
				t.Error(err)
				return
			}
			platform, authorization, valid := input.Authorization()
			if !valid {
				t.Errorf("maintenance metadata invalid for platform=%s", platform)
			}
			fingerprint, revision := authorization.AccountFingerprint, authorization.CredentialRevision
			if input.Lease != "auto-maintenance-lease" {
				t.Errorf("maintenance lease=%q", input.Lease)
			}
			f.account[platform] = beewire.PlatformAccount{Platform: platform, Status: "ready", Generation: 1, AccountFingerprint: fingerprint, CredentialRevision: revision}
			var task *beewire.MaintenanceTask
			if f.uploads[platform] == 0 {
				task = &beewire.MaintenanceTask{ID: "auto-" + platform, Kind: "reencrypt_authorization", DeviceID: "device-1", Platform: platform, AccountFingerprint: fingerprint, AccountGeneration: 1, CredentialRevision: revision, KeyVersion: 1, Key: inbox.Public()}
			}
			json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: f.account[platform], Task: task})
		case "/api/bee/credential-key":
			json.NewEncoder(w).Encode(inbox.Public())
		case "/api/bee/credentials":
			var input struct {
				Envelope tee.Envelope `json:"envelope"`
				TaskID   string       `json:"task_id"`
				Lease    string       `json:"lease"`
			}
			if err := json.NewDecoder(q.Body).Decode(&input); err != nil {
				t.Error(err)
				return
			}
			secret, _, err := inbox.Open(input.Envelope)
			if err != nil || secret.Token == "" || input.Lease != "auto-maintenance-lease" {
				t.Errorf("authorization envelope=%v lease=%q", err, input.Lease)
			}
			platform := strings.TrimPrefix(input.TaskID, "auto-")
			f.uploads[platform]++
			if f.dispatchOnUpload {
				f.dispatchResults <- probeDesktopAutoRelay(f.peer, platform)
			}
			json.NewEncoder(w).Encode(map[string]int{"account_generation": 1})
		default:
			t.Errorf("unexpected auto-maintenance request: %s %s", q.Method, q.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
	f.accounts = NewDesktopAccounts(d)
	f.accounts.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
		if q.URL.Path == "/api/oauth/profile" {
			return claudeProfileResponse(200, `{"account":{"uuid":"11111111-1111-1111-1111-111111111111","email":"fixture@example.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`), nil
		}
		return claudeProfileResponse(503, `{}`), nil
	})
	f.runtime = NewDesktopRuntime(context.Background(), d, f.accounts)
	t.Cleanup(f.accounts.Close)
	t.Cleanup(f.runtime.Close)
	if err := f.runtime.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); err != nil {
		t.Fatal(err)
	}
	enableTestPresence(t, f.runtime)
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "waiting" && s.Connection == "connected" })
	return f
}

func probeDesktopAutoRelay(peer *relay.Session, platform string) error {
	if peer == nil {
		return fmt.Errorf("authorization accepted before relay peer exists")
	}
	metadata, err := json.Marshal(map[string]string{"host": map[string]string{"openai": "chatgpt.com:443", "claude": "api.anthropic.com:443"}[platform]})
	if err != nil {
		return err
	}
	stream, err := peer.Mux.Dial(metadata)
	if err != nil {
		return err
	}
	defer stream.Close()
	probe := "authorization-can-dispatch-immediately-" + platform
	done := make(chan error, 1)
	go func() {
		_, err := io.WriteString(stream, probe)
		if err == nil {
			got := make([]byte, len(probe))
			_, err = io.ReadFull(stream, got)
			if err == nil && string(got) != probe {
				err = fmt.Errorf("relay reply=%q expected=%q", got, probe)
			}
		}
		done <- err
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(time.Second):
		return fmt.Errorf("authorization accepted before platform=%s forwarding became ready", platform)
	}
}

func TestDesktopAutoMaintenanceAddsSecondPlatformWithoutRestartAndForwardsBeforePublishing(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.mu.Lock()
	f.dispatchOnUpload = true
	f.mu.Unlock()
	f.selectAccount("openai")
	first := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if err := <-f.dispatchResults; err != nil {
		t.Fatal(err)
	}
	f.selectAccount("claude")
	second := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["claude"].Supply != nil && s.Platforms["claude"].Account.Authorization.State == "synchronized"
	})
	if err := <-f.dispatchResults; err != nil {
		t.Fatal(err)
	}
	if first.RunID == nil || second.RunID == nil || *first.RunID != *second.RunID || f.connections.Load() != 1 || f.resumeWrites.Load() != 0 || second.Platforms["openai"].Supply == nil || !second.Platforms["openai"].Supply.Paused || !second.Platforms["claude"].Supply.Paused {
		t.Fatalf("second platform changed owned run or pause: first=%+v second=%+v connections=%d resumes=%d", first, second, f.connections.Load(), f.resumeWrites.Load())
	}
}

func TestDesktopAutoMaintenanceKeepsSuccessfulSelectionWhenConcurrentPlatformFails(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	claude := f.detect("claude")
	openai := f.detect("openai")
	entered, proceed := make(chan struct{}), make(chan struct{})
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.Method == "PUT" && q.URL.Path == "/api/bee/platforms/claude" {
			close(entered)
			select {
			case <-proceed:
			case <-q.Context().Done():
				return true
			}
			if err := os.Remove(filepath.Join(*claude.Candidate.Source.Directory, ".credentials.json")); err != nil {
				t.Error(err)
			}
		}
		return false
	}
	f.mu.Unlock()
	if _, err := f.accounts.Action(context.Background(), DesktopAccountActionRequest{Platform: "claude", Revision: claude.Revision, CandidateRef: *claude.Candidate.Reference, Action: "select", Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("Claude selection did not reach pause")
	}
	if _, err := f.accounts.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: openai.Revision, CandidateRef: *openai.Candidate.Reference, Action: "select", Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	if selected := waitSelection(t, f.accounts, "openai"); selected.Operation.State != "succeeded" {
		t.Fatalf("OpenAI selection=%+v", selected.Operation)
	}
	before, err := f.runtime.Snapshot(context.Background())
	if err != nil || before.Local != "waiting" || f.connections.Load() != 0 {
		t.Fatalf("runtime crossed active account barrier: snapshot=%+v error=%v", before, err)
	}
	close(proceed)
	if failed := waitSelection(t, f.accounts, "claude"); failed.Operation.State != "failed" {
		t.Fatalf("Claude result=%+v", failed.Operation)
	}
	after := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if !after.Platforms["openai"].Supply.Paused || after.Platforms["claude"].SelectionRevision != 0 || f.resumeWrites.Load() != 0 || f.connections.Load() != 1 {
		t.Fatalf("successful selection was lost or unsafe platform enabled: %+v", after)
	}
}

func TestDesktopAutoMaintenanceDoesNotRestartAfterExitDuringSelection(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	snapshot := f.detect("openai")
	entered := make(chan struct{})
	release := make(chan struct{})
	defer close(release)
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.Method == "PUT" && q.URL.Path == "/api/bee/platforms/openai" {
			io.Copy(io.Discard, q.Body)
			close(entered)
			select {
			case <-q.Context().Done():
			case <-release:
			}
			return true
		}
		return false
	}
	f.mu.Unlock()
	if _, err := f.accounts.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: snapshot.Revision, CandidateRef: *snapshot.Candidate.Reference, Action: "select", Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("selection did not reach pause")
	}
	current, err := f.runtime.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: current.Revision, Reason: "app_exit"}); err != nil {
		t.Fatal(err)
	}
	stopped := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.StopReceipt != nil })
	if !stopped.StopReceipt.WorkersStopped || !stopped.StopReceipt.SessionClean || f.connections.Load() != 0 || f.resumeWrites.Load() != 0 {
		t.Fatalf("exit was not respected: snapshot=%+v connections=%d", stopped, f.connections.Load())
	}
	selected := waitSelection(t, f.accounts, "openai")
	if selected.Operation.State == "succeeded" || selected.Selection.State != "not_selected" {
		t.Fatalf("cancelled selection was marked successful: %+v", selected)
	}
}

func TestDesktopAutoMaintenanceDoesNotUpgradeStoppedIntent(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	current, err := f.runtime.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: current.Revision, Reason: "user_stop"}); err != nil {
		t.Fatal(err)
	}
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" && s.Connection == "connected" })
	f.selectAccount("openai")
	after, err := f.runtime.Snapshot(context.Background())
	if err != nil || after.Local != "stopped" || after.RunID != nil || f.connections.Load() != 0 {
		t.Fatalf("selection upgraded stopped intent: snapshot=%+v error=%v connections=%d", after, err, f.connections.Load())
	}
}

func TestDesktopAutoMaintenanceWaitsForUnknownSelectionWithoutReplayingOrReplacingItsFailure(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	var recovered atomic.Bool
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.URL.Path != "/api/bee/platforms/openai" {
			return false
		}
		if q.Method == "PUT" {
			io.Copy(io.Discard, q.Body)
			f.mu.Lock()
			f.paused["openai"] = true
			f.mu.Unlock()
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
			} else {
				conn.Close()
			}
			return true
		}
		if q.Method == "GET" && !recovered.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			io.WriteString(w, `{"code":"pause_read_unavailable","message":"controlled pause readback outage"}`)
			return true
		}
		return false
	}
	f.mu.Unlock()
	candidate := f.detect("openai")
	if _, err := f.accounts.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: candidate.Revision, CandidateRef: *candidate.Candidate.Reference, Action: "select", Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	unknown := waitSelection(t, f.accounts, "openai")
	if unknown.Operation.State != "reconciling" || unknown.Operation.Error == nil {
		t.Fatalf("lost pause result=%+v", unknown.Operation)
	}
	if _, err := f.accounts.Snapshot(context.Background(), "openai", true); err != nil {
		t.Fatal(err)
	}
	waitSelection(t, f.accounts, "openai")
	blocked, err := f.runtime.Snapshot(context.Background())
	if err != nil || blocked.Local != "waiting" || f.connections.Load() != 0 || f.pauseWrites.Load() != 1 || blocked.Platforms["openai"].Account.Authorization.Error != nil {
		t.Fatalf("unknown selection was replayed or automatic admission replaced its failure: snapshot=%+v error=%v writes=%d", blocked, err, f.pauseWrites.Load())
	}
	recovered.Store(true)
	if _, err := f.accounts.Snapshot(context.Background(), "openai", true); err != nil {
		t.Fatal(err)
	}
	resolved := waitSelection(t, f.accounts, "openai")
	if resolved.Operation.State != "succeeded" {
		t.Fatalf("selection did not reconcile: %+v", resolved.Operation)
	}
	after := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if !after.Platforms["openai"].Supply.Paused || f.pauseWrites.Load() != 1 || f.resumeWrites.Load() != 0 {
		t.Fatalf("reconciliation repeated pause or resumed: snapshot=%+v writes=%d", after, f.pauseWrites.Load())
	}
}

func TestDesktopAutoMaintenancePreparationFailureCanBeExplicitlyRetriedWithoutReselecting(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	var supplyReads atomic.Int32
	var recovered atomic.Bool
	f.mu.Lock()
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.Method == "GET" && q.URL.Path == "/api/bee/platforms/openai" && supplyReads.Add(1) > 1 && !recovered.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			io.WriteString(w, `{"code":"prepare_supply_unavailable","message":"controlled preparation outage"}`)
			return true
		}
		return false
	}
	f.mu.Unlock()
	selected := f.selectAccount("openai")
	failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "failed" && s.Connection == "connected"
	})
	if failed.Operation == nil || failed.Operation.State != "failed" || failed.Operation.Error == nil || failed.Platforms["openai"].Account.Authorization.Error == nil || !strings.Contains(failed.Platforms["openai"].Account.Authorization.Error.Message, "503") {
		t.Fatalf("preparation failure lost original evidence: %+v", failed)
	}
	recovered.Store(true)
	if _, err := f.runtime.Start(context.Background(), DesktopStartRequest{ExpectedRevision: failed.Revision, ResumePlatforms: []string{}}); err != nil {
		t.Fatal(err)
	}
	after := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if after.Platforms["openai"].Account.Operation.ID != selected.Operation.ID || after.Platforms["openai"].Account.Selection.State != "selected" || !after.Platforms["openai"].Supply.Paused || f.pauseWrites.Load() != 1 || f.resumeWrites.Load() != 0 {
		t.Fatalf("explicit retry reselected or changed pause: snapshot=%+v writes=%d", after, f.pauseWrites.Load())
	}
}

func (f *desktopAutoMaintenanceFixture) detect(platform string) DesktopAccountSnapshot {
	f.t.Helper()
	directory := f.t.TempDir()
	filename, raw := "auth.json", desktopCodexFixture(f.t, time.Now().Add(time.Hour))
	if platform == "claude" {
		filename, raw = ".credentials.json", claudeSample(time.Now().Add(time.Hour))
	}
	if err := os.WriteFile(filepath.Join(directory, filename), raw, 0600); err != nil {
		f.t.Fatal(err)
	}
	snapshot, err := f.accounts.Detect(context.Background(), DesktopAccountDetectRequest{Platform: platform, Directory: &directory, Store: "file", Mode: "local"})
	if err != nil || snapshot.Candidate.Reference == nil {
		f.t.Fatalf("candidate platform=%s snapshot=%+v error=%v", platform, snapshot, err)
	}
	return snapshot
}

func (f *desktopAutoMaintenanceFixture) selectAccount(platform string) DesktopAccountSnapshot {
	f.t.Helper()
	snapshot := f.detect(platform)
	if _, err := f.accounts.Action(context.Background(), DesktopAccountActionRequest{Platform: platform, Revision: snapshot.Revision, CandidateRef: *snapshot.Candidate.Reference, Action: "select", Confirmed: true}); err != nil {
		f.t.Fatal(err)
	}
	selected := waitSelection(f.t, f.accounts, platform)
	if selected.Operation.State != "succeeded" {
		f.t.Fatalf("selection platform=%s operation=%+v", platform, selected.Operation)
	}
	return selected
}

func TestDesktopAutoMaintenanceStartsAfterExplicitSelectionAndKeepsPaused(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.selectAccount("openai")
	snapshot := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil && s.Platforms["openai"].Account.Authorization.State == "synchronized"
	})
	if snapshot.Platforms["openai"].Supply == nil || !snapshot.Platforms["openai"].Supply.Paused || f.resumeWrites.Load() != 0 || f.connections.Load() != 1 {
		t.Fatalf("explicit selection did not maintain paused platform: snapshot=%+v resumes=%d connections=%d", snapshot, f.resumeWrites.Load(), f.connections.Load())
	}
}
