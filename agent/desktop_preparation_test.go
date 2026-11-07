package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/tokhive/bee/beewire"
)

// Called under the enclosing synthetic Hive fixture's mutex.
func encodeDesktopPreparationFixture(w http.ResponseWriter, r *http.Request, supply beewire.PlatformSupply, operations map[string]string) {
	id := r.URL.Query().Get("preparation_id")
	if id == "" {
		json.NewEncoder(w).Encode(supply)
		return
	}
	if r.Method == "PUT" {
		var input struct {
			Preparation desktopSupplyPreparation `json:"preparation"`
		}
		json.NewDecoder(r.Body).Decode(&input)
		if input.Preparation.Action == "begin" && operations[id] == "" {
			operations[id] = "active"
		}
		if input.Preparation.Action == "complete" {
			operations[id] = "completed"
		}
		if input.Preparation.Action == "cancel" {
			operations[id] = "cancelled"
		}
	}
	state := operations[id]
	if state == "" {
		state = "absent"
	}
	if state == "active" {
		supply.Ready = false
		if len(supply.Reasons) == 0 {
			supply.Reasons = []string{beewire.ReasonAuthorizationUnavailable}
		}
	}
	json.NewEncoder(w).Encode(map[string]any{"preparation": map[string]string{"id": id, "state": state}, "supply": supply})
}

func TestDesktopPreparationCanReplaceUnregisteredSelectionWithoutStrandingBarrier(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	current, _ := f.runtime.Snapshot(context.Background())
	if _, err := f.runtime.Stop(context.Background(), DesktopStopRequest{ExpectedRevision: current.Revision, Reason: "user_stop"}); err != nil {
		t.Fatal(err)
	}
	waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Local == "stopped" })
	first := f.selectAccount("openai")
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), desktopOtherCodexFixture(t), 0600); err != nil {
		t.Fatal(err)
	}
	candidate, err := f.accounts.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.accounts.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: candidate.Revision, CandidateRef: *candidate.Candidate.Reference, Action: "select", Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	done := waitSelection(t, f.accounts, "openai")
	if done.Operation.State != "succeeded" || *done.Selection.Fingerprint == *first.Selection.Fingerprint {
		t.Fatalf("replacement of unregistered choice stranded preparation: %+v", done.Operation)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	active, cancelled := 0, 0
	for _, state := range f.preparations {
		if state == "active" {
			active++
		}
		if state == "cancelled" {
			cancelled++
		}
	}
	if active != 1 || cancelled != 1 || f.supplyWrites.Load() != 0 {
		t.Fatalf("replacement lost original evidence or changed choice: active=%d cancelled=%d manual_writes=%d", active, cancelled, f.supplyWrites.Load())
	}
}

func TestDesktopPreparationPreservesChoiceChangedDuringPreparation(t *testing.T) {
	for _, initial := range []bool{false, true} {
		t.Run(map[bool]string{false: "pause_during_preparation", true: "resume_during_preparation"}[initial], func(t *testing.T) {
			f := newDesktopAutoMaintenanceFixture(t)
			f.mu.Lock()
			f.paused["openai"] = initial
			f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
				if q.Method != "PUT" || q.URL.Path != "/api/bee/platforms/openai" {
					return false
				}
				data, _ := io.ReadAll(q.Body)
				q.Body = io.NopCloser(bytes.NewReader(data))
				var input struct {
					Preparation desktopSupplyPreparation `json:"preparation"`
				}
				json.Unmarshal(data, &input)
				if input.Preparation.Action == "complete" {
					f.mu.Lock()
					f.paused["openai"] = !initial
					f.mu.Unlock()
				}
				return false
			}
			f.mu.Unlock()
			f.selectAccount("openai")
			s := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
			if s.Platforms["openai"].Supply.Paused != !initial || f.supplyWrites.Load() != 0 {
				t.Fatalf("preparation overwrote latest choice: paused=%t writes=%d", s.Platforms["openai"].Supply.Paused, f.supplyWrites.Load())
			}
		})
	}
}

func TestDesktopPreparationFailedCompletionStaysHeldAndLostResponseReconciles(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	var recover atomic.Bool
	f.mu.Lock()
	f.paused["openai"] = false
	f.beforeRequest = func(w http.ResponseWriter, q *http.Request) bool {
		if q.Method != "PUT" || q.URL.Path != "/api/bee/platforms/openai" {
			return false
		}
		data, _ := io.ReadAll(q.Body)
		q.Body = io.NopCloser(bytes.NewReader(data))
		var input struct {
			Preparation desktopSupplyPreparation `json:"preparation"`
		}
		json.Unmarshal(data, &input)
		if input.Preparation.Action != "complete" {
			return false
		}
		if !recover.Load() {
			w.WriteHeader(503)
			return true
		}
		f.mu.Lock()
		f.preparations[input.Preparation.ID] = "completed"
		f.mu.Unlock()
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
		} else {
			conn.Close()
		}
		return true
	}
	f.mu.Unlock()
	f.selectAccount("openai")
	failed := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Account.Authorization.Error != nil })
	if failed.Platforms["openai"].Supply != nil || f.supplyWrites.Load() != 0 {
		t.Fatal("failed completion published ready supply or changed manual choice")
	}
	f.mu.Lock()
	active := 0
	for _, state := range f.preparations {
		if state == "active" {
			active++
		}
	}
	f.mu.Unlock()
	if active != 1 {
		t.Fatalf("failed completion lost durable barrier: active=%d", active)
	}
	recover.Store(true)
	ready := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool { return s.Platforms["openai"].Supply != nil })
	if ready.Platforms["openai"].Supply.Paused || f.supplyWrites.Load() != 0 || f.preparationBegins.Load() != 1 {
		t.Fatal("reconciliation changed choice or replaced original preparation")
	}
	if _, err := f.runtime.Snapshot(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopPreparationPreservesAcceptingChoice(t *testing.T) {
	f := newDesktopAutoMaintenanceFixture(t)
	f.mu.Lock()
	f.paused["openai"] = false
	f.mu.Unlock()
	f.selectAccount("openai")
	s := waitRuntime(t, f.runtime, func(s DesktopRuntimeSnapshot) bool {
		return s.Local == "running" && s.Platforms["openai"].Supply != nil
	})
	if s.Platforms["openai"].Supply.Paused || f.resumeWrites.Load() != 0 {
		t.Fatalf("ordinary preparation changed user's accepting choice: paused=%t resume_writes=%d", s.Platforms["openai"].Supply.Paused, f.resumeWrites.Load())
	}
}
