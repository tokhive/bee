package bee

import (
	"bufio"
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestStateLockChildProcess(t *testing.T) {
	mode := os.Getenv("BEE_TEST_STATE_LOCK_MODE")
	if mode == "" {
		return
	}
	unlock, err := lockState(os.Getenv("BEE_TEST_STATE_LOCK_PATH"))
	if err != nil {
		os.Exit(23)
	}
	defer unlock()
	if mode == "hold" {
		_, _ = io.WriteString(os.Stdout, "locked\n")
		_, _ = io.Copy(io.Discard, os.Stdin)
	}
}

func stateLockProcess(t *testing.T, path, mode string) *exec.Cmd {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStateLockChildProcess$")
	cmd.Env = append(os.Environ(), "BEE_TEST_STATE_LOCK_PATH="+path, "BEE_TEST_STATE_LOCK_MODE="+mode)
	return cmd
}

func TestStateLockExcludesOtherProcesses(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	unlock, err := lockState(path)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if err := stateLockProcess(t, path, "try").Run(); err == nil {
		t.Fatal("a second process acquired the held configuration lock")
	} else if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 23 {
		t.Fatalf("second process failed before testing lock exclusion: %v", err)
	}
	unlock()
	if out, err := stateLockProcess(t, path, "try").CombinedOutput(); err != nil {
		t.Fatalf("released configuration lock could not be acquired: %v; output=%s", err, out)
	}
}

func TestStateLockReleasedWhenHolderExits(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	cmd := stateLockProcess(t, path, "hold")
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	if line, err := bufio.NewReader(out).ReadString('\n'); err != nil || line != "locked\n" {
		_ = cmd.Wait()
		t.Fatalf("child did not acquire its configuration lock: ready=%q; error=%v", line, err)
	}
	if unlock, err := lockState(path); err == nil {
		unlock()
		t.Fatal("parent acquired a configuration lock held by its child")
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	unlock, err := lockState(path)
	if err != nil {
		t.Fatal("OS did not release the terminated holder's lock: ", err)
	}
	unlock()
}

func TestStateLockUnlockCannotReleaseANewerLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	oldUnlock, err := lockState(path)
	if err != nil {
		t.Fatal(err)
	}
	oldUnlock()
	newUnlock, err := lockState(path)
	if err != nil {
		t.Fatal(err)
	}
	defer newUnlock()
	oldUnlock()
	if err := stateLockProcess(t, path, "try").Run(); err == nil {
		t.Fatal("an old unlock callback released a newer configuration lock")
	} else if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 23 {
		t.Fatalf("second process failed before testing lock ownership: %v", err)
	}
}

func TestStateLockRefusesSymbolicLinks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	target := filepath.Join(t.TempDir(), "other.lock")
	if err := os.WriteFile(target, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path+".lock"); err != nil {
		t.Fatal("creating the lock-link security test requires OS support: ", err)
	}
	if unlock, err := lockState(path); err == nil {
		unlock()
		t.Fatal("configuration lock followed a symbolic link")
	}
}
