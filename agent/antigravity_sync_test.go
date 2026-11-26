package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

// antigravityHive is a synthetic Hive for one Google account: it hands out
// one maintenance task and opens whatever is sealed to its inbox key.
type antigravityHive struct {
	*httptest.Server
	inbox   *tee.InboxKey
	task    *beewire.MaintenanceTask
	account beewire.PlatformAccount
	// maintained is the last maintenance request; registered the last upload
	// and sealed the secret inside it.
	maintained       beewire.MaintenanceRequest
	registered       beewire.CredentialRegistration
	sealed           tee.Secret
	uploads, stops   atomic.Int32
	maintenances     atomic.Int32
	failUploads      int32
	beforeKey        func()
	beforeUpload     func()
	capabilityReport func(beewire.CapabilityReport) int
}

func newAntigravityHive(t *testing.T, credential antigravityCredential, kind string) *antigravityHive {
	t.Helper()
	inbox, err := tee.GenerateInboxKey()
	if err != nil {
		t.Fatal(err)
	}
	auth := credential.metadata()
	hive := &antigravityHive{inbox: inbox, account: beewire.PlatformAccount{Platform: beewire.GooglePlatform, Generation: 1, Status: "source_unavailable"}}
	if kind != "" {
		hive.task = &beewire.MaintenanceTask{ID: "google-task", Kind: kind, DeviceID: "device", Platform: beewire.GooglePlatform, AccountFingerprint: auth.AccountFingerprint, AccountGeneration: 1, CredentialRevision: auth.CredentialRevision, KeyVersion: 1, Key: inbox.Public()}
	} else {
		hive.account.Status = "ready"
	}
	hive.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer bee-test" {
			t.Error("device authentication missing")
		}
		body, _ := io.ReadAll(r.Body)
		for _, secret := range []string{"synthetic-google-access", "synthetic-google-refresh", "synthetic-renewed-access", "example.test"} {
			if bytes.Contains(body, []byte(secret)) {
				t.Errorf("%s carries %q in the clear", r.URL.Path, secret)
			}
		}
		switch r.URL.Path {
		case "/api/bee/platforms/google/account":
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: beewire.GooglePlatform, Generation: 1, CredentialRevision: auth.CredentialRevision})
		case "/api/bee/platforms/google/account/source":
			hive.stops.Add(1)
			io.WriteString(w, `{}`)
		case "/api/bee/maintenance":
			hive.maintenances.Add(1)
			hive.maintained = beewire.MaintenanceRequest{}
			if json.Unmarshal(body, &hive.maintained) != nil || hive.maintained.Antigravity == nil || hive.maintained.Claude != nil || hive.maintained.Codex != (beewire.Authorization{}) || hive.maintained.Lease != "lease" {
				t.Errorf("maintenance request mixed platforms: %s", body)
			}
			if platform, _, ok := hive.maintained.Authorization(); platform != beewire.GooglePlatform || !ok {
				t.Errorf("maintenance request is not a valid Google authorization: %s", body)
			}
			json.NewEncoder(w).Encode(beewire.MaintenanceResponse{Account: hive.account, Task: hive.task})
		case "/api/bee/credential-key":
			if hive.beforeKey != nil {
				hive.beforeKey()
			}
			json.NewEncoder(w).Encode(inbox.Public())
		case "/api/bee/credentials":
			if hive.beforeUpload != nil {
				hive.beforeUpload()
			}
			hive.registered = beewire.CredentialRegistration{}
			if json.Unmarshal(body, &hive.registered) != nil || hive.registered.Antigravity == nil || hive.registered.Claude != nil || hive.registered.Codex != nil || hive.registered.TaskID != hive.task.ID {
				t.Errorf("credential upload mixed platforms or lost its task: %s", body)
			}
			opened, provider, err := inbox.Open(hive.registered.Envelope)
			if err != nil || provider != beewire.ProviderID("device") {
				t.Error("the envelope does not open with the inbox key for this device", err)
			}
			hive.sealed = opened
			if hive.uploads.Add(1) <= hive.failUploads {
				w.WriteHeader(503)
				return
			}
			json.NewEncoder(w).Encode(map[string]int{"account_generation": 1})
		case "/api/bee/platforms/google/capabilities":
			var report beewire.CapabilityReport
			if json.Unmarshal(body, &report) != nil {
				t.Errorf("capability report: %s", body)
			}
			if hive.capabilityReport == nil {
				t.Error("unexpected capability report")
				w.WriteHeader(500)
				return
			}
			w.WriteHeader(hive.capabilityReport(report))
			io.WriteString(w, `{}`)
		default:
			t.Error("unexpected Hive request", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(hive.Close)
	return hive
}

