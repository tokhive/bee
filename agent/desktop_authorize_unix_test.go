//go:build !windows

package bee

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func init() {
	desktopAuthorizationSupervisorArguments = []string{"-test.run=^TestDesktopAuthorizationSupervisorHelper$", "--"}
	desktopAuthorizationSupervisorEnvironment = []string{"GORACE=atexit_sleep_ms=0"}
}

func TestDesktopAuthorizationSupervisorHelper(t *testing.T) {
	boundary := slices.Index(os.Args, "--")
	if boundary < 0 {
		return
	}
	if failure := os.Getenv("BEE_TEST_GUARDIAN_OBSERVE_FAILURE"); failure != "" {
		desktopAuthorizationSignalGroup = func(group int, signal syscall.Signal) error {
			if signal == syscall.SIGKILL {
				if _, err := os.Stat(failure); err == nil {
					return syscall.EPERM
				}
			}
			return syscall.Kill(group, signal)
		}
		observations := 0
		desktopAuthorizationObserveGroup = func(group int) (desktopAuthorizationGroupStatus, error) {
			if _, err := os.Stat(failure); err == nil {
				observations++
				if observations > 1 {
					_ = os.WriteFile(failure+".retained", []byte(strconv.Itoa(group)), 0600)
				}
				return desktopAuthorizationGroupStatus{}, fmt.Errorf("synthetic kernel group observation rejected: group=%d", group)
			}
			return observeDesktopAuthorizationGroup(group)
		}
	}
	if err := desktopLoginSupervisor(context.Background(), os.Args[boundary+1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(0)
}

const desktopAuthorizationForkFixture = `/bin/sh -c 'printf "%s" "$$" > "$1"; while [ ! -e "$2" ]; do sleep 0.01; done; printf late > "$3"' source-writer "$1" "$2" "$3" &
while [ ! -s "$1" ]; do sleep 0.001; done
printf ready
IFS= read -r start
for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do sleep 10 & done
wait
`

func assertDesktopAuthorizationDescendantStopped(t *testing.T, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	pid := strings.TrimSpace(string(raw))
	if value, err := strconv.Atoi(pid); err != nil || value <= 0 {
		t.Fatalf("official descendant PID rejected: pid=%q", pid)
	}
	state, err := exec.Command("/bin/ps", "-p", pid, "-o", "stat=").Output()
	var absent *exec.ExitError
	if err != nil && !errors.As(err, &absent) {
		t.Fatal(err)
	}
	if state := strings.TrimSpace(string(state)); state != "" && !strings.HasPrefix(state, "Z") {
		t.Fatalf("owned descendant still live after cleanup: pid=%s state=%s", pid, state)
	}
}

func TestDesktopAuthorizeCancelJoinsForkingDescendantsBeforeReleasingGuard(t *testing.T) {
	for round := 0; round < 24; round++ {
		dir := t.TempDir()
		guard, pid, release, source := filepath.Join(dir, "guard"), filepath.Join(dir, "pid"), filepath.Join(dir, "release"), filepath.Join(dir, "source")
		file, err := openDesktopLoginProcessLock(guard, true)
		if err != nil {
			t.Fatal(err)
		}
		lease := &desktopLoginProcessLease{file: file}
		input, writer, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		output, stream, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.WithValue(context.Background(), desktopLoginProcessContextKey{}, lease))
		command := exec.Command("/bin/sh", "-c", desktopAuthorizationForkFixture, "official-fixture", pid, release, source)
		command.Stdin, command.Stdout, command.Stderr = input, stream, io.Discard
		done := make(chan error, 1)
		go func() { done <- runDesktopAuthorization(ctx, command) }()
		if err := output.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
			t.Fatal(err)
		}
		ready := make([]byte, len("ready"))
		if _, err := io.ReadFull(output, ready); err != nil {
			cancel()
			t.Fatal(err)
		}
		if _, err := io.WriteString(writer, "fork\n"); err != nil {
			t.Fatal(err)
		}
		cancel()
		select {
		case err := <-done:
			var cleanup *desktopAuthorizationCleanupError
			if !errors.Is(err, context.Canceled) || errors.As(err, &cleanup) {
				t.Fatalf("round=%d clean cancellation rejected: %v", round, err)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("round=%d guardian did not join owned group", round)
		}
		stream.Close()
		lease.close()
		proof, err := openDesktopLoginProcessLock(guard, false)
		if err != nil {
			t.Fatalf("round=%d descendant retained original guard: %v", round, err)
		}
		proof.Close()
		assertDesktopAuthorizationDescendantStopped(t, pid)
		if err := output.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
			t.Fatal(err)
		}
		if _, err := io.Copy(io.Discard, output); err != nil {
			t.Fatalf("round=%d descendant retained official output: %v", round, err)
		}
		os.WriteFile(release, []byte("continue after cancellation"), 0600)
		if _, err := os.Stat(source); !os.IsNotExist(err) {
			t.Fatalf("round=%d stopped descendant wrote the source: %v", round, err)
		}
		input.Close()
		writer.Close()
		output.Close()
	}
}

