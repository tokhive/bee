package bee

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var errClaudeLock = errors.New("official Claude store lock is busy or invalid; waiting to synchronize again")

// Compatible with the pinned client's proper-lockfile directory/mtime protocol.
// A replaced lock cancels the operation; release never removes a successor's lock.
type claudeDirectoryLock struct {
	mu     sync.Mutex
	path   string
	info   os.FileInfo
	mtime  time.Time
	stale  time.Duration
	cancel context.CancelFunc
	done   chan struct{}
}

func lockClaudeDirectory(ctx context.Context, path string, stale, update time.Duration) (*claudeDirectoryLock, context.Context, error) {
	if ctx.Err() != nil {
		return nil, ctx, errClaudeLock
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, ctx, errClaudeLock
	}
	if err = os.Mkdir(path, 0700); errors.Is(err, os.ErrExist) {
		old, statErr := os.Lstat(path)
		if statErr != nil || !old.IsDir() || time.Since(old.ModTime()) <= stale {
			return nil, ctx, errClaudeLock
		}
		current, statErr := os.Lstat(path)
		if statErr != nil || !os.SameFile(old, current) || !old.ModTime().Equal(current.ModTime()) || os.Remove(path) != nil {
			return nil, ctx, errClaudeLock
		}
		err = os.Mkdir(path, 0700)
	}
	if err != nil {
		return nil, ctx, errClaudeLock
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() {
		return nil, ctx, errClaudeLock
	}
	live, cancel := context.WithCancel(ctx)
	lock := &claudeDirectoryLock{path: path, info: info, mtime: info.ModTime(), stale: stale, cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(lock.done)
		ticker := time.NewTicker(update)
		defer ticker.Stop()
		for {
			select {
			case <-live.Done():
				return
			case <-ticker.C:
				lock.mu.Lock()
				if !lock.owned() {
					cancel()
				} else {
					now := time.Now().Truncate(time.Millisecond)
					if os.Chtimes(path, now, now) != nil {
						cancel()
					} else {
						lock.mtime = now
					}
				}
				lock.mu.Unlock()
			}
		}
	}()
	return lock, live, nil
}

func (l *claudeDirectoryLock) owned() bool {
	info, err := os.Lstat(l.path)
	return err == nil && info.IsDir() && os.SameFile(l.info, info) && l.mtime.Equal(info.ModTime()) && time.Since(l.mtime) < l.stale
}

func (l *claudeDirectoryLock) valid() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.owned() {
		l.cancel()
		return false
	}
	return true
}

func (l *claudeDirectoryLock) release() {
	l.cancel()
	<-l.done
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.owned() {
		_ = os.Remove(l.path)
	}
}

func lockClaudeRefresh(ctx context.Context, directory string) (context.Context, func() bool, func(), error) {
	if os.MkdirAll(directory, 0700) != nil {
		return ctx, nil, nil, errClaudeLock
	}
	primary, live, err := lockClaudeDirectory(ctx, filepath.Join(directory, ".oauth_refresh.lock"), time.Minute, 5*time.Second)
	if err != nil {
		return ctx, nil, nil, err
	}
	canonical, err := filepath.EvalSymlinks(directory)
	if err != nil {
		primary.release()
		return ctx, nil, nil, errClaudeLock
	}
	legacy, live, err := lockClaudeDirectory(live, canonical+".lock", time.Minute, 5*time.Second)
	if err != nil {
		primary.release()
		return ctx, nil, nil, err
	}
	return live, func() bool { return primary.valid() && legacy.valid() }, func() { legacy.release(); primary.release() }, nil
}
