//go:build linux

package bee

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
	"golang.org/x/sys/unix"
)

func TestInstallHandoffNative(t *testing.T) {
	handoffRequireManualTestHost(t)
	binary := os.Getenv("BEE_HANDOFF_TEST_BINARY")
	if binary == "" {
		binary = filepath.Join(t.TempDir(), "bee")
		if output, err := exec.Command("go", "build", "-o", binary, "../cmd/bee").CombinedOutput(); err != nil {
			t.Fatalf("build Bee: %v\n%s", err, output)
		}
	}
	t.Setenv("BEE_LANG", "en")
	start := func(t *testing.T) (string, *exec.Cmd) {
		t.Helper()
		path := filepath.Join(t.TempDir(), "bee.json")
		state := localState{Hive: "http://127.0.0.1:1", Credential: "bee_" + strings.Repeat("a", 43), Identity: &beewire.Identity{}}
		if err := saveState(path, state); err != nil {
			t.Fatal(err)
		}
		copyPath := filepath.Join(t.TempDir(), "bee")
		data, err := os.ReadFile(binary)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(copyPath, data, 0700); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(copyPath, "run", "--config", path)
		cmd.Env = append(os.Environ(), "TOKHIVE_LOG_FORMAT=logfmt")
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			lock, err := os.OpenFile(path+".lock", os.O_RDWR, 0)
			if err == nil {
				err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
				_ = lock.Close()
				if errors.Is(err, syscall.EWOULDBLOCK) {
					if err := os.Remove(copyPath); err != nil {
						t.Fatal(err)
					}
					return path, cmd
				}
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("Bee did not acquire its configuration lock")
		return "", nil
	}
	if os.Getenv("BEE_HANDOFF_TEST_NO_PIDFD") == "1" {
		path, cmd := start(t)
		var out bytes.Buffer
		err := handoffWithInput(context.Background(), path, strings.NewReader("y\n"), &out, time.Second)
		if err == nil || !strings.Contains(err.Error(), "pidfd_open") {
			t.Fatalf("got %v", err)
		}
		if strings.Contains(out.String(), "[y/N]") {
			t.Fatal("offered unsafe handoff without pidfd")
		}
		if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
			t.Fatal(err)
		}
		return
	}
	for _, tc := range []struct {
		lang, answer string
		exit         int
	}{
		{"en", "y\n", 0}, {"zh", "n\n", 3}, {"en", "\n", 3}, {"zh", "\x04", 3}, {"en", "\x03", 3},
	} {
		t.Run("cli_terminal_"+tc.lang+fmt.Sprintf("%q", tc.answer), func(t *testing.T) {
			path, cmd := start(t)
			status, output := handoffTerminal(t, binary, path, tc.lang, tc.answer)
			if status != tc.exit {
				t.Fatalf("exit=%d, expected %d: %s", status, tc.exit, output)
			}
			if tc.exit == 3 {
				if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
					t.Fatal("declined CLI stopped Bee", err)
				}
			} else {
				if unlock, err := lockState(path); err != nil {
					t.Fatal(err)
				} else {
					unlock()
				}
			}
		})
	}
	t.Run("accepts_and_releases_the_real_lock", func(t *testing.T) {
		path, cmd := start(t)
		var out bytes.Buffer
		if err := handoffWithInput(context.Background(), path, strings.NewReader("y\n"), &out, time.Second); err != nil {
			t.Fatal(err, out.String())
		}
		if !strings.Contains(out.String(), fmt.Sprint(cmd.Process.Pid)) || !strings.Contains(out.String(), path) {
			t.Fatal(out.String())
		}
		unlock, err := lockState(path)
		if err != nil {
			t.Fatal(err)
		}
		unlock()
	})
	for _, answer := range []string{"n\n", "\n", "", "y"} {
		t.Run("decline_or_eof_"+fmt.Sprintf("%q", answer), func(t *testing.T) {
			path, cmd := start(t)
			err := handoffWithInput(context.Background(), path, strings.NewReader(answer), io.Discard, time.Second)
			if !errors.Is(err, ErrInstallHandoffCancelled) {
				t.Fatalf("got %v", err)
			}
			if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
				t.Fatal("old Bee was stopped", err)
			}
		})
	}
	t.Run("stopped_process_times_out_without_kill", func(t *testing.T) {
		path, cmd := start(t)
		if err := cmd.Process.Signal(syscall.SIGSTOP); err != nil {
			t.Fatal(err)
		}
		err := handoffWithInput(context.Background(), path, strings.NewReader("yes\n"), io.Discard, 50*time.Millisecond)
		if err == nil || !strings.Contains(err.Error(), "timed out") || !strings.Contains(err.Error(), fmt.Sprint(cmd.Process.Pid)) {
			t.Fatalf("got %v", err)
		}
		if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
			t.Fatal("escalated to kill", err)
		}
	})
	t.Run("lock_replaced_during_confirmation_is_rejected", func(t *testing.T) {
		path, cmd := start(t)
		reader := &handoffInput{before: func() {
			if err := os.Rename(path+".lock", path+".old-lock"); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path+".lock", nil, 0600); err != nil {
				t.Fatal(err)
			}
		}, Reader: strings.NewReader("y\n")}
		err := handoffWithInput(context.Background(), path, reader, io.Discard, time.Second)
		if err == nil || !strings.Contains(err.Error(), "lock file changed") {
			t.Fatalf("got %v", err)
		}
		if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
			t.Fatal("old Bee was stopped", err)
		}
	})
	t.Run("context_cancelled_after_identity_check_never_signals", func(t *testing.T) {
		path, cmd := start(t)
		process, err := inspectHandoff(path)
		if err != nil || process == nil {
			t.Fatalf("inspect: %v", err)
		}
		defer process.close()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := process.stop(ctx, time.Second); !errors.Is(err, context.Canceled) {
			t.Fatalf("got %v", err)
		}
		if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
			t.Fatal("cancelled operation stopped Bee", err)
		}
		poll := []unix.PollFd{{Fd: int32(process.pidfd), Events: unix.POLLIN}}
		if _, err := unix.Poll(poll, 100); err != nil {
			t.Fatal(err)
		}
		if poll[0].Revents != 0 {
			t.Fatal("cancelled operation sent SIGTERM to Bee")
		}
	})
	t.Run("lock_holder_changes_during_confirmation", func(t *testing.T) {
		path, cmd := start(t)
		reader := &handoffInput{before: func() {
			_ = cmd.Process.Signal(syscall.SIGTERM)
			_ = cmd.Wait()
			replacement := exec.Command(binary, "run", "--config", path)
			if err := replacement.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = replacement.Process.Kill(); _ = replacement.Wait() })
			handoffWaitForBusyLock(t, path)
		}, Reader: strings.NewReader("y\n")}
		err := handoffWithInput(context.Background(), path, reader, io.Discard, time.Second)
		if err == nil || !strings.Contains(err.Error(), "lock holder changed") {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("another_process_relocks_after_exit", func(t *testing.T) {
		path, _ := start(t)
		testBinary, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		waiter := exec.Command(testBinary)
		waiter.Env = append(os.Environ(), "BEE_TEST_FOREIGN_LOCK="+path+".lock")
		if err := waiter.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = waiter.Process.Kill(); _ = waiter.Wait() })
		waiting := fmt.Sprintf("-> FLOCK  ADVISORY  WRITE %d ", waiter.Process.Pid)
		deadline := time.Now().Add(time.Second)
		for {
			data, err := os.ReadFile("/proc/locks")
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(data), waiting) {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("waiting lock missing for %d: %s", waiter.Process.Pid, data)
			}
			time.Sleep(time.Millisecond)
		}
		err = handoffWithInput(context.Background(), path, strings.NewReader("y\n"), io.Discard, time.Second)
		if err == nil || !strings.Contains(err.Error(), "another process") {
			t.Fatalf("got %v", err)
		}
		if err := waiter.Process.Signal(syscall.Signal(0)); err != nil {
			t.Fatal("stopped replacement", err)
		}
	})
	t.Run("cancelled_context_never_signals", func(t *testing.T) {
		path, cmd := start(t)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := handoffWithInput(ctx, path, strings.NewReader("y\n"), io.Discard, time.Second); !errors.Is(err, context.Canceled) {
			t.Fatalf("got %v", err)
		}
		if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
			t.Fatal("old Bee was stopped", err)
		}
	})
}

