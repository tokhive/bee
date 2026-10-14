package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestClaudeKeychainNamespace(t *testing.T) {
	// Expected hashes independently generated with Node crypto, matching the fixed client.
	for _, test := range []struct {
		name, config, secure, expected string
		secureSet                      bool
	}{
		{name: "default", expected: "Claude Code-credentials"},
		{name: "empty secure overrides config", config: "/custom", secureSet: true, expected: "Claude Code-credentials"},
		{name: "explicit default", config: "/Users/test/.claude", expected: "Claude Code-credentials-462977e4"},
		{name: "secure overrides config", config: "/other", secure: "/custom", secureSet: true, expected: "Claude Code-credentials-335933e8"},
		{name: "relative is not resolved", config: "./claude", expected: "Claude Code-credentials-a0a72798"},
		{name: "NFC", config: "/tmp/caf\u00e9", expected: "Claude Code-credentials-0873cca0"},
		{name: "NFD", config: "/tmp/cafe\u0301", expected: "Claude Code-credentials-0873cca0"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := claudeKeychainService(test.config, test.secure, test.secureSet); got != test.expected {
				t.Fatalf("namespace = %q, want %q", got, test.expected)
			}
		})
	}
	t.Setenv("USER", "test.user-name_1")
	t.Setenv("CLAUDE_CONFIG_DIR", "/other")
	t.Setenv("CLAUDE_SECURESTORAGE_CONFIG_DIR", "/custom")
	if source := resolveClaudeKeychain(nil); source.account != "test.user-name_1" || source.service != "Claude Code-credentials-335933e8" {
		t.Fatal("environment selection does not match official client")
	}
	t.Setenv("USER", "unsafe user")
	empty := ""
	if source := resolveClaudeKeychain(&empty); source.account != "claude-code-user" || source.service != "Claude Code-credentials" {
		t.Fatal("explicit default namespace or username fallback failed")
	}
}

func TestClaudeStorageDirectoryEnvironment(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, config, secure, want string
		configSet, secureSet       bool
	}{
		{name: "default", want: filepath.Join(home, ".claude")},
		{name: "empty config", configSet: true, want: "."},
		{name: "relative config", configSet: true, config: "./relative", want: "./relative"},
		{name: "empty secure", configSet: true, config: "/other", secureSet: true, want: filepath.Join(home, ".claude")},
		{name: "secure override", configSet: true, config: "/other", secureSet: true, secure: "/custom", want: "/custom"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("CLAUDE_CONFIG_DIR", test.config)
			t.Setenv("CLAUDE_SECURESTORAGE_CONFIG_DIR", test.secure)
			if !test.configSet {
				os.Unsetenv("CLAUDE_CONFIG_DIR")
			}
			if !test.secureSet {
				os.Unsetenv("CLAUDE_SECURESTORAGE_CONFIG_DIR")
			}
			source := resolveClaudeKeychain(nil)
			if source.directory != test.want || source.service != claudeKeychainService(test.config, test.secure, test.secureSet) {
				t.Fatal("storage path or Keychain namespace changed")
			}
		})
	}
}

func claudeSample(expires time.Time) []byte {
	raw, _ := json.Marshal(map[string]any{
		"claudeAiOauth": map[string]any{
			"accessToken": "synthetic-claude-access", "refreshToken": "synthetic-claude-refresh",
			"expiresAt": expires.UnixMilli(), "scopes": []string{"user:inference", "user:profile", "user:sessions:claude_code"},
			"subscriptionType": "pro", "rateLimitTier": "default_claude_pro", "clientId": "synthetic-client",
		},
		"unrelated": "preserved-in-official-store",
	})
	return raw
}

