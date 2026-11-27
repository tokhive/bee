package bee

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hiddeco/sshsig"
	"golang.org/x/crypto/ssh"

	"github.com/tokhive/tee/platform"
)

var (
	catalogImageA   = "snp-app:" + strings.Repeat("aa", 32)
	catalogImageB   = "snp-app:" + strings.Repeat("bb", 32)
	catalogStaging  = "snp-app:" + strings.Repeat("cc", 32)
	catalogPolicyA  = strings.Repeat("a1", 32)
	catalogPolicyB  = strings.Repeat("b2", 32)
	catalogPolicyCC = strings.Repeat("c3", 32)
)

type catalogEvent struct{ environment, application, action, at string }

func catalogJSON(t *testing.T, releases map[string]string, events ...catalogEvent) []byte {
	t.Helper()
	type release struct {
		ApplicationID string `json:"application_id"`
		PolicyHash    string `json:"policy_hash"`
	}
	type event struct {
		Environment   string `json:"environment"`
		ApplicationID string `json:"application_id"`
		Action        string `json:"action"`
		At            string `json:"at"`
	}
	file := struct {
		Version          int       `json:"version"`
		Releases         []release `json:"releases"`
		DeploymentEvents []event   `json:"deployment_events"`
	}{Version: 1}
	for application, policy := range releases {
		file.Releases = append(file.Releases, release{application, policy})
	}
	for _, e := range events {
		file.DeploymentEvents = append(file.DeploymentEvents, event{e.environment, e.application, e.action, e.at})
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// catalogSigner installs a fresh release-signing key for one test and signs
// catalogs with it.
type catalogSigner struct{ signer ssh.Signer }

func newCatalogSigner(t *testing.T) catalogSigner {
	t.Helper()
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	saved := TEECatalogSigningKey
	t.Cleanup(func() { TEECatalogSigningKey = saved })
	TEECatalogSigningKey = string(ssh.MarshalAuthorizedKey(signer.PublicKey()))
	return catalogSigner{signer}
}

func (s catalogSigner) sign(t *testing.T, data []byte, namespace string) []byte {
	t.Helper()
	signature, err := sshsig.Sign(bytes.NewReader(data), s.signer, sshsig.HashSHA512, namespace)
	if err != nil {
		t.Fatal(err)
	}
	return sshsig.Armor(signature)
}

// catalogServer serves catalog.json and catalog.json.sig over TLS, and points
// a fresh shared catalog at it for the length of the test.
type catalogServer struct {
	mu        sync.Mutex
	catalog   []byte
	signature []byte
	requests  int
	clock     *time.Time
}

func newCatalogServer(t *testing.T) *catalogServer {
	t.Helper()
	served := &catalogServer{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served.mu.Lock()
		defer served.mu.Unlock()
		switch r.URL.Path {
		case "/download/catalog.json":
			served.requests++
			_, _ = w.Write(served.catalog)
		case "/download/catalog.json.sig":
			_, _ = w.Write(served.signature)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	savedURL, savedFloor, savedCatalog := TEECatalogURL, TEECatalogNotBefore, sharedTEECatalog
	t.Cleanup(func() { TEECatalogURL, TEECatalogNotBefore, sharedTEECatalog = savedURL, savedFloor, savedCatalog })
	TEECatalogURL = server.URL + "/download/"
	TEECatalogNotBefore = ""
	now := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	served.clock = &now
	sharedTEECatalog = &teeCatalog{now: func() time.Time { return *served.clock }, client: server.Client()}
	return served
}

func (s *catalogServer) publish(catalog, signature []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalog, s.signature = catalog, signature
}

func (s *catalogServer) advance(d time.Duration) { *s.clock = s.clock.Add(d) }

func (s *catalogServer) downloads() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.requests
}

func policyDigest(t *testing.T, value string) [32]byte {
	t.Helper()
	raw, err := hex.DecodeString(value)
	if err != nil || len(raw) != 32 {
		t.Fatalf("bad test digest %q", value)
	}
	var digest [32]byte
	copy(digest[:], raw)
	return digest
}

// The compiled-in key must be the production release-signing key that signs
// every production TEE release.
func TestCatalogSigningKeyIsTheProductionReleaseKey(t *testing.T) {
	public, _, _, _, err := ssh.ParseAuthorizedKey([]byte(TEECatalogSigningKey))
	if err != nil {
		t.Fatal(err)
	}
	if got := ssh.FingerprintSHA256(public); got != "SHA256:A7HhHJgJmWp4xbtwhD/4IL5Ua6XUWG9FahuP0KNPoNk" {
		t.Fatalf("catalog signing key is %s", got)
	}
	if TEECatalogEnvironment != "production" {
		t.Fatalf("release builds trust %q", TEECatalogEnvironment)
	}
}

// Only images the environment runs now are trusted: a retired image, a
// staging image and an image never activated are not.
func TestParseTEECatalogTrustsOnlyActiveImages(t *testing.T) {
	data := catalogJSON(t,
		map[string]string{catalogImageA: catalogPolicyA, catalogImageB: catalogPolicyB, catalogStaging: catalogPolicyCC},
		catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"},
		catalogEvent{"staging", catalogStaging, "activate", "2026-11-26T03:02:18Z"},
		catalogEvent{"production", catalogImageA, "deactivate", "2026-11-27T03:07:53Z"},
		catalogEvent{"production", catalogImageB, "activate", "2026-11-27T03:07:53Z"},
	)
	trust, err := parseTEECatalog(data, "production")
	if err != nil {
		t.Fatal(err)
	}
	if len(trust.applications) != 1 {
		t.Fatalf("trusted images: %v", trust.applications)
	}
	if _, ok := trust.applications[catalogImageB]; !ok {
		t.Fatal("the active image is not trusted")
	}
	if _, ok := trust.policyHashes[policyDigest(t, catalogPolicyB)]; !ok || len(trust.policyHashes) != 1 {
		t.Fatalf("trusted whitelists: %v", trust.policyHashes)
	}
	if want := time.Date(2026, 11, 27, 3, 7, 53, 0, time.UTC); !trust.latest.Equal(want) {
		t.Fatalf("latest event %s", trust.latest)
	}

	for name, bad := range map[string][]byte{
		"no release entry": catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA},
			catalogEvent{"production", catalogImageB, "activate", "2026-11-20T02:55:13Z"}),
		"nothing active": catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA},
			catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"},
			catalogEvent{"production", catalogImageA, "deactivate", "2026-11-21T02:55:13Z"}),
		"bad time": catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA},
			catalogEvent{"production", catalogImageA, "activate", "yesterday"}),
		"bad policy": catalogJSON(t, map[string]string{catalogImageA: "abcd"},
			catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"}),
	} {
		if _, err := parseTEECatalog(bad, "production"); err == nil {
			t.Errorf("%s: catalog accepted", name)
		}
	}
}