func (hive *antigravityHive) state() localState {
	return localState{Hive: hive.URL, Credential: "bee-test", Identity: &beewire.Identity{ID: "device"}}
}

func TestAntigravityRuntimeSynchronizesOnlyTheStoredAccessToken(t *testing.T) {
	for _, scenario := range []string{"ready", "upload_retry", "changed_before_upload", "expired_before_upload", "wrong_task_platform", "wrong_task_revision", "wrong_task_device", "wrong_recipient", "source_missing", "sign_in_rejected", "expired_without_refresh"} {
		t.Run(scenario, func(t *testing.T) {
			credential := antigravitySample(time.Now().Add(time.Hour))
			switch scenario {
			case "sign_in_rejected":
				credential.Rejected = "invalid_grant"
			case "expired_without_refresh":
				credential.RefreshToken, credential.ExpiresAt = "", time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
			}
			directory, store := antigravityFixture(t, credential)
			hive := newAntigravityHive(t, credential, "reencrypt_authorization")
			switch scenario {
			case "upload_retry":
				hive.failUploads = 1
			case "changed_before_upload", "expired_before_upload":
				hive.beforeKey = func() {
					changed := credential
					if scenario == "changed_before_upload" {
						changed.AccessToken = "ya29.synthetic-other-access"
					} else {
						changed.ExpiresAt = time.Now().Add(-time.Minute).UTC().Truncate(time.Second)
					}
					if err := store.write(changed); err != nil {
						t.Error(err)
					}
				}
			case "wrong_task_platform":
				hive.task.Platform = "claude"
			case "wrong_task_revision":
				hive.task.CredentialRevision = strings.Repeat("f", 64)
			case "wrong_task_device":
				hive.task.DeviceID = "another-device"
			case "wrong_recipient":
				other, _ := tee.GenerateInboxKey()
				hive.task.Key = other.Public()
			case "source_missing":
				directory = t.TempDir()
			}
			// Bee wrote the sign-in itself: synchronizing it asks Google nothing.
			source := &antigravitySource{directory: directory, transport: &googleFake{t: t}}
			var output bytes.Buffer
			err := source.synchronize(context.Background(), hive.state(), "lease", &output, true)
			if scenario == "upload_retry" {
				if err == nil {
					t.Fatal("upload error hidden")
				}
				err = source.synchronize(context.Background(), hive.state(), "lease", &output, false)
			}
			switch scenario {
			case "ready", "upload_retry":
				want := int32(1)
				if scenario == "upload_retry" {
					want = 2
				}
				if err != nil || hive.uploads.Load() != want || hive.stops.Load() != 0 {
					t.Fatal("synchronization or retry failed", err, hive.uploads.Load(), hive.stops.Load())
				}
				if hive.sealed != (tee.Secret{Token: antigravityTestAccess, Header: "authorization", Scheme: "Bearer"}) {
					t.Fatal("the envelope does not hold the access token as a Bearer secret")
				}
				auth := credential.metadata()
				if got := hive.registered.Antigravity; *got != auth || got.ProjectID != "synthetic-project-1" || got.AccountID != antigravityTestUser {
					t.Fatalf("registration %+v", got)
				}
				if got := hive.maintained; *got.Antigravity != auth || !got.RefreshSupported || got.RefreshRequired || got.ExpectedGeneration != 1 || got.ExpectedRevision != auth.CredentialRevision {
					t.Fatalf("maintenance request %+v", got)
				}
				if !strings.Contains(output.String(), "Google authorization synchronized") {
					t.Fatal("readiness not announced", output.String())
				}
			case "wrong_task_platform", "wrong_task_revision", "wrong_task_device", "wrong_recipient":
				if err == nil || hive.uploads.Load() != 0 {
					t.Fatal("invalid task or key was accepted")
				}
			default:
				if err != nil || hive.uploads.Load() != 0 || hive.stops.Load() != 1 {
					t.Fatal("unusable sign-in was not reported unavailable", err, hive.stops.Load())
				}
				if scenario == "sign_in_rejected" && !strings.Contains(output.String(), "bee antigravity-login") {
					t.Fatal("the Provider is not told to sign in again", output.String())
				}
			}
			assertNoAntigravitySecrets(t, output.String())
		})
	}
}