func TestDesktopAuthorizeObservationFailureRetainsGuardUntilStopIsProved(t *testing.T) {
	dir := t.TempDir()
	guard, started, failure := filepath.Join(dir, "guard"), filepath.Join(dir, "started"), filepath.Join(dir, "kernel-failure")
	file, err := openDesktopLoginProcessLock(guard, true)
	if err != nil {
		t.Fatal(err)
	}
	lease := &desktopLoginProcessLease{file: file}
	defer lease.close()
	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), desktopLoginProcessContextKey{}, lease))
	defer cancel()
	command := exec.Command("/bin/sh", "-c", `printf started > "$1"; sleep 10`, "official-fixture", started)
	command.Env = append(os.Environ(), "BEE_TEST_GUARDIAN_OBSERVE_FAILURE="+failure)
	command.Stdout, command.Stderr = io.Discard, io.Discard
	done := make(chan error, 1)
	go func() { done <- runDesktopAuthorization(ctx, command) }()
	waitDesktopLoginFile(t, started)
	if err := os.WriteFile(failure, []byte("synthetic kernel observation failure"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(failure) })
	cancel()
	select {
	case err := <-done:
		var cleanup *desktopAuthorizationCleanupError
		if !errors.As(err, &cleanup) || !strings.Contains(err.Error(), "synthetic kernel group observation rejected: group=") {
			t.Fatalf("cleanup failure lost original observation evidence: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("unconfirmed cleanup was not reported to the manager")
	}
	lease.close()
	waitDesktopLoginFile(t, failure+".retained")
	group, err := os.ReadFile(failure + ".retained")
	if err != nil {
		t.Fatal(err)
	}
	state, err := exec.Command("/bin/ps", "-p", string(group), "-o", "stat=").Output()
	if err != nil || !strings.HasPrefix(strings.TrimSpace(string(state)), "T") {
		t.Fatalf("fault did not retain a live stopped owned leader: group=%s state=%s error=%v", group, state, err)
	}
	if released, err := openDesktopLoginProcessLock(guard, false); err == nil {
		released.Close()
		t.Fatal("guardian released original guard while stop observation remained unavailable")
	}
	if err := os.Remove(failure); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if released, err := openDesktopLoginProcessLock(guard, false); err == nil {
			released.Close()
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("guardian did not release guard after OS stop proof became available")
}

func TestDesktopAuthorizationLifetimeManagerHelper(t *testing.T) {
	dir := os.Getenv("BEE_TEST_AUTHORIZATION_LIFETIME_MANAGER")
	if dir == "" {
		return
	}
	file, err := openDesktopLoginProcessLock(filepath.Join(dir, "guard"), true)
	if err != nil {
		t.Fatal(err)
	}
	lease := &desktopLoginProcessLease{file: file}
	defer lease.close()
	script := strings.Replace(desktopAuthorizationForkFixture, "printf ready\nIFS= read -r start", `printf ready > "$4"; while [ ! -e "$5" ]; do sleep 0.001; done`, 1)
	command := exec.Command("/bin/sh", "-c", script, "official-fixture", filepath.Join(dir, "pid"), filepath.Join(dir, "release"), filepath.Join(dir, "source"), filepath.Join(dir, "ready"), filepath.Join(dir, "fork"))
	command.Stdout, command.Stderr = io.Discard, io.Discard
	if err := runDesktopAuthorization(context.WithValue(context.Background(), desktopLoginProcessContextKey{}, lease), command); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopAuthorizeParentDeathJoinsForkingDescendantsBeforeReleasingGuard(t *testing.T) {
	program, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for round := 0; round < 12; round++ {
		dir := t.TempDir()
		manager := exec.Command(program, "-test.run=^TestDesktopAuthorizationLifetimeManagerHelper$")
		manager.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "BEE_TEST_AUTHORIZATION_LIFETIME_MANAGER="+dir)
		var output bytes.Buffer
		manager.Stdout, manager.Stderr = &output, &output
		if err := manager.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { manager.Process.Kill(); os.WriteFile(filepath.Join(dir, "release"), []byte("cleanup"), 0600) })
		waitDesktopLoginFile(t, filepath.Join(dir, "ready"))
		if err := os.WriteFile(filepath.Join(dir, "fork"), []byte("start fork during parent death"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := manager.Process.Kill(); err != nil {
			t.Fatal(err)
		}
		_ = manager.Wait()
		deadline := time.Now().Add(3 * time.Second)
		for {
			proof, err := openDesktopLoginProcessLock(filepath.Join(dir, "guard"), false)
			if err == nil {
				proof.Close()
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("round=%d guardian did not confirm group exit after real parent death: %v; manager=%s", round, err, output.String())
			}
			time.Sleep(time.Millisecond)
		}
		assertDesktopAuthorizationDescendantStopped(t, filepath.Join(dir, "pid"))
		if err := os.WriteFile(filepath.Join(dir, "release"), []byte("continue after real parent death"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(dir, "source")); !os.IsNotExist(err) {
			t.Fatalf("round=%d source writer outlived management process: %v", round, err)
		}
	}
}

func TestDesktopAuthorizeCleansOwnedDescendantsAndPreservesExternal(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		t.Run(map[bool]string{true: "cancel", false: "normal_exit"}[cancelled], func(t *testing.T) {
			dir := t.TempDir()
			owned := filepath.Join(dir, "owned")
			external := filepath.Join(dir, "external")
			started := filepath.Join(dir, "started")
			script := `sleep 1.2; printf done > "$1"`
			other := exec.Command("/bin/sh", "-c", script, "test", external)
			if err := other.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = other.Process.Kill(); _ = other.Wait() })
			script = `/bin/sh -c 'sleep 1; printf done > "$1"' test "$1" & printf started > "$2"`
			if cancelled {
				script += `; wait`
			}
			cmd := exec.Command("/bin/sh", "-c", script, "test", owned, started)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- runDesktopAuthorization(ctx, cmd) }()
			limit := time.Now().Add(2 * time.Second)
			for {
				if _, err := os.Stat(started); err == nil {
					break
				}
				if time.Now().After(limit) {
					t.Fatal("child did not start")
				}
				time.Sleep(time.Millisecond)
			}
			if cancelled {
				cancel()
			}
			select {
			case err := <-done:
				if !cancelled && err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("owned process was not reaped")
			}
			if err := other.Wait(); err != nil {
				t.Fatalf("external process disturbed: %v", err)
			}
			if _, err := os.Stat(owned); !os.IsNotExist(err) {
				t.Fatal("owned descendant outlived authorization")
			}
			if _, err := os.Stat(external); err != nil {
				t.Fatal("external process lost")
			}
		})
	}
}

