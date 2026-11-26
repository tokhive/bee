package bee

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/fxamacker/cbor/v2"
	"github.com/tokhive/tee/platform"
	"github.com/tokhive/tee/platform/sevsnp"
	"github.com/tokhive/tee/shared"
	"github.com/tokhive/tee/tee"
)

// The TEE a release trusts is compiled in, never fetched. A relay that could
// name its own trust anchor would be exactly the party this verification
// exists to distrust, so the pins below are build inputs: each release ships
// the measured image, the whitelist digest, and the Secure Boot release key it
// was cut against. A TEE upgrade changes the measured image, so a Bee that
// should follow one is rebuilt (or built with
//
//	-ldflags "-X github.com/tokhive/bee/agent.TEEApplicationIDs=... -X ..."
//
// ) with the new values. An empty application or policy pin fails closed.
var (
	// TEEApplicationIDs is the comma-separated allowlist of measured images
	// ("snp-app:<sha256>") this release trusts. Two entries cover the window
	// of a coordinated TEE rollout between two images that both sign their
	// inbox key; remove the old one once it is retired. An image older than
	// TEE 0.3.0 can't sign it, so pinning one keeps nothing working.
	//
	// snp-app:df38d993… is TEE 0.3.1, which production has run since
	// 2026-11-20T02:55:13Z (tokhive/tee releases/catalog.json). Staging runs a
	// different build of the same source and needs a build override.
	TEEApplicationIDs = "snp-app:df38d99343f65e66ff10423dbf3148812d2e891af8f5e5db5d8255e9d608bbb5"

	// TEEPolicyHash is the comma-separated allowlist of SHA-256 digests of the
	// whitelists the TEE may attest it loaded. On SEV-SNP the whitelist is
	// baked into the measured image, so this is a second, explicit assertion
	// rather than the only one. A rollout to an image with a new whitelist
	// lists both digests beside both images, or a Bee would trust only one
	// side of the switch; remove the old one with the old image.
	//
	// 8dde1990… is the whitelist of TEE 0.3.1.
	TEEPolicyHash = "8dde1990d62099a666bb078a7b626f2c9335cd070e92e9a849d2ced2bff96a40"

	// TEEReleaseKeyPEM is the Secure Boot release-signing public key the TEE
	// evidence is checked against. Empty leaves the key embedded in the pinned
	// tee module in use, which is still a build-time value, just one this
	// repository does not spell out.
	TEEReleaseKeyPEM = ""
)

// The credential-key statement is the TEE's promise that this inbox key belongs
// to the attested epoch that signs execution receipts. The wire form is fixed
// by the tee module; the cbor tags below mirror it field for field because this
// Bee pins a tee module that predates the type. Decoding re-checks canonical
// form, so the bytes verified are the bytes the enclave signed.
const (
	credentialKeyDomain      = "TokenHive.CredentialKey.v1"
	credentialKeyVersion     = 1
	credentialKeyNonceLength = 32
	maxApplicationIDLength   = 256
)

type credentialKeyAttestation struct {
	Platform        string `cbor:"1,keyasint"`
	AttestationType string `cbor:"2,keyasint"`
	ApplicationID   string `cbor:"3,keyasint"`
	KeyID           []byte `cbor:"4,keyasint"`
	PublicKeyDER    []byte `cbor:"5,keyasint"`
	EvidenceHash    []byte `cbor:"6,keyasint"`
	Evidence        []byte `cbor:"7,keyasint,omitempty"`
}

type credentialKeyStatement struct {
	Version     uint32                    `cbor:"1,keyasint"`
	Nonce       []byte                    `cbor:"2,keyasint"`
	InboxKeyID  []byte                    `cbor:"3,keyasint"`
	InboxPublic []byte                    `cbor:"4,keyasint"`
	PolicyHash  []byte                    `cbor:"5,keyasint"`
	IssuedAt    int64                     `cbor:"6,keyasint"`
	Attestation *credentialKeyAttestation `cbor:"7,keyasint,omitempty"`
}

type signedCredentialKey struct {
	Statement credentialKeyStatement `cbor:"1,keyasint"`
	Signature platform.Signature     `cbor:"2,keyasint"`
}

// errInboxAttestation is an errInboxIdentity: a statement this Bee will not
// believe means the TEE is not the enclave this build trusts, which retrying
// cannot fix. It therefore halts and tells the operator to update Bee.
var errInboxAttestation = fmt.Errorf("%w: the TEE did not prove the inbox key belongs to a trusted enclave", errInboxIdentity)

