package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

// An API reseller (tokhive/hive ADR 0030) is the platform's fallback supply:
// a third-party endpoint such as wokey that the market sends a request to
// when no subscription account can take it. Only a Bee signed in to the
// platform's administrator account may supply one. The key is a static bearer
// token kept in a file of its own; Bee seals it for the TEE, registers its
// fingerprint with Hive, and reports what the reseller says about it.

// resellerEndpoint is what Bee needs to know about a reseller: the upstream
// address the TEE reaches it at, which targets must allow, and its API.
type resellerEndpoint struct {
	target, api string
}

var resellerEndpoints = map[string]resellerEndpoint{
	"wokey": {target: "api.wokey.ai:443", api: "https://api.wokey.ai"},
}

// resellerStatusInterval is how often the key's state, models and balance are
// read from the reseller and reported.
const resellerStatusInterval = 5 * time.Minute

type resellerSource struct {
	Reseller string `json:"reseller"`
	// KeyFile is the absolute path of a file holding only the key, readable
	// by the user running Bee alone.
	KeyFile string `json:"key_file"`

	api       string
	transport http.RoundTripper
	lastState string
	// registered is the lease and key fingerprint Hive last accepted.
	registeredLease, registeredKey string
	reportedAt                     time.Time
}

func (source *resellerSource) validate() error {
	endpoint, ok := resellerEndpoints[source.Reseller]
	if !ok {
		return failf("BEE-CONFIG-RESELLER", "reseller is %q", source.Reseller)
	}
	if source.api == "" {
		source.api = endpoint.api
	}
	if _, err := source.key(); err != nil {
		return err
	}
	return nil
}

// key reads the key file. It is read every cycle, so replacing the key needs
// no restart.
func (source *resellerSource) key() (string, error) {
	if !filepath.IsAbs(source.KeyFile) {
		return "", fail("BEE-CONFIG-RESELLER-KEY", "key_file must be an absolute path")
	}
	info, err := os.Lstat(source.KeyFile)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return "", fail("BEE-CONFIG-RESELLER-KEY", source.KeyFile+" does not exist")
	case err != nil || !info.Mode().IsRegular():
		return "", fail("BEE-CONFIG-RESELLER-KEY", source.KeyFile+" is not a readable regular file")
	case info.Mode().Perm()&0077 != 0:
		return "", failf("BEE-CONFIG-RESELLER-KEY", "%s has mode %04o", source.KeyFile, info.Mode().Perm())
	case info.Size() > 1024:
		return "", fail("BEE-CONFIG-RESELLER-KEY", source.KeyFile+" is too large for a key")
	}
	raw, err := os.ReadFile(source.KeyFile)
	if err != nil {
		return "", fail("BEE-CONFIG-RESELLER-KEY", source.KeyFile+" is not a readable regular file")
	}
	key := strings.TrimSpace(string(raw))
	if key == "" || strings.IndexFunc(key, unicode.IsSpace) >= 0 || (tee.Secret{Header: "authorization", Scheme: "Bearer", Token: key}).Validate() != nil {
		// The key is never echoed.
		return "", fail("BEE-CONFIG-RESELLER-KEY", source.KeyFile+" does not hold a single key")
	}
	return key, nil
}

