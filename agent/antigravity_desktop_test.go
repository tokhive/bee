//go:build darwin || linux

package bee

import (
	"context"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// The desktop app shares a Google account from the sign-in Bee keeps, which
// bee antigravity-login puts beside the device configuration.
func TestAddGoogleAccountFromTheStoredSignIn(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	if found := r.detect(context.Background(), beewire.GooglePlatform); found.Available || found.Problem == nil || found.Problem.Code != "BEE-ANTIGRAVITY-SOURCE" {
		t.Fatalf("detect without a sign-in = %+v", found)
	}
	if _, err := r.addAccount(context.Background(), addAccountRequest{Platform: beewire.GooglePlatform, Source: "local"}); refusalCode(err) != "BEE-ANTIGRAVITY-SOURCE" {
		t.Fatalf("add without a sign-in: %v", err)
	}
	if _, err := r.addAccount(context.Background(), addAccountRequest{Platform: beewire.GooglePlatform, Source: "import", File: "/tmp/credentials.json"}); refusalCode(err) != "import_unsupported" {
		t.Fatalf("import: %v", err)
	}
	if e := explainCode("import_unsupported"); e.Action != actionRelogin {
		t.Fatal("the refused import has no explanation")
	}

	credential := antigravitySample(time.Now().Add(time.Hour))
	if err := antigravityStoreIn(filepath.Dir(r.configPath)).write(credential); err != nil {
		t.Fatal(err)
	}
	found := r.detect(context.Background(), beewire.GooglePlatform)
	if !found.Available || found.Email != "provider@example.test" || found.Plan != "pro" || found.Fingerprint != credential.fingerprint() {
		t.Fatalf("detect = %+v", found)
	}
	// Hive already knows this account, so nothing waits on a confirmation.
	hive.mu.Lock()
	hive.account = beewire.PlatformAccount{Status: "ready", AccountFingerprint: credential.fingerprint()}
	hive.mu.Unlock()
	record, err := r.addAccount(context.Background(), addAccountRequest{Platform: beewire.GooglePlatform, Source: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if record.Platform != beewire.GooglePlatform || record.Email != "provider@example.test" || record.Plan != "pro" || record.Fingerprint != credential.fingerprint() {
		t.Fatalf("record = %+v", record)
	}
	fields := egressFields(t, r)
	targets := fields["targets"].([]any)
	if fields["antigravity"].(map[string]any)["capabilities"] != true || len(targets) != 2 || !slices.Contains(targets, any(beewire.AntigravityHost)) || !slices.Contains(targets, any(beewire.AntigravityDailyHost)) {
		t.Fatalf("egress = %v", fields)
	}
	if _, err := readEgress(context.Background(), defaultEgressPath(r.configPath)); err != nil {
		t.Fatalf("written egress does not read back: %v", err)
	}
	if got := r.egress.sources().list(); len(got) != 1 || got[0] != (sourceInfo{"antigravity", beewire.GooglePlatform}) || !r.egress.allowed(beewire.AntigravityHost) || !r.egress.allowed(beewire.AntigravityDailyHost) {
		t.Fatalf("running sources = %v", got)
	}
	waitUntil(t, "platform resumed", func() bool { return hive.called("PUT google paused=false") })

	// Removing waits for the streams of both of its upstreams.
	closeStream := r.egress.streamOpened(beewire.AntigravityDailyHost)
	time.AfterFunc(100*time.Millisecond, closeStream)
	started := time.Now()
	if err := r.removeAccount(context.Background(), record.ID); err != nil {
		t.Fatal(err)
	}
	if time.Since(started) < 100*time.Millisecond || !hive.called("PUT google paused=true") {
		t.Fatal("removal did not pause the platform and wait for its open stream")
	}
	if r.egress.allowed(beewire.AntigravityHost) || r.egress.allowed(beewire.AntigravityDailyHost) || len(r.egress.sources().names()) != 0 || len(r.accounts()) != 0 {
		t.Fatal("the removed account is still supplied")
	}
	// Removing the account stops sharing it; the sign-in is the Provider's to keep.
	if _, err := antigravityStoreIn(filepath.Dir(r.configPath)).read(); err != nil {
		t.Fatal("removing the account deleted the sign-in", err)
	}
}

func TestDesktopAdoptsAConfiguredGoogleAccount(t *testing.T) {
	r := newAccountsRunner(t, "https://hive.example")
	r.egress.Antigravity = &antigravitySource{Capabilities: true}
	if err := r.adoptConfiguredAccounts(); err != nil {
		t.Fatal(err)
	}
	if records := r.accounts(); len(records) != 1 || records[0].Platform != beewire.GooglePlatform || records[0].Source != accountSourceLocal {
		t.Fatalf("records = %+v", records)
	}
}