var (
	releaseKeyOnce sync.Once
	releaseKeyErr  error
	stalePinOnce   sync.Once
)

// teeTrust is the compiled-in half of verification: which images and whitelist
// are acceptable, and how their evidence is checked. Tests substitute the
// evidence checker; production builds always get sevsnp.
type teeTrust struct {
	applications  map[string]struct{}
	policyHashes  map[[32]byte]struct{}
	checkEvidence func(platform.Identity) error
}

func loadTEETrust() (teeTrust, error) {
	// The release key is a process-wide setting; install it once so concurrent
	// fetches from different platform synchronizers cannot race on it.
	releaseKeyOnce.Do(func() {
		if TEEReleaseKeyPEM != "" {
			releaseKeyErr = shared.SetReleasePublicKeyPEM([]byte(TEEReleaseKeyPEM))
		}
	})
	if releaseKeyErr != nil {
		return teeTrust{}, fmt.Errorf("this Bee build has an unusable TEE release key: %w", releaseKeyErr)
	}

	applications := map[string]struct{}{}
	for _, application := range strings.Split(TEEApplicationIDs, ",") {
		application = strings.ToLower(strings.TrimSpace(application))
		if !validApplicationID(application) {
			return teeTrust{}, fmt.Errorf("this Bee build has no usable TEE application pin (%q); update Bee", application)
		}
		applications[application] = struct{}{}
	}
	if len(applications) == 0 {
		return teeTrust{}, errors.New("this Bee build has no TEE application pins; update Bee")
	}
	policies := map[[32]byte]struct{}{}
	for _, entry := range strings.Split(TEEPolicyHash, ",") {
		policy, err := hex.DecodeString(strings.TrimSpace(entry))
		if err != nil || len(policy) != sha256.Size {
			return teeTrust{}, fmt.Errorf("this Bee build has no usable TEE policy pin (%q); update Bee", strings.TrimSpace(entry))
		}
		var hash [32]byte
		copy(hash[:], policy)
		policies[hash] = struct{}{}
	}
	trust := teeTrust{applications: applications, policyHashes: policies}
	// The statement names the image it claims; the allowlist above has already
	// checked that name, so asserting it again in the evidence is what binds
	// the name to the hardware report.
	trust.checkEvidence = func(identity platform.Identity) error {
		return sevsnp.Verifier{ExpectedApp: identity.ApplicationID}.CheckEvidence(identity)
	}
	return trust, nil
}

// trustsPolicy reports whether a whitelist digest is one this build pins.
func (t teeTrust) trustsPolicy(digest []byte) bool {
	for policy := range t.policyHashes {
		if subtle.ConstantTimeCompare(digest, policy[:]) == 1 {
			return true
		}
	}
	return false
}

func validApplicationID(application string) bool {
	const prefix = "snp-app:"
	if !strings.HasPrefix(application, prefix) || len(application) != len(prefix)+64 {
		return false
	}
	_, err := hex.DecodeString(application[len(prefix):])
	return err == nil
}