func fingerprint(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func (source *resellerSource) message(out io.Writer, state, message string) {
	if source.lastState != state {
		notify(out, supplyStateLevel(state), "sync", message, "platform", source.Reseller, "state", state)
		source.lastState = state
	}
}

// synchronize keeps the key registered on this connection and its state
// reported. A key Hive refuses to take from this Bee — it is not the
// platform's — stops the worker, since retrying cannot change the answer.
func (cfg *egressConfig) synchronizeReseller(ctx context.Context, state localState, lease string, out io.Writer, force bool) error {
	source := cfg.Reseller
	key, err := source.key()
	if err != nil {
		source.message(out, "source_unavailable", source.Reseller+" key unavailable: "+err.Error())
		return nil
	}
	keyPrint := fingerprint(key)
	if source.registeredLease != lease || source.registeredKey != keyPrint {
		if err := cfg.registerReseller(ctx, state, lease, key, keyPrint); err != nil {
			return err
		}
		source.registeredLease, source.registeredKey, source.reportedAt = lease, keyPrint, time.Time{}
		slog.Info("reseller key registered", "module", "sync", "reseller", source.Reseller)
	}
	if !force && time.Since(source.reportedAt) < resellerStatusInterval {
		return nil
	}
	status := source.observe(ctx, key, keyPrint)
	err = call(ctx, httpClient(), state.Hive, "/api/bee/resellers/"+source.Reseller+"/status", "POST", state.Credential, status, nil)
	var failure *apiFailure
	if errors.As(err, &failure) && failure.Code == "stale_reseller_key" {
		// Another registration replaced this one; register again next cycle.
		source.registeredLease = ""
		return nil
	}
	if err != nil {
		return err
	}
	source.reportedAt = time.Now()
	switch status.State {
	case beewire.ResellerReady:
		source.message(out, "ready", fmt.Sprintf("%s key ready: %d models", source.Reseller, len(status.Models)))
	case beewire.ResellerInvalidKey:
		source.message(out, status.State, source.Reseller+" rejected the key; replace it in "+source.KeyFile)
	case beewire.ResellerInsufficientBalance:
		source.message(out, status.State, source.Reseller+" balance exhausted; top up the account")
	}
	return nil
}

func (cfg *egressConfig) registerReseller(ctx context.Context, state localState, lease, key, keyPrint string) error {
	var inbox tee.InboxPublic
	if err := call(ctx, httpClient(), state.Hive, "/api/bee/credential-key", "GET", state.Credential, nil, &inbox); err != nil {
		return err
	}
	hash := sha256.Sum256(inbox.PublicKey)
	if hash != inbox.KeyID || cfg.InboxKeyID != "" && hex.EncodeToString(hash[:]) != cfg.InboxKeyID {
		return errInboxIdentity
	}
	envelope, err := tee.EncryptCredential(inbox, beewire.ProviderID(state.Identity.ID), tee.Secret{Header: "authorization", Scheme: "Bearer", Token: key})
	if err != nil {
		return errInboxIdentity
	}
	upload := beewire.CredentialRegistration{Lease: lease, Envelope: envelope, Reseller: &beewire.ResellerKey{Reseller: cfg.Reseller.Reseller, KeyFingerprint: keyPrint}}
	return call(ctx, httpClient(), state.Hive, "/api/bee/credentials", "POST", state.Credential, upload, nil)
}

// observe asks the reseller what it makes of the key: the models it lists and
// the balance left. An unreachable reseller is reported as ready with what
// could be read, rather than taking a working key out of supply; Hive learns
// of a failing reseller from the requests it sends.
func (source *resellerSource) observe(ctx context.Context, key, keyPrint string) beewire.ResellerStatus {
	status := beewire.ResellerStatus{KeyFingerprint: keyPrint, State: beewire.ResellerReady, Models: []string{}}
	var models struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	code := source.get(ctx, key, "/v1/models", &models)
	if code == http.StatusUnauthorized || code == http.StatusForbidden {
		status.State = beewire.ResellerInvalidKey
		return status
	}
	seen := map[string]bool{}
	for _, m := range models.Data {
		if m.ID != "" && !seen[m.ID] && len(status.Models) < 512 {
			seen[m.ID] = true
			status.Models = append(status.Models, m.ID)
		}
	}
	var balance struct {
		Available *json.Number `json:"availableUsd"`
	}
	code = source.get(ctx, key, "/v1/dashboard/balance", &balance)
	switch {
	case code == http.StatusUnauthorized || code == http.StatusForbidden:
		status.State = beewire.ResellerInvalidKey
	case code == http.StatusPaymentRequired:
		status.State = beewire.ResellerInsufficientBalance
	case code == http.StatusOK && balance.Available != nil:
		if value, err := balance.Available.Float64(); err == nil && value >= 0 {
			status.AvailableUSD = strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.9f", value), "0"), ".")
			if value <= 0 {
				status.State = beewire.ResellerInsufficientBalance
			}
		}
	}
	if !status.Valid() {
		// A reseller listing model names Hive would refuse: report the state
		// without them rather than nothing.
		status.Models = []string{}
	}
	return status
}

// get reads one reseller API path into out and returns the HTTP status, or 0
// when the reseller could not be reached or answered something unreadable.
func (source *resellerSource) get(ctx context.Context, key, path string, out any) int {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.api+path, nil)
	if err != nil {
		return 0
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Transport: source.transport}
	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out) != nil {
		return 0
	}
	return resp.StatusCode
}
