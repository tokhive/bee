package bee

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

const (
	antigravityTestUser   = "112233445566778899001"
	antigravityTestAccess = "ya29.synthetic-google-access"
	// A Pro account: served from the daily endpoint.
	antigravityTestLoad = `{"cloudaicompanionProject":"synthetic-project-1","currentTier":{"id":"free-tier","name":"Antigravity"},"paidTier":{"id":"g1-pro-tier","name":"Google AI Pro"},"allowedTiers":[{"id":"free-tier","isDefault":true}]}`
)

// antigravitySample is a sign-in as antigravity-login stores it.
func antigravitySample(expires time.Time) antigravityCredential {
	return antigravityCredential{AccessToken: antigravityTestAccess, RefreshToken: "1//synthetic-google-refresh", ExpiresAt: expires.UTC().Truncate(time.Second),
		UserID: antigravityTestUser, Email: "provider@example.test", ProjectID: "synthetic-project-1", Tier: "g1-pro-tier", Plan: "pro"}
}

func antigravityFixture(t *testing.T, credential antigravityCredential) (string, antigravityStore) {
	t.Helper()
	directory := t.TempDir()
	store := antigravityStoreIn(directory)
	if err := store.write(credential); err != nil {
		t.Fatal(err)
	}
	return directory, store
}

// googleFake answers Bee's requests to Google by address. A request to an
// address the test did not expect fails the test.
type googleFake struct {
	t      *testing.T
	mu     sync.Mutex
	calls  []string
	answer map[string]func(r *http.Request, body string) (int, string)
}

func (f *googleFake) RoundTrip(r *http.Request) (*http.Response, error) {
	body := ""
	if r.Body != nil {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
	}
	address := r.URL.Scheme + "://" + r.URL.Host + r.URL.Path
	f.mu.Lock()
	f.calls = append(f.calls, address)
	answer := f.answer[address]
	f.mu.Unlock()
	if answer == nil {
		f.t.Errorf("unexpected request to %s", address)
		return nil, errors.New("unexpected request")
	}
	status, text := answer(r, body)
	if status == 0 {
		return nil, errors.New("synthetic connection failure")
	}
	return &http.Response{StatusCode: status, Status: http.StatusText(status), Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(text)), Request: r}, nil
}

func (f *googleFake) count(address string) (n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, call := range f.calls {
		if call == address {
			n++
		}
	}
	return n
}

func googleAnswer(status int, body string) func(*http.Request, string) (int, string) {
	return func(*http.Request, string) (int, string) { return status, body }
}

const (
	googleTokenURL = "https://oauth2.googleapis.com/token"
	googleUserURL  = "https://www.googleapis.com/oauth2/v2/userinfo"
	googleProd     = "https://cloudcode-pa.googleapis.com/v1internal:"
	googleDaily    = "https://daily-cloudcode-pa.googleapis.com/v1internal:"
)

func TestAntigravityPlanFollowsTheTier(t *testing.T) {
	for tier, want := range map[string]string{
		"": "free", "free-tier": "free", " Free-Tier ": "free",
		"g1-pro-tier": "pro", "g1-pro-plus-tier": "pro",
		"g1-ultra-tier": "ultra", "g1-ultra-lite-tier": "ultra",
		"standard-tier": "", "legacy-tier": "", "g1-pro": "", "g1-ultra-tier-x": "", "pro": "",
	} {
		if got := antigravityPlan(tier); got != want {
			t.Errorf("tier %q: plan %q, want %q", tier, got, want)
		}
		if want != "" && !beewire.KnownPlan(beewire.GooglePlatform, want) {
			t.Errorf("plan %q is not one Hive accepts for Google", want)
		}
	}
}

func TestAntigravityAuthorizationNamesAccountProjectAndRevision(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Hour))
	auth := credential.metadata()
	if auth.AccountID != antigravityTestUser || auth.AccountFingerprint != antigravityDigest("google\x00"+antigravityTestUser) || auth.CredentialRevision != antigravityDigest(antigravityTestAccess) || auth.ProjectID != "synthetic-project-1" || !auth.ExpiresAt.Equal(credential.ExpiresAt) {
		t.Fatalf("authorization %+v", auth)
	}
	request := beewire.MaintenanceRequest{Lease: "lease", Antigravity: &auth}
	if platform, _, ok := request.Authorization(); platform != beewire.GooglePlatform || !ok {
		t.Fatal("the authorization is not one Hive accepts for Google")
	}
	raw, _ := json.Marshal(request)
	for _, private := range []string{antigravityTestAccess, credential.RefreshToken, credential.Email} {
		if strings.Contains(string(raw), private) {
			t.Fatalf("authorization metadata carries a token or the email: %s", raw)
		}
	}
	if text := credential.String(); strings.Contains(text, "synthetic") {
		t.Fatal("a formatted credential shows its content")
	}
	if credential.base() != "https://daily-cloudcode-pa.googleapis.com" || (antigravityCredential{Plan: "free"}).base() != "https://cloudcode-pa.googleapis.com" {
		t.Fatal("an account is not on the endpoint of its plan")
	}
}

