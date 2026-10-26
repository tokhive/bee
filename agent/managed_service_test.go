package bee

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func managedFixture(t *testing.T) (*managedService, *[]string) {
	t.Helper()
	root := t.TempDir()
	binary := filepath.Join(root, "bee $HOME%\";literal")
	if err := os.WriteFile(binary, []byte("binary"), 0700); err != nil {
		t.Fatal(err)
	}
	cfg := filepath.Join(root, "bee.json")
	egress := filepath.Join(root, "egress.json")
	s := &managedService{configPath: cfg, egressPath: egress, binary: binary, username: "dayong", uid: "1000", platform: "linux", in: strings.NewReader(""), out: io.Discard}
	s.unitPath = filepath.Join(root, "tokhive-bee.service")
	content := managedUnitFixture(s)
	if err := os.WriteFile(s.unitPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	calls := []string{}
	s.execute = func(_ context.Context, name string, args []string, _ io.Reader, _ io.Writer) (string, error) {
		calls = append(calls, name+" "+strings.Join(args, " "))
		if len(args) > 0 && args[0] == "show" {
			return "LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled\nUser=dayong\nFragmentPath=" + s.unitPath + "\nDropInPaths=\nNeedDaemonReload=no\n", nil
		}
		return "", nil
	}
	return s, &calls
}

func TestManagedAcceptsInstallerUnitAndLiteralPaths(t *testing.T) {
	s, _ := managedFixture(t)
	state, err := s.inspect(context.Background())
	if err != nil || state.ActiveState != "inactive" {
		t.Fatalf("%+v %v", state, err)
	}
}
func TestManagedRejectsChangedTargetsAndUnsafeUnits(t *testing.T) {
	for _, change := range []string{"user", "binary", "config", "override", "symlink", "extra"} {
		t.Run(change, func(t *testing.T) {
			s, calls := managedFixture(t)
			switch change {
			case "user":
				s.username = "other"
			case "binary":
				s.binary = filepath.Join(t.TempDir(), "different")
			case "config":
				s.configPath += "other"
			case "symlink":
				raw, _ := os.ReadFile(s.unitPath)
				os.Remove(s.unitPath)
				target := s.unitPath + ".real"
				os.WriteFile(target, raw, 0644)
				os.Symlink(target, s.unitPath)
			case "extra":
				f, _ := os.OpenFile(s.unitPath, os.O_APPEND|os.O_WRONLY, 0)
				f.WriteString("\n[Service]\nRootDirectory=/other\n")
				f.Close()
			case "override":
				old := s.execute
				s.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
					v, e := old(c, n, a, i, o)
					return strings.ReplaceAll(v, "DropInPaths=", "DropInPaths=/etc/override.conf"), e
				}
			}
			if _, err := s.apply(context.Background(), "enable"); err == nil {
				t.Fatal("unsafe service accepted")
			}
			for _, c := range *calls {
				if strings.HasPrefix(c, "sudo ") {
					t.Fatalf("mutation: %s", c)
				}
			}
		})
	}
}
func TestManagedUnavailableAndUnknownActionsDoNotMutate(t *testing.T) {
	s, calls := managedFixture(t)
	s.platform = "darwin"
	if _, e := s.inspect(context.Background()); !errors.Is(e, errServiceUnavailable) {
		t.Fatalf("%v", e)
	}
	s.platform = "linux"
	if _, e := s.apply(context.Background(), "enable --now"); e == nil {
		t.Fatal("invalid action")
	}
	if len(*calls) != 0 {
		t.Fatal(*calls)
	}
}
func TestManagedEnableAndDisableDoNotStartOrStop(t *testing.T) {
	for _, action := range []string{"enable", "disable"} {
		t.Run(action, func(t *testing.T) {
			s, calls := managedFixture(t)
			if action == "disable" {
				old := s.execute
				s.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
					v, e := old(c, n, a, i, o)
					return strings.ReplaceAll(v, "UnitFileState=enabled", "UnitFileState=disabled"), e
				}
			}
			if _, err := s.apply(context.Background(), action); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(strings.Join(*calls, "\n"), "sudo systemctl "+action+" tokhive-bee") {
				t.Fatal(*calls)
			}
			for _, c := range *calls {
				if strings.Contains(c, "--now") || strings.Contains(c, " start ") || strings.Contains(c, " stop ") {
					t.Fatal(c)
				}
			}
		})
	}
}
func TestManagedStartRequiresObservedActive(t *testing.T) {
	s, _ := managedFixture(t)
	_, err := s.apply(context.Background(), "start")
	if err == nil || !strings.Contains(err.Error(), "inactive") {
		t.Fatalf("%v", err)
	}
}
func TestManagedKeepsExternalFailureEvidence(t *testing.T) {
	s, _ := managedFixture(t)
	old := s.execute
	s.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
		if n == "sudo" {
			return "", errors.New("exit 7: permission denied")
		}
		return old(c, n, a, i, o)
	}
	_, err := s.apply(context.Background(), "enable")
	if err == nil || !strings.Contains(err.Error(), "exit 7: permission denied") {
		t.Fatalf("%v", err)
	}
}
func TestManagedLogsAreBoundedAndNeverImplicitlyElevated(t *testing.T) {
	s, calls := managedFixture(t)
	if err := s.logs(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	last := (*calls)[len(*calls)-1]
	if last != "journalctl -u tokhive-bee -n 50 --no-pager" {
		t.Fatal(last)
	}
}

func managedUnitFixture(s *managedService) string {
	return "# Managed by Bee install.sh.\n[Unit]\nDescription=TokHive Bee\nAfter=network.target\n[Service]\nType=simple\nUser=dayong\nEnvironment=" + serviceQuote("HOME=/home/dayong", false) + "\nEnvironment=" + serviceQuote("PATH=/usr/bin", false) + "\nEnvironment=" + serviceQuote("XDG_CONFIG_HOME="+filepath.Dir(filepath.Dir(s.configPath)), false) + "\nExecCondition=/usr/bin/test -f " + serviceQuote(s.configPath, true) + "\nExecCondition=/usr/bin/test -f " + serviceQuote(s.egressPath, true) + "\nExecStart=/bin/sh -c " + serviceQuote(`exec "$@"`, true) + " bee " + serviceQuote(s.binary, true) + " run --config " + serviceQuote(s.configPath, true) + " --egress-config " + serviceQuote(s.egressPath, true) + "\nRestart=on-failure\nRestartSec=10\n[Install]\nWantedBy=multi-user.target\n"
}

func TestManagedRejectsStaleLoadedUnitAndTransitionalState(t *testing.T) {
	for _, replacement := range []string{"NeedDaemonReload=yes", "ActiveState=activating", "ActiveState=reloading", "ActiveState=deactivating"} {
		t.Run(replacement, func(t *testing.T) {
			s, calls := managedFixture(t)
			old := s.execute
			s.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
				v, e := old(c, n, a, i, o)
				if strings.HasPrefix(replacement, "Need") {
					v = strings.ReplaceAll(v, "NeedDaemonReload=no", replacement)
				} else {
					v = strings.ReplaceAll(v, "ActiveState=inactive", replacement)
				}
				return v, e
			}
			if _, e := s.apply(context.Background(), "enable"); e == nil {
				t.Fatal("accepted", replacement)
			}
			for _, c := range *calls {
				if strings.HasPrefix(c, "sudo ") {
					t.Fatal(c)
				}
			}
		})
	}
}
func TestManagedMissingUnitIsUnavailable(t *testing.T) {
	s, _ := managedFixture(t)
	s.execute = func(context.Context, string, []string, io.Reader, io.Writer) (string, error) {
		return "LoadState=not-found\n", nil
	}
	if _, e := s.inspect(context.Background()); !errors.Is(e, errServiceUnavailable) {
		t.Fatal(e)
	}
}

