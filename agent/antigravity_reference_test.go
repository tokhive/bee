package bee

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestAntigravityThinkingLevelsAndSpentModels(t *testing.T) {
	now := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	var listing struct {
		Models        map[string]json.RawMessage `json:"models"`
		GroupedModels map[string]json.RawMessage `json:"groupedModels"`
	}
	raw := `{
	  "models": {
	    "gemini-4-argon-low": {"quotaInfo": {"remainingFraction": 0.5, "resetTime": "2026-11-27T12:00:00Z"}},
	    "gemini-4-argon-high": {"quotaInfo": {"remainingFraction": 1}},
	    "gemini-4-hydrogen-sonar": {"quotaInfo": {"resetTime": "2026-11-27T11:00:00Z"}},
	    "gemini-4-hydrogen": {"quotaInfo": {"remainingFraction": 0, "resetTime": "2026-11-27T09:00:00Z"}},
	    "gemini-4-neon": {}
	  },
	  "groupedModels": {
	    "gemini-4-argon": {"supportedThinkingLevels": [{"thinkingSuffix": "LOW"}, {"thinkingSuffix": "high"}, {"thinkingSuffix": "max"}]},
	    "gemini-4-hydrogen": {"supportedThinkingLevels": [{"thinkingSuffix": "sonar"}]}
	  }
	}`
	if err := json.Unmarshal([]byte(raw), &listing); err != nil {
		t.Fatal(err)
	}
	models := antigravityModels(listing.Models)
	levels := antigravityThinkingLevels(listing.GroupedModels, models)
	// A declared level the listing does not carry (max) is left out.
	if strings.Join(levels["gemini-4-argon"], ",") != "low,high" || strings.Join(levels["gemini-4-hydrogen"], ",") != "sonar" {
		t.Fatalf("levels: %v", levels)
	}
	spent := antigravitySpent(listing.Models, now)
	// A fraction left out is zero; a reset already past is no longer spent.
	if len(spent) != 1 || !spent["gemini-4-hydrogen-sonar"].Equal(now.Add(time.Hour)) {
		t.Fatalf("spent: %v", spent)
	}
	available, declared := antigravityAvailable(models, levels, spent, now)
	if slices.Contains(available, "gemini-4-hydrogen-sonar") || !slices.Contains(available, "gemini-4-hydrogen") || declared["gemini-4-hydrogen"] != nil || len(declared["gemini-4-argon"]) != 2 {
		t.Fatalf("available %v declared %v", available, declared)
	}
	// Once its quota resets, the model is offered again without a new listing.
	if available, _ := antigravityAvailable(models, levels, spent, now.Add(2*time.Hour)); !slices.Contains(available, "gemini-4-hydrogen-sonar") {
		t.Fatalf("after the reset: %v", available)
	}
}

func TestAntigravityKeepPrivate(t *testing.T) {
	var saved string
	google := &googleFake{t: t, answer: map[string]func(*http.Request, string) (int, string){
		googleDaily + "setUserSettings": func(_ *http.Request, body string) (int, string) {
			saved = body
			return 200, `{"userSettings":{}}`
		},
		googleDaily + "fetchUserInfo": googleAnswer(200, `{"userSettings":{},"regionCode":"US"}`),
	}}
	if err := antigravityKeepPrivate(context.Background(), google, antigravityTestAccess, "synthetic-project-1"); err != nil {
		t.Fatal(err)
	}
	if saved != `{"user_settings":{}}` {
		t.Fatalf("settings saved: %s", saved)
	}
	google.answer[googleDaily+"fetchUserInfo"] = googleAnswer(200, `{"userSettings":{"telemetryEnabled":true}}`)
	if err := antigravityKeepPrivate(context.Background(), google, antigravityTestAccess, "synthetic-project-1"); !errors.Is(err, errAntigravityTelemetry) {
		t.Fatalf("a setting Google still reports on: %v", err)
	}
	google.answer[googleDaily+"setUserSettings"] = googleAnswer(403, `{"error":{"code":403,"message":"denied","status":"PERMISSION_DENIED"}}`)
	if err := antigravityKeepPrivate(context.Background(), google, antigravityTestAccess, "synthetic-project-1"); err == nil {
		t.Fatal("a refused save was taken for success")
	}
}

// A sign-in turns the product-improvement setting off and remembers that
// Google confirmed it; one Google does not confirm still signs in, and a
// later refresh tries again.
func TestAntigravityLoginTurnsOffProductImprovement(t *testing.T) {
	fixture := newAntigravityLogin(t)
	if err := fixture.login.report(context.Background()); err != nil {
		t.Fatal(err)
	}
	if stored, err := fixture.login.store.read(); err != nil || !stored.Private || fixture.google.count(googleDaily+"setUserSettings") != 1 {
		t.Fatalf("private=%v err=%v", stored.Private, err)
	}
	fixture = newAntigravityLogin(t)
	fixture.google.answer[googleDaily+"fetchUserInfo"] = googleAnswer(200, `{"userSettings":{"telemetryEnabled":true}}`)
	if err := fixture.login.report(context.Background()); err != nil {
		t.Fatal("an unconfirmed setting stopped the sign-in:", err)
	}
	if stored, _ := fixture.login.store.read(); stored.Private || !strings.Contains(fixture.out.String(), "try again") {
		t.Fatalf("an unconfirmed setting was recorded as off: %v %q", stored.Private, fixture.out.String())
	}
}

func TestSupplyNoticeText(t *testing.T) {
	text := supplyNoticeText(beewire.SupplyNotice{Reason: "validation_required", URL: "https://accounts.google.com/verify"})
	if !strings.Contains(text, "verify") || !strings.HasSuffix(text, "https://accounts.google.com/verify") {
		t.Fatal(text)
	}
	if text := supplyNoticeText(beewire.SupplyNotice{Reason: "terms_of_service"}); !strings.Contains(text, "appeal") {
		t.Fatal(text)
	}
}