func TestClaudeCredentialShapeAndPrivacy(t *testing.T) {
	expires := time.Now().Add(time.Hour).Truncate(time.Millisecond)
	credential, err := parseClaudeCredential(claudeSample(expires))
	if err != nil || !credential.expiresAt.Equal(expires) || !credential.hasRefreshToken || !credential.hasInferenceScope || !credential.hasProfileScope || credential.secret.Token != "synthetic-claude-access" {
		t.Fatal("official OAuth object was not read correctly")
	}
	encoded, _ := json.Marshal(credential)
	if string(encoded) != "{}" {
		t.Fatal("local credential can be accidentally serialized")
	}
	for _, test := range []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{"missing OAuth", func(root, auth map[string]any) { delete(root, "claudeAiOauth") }},
		{"proxy format", func(root, auth map[string]any) {
			delete(root, "claudeAiOauth")
			root["access_token"] = "synthetic-claude-access"
		}},
		{"API key", func(root, auth map[string]any) { delete(root, "claudeAiOauth"); root["apiKey"] = "synthetic-api-key" }},
		{"missing access", func(root, auth map[string]any) { delete(auth, "accessToken") }},
		{"unsafe access", func(root, auth map[string]any) { auth["accessToken"] = "synthetic-\r\nsecret" }},
		{"missing expiry", func(root, auth map[string]any) { delete(auth, "expiresAt") }},
		{"negative expiry", func(root, auth map[string]any) { auth["expiresAt"] = -1 }},
		{"fractional expiry", func(root, auth map[string]any) { auth["expiresAt"] = 0.5 }},
		{"oversized expiry", func(root, auth map[string]any) { auth["expiresAt"] = 253402300800000 }},
		{"wrong scopes type", func(root, auth map[string]any) { auth["scopes"] = "user:inference" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			var root map[string]any
			_ = json.Unmarshal(claudeSample(expires), &root)
			test.change(root, root["claudeAiOauth"].(map[string]any))
			raw, _ := json.Marshal(root)
			_, err := parseClaudeCredential(raw)
			if err == nil || strings.Contains(err.Error(), "synthetic-") {
				t.Fatal("malformed source accepted or error leaked credential")
			}
		})
	}
	for _, raw := range [][]byte{[]byte("invalid synthetic-secret"), bytes.Repeat([]byte(" "), 65537), append(claudeSample(expires), []byte(` {}`)...)} {
		if _, err := parseClaudeCredential(raw); err == nil {
			t.Fatal("invalid or oversized source accepted")
		}
	}
}

type claudeTransport func(*http.Request) (*http.Response, error)

