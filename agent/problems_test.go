package bee

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

const inboxKey = "0000000000000000000000000000000000000000000000000000000000000001"

func TestEgressConfigurationErrorsNameCodeAndPlace(t *testing.T) {
	for _, test := range []struct {
		name, body string
		code       string
		detail     string
	}{
		{"syntax", "{\n  \"targets\": [\"chatgpt.com:443\"]\n  \"codex\": {}\n}", "BEE-CONFIG-SYNTAX", "line 3, column 3"},
		{"truncated", `{"targets": ["chatgpt.com:443"]`, "BEE-CONFIG-SYNTAX", "before the JSON object is complete"},
		{"unknown nested field", "{\n  \"targets\": [\"chatgpt.com:443\"],\n  \"codex\": {\"hom\": \"/x\", \"store\": \"file\"}\n}", "BEE-CONFIG-UNKNOWN-FIELD", `"hom" at line 3, column 13`},
		{"wrong type", "{\n  \"targets\": \"chatgpt.com:443\"\n}", "BEE-CONFIG-FIELD-TYPE", `"targets" must be a list, not string`},
		{"nested wrong type", `{"targets": ["chatgpt.com:443"], "codex": {"home": 3, "store": "file"}}`, "BEE-CONFIG-FIELD-TYPE", `"codex.home" must be a string, not number`},
		{"trailing", `{"targets": ["chatgpt.com:443"], "codex": {"home": "/x", "store": "file"}} {}`, "BEE-CONFIG-TRAILING-DATA", "line 1"},
		{"no targets", `{"codex": {"home": "/x", "store": "file"}}`, "BEE-CONFIG-NO-TARGETS", ""},
		{"too many targets", `{"targets": ["a:1","a:2","a:3","a:4","a:5","a:6","a:7","a:8","a:9","a:10","a:11","a:12","a:13","a:14","a:15","a:16","a:17"]}`, "BEE-CONFIG-TOO-MANY-TARGETS", "17 targets"},
		{"target format", `{"targets": ["chatgpt.com"], "codex": {"home": "/x", "store": "file"}}`, "BEE-CONFIG-TARGET-FORMAT", `"chatgpt.com"`},
		{"no source", `{"targets": ["chatgpt.com:443"]}`, "BEE-CONFIG-NO-SOURCE", ""},
		{"static mixed", `{"targets": ["chatgpt.com:443"], "codex": {"home": "/x", "store": "file"}, "credential": {"Token": "t", "Header": "authorization", "Scheme": "Bearer"}}`, "BEE-CONFIG-STATIC-MIXED", ""},
		{"static credential", `{"targets": ["upstream.example:443"], "inbox_key_id": "` + inboxKey + `", "credential": {"Header": "authorization"}}`, "BEE-CONFIG-STATIC-CREDENTIAL", ""},
		{"static without inbox key", `{"targets": ["upstream.example:443"], "credential": {"Token": "t", "Header": "authorization", "Scheme": "Bearer"}}`, "BEE-CONFIG-INBOX-KEY", ""},
		{"malformed inbox key", `{"targets": ["chatgpt.com:443"], "inbox_key_id": "abc", "codex": {"home": "/x", "store": "file"}}`, "BEE-CONFIG-INBOX-KEY", ""},
		{"claude store", `{"targets": ["api.anthropic.com:443"], "claude": {"store": "plaintext"}}`, "BEE-CONFIG-CLAUDE-STORE", `"plaintext"`},
		{"capabilities without codex", `{"targets": ["api.anthropic.com:443"], "claude": {"store": "keychain"}, "capabilities": {}}`, "BEE-CONFIG-CAPABILITIES-SOURCE", ""},
		{"capabilities url", `{"targets": ["chatgpt.com:443"], "codex": {"home": "/x", "store": "file"}, "capabilities": {"local_url": "http://example.com"}}`, "BEE-CONFIG-CAPABILITIES-URL", ""},
		{"codex target missing", `{"targets": ["api.anthropic.com:443"], "codex": {"home": "/x", "store": "file"}, "claude": {"store": "keychain"}}`, "BEE-CONFIG-TARGET-MISSING", "chatgpt.com:443"},
		{"claude target missing", `{"targets": ["chatgpt.com:443"], "codex": {"home": "/x", "store": "file"}, "claude": {"store": "keychain"}}`, "BEE-CONFIG-TARGET-MISSING", "api.anthropic.com:443"},
		{"proxy", `{"targets": ["chatgpt.com:443"], "codex": {"home": "/x", "store": "file"}, "connect_proxy": "http://user:proxy-secret@127.0.0.1:8080"}`, "BEE-CONFIG-PROXY", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := readEgress(context.Background(), writeEgress(t, test.body, 0600))
			code, summary, fix, ok := Coded(err)
			if !ok || code != test.code {
				t.Fatalf("got %v, want %s", err, test.code)
			}
			if strings.Contains(err.Error(), "proxy-secret") {
				t.Fatal("configuration error echoed a proxy credential")
			}
			if !strings.Contains(summary, test.detail) || fix == "" {
				t.Fatalf("summary %q lacks %q, or no fix", summary, test.detail)
			}
		})
	}
}

