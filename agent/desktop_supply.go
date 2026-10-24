package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

// DesktopSupply reports only Hive-confirmed state. It carries no credentials or
// local write intent; a fresh read is required after any unconfirmed operation.
type DesktopSupply struct {
	Hive      string   `json:"hive"`
	DeviceID  string   `json:"device_id"`
	Platform  string   `json:"platform"`
	Paused    bool     `json:"paused"`
	Ready     bool     `json:"ready"`
	Reasons   []string `json:"reasons"`
	CheckedAt string   `json:"checked_at"`
}

func (d *DesktopDevice) SupplyStatus(ctx context.Context, platform string) (DesktopSupply, error) {
	return d.operateSupply(ctx, platform, nil)
}

func (d *DesktopDevice) SetPaused(ctx context.Context, platform string, paused bool) (DesktopSupply, error) {
	return d.operateSupply(ctx, platform, &paused)
}

func (d *DesktopDevice) operateSupply(ctx context.Context, platform string, paused *bool) (DesktopSupply, error) {
	if platform != "openai" && platform != "claude" {
		return DesktopSupply{}, errors.New("supply platform rejected: not in allowed set; required=openai,claude")
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	path, err := d.configPath()
	if err != nil {
		return DesktopSupply{}, err
	}
	unlock, err := lockState(path)
	if err != nil {
		return DesktopSupply{}, err
	}
	defer unlock()
	state, err := readState(path)
	if err != nil {
		return DesktopSupply{}, err
	}
	if state.Identity == nil || state.Credential == "" {
		return DesktopSupply{}, fmt.Errorf("supply binding absent: saved_identity=%t, credential_present=%t; an already bound desktop device is required", state.Identity != nil, state.Credential != "")
	}
	origin, err := hiveOrigin(state.Hive)
	if err != nil {
		return DesktopSupply{}, fmt.Errorf("validate stored desktop Hive for supply: %w", err)
	}
	if origin != state.Hive {
		return DesktopSupply{}, errors.New("stored desktop Hive is not a canonical origin; supply blocked")
	}
	if !deviceCredentialPattern.MatchString(state.Credential) {
		return DesktopSupply{}, errors.New("stored desktop credential format rejected; required=bee_ followed by 43 URL-safe characters")
	}
	if err = validateDesktopIdentity(state, *state.Identity); err != nil {
		return DesktopSupply{}, fmt.Errorf("validate saved supply identity: %w", err)
	}
	var identity beewire.Identity
	if err = desktopCall(ctx, state, "/api/bee/identity", http.MethodGet, state.Credential, nil, &identity); err != nil {
		return DesktopSupply{}, fmt.Errorf("supply identity check failed: %w", err)
	}
	if err = validateDesktopIdentity(state, identity); err != nil {
		return DesktopSupply{}, err
	}
	if paused != nil {
		written, err := desktopSupplyCall(ctx, state, platform, paused)
		if err != nil {
			return DesktopSupply{}, fmt.Errorf("supply write result unconfirmed; do not replay PUT; recheck with GET: %w", err)
		}
		if written.Paused != *paused {
			return DesktopSupply{}, fmt.Errorf("supply write result unconfirmed: PUT paused=%t, required=%t; do not replay PUT; recheck with GET", written.Paused, *paused)
		}
	}
	result, err := desktopSupplyCall(ctx, state, platform, nil)
	if paused != nil {
		if err != nil {
			return DesktopSupply{}, fmt.Errorf("supply write result unconfirmed; GET readback failed; do not replay PUT: %w", err)
		}
		if result.Paused != *paused {
			return DesktopSupply{}, fmt.Errorf("supply write result unconfirmed: GET readback paused=%t, required=%t; do not replay PUT", result.Paused, *paused)
		}
	}
	if err != nil {
		return DesktopSupply{}, err
	}
	return DesktopSupply{Hive: state.Hive, DeviceID: identity.ID, Platform: result.Platform, Paused: result.Paused, Ready: result.Ready, Reasons: result.Reasons, CheckedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func desktopSupplyCall(ctx context.Context, state localState, platform string, paused *bool) (beewire.PlatformSupply, error) {
	method := http.MethodGet
	path := "/api/bee/platforms/" + platform
	var body io.Reader
	if paused != nil {
		method = http.MethodPut
		data, _ := json.Marshal(struct {
			Paused bool `json:"paused"`
		}{Paused: *paused})
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, state.Hive+path, body)
	if err != nil {
		return beewire.PlatformSupply{}, fmt.Errorf("build %s %s: %w", method, path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hive-Request", "1")
	req.Header.Set("User-Agent", userAgent())
	req.Header.Set("Authorization", "Bearer "+state.Credential)
	// No idempotency header and no application retry: a lost PUT response can
	// mean a committed owner/platform change, not permission to repeat the write.
	response, err := httpClient().Do(req)
	if err != nil {
		return beewire.PlatformSupply{}, fmt.Errorf("%s %s transport failed: %w", method, path, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil {
		return beewire.PlatformSupply{}, fmt.Errorf("read %s %s HTTP %d: %w", method, path, response.StatusCode, err)
	}
	if len(data) > 65536 {
		return beewire.PlatformSupply{}, fmt.Errorf("%s %s HTTP %d: response bytes exceed 65536", method, path, response.StatusCode)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		decodeErr := json.Unmarshal(data, &failure)
		return beewire.PlatformSupply{}, fmt.Errorf("%s %s: HTTP %d, code=%q, error_json_valid=%t", method, path, response.StatusCode, safeCode(failure.Error.Code), decodeErr == nil)
	}
	result, err := decodeDesktopSupply(data, platform)
	if err != nil {
		return beewire.PlatformSupply{}, fmt.Errorf("%s %s HTTP %d: %w", method, path, response.StatusCode, err)
	}
	return result, nil
}

// Parse the object token by token: ordinary Unmarshal accepts duplicate fields
// and null booleans, which cannot establish authoritative supply state.
func decodeDesktopSupply(data []byte, platform string) (beewire.PlatformSupply, error) {
	result := beewire.PlatformSupply{}
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return result, fmt.Errorf("supply object start rejected at byte=%d; required=JSON object", decoder.InputOffset())
	}
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return result, fmt.Errorf("supply field name JSON rejected at byte=%d", decoder.InputOffset())
		}
		field, ok := token.(string)
		if !ok {
			return result, errors.New("supply field name type rejected; required=string")
		}
		switch field {
		case "platform", "paused", "ready", "reasons":
		default:
			return result, fmt.Errorf("unknown supply field rejected at byte=%d; required=platform,paused,ready,reasons", decoder.InputOffset())
		}
		if _, exists := fields[field]; exists {
			return result, fmt.Errorf("duplicate supply field rejected: field=%s", field)
		}
		var raw json.RawMessage
		if err = decoder.Decode(&raw); err != nil {
			return result, fmt.Errorf("supply value JSON rejected: field=%s, byte=%d", field, decoder.InputOffset())
		}
		fields[field] = raw
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') {
		return result, fmt.Errorf("supply object end rejected at byte=%d", decoder.InputOffset())
	}
	if _, err = decoder.Token(); err != io.EOF {
		return result, fmt.Errorf("trailing supply JSON rejected at byte=%d; required=end of response", decoder.InputOffset())
	}
	for _, field := range []string{"platform", "paused", "ready", "reasons"} {
		raw, ok := fields[field]
		if !ok {
			return result, fmt.Errorf("required supply field missing: field=%s", field)
		}
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return result, fmt.Errorf("null supply field rejected: field=%s", field)
		}
	}
	for _, field := range []struct {
		name  string
		value any
		kind  string
	}{
		{"platform", &result.Platform, "string"}, {"paused", &result.Paused, "boolean"}, {"ready", &result.Ready, "boolean"}, {"reasons", &result.Reasons, "string array"},
	} {
		if err = json.Unmarshal(fields[field.name], field.value); err != nil {
			return result, fmt.Errorf("supply field type rejected: field=%s, required=%s", field.name, field.kind)
		}
	}
	if result.Platform != platform {
		actual := "unrecognized_platform"
		if result.Platform == "openai" || result.Platform == "claude" {
			actual = result.Platform
		}
		return result, fmt.Errorf("supply platform mismatch: actual=%s, required=%s", actual, platform)
	}
	seen := map[string]bool{}
	for index, reason := range result.Reasons {
		if !slices.Contains(beewire.SupplyReasons(), reason) {
			return result, fmt.Errorf("unknown supply reason rejected: index=%d; required=known supply reason", index)
		}
		if (platform == "openai" && strings.HasPrefix(reason, "claude_")) || (platform == "claude" && strings.HasPrefix(reason, "codex_")) {
			return result, fmt.Errorf("supply reason platform mismatch: reason=%s, required_platform=%s", reason, platform)
		}
		if seen[reason] {
			return result, fmt.Errorf("duplicate supply reason rejected: reason=%s, index=%d", reason, index)
		}
		seen[reason] = true
	}
	if result.Ready != (len(result.Reasons) == 0) {
		return result, fmt.Errorf("supply ready/reasons contradiction: ready=%t, reasons_count=%d; ready requires exactly zero reasons", result.Ready, len(result.Reasons))
	}
	if result.Paused != seen[beewire.ReasonManuallyPaused] {
		return result, fmt.Errorf("supply paused/reasons contradiction: paused=%t, manually_paused_present=%t", result.Paused, seen[beewire.ReasonManuallyPaused])
	}
	return result, nil
}
