package bee

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tokhive/bee/beewire"
)

func TestMainSourceAndAccountHelpersPreserveRuntimeEpoch(t *testing.T) {
	keyFile := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(keyFile, []byte("synthetic-api-key"), 0600); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		call func(localState)
	}{
		{"OpenAI API registration", func(state localState) {
			cfg := egressConfig{OpenAIAPI: &openaiAPISource{KeyFile: keyFile}}
			_ = cfg.synchronizeOpenAIAPI(context.Background(), state, "lease", io.Discard, true)
		}},
		{"OpenAI API source unavailable", func(state localState) {
			cfg := egressConfig{OpenAIAPI: &openaiAPISource{KeyFile: keyFile + ".absent", registeredKey: "registered"}}
			_ = cfg.synchronizeOpenAIAPI(context.Background(), state, "lease", io.Discard, true)
		}},
		{"reseller registration", func(state localState) {
			cfg := egressConfig{Reseller: &resellerSource{Reseller: "openrouter"}}
			_ = cfg.registerReseller(context.Background(), state, "lease", "synthetic-key", "fingerprint")
		}},
		{"reseller charge cursor", func(state localState) {
			source := resellerSource{Reseller: "openrouter"}
			_ = source.resumeCharges(context.Background(), state)
		}},
		{"account read", func(state localState) {
			_, _ = readPlatformAccount(context.Background(), state, "openai")
		}},
		{"account confirmation", func(state localState) {
			_, _ = submitAccountConfirmation(context.Background(), state, "openai", "fingerprint", "confirmation")
		}},
		{"supply change", func(state localState) {
			_, _ = updatePlatformSupply(context.Background(), httpClient(), state, "openai", true)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			epoch := strings.Repeat("a", 48)
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if actual := r.Header.Get(beewire.RuntimeEpochHeader); actual != epoch {
					t.Errorf("%s %s runtime epoch=%q; required=%q", r.Method, r.URL.Path, actual, epoch)
				}
				// Stop before any official API call or credential upload.
				w.WriteHeader(http.StatusServiceUnavailable)
			}))
			defer server.Close()
			tc.call(localState{Hive: server.URL, Credential: "synthetic-device", RuntimeEpoch: epoch})
			if actual := requests.Load(); actual != 1 {
				t.Fatalf("Hive requests=%d; required=1", actual)
			}
		})
	}
}