func TestAntigravityRuntimeHonoursHiveAccountStates(t *testing.T) {
	for status, want := range map[string]string{"account_in_use": "registered to another Provider", "confirmation_required": "bee account-status --platform google", "source_unavailable": "maintenance incomplete"} {
		credential := antigravitySample(time.Now().Add(time.Hour))
		directory, _ := antigravityFixture(t, credential)
		hive := newAntigravityHive(t, credential, "")
		hive.account.Status = status
		source := &antigravitySource{directory: directory, Capabilities: true, transport: &googleFake{t: t}}
		var output bytes.Buffer
		if err := source.synchronize(context.Background(), hive.state(), "lease", &output, true); err != nil || !strings.Contains(output.String(), want) || hive.uploads.Load() != 0 || hive.stops.Load() != 0 {
			t.Fatalf("%s: %v %s", status, err, output.String())
		}
	}
}

// An unavailable sign-in is reported to Hive once, not with every cycle, and
// a new sign-in is picked up by the next one.
func TestAntigravityRuntimeNoticesANewSignIn(t *testing.T) {
	directory := t.TempDir()
	credential := antigravitySample(time.Now().Add(time.Hour))
	hive := newAntigravityHive(t, credential, "reencrypt_authorization")
	source := &antigravitySource{directory: directory}
	var output bytes.Buffer
	for cycle := range 4 {
		if err := source.synchronize(context.Background(), hive.state(), "lease", &output, cycle == 0); err != nil {
			t.Fatal(err)
		}
	}
	if hive.stops.Load() != 1 || hive.maintenances.Load() != 0 || !strings.Contains(output.String(), "bee antigravity-login") {
		t.Fatalf("an absent sign-in was reported %d times: %s", hive.stops.Load(), output.String())
	}
	if err := antigravityStoreIn(directory).write(credential); err != nil {
		t.Fatal(err)
	}
	if err := source.synchronize(context.Background(), hive.state(), "lease", &output, false); err != nil || hive.uploads.Load() != 1 {
		t.Fatal("the new sign-in was not synchronized by the next cycle", err)
	}
}

const antigravityRefreshedTokens = `{"access_token":"ya29.synthetic-renewed-access","expires_in":3599,"scope":"openid","token_type":"Bearer"}`

