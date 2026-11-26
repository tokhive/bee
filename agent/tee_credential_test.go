package bee

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tokhive/tee/platform"
)

const testApplicationID = "snp-app:83f877b9b046972daa9b0310b40ca8d642647d3a33e7ccf2031d0f90e7ab73c7"

// testTEE builds a signing epoch, an inbox key, and a trust that admits the
// epoch's fabricated evidence. Only the hardware check is substituted; every
// structural, freshness, binding and signature check runs for real.
type testTEE struct {
	key       *ecdsa.PrivateKey
	keyID     [32]byte
	inbox     *ecdh.PrivateKey
	inboxDER  []byte
	inboxID   [32]byte
	policy    [32]byte
	reference credentialKeyAttestation
	trust     teeTrust
}

func newTestTEE(t *testing.T) *testTEE {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	inbox, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	inboxDER, err := x509.MarshalPKIXPublicKey(inbox.PublicKey())
	if err != nil {
		t.Fatal(err)
	}
	tee := &testTEE{key: key, keyID: sha256.Sum256(der), inbox: inbox, inboxDER: inboxDER, inboxID: sha256.Sum256(inboxDER)}
	copy(tee.policy[:], []byte("0123456789abcdef0123456789abcdef"))
	evidence := []byte(`{"measurement":"test"}`)
	tee.reference = credentialKeyAttestation{
		Platform:        platform.PlatformAWSSEVSNP,
		AttestationType: "sevsnp-report",
		ApplicationID:   testApplicationID,
		KeyID:           tee.keyID[:],
		PublicKeyDER:    der,
		EvidenceHash:    digest(evidence),
		Evidence:        evidence,
	}
	tee.trust = teeTrust{
		applications: map[string]struct{}{testApplicationID: {}},
		policyHashes: map[[32]byte]struct{}{tee.policy: {}},
		checkEvidence: func(identity platform.Identity) error {
			if identity.ApplicationID != testApplicationID {
				return errors.New("unexpected application")
			}
			return nil
		},
	}
	return tee
}