func (f claudeTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

const claudeTestProfile = `{"account":{"uuid":"11111111-1111-4111-8111-111111111111","email":"synthetic@example.test"},"organization":{"uuid":"22222222-2222-4222-8222-222222222222"},"extra":"ignored"}`

func claudeProfileResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

func TestClaudeStatusVerifiesOnlyCurrentAccessToken(t *testing.T) {
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	reads, requests := 0, 0
	read := func(context.Context) (claudeCredential, error) { reads++; return credential, nil }
	transport := claudeTransport(func(req *http.Request) (*http.Response, error) {
		requests++
		if req.Method != "GET" || req.URL.String() != "https://api.anthropic.com/api/oauth/profile" || req.Body != nil || req.Header.Get("Authorization") != "Bearer synthetic-claude-access" || req.Header.Get("Cache-Control") != "no-cache" {
			t.Fatal("profile query sent unexpected endpoint, method, body or headers")
		}
		if strings.Contains(req.Header.Get("Authorization"), "refresh") {
			t.Fatal("profile query sent refresh credential")
		}
		return claudeProfileResponse(200, claudeTestProfile), nil
	})
	var out bytes.Buffer
	if err := inspectClaude(context.Background(), read, true, transport, &out); err != nil {
		t.Fatal(err)
	}
	var status map[string]any
	if json.Unmarshal(out.Bytes(), &status) != nil || status["validation"] != "official_profile_verified" || status["status"] != "available" || status["plan"] != "pro" || reads != 2 || requests != 1 {
		t.Fatal("profile verification or source reread was skipped")
	}
	if fingerprint, ok := status["account_fingerprint"].(string); !ok || len(fingerprint) != 64 {
		t.Fatal("missing safe account fingerprint")
	}
	for _, private := range []string{"synthetic-", "example.test", "11111111-1111", "22222222-2222"} {
		if strings.Contains(out.String(), private) {
			t.Fatal("status exposed credentials or raw account identity")
		}
	}
}

func TestClaudeStatusRejectsChangingSource(t *testing.T) {
	for _, change := range []string{"access", "expiry", "scope", "unavailable"} {
		t.Run(change, func(t *testing.T) {
			credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
			read := func(context.Context) (claudeCredential, error) { return credential, nil }
			transport := claudeTransport(func(*http.Request) (*http.Response, error) {
				switch change {
				case "access":
					credential.secret.Token = "synthetic-new-access"
				case "expiry":
					credential.expiresAt = time.Now().Add(-time.Hour)
				case "scope":
					credential.hasInferenceScope = false
				case "unavailable":
					read = func(context.Context) (claudeCredential, error) {
						return claudeCredential{}, errClaudeKeychainUnavailable
					}
				}
				return claudeProfileResponse(200, claudeTestProfile), nil
			})
			var out bytes.Buffer
			err := inspectClaude(context.Background(), func(ctx context.Context) (claudeCredential, error) { return read(ctx) }, true, transport, &out)
			if !errors.Is(err, errClaudeSourceChanged) || out.Len() != 0 {
				t.Fatal("changed source produced a verified identity")
			}
		})
	}
}

func TestClaudeStatusDistinguishesLocalAndVerifiedState(t *testing.T) {
	for _, name := range []string{"valid", "expired", "near expiry", "missing inference", "missing profile", "unknown plan", "no refresh"} {
		t.Run(name, func(t *testing.T) {
			credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
			wantState := "available"
			switch name {
			case "expired":
				credential.expiresAt = time.Now().Add(-time.Hour)
				wantState = "expired"
			case "near expiry":
				credential.expiresAt = time.Now().Add(20 * time.Second)
				wantState = "expired"
			case "missing inference":
				credential.hasInferenceScope = false
				wantState = "missing_inference_scope"
			case "missing profile":
				credential.hasProfileScope = false
			case "unknown plan":
				credential.plan = "unknown"
			case "no refresh":
				credential.hasRefreshToken = false
			}
			read := func(context.Context) (claudeCredential, error) { return credential, nil }
			transport := claudeTransport(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected network call"); return nil, nil })
			var out bytes.Buffer
			if err := inspectClaude(context.Background(), read, false, transport, &out); err != nil {
				t.Fatal(err)
			}
			var status map[string]any
			if json.Unmarshal(out.Bytes(), &status) != nil || status["status"] != wantState || status["validation"] != "local_structure_only" || status["account_fingerprint"] != nil {
				t.Fatal("local inspection claimed a verified identity or concealed invalid state")
			}
			if wantState == "expired" || name == "missing profile" {
				out.Reset()
				if err := inspectClaude(context.Background(), read, true, transport, &out); err == nil || out.Len() != 0 {
					t.Fatal("invalid credential sent to profile endpoint")
				}
			}
		})
	}
	for _, failure := range []error{errClaudeKeychainMissing, errClaudeKeychainUnavailable} {
		var out bytes.Buffer
		err := inspectClaude(context.Background(), func(context.Context) (claudeCredential, error) { return claudeCredential{}, failure }, false, nil, &out)
		if !errors.Is(err, failure) || out.Len() != 0 {
			t.Fatal("source failure was hidden")
		}
	}
}

func TestClaudeProfileFailuresAreBoundedAndRedacted(t *testing.T) {
	credential, _ := parseClaudeCredential(claudeSample(time.Now().Add(time.Hour)))
	for _, test := range []struct {
		name   string
		status int
		body   string
	}{
		{"unauthorized", 401, "synthetic-secret"}, {"forbidden", 403, "synthetic-secret"}, {"limited", 429, "synthetic-secret"}, {"unavailable", 500, "synthetic-secret"},
		{"redirect", 302, "synthetic-secret"}, {"malformed", 200, "synthetic-secret"}, {"oversized", 200, strings.Repeat(" ", 65537)},
		{"missing organization", 200, `{"account":{"uuid":"11111111-1111-4111-8111-111111111111","email":"synthetic@example.test"}}`},
		{"missing email", 200, strings.Replace(claudeTestProfile, `"synthetic@example.test"`, `""`, 1)},
		{"unsafe UUID", 200, strings.Replace(claudeTestProfile, "11111111-1111-4111-8111-111111111111", "synthetic-secret", 1)},
		{"trailing data", 200, claudeTestProfile + `{}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			transport := claudeTransport(func(*http.Request) (*http.Response, error) {
				calls++
				response := claudeProfileResponse(test.status, test.body)
				response.Header.Set("Location", "https://unrelated.example.test/steal")
				return response, nil
			})
			identity, err := queryClaudeProfile(context.Background(), credential, transport)
			if err == nil || strings.Contains(err.Error(), "synthetic-") || identity != (claudeIdentity{}) || calls != 1 {
				t.Fatal("unsafe failure, identity, or redirect handling")
			}
		})
	}
	transport := claudeTransport(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("synthetic-secret transport failure")
	})
	if _, err := queryClaudeProfile(context.Background(), credential, transport); err == nil || strings.Contains(err.Error(), "synthetic-") {
		t.Fatal("transport error leaked")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	transport = claudeTransport(func(req *http.Request) (*http.Response, error) { return nil, req.Context().Err() })
	if _, err := queryClaudeProfile(ctx, credential, transport); err == nil {
		t.Fatal("cancellation ignored")
	}
}

func TestClaudeCLIValidationNeedsNoHivePairing(t *testing.T) {
	for _, args := range [][]string{{"--help"}, {"--store", "file"}, {"extra"}} {
		var out bytes.Buffer
		err := Run(context.Background(), append([]string{"claude-status"}, args...), &out)
		if err == nil || strings.Contains(err.Error(), "pairing") {
			t.Fatal("local command reached Hive pairing")
		}
	}
}
