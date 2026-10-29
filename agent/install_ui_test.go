package bee

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestInstallUILanguage(t *testing.T) {
	for _, tc := range []struct{ explicit, all, messages, lang, want string }{
		{"zh", "en", "", "", "zh"},
		{"en", "zh", "", "", "en"},
		{"", "zh_CN.UTF-8", "", "en_US.UTF-8", "en"},
		{"", "", "zh_CN.UTF-8", "en", "en"},
		{"", "C", "zh", "zh", "en"},
		{"", "", "", "zh_TW", "en"},
	} {
		t.Run(tc.explicit+tc.all+tc.messages+tc.lang, func(t *testing.T) {
			t.Setenv("BEE_LANG", tc.explicit)
			t.Setenv("LC_ALL", tc.all)
			t.Setenv("LC_MESSAGES", tc.messages)
			t.Setenv("LANG", tc.lang)
			ui, err := newInstallUI(&bytes.Buffer{})
			if err != nil || ui.lang != tc.want {
				t.Fatalf("language = %v, %v; want %s", ui, err, tc.want)
			}
		})
	}
}

func TestInstallUIRejectsInvalidLanguageBeforeWriting(t *testing.T) {
	t.Setenv("BEE_LANG", "fr")
	for _, command := range []string{"login", "setup"} {
		config := filepath.Join(t.TempDir(), "bee.json")
		err := Run(context.Background(), []string{command, "--config", config}, &bytes.Buffer{})
		if err == nil || !strings.Contains(err.Error(), "fr") || !strings.Contains(err.Error(), "zh") || !strings.Contains(err.Error(), "en") {
			t.Fatalf("%s: %v", command, err)
		}
		if _, err := os.Stat(config); !os.IsNotExist(err) {
			t.Fatalf("invalid language created config: %v", err)
		}
	}
}

func TestSetupConsentAndInstallerChinese(t *testing.T) {
	for _, tc := range []struct {
		name, input string
		success     bool
	}{{"invalid then no", "maybe\nn\n", false}, {"invalid then yes", "maybe\ny\n", true}, {"EOF", "", false}, {"unterminated yes", "y", false}, {"blank", "\n", true}} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("BEE_LANG", "zh")
			t.Setenv("BEE_INSTALL_UI", "1")
			answer(t, tc.input)
			config := filepath.Join(t.TempDir(), "bee.json")
			out, err := runSetup(t, "--config", config, "--platform", "openai", "--codex-home", codexHome(t, time.Now().Add(time.Hour)))
			if (err == nil) != tc.success {
				t.Fatalf("success=%v err=%v output=%s", tc.success, err, out)
			}
			if !strings.Contains(out, "允许 Bee") || !strings.Contains(out, "方案") || strings.Contains(out, "Next:") || strings.Contains(out, "\x1b") {
				t.Fatalf("unexpected UI: %s", out)
			}
			if !tc.success {
				if _, e := os.Stat(defaultEgressPath(config)); !os.IsNotExist(e) {
					t.Fatalf("consent wrote config: %v", e)
				}
			}
		})
	}
}

func TestFinishLoginChinese(t *testing.T) {
	t.Setenv("BEE_LANG", "zh")
	t.Setenv("BEE_INSTALL_UI", "1")
	var out bytes.Buffer
	err := finishLogin(filepath.Join(t.TempDir(), "bee.json"), localState{}, beewire.Identity{ID: "device-123", OwnerEmail: "test@example.com"}, &out)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"设备配对完成", "test@example.com", "device-123"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("missing %s: %s", want, out.String())
		}
	}
}

func TestPairingInstructionsBilingual(t *testing.T) {
	for _, lang := range []string{"zh", "en"} {
		t.Run(lang, func(t *testing.T) {
			t.Setenv("BEE_LANG", lang)
			t.Setenv("BEE_INSTALL_UI", "1")
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(401)
				w.Write([]byte(`{"error":"unauthorized"}`))
			}))
			defer server.Close()
			var out bytes.Buffer
			state := localState{Hive: server.URL, Credential: "synthetic", Pairing: &beewire.Pairing{VerificationURI: "https://hive.example/devices/pair", UserCode: "ABCD-EFGH", ExpiresAt: time.Now().Add(time.Hour)}}
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			_ = login(ctx, server.Client(), filepath.Join(t.TempDir(), "bee.json"), state, &out)
			for _, want := range []string{"https://hive.example/devices/pair?code=ABCD-EFGH", "ABCD-EFGH"} {
				if !strings.Contains(out.String(), want) {
					t.Fatalf("missing %s: %s", want, out.String())
				}
			}
			want := "Waiting for confirmation"
			if lang == "zh" {
				want = "等待你在网页确认"
			}
			if !strings.Contains(out.String(), want) {
				t.Fatalf("missing %s: %s", want, out.String())
			}
		})
	}
}

func TestInstallerSuppressesPairingInfo(t *testing.T) {
	t.Setenv("BEE_LANG", "en")
	t.Setenv("BEE_INSTALL_UI", "1")
	var logs, out bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(previous)
	if err := finishLogin(filepath.Join(t.TempDir(), "bee.json"), localState{}, beewire.Identity{ID: "device"}, &out); err != nil {
		t.Fatal(err)
	}
	if logs.Len() != 0 {
		t.Fatalf("redundant installer log: %s", logs.String())
	}
}

func TestSetupChinesePerAccountChoice(t *testing.T) {
	t.Setenv("BEE_LANG", "zh")
	t.Setenv("BEE_INSTALL_UI", "1")
	fakeClaude(t, nil)
	answer(t, "invalid\n YES \nno\n")
	config := filepath.Join(t.TempDir(), "bee.json")
	out, err := runSetup(t, "--config", config, "--codex-home", codexHome(t, time.Now().Add(time.Hour)))
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	cfg := writtenEgress(t, defaultEgressPath(config))
	if cfg["claude"] != nil || cfg["codex"] == nil {
		t.Fatalf("wrong per-account consent: %v", cfg)
	}
	for _, want := range []string{"Claude Code 登录位置", "供给：openai", "跳过：claude", "请输入 yes 或 no"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %s: %s", want, out)
		}
	}
}

func TestInstallUIDisplayModes(t *testing.T) {
	t.Setenv("BEE_LANG", "en")
	t.Setenv("TERM", "xterm")
	t.Setenv("NO_COLOR", "")
	for _, name := range []string{"TOKHIVE_LOG_LEVEL", "TOKHIVE_LOG_MODULES", "BEE_DEBUG", "TOKHIVE_LOG_FORMAT"} {
		t.Setenv(name, "")
	}
	terminal, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	for _, tc := range []struct {
		name, term, noColor string
		writer              io.Writer
		icon, color         bool
	}{
		{"terminal", "xterm", "", terminal, true, true}, {"no color", "xterm", "1", terminal, true, false}, {"dumb", "dumb", "", terminal, false, false}, {"pipe", "xterm", "", &bytes.Buffer{}, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TERM", tc.term)
			t.Setenv("NO_COLOR", tc.noColor)
			ui, err := newInstallUI(tc.writer)
			if err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			ui.status(&out, "✅", "32", "Done", "完成")
			if strings.Contains(out.String(), "✅") != tc.icon || strings.Contains(out.String(), "\x1b[") != tc.color {
				t.Fatalf("wrong display mode: %q", out.String())
			}
		})
	}
}
