package bee

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// DesktopFailure is the public failure at a desktop device/supply request boundary.
// Cause remains private so errors.As continues to drive existing reconciliation.
type DesktopFailure struct {
	Code    string                 `json:"code"`
	Message string                 `json:"message"`
	Details *DesktopFailureDetails `json:"details,omitempty"`
	Cause   error                  `json:"-"`
}
type DesktopFailureDetails struct {
	Check      string            `json:"check"`
	ObservedAt string            `json:"observed_at"`
	Evidence   map[string]string `json:"evidence"`
}

func (e *DesktopFailure) Error() string { return e.Code + ": " + e.Message }
func (e *DesktopFailure) Unwrap() error { return e.Cause }

var desktopFailureCheck = regexp.MustCompile(`^[a-z][a-z0-9_]{0,79}$`)
var desktopSecretToken = regexp.MustCompile(`\b(?:bee_|beep_|sk-)[A-Za-z0-9_-]{8,}`)

func desktopSafeText(value string, secrets ...string) string {
	for _, secret := range secrets {
		if secret != "" {
			value = strings.ReplaceAll(value, secret, "[redacted]")
		}
	}
	value = connectionMessage(errors.New(value), "")
	return desktopSecretToken.ReplaceAllString(value, "[redacted]")
}
func desktopRequestFailure(state localState, path, check string, cause error, status int, body []byte, secrets ...string) error {
	secrets = append(secrets, state.Credential)
	if state.Pairing != nil {
		secrets = append(secrets, state.Pairing.PairingToken)
	}
	evidence := map[string]string{}
	if origin, err := hiveOrigin(state.Hive); err == nil {
		evidence["target_origin"] = origin
	}
	if u, err := url.Parse(path); err == nil {
		evidence["path"] = u.Path
	}
	code := connectionFailureCode(cause, "connect")
	var api *apiFailure
	if errors.As(cause, &api) {
		code = "http_rejected"
		if api.Code != "" && api.Code != "unrecognized_code" {
			code = api.Code
		}
		if api.Code != "" {
			evidence["remote_code"] = api.Code
		}
	}
	if status != 0 {
		evidence["http_status"] = strconv.Itoa(status)
	}
	if len(body) > 0 {
		// Copy only the public error fields. Pairing credentials and arbitrary response
		// objects never become evidence; retain safe original error text when present.
		var public struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message,omitempty"`
			} `json:"error"`
		}
		if json.Unmarshal(body, &public) == nil && (public.Error.Code != "" || public.Error.Message != "") {
			public.Error.Code = safeCode(public.Error.Code)
			public.Error.Message = desktopSafeText(public.Error.Message, secrets...)
			data, _ := json.Marshal(public)
			if len(data) <= 32768 {
				evidence["response_body"] = string(data)
			} else {
				evidence["response_body"] = fmt.Sprintf("public error response bytes=%d; maximum=32768; body omitted", len(data))
			}
		} else {
			evidence["response_body"] = fmt.Sprintf("public error response unavailable; response bytes=%d; required=error code/message JSON; body omitted", len(body))
		}
	}
	message := desktopSafeText(cause.Error(), secrets...)
	if body := evidence["response_body"]; body != "" {
		message += "; response_body=" + body
	}
	if len(message) > 32768 {
		message = fmt.Sprintf("desktop failure message bytes=%d; maximum=32768; inspect bounded evidence", len(message))
	}
	return &DesktopFailure{Code: code, Message: message, Details: &DesktopFailureDetails{Check: check, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Evidence: evidence}, Cause: cause}
}

func (d *DesktopFailureDetails) Validate() error {
	if !desktopFailureCheck.MatchString(d.Check) {
		return errors.New("failure details check rejected; required=public identifier of 1..80 characters")
	}
	if _, err := connectionTime(d.ObservedAt, true); err != nil {
		return fmt.Errorf("failure details observed_at: %w", err)
	}
	if d.Evidence == nil {
		return errors.New("failure details evidence rejected; required=object")
	}
	for key, value := range d.Evidence {
		if len(value) > 32768 || strings.IndexFunc(value, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' && r != '\r' }) >= 0 || desktopSafeText(value) != value {
			return fmt.Errorf("failure evidence rejected: key=%s bytes=%d; required=safe text at most 32768 bytes", key, len(value))
		}
		valid := true
		switch key {
		case "target_origin":
			origin, err := hiveOrigin(value)
			valid = err == nil && origin == value
		case "path":
			valid = connectionPath.MatchString(value)
		case "http_status":
			n, err := strconv.Atoi(value)
			valid = err == nil && len(value) == 3 && n >= 100 && n <= 599
		case "remote_code":
			valid = connectionRemoteCode.MatchString(value)
		case "source_type":
			valid = desktopFailureCheck.MatchString(value)
		case "response_body", "actual", "required":
		default:
			valid = false
		}
		if !valid {
			return fmt.Errorf("failure evidence rejected: key=%s; required=fixed safe evidence field and value", key)
		}
	}
	return nil
}

// Reject duplicate fields at every level before ordinary decoding loses them.
func strictFailureJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		switch token {
		case json.Delim('{'):
			seen := map[string]bool{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return errors.New("failure details duplicate field rejected; required=unique fields")
				}
				seen[name] = true
				if err = walk(); err != nil {
					return err
				}
			}
			_, err = decoder.Token()
			return err
		case json.Delim('['):
			for decoder.More() {
				if err = walk(); err != nil {
					return err
				}
			}
			_, err = decoder.Token()
			return err
		}
		return nil
	}
	if err := walk(); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("failure details trailing JSON rejected")
	}
	return nil
}
func (d *DesktopFailureDetails) UnmarshalJSON(raw []byte) error {
	if err := strictFailureJSON(raw); err != nil {
		return err
	}
	if _, err := connectionObject(raw, "check", "observed_at", "evidence"); err != nil {
		return err
	}
	type plain DesktopFailureDetails
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("decode failure details: %w", err)
	}
	if err := (*DesktopFailureDetails)(&value).Validate(); err != nil {
		return err
	}
	*d = DesktopFailureDetails(value)
	return nil
}
