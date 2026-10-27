package bee

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

func automaticStartFixture(t *testing.T, input string) (*managementMenu, *strings.Builder, *[]string) {
	t.Helper()
	m, _ := pairedMenu(t, "1\n")
	t.Setenv("CODEX_HOME", codexHome(t, time.Now().Add(time.Hour)))
	validStartIdentity(t, m)
	m.setup = menuSetupOptions{platform: "openai", all: true}
	if err := m.configureAccountsWithNext(false); err != nil {
		t.Fatal(err)
	}
	s, calls := managedFixture(t)
	s.configPath, s.egressPath = m.configPath, m.egressPath
	if err := os.WriteFile(s.unitPath, []byte(managedUnitFixture(s)), 0600); err != nil {
		t.Fatal(err)
	}
	m.service = s
	m.in.Reset(strings.NewReader(input))
	out := &strings.Builder{}
	m.out = out
	return m, out, calls
}

func TestMenuStartAutomaticallyUsesBackground(t *testing.T) {
	m, out, calls := automaticStartFixture(t, "")
	old := m.service.execute
	active := false
	m.service.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
		v, e := old(c, n, a, i, o)
		if n == "sudo" {
			active = true
		}
		if active {
			v = strings.ReplaceAll(v, "ActiveState=inactive", "ActiveState=active")
		}
		return v, e
	}
	if err := m.starts(); err != nil {
		t.Fatal(err, out.String())
	}
	if !strings.Contains(strings.Join(*calls, "\n"), "sudo systemctl start tokhive-bee") {
		t.Fatal(*calls, out.String())
	}
	if strings.Contains(out.String(), "现在启动前台") || strings.Contains(out.String(), "选择运行方式") {
		t.Fatal(out.String())
	}
}

func TestMenuStartAlreadyActiveDoesNotPromptOrMutate(t *testing.T) {
	m, out, calls := automaticStartFixture(t, "")
	old := m.service.execute
	m.service.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
		v, e := old(c, n, a, i, o)
		return strings.ReplaceAll(v, "ActiveState=inactive", "ActiveState=active"), e
	}
	if err := os.Remove(m.egressPath); err != nil {
		t.Fatal(err)
	}
	if err := m.starts(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "已在后台运行") {
		t.Fatal(out.String())
	}
	for _, c := range *calls {
		if strings.HasPrefix(c, "sudo ") {
			t.Fatal(c)
		}
	}
}

func TestMenuStartUnavailableRunsForegroundWithoutAnotherPrompt(t *testing.T) {
	for _, platform := range []string{"darwin", "linux"} {
		t.Run(platform, func(t *testing.T) {
			m, out, _ := automaticStartFixture(t, "")
			m.service = &managedService{platform: platform, execute: func(context.Context, string, []string, io.Reader, io.Writer) (string, error) {
				return "LoadState=not-found\n", nil
			}}
			unlock, err := lockState(m.configPath)
			if err != nil {
				t.Fatal(err)
			}
			defer unlock()
			err = m.starts()
			if err == nil || errors.Is(err, io.EOF) || !strings.Contains(out.String(), "运行日志（原文）") {
				t.Fatalf("foreground not attempted: %v\n%s", err, out)
			}
			if strings.Contains(out.String(), "仅保持在线") || strings.Contains(out.String(), "现在启动前台 Bee？") {
				t.Fatal(out.String())
			}
		})
	}
}

func TestMenuStartInspectionErrorDoesNotFallBack(t *testing.T) {
	m, out, calls := automaticStartFixture(t, "")
	m.service.execute = func(context.Context, string, []string, io.Reader, io.Writer) (string, error) {
		return "", errors.New("exit 7: permission denied")
	}
	err := m.starts()
	if err == nil || !strings.Contains(err.Error(), "exit 7: permission denied") {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "运行日志") || len(*calls) > 0 {
		t.Fatal(out.String(), *calls)
	}
}

func TestMenuStartCancellationDoesNotMutate(t *testing.T) {
	m, out, calls := automaticStartFixture(t, "0\n")
	if err := os.Remove(m.egressPath); err != nil {
		t.Fatal(err)
	}
	if err := m.starts(); err != nil {
		t.Fatal(err)
	}
	for _, c := range *calls {
		if strings.HasPrefix(c, "sudo ") {
			t.Fatal(c)
		}
	}
	if strings.Contains(out.String(), "运行日志") {
		t.Fatal(out.String())
	}
}

func TestMenuStartRejectsUnsafeServiceWithoutForegroundFallback(t *testing.T) {
	for _, failure := range []string{"binary mismatch", "activating", "start failure"} {
		t.Run(failure, func(t *testing.T) {
			m, out, calls := automaticStartFixture(t, "")
			old := m.service.execute
			switch failure {
			case "binary mismatch":
				m.service.binary += ".other"
			case "activating":
				m.service.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
					v, e := old(c, n, a, i, o)
					return strings.ReplaceAll(v, "ActiveState=inactive", "ActiveState=activating"), e
				}
			case "start failure":
				m.service.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
					if n == "sudo" {
						return "", errors.New("exit 7: permission denied")
					}
					return old(c, n, a, i, o)
				}
			}
			err := m.starts()
			if err == nil || errors.Is(err, io.EOF) || strings.Contains(out.String(), "运行日志") {
				t.Fatalf("error=%v output=%s", err, out)
			}
			for _, c := range *calls {
				if strings.HasPrefix(c, "sudo ") {
					t.Fatal(c)
				}
			}
			if failure == "start failure" && !strings.Contains(err.Error(), "exit 7: permission denied") {
				t.Fatal(err)
			}
		})
	}
}

func TestMenuStartExistingServiceGuidesMissingSupply(t *testing.T) {
	m, _, calls := automaticStartFixture(t, "0\n")
	if err := os.Remove(m.egressPath); err != nil {
		t.Fatal(err)
	}
	if err := m.starts(); err != nil {
		t.Fatal(err)
	}
	for _, c := range *calls {
		if strings.HasPrefix(c, "sudo ") {
			t.Fatal(c)
		}
	}
	if _, err := os.Stat(m.egressPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestMenuStartAutomaticallyGuidesMissingPairing(t *testing.T) {
	m, out := menuFixture(t, "0\n")
	m.service = &managedService{platform: "darwin"}
	if err := m.starts(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "请输入 Hive 地址") || strings.Contains(out.String(), "是否需要引导") {
		t.Fatal(out.String())
	}
	if _, err := os.Stat(m.configPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