func TestVerifyTEECatalogNeedsTheReleaseKeyAndNamespace(t *testing.T) {
	signer := newCatalogSigner(t)
	data := []byte(`{"version":1}`)
	if err := verifyTEECatalog(data, signer.sign(t, data, teeCatalogNamespace)); err != nil {
		t.Fatalf("a correctly signed catalog was refused: %v", err)
	}
	if err := verifyTEECatalog([]byte(`{"version":2}`), signer.sign(t, data, teeCatalogNamespace)); err == nil {
		t.Fatal("a modified catalog was accepted")
	}
	if err := verifyTEECatalog(data, signer.sign(t, data, "file")); err == nil {
		t.Fatal("a signature for another namespace was accepted")
	}
	other := signer.sign(t, data, teeCatalogNamespace)
	newCatalogSigner(t) // the compiled-in key is now a different one
	if err := verifyTEECatalog(data, other); err == nil {
		t.Fatal("a signature by another key was accepted")
	}
	if err := verifyTEECatalog(data, []byte("not a signature")); err == nil {
		t.Fatal("garbage was accepted as a signature")
	}
}

// withRevocations adds tee's revocation records, which sit beside the
// deployment events and do not deactivate anything.
func withRevocations(t *testing.T, data []byte, revoked map[string]string) []byte {
	t.Helper()
	var file map[string]any
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	var revocations []map[string]string
	for application, at := range revoked {
		revocations = append(revocations, map[string]string{"application_id": application, "at": at, "reason": "test", "reference_url": "https://example.com/advisory"})
	}
	file["revocations"] = revocations
	out, err := json.Marshal(file)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// tee records a revocation without deactivating the image, so an image can be
// active and revoked at once; it must not be trusted.
func TestParseTEECatalogDropsRevokedImages(t *testing.T) {
	base := catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA},
		catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"})
	if _, err := parseTEECatalog(withRevocations(t, base, map[string]string{catalogImageA: "2026-11-28T00:00:00Z"}), "production"); err == nil {
		t.Fatal("a revoked image that is still active was trusted")
	}
	both := catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA, catalogImageB: catalogPolicyB},
		catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"},
		catalogEvent{"staging", catalogImageB, "activate", "2026-11-21T02:55:13Z"},
		catalogEvent{"production", catalogImageA, "deactivate", "2026-11-22T02:55:13Z"},
		catalogEvent{"production", catalogImageB, "activate", "2026-11-22T02:55:13Z"})
	trust, err := parseTEECatalog(withRevocations(t, both, map[string]string{catalogImageA: "2026-11-28T00:00:00Z"}), "production")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := trust.applications[catalogImageB]; !ok || len(trust.applications) != 1 {
		t.Fatalf("trusted images: %v", trust.applications)
	}
	// The revocation is the newest entry, so a replay of the catalog from
	// before it is older and is refused by the caller.
	if want := time.Date(2026, 11, 28, 0, 0, 0, 0, time.UTC); !trust.latest.Equal(want) {
		t.Fatalf("latest entry %s", trust.latest)
	}
}

