package bee

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var privatePath = regexp.MustCompile(`(?:/Users/|/home/|[A-Za-z]:\\Users\\)[^\s"'<>]+`)
var privateEmail = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)
var jwtToken = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`)
var pemPrivateKey = regexp.MustCompile(`(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`)
var secretToken = regexp.MustCompile(`\b(?:bee_|beep_|sk-)[A-Za-z0-9_-]{8,}`)

// safeText removes credentials, private paths and email addresses from text
// that may be printed or returned in an error.
func safeText(value string, secrets ...string) string {
	for _, secret := range secrets {
		if secret != "" {
			value = strings.ReplaceAll(value, secret, "[redacted]")
		}
	}
	value = connectionMessage(errors.New(value), "")
	value = pemPrivateKey.ReplaceAllString(value, "[redacted]")
	value = jwtToken.ReplaceAllString(value, "[redacted]")
	value = privatePath.ReplaceAllString(value, "[redacted path]")
	value = privateEmail.ReplaceAllString(value, "[redacted email]")
	return secretToken.ReplaceAllString(value, "[redacted]")
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
var connectionSecret = regexp.MustCompile(`(?i)(bearer\s+)[^\s,;"']+|((?:"|')?(?:authorization|credential|(?:access[_-]?|refresh[_-]?|id[_-]?)?token|(?:client[_-]?)?secret|password|cookie|ticket|private[_-]?key|mnemonic|seed|api[_-]?key)(?:"|')?\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*(?:"|$)|'(?:[^'\\]|\\.)*(?:'|$)|[^\s,;"']+)`)

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
		message = boundedFailureText(message, 30000)
	}
	return message
}

func hexID(s string, size int) bool {
	raw, err := hex.DecodeString(s)
	return err == nil && len(raw) == size && hex.EncodeToString(raw) == s
}
