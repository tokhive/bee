package bee

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
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

	"github.com/coder/websocket"
	"github.com/tokhive/bee/relay"
)

// DesktopConnectionObservation describes a real attempt, its failure and timer.
// The enclosing runtime owns the run/revision that accepts this observation.
type DesktopConnectionObservation struct {
	Connection string
	Detail     *DesktopConnectionDetail
}
type DesktopConnectionDetail struct {
	Failure     *DesktopConnectionFailure `json:"failure"`
	Retry       string                    `json:"retry"`
	NextRetryAt *string                   `json:"next_retry_at"`
}
type DesktopConnectionFailure struct {
	Code       string            `json:"code"`
	Stage      string            `json:"stage"`
	OccurredAt string            `json:"occurred_at"`
	Message    string            `json:"message"`
	Evidence   map[string]string `json:"evidence"`
}

// Preserve the error type and safe request location across the shared client.
type connectionRequestFailure struct {
	cause                    error
	origin, path, credential string
}

func (e *connectionRequestFailure) Error() string {
	return fmt.Sprintf("Hive request %s %s: %s", e.origin, e.path, connectionMessage(e.cause, e.credential))
}
func (e *connectionRequestFailure) Unwrap() error { return e.cause }

var connectionURL = regexp.MustCompile(`(?i)(?:https?|wss?|socks5h?)://[^\s<>"']+`)
var connectionSecret = regexp.MustCompile(`(?i)(bearer\s+)[^\s,;"']+|((?:"|')?(?:authorization|credential|token|secret|password|api[_-]?key)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;"']+)`)

func connectionMessage(err error, credential string) string {
	message := "Hive connection ended without an underlying error"
	if err != nil {
		message = err.Error()
	}
	if credential != "" {
		message = strings.ReplaceAll(message, credential, "[redacted]")
	}
	message = connectionURL.ReplaceAllStringFunc(message, func(raw string) string {
		u, e := url.Parse(raw)
		if e != nil {
			return "[redacted URL]"
		}
		u.User = nil
		u.RawQuery = ""
		u.Fragment = ""
		return u.String()
	})
	message = connectionSecret.ReplaceAllString(message, "${1}${2}[redacted]")
	message = strings.ToValidUTF8(message, "�")
	if len(message) > 32768 {
		message = fmt.Sprintf("connection error message exceeds limit: bytes=%d maximum=32768", len(message))
	}
	return message
}
func connectionFailureCode(err error, stage string) string {
	var dns *net.DNSError
	var cert *tls.CertificateVerificationError
	var unknown x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	var record tls.RecordHeaderError
	var timeout net.Error
	var api *apiFailure
	switch {
	case errors.As(err, &api):
		return "http_rejected"
	case errors.As(err, &dns):
		return "dns_failed"
	case errors.As(err, &cert) || errors.As(err, &unknown) || errors.As(err, &hostname) || errors.As(err, &invalid) || errors.As(err, &record):
		return "tls_failed"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "connection_refused"
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(err, relay.ErrStalled) || errors.As(err, &timeout) && timeout.Timeout():
		return "timeout"
	case stage == "synchronize":
		return "synchronization_failed"
	case err == nil || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, net.ErrClosed) || websocket.CloseStatus(err) != -1:
		return "connection_closed"
	default:
		return "unknown_failure"
	}
}
func observedConnectionFailure(err error, response *http.Response, state localState, path, stage string) *DesktopConnectionFailure {
	evidence := map[string]string{}
	if stage != "synchronize" {
		evidence["path"] = path
	}
	if origin, e := hiveOrigin(state.Hive); e == nil {
		evidence["target_origin"] = origin
	}
	var request *connectionRequestFailure
	if errors.As(err, &request) {
		evidence["path"] = request.path
		evidence["target_origin"] = request.origin
	}
	code := connectionFailureCode(err, stage)
	var api *apiFailure
	if errors.As(err, &api) {
		evidence["http_status"] = strconv.Itoa(api.Status)
		if safeCode(api.Code) == api.Code && api.Code != "" {
			evidence["remote_code"] = api.Code
		}
	}
	if response != nil {
		code = "http_rejected"
		evidence["http_status"] = strconv.Itoa(response.StatusCode)
		// Only a contract-public code can leave the core. A response may also
		// contain credentials or account data; never copy the entire body.
		if response.Body != nil {
			var body struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			_ = json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(&body)
			if c := body.Error.Code; c != "" && safeCode(c) == c {
				evidence["remote_code"] = c
			}
		}
	}
	return &DesktopConnectionFailure{Code: code, Stage: stage, OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Message: connectionMessage(err, state.Credential), Evidence: evidence}
}