// verifyCredentialKey checks one statement against the caller's challenge and
// this build's trust, and returns the inbox key only if the attested epoch
// signed for it.
func verifyCredentialKey(encoded, nonce []byte, trust teeTrust) (tee.InboxPublic, error) {
	var signed signedCredentialKey
	if err := credentialKeyCBOR.Unmarshal(encoded, &signed); err != nil {
		return tee.InboxPublic{}, fmt.Errorf("%w: decode statement: %v", errInboxAttestation, err)
	}
	// A statement that does not re-encode to exactly these bytes is not one
	// this enclave produced; refuse before any field is trusted.
	reencoded, err := credentialKeyEncoder.Marshal(signed)
	if err != nil || !bytes.Equal(reencoded, encoded) {
		return tee.InboxPublic{}, fmt.Errorf("%w: statement is not canonical", errInboxAttestation)
	}

	statement := signed.Statement
	if statement.Version != credentialKeyVersion {
		return tee.InboxPublic{}, fmt.Errorf("%w: unsupported statement version %d", errInboxAttestation, statement.Version)
	}
	if len(statement.Nonce) != credentialKeyNonceLength || subtle.ConstantTimeCompare(statement.Nonce, nonce) != 1 {
		return tee.InboxPublic{}, fmt.Errorf("%w: the statement answers a different challenge", errInboxAttestation)
	}
	if len(statement.PolicyHash) != sha256.Size || !trust.trustsPolicy(statement.PolicyHash) {
		return tee.InboxPublic{}, fmt.Errorf("%w: the TEE runs a different whitelist than this release trusts", errInboxAttestation)
	}
	if len(statement.InboxKeyID) != sha256.Size || len(statement.InboxPublic) == 0 {
		return tee.InboxPublic{}, fmt.Errorf("%w: the statement carries no usable inbox key", errInboxAttestation)
	}
	if err := validateInboxKey(statement.InboxPublic, statement.InboxKeyID); err != nil {
		return tee.InboxPublic{}, err
	}
	identity, err := credentialKeyIdentity(statement.Attestation)
	if err != nil {
		return tee.InboxPublic{}, err
	}
	if _, ok := trust.applications[identity.ApplicationID]; !ok {
		return tee.InboxPublic{}, fmt.Errorf("%w: attested image %q is not one this release trusts; update Bee", errInboxAttestation, identity.ApplicationID)
	}
	if err := trust.checkEvidence(identity); err != nil {
		return tee.InboxPublic{}, fmt.Errorf("%w: %v", errInboxAttestation, err)
	}

	statementBytes, err := credentialKeyEncoder.Marshal(statement)
	if err != nil {
		return tee.InboxPublic{}, fmt.Errorf("%w: re-encode statement: %v", errInboxAttestation, err)
	}
	if err := platform.VerifySignature(identity, credentialKeyDomain, statementBytes, signed.Signature); err != nil {
		return tee.InboxPublic{}, fmt.Errorf("%w: %v", errInboxAttestation, err)
	}

	key := tee.InboxPublic{PublicKey: append([]byte(nil), statement.InboxPublic...)}
	copy(key.KeyID[:], statement.InboxKeyID)
	return key, nil
}

// credentialKeyIdentity reconstructs the signing identity from the inline
// attestation, applying the same structural checks the receipt verifier does.
func credentialKeyIdentity(ref *credentialKeyAttestation) (platform.Identity, error) {
	if ref == nil {
		return platform.Identity{}, fmt.Errorf("%w: the statement carries no attestation", errInboxAttestation)
	}
	switch {
	case ref.Platform == "":
		return platform.Identity{}, fmt.Errorf("%w: attestation names no platform", errInboxAttestation)
	case ref.AttestationType == "":
		return platform.Identity{}, fmt.Errorf("%w: attestation names no type", errInboxAttestation)
	case ref.ApplicationID == "" || len(ref.ApplicationID) > maxApplicationIDLength:
		return platform.Identity{}, fmt.Errorf("%w: attestation names no usable application", errInboxAttestation)
	case len(ref.KeyID) != sha256.Size:
		return platform.Identity{}, fmt.Errorf("%w: attestation key ID has length %d", errInboxAttestation, len(ref.KeyID))
	case len(ref.PublicKeyDER) == 0:
		return platform.Identity{}, fmt.Errorf("%w: attestation carries no public key", errInboxAttestation)
	case len(ref.EvidenceHash) != sha256.Size:
		return platform.Identity{}, fmt.Errorf("%w: attestation evidence hash has length %d", errInboxAttestation, len(ref.EvidenceHash))
	}
	computed := sha256.Sum256(ref.PublicKeyDER)
	if subtle.ConstantTimeCompare(computed[:], ref.KeyID) != 1 {
		return platform.Identity{}, fmt.Errorf("%w: attestation key ID does not match its public key", errInboxAttestation)
	}

	var identity platform.Identity
	identity.Platform = ref.Platform
	identity.AttestationType = ref.AttestationType
	identity.ApplicationID = ref.ApplicationID
	identity.Evidence = ref.Evidence
	copy(identity.EvidenceHash[:], ref.EvidenceHash)
	identity.PublicKeyDER = ref.PublicKeyDER
	copy(identity.KeyID[:], ref.KeyID)
	return identity, nil
}

func validateInboxKey(der, keyID []byte) error {
	parsed, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return fmt.Errorf("%w: inbox key is not a public key", errInboxAttestation)
	}
	public, ok := parsed.(*ecdh.PublicKey)
	if !ok || public.Curve() != ecdh.X25519() {
		return fmt.Errorf("%w: inbox key is not an X25519 key", errInboxAttestation)
	}
	computed := sha256.Sum256(der)
	if subtle.ConstantTimeCompare(computed[:], keyID) != 1 {
		return fmt.Errorf("%w: inbox key ID does not match its public key", errInboxAttestation)
	}
	return nil
}

