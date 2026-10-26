package bee

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/tokhive/bee/beewire"
)

// DesktopDevice owns a separate device configuration. It never starts supply or
// reads the CLI configuration. The path is deliberately not a frontend input.
type DesktopDevice struct {
	path    string
	session desktopDeviceSession
}

func NewDesktopDevice() *DesktopDevice { return &DesktopDevice{} }

type DeviceView struct {
	State           string            `json:"state"`
	Hive            string            `json:"hive,omitempty"`
	Name            string            `json:"name,omitempty"`
	VerificationURL string            `json:"verification_url,omitempty"`
	UserCode        string            `json:"user_code,omitempty"`
	ExpiresAt       *time.Time        `json:"expires_at,omitempty"`
	PollInterval    int               `json:"poll_interval_seconds,omitempty"`
	Identity        *beewire.Identity `json:"identity,omitempty"`
}

func (d *DesktopDevice) configPath() (string, error) {
	if d.path != "" {
		return d.path, nil
	}
	directory, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("locate desktop device configuration: %w", err)
	}
	return filepath.Join(directory, "tokhive", "bee-desktop.json"), nil
}
func (d *DesktopDevice) Status(ctx context.Context) (DeviceView, error) {
	return d.operate(ctx, "", "")
}
func (d *DesktopDevice) Begin(ctx context.Context, hive, name string) (DeviceView, error) {
	origin, err := hiveOrigin(hive)
	if err != nil {
		return DeviceView{}, fmt.Errorf("validate desktop Hive: %w", err)
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return DeviceView{}, fmt.Errorf("device name rejected: characters=%d; required=1..80 without control characters", utf8.RuneCountInString(name))
	}
	return d.operate(ctx, origin, name)
}