func TestEgressConfigurationFileProblems(t *testing.T) {
	directory := t.TempDir()
	valid := `{"targets": ["chatgpt.com:443"], "codex": {"home": "/x", "store": "file"}}`
	link := filepath.Join(directory, "link.json")
	if err := os.Symlink(writeEgress(t, valid, 0600), link); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, path, code string
	}{
		{"missing", filepath.Join(directory, "absent.json"), "BEE-CONFIG-NOT-FOUND"},
		{"directory", directory, "BEE-CONFIG-NOT-REGULAR"},
		{"symbolic link", link, "BEE-CONFIG-NOT-REGULAR"},
		{"permissions", writeEgress(t, valid, 0644), "BEE-CONFIG-PERMISSIONS"},
		{"too large", writeEgress(t, strings.Repeat(" ", 65537), 0600), "BEE-CONFIG-TOO-LARGE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := readEgress(context.Background(), test.path)
			if code, _, _, _ := Coded(err); code != test.code {
				t.Fatalf("got %v, want %s", err, test.code)
			}
		})
	}
}

func TestEgressConfigurationAcceptsValidSources(t *testing.T) {
	for _, body := range []string{
		`{"targets": ["chatgpt.com:443"], "codex": {"home": "/x", "store": "file"}, "capabilities": {}}`,
		`{"targets": ["api.anthropic.com:443"], "claude": {"store": "keychain"}}`,
		`{"targets": ["chatgpt.com:443", "api.anthropic.com:443"], "codex": {"home": "/x", "store": "file"}, "claude": {"store": "keychain"}, "connect_proxy": "http://127.0.0.1:8080"}`,
		// A local fixture's loopback upstream stands in for the official address.
		`{"targets": ["127.0.0.1:8443"], "codex": {"home": "/x", "store": "file"}}`,
		`{"targets": ["upstream.example:443"], "inbox_key_id": "` + inboxKey + `", "credential": {"Token": "t", "Header": "authorization", "Scheme": "Bearer"}}`,
	} {
		if _, err := readEgress(context.Background(), writeEgress(t, body, 0600)); err != nil {
			t.Fatalf("%s: %v", body, err)
		}
	}
}

func TestErrorCatalogIsCompleteAndDocumented(t *testing.T) {
	code := regexp.MustCompile(`^BEE(-[A-Z]+)+$`)
	for name, p := range problems {
		if !code.MatchString(name) || p.cause == "" || p.fix == "" {
			t.Errorf("catalog entry %s is malformed or incomplete", name)
		}
	}
	for _, reason := range beewire.SupplyReasons() {
		if r, ok := beewire.ExplainReason(reason, "openai"); !ok || r.Cause == "" || r.Fix == "" || strings.Contains(r.Fix, "PLATFORM") {
			t.Errorf("supply reason %s has no explanation", reason)
		}
	}
	raw, err := os.ReadFile(filepath.Join("..", "docs", "errors.md"))
	if err != nil {
		t.Fatal(err)
	}
	documented := map[string]bool{}
	for _, match := range regexp.MustCompile("(?m)^### `?([a-z_]+|BEE[-A-Z]+)`?$").FindAllStringSubmatch(string(raw), -1) {
		documented[match[1]] = true
	}
	for name := range problems {
		if !documented[name] {
			t.Errorf("docs/errors.md has no section for %s", name)
		}
		delete(documented, name)
	}
	for _, reason := range beewire.SupplyReasons() {
		if !documented[reason] {
			t.Errorf("docs/errors.md has no section for supply reason %s", reason)
		}
		delete(documented, reason)
	}
	for name := range documented {
		t.Errorf("docs/errors.md documents %s, which the catalog does not have", name)
	}
}

func writeEgress(t *testing.T, body string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "egress.json")
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
	return path
}