type handoffInput struct {
	io.Reader
	before func()
}

func (r *handoffInput) Read(p []byte) (int, error) {
	if r.before != nil {
		r.before()
		r.before = nil
	}
	return r.Reader.Read(p)
}

func TestInstallHandoffUnusedLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	if err := os.WriteFile(path+".lock", nil, 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := handoffWithInput(context.Background(), path, strings.NewReader(""), &out, time.Second); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "[y/N]") {
		t.Fatal(out.String())
	}
}

func TestHandoffLockOwners(t *testing.T) {
	var stat unix.Stat_t
	stat.Dev = unix.Mkdev(0, 42)
	stat.Ino = 12345
	for _, tc := range []struct {
		name, locks string
		want        int
		fail        bool
	}{
		{"owner", "1: FLOCK ADVISORY WRITE 101 00:2a:12345 0 EOF\n", 101, false},
		{"blocked_waiter", "1: FLOCK ADVISORY WRITE 101 00:2a:12345 0 EOF\n1: -> FLOCK ADVISORY WRITE 102 00:2a:12345 0 EOF\n", 101, false},
		{"different_inode", "1: FLOCK ADVISORY WRITE 101 00:2a:999 0 EOF\n", 0, true},
		{"read_lock", "1: FLOCK ADVISORY READ 101 00:2a:12345 0 EOF\n", 0, true},
		{"multiple", "1: FLOCK ADVISORY WRITE 101 00:2a:12345 0 EOF\n2: FLOCK ADVISORY WRITE 102 00:2a:12345 0 EOF\n", 0, true},
		{"invalid_pid", "1: FLOCK ADVISORY WRITE -1 00:2a:12345 0 EOF\n", 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := handoffLockOwner([]byte(tc.locks), &stat)
			if (err != nil) != tc.fail || got != tc.want {
				t.Fatalf("got %d, %v", got, err)
			}
		})
	}
}