// credentialKeyResponse is both wire shapes: the attested endpoint adds
// Attestation, an older one leaves it empty.
type credentialKeyResponse struct {
	KeyID       []byte `json:"key_id"`
	PublicKey   []byte `json:"public_key"`
	Attestation []byte `json:"attestation"`
}

// credentialKeyResponseLimit bounds one answer. A Secure Boot event log can
// reach a mebibyte, and the statement carries it base64-encoded inside JSON.
const credentialKeyResponseLimit = 8 << 20

// fetchInboxKey asks Hive for the TEE inbox key and refuses anything this
// build cannot attribute to a trusted enclave. A challenge makes the answer
// fresh: an old statement, however well signed, cannot answer it.
func fetchInboxKey(ctx context.Context, state localState, staticPin string) (tee.InboxPublic, error) {
	nonce := make([]byte, credentialKeyNonceLength)
	if _, err := rand.Read(nonce); err != nil {
		return tee.InboxPublic{}, fmt.Errorf("generate credential-key challenge: %w", err)
	}
	var response credentialKeyResponse
	path := "/api/bee/credential-key?nonce=" + hex.EncodeToString(nonce)
	if err := callStateLimit(ctx, httpClient(), state, path, "GET", credentialKeyResponseLimit, nil, &response); err != nil {
		return tee.InboxPublic{}, err
	}

	// A build from source talks to a software TEE whose evidence cannot anchor
	// anything; it keeps the historical behaviour so local fixtures work. Every
	// release sets Version, so this branch never runs for sellers.
	if len(response.Attestation) > 0 && Version != "dev" {
		trust, err := loadTEETrust()
		if err != nil {
			return tee.InboxPublic{}, fmt.Errorf("%w: %v", errInboxAttestation, err)
		}
		key, err := verifyCredentialKey(response.Attestation, nonce, trust)
		if err != nil {
			return tee.InboxPublic{}, err
		}
		// The outer fields are what Hive relays to everyone else; the statement
		// is what this Bee will encrypt to. They must be the same key.
		if subtle.ConstantTimeCompare(key.KeyID[:], response.KeyID) != 1 || !bytes.Equal(key.PublicKey, response.PublicKey) {
			return tee.InboxPublic{}, fmt.Errorf("%w: the relayed key is not the attested one", errInboxAttestation)
		}
		if staticPin != "" && hex.EncodeToString(key.KeyID[:]) != staticPin {
			// A TEE restart rotates the inbox key; an attested key is not a
			// reason to stop supplying. Say so once rather than fail silently.
			stalePinOnce.Do(func() {
				slog.Info("pinned TEE inbox key changed; the attested key is used", "module", "egress", "pinned", staticPin, "attested", hex.EncodeToString(key.KeyID[:]))
			})
		}
		return key, nil
	}

	// An unsigned answer is only acceptable when it is pinned directly, which
	// is what every Bee did before the TEE signed its inbox key. Builds from
	// source may run without a pin so local fixtures keep working; a release
	// without a pin refuses, because a key only the relay vouches for is the
	// hole this path closes. A pin, when one is configured, binds every build:
	// an operator who wrote one down asked for exactly that key.
	if staticPin == "" && Version != "dev" {
		return tee.InboxPublic{}, fmt.Errorf("%w: Hive returned no attestation and no inbox_key_id pins a key", errInboxAttestation)
	}
	if len(response.KeyID) != sha256.Size || len(response.PublicKey) == 0 {
		return tee.InboxPublic{}, errInboxIdentity
	}
	key := tee.InboxPublic{PublicKey: response.PublicKey}
	copy(key.KeyID[:], response.KeyID)
	if sha256.Sum256(key.PublicKey) != key.KeyID {
		return tee.InboxPublic{}, errInboxIdentity
	}
	if staticPin != "" && hex.EncodeToString(key.KeyID[:]) != staticPin {
		return tee.InboxPublic{}, errInboxIdentity
	}
	return key, nil
}

var credentialKeyEncoder cbor.EncMode
var credentialKeyCBOR cbor.DecMode

func init() {
	options := cbor.CanonicalEncOptions()
	options.Sort = cbor.SortCanonical
	encoder, err := options.EncMode()
	if err != nil {
		panic("bee: build credential-key encoder: " + err.Error())
	}
	decoder, err := cbor.DecOptions{DupMapKey: cbor.DupMapKeyEnforcedAPF}.DecMode()
	if err != nil {
		panic("bee: build credential-key decoder: " + err.Error())
	}
	credentialKeyEncoder = encoder
	credentialKeyCBOR = decoder
}
