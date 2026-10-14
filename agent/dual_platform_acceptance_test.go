package bee

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// TestDualPlatformSourcesSynchronizeConcurrently is the independent entry
// point for the single-Bee dual-platform acceptance setup. It verifies that
// one egress process starts both platform workers and that a blocked Claude
// source cannot prevent OpenAI synchronization.
func TestDualPlatformSourcesSynchronizeConcurrently(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	var claudePolls, openaiPolls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/bee/platforms/claude/account":
			json.NewEncoder(w).Encode(map[string]any{"platform": "claude"})
		case "/api/bee/platforms/openai/account":
			openaiPolls.Add(1)
			json.NewEncoder(w).Encode(map[string]any{"platform": "openai"})
		default:
			io.WriteString(w, `{}`)
		}
	}))
	defer server.Close()
	cfg := egressConfig{
		Codex: &codexSource{Home: t.TempDir(), Store: "file"},
		Claude: &claudeSource{read: func(context.Context) (claudeCredential, error) {
			claudePolls.Add(1)
			<-ctx.Done()
			return claudeCredential{}, ctx.Err()
		}},
	}
	_, wait := cfg.startSynchronization(ctx, localState{Hive: server.URL, Credential: "bee-test"}, "lease", io.Discard)
	defer wait()
	// Wait on the test's own context rather than a fixed second: under a loaded
	// race-detector run the workers can take longer to make their first call,
	// and a short deadline turns that into a failure about concurrency.
	for ctx.Err() == nil && (claudePolls.Load() == 0 || openaiPolls.Load() == 0) {
		time.Sleep(10 * time.Millisecond)
	}
	if claudePolls.Load() == 0 || openaiPolls.Load() == 0 {
		t.Fatalf("one platform's synchronization never started, so the other was blocked by it: claude=%d openai=%d", claudePolls.Load(), openaiPolls.Load())
	}
}
