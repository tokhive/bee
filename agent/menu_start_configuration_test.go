package bee

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

func startIdentityServer(t *testing.T, m *managementMenu, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	state, err := readState(m.configPath)
	if err != nil {
		t.Fatal(err)
	}
	state.Hive = server.URL
	if err := saveState(m.configPath, state); err != nil {
		t.Fatal(err)
	}
	return server
}
func validStartIdentity(t *testing.T, m *managementMenu) {
	t.Helper()
	startIdentityServer(t, m, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/api/bee/identity" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		json.NewEncoder(w).Encode(beewire.Identity{ID: "old", Name: "test"})
	})
}

func TestMenuStartResumesUnfinishedPairingWithoutChoice(t *testing.T) {
	m, out, _ := automaticStartFixture(t, "")
	state, _ := readState(m.configPath)
	state.Identity = nil
	if err := saveState(m.configPath, state); err != nil {
		t.Fatal(err)
	}
	ready, err := m.prepareStart()
	if err != nil || !ready {
		t.Fatalf("ready=%v err=%v output=%s", ready, err, out)
	}
	after, _ := readState(m.configPath)
	if after.Identity == nil || after.Credential != state.Credential || strings.Contains(out.String(), "验证 / 继续配对") {
		t.Fatal(after.Identity, out.String())
	}
}

func TestMenuStartInvalidPairingRequiresConfirmationAndKeepsSupply(t *testing.T) {
	for _, code := range []string{"device_replaced", "invalid_device_credential"} {
		for _, confirm := range []bool{false, true} {
			t.Run(code+map[bool]string{true: "/confirm", false: "/cancel"}[confirm], func(t *testing.T) {
				input := "\n\n0\n"
				if confirm {
					input = "\n\n1\n"
				}
				m, out, _ := automaticStartFixture(t, input)
				old, _ := readState(m.configPath)
				startIdentityServer(t, m, func(w http.ResponseWriter, r *http.Request) {
					if r.Header.Get("Authorization") == "Bearer "+old.Credential {
						w.WriteHeader(401)
						json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code}})
					} else {
						json.NewEncoder(w).Encode(beewire.Identity{ID: "new"})
					}
				})
				before, _ := os.ReadFile(m.configPath)
				supply, _ := os.ReadFile(m.egressPath)
				ready, err := m.prepareStart()
				if err != nil || ready != confirm {
					t.Fatalf("ready=%v err=%v output=%s", ready, err, out)
				}
				after, _ := os.ReadFile(m.configPath)
				backups, _ := filepath.Glob(m.configPath + ".backup.*/bee.json")
				if confirm {
					if len(backups) != 1 || bytes.Equal(before, after) {
						t.Fatal(backups, "configuration unchanged")
					}
					saved, _ := os.ReadFile(backups[0])
					if !bytes.Equal(before, saved) {
						t.Fatal("backup differs")
					}
				} else if len(backups) != 0 || !bytes.Equal(before, after) {
					t.Fatal("cancellation changed configuration")
				}
				saved, _ := os.ReadFile(m.egressPath)
				if !bytes.Equal(supply, saved) {
					t.Fatal("supply changed")
				}
				if !strings.Contains(out.String(), code) || strings.Contains(out.String(), "验证 / 继续配对") {
					t.Fatal(out.String())
				}
			})
		}
	}
}

func TestMenuStartUncertainIdentityFailureNeverResets(t *testing.T) {
	for _, status := range []int{0, 401, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			m, out, _ := automaticStartFixture(t, "")
			server := startIdentityServer(t, m, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "unknown"}})
			})
			if status == 0 {
				server.Close()
			}
			before, _ := os.ReadFile(m.configPath)
			ready, err := m.prepareStart()
			if err == nil || ready {
				t.Fatalf("ready=%v err=%v", ready, err)
			}
			m.reportError(err)
			after, _ := os.ReadFile(m.configPath)
			backups, _ := filepath.Glob(m.configPath + ".backup.*")
			if !bytes.Equal(before, after) || len(backups) > 0 || strings.Contains(out.String(), "请输入 Hive 地址") {
				t.Fatal(out.String(), backups)
			}
		})
	}
}