func TestDesktopAuthorizeNamespaceHelper(t *testing.T) {
	if os.Getenv("BEE_REVIEW_NAMESPACE") == "" {
		return
	}
	sample, err := os.ReadFile(os.Getenv("BEE_REVIEW_SAMPLE"))
	if err != nil {
		os.Exit(11)
	}
	if err = os.WriteFile(filepath.Join(os.Getenv("CODEX_HOME"), "auth.json"), sample, 0600); err != nil {
		os.Exit(12)
	}
	link := os.Getenv("BEE_REVIEW_NAMESPACE")
	if err = os.Remove(link); err != nil {
		os.Exit(13)
	}
	if err = os.Symlink(os.Getenv("BEE_REVIEW_OTHER"), link); err != nil {
		os.Exit(14)
	}
	os.Exit(0)
}
func TestDesktopAuthorizeMustUseStartedNamespace(t *testing.T) {
	owner, a, request, _ := authorizeFixture(t, "unchanged")
	first, second := t.TempDir(), t.TempDir()
	link := filepath.Join(t.TempDir(), "selected")
	if err := os.Symlink(first, link); err != nil {
		t.Fatal(err)
	}
	request.Source.Directory = &link
	for i, dir := range []string{first, second} {
		if err := os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Duration(i+1)*time.Hour)), 0600); err != nil {
			t.Fatal(err)
		}
	}
	sample := filepath.Join(t.TempDir(), "new-login.json")
	if err := os.WriteFile(sample, desktopCodexFixture(t, time.Now().Add(3*time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	original := owner.command
	owner.command = func(program string, args ...string) *exec.Cmd {
		if len(args) == 1 && args[0] == "--version" || args[len(args)-1] == "--help" {
			return original(program, args...)
		}
		cmd := exec.Command(program, "-test.run=^TestDesktopAuthorizeNamespaceHelper$")
		cmd.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "BEE_REVIEW_NAMESPACE="+link, "BEE_REVIEW_SAMPLE="+sample, "BEE_REVIEW_OTHER="+second)
		return cmd
	}
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	result := waitAuthorize(t, owner, op.ID)
	snapshot, err := a.Snapshot(context.Background(), "openai", false)
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(first)
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "succeeded" || snapshot.Candidate.Source == nil || snapshot.Candidate.Source.Directory == nil || *snapshot.Candidate.Source.Directory != want {
		t.Fatalf("verification did not remain in the started namespace: state=%s source=%+v", result.State, snapshot.Candidate.Source)
	}
}

func TestDesktopAuthorizeForwardsOfficialInput(t *testing.T) {
	input, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	if _, err = writer.WriteString("synthetic-authorization-code\n"); err != nil {
		t.Fatal(err)
	}
	writer.Close()
	command := exec.Command("/bin/sh", "-c", `IFS= read -r code; [ "$code" = synthetic-authorization-code ] && printf 'official input accepted'`)
	var output bytes.Buffer
	command.Stdin, command.Stdout = input, &output
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := runDesktopAuthorization(ctx, command); err != nil {
		t.Fatalf("official input unavailable: %v", err)
	}
	if output.String() != "official input accepted" {
		t.Fatalf("actual=%q; required=official input accepted", output.String())
	}
}