func (d *DesktopDevice) operate(ctx context.Context, origin, name string) (DeviceView, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	session, release, err := d.acquireSession(ctx)
	if err != nil {
		return DeviceView{}, err
	}
	defer release()
	endPairing, err := session.beginPairing(ctx)
	if err != nil {
		return DeviceView{}, err
	}
	defer endPairing()
	state, err := session.read()
	if err != nil {
		return DeviceView{}, err
	}
	if origin != "" && state.Hive != "" && state.Hive != origin {
		return DeviceView{}, errors.New("desktop Hive change rejected: configuration already belongs to another Hive; existing device preserved")
	}
	if state.Credential == "" {
		if state.Hive != "" || state.Pairing != nil || state.Identity != nil {
			return DeviceView{}, errors.New("desktop configuration has identity metadata without a device credential; preserve configuration for recovery")
		}
		if origin == "" {
			return DeviceView{State: "unbound"}, nil
		}
		raw := make([]byte, 32)
		if _, err = rand.Read(raw); err != nil {
			return DeviceView{}, fmt.Errorf("generate desktop device credential: %w", err)
		}
		state = localState{Hive: origin, Name: name, Credential: "bee_" + base64.RawURLEncoding.EncodeToString(raw)}
		if err = session.save(state); err != nil {
			return DeviceView{}, err
		}
	}
	validOrigin, err := hiveOrigin(state.Hive)
	if err != nil {
		return DeviceView{}, fmt.Errorf("validate stored desktop Hive: %w", err)
	}
	if validOrigin != state.Hive {
		return DeviceView{}, errors.New("stored desktop Hive is not a canonical origin; configuration preserved")
	}
	if !deviceCredentialPattern.MatchString(state.Credential) {
		return DeviceView{}, errors.New("stored desktop credential format rejected; required=bee_ followed by 43 URL-safe characters")
	}
	var identity beewire.Identity
	err = desktopCall(ctx, state, "/api/bee/identity", "GET", state.Credential, nil, &identity)
	if err == nil {
		return finishDesktopDevice(session, state, identity)
	}
	var failure *apiFailure
	if !errors.As(err, &failure) || failure.Status != 401 {
		return DeviceView{}, err
	}
	if state.Identity != nil || failure.Code == "device_replaced" {
		return DeviceView{}, fmt.Errorf("bound desktop device rejected; automatic pairing forbidden: %w", err)
	}
	uncertain := state.Pairing != nil && state.Pairing.Status == "redeeming"
	if !uncertain && (state.Pairing == nil || !time.Now().Before(state.Pairing.ExpiresAt)) {
		if origin == "" {
			return DeviceView{State: "expired", Hive: state.Hive, Name: state.Name}, nil
		}
		hash := sha256.Sum256([]byte(state.Credential))
		var pair beewire.Pairing
		if err = desktopCall(ctx, state, "/api/bee/pairings", "POST", "", beewire.StartPairing{Name: state.Name, CredentialHash: hex.EncodeToString(hash[:])}, &pair); err != nil {
			return DeviceView{}, err
		}
		if err = validateDesktopPairing(state, pair, true); err != nil {
			return DeviceView{}, err
		}
		state.Pairing = &pair
		if err = session.save(state); err != nil {
			return DeviceView{}, err
		}
		return desktopPairingView(state, "pending"), nil
	}
	if err = validateDesktopPairing(state, *state.Pairing, false); err != nil {
		return DeviceView{}, err
	}
	var pair beewire.Pairing
	if err = desktopCall(ctx, state, "/api/bee/pairings", "GET", state.Pairing.PairingToken, nil, &pair); err != nil {
		if errors.As(err, &failure) && failure.Code == "pairing_expired" {
			if uncertain {
				return DeviceView{}, fmt.Errorf("pairing exchange remains unconfirmed after expiry; original transaction preserved: %w", err)
			}
			// Persist the authoritative Hive expiry even if the local clock differs.
			state.Pairing.ExpiresAt = time.Time{}
			if saveErr := session.save(state); saveErr != nil {
				return DeviceView{}, saveErr
			}
			return DeviceView{State: "expired", Hive: state.Hive, Name: state.Name}, nil
		}
		return DeviceView{}, err
	}
	switch pair.Status {
	case "pending", "draining":
		return desktopPairingView(state, pair.Status), nil
	case "approved":
		// Persist intent before the external exchange. A missing response must
		// never become an apparently fresh, replaceable pairing after restart.
		state.Pairing.Status = "redeeming"
		if err = session.save(state); err != nil {
			return DeviceView{}, err
		}
		err = desktopCall(ctx, state, "/api/bee/pairings/redeem", "POST", state.Pairing.PairingToken, struct{}{}, &identity)
		if err == nil {
			return finishDesktopDevice(session, state, identity)
		}
		if !uncertain && errors.As(err, &failure) && failure.Status == 410 && failure.Code == "pairing_expired" {
			// Hive rolls back an expired first exchange. A later expiry cannot
			// disprove an earlier unknown commit, so only clear a fresh intent.
			state.Pairing.Status = "pending"
			state.Pairing.ExpiresAt = time.Time{}
			if saveErr := session.save(state); saveErr != nil {
				return DeviceView{}, saveErr
			}
			return DeviceView{State: "expired", Hive: state.Hive, Name: state.Name}, nil
		}
		if errors.As(err, &failure) && failure.Code == "device_draining" {
			state.Pairing.Status = "pending"
			if saveErr := session.save(state); saveErr != nil {
				return DeviceView{}, saveErr
			}
			return desktopPairingView(state, "draining"), nil
		}
	case "redeemed":
		state.Pairing.Status = "redeeming"
		if err = session.save(state); err != nil {
			return DeviceView{}, err
		}
		err = errors.New("pairing reports redeemed but device identity is not yet confirmed")
	default:
		return DeviceView{}, fmt.Errorf("pairing status rejected: status=%q; required=pending,draining,approved,redeemed", safeCode(pair.Status))
	}
	// Never replace the credential after an uncertain remote write.
	if recovery := desktopCall(ctx, state, "/api/bee/identity", "GET", state.Credential, nil, &identity); recovery == nil {
		return finishDesktopDevice(session, state, identity)
	} else {
		return DeviceView{}, fmt.Errorf("pairing result unconfirmed; original transaction preserved: %w; identity recovery: %w", err, recovery)
	}
}