// An action a later tee adds is skipped, not a reason to drop the catalog.
func TestParseTEECatalogSkipsUnknownActions(t *testing.T) {
	data := catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA, catalogImageB: catalogPolicyB},
		catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"},
		catalogEvent{"production", catalogImageB, "promote", "2026-11-21T02:55:13Z"})
	trust, err := parseTEECatalog(data, "production")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := trust.applications[catalogImageA]; !ok || len(trust.applications) != 1 {
		t.Fatalf("trusted images: %v", trust.applications)
	}
}

// A downloaded catalog older than one already accepted, or than the build
// itself, is a replay and leaves the trust where it was.
func TestTEECatalogRefusesOlderCatalogs(t *testing.T) {
	signer := newCatalogSigner(t)
	served := newCatalogServer(t)
	newer := catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA, catalogImageB: catalogPolicyB},
		catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"},
		catalogEvent{"production", catalogImageA, "deactivate", "2026-11-27T03:07:53Z"},
		catalogEvent{"production", catalogImageB, "activate", "2026-11-27T03:07:53Z"})
	older := catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA},
		catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"})

	served.publish(newer, signer.sign(t, newer, teeCatalogNamespace))
	trust := sharedTEECatalog.current(context.Background(), false)
	if trust == nil {
		t.Fatal("a valid catalog was not accepted")
	}
	if _, ok := trust.applications[catalogImageB]; !ok {
		t.Fatal("the active image is not trusted")
	}

	served.publish(older, signer.sign(t, older, teeCatalogNamespace))
	served.advance(teeCatalogTTL)
	trust = sharedTEECatalog.current(context.Background(), true)
	if _, ok := trust.applications[catalogImageA]; ok {
		t.Fatal("an older catalog brought back a retired image")
	}

	// A fresh process has nothing cached; the build's own floor refuses it.
	sharedTEECatalog = &teeCatalog{now: sharedTEECatalog.now, client: sharedTEECatalog.client}
	TEECatalogNotBefore = "2026-11-27T03:07:53Z"
	if trust := sharedTEECatalog.current(context.Background(), false); trust != nil {
		t.Fatalf("a catalog older than the build was accepted: %v", trust.applications)
	}
}

// A signature that does not verify leaves the compiled-in pins in force.
func TestTEECatalogWithABadSignatureIsIgnored(t *testing.T) {
	signer := newCatalogSigner(t)
	served := newCatalogServer(t)
	data := catalogJSON(t, map[string]string{catalogImageB: catalogPolicyB},
		catalogEvent{"production", catalogImageB, "activate", "2026-11-27T03:07:53Z"})
	served.publish(data, signer.sign(t, []byte("something else"), teeCatalogNamespace))
	if trust := sharedTEECatalog.current(context.Background(), false); trust != nil {
		t.Fatal("a catalog with a bad signature was accepted")
	}
	base := teeTrust{applications: map[string]struct{}{catalogImageA: {}}}
	if got := base.withCatalog(nil); len(got.applications) != 1 {
		t.Fatal("the compiled-in pins were dropped without a verified catalog")
	}
}

// Downloads are cached for teeCatalogTTL, and a forced refresh is rate limited.
func TestTEECatalogCachesDownloads(t *testing.T) {
	signer := newCatalogSigner(t)
	served := newCatalogServer(t)
	data := catalogJSON(t, map[string]string{catalogImageB: catalogPolicyB},
		catalogEvent{"production", catalogImageB, "activate", "2026-11-27T03:07:53Z"})
	served.publish(data, signer.sign(t, data, teeCatalogNamespace))
	ctx := context.Background()
	sharedTEECatalog.current(ctx, false)
	sharedTEECatalog.current(ctx, false)
	sharedTEECatalog.current(ctx, true)
	if n := served.downloads(); n != 1 {
		t.Fatalf("%d downloads within the retry window", n)
	}
	served.advance(teeCatalogRetry)
	sharedTEECatalog.current(ctx, true)
	served.advance(teeCatalogTTL)
	sharedTEECatalog.current(ctx, false)
	if n := served.downloads(); n != 3 {
		t.Fatalf("%d downloads, want 3", n)
	}
}

