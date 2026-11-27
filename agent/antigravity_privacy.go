package bee

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/tokhive/bee/beewire"
)

// Google's "use my interactions to improve products" setting is on by default
// for an Antigravity account, so the requests a Provider's account serves
// would help train Google's products. Bee turns it off the way sub2api does:
// it saves the account's Antigravity user settings as empty, which leaves out
// telemetryEnabled, then reads them back to confirm.
var (
	antigravitySetUserSettings = antigravityCall{"setUserSettings", 1 << 16, 10 * time.Second}
	antigravityFetchUserInfo   = antigravityCall{"fetchUserInfo", 1 << 16, 10 * time.Second}
)

// errAntigravityTelemetry is Google still reporting the setting on.
var errAntigravityTelemetry = errors.New("Google still reports the account's product-improvement setting on")

// antigravityKeepPrivate turns the setting off for the account and confirms
// it. Saving empty settings replaces any other Antigravity user settings the
// account had. Both calls go to the daily host, where the Antigravity app
// makes them.
func antigravityKeepPrivate(ctx context.Context, transport http.RoundTripper, token, project string) error {
	daily := antigravityBase(beewire.AntigravityDailyHost)
	var saved struct {
		Settings map[string]any `json:"userSettings"`
	}
	if err := antigravitySetUserSettings.post(ctx, transport, daily, token, map[string]any{"user_settings": map[string]any{}}, &saved); err != nil {
		return err
	}
	if _, on := saved.Settings["telemetryEnabled"]; on {
		return errAntigravityTelemetry
	}
	var info struct {
		Settings map[string]any `json:"userSettings"`
	}
	if err := antigravityFetchUserInfo.post(ctx, transport, daily, token, map[string]string{"project": project}, &info); err != nil {
		return err
	}
	if _, on := info.Settings["telemetryEnabled"]; on {
		return errAntigravityTelemetry
	}
	return nil
}
