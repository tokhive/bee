package bee

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"
)

// A public error retains diagnostic text, never authorization or login material.
// Successful responses are not passed to this function.
func safeResponseBody(raw []byte, secrets ...string) string {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&value) == nil && decoder.Decode(new(any)) == io.EOF {
		var redact func(any) any
		redact = func(v any) any {
			switch v := v.(type) {
			case map[string]any:
				for key, item := range v {
					name := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(key))
					switch name {
					case "authorization", "proxyauthorization", "cookie", "setcookie", "password", "secret", "credential", "credentials", "token", "accesstoken", "refreshtoken", "idtoken", "apikey", "privatekey", "seed", "mnemonic", "ticket", "email", "clientsecret", "sourcecode", "source", "prompt", "messages", "requestbody", "request", "content":
						v[key] = "[redacted]"
					default:
						v[key] = redact(item)
					}
				}
				return v
			case []any:
				for i := range v {
					v[i] = redact(v[i])
				}
				return v
			case string:
				return desktopSafeText(v, secrets...)
			default:
				return v
			}
		}
		safe, _ := json.Marshal(redact(value))
		return boundedFailureText(string(safe), 24000)
	}
	return boundedFailureText(desktopSafeText(string(raw), secrets...), 24000)
}

func boundedFailureText(value string, limit int) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return '�'
		}
		return r
	}, strings.ToValidUTF8(value, "�"))
	if len(value) <= limit {
		return value
	}
	n := limit
	for n > 0 && !utf8.RuneStart(value[n]) {
		n--
	}
	return fmt.Sprintf("%s [truncated: bytes=%d retained=%d]", value[:n], len(value), n)
}

type safeTransportFailure struct {
	cause   error
	message string
}

func (e *safeTransportFailure) Error() string { return e.message }
func (e *safeTransportFailure) Unwrap() error { return e.cause }