func connectionObject(raw []byte, fields ...string) (map[string]json.RawMessage, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, fmt.Errorf("connection detail object: %w", err)
	}
	if object == nil || len(object) != len(fields) {
		return nil, fmt.Errorf("connection detail field count=%d required=%d", len(object), len(fields))
	}
	for _, field := range fields {
		if _, ok := object[field]; !ok {
			return nil, fmt.Errorf("connection detail missing field=%s", field)
		}
	}
	return object, nil
}
func (d *DesktopConnectionDetail) UnmarshalJSON(raw []byte) error {
	fields, err := connectionObject(raw, "failure", "retry", "next_retry_at")
	if err != nil {
		return err
	}
	type plain DesktopConnectionDetail
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("decode connection detail: %w", err)
	}
	switch value.Retry {
	case "idle", "attempting", "scheduled", "halted":
	default:
		return fmt.Errorf("connection retry rejected: required=known state")
	}
	if (value.Retry == "scheduled") != (value.NextRetryAt != nil) {
		return fmt.Errorf("connection retry timestamp required exactly when scheduled")
	}
	if value.NextRetryAt != nil {
		if _, err := connectionTime(*value.NextRetryAt, false); err != nil {
			return err
		}
	}
	if value.Failure != nil {

		failureFields, err := connectionObject(fields["failure"], "code", "stage", "occurred_at", "message", "evidence")
		if err != nil {
			return err
		}
		if bytes.Equal(bytes.TrimSpace(failureFields["message"]), []byte("null")) {
			return errors.New("connection failure message requires string; observed=null")
		}
		var evidence map[string]json.RawMessage
		if err := json.Unmarshal(failureFields["evidence"], &evidence); err != nil {
			return fmt.Errorf("connection failure evidence: %w", err)
		}
		for _, raw := range evidence {
			if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
				return errors.New("connection evidence requires string values; observed=null")
			}
		}

		if err := value.Failure.validate(); err != nil {
			return err
		}
	}
	*d = DesktopConnectionDetail(value)
	return nil
}
func connectionTime(raw string, observed bool) (time.Time, error) {
	value, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || !connectionTimestamp.MatchString(raw) || observed && value.After(time.Now().Add(5*time.Second)) {
		return time.Time{}, fmt.Errorf("connection timestamp rejected: valid_UTC=%t future_observation=%t; required=valid UTC RFC3339 and observation at most 5s ahead", err == nil && connectionTimestamp.MatchString(raw), observed && value.After(time.Now().Add(5*time.Second)))
	}
	return value, nil
}

var connectionTimestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$`)
var connectionRemoteCode = regexp.MustCompile(`^[a-z][a-z0-9_]{0,127}$`)
var connectionPath = regexp.MustCompile(`^/api/bee/[a-z0-9/_-]+$`)

func (f *DesktopConnectionFailure) validate() error {
	switch f.Code {
	case "dns_failed", "tls_failed", "connection_refused", "timeout", "http_rejected", "connection_closed", "synchronization_failed", "ownership_unconfirmed", "unknown_failure":
	default:
		return errors.New("connection failure code rejected: required=known code")
	}
	switch f.Stage {
	case "connect", "heartbeat", "synchronize":
	default:
		return errors.New("connection failure stage rejected: required=connect, heartbeat or synchronize")
	}
	if _, err := connectionTime(f.OccurredAt, true); err != nil {
		return err
	}
	if len(f.Message) > 32768 {
		return fmt.Errorf("connection failure message bytes=%d maximum=32768", len(f.Message))
	}
	if f.Evidence == nil {
		return errors.New("connection failure evidence requires object")
	}
	for key, value := range f.Evidence {
		if len(value) > 32768 {
			return fmt.Errorf("connection evidence value bytes=%d maximum=32768", len(value))
		}
		valid := true
		switch key {
		case "target_origin":
			origin, err := hiveOrigin(value)
			valid = err == nil && origin == value
		case "path":
			valid = connectionPath.MatchString(value)
		case "http_status":
			status, err := strconv.Atoi(value)
			valid = err == nil && len(value) == 3 && status >= 100 && status <= 599
		case "remote_code":
			valid = connectionRemoteCode.MatchString(value)
		case "owned_session":
			valid = value == "true" || value == "false"
		case "consecutive_conflicts":
			n, err := strconv.ParseUint(value, 10, 64)
			valid = err == nil && n <= 9007199254740991 && strconv.FormatUint(n, 10) == value
		case "response_body":
		default:
			valid = false
		}
		if !valid {
			return fmt.Errorf("connection evidence rejected at key=%s; required=safe public field and bounded value", key)
		}
	}
	return nil
}