func (tee *testTEE) signed(t *testing.T, nonce []byte, mutate func(*credentialKeyStatement)) []byte {
	t.Helper()
	statement := credentialKeyStatement{
		Version:     credentialKeyVersion,
		Nonce:       nonce,
		InboxKeyID:  tee.inboxID[:],
		InboxPublic: tee.inboxDER,
		PolicyHash:  tee.policy[:],
		IssuedAt:    1,
		Attestation: &tee.reference,
	}
	if mutate != nil {
		mutate(&statement)
	}
	payload, err := credentialKeyEncoder.Marshal(statement)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := platform.SigningDigest(credentialKeyDomain, payload)
	if err != nil {
		t.Fatal(err)
	}
	value, err := ecdsa.SignASN1(rand.Reader, tee.key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := credentialKeyEncoder.Marshal(signedCredentialKey{
		Statement: statement,
		Signature: platform.Signature{Algorithm: platform.SignatureAlgorithmECDSAP256SHA256ASN1, KeyID: tee.keyID, Value: value},
	})
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestVerifyCredentialKeyAcceptsTheAttestedKey(t *testing.T) {
	tee := newTestTEE(t)
	nonce := make([]byte, credentialKeyNonceLength)
	key, err := verifyCredentialKey(tee.signed(t, nonce, nil), nonce, tee.trust)
	if err != nil {
		t.Fatalf("a statement from the trusted image was refused: %v", err)
	}
	if key.KeyID != tee.inboxID || string(key.PublicKey) != string(tee.inboxDER) {
		t.Fatal("the verified key is not the attested inbox key")
	}
}

func TestVerifyCredentialKeyRejectsSubstitutionAndReplay(t *testing.T) {
	other := newTestTEE(t)
	other.policy[0] ^= 0xff
	nonce := make([]byte, credentialKeyNonceLength)
	replayed := make([]byte, credentialKeyNonceLength)
	replayed[0] = 1

	for name, test := range map[string]struct {
		encoded []byte
		trust   func(teeTrust) teeTrust
	}{
		"old challenge": {encoded: newTestTEE(t).signed(t, replayed, nil)},
		"swapped key":   {encoded: newTestTEE(t).signed(t, nonce, func(s *credentialKeyStatement) { s.InboxKeyID = other.inboxID[:] })},
		"foreign image": {encoded: newTestTEE(t).signed(t, nonce, func(s *credentialKeyStatement) {
			reference := *s.Attestation
			reference.ApplicationID = "snp-app:" + strings.Repeat("a", 64)
			s.Attestation = &reference
		})},
		"other whitelist": {encoded: newTestTEE(t).signed(t, nonce, func(s *credentialKeyStatement) { s.PolicyHash = other.policy[:] })},
		"unsigned": {encoded: newTestTEE(t).signed(t, nonce, nil), trust: func(trust teeTrust) teeTrust {
			trust.checkEvidence = func(platform.Identity) error { return errors.New("bad report") }
			return trust
		}},
		"no attestation": {encoded: newTestTEE(t).signed(t, nonce, func(s *credentialKeyStatement) { s.Attestation = nil })},
		"wrong version":  {encoded: newTestTEE(t).signed(t, nonce, func(s *credentialKeyStatement) { s.Version = 2 })},
	} {
		t.Run(name, func(t *testing.T) {
			trust := newTestTEE(t).trust
			if test.trust != nil {
				trust = test.trust(trust)
			}
			if _, err := verifyCredentialKey(test.encoded, nonce, trust); !errors.Is(err, errInboxIdentity) {
				t.Fatalf("got %v, want a refusal that halts", err)
			}
		})
	}
}

// A rollout to an image with a new whitelist pins both whitelists, so one
// release trusts the TEE on either side of the switch.
func TestVerifyCredentialKeyTrustsEitherWhitelistOfARollout(t *testing.T) {
	tee := newTestTEE(t)
	next := tee.policy
	next[0] ^= 0xff
	tee.trust.policyHashes[next] = struct{}{}
	nonce := make([]byte, credentialKeyNonceLength)
	for name, policy := range map[string][32]byte{"current": tee.policy, "next": next} {
		encoded := tee.signed(t, nonce, func(s *credentialKeyStatement) { s.PolicyHash = policy[:] })
		if _, err := verifyCredentialKey(encoded, nonce, tee.trust); err != nil {
			t.Fatalf("%s whitelist refused: %v", name, err)
		}
	}
	unknown := next
	unknown[1] ^= 0xff
	encoded := tee.signed(t, nonce, func(s *credentialKeyStatement) { s.PolicyHash = unknown[:] })
	if _, err := verifyCredentialKey(encoded, nonce, tee.trust); !errors.Is(err, errInboxIdentity) {
		t.Fatalf("an unpinned whitelist was trusted: %v", err)
	}
}

// The policy pin is a comma-separated list; any entry that is not a digest
// fails closed, as an empty pin does.
func TestLoadTEETrustReadsEveryPolicyPin(t *testing.T) {
	saved := TEEPolicyHash
	t.Cleanup(func() { TEEPolicyHash = saved })
	first, second := strings.Repeat("ab", 32), strings.Repeat("cd", 32)

	TEEPolicyHash = first + ", " + second
	trust, err := loadTEETrust()
	if err != nil || len(trust.policyHashes) != 2 {
		t.Fatalf("two pins: %v %d", err, len(trust.policyHashes))
	}
	digest, _ := hex.DecodeString(second)
	if !trust.trustsPolicy(digest) {
		t.Fatal("the second pin is not trusted")
	}
	for _, pin := range []string{"", first + ",", first + ",not-a-digest", strings.Repeat("ab", 31)} {
		TEEPolicyHash = pin
		if _, err := loadTEETrust(); err == nil {
			t.Fatalf("pin %q was accepted", pin)
		}
	}
}

func TestVerifyCredentialKeyRejectsAForgedSignature(t *testing.T) {
	tee := newTestTEE(t)
	forger := newTestTEE(t)
	nonce := make([]byte, credentialKeyNonceLength)
	encoded := tee.signed(t, nonce, nil)

	var signed signedCredentialKey
	if err := credentialKeyCBOR.Unmarshal(encoded, &signed); err != nil {
		t.Fatal(err)
	}
	payload, err := credentialKeyEncoder.Marshal(signed.Statement)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := platform.SigningDigest(credentialKeyDomain, payload)
	if err != nil {
		t.Fatal(err)
	}
	value, err := ecdsa.SignASN1(rand.Reader, forger.key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	signed.Signature.Value = value
	forged, err := credentialKeyEncoder.Marshal(signed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyCredentialKey(forged, nonce, tee.trust); !errors.Is(err, errInboxIdentity) {
		t.Fatalf("a signature from an unattested key was accepted: %v", err)
	}
}

func TestFetchInboxKeyNeedsAnAttestedOrPinnedKey(t *testing.T) {
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(key.PublicKey())
	if err != nil {
		t.Fatal(err)
	}
	id := sha256.Sum256(der)
	body, err := json.Marshal(map[string][]byte{"public_key": der, "key_id": id[:]})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if nonce := r.URL.Query().Get("nonce"); len(nonce) != 64 {
			t.Errorf("the request carried no 32-byte challenge: %q", r.URL.RawQuery)
		}
		_, _ = w.Write(body)
	}))
	defer server.Close()
	state := localState{Hive: server.URL, Credential: "secret"}

	previous := Version
	Version = "release-test"
	defer func() { Version = previous }()

	if _, err := fetchInboxKey(context.Background(), state, ""); !errors.Is(err, errInboxIdentity) {
		t.Fatalf("a release accepted an unattested, unpinned key: %v", err)
	}
	if _, err := fetchInboxKey(context.Background(), state, hex.EncodeToString(id[:])); err != nil {
		t.Fatalf("a directly pinned key was refused: %v", err)
	}
	if _, err := fetchInboxKey(context.Background(), state, strings.Repeat("0", 64)); !errors.Is(err, errInboxIdentity) {
		t.Fatalf("a key that contradicts the pin was accepted: %v", err)
	}

	Version = "dev"
	if _, err := fetchInboxKey(context.Background(), state, ""); err != nil {
		t.Fatalf("a development build refused its fixture: %v", err)
	}
	if _, err := fetchInboxKey(context.Background(), state, strings.Repeat("0", 64)); !errors.Is(err, errInboxIdentity) {
		t.Fatalf("a development build accepted a key that contradicts its pin: %v", err)
	}
}

func digest(data []byte) []byte {
	sum := sha256.Sum256(data)
	return sum[:]
}
