package bee

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"testing"

	"github.com/tokhive/tee/shared"
)

// productionReleaseKeySHA256 is the SHA-256 of the DER SubjectPublicKeyInfo of
// the Secure Boot release key R that production TEE images are booted under,
// confirmed against the production Hive's HIVE_TEE_RELEASE_PUBLIC_KEY on
// 2026-11-19.
//
// A release Bee checks TEE evidence against this key before it seals any
// credential, and halts when the evidence names another one. When
// TEEReleaseKeyPEM is empty the key comes from the tee module's committed
// shared/secure_boot_release_pub.pem, which anyone regenerating Secure Boot
// material can overwrite; bumping the tee dependency would then stop every
// production Bee from supplying. Change this value only when production
// actually rotates R, together with TEEReleaseKeyPEM or the tee dependency.
const productionReleaseKeySHA256 = "1af0aa2c8d13c1c0546d878e49710c9f247d2c1d846c6d8a2445c1ea0daffcd9"

func TestReleaseKeyIsProductions(t *testing.T) {
	got, source := releaseKeyFingerprint(t)
	if got != productionReleaseKeySHA256 {
		t.Fatalf("the %s Secure Boot release key is %s, but production TEE images boot under %s; "+
			"a release built from this tree would refuse every production TEE",
			source, got, productionReleaseKeySHA256)
	}
}

// releaseKeyFingerprint returns the fingerprint of the release key a release
// build would verify evidence against, and where that key comes from.
func releaseKeyFingerprint(t *testing.T) (string, string) {
	t.Helper()
	if TEEReleaseKeyPEM == "" {
		fingerprint, err := shared.ReleasePublicKeySHA256()
		if err != nil {
			t.Fatalf("read the tee module's embedded release key: %v", err)
		}
		return fingerprint, "tee module's embedded"
	}
	block, _ := pem.Decode([]byte(TEEReleaseKeyPEM))
	if block == nil {
		t.Fatal("TEEReleaseKeyPEM is not PEM")
	}
	key, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		t.Fatalf("TEEReleaseKeyPEM is not a public key: %v", err)
	}
	spki, err := x509.MarshalPKIXPublicKey(key)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(spki)
	return hex.EncodeToString(sum[:]), "compiled-in TEEReleaseKeyPEM"
}
