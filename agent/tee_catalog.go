package bee

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/hiddeco/sshsig"
	"golang.org/x/crypto/ssh"
)

// A TEE release replaces the measured image, so a Bee that trusted only the
// images compiled into it stopped supplying until it was rebuilt. The signed
// release catalog removes that step: every TEE release publishes catalog.json
// and its SSHSIG signature, made with the offline release-signing key, and the
// catalog records which image each environment runs. A Bee downloads it,
// checks the signature against the key compiled in below, and trusts the
// images the catalog says the environment currently runs.
//
// Nothing about the trust anchor is fetched: the signing key, the namespace
// and the environment are build inputs, so whoever serves the files can only
// withhold them, never widen what is trusted. When no signed catalog can be
// had, the compiled-in pins in tee_credential.go still apply.
var (
	// TEECatalogURL is the directory the catalog and its signature are
	// downloaded from. GitHub serves the newest non-prerelease under
	// releases/latest, which is where production TEE releases go; staging
	// releases are prereleases signed with another key. Empty disables the
	// online catalog.
	TEECatalogURL = "https://github.com/tokhive/tee/releases/latest/download/"

	// TEECatalogSigningKey is the production release-signing public key,
	// SHA256:A7HhHJgJmWp4xbtwhD/4IL5Ua6XUWG9FahuP0KNPoNk, published on
	// tokhive.ai and in every production TEE release.
	TEECatalogSigningKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDY37j7Z7Akukw/a5J66WQbTEEfMXJGoEjnt7vBaDFsg"

	// TEECatalogEnvironment is the deployment environment whose active images
	// this build trusts.
	TEECatalogEnvironment = "production"

	// TEECatalogNotBefore is the newest deployment event this build was cut
	// after. A catalog whose latest event is older is a replay of a stale one
	// and is refused, so withholding newer releases cannot bring back an image
	// that had already been retired when this build shipped.
	TEECatalogNotBefore = "2026-11-27T03:07:53Z"
)

const (
	teeCatalogNamespace      = "tokhive-tee-release"
	teeCatalogLimit          = 4 << 20
	teeCatalogSignatureLimit = 64 << 10
	// A catalog is reused this long before it is downloaded again; an image
	// the cached one does not list triggers a download sooner, at most once
	// per teeCatalogRetry.
	teeCatalogTTL   = 10 * time.Minute
	teeCatalogRetry = 30 * time.Second
)

// errUntrustedTEE marks a statement refused only because the image or its
// whitelist is not in the trust in use, the one refusal a newer catalog can
// change.
var errUntrustedTEE = errors.New("untrusted TEE release")

type teeCatalogFile struct {
	Releases []struct {
		ApplicationID string `json:"application_id"`
		PolicyHash    string `json:"policy_hash"`
	} `json:"releases"`
	DeploymentEvents []struct {
		Environment   string `json:"environment"`
		ApplicationID string `json:"application_id"`
		Action        string `json:"action"`
		At            string `json:"at"`
	} `json:"deployment_events"`
}

// catalogTrust is what a verified catalog contributes: the images the
// environment runs now, their whitelists, and the newest event it records.
type catalogTrust struct {
	applications map[string]struct{}
	policyHashes map[[32]byte]struct{}
	latest       time.Time
}

// parseTEECatalog reads the active images of one environment from a catalog
// whose signature has already been checked. Events apply in the order they
// are listed; an image counts once it is activated and stops once it is
// deactivated.
func parseTEECatalog(data []byte, environment string) (catalogTrust, error) {
	var file teeCatalogFile
	if err := json.Unmarshal(data, &file); err != nil {
		return catalogTrust{}, fmt.Errorf("decode TEE release catalog: %w", err)
	}
	policies := map[string][32]byte{}
	for _, release := range file.Releases {
		application := strings.ToLower(release.ApplicationID)
		policy, err := hex.DecodeString(release.PolicyHash)
		if !validApplicationID(application) || err != nil || len(policy) != 32 {
			return catalogTrust{}, fmt.Errorf("TEE release catalog lists an unusable release %q", release.ApplicationID)
		}
		var hash [32]byte
		copy(hash[:], policy)
		policies[application] = hash
	}
	trust := catalogTrust{applications: map[string]struct{}{}, policyHashes: map[[32]byte]struct{}{}}
	active := map[string]bool{}
	for _, event := range file.DeploymentEvents {
		at, err := time.Parse(time.RFC3339, event.At)
		if err != nil {
			return catalogTrust{}, fmt.Errorf("TEE release catalog has an unreadable event time %q", event.At)
		}
		if at.After(trust.latest) {
			trust.latest = at
		}
		if event.Environment != environment {
			continue
		}
		application := strings.ToLower(event.ApplicationID)
		switch event.Action {
		case "activate":
			active[application] = true
		case "deactivate":
			delete(active, application)
		default:
			return catalogTrust{}, fmt.Errorf("TEE release catalog has an unknown action %q", event.Action)
		}
	}
	for application := range active {
		policy, ok := policies[application]
		if !ok {
			return catalogTrust{}, fmt.Errorf("TEE release catalog activates %s without a release entry", application)
		}
		trust.applications[application] = struct{}{}
		trust.policyHashes[policy] = struct{}{}
	}
	if len(trust.applications) == 0 {
		return catalogTrust{}, fmt.Errorf("TEE release catalog has no active %s image", environment)
	}
	return trust, nil
}