func TestHandoffProcessMetadata(t *testing.T) {
	uid := os.Getuid()
	status := fmt.Sprintf("Name:\tbee\nUid:\t%d\t%d\t%d\t%d\n", uid, uid, uid, uid)
	for _, tc := range []struct {
		name, status, command, cgroup string
		fail                          bool
	}{
		{"run", status, "/tmp/bee\x00run\x00--config\x00/tmp/bee.json\x00", "0::/user.slice/session-1.scope\n", false},
		{"menu", status, "bee\x00", "0::/\n", false},
		{"start", status, "bee\x00start\x00", "0::/\n", false},
		{"login", status, "bee\x00login\x00", "0::/\n", true},
		{"other_uid", "Uid:\t12345\t12345\t12345\t12345\n", "bee\x00run\x00", "0::/\n", true},
		{"mixed_uids", fmt.Sprintf("Uid:\t%d\t%d\t%d\t0\n", uid, uid, uid), "bee\x00run\x00", "0::/\n", uid != 0},
		{"system_service", status, "bee\x00run\x00", "0::/system.slice/custom-bee.service\n", true},
		{"user_service", status, "bee\x00run\x00", "0::/user.slice/user@1000.service/app.slice/bee.service\n", true},
		{"desktop_scope", status, "bee\x00run\x00", fmt.Sprintf("0::/user.slice/user-%d.slice/user@%d.service/app.slice/terminal.scope\n", uid, uid), false},
		{"fake_user_service", status, "bee\x00run\x00", "0::/system.slice/user@bee.service\n", true},
		{"fake_numeric_service", status, "bee\x00run\x00", fmt.Sprintf("0::/system.slice/user@%d.service\n", uid), true},
		{"missing_uid", "Name:\tbee\n", "bee\x00run\x00", "0::/\n", true},
		{"empty_command", status, "", "0::/\n", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateHandoffMetadata([]byte(tc.status), []byte(tc.command), []byte(tc.cgroup), uid)
			if (err != nil) != tc.fail {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func init() {
	path := os.Getenv("BEE_TEST_FOREIGN_LOCK")
	if path == "" {
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		os.Exit(10)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		os.Exit(11)
	}
	fmt.Println("ready")
	time.Sleep(30 * time.Second)
	_ = f.Close()
	os.Exit(0)
}

func TestInstallHandoffRejectsForeignExecutable(t *testing.T) {
	handoffRequireManualTestHost(t)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "bee.json")
	cmd := exec.Command(binary)
	cmd.Env = append(os.Environ(), "BEE_TEST_FOREIGN_LOCK="+path+".lock")
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	if line, err := bufio.NewReader(pipe).ReadString('\n'); err != nil || line != "ready\n" {
		t.Fatalf("holder: %q %v", line, err)
	}
	var out bytes.Buffer
	err = handoffWithInput(context.Background(), path, strings.NewReader("y\n"), &out, time.Second)
	if err == nil || !strings.Contains(err.Error(), "executable") {
		t.Fatalf("got %v", err)
	}
	if strings.Contains(out.String(), "[y/N]") {
		t.Fatal("offered to stop unverified executable")
	}
	if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatal("foreign process was stopped", err)
	}
}

func TestInstallHandoffRefusesSymlink(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	target := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(target, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path+".lock"); err != nil {
		t.Fatal(err)
	}
	err := handoffWithInput(context.Background(), path, strings.NewReader("y\n"), io.Discard, time.Second)
	if err == nil || !strings.Contains(err.Error(), "symlinks") {
		t.Fatalf("got %v", err)
	}
}

func handoffTerminal(t *testing.T, binary, path, lang, answer string) (int, string) {
	t.Helper()
	fd, err := unix.Open("/dev/ptmx", unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		t.Fatal(err)
	}
	master := os.NewFile(uintptr(fd), "ptmx")
	defer master.Close()
	if err := unix.IoctlSetPointerInt(fd, unix.TIOCSPTLCK, 0); err != nil {
		t.Fatal(err)
	}
	n, err := unix.IoctlGetInt(fd, unix.TIOCGPTN)
	if err != nil {
		t.Fatal(err)
	}
	slave, err := os.OpenFile(fmt.Sprintf("/dev/pts/%d", n), os.O_RDWR|unix.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer slave.Close()
	cmd := exec.Command(binary, "install-handoff", "--config", path)
	cmd.Env = append(os.Environ(), "BEE_LANG="+lang, "NO_COLOR=1")
	cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	_ = slave.Close()
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	done := make(chan string, 1)
	go func() {
		var out strings.Builder
		b := make([]byte, 4096)
		answered := false
		for {
			n, err := master.Read(b)
			out.Write(b[:n])
			if !answered && strings.Contains(out.String(), "[y/N]:") {
				_, _ = master.Write([]byte(answer))
				answered = true
			}
			if err != nil {
				break
			}
		}
		done <- out.String()
	}()
	select {
	case output := <-done:
		_ = cmd.Wait()
		return cmd.ProcessState.ExitCode(), output
	case <-time.After(5 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatal("handoff CLI did not finish terminal interaction")
		return -1, ""
	}
}

func handoffWaitForBusyLock(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		file, err := os.OpenFile(path+".lock", os.O_RDWR, 0)
		if err != nil {
			t.Fatal(err)
		}
		err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		_ = file.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("replacement did not lock configuration")
		}
		time.Sleep(time.Millisecond)
	}
}

// A real Bee fixture inherits its test runner's cgroup. Hosted CI runners are
// services, so CI also runs these cases in a container with its own cgroup root.
func handoffRequireManualTestHost(t *testing.T) {
	t.Helper()
	status, err := os.ReadFile("/proc/self/status")
	if err != nil {
		t.Fatal(err)
	}
	cgroup, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		t.Fatal(err)
	}
	if err := validateHandoffMetadata(status, []byte("bee\x00run\x00"), cgroup, os.Getuid()); err != nil {
		t.Skipf("native worker fixture inherits a managed service: %v; CI runs this suite in an isolated Linux container", err)
	}
}
