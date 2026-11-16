package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

type notificationFixture struct {
	accounts *DesktopAccounts
	device   *DesktopDevice
	state    localState
	path     string
	now      time.Time
}

func TestDesktopNotificationsSessionProtectionFailureHidesPrivatePath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix mode protection is not the Windows ACL contract")
	}
	f := newNotificationFixture(t)
	path := f.device.path + ".lock"
	if err := os.WriteFile(path, nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	_, err := f.accounts.NotificationSnapshot(context.Background())
	if err == nil || strings.Contains(err.Error(), f.device.path) || !strings.Contains(err.Error(), "protection") || !strings.Contains(err.Error(), "0600") {
		t.Fatalf("session protection failure lost evidence or exposed private path: %v", err)
	}
}

func TestDesktopNotificationsWindowsProtectionEvidenceOmitsPrivateIdentity(t *testing.T) {
	path := `C:\Users\PRIVATE_MARKER\bee-desktop.json.lock`
	err := notificationReadFailure("device_session", fmt.Errorf("check Bee configuration lock protection: file %q has owner SID=S-1-5-21-123-456-789; required current process SID=S-1-5-21-321-654-987", path), true, path)
	if strings.Contains(err.Error(), "PRIVATE_MARKER") || strings.Contains(err.Error(), "S-1-") || !strings.Contains(err.Error(), "owner SID") {
		t.Fatalf("Windows protection failure lost check or exposed private identity: %v", err)
	}
}