func TestAntigravityRefreshSavesTheNewTokenBeforeUploadingIt(t *testing.T) {
	// The token Hive asks to have refreshed has already run out.
	credential := antigravitySample(time.Now().Add(-time.Minute))
	directory, store := antigravityFixture(t, credential)
	hive := newAntigravityHive(t, credential, "refresh_authorization")
	google := &googleFake{t: t, answer: map[string]func(*http.Request, string) (int, string){
		googleTokenURL: func(r *http.Request, body string) (int, string) {
			form := googleForm(t, body)
			if form.Get("grant_type") != "refresh_token" || form.Get("refresh_token") != credential.RefreshToken || form.Get("client_id") != antigravityClientID || form.Get("client_secret") != antigravityClientSecret {
				t.Errorf("refresh request %v", form)
			}
			return 200, antigravityRefreshedTokens
		},
		// The subscription changed since the sign-in: the account is Ultra now.
		googleProd + "loadCodeAssist": func(r *http.Request, _ string) (int, string) {
			if r.Header.Get("Authorization") != "Bearer ya29.synthetic-renewed-access" {
				t.Error("the account was asked about with the old token")
			}
			return 200, `{"cloudaicompanionProject":"synthetic-project-2","paidTier":{"id":"g1-ultra-tier"}}`
		},
	}}
	hive.beforeUpload = func() {
		if saved, err := store.read(); err != nil || saved.AccessToken != "ya29.synthetic-renewed-access" {
			t.Error("the refreshed token reached Hive before it was saved")
		}
	}
	source := &antigravitySource{directory: directory, transport: google}
	var output bytes.Buffer
	if err := source.synchronize(context.Background(), hive.state(), "lease", &output, true); err != nil {
		t.Fatal(err)
	}
	saved, err := store.read()
	if err != nil || saved.AccessToken != "ya29.synthetic-renewed-access" || saved.RefreshToken != credential.RefreshToken || saved.UserID != antigravityTestUser ||
		saved.Plan != "ultra" || saved.Tier != "g1-ultra-tier" || saved.ProjectID != "synthetic-project-2" || !saved.available(time.Now()) {
		t.Fatalf("saved sign-in after refresh: plan=%s project=%s err=%v", saved.Plan, saved.ProjectID, err)
	}
	if hive.maintained.Antigravity.CredentialRevision != antigravityDigest(antigravityTestAccess) || !hive.maintained.RefreshSupported {
		t.Fatal("the expired token was not what Hive was told about")
	}
	if hive.uploads.Load() != 1 || hive.sealed.Token != "ya29.synthetic-renewed-access" || hive.registered.TaskID != "google-task" || *hive.registered.Antigravity != saved.metadata() || hive.registered.Antigravity.ProjectID != "synthetic-project-2" {
		t.Fatalf("upload after refresh: %+v", hive.registered.Antigravity)
	}
	if hive.stops.Load() != 0 || google.count(googleTokenURL) != 1 {
		t.Fatal("refresh was repeated or the source suspended")
	}
	assertNoAntigravitySecrets(t, output.String())
	if strings.Contains(output.String(), "synthetic-renewed-access") {
		t.Fatal("output exposes the refreshed token")
	}
}

func TestAntigravityRefreshKeepsProjectAndPlanWhenGoogleDoesNotSay(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Minute))
	directory, store := antigravityFixture(t, credential)
	hive := newAntigravityHive(t, credential, "refresh_authorization")
	google := &googleFake{t: t, answer: map[string]func(*http.Request, string) (int, string){
		googleTokenURL:                 googleAnswer(200, antigravityRefreshedTokens),
		googleProd + "loadCodeAssist":  googleAnswer(503, `{"error":{"code":503}}`),
		googleDaily + "loadCodeAssist": googleAnswer(500, `{"error":{"code":500}}`),
	}}
	source := &antigravitySource{directory: directory, transport: google}
	if err := source.synchronize(context.Background(), hive.state(), "lease", io.Discard, true); err != nil {
		t.Fatal(err)
	}
	if saved, _ := store.read(); saved.AccessToken != "ya29.synthetic-renewed-access" || saved.ProjectID != credential.ProjectID || saved.Plan != "pro" || hive.uploads.Load() != 1 {
		t.Fatalf("project or plan lost with the account query: %s %s", saved.ProjectID, saved.Plan)
	}
}

// Google ends a sign-in by refusing its refresh token. The refusal is
// recorded, the source reported unavailable, and Google not asked again.
func TestAntigravityRefreshRecordsASignInGoogleEnded(t *testing.T) {
	for _, answer := range antigravityRejections {
		t.Run(answer, func(t *testing.T) {
			credential := antigravitySample(time.Now().Add(time.Minute))
			directory, store := antigravityFixture(t, credential)
			hive := newAntigravityHive(t, credential, "refresh_authorization")
			google := &googleFake{t: t, answer: map[string]func(*http.Request, string) (int, string){
				googleTokenURL: googleAnswer(400, `{"error":"`+answer+`","error_description":"Token has been expired or revoked."}`),
			}}
			source := &antigravitySource{directory: directory, transport: google}
			var output bytes.Buffer
			for cycle := range 3 {
				if err := source.synchronize(context.Background(), hive.state(), "lease", &output, cycle == 0); err != nil {
					t.Fatal(err)
				}
			}
			if hive.stops.Load() != 1 || hive.uploads.Load() != 0 || google.count(googleTokenURL) != 1 || hive.maintenances.Load() != 1 {
				t.Fatalf("stops=%d uploads=%d refreshes=%d maintenances=%d", hive.stops.Load(), hive.uploads.Load(), google.count(googleTokenURL), hive.maintenances.Load())
			}
			saved, err := store.read()
			if err != nil || saved.Rejected != answer || saved.AccessToken != credential.AccessToken {
				t.Fatal("the refusal was not recorded with the sign-in", err, saved.Rejected)
			}
			if !strings.Contains(output.String(), "run bee antigravity-login to sign in again") {
				t.Fatal("the Provider is not told to sign in again", output.String())
			}
			if code, _, _, _ := Coded(antigravityStoredProblem(saved)); code != "BEE-ANTIGRAVITY-SIGNIN" {
				t.Fatal("doctor would not name the ended sign-in", code)
			}
			// A Bee started afterwards does not offer the dead token either.
			restarted := &antigravitySource{directory: directory, transport: google}
			if err := restarted.synchronize(context.Background(), hive.state(), "lease", &output, true); err != nil || google.count(googleTokenURL) != 1 {
				t.Fatal("a restart repeated the refused refresh", err)
			}
			assertNoAntigravitySecrets(t, output.String())
		})
	}
}

