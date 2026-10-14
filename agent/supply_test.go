package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

// A Provider replacing its device sees why the old one stopped taking work,
// not the catch-all line reserved for reasons this build does not know.
func TestSupplyStatusNamesDeviceDraining(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/bee/platforms/openai" || r.Method != "GET" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Reasons: []string{"device_draining"}})
	}))
	defer server.Close()
	var out strings.Builder
	if err := platformControl(context.Background(), httpClient(), localState{Hive: server.URL, Credential: "bee-test"}, "openai", "supply-status", &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "device being replaced; finishing in-flight execution and settlement") || strings.Contains(out.String(), "awaiting verification") {
		t.Fatalf("draining was not named: %q", out.String())
	}
}