func newNotificationFixture(t *testing.T) notificationFixture {
	t.Helper()
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("notification snapshot performed HTTP: method=%s", r.Method)
		w.WriteHeader(500)
	})
	state, err := readState(d.path)
	if err != nil {
		t.Fatal(err)
	}
	a := NewDesktopAccounts(d)
	t.Cleanup(a.Close)
	now := time.Date(2026, 10, 27, 9, 0, 0, 0, time.UTC)
	a.now = func() time.Time { return now }
	selected := desktopAccountSelection{Source: DesktopAccountSource{Directory: accountString(t.TempDir()), Store: "file"}, Fingerprint: strings.Repeat("a", 64), CredentialRevision: strings.Repeat("b", 64), Revision: 1, Generation: 1}
	scope := newDesktopAccountScope(state)
	scope.Selections["openai"] = selected
	path := filepath.Join(filepath.Dir(d.path), "ai-accounts.json")
	disk := desktopAccountState{Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID): scope}}
	if err := saveDesktopAccountState(path, disk, 0); err != nil {
		t.Fatal(err)
	}
	p := a.platforms["openai"]
	p.selected = &selected
	p.binding = &desktopAccountBinding{hive: state.Hive, owner: state.Identity.OwnerID, device: state.Identity.ID, fingerprint: selected.Fingerprint}
	p.snapshot.Selection = DesktopAccountFact{State: "selected", Fingerprint: accountString(selected.Fingerprint), ObservedAt: accountTime(now)}
	p.snapshot.Hive = DesktopAccountHiveFact{DesktopAccountFact: DesktopAccountFact{State: "ready", Fingerprint: accountString(selected.Fingerprint), ObservedAt: accountTime(now)}}
	p.snapshot.CheckedAt = accountTime(now)
	used := 25
	p.snapshot.Capabilities[1] = DesktopAccountCapabilities{Origin: "hive", Status: "ready", ObservedAt: accountTime(now), ValidUntil: accountTime(now.Add(time.Minute)), Windows: []DesktopAccountWindow{{Seconds: 18000, UsedPercent: &used, ResetAt: accountTime(now.Add(time.Hour))}}}
	a.network.Revision = 7
	return notificationFixture{accounts: a, device: d, state: state, path: path, now: now}
}
func (f notificationFixture) key(problem string) string {
	return desktopNoticeKey(f.state.Hive, f.state.Identity.OwnerID, "openai", f.accounts.platforms["openai"].selected.Fingerprint, problem)
}
func (f notificationFixture) notice(t *testing.T, problem string, notified bool) {
	t.Helper()
	disk, err := readDesktopAccountState(f.path)
	if err != nil {
		t.Fatal(err)
	}
	disk.Entries[f.key(problem)] = desktopAccountNotice{FirstSeen: f.now.Add(-time.Hour), Notified: notified}
	if err := saveDesktopAccountState(f.path, disk, disk.Revision); err != nil {
		t.Fatal(err)
	}
	p := f.accounts.platforms["openai"]
	p.snapshot.Issues = []DesktopAccountIssue{{Code: problem, Platform: "openai", Fingerprint: accountString(p.selected.Fingerprint), Message: "PRIVATE_MESSAGE_MARKER", Notify: false}}
	if problem != "offline" && problem != "quota_exhausted" {
		p.snapshot.Hive.State = problem
	}
}
func notificationFact(t *testing.T, s DesktopNotificationSnapshot, problem string) DesktopNotificationFact {
	t.Helper()
	for _, fact := range s.Facts {
		if fact.Platform == "openai" && fact.Problem == problem {
			return fact
		}
	}
	t.Fatalf("notification fact absent: problem=%s facts=%d", problem, len(s.Facts))
	return DesktopNotificationFact{}
}
func TestDesktopNotificationsUseDurableGateWithoutConsumingPulseOrWriting(t *testing.T) {
	for _, problem := range []string{"authorization_rejected", "confirmation_required", "offline", "quota_exhausted"} {
		t.Run(problem, func(t *testing.T) {
			f := newNotificationFixture(t)
			f.notice(t, problem, true)
			before, _ := os.ReadFile(f.path)
			snapshotBefore, _ := json.Marshal(f.accounts.platforms["openai"].snapshot)
			for range 2 {
				got, err := f.accounts.NotificationSnapshot(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				fact := notificationFact(t, got, problem)
				if fact.Identity != f.key(problem) || !fact.Active || !fact.Eligible || fact.Recovered || got.NetworkRevision != 7 {
					t.Fatalf("durable gate not retained: %+v revision=%d", fact, got.NetworkRevision)
				}
				raw, _ := json.Marshal(got)
				for _, secret := range []string{"PRIVATE_MESSAGE_MARKER", f.device.path, f.state.Hive, f.state.Identity.OwnerID, strings.Repeat("a", 64), "fingerprint", "message", "owner", "credential"} {
					if bytes.Contains(raw, []byte(secret)) {
						t.Fatalf("notification DTO exposed forbidden input: marker=%s", secret)
					}
				}
			}
			after, _ := os.ReadFile(f.path)
			snapshotAfter, _ := json.Marshal(f.accounts.platforms["openai"].snapshot)
			if !bytes.Equal(before, after) || !bytes.Equal(snapshotBefore, snapshotAfter) {
				t.Fatal("notification read changed S1 state/pulse")
			}
		})
	}
}
func TestDesktopNotificationsNeverRecomputeOfflineThreshold(t *testing.T) {
	f := newNotificationFixture(t)
	f.notice(t, "offline", false)
	got, err := f.accounts.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	fact := notificationFact(t, got, "offline")
	if !fact.Active || fact.Eligible || fact.Recovered {
		t.Fatalf("old first_seen bypassed S1 Notified=false: %+v", fact)
	}
	f.accounts.platforms["openai"].snapshot.Issues[0].Notify = true
	got, err = f.accounts.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if notificationFact(t, got, "offline").Eligible {
		t.Fatal("one-observation Notify pulse replaced durable Notified gate")
	}
}

func TestDesktopNotificationsReuseActualS1OfflineGateAndRecovery(t *testing.T) {
	f := newNotificationFixture(t)
	clock := f.now
	f.accounts.now = func() time.Time { return clock }
	p := f.accounts.platforms["openai"]
	binding := *p.binding
	p.snapshot.Hive = DesktopAccountHiveFact{DesktopAccountFact: DesktopAccountFact{State: "unconfirmed", Error: accountFailure("openai", "unconfirmed", "fixture", "offline")}}
	for index, advance := range []time.Duration{0, 59 * time.Second, time.Second} {
		clock = clock.Add(advance)
		f.accounts.accountIssues(p, "openai", f.device.path, binding, []string{"offline"}, false)
		got, err := f.accounts.NotificationSnapshot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		fact := notificationFact(t, got, "offline")
		if !fact.Active || fact.Eligible != (index == 2) || fact.Recovered {
			t.Fatalf("S1 gate step=%d fact=%+v", index, fact)
		}
	}
	p.snapshot.Hive = DesktopAccountHiveFact{DesktopAccountFact: DesktopAccountFact{State: "ready", Fingerprint: accountString(binding.fingerprint), ObservedAt: accountTime(clock)}}
	p.snapshot.CheckedAt = accountTime(clock)
	f.accounts.accountIssues(p, "openai", f.device.path, binding, nil, true)
	got, err := f.accounts.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	fact := notificationFact(t, got, "offline")
	if fact.Active || fact.Eligible || !fact.Recovered {
		t.Fatalf("S1 positive recovery not reused: %+v", fact)
	}
	f.accounts.accountIssues(p, "openai", f.device.path, binding, []string{"offline"}, false)
	got, err = f.accounts.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	fact = notificationFact(t, got, "offline")
	if !fact.Active || fact.Eligible || fact.Recovered {
		t.Fatalf("recurrent offline skipped S1 first_seen gate: %+v", fact)
	}
}

func TestDesktopNotificationsReadDoesNotInvalidateOfficialCacheOrPublishUnselectedSource(t *testing.T) {
	f := newNotificationFixture(t)
	f.notice(t, "authorization_rejected", true)
	p := f.accounts.platforms["openai"]
	p.networkRevision = 1
	p.official = &desktopOfficialObservation{}
	p.snapshot.Candidate.IdentityVerified = true
	before, _ := json.Marshal(p.snapshot)
	if _, err := f.accounts.NotificationSnapshot(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(p.snapshot)
	if !bytes.Equal(before, after) || p.official == nil || p.networkRevision != 1 {
		t.Fatal("notification read invalidated official cache")
	}
	disk, err := readDesktopAccountState(f.path)
	if err != nil {
		t.Fatal(err)
	}
	key := desktopScopeKey(f.state.Hive, f.state.Identity.OwnerID, f.state.Identity.ID)
	scope := disk.Scopes[key]
	delete(scope.Selections, "openai")
	disk.Scopes[key] = scope
	if err := saveDesktopAccountState(f.path, disk, disk.Revision); err != nil {
		t.Fatal(err)
	}
	got, err := f.accounts.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Facts) != 0 {
		t.Fatal("in-memory stale selection escaped current persisted scope")
	}
}
func TestDesktopNotificationsMissingIssueDoesNotMeanRecovered(t *testing.T) {
	f := newNotificationFixture(t)
	f.notice(t, "authorization_rejected", true)
	p := f.accounts.platforms["openai"]
	p.snapshot.Issues = nil
	p.snapshot.Hive.State = "unconfirmed"
	p.snapshot.Hive.Error = accountFailure("openai", "unconfirmed", "fixture", "PRIVATE_ERROR_MARKER")
	got, err := f.accounts.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	fact := notificationFact(t, got, "authorization_rejected")
	if fact.Active || fact.Eligible || fact.Recovered {
		t.Fatalf("missing issue invented recovery: %+v", fact)
	}
	p.snapshot.Hive.State = "ready"
	p.snapshot.Hive.Error = nil
	got, err = f.accounts.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !notificationFact(t, got, "authorization_rejected").Recovered {
		t.Fatal("positive S1 recovery was not exposed")
	}
}
func TestDesktopNotificationsUnboundStaleMismatchedAndWorkingFactsFailClosed(t *testing.T) {
	for _, scenario := range []string{"binding_missing", "wrong_owner", "wrong_device", "wrong_hive", "wrong_binding_fingerprint", "wrong_selection", "wrong_issue_fingerprint", "wrong_issue_platform", "missing_observed", "missing_checked", "old_checked", "future_observed", "working", "pending", "storage_unconfirmed"} {
		t.Run(scenario, func(t *testing.T) {
			f := newNotificationFixture(t)
			f.notice(t, "authorization_rejected", true)
			p := f.accounts.platforms["openai"]
			switch scenario {
			case "binding_missing":
				p.binding = nil
			case "wrong_owner":
				p.binding.owner = "different-owner"
			case "wrong_device":
				p.binding.device = "different-device"
			case "wrong_hive":
				p.binding.hive = "https://different.example"
			case "wrong_binding_fingerprint":
				p.binding.fingerprint = strings.Repeat("c", 64)
			case "wrong_selection":
				p.snapshot.Selection.Fingerprint = accountString(strings.Repeat("c", 64))
			case "wrong_issue_fingerprint":
				p.snapshot.Issues[0].Fingerprint = accountString(strings.Repeat("c", 64))
			case "wrong_issue_platform":
				p.snapshot.Issues[0].Platform = "claude"
			case "missing_observed":
				p.snapshot.Hive.ObservedAt = nil
			case "missing_checked":
				p.snapshot.CheckedAt = nil
			case "old_checked":
				p.snapshot.CheckedAt = accountTime(f.now.Add(-beewire.CapabilityLifetimeFor("openai")))
			case "future_observed":
				p.snapshot.Hive.ObservedAt = accountTime(f.now.Add(time.Second))
			case "working":
				p.working = true
			case "pending":
				p.pending = &desktopPendingOperation{}
			case "storage_unconfirmed":
				p.snapshot.Issues = append(p.snapshot.Issues, DesktopAccountIssue{Code: "notice_storage_unconfirmed", Platform: "openai"})
			}
			got, err := f.accounts.NotificationSnapshot(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			fact := notificationFact(t, got, "authorization_rejected")
			if fact.Active || fact.Eligible || fact.Recovered {
				t.Fatalf("uncertain %s emitted actionable fact: %+v", scenario, fact)
			}
		})
	}
}
func TestDesktopNotificationsReadFailureAndInitialStateNeverInventRecovery(t *testing.T) {
	f := newNotificationFixture(t)
	p := f.accounts.platforms["openai"]
	p.snapshot.Hive = initialAccountSnapshot("openai").Hive
	p.snapshot.CheckedAt = nil
	got, err := f.accounts.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, fact := range got.Facts {
		if fact.Active || fact.Eligible || fact.Recovered {
			t.Fatal("initial state invented recovery")
		}
	}
	raw := []byte(`{"version":999,"PRIVATE_FIELD_MARKER":"PRIVATE_VALUE_MARKER"}`)
	if err := os.WriteFile(f.path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	got, err = f.accounts.NotificationSnapshot(context.Background())
	if err == nil {
		t.Fatal("corrupt S1 persistence treated as trusted empty state")
	}
	for _, fact := range got.Facts {
		if fact.Active || fact.Eligible || fact.Recovered {
			t.Fatal("corrupt storage emitted actionable fact")
		}
	}
	if strings.Contains(err.Error(), "PRIVATE_") || strings.Contains(err.Error(), f.device.path) {
		t.Fatal("failure exposed private values/path")
	}
	after, _ := os.ReadFile(f.path)
	if !bytes.Equal(after, raw) {
		t.Fatal("read failure rewrote original")
	}
}
func TestDesktopNotificationsUnselectedAndCancelledDoNotLoadCredentials(t *testing.T) {
	a := NewDesktopAccounts(nil)
	defer a.Close()
	snapshot, err := a.NotificationSnapshot(context.Background())
	if err != nil || snapshot.Facts == nil || len(snapshot.Facts) != 0 {
		t.Fatalf("unbound snapshot=%+v error=%v", snapshot, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := a.NotificationSnapshot(ctx); err == nil {
		t.Fatal("canceled notification read accepted")
	}
}

// A real S1 publication must carry its already-verified scope binding alongside
// the observed public issues. The notification reader must not infer it.
func TestDesktopNotificationsRuntimePublicationRetainsVerifiedBinding(t *testing.T) {
	var account beewire.PlatformAccount
	d := desktopRuntimeDeviceFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if desktopSupplyServeIdentity(w, r) {
			return
		}
		if strings.HasSuffix(r.URL.Path, "/account") {
			json.NewEncoder(w).Encode(account)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/capabilities") {
			json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
			return
		}
		t.Errorf("unexpected runtime observation method=%s", r.Method)
		w.WriteHeader(404)
	})
	a := NewDesktopAccounts(d)
	defer a.Close()
	desktopRuntimeSelectionFixture(t, d, a)
	state, err := readState(d.path)
	if err != nil {
		t.Fatal(err)
	}
	session, release, err := d.acquireSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	p := a.platforms["openai"]
	if err := a.loadSelection(p, session, state, "openai"); err != nil {
		t.Fatal(err)
	}
	account = beewire.PlatformAccount{Platform: "openai", Status: "authorization_rejected", Generation: p.selected.Generation, AccountFingerprint: p.selected.Fingerprint, CredentialRevision: p.selected.CredentialRevision}
	runtime := NewDesktopRuntime(context.Background(), d, a)
	defer runtime.Close()
	slot := runtime.slots["openai"]
	slot.selection = *p.selected
	if err := runtime.observeSynchronizedPlatform(context.Background(), state, "openai", slot); err == nil {
		t.Fatal("authorization-rejected source unexpectedly synchronized")
	}
	got, err := a.NotificationSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	fact := notificationFact(t, got, "authorization_rejected")
	if !fact.Active || !fact.Eligible || fact.Recovered {
		t.Fatalf("real runtime observation lost verified notification binding: %+v", fact)
	}
}
