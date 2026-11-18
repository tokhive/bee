package bee

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"syscall"
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
var desktopPrivatePath = regexp.MustCompile(`(?:/Users/|/home/|[A-Za-z]:\\Users\\)[^\s"'<>]+`)
var desktopPrivateEmail = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)
var desktopJWT = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`)
var desktopPEM = regexp.MustCompile(`(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`)
var desktopSecretToken = regexp.MustCompile(`\b(?:bee_|beep_|sk-)[A-Za-z0-9_-]{8,}`)

func desktopSafeText(value string, secrets ...string) string {
	for _, secret := range secrets {
		if secret != "" {
			value = strings.ReplaceAll(value, secret, "[redacted]")
		}
	}
	value = connectionMessage(errors.New(value), "")
	value = desktopPEM.ReplaceAllString(value, "[redacted]")
	value = desktopJWT.ReplaceAllString(value, "[redacted]")
	value = desktopPrivatePath.ReplaceAllString(value, "[redacted path]")
	value = desktopPrivateEmail.ReplaceAllString(value, "[redacted email]")
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
	code := desktopRequestFailureCode(cause)
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
		evidence["response_body"] = desktopSafeText(safeResponseBody(body, secrets...))
	}
	message := desktopSafeText(cause.Error(), secrets...)
	if body := evidence["response_body"]; body != "" {
		message += "; response_body=" + body
	}
	if len(message) > 32768 {
		message = boundedFailureText(message, 30000)
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
		case "retry_after_seconds":
			n, err := strconv.ParseUint(value, 10, 31)
			valid = err == nil && strconv.FormatUint(n, 10) == value
		case "elapsed_ms":
			n, err := strconv.ParseUint(value, 10, 53)
			valid = err == nil && strconv.FormatUint(n, 10) == value
		case "method":
			valid = value == "GET" || value == "POST" || value == "PUT"
		case "phase":
			valid = value == "http_start" || value == "http_end" || value == "http_error"
		case "failure_kind":
			switch value {
			case "timeout", "dns_temporary", "dns_failed", "tls_failed", "connection_refused", "connection_closed", "http_rejected", "unknown_failure":
			default:
				valid = false
			}
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

// HTTP reads use a closed set of typed transient failures. A permanent DNS
// error or a message that merely mentions a timeout must not schedule retries.
func desktopRequestFailureCode(cause error) string {
	var dns *net.DNSError
	if errors.As(cause, &dns) && (dns.IsTemporary || dns.IsTimeout) {
		return "dns_temporary"
	}
	if errors.Is(cause, syscall.ECONNRESET) || errors.Is(cause, syscall.ECONNABORTED) || errors.Is(cause, syscall.EPIPE) {
		return "connection_closed"
	}
	return connectionFailureCode(cause, "connect")
}

func desktopRetryAfter(value string, now time.Time) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if n, err := strconv.ParseUint(value, 10, 31); err == nil && strconv.FormatUint(n, 10) == value {
		return value
	}
	at, err := http.ParseTime(value)
	if err != nil {
		return ""
	}
	seconds := at.Sub(now).Seconds()
	if seconds < 0 {
		seconds = 0
	}
	if seconds > 2147483647 {
		return ""
	}
	n := int64(seconds)
	if float64(n) < seconds {
		n++
	}
	return strconv.FormatInt(n, 10)
}

func desktopHTTPFailure(state localState, path, check, method string, started time.Time, cause error, status int, body []byte, retryAfter string, secrets ...string) error {
	failure := desktopRequestFailure(state, path, check, cause, status, body, secrets...).(*DesktopFailure)
	failure.Details.Evidence["method"] = method
	failure.Details.Evidence["phase"] = "http_error"
	failure.Details.Evidence["failure_kind"] = desktopRequestFailureCode(cause)
	failure.Details.Evidence["elapsed_ms"] = strconv.FormatInt(time.Since(started).Milliseconds(), 10)
	if status == http.StatusTooManyRequests && retryAfter != "" {
		failure.Details.Evidence["retry_after_seconds"] = retryAfter
	}
	return failure
}
