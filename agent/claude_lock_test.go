package bee

import (
	"bufio"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestClaudeDirectoryLockHeartbeatReplacementAndStaleRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lock")
	lock, ctx, err := lockClaudeDirectory(context.Background(), path, 200*time.Millisecond, 20*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.release()
	time.Sleep(250 * time.Millisecond)
	if !lock.valid() {
		t.Fatal("live heartbeat expired")
	}
	if other, _, err := lockClaudeDirectory(context.Background(), path, 200*time.Millisecond, 20*time.Millisecond); !errors.Is(err, errClaudeLock) {
		if other != nil {
			other.release()
		}
		t.Fatal("stole live lock")
	}
	if os.Rename(path, path+".previous") != nil || os.Mkdir(path, 0700) != nil {
		t.Fatal("cannot replace lock")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("replaced lock did not cancel operation")
	}
	old := time.Now().Add(-time.Second)
	if os.Chtimes(path, old, old) != nil {
		t.Fatal("cannot age lock")
	}
	recovered, _, err := lockClaudeDirectory(context.Background(), path, 200*time.Millisecond, 20*time.Millisecond)
	if err != nil {
		t.Fatal("stale lock not recovered", err)
	}
	defer recovered.release()
	if lock.valid() || !recovered.valid() {
		t.Fatal("lock ownership confused")
	}
}

func TestClaudeRefreshHonorsLegacyLock(t *testing.T) {
	directory := t.TempDir()
	canonical, _ := filepath.EvalSymlinks(directory)
	legacy, _, err := lockClaudeDirectory(context.Background(), canonical+".lock", time.Minute, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.release()
	_, _, release, err := lockClaudeRefresh(context.Background(), directory)
	if err == nil {
		release()
		t.Fatal("legacy holder ignored")
	}
	if _, err := os.Stat(filepath.Join(directory, ".oauth_refresh.lock")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed acquisition retained primary lock")
	}
}

func TestClaudeOfficialLockCompatibility(t *testing.T) {
	module := os.Getenv("TEST_CLAUDE_LOCK_MODULE")
	if module == "" {
		t.Skip("set TEST_CLAUDE_LOCK_MODULE to pinned proper-lockfile 4.1.2 for Node peer interoperability")
	}
	directory := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	const peer = `const lock = require(process.argv[1]);
const path = require('path');
const fs = require('fs');
const dir = process.argv[2], probe = process.argv[3] === 'probe';
(async () => {
  const options = {realpath:false, stale:60000, update:5000};
  const paths = [path.join(dir,'.oauth_refresh.lock'),fs.realpathSync(dir)+'.lock',path.join(dir,'.storage-write.lock')];
  const releases = [];
  for (const p of paths) {
    try {
      const release = await lock.lock(p, {...options, lockfilePath:p});
      if (probe) { await release(); throw new Error('expected Go lock'); }
      releases.push(release);
    } catch (error) { if (!probe || error.code !== 'ELOCKED') throw error; }
  }
  console.log(probe ? 'blocked' : 'locked');
  if (!probe) {
    await new Promise(resolve => { process.stdin.resume(); process.stdin.once('end',resolve); });
    for (const release of releases.reverse()) await release();
  }
})().catch(() => { console.error('lock interoperability failed'); process.exitCode=1; });`
	command := exec.CommandContext(ctx, "node", "-e", peer, module, directory, "hold")
	in, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	out, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if command.Start() != nil {
		t.Fatal("Node lock peer unavailable")
	}
	scanner := bufio.NewScanner(out)
	if !scanner.Scan() || scanner.Text() != "locked" {
		in.Close()
		command.Wait()
		t.Fatal("Node did not hold locks")
	}
	for _, path := range []string{filepath.Join(directory, ".oauth_refresh.lock"), directory + ".lock", filepath.Join(directory, ".storage-write.lock")} {
		if lock, _, err := lockClaudeDirectory(ctx, path, time.Minute, 5*time.Second); err == nil {
			lock.release()
			in.Close()
			command.Wait()
			t.Fatal("Go ignored Node lock")
		}
	}
	in.Close()
	if command.Wait() != nil {
		t.Fatal("Node release failed")
	}
	_, valid, release, err := lockClaudeRefresh(ctx, directory)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	storage, _, err := lockClaudeDirectory(ctx, filepath.Join(directory, ".storage-write.lock"), 15*time.Second, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer storage.release()
	probe := exec.CommandContext(ctx, "node", "-e", peer, module, directory, "probe")
	raw, err := probe.Output()
	if err != nil || string(raw) != "blocked\n" || !valid() || !storage.valid() {
		t.Fatal("Node ignored Go lock", err)
	}
}
