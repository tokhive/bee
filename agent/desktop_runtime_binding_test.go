package bee

import (
	"context"
	"encoding/json"
	"github.com/tokhive/bee/beewire"
	"net/http"
	"testing"
)

func TestDesktopRuntimeRejectsKnownGenerationChange(t *testing.T) {
	var account beewire.PlatformAccount
	resumes := 0
	paused := true
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		switch q.URL.Path {
		case "/api/bee/platforms/openai/account":
			json.NewEncoder(w).Encode(account)
		case "/api/bee/platforms/openai/capabilities":
			json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
		case "/api/bee/platforms/openai":
			if q.Method == "PUT" {
				resumes++
				paused = false
			}
			reasons := []string{}
			if paused {
				reasons = append(reasons, "manually_paused")
			}
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: paused, Ready: !paused, Reasons: reasons})
		default:
			t.Errorf("unexpected %s", q.URL.Path)
			w.WriteHeader(404)
		}
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	desktopRuntimeSelectionFixture(t, d, a)
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	state, err := session.read()
	if err != nil {
		t.Fatal(err)
	}
	scope, err := a.selectionScope(session, state, func(s *desktopAccountScope) error {
		v := s.Selections["openai"]
		v.Generation = 1
		s.Selections["openai"] = v
		s.Session = desktopSessionMarker{RunID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Active: true}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	selected := scope.Selections["openai"]
	account = beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 3, AccountFingerprint: selected.Fingerprint, CredentialRevision: selected.CredentialRevision}
	run := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	r.snapshot.RunID = &run
	r.snapshot.Local = "running"
	r.snapshot.Connection = "connected"
	slot := r.slots["openai"]
	slot.selection = selected
	slot.resume = true
	err = r.observeSynchronizedPlatform(context.Background(), state, "openai", slot)
	if err == nil || resumes != 0 {
		t.Fatalf("known generation changed 1 -> 3 but resume was accepted: err=%v resume_puts=%d", err, resumes)
	}
}

func TestDesktopRuntimeRejectsChangedReadback(t *testing.T) {
	var account beewire.PlatformAccount
	resumes := 0
	accountReads := 0
	paused := true
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		switch q.URL.Path {
		case "/api/bee/platforms/openai/account":
			accountReads++
			actual := account
			if accountReads > 1 {
				actual.Generation = 2
				actual.AccountFingerprint = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			}
			json.NewEncoder(w).Encode(actual)
		case "/api/bee/platforms/openai/capabilities":
			json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
		case "/api/bee/platforms/openai":
			if q.Method == "PUT" {
				resumes++
				paused = false
			}
			reasons := []string{}
			if paused {
				reasons = append(reasons, "manually_paused")
			}
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: paused, Ready: !paused, Reasons: reasons})
		default:
			t.Errorf("unexpected %s", q.URL.Path)
			w.WriteHeader(404)
		}
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	desktopRuntimeSelectionFixture(t, d, a)
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	state, err := session.read()
	if err != nil {
		t.Fatal(err)
	}
	scope, err := a.selectionScope(session, state, func(s *desktopAccountScope) error {
		v := s.Selections["openai"]
		v.Generation = 1
		s.Selections["openai"] = v
		s.Session = desktopSessionMarker{RunID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Active: true}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	selected := scope.Selections["openai"]
	account = beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1, AccountFingerprint: selected.Fingerprint, CredentialRevision: selected.CredentialRevision}
	run := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	r.snapshot.RunID = &run
	r.snapshot.Local = "running"
	r.snapshot.Connection = "connected"
	slot := r.slots["openai"]
	slot.selection = selected
	slot.resume = true
	err = r.observeSynchronizedPlatform(context.Background(), state, "openai", slot)
	if err == nil || resumes != 0 {
		t.Fatalf("later readback showed a different account but resume was accepted: err=%v resume_puts=%d", err, resumes)
	}
}

func TestDesktopRuntimeRequiresMatchingSynchronizationReceipt(t *testing.T) {
	var account beewire.PlatformAccount
	resumes := 0
	paused := true
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, q *http.Request) {
		if desktopSupplyServeIdentity(w, q) {
			return
		}
		switch q.URL.Path {
		case "/api/bee/platforms/openai/account":
			json.NewEncoder(w).Encode(account)
		case "/api/bee/platforms/openai/capabilities":
			json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
		case "/api/bee/platforms/openai":
			if q.Method == "PUT" {
				resumes++
				paused = false
			}
			reasons := []string{}
			if paused {
				reasons = append(reasons, "manually_paused")
			}
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Paused: paused, Ready: !paused, Reasons: reasons})
		default:
			t.Errorf("unexpected %s", q.URL.Path)
			w.WriteHeader(404)
		}
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	desktopRuntimeSelectionFixture(t, d, a)
	r := NewDesktopRuntime(context.Background(), d, a)
	defer r.Close()
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	state, err := session.read()
	if err != nil {
		t.Fatal(err)
	}
	scope, err := a.selectionScope(session, state, func(s *desktopAccountScope) error {
		v := s.Selections["openai"]
		v.Generation = 1
		s.Selections["openai"] = v
		s.Session = desktopSessionMarker{RunID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Active: true}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	selected := scope.Selections["openai"]
	account = beewire.PlatformAccount{Platform: "openai", Status: "ready", Generation: 1, AccountFingerprint: selected.Fingerprint, CredentialRevision: selected.CredentialRevision}
	run := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	r.snapshot.RunID = &run
	r.snapshot.Local = "running"
	r.snapshot.Connection = "connected"
	slot := r.slots["openai"]
	slot.selection = selected
	slot.resume = true
	err = r.observeSynchronizedPlatform(context.Background(), state, "openai", slot)
	if err == nil || resumes != 0 {
		t.Fatalf("missing synchronization receipt accepted: err=%v resume_puts=%d", err, resumes)
	}
}