// A refresh Google did not answer leaves the sign-in as it was; the next task
// repeats it, but not with every cycle.
func TestAntigravityRefreshFailureIsRetriedLater(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Minute))
	directory, store := antigravityFixture(t, credential)
	hive := newAntigravityHive(t, credential, "refresh_authorization")
	status := 0
	google := &googleFake{t: t, answer: map[string]func(*http.Request, string) (int, string){
		googleTokenURL: func(*http.Request, string) (int, string) {
			if status == 200 {
				return 200, antigravityRefreshedTokens
			}
			return status, `{"error":"internal_failure","error_description":"synthetic outage 1//synthetic-google-refresh"}`
		},
		googleProd + "loadCodeAssist": googleAnswer(200, antigravityTestLoad),
	}}
	source := &antigravitySource{directory: directory, transport: google}
	for _, status = range []int{0, 500} {
		source.refreshFailed.retryAt = time.Time{}
		err := source.synchronize(context.Background(), hive.state(), "lease", io.Discard, true)
		if err == nil || strings.Contains(err.Error(), "synthetic-google-refresh") || errors.Is(err, errAntigravitySignIn) {
			t.Fatalf("status %d: %v", status, err)
		}
	}
	if err := source.synchronize(context.Background(), hive.state(), "lease", io.Discard, false); err == nil || !strings.Contains(err.Error(), "trying again in") || google.count(googleTokenURL) != 2 {
		t.Fatal("a failed refresh was repeated at once", err)
	}
	if saved, _ := store.read(); !saved.same(credential) || hive.stops.Load() != 0 || hive.uploads.Load() != 0 {
		t.Fatal("a failed refresh changed the sign-in or suspended the source")
	}
	status, source.refreshFailed.retryAt = 200, time.Now().Add(-time.Second)
	if err := source.synchronize(context.Background(), hive.state(), "lease", io.Discard, false); err != nil || hive.uploads.Load() != 1 || hive.sealed.Token != "ya29.synthetic-renewed-access" {
		t.Fatal("the refresh was not repeated once Google answered", err)
	}
}

func TestAntigravityRefreshRefusesATaskForAnotherSignIn(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Minute))
	directory, store := antigravityFixture(t, credential)
	source := &antigravitySource{directory: directory, transport: &googleFake{t: t}}
	auth := credential.metadata()
	task := beewire.MaintenanceTask{ID: "google-task", Kind: "refresh_authorization", Platform: beewire.GooglePlatform, AccountFingerprint: auth.AccountFingerprint, CredentialRevision: strings.Repeat("0", 64)}
	if _, err := source.refresh(context.Background(), task); !errors.Is(err, errAntigravitySourceChanged) {
		t.Fatal("a task for another token was carried out", err)
	}
	task.CredentialRevision, task.AccountFingerprint = auth.CredentialRevision, strings.Repeat("0", 64)
	if _, err := source.refresh(context.Background(), task); !errors.Is(err, errAntigravitySourceChanged) {
		t.Fatal("a task for another account was carried out", err)
	}
	// While another process writes the sign-in, the task waits its turn.
	unlock, err := store.lock(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	task.AccountFingerprint = auth.AccountFingerprint
	if _, err := source.refresh(ctx, task); !errors.Is(err, errAntigravityLock) {
		t.Fatal("a refresh ran beside another writer", err)
	}
}
