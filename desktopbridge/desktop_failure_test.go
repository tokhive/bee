package desktopbridge

import (
	"encoding/json"
	"errors"
	"fmt"
	bee "github.com/tokhive/bee/agent"
	"strings"
	"testing"
)

func TestDesktopFailureBridgePreservesWrappingAndSafeDetails(t *testing.T) {
	cause := &bee.DesktopFailure{Code: "device_replaced", Message: "GET identity HTTP 401", Details: &bee.DesktopFailureDetails{Check: "device_identity", ObservedAt: "2026-10-30T12:00:00Z", Evidence: map[string]string{"http_status": "401"}}, Cause: errors.New("private cause")}
	failure := operationFailure("SUPPLY_OPERATION_FAILED", fmt.Errorf("supply identity check failed: %w", cause))
	if failure.Code != "device_replaced" || !strings.Contains(failure.Message, "supply identity check failed") || failure.Details != cause.Details {
		t.Fatalf("structured evidence lost: %+v", failure)
	}
	raw, _ := json.Marshal(failure)
	if strings.Contains(string(raw), "private cause") {
		t.Fatal("internal cause serialized")
	}
}
func TestDesktopFailureProtocolErrorStrictDetailsAndLegacyCompatibility(t *testing.T) {
	var failure protocolError
	for _, raw := range []string{`{"code":"OLD","message":"legacy"}`, `{"code":"http_rejected","message":"HTTP 503","details":{"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{}}}`} {
		if err := json.Unmarshal([]byte(raw), &failure); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{`{"code":"X","message":"failure","details":null}`, `{"code":"X","message":"failure","details":{"check":"read","observed_at":"2026-10-30T12:00:00Z","evidence":{},"extra":true}}`, `{"code":"X","message":"failure","extra":true}`} {
		if err := json.Unmarshal([]byte(raw), &failure); err == nil {
			t.Fatal("invalid failure accepted")
		}
	}
}