// verifyTEECatalog checks the SSHSIG signature over the exact catalog bytes
// with the compiled-in signing key and namespace.
func verifyTEECatalog(data, armored []byte) error {
	public, _, _, _, err := ssh.ParseAuthorizedKey([]byte(TEECatalogSigningKey))
	if err != nil {
		return fmt.Errorf("this Bee build has no usable TEE catalog signing key: %w", err)
	}
	signature, err := sshsig.Unarmor(armored)
	if err != nil {
		return fmt.Errorf("read TEE release catalog signature: %w", err)
	}
	if err := sshsig.Verify(bytes.NewReader(data), signature, public, signature.HashAlgorithm, teeCatalogNamespace); err != nil {
		return fmt.Errorf("TEE release catalog signature does not verify: %w", err)
	}
	return nil
}

// teeCatalog caches the last verified catalog. Its newest event only moves
// forward: a download that is older than one already accepted is refused.
type teeCatalog struct {
	mu        sync.Mutex
	trust     *catalogTrust
	fetchedAt time.Time
	triedAt   time.Time
	now       func() time.Time
	client    *http.Client
}

var sharedTEECatalog = &teeCatalog{now: time.Now, client: teeCatalogClient()}

func teeCatalogClient() *http.Client {
	return &http.Client{
		Timeout: 20 * time.Second,
		// releases/latest/download redirects to the asset host; follow only
		// HTTPS. The signature, not the transport, is what is trusted.
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if request.URL.Scheme != "https" {
				return errors.New("refusing a non-HTTPS redirect")
			}
			return nil
		},
	}
}

// current returns the trust from a verified catalog, downloading one when the
// cache is older than teeCatalogTTL or when force asks for a newer one. It
// returns nil when no verified catalog is available; the caller then uses the
// compiled-in pins.
func (c *teeCatalog) current(ctx context.Context, force bool) *catalogTrust {
	if TEECatalogURL == "" {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	stale := c.trust == nil || now.Sub(c.fetchedAt) >= teeCatalogTTL
	if (stale || force) && now.Sub(c.triedAt) >= teeCatalogRetry {
		c.triedAt = now
		trust, err := c.download(ctx)
		switch {
		case err != nil:
			slog.Warn("TEE release catalog unavailable; using the trust already in hand", "module", "egress", "error", err)
		case c.trust != nil && trust.latest.Before(c.trust.latest):
			slog.Warn("refused a TEE release catalog older than one already accepted", "module", "egress", "latest", trust.latest, "accepted", c.trust.latest)
		default:
			c.trust = &trust
			c.fetchedAt = now
		}
	}
	return c.trust
}

func (c *teeCatalog) download(ctx context.Context) (catalogTrust, error) {
	data, err := c.get(ctx, "catalog.json", teeCatalogLimit)
	if err != nil {
		return catalogTrust{}, err
	}
	signature, err := c.get(ctx, "catalog.json.sig", teeCatalogSignatureLimit)
	if err != nil {
		return catalogTrust{}, err
	}
	if err := verifyTEECatalog(data, signature); err != nil {
		return catalogTrust{}, err
	}
	trust, err := parseTEECatalog(data, TEECatalogEnvironment)
	if err != nil {
		return catalogTrust{}, err
	}
	if TEECatalogNotBefore != "" {
		floor, err := time.Parse(time.RFC3339, TEECatalogNotBefore)
		if err != nil {
			return catalogTrust{}, fmt.Errorf("this Bee build has an unusable TEECatalogNotBefore: %w", err)
		}
		if trust.latest.Before(floor) {
			return catalogTrust{}, fmt.Errorf("TEE release catalog ends at %s, before this build (%s)", trust.latest.Format(time.RFC3339), TEECatalogNotBefore)
		}
	}
	return trust, nil
}

func (c *teeCatalog) get(ctx context.Context, name string, limit int64) ([]byte, error) {
	base, err := url.Parse(TEECatalogURL)
	if err != nil {
		return nil, fmt.Errorf("this Bee build has an unusable TEECatalogURL: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base.JoinPath(name).String(), nil)
	if err != nil {
		return nil, err
	}
	response, err := c.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("download TEE release %s: %w", name, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download TEE release %s: HTTP %d", name, response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("download TEE release %s: %w", name, err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("TEE release %s is larger than %d bytes", name, limit)
	}
	return data, nil
}

// withCatalog replaces the compiled-in images and whitelists with the ones a
// verified catalog lists. A catalog that retires an image therefore revokes it
// even when this build still pins it.
func (t teeTrust) withCatalog(catalog *catalogTrust) teeTrust {
	if catalog == nil {
		return t
	}
	t.applications = catalog.applications
	t.policyHashes = catalog.policyHashes
	return t
}