func TestAntigravityStoreIsPrivateAndRefusesLinks(t *testing.T) {
	credential := antigravitySample(time.Now().Add(time.Hour))
	directory, store := antigravityFixture(t, credential)
	if store.path != filepath.Join(directory, "accounts", "antigravity", "credentials.json") {
		t.Fatal("store is not under the accounts directory", store.path)
	}
	read, err := store.read()
	if err != nil || !read.same(credential) || read.metadata() != credential.metadata() {
		t.Fatalf("stored sign-in did not read back: %v", err)
	}
	if runtime.GOOS != "windows" {
		assertPrivateTestFile(t, store.path)
		for _, private := range []string{filepath.Dir(store.path), filepath.Dir(filepath.Dir(store.path))} {
			if info, err := os.Stat(private); err != nil || info.Mode().Perm() != 0700 {
				t.Fatalf("%s is not private: %v", private, info.Mode())
			}
		}
	}
	entries, _ := os.ReadDir(filepath.Dir(store.path))
	if len(entries) != 1 {
		t.Fatalf("a write left more than the store behind: %v", entries)
	}

	// A second write replaces the file whole.
	credential.AccessToken = "ya29.synthetic-second-access"
	if err := store.write(credential); err != nil {
		t.Fatal(err)
	}
	if read, err = store.read(); err != nil || read.AccessToken != credential.AccessToken {
		t.Fatal("replacement not read back", err)
	}

	if err := store.write(antigravityCredential{AccessToken: "ya29.synthetic"}); err == nil {
		t.Fatal("an incomplete sign-in was stored")
	}
	if _, err := antigravityStoreIn(t.TempDir()).read(); !errors.Is(err, errAntigravityMissing) {
		t.Fatal("a missing store is not reported as no sign-in", err)
	}
	for name, content := range map[string]string{"not JSON": "{", "incomplete": `{"access_token":"ya29.synthetic"}`, "oversized": strings.Repeat(" ", 65537)} {
		if err := writeTestPrivateFile(store.path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := store.read(); !errors.Is(err, errAntigravityUnreadable) || strings.Contains(err.Error(), "synthetic") {
			t.Fatalf("%s store: %v", name, err)
		}
	}
	if runtime.GOOS == "windows" {
		return
	}
	raw, _ := json.Marshal(credential)
	if err := writeTestPrivateFile(store.path, raw, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.read(); !errors.Is(err, errAntigravityUnreadable) {
		t.Fatal("a store other users can read was accepted", err)
	}

	// Neither the file nor its directory may be a link to somewhere else.
	elsewhere := filepath.Join(t.TempDir(), "elsewhere.json")
	if err := writeTestPrivateFile(elsewhere, raw, 0600); err != nil {
		t.Fatal(err)
	}
	os.Remove(store.path)
	if err := os.Symlink(elsewhere, store.path); err != nil {
		t.Fatal(err)
	}
	if _, err := store.read(); !errors.Is(err, errAntigravityUnreadable) {
		t.Fatal("a linked store was read", err)
	}
	if err := store.write(credential); err == nil {
		t.Fatal("a linked store was replaced")
	}
	linked := antigravityStoreIn(t.TempDir())
	target := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(filepath.Dir(linked.path)), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Dir(linked.path)); err != nil {
		t.Fatal(err)
	}
	if err := linked.write(credential); err == nil {
		t.Fatal("the sign-in was written through a linked directory")
	}
	if entries, _ := os.ReadDir(target); len(entries) != 0 {
		t.Fatalf("the link's target received %v", entries)
	}
}

func TestAntigravityStoreLockExcludesASecondWriter(t *testing.T) {
	_, store := antigravityFixture(t, antigravitySample(time.Now().Add(time.Hour)))
	unlock, err := store.lock(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	if _, err := store.lock(ctx); !errors.Is(err, errAntigravityLock) {
		t.Fatal("a second writer took the lock", err)
	}
	unlock()
	again, err := store.lock(context.Background())
	if err != nil {
		t.Fatal("a released lock could not be taken", err)
	}
	again()
}

// form reads a token request's body.
func googleForm(t *testing.T, body string) url.Values {
	t.Helper()
	values, err := url.ParseQuery(body)
	if err != nil {
		t.Fatal(err)
	}
	return values
}