var deviceCredentialPattern = regexp.MustCompile(`^bee_[A-Za-z0-9_-]{43}$`)
var pairingTokenPattern = regexp.MustCompile(`^beep_[A-Za-z0-9_-]{43}$`)
var userCodePattern = regexp.MustCompile(`^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$`)
var publicIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func validateDesktopPairing(state localState, pair beewire.Pairing, initial bool) error {
	if pair.VerificationURI != state.Hive+"/devices/pair" {
		return errors.New("pairing verification URL rejected; required=configured Hive origin plus /devices/pair without query or fragment")
	}
	if !pairingTokenPattern.MatchString(pair.PairingToken) || !userCodePattern.MatchString(pair.UserCode) {
		return errors.New("pairing response token/code format rejected; secrets omitted")
	}
	if initial && (pair.ExpiresAt.IsZero() || !time.Now().Before(pair.ExpiresAt)) {
		return errors.New("pairing response already expired; a future expiry is required")
	}
	if (pair.Status != "pending" && (initial || pair.Status != "redeeming")) || pair.PollInterval < 1 || pair.PollInterval > 60 {
		return fmt.Errorf("initial pairing metadata rejected: status=%q, interval=%d; required=pending and 1..60 seconds", safeCode(pair.Status), pair.PollInterval)
	}
	return nil
}
func desktopPairingView(state localState, status string) DeviceView {
	pair := state.Pairing
	return DeviceView{State: status, Hive: state.Hive, Name: state.Name, UserCode: pair.UserCode, VerificationURL: pair.VerificationURI + "?code=" + url.QueryEscape(pair.UserCode), ExpiresAt: &pair.ExpiresAt, PollInterval: pair.PollInterval}
}
func finishDesktopDevice(session *desktopDeviceSession, state localState, identity beewire.Identity) (DeviceView, error) {
	if err := validateDesktopIdentity(state, identity); err != nil {
		return DeviceView{}, err
	}
	state.Identity = &identity
	state.Pairing = nil
	if err := session.save(state); err != nil {
		return DeviceView{}, err
	}
	return DeviceView{State: "bound", Hive: state.Hive, Name: identity.Name, Identity: &identity}, nil
}

// validateDesktopIdentity is deliberately pure: supply checks must not rewrite
// the saved binding or complete an outstanding pairing transaction.
func validateDesktopIdentity(state localState, identity beewire.Identity) error {
	if !publicIDPattern.MatchString(identity.ID) || !publicIDPattern.MatchString(identity.OwnerID) || strings.TrimSpace(identity.Name) == "" || identity.OwnerEmail == "" || len(identity.OwnerEmail) > 320 || utf8.RuneCountInString(identity.Name) > 80 || strings.IndexFunc(identity.Name+identity.OwnerEmail, unicode.IsControl) >= 0 {
		return errors.New("Hive identity fields rejected; nonempty device ID, owner ID, name and owner email are required")
	}
	public, _ := json.Marshal(identity)
	if bytes.Contains(public, []byte(state.Credential)) || (state.Pairing != nil && bytes.Contains(public, []byte(state.Pairing.PairingToken))) {
		return errors.New("Hive identity contains secret material; public result blocked")
	}
	if previous := state.Identity; previous != nil && (previous.ID != identity.ID || previous.OwnerID != identity.OwnerID) {
		return errors.New("Hive identity changed device ID or owner ID; saved identity preserved and binding blocked")
	}
	return nil
}

// Keep HTTP failure evidence without echoing response bodies, which can contain
// credentials. Error codes are bounded to the Hive contract's public alphabet.
func safeCode(code string) string {
	switch code {
	case "", "pending", "draining", "approved", "redeemed", "device_exists", "device_draining", "replacement_pending", "pairing_expired", "pairing_redeemed", "invalid_device_credential", "device_replaced", "rate_limited", "invalid_pairing", "invalid_pairing_token", "unavailable", "device_changed", "pairing_pending":
		return code
	default:
		return "unrecognized_code"
	}
}
func desktopCall(ctx context.Context, state localState, path, method, secret string, input, output any) error {
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return fmt.Errorf("encode %s %s: %w", method, path, err)
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, state.Hive+path, body)
	if err != nil {
		return fmt.Errorf("build %s %s: %w", method, path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hive-Request", "1")
	req.Header.Set("User-Agent", userAgent())
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	response, err := httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("%s %s at %s: %w", method, path, state.Hive, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil {
		return fmt.Errorf("read %s %s HTTP %d: %w", method, path, response.StatusCode, err)
	}
	if len(data) > 65536 {
		return fmt.Errorf("%s %s HTTP %d: response bytes exceed 65536", method, path, response.StatusCode)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var result struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		decodeErr := json.Unmarshal(data, &result)
		code := safeCode(result.Error.Code)
		return fmt.Errorf("%s %s: HTTP %d, code=%q, error_json_valid=%t: %w", method, path, response.StatusCode, code, decodeErr == nil, &apiFailure{Status: response.StatusCode, Code: code})
	}
	if err = json.Unmarshal(data, output); err != nil {
		var syntax *json.SyntaxError
		if errors.As(err, &syntax) {
			return fmt.Errorf("%s %s HTTP %d: invalid JSON at byte=%d", method, path, response.StatusCode, syntax.Offset)
		}
		return fmt.Errorf("%s %s HTTP %d: response does not match required schema (%T)", method, path, response.StatusCode, err)
	}
	return nil
}