func TestMenuStartRejectsBrokenConfigurationBeforeGuidance(t *testing.T) {
	for _, target := range []string{"device", "supply"} {
		for _, kind := range []string{"syntax", "permissions", "directory", "trailing"} {
			t.Run(target+"/"+kind, func(t *testing.T) {
				m, out := menuFixture(t, "")
				path := m.configPath
				if target == "supply" {
					path = m.egressPath
				}
				body := []byte(`{"credential":`)
				if kind == "trailing" {
					body = []byte(`{} {}`)
				}
				if kind == "permissions" {
					body = []byte(`{}`)
				}
				if kind == "directory" {
					if err := os.Mkdir(path, 0700); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := os.WriteFile(path, body, 0600); err != nil {
						t.Fatal(err)
					}
					if kind == "permissions" {
						if err := os.Chmod(path, 0644); err != nil {
							t.Fatal(err)
						}
					}
				}
				ready, err := m.prepareStart()
				if err == nil || ready {
					t.Fatalf("ready=%v err=%v", ready, err)
				}
				m.reportError(err)
				if !strings.Contains(out.String(), path) || !strings.Contains(out.String(), "下一步") || strings.Contains(out.String(), "请输入 Hive 地址") {
					t.Fatal(out.String())
				}
				if kind != "directory" {
					after, _ := os.ReadFile(path)
					if !bytes.Equal(body, after) {
						t.Fatal("configuration overwritten")
					}
				}
			})
		}
	}
}

func TestMenuStartKeepsSupplyWhenOfficialSignInIsMissing(t *testing.T) {
	m, _, _ := automaticStartFixture(t, "")
	cfg, err := readEgress(m.ctx, m.egressPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(cfg.Codex.Home, "auth.json")); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(m.egressPath)
	m.configure = func() error { t.Fatal("reselected existing supply"); return nil }
	ready, err := m.prepareStart()
	if err != nil || !ready {
		t.Fatal(ready, err)
	}
	after, _ := os.ReadFile(m.egressPath)
	if !bytes.Equal(before, after) {
		t.Fatal("supply changed")
	}
}

func TestMenuStartDoesNotResetConfigurationChangedDuringVerification(t *testing.T) {
	m, _, _ := automaticStartFixture(t, "\n\n1\n")
	var updated []byte
	startIdentityServer(t, m, func(w http.ResponseWriter, r *http.Request) {
		state, err := readState(m.configPath)
		if err != nil {
			t.Error(err)
		}
		state.Credential = "bee_" + strings.Repeat("b", 43)
		if err = saveState(m.configPath, state); err != nil {
			t.Error(err)
		}
		updated, _ = os.ReadFile(m.configPath)
		w.WriteHeader(401)
		json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "device_replaced"}})
	})
	ready, err := m.prepareStart()
	if err == nil || ready || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("ready=%v err=%v", ready, err)
	}
	after, _ := os.ReadFile(m.configPath)
	backups, _ := filepath.Glob(m.configPath + ".backup.*")
	if !bytes.Equal(updated, after) || len(backups) > 0 {
		t.Fatal("new configuration was reset")
	}
}

func TestMenuStartMissingSupplySaveCanBeCancelled(t *testing.T) {
	m, _, _ := automaticStartFixture(t, "2\n0\n")
	if err := os.Remove(m.egressPath); err != nil {
		t.Fatal(err)
	}
	ready, err := m.prepareStart()
	if err != nil || ready {
		t.Fatal(ready, err)
	}
	if _, err := os.Stat(m.egressPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestMenuStartFileReadFailuresKeepEvidence(t *testing.T) {
	for _, device := range []bool{true, false} {
		t.Run(map[bool]string{true: "device", false: "supply"}[device], func(t *testing.T) {
			m, out := menuFixture(t, "")
			blocker := filepath.Join(filepath.Dir(m.configPath), "blocker")
			if err := os.WriteFile(blocker, []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(blocker, "config.json")
			if device {
				m.configPath = path
			} else {
				m.egressPath = path
			}
			ready, err := m.prepareStart()
			if err == nil || ready {
				t.Fatal(ready, err)
			}
			m.reportError(err)
			if !strings.Contains(out.String(), path) || !strings.Contains(out.String(), "not a directory") || !strings.Contains(out.String(), "下一步") {
				t.Fatal(out.String())
			}
		})
	}
}

func TestMenuStartInvalidDeviceFieldsKeepConfiguration(t *testing.T) {
	for _, body := range []string{`null`, `{"credential":12}`, `{"credential":"bee_bad"}`, `{"credential":"bee_` + strings.Repeat("a", 43) + `","hive":"invalid"}`} {
		m, out := menuFixture(t, "")
		if err := os.WriteFile(m.configPath, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		ready, err := m.prepareStart()
		if err == nil || ready {
			t.Fatal(ready, err)
		}
		m.reportError(err)
		if !strings.Contains(out.String(), m.configPath) || !strings.Contains(out.String(), "下一步") {
			t.Fatal(out.String())
		}
		after, _ := os.ReadFile(m.configPath)
		if string(after) != body {
			t.Fatal("configuration changed")
		}
	}
}
