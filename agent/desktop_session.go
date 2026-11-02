package bee

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sync"
)

// The OS lock belongs to the management process, not an individual HTTP call.
// mu protects only local configuration access; no network work runs under it.
type desktopDeviceSession struct {
	mu              sync.Mutex
	path            string
	unlock          func()
	pairing         chan struct{}
	active          sync.WaitGroup
	closed          bool
	close           sync.Once
	bindingRevision int64
	bindingDigest   [32]byte
	bindingKnown    bool
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
	state, err := readState(s.path)
	s.observeBinding(state, err)
	return state, err
}

func (s *desktopDeviceSession) save(state localState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := saveState(s.path, state); err != nil {
		return err
	}
	s.observeBinding(state, nil)
	return nil
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

// Called under mu; credentials affect the digest but never leave this session.
func (s *desktopDeviceSession) observeBinding(state localState, err error) {
	value := struct {
		Hive, Name, Credential string
		Identity               any
		Invalid                bool
	}{state.Hive, state.Name, state.Credential, state.Identity, err != nil}
	raw, _ := json.Marshal(value)
	digest := sha256.Sum256(raw)
	if !s.bindingKnown || digest != s.bindingDigest {
		s.bindingRevision++
		s.bindingDigest = digest
		s.bindingKnown = true
	}
}
func (s *desktopDeviceSession) readBinding() (localState, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := readState(s.path)
	s.observeBinding(state, err)
	return state, s.bindingRevision, err
}
func (d *DesktopDevice) bindingRevision(ctx context.Context) (int64, error) {
	session, release, err := d.acquireSession(ctx)
	if err != nil {
		return 0, err
	}
	defer release()
	_, revision, err := session.readBinding()
	return revision, err
}