// The end-to-end case this exists for: the TEE moves to an image this build
// does not pin. Before the release is published the Bee keeps retrying rather
// than halting; once the signed catalog lists the image, the same flow
// succeeds without a new Bee.
func TestFetchInboxKeyFollowsATEERelease(t *testing.T) {
	signer := newCatalogSigner(t)
	served := newCatalogServer(t)
	tee := newTestTEE(t) // attests testApplicationID, which no compiled pin names
	policy := hex.EncodeToString(tee.policy[:])

	savedEvidence, savedVersion := checkTEEEvidence, Version
	t.Cleanup(func() { checkTEEEvidence, Version = savedEvidence, savedVersion })
	checkTEEEvidence = func(identity platform.Identity) error {
		if identity.ApplicationID != testApplicationID {
			return errors.New("unexpected application")
		}
		return nil
	}
	Version = "release-test"

	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonce, err := hex.DecodeString(r.URL.Query().Get("nonce"))
		if err != nil {
			http.Error(w, "bad nonce", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(credentialKeyResponse{KeyID: tee.inboxID[:], PublicKey: tee.inboxDER, Attestation: tee.signed(t, nonce, nil)})
	}))
	defer hive.Close()
	state := localState{Hive: hive.URL, Credential: "secret"}
	ctx := context.Background()

	// The latest release still names the previous image.
	previous := catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA},
		catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"})
	served.publish(previous, signer.sign(t, previous, teeCatalogNamespace))
	_, err := fetchInboxKey(ctx, state, "")
	if !errors.Is(err, errUntrustedTEE) || errors.Is(err, errInboxIdentity) {
		t.Fatalf("an unpublished release should be retried, not halt: %v", err)
	}

	// The release is published: the next attempt picks it up.
	release := catalogJSON(t, map[string]string{catalogImageA: catalogPolicyA, testApplicationID: policy},
		catalogEvent{"production", catalogImageA, "activate", "2026-11-20T02:55:13Z"},
		catalogEvent{"production", catalogImageA, "deactivate", "2026-11-27T03:07:53Z"},
		catalogEvent{"production", testApplicationID, "activate", "2026-11-27T03:07:53Z"})
	served.publish(release, signer.sign(t, release, teeCatalogNamespace))
	served.advance(teeCatalogRetry)
	key, err := fetchInboxKey(ctx, state, "")
	if err != nil {
		t.Fatalf("the published release was not trusted: %v", err)
	}
	if key.KeyID != tee.inboxID {
		t.Fatal("the verified key is not the attested inbox key")
	}

	// A later release retires the image: the cached trust is replaced, and a
	// statement from the retired image is refused.
	retired := catalogJSON(t, map[string]string{catalogImageB: catalogPolicyB, testApplicationID: policy},
		catalogEvent{"production", testApplicationID, "activate", "2026-11-27T03:07:53Z"},
		catalogEvent{"production", testApplicationID, "deactivate", "2026-11-28T03:00:00Z"},
		catalogEvent{"production", catalogImageB, "activate", "2026-11-28T03:00:00Z"})
	served.publish(retired, signer.sign(t, retired, teeCatalogNamespace))
	served.advance(teeCatalogTTL)
	if _, err := fetchInboxKey(ctx, state, ""); !errors.Is(err, errUntrustedTEE) {
		t.Fatalf("a retired image was still trusted: %v", err)
	}

	// Tampering that has nothing to do with which release is trusted still
	// halts: a substituted key is not something a newer catalog can fix.
	hive.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonce, _ := hex.DecodeString(r.URL.Query().Get("nonce"))
		_ = json.NewEncoder(w).Encode(credentialKeyResponse{KeyID: tee.inboxID[:], PublicKey: tee.inboxDER, Attestation: tee.signed(t, append([]byte{1}, nonce[1:]...), nil)})
	})
	if _, err := fetchInboxKey(ctx, state, ""); !errors.Is(err, errInboxIdentity) || errors.Is(err, errUntrustedTEE) {
		t.Fatalf("a statement for another challenge did not halt: %v", err)
	}
}
