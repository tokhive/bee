package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

type openaiAPISource struct {
	LocalURL                       string   `json:"local_url,omitempty"`
	KeyFile                        string   `json:"key_file"`
	Models                         []string `json:"models"`
	transport                      http.RoundTripper
	registeredLease, registeredKey string
	reportedAt                     time.Time
	lastState                      string
}

func (s *openaiAPISource) key() (string, error) {
	return readStaticKeyFile(s.KeyFile, "BEE-CONFIG-OPENAI-API-KEY")
}
func (s *openaiAPISource) validate() error {
	if s.LocalURL != "" {
		u, err := url.Parse(s.LocalURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
			return fail("BEE-CONFIG-OPENAI-API", "local_url must be a loopback test endpoint")
		}
	}

	if len(s.Models) == 0 || !beewire.ValidModelIDs(s.Models) {
		return fail("BEE-CONFIG-OPENAI-API", "models must select 1 to 512 distinct model IDs")
	}
	_, err := s.key()
	return err
}
func (s *openaiAPISource) message(out io.Writer, state, message string) {
	if s.lastState != state {
		notify(out, supplyStateLevel(state), "sync", message, "platform", "openai_api", "state", state)
		s.lastState = state
	}
}
func (cfg *egressConfig) synchronizeOpenAIAPI(ctx context.Context, state localState, lease string, out io.Writer, force bool) error {
	s := cfg.OpenAIAPI
	key, err := s.key()
	if err != nil {
		// Expire supply immediately when the local file is removed, rather than
		// waiting for the source lease to time out.
		if s.registeredKey != "" {
			_ = call(ctx, httpClient(), state.Hive, "/api/bee/openai-api/status", "POST", state.Credential, beewire.OpenAIAPIStatus{Lease: lease, KeyFingerprint: s.registeredKey, Models: []string{}}, nil)
		}
		s.message(out, "source_unavailable", "OpenAI API key file unavailable; supply paused")
		return nil
	}
	print := fingerprint(key)
	// Re-seal periodically as well as on rotation, so TEE inbox rotation does
	// not leave a long-lived static key bound to an obsolete recipient.
	if force || s.registeredLease != lease || s.registeredKey != print || time.Since(s.reportedAt) >= 10*time.Second {
		var inbox tee.InboxPublic
		if err = call(ctx, httpClient(), state.Hive, "/api/bee/credential-key", "GET", state.Credential, nil, &inbox); err != nil {
			return err
		}
		if sha256.Sum256(inbox.PublicKey) != inbox.KeyID || cfg.InboxKeyID != "" && hex.EncodeToString(inbox.KeyID[:]) != cfg.InboxKeyID {
			return errInboxIdentity
		}
		envelope, err := tee.EncryptCredential(inbox, beewire.ProviderID(state.Identity.ID), tee.Secret{Header: "authorization", Scheme: "Bearer", Token: key})
		if err != nil {
			return errInboxIdentity
		}
		if err = call(ctx, httpClient(), state.Hive, "/api/bee/credentials", "POST", state.Credential, beewire.CredentialRegistration{Lease: lease, Envelope: envelope, OpenAIAPI: &beewire.OpenAIAPIKey{KeyFingerprint: print}}, nil); err != nil {
			return err
		}
		s.registeredLease, s.registeredKey = lease, print
	} else {
		return nil
	}
	report := beewire.OpenAIAPIStatus{Lease: lease, KeyFingerprint: print, Models: []string{}}
	observe, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	api := "https://api.openai.com"
	if s.LocalURL != "" {
		api = s.LocalURL
	}
	req, _ := http.NewRequestWithContext(observe, http.MethodGet, api+"/v1/models", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	client := &http.Client{Transport: s.transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err == nil {
		defer res.Body.Close()
		var listed struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if res.StatusCode == 200 && json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&listed) == nil {
			for _, m := range listed.Data {
				if slices.Contains(s.Models, m.ID) && !slices.Contains(report.Models, m.ID) {
					report.Models = append(report.Models, m.ID)
				}
			}
			report.Ready = true
		}
	}
	if err = call(ctx, httpClient(), state.Hive, "/api/bee/openai-api/status", "POST", state.Credential, report, nil); err != nil {
		return err
	}
	s.reportedAt = time.Now()
	if report.Ready {
		s.message(out, "ready", "OpenAI API key synchronized")
	} else {
		s.message(out, "source_unavailable", "OpenAI API model access unavailable; supply paused")
	}
	return nil
}