func TestManagedRejectsUnescapedEnvironmentSpecifier(t *testing.T) {
	s, _ := managedFixture(t)
	f, e := os.OpenFile(s.unitPath, os.O_APPEND|os.O_WRONLY, 0)
	if e != nil {
		t.Fatal(e)
	}
	_, e = f.WriteString("\n[Service]\nEnvironment=\"CODEX_HOME=/tmp/%h\"\n")
	f.Close()
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.inspect(context.Background()); e == nil {
		t.Fatal("systemd environment specifier accepted as literal")
	}
}

func TestManagedJournalPermissionWarningIsVisibleAndActionable(t *testing.T) {
	directory := t.TempDir()
	program := filepath.Join(directory, "journalctl")
	warning := "Hint: You are currently not seeing messages from other users and the system."
	if e := os.WriteFile(program, []byte("#!/bin/sh\nprintf '%s\\n' '"+warning+"' >&2\nprintf '%s\\n' '-- No entries --'\n"), 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	var out strings.Builder
	_, e := executeService(context.Background(), "journalctl", []string{"-n", "50"}, nil, &out)
	if e == nil || !strings.Contains(e.Error(), warning) || !strings.Contains(out.String(), warning) {
		t.Fatalf("error=%v output=%q", e, out.String())
	}
}

func TestManagedMissingSystemctlIsUnavailable(t *testing.T) {
	s, _ := managedFixture(t)
	s.execute = executeService
	t.Setenv("PATH", t.TempDir())
	if _, err := s.inspect(context.Background()); !errors.Is(err, errServiceUnavailable) {
		t.Fatal(err)
	}
}

func TestManagedNonSystemdInitIsUnavailable(t *testing.T) {
	directory := t.TempDir()
	program := filepath.Join(directory, "systemctl")
	message := "System has not been booted with systemd as init system (PID 1). Can't operate."
	if err := os.WriteFile(program, []byte("#!/bin/sh\ncat >&2 <<'MSG'\n"+message+"\nMSG\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	s, _ := managedFixture(t)
	s.execute = executeService
	_, err := s.inspect(context.Background())
	if !errors.Is(err, errServiceUnavailable) || !strings.Contains(err.Error(), message) {
		t.Fatal(err)
	}
}
