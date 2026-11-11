package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

func TestAccountInUseIsActionableAndCannotBeConfirmed(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		t.Run(platform, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("a blocked account must not submit confirmation")
				}
				json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: platform, Status: "account_in_use", PendingFingerprint: strings.Repeat("a", 64)})
			}))
			defer server.Close()
			state := localState{Hive: server.URL}
			var out bytes.Buffer
			if err := accountControl(context.Background(), state, platform, "", false, &out); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(out.String(), "another Provider") || !strings.Contains(out.String(), "different account") {
				t.Fatal(out.String())
			}
			if err := accountControl(context.Background(), state, platform, strings.Repeat("a", 64), true, &out); err == nil || !strings.Contains(err.Error(), "another Provider") {
				t.Fatalf("blocked confirmation: %v", err)
			}
		})
	}
}
