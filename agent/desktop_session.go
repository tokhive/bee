package bee

import (
	"context"
	"fmt"
	"sync"
)

// The OS lock belongs to the management process, not an individual HTTP call.
// mu protects only local configuration access; no network work runs under it.
type desktopDeviceSession struct {
	mu      sync.Mutex
	path    string
	unlock  func()
	pairing chan struct{}
	active  sync.WaitGroup
	closed  bool
	close   sync.Once
}

func (d *DesktopDevice) acquireSession(ctx context.Context) (*desktopDeviceSession, func(), error) {
	path, err := d.configPath()
	if err != nil {
		return nil, nil, err
	}
	s := &d.session
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if s.closed {
		return nil, nil, fmt.Errorf("desktop session is closed; configuration access requires a live management session")
	}
	if s.unlock == nil {
		unlock, err := lockState(path)
		if err != nil {
			return nil, nil, err
		}
		s.path, s.unlock, s.pairing = path, unlock, make(chan struct{}, 1)
	} else if s.path != path {
		return nil, nil, fmt.Errorf("desktop session configuration changed after ownership acquisition; original lock retained")
	}
	s.active.Add(1)
	return s, s.active.Done, nil
}

func (s *desktopDeviceSession) read() (localState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return readState(s.path)
}

func (s *desktopDeviceSession) save(state localState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return saveState(s.path, state)
}

// Only pairing may change the device configuration. Its own gate serializes
// pairing transactions without blocking account/supply reads on the same session.
func (s *desktopDeviceSession) beginPairing(ctx context.Context) (func(), error) {
	select {
	case s.pairing <- struct{}{}:
		return func() { <-s.pairing }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Close follows bridge/worker cancellation. It rejects new users and waits for
// outstanding local operations before releasing the cross-process ownership lock.
func (d *DesktopDevice) Close() error {
	s := &d.session
	s.close.Do(func() {
		s.mu.Lock()
		s.closed = true
		s.mu.Unlock()
		s.active.Wait()
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.unlock != nil {
			s.unlock()
			s.unlock = nil
		}
	})
	return nil
}
