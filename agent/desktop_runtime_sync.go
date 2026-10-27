package bee

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// Each gate is independently cancellable, including reconnect waiters.
type desktopRuntimeGate chan struct{}

func (g desktopRuntimeGate) lock(ctx context.Context) error {
	select {
	case g <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-g
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (g desktopRuntimeGate) unlock() { <-g }

type desktopSynchronizationReceipt struct {
	lease                 string
	generation            int64
	fingerprint, revision string
}

type desktopRuntimeSlot struct {
	pauseRevision    atomic.Uint64
	confirmed        *desktopSynchronizationReceipt
	gate             desktopRuntimeGate
	control          desktopRuntimeGate
	config           *egressConfig
	selection        desktopAccountSelection
	resume           bool
	resumeAttempted  bool
	cancel           context.CancelFunc
	done             chan struct{}
	workerConnection *desktopRuntimeConnection
}
type desktopRuntimeConnection struct {
	ctx      context.Context
	cancel   context.CancelFunc
	state    localState
	lease    string
	out      io.Writer
	workers  sync.WaitGroup
	failures chan error
	active   bool
}

func (r *DesktopRuntime) configForSelection(platform string, selection desktopAccountSelection) (*egressConfig, error) {
	r.mu.Lock()
	proxy := r.network.ConnectProxy
	r.mu.Unlock()
	found := detectedAccount{platform: platform}
	if platform == "openai" {
		if selection.Source.Directory == nil {
			return nil, fmt.Errorf("selected OpenAI source has no resolved directory")
		}
		found.codex = &codexSource{Home: *selection.Source.Directory, Store: selection.Source.Store}
	} else {
		found.claude = &claudeSource{Store: selection.Source.Store, ConfigDir: selection.Source.Directory, Refresh: true, Capabilities: true}
	}
	raw, err := json.Marshal(buildEgress([]detectedAccount{found}, nil, &proxy))
	if err != nil {
		return nil, err
	}
	var cfg egressConfig
	if err = json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	if err = cfg.validate(); err != nil {
		return nil, err
	}
	r.device.session.mu.Lock()
	directory := filepath.Dir(r.device.session.path)
	r.device.session.mu.Unlock()
	cfg.useStateDirectory(directory)
	if r.accounts.transport != nil {
		if cfg.Codex != nil {
			cfg.Codex.transport = r.accounts.transport
		}
		if cfg.Claude != nil {
			cfg.Claude.transport = r.accounts.transport
		}
		if cfg.Capabilities != nil {
			cfg.Capabilities.transport = r.accounts.transport
		}
	}
	return &cfg, nil
}
func runtimePlatformTarget(platform string) string {
	if platform == "openai" {
		return "chatgpt.com:443"
	}
	return "api.anthropic.com:443"
}
func (r *DesktopRuntime) preparePlatform(ctx context.Context, session *desktopDeviceSession, state localState, platform string, selection desktopAccountSelection, resume bool, pauseRevision uint64) error {
	slot := r.slots[platform]
	if err := slot.gate.lock(ctx); err != nil {
		return err
	}
	defer slot.gate.unlock()
	slot.config = nil
	slot.selection = selection
	slot.resume = resume && slot.pauseRevision.Load() == pauseRevision
	slot.confirmed = nil
	slot.resumeAttempted = false
	r.mu.Lock()
	delete(r.targets, runtimePlatformTarget(platform))
	r.mu.Unlock()
	p, release, err := r.accounts.acquire(ctx, platform)
	if err != nil {
		return err
	}
	err = r.accounts.loadSelection(p, session, state, platform)
	release()
	if err != nil {
		return err
	}
	current, failure := r.accounts.readAccountSource(ctx, DesktopAccountDetectRequest{Platform: platform, Directory: selection.Source.Directory, Store: selection.Source.Store, Mode: "local"})
	revision := current.revision
	current.clear()
	if failure != nil {
		return failure
	}
	// Accept an official token renewal only after proving the saved identity.
	selection.CredentialRevision = revision
	if _, err := r.accounts.selectionSource(ctx, platform, desktopPendingOperation{Source: selection.Source, ToFingerprint: selection.Fingerprint, CredentialRevision: selection.CredentialRevision}); err != nil {
		return err
	}
	supply, err := desktopSupplyCall(ctx, state, platform, nil)
	if err != nil {
		return err
	}
	if !supply.Paused {
		paused := true
		written, e := desktopSupplyCall(ctx, state, platform, &paused)
		if e != nil {
			return fmt.Errorf("runtime preparatory pause unconfirmed; query before any further action: %w", e)
		}
		if !written.Paused {
			return fmt.Errorf("runtime preparatory pause PUT returned paused=false")
		}
		supply, err = desktopSupplyCall(ctx, state, platform, nil)
		if err != nil {
			return err
		}
		if !supply.Paused {
			return fmt.Errorf("runtime preparatory pause GET returned paused=false")
		}
	}
	slot.selection = selection
	cfg, err := r.configForSelection(platform, selection)
	if err != nil {
		return err
	}
	slot.config = cfg
	r.mu.Lock()
	r.targets[runtimePlatformTarget(platform)] = true
	r.mu.Unlock()
	return nil
}

func (r *DesktopRuntime) startSynchronization(ctx context.Context, state localState, lease string, out io.Writer) (<-chan error, func()) {
	live, cancel := context.WithCancel(ctx)
	connection := &desktopRuntimeConnection{ctx: live, cancel: cancel, state: state, lease: lease, out: out, failures: make(chan error, 1), active: true}
	r.syncMu.Lock()
	r.connection = connection
	// Register gate waiters before publishing shutdown's Wait boundary.
	connection.workers.Add(len(r.slots))
	r.syncMu.Unlock()
	for platform, slot := range r.slots {
		go func() {
			defer connection.workers.Done()
			if err := slot.gate.lock(live); err != nil {
				return
			}
			defer slot.gate.unlock()
			r.startSlotLocked(platform, slot, connection)
		}()
	}
	return connection.failures, func() {
		r.syncMu.Lock()
		connection.active = false
		cancel()
		r.syncMu.Unlock()
		connection.workers.Wait()
	}
}

// Slot gate prevents replacement until this worker has joined. The connection
// mutex serializes Add with connection shutdown, not with platform network I/O.
func (r *DesktopRuntime) startSlotLocked(platform string, slot *desktopRuntimeSlot, expected *desktopRuntimeConnection) {
	r.syncMu.Lock()
	defer r.syncMu.Unlock()
	connection := r.connection
	if expected != nil && expected != connection {
		return
	}
	if connection == nil || !connection.active || connection.ctx.Err() != nil || slot.config == nil {
		return
	}
	if slot.workerConnection == connection && slot.done != nil {
		select {
		case <-slot.done:
		default:
			return
		}
	}
	slot.workerConnection = connection
	ctx, cancel := context.WithCancel(connection.ctx)
	slot.cancel = cancel
	slot.done = make(chan struct{})
	done := slot.done
	connection.workers.Add(1)
	go func() {
		defer connection.workers.Done()
		defer close(done)
		first := true
		for ctx.Err() == nil {
			var err error
			if platform == "openai" {
				err = slot.config.synchronize(ctx, connection.state, connection.lease, connection.out, first)
			} else {
				err = slot.config.Claude.synchronize(ctx, connection.state, connection.lease, connection.out, first)
			}
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				r.platformFailure(platform, "authorization_sync", err)
				var api *apiFailure
				if errors.Is(err, errInboxIdentity) || errors.As(err, &api) && (api.Status == 401 || api.Status == 403) {
					select {
					case connection.failures <- err:
					default:
					}
					return
				}
			} else if err = r.observeSynchronizedPlatform(ctx, connection.state, platform, slot); err != nil {
				r.platformFailure(platform, "authorization_readback", err)
			}
			first = false
			if pause(ctx, 2*time.Second) != nil {
				return
			}
		}
	}()
}

func (r *DesktopRuntime) observeSynchronizedPlatform(ctx context.Context, state localState, platform string, slot *desktopRuntimeSlot) error {
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	current, err := r.accounts.verifiedSelectionDevice(ctx, session)
	if err != nil {
		return err
	}
	if current.Hive != state.Hive || current.Identity.ID != state.Identity.ID || current.Identity.OwnerID != state.Identity.OwnerID || current.Credential != state.Credential {
		return fmt.Errorf("runtime device binding changed during synchronization")
	}
	account, err := selectionHiveAccount(ctx, state, platform)
	if err != nil {
		return err
	}
	// Refresh the existing account/quota DTO outside the public snapshot gate.
	observed := &desktopAccountPlatform{snapshot: initialAccountSnapshot(platform)}
	r.accounts.refreshAccountHive(ctx, observed, platform)
	p, unlock, err := r.accounts.acquire(ctx, platform)
	if err != nil {
		return err
	}
	p.snapshot.Hive = observed.snapshot.Hive
	p.snapshot.Capabilities[1] = observed.snapshot.Capabilities[1]
	p.snapshot.Issues = observed.snapshot.Issues
	p.snapshot.CheckedAt = observed.snapshot.CheckedAt
	p.snapshot.Revision++
	unlock()
	if account.Status != "ready" || account.AccountFingerprint != slot.selection.Fingerprint || account.PendingFingerprint != "" {
		return fmt.Errorf("selected authorization is not synchronized: status=%s fingerprint_match=%t pending=%t", account.Status, account.AccountFingerprint == slot.selection.Fingerprint, account.PendingFingerprint != "")
	}
	if slot.selection.Generation != 0 && account.Generation != slot.selection.Generation {
		return fmt.Errorf("selected generation changed: actual=%d expected=%d; explicit account reconciliation required", account.Generation, slot.selection.Generation)
	}
	final := observed.hiveAccount
	if final == nil {
		return fmt.Errorf("runtime final account readback unconfirmed: %v", observed.snapshot.Hive.Error)
	}
	if final.AccountFingerprint != account.AccountFingerprint || final.Generation != account.Generation || final.CredentialRevision != account.CredentialRevision || final.Status != account.Status || final.PendingFingerprint != account.PendingFingerprint {
		return fmt.Errorf("runtime final account binding changed: fingerprint_match=%t generation=%d expected_generation=%d revision_match=%t status=%s pending=%t", final.AccountFingerprint == account.AccountFingerprint, final.Generation, account.Generation, final.CredentialRevision == account.CredentialRevision, final.Status, final.PendingFingerprint != "")
	}
	var receipt *desktopSynchronizationReceipt
	if slot.config != nil {
		receipt = slot.config.synchronized
		if platform == "claude" && slot.config.Claude != nil {
			receipt = slot.config.Claude.synchronized
		}
	}
	r.syncMu.Lock()
	connection := r.connection
	validConnection := connection != nil && connection.active && connection.ctx.Err() == nil && slot.workerConnection == connection
	r.syncMu.Unlock()
	if !validConnection || receipt == nil {
		return fmt.Errorf("runtime synchronization receipt absent: current_connection=%t receipt_present=%t", validConnection, receipt != nil)
	}
	if receipt.lease != connection.lease || receipt.generation != account.Generation || receipt.fingerprint != account.AccountFingerprint || receipt.revision != account.CredentialRevision {
		return fmt.Errorf("runtime synchronization receipt mismatch: lease_match=%t generation=%d expected_generation=%d fingerprint_match=%t revision_match=%t", receipt.lease == connection.lease, receipt.generation, account.Generation, receipt.fingerprint == account.AccountFingerprint, receipt.revision == account.CredentialRevision)
	}
	request := DesktopAccountDetectRequest{Platform: platform, Directory: slot.selection.Source.Directory, Store: slot.selection.Source.Store, Mode: "local"}
	read, failure := r.accounts.readAccountSource(ctx, request)
	defer read.clear()
	if failure != nil {
		return failure
	}
	if account.CredentialRevision != read.revision {
		return fmt.Errorf("Hive authorization revision differs from the selected current source")
	}
	if _, err := r.accounts.selectionSource(ctx, platform, desktopPendingOperation{Source: slot.selection.Source, ToFingerprint: slot.selection.Fingerprint, CredentialRevision: read.revision}); err != nil {
		return err
	}
	r.mu.Lock()
	runID := r.snapshot.RunID
	running := r.snapshot.Local == "running" && r.snapshot.Connection == "connected"
	r.mu.Unlock()
	if !running || runID == nil {
		return fmt.Errorf("runtime is no longer connected; synchronization receipt discarded")
	}
	_, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
		selected, ok := s.Selections[platform]
		if !ok || selected.Revision != slot.selection.Revision || selected.Fingerprint != slot.selection.Fingerprint || !s.Session.Active || s.Session.RunID != *runID {
			return fmt.Errorf("runtime selection/session changed before synchronization commit")
		}
		if _, pending := s.PendingOperations[platform]; pending {
			return fmt.Errorf("platform has a pending account operation; resume blocked")
		}
		if selected.Generation != slot.selection.Generation {
			return fmt.Errorf("persisted selected generation changed: actual=%d expected=%d", selected.Generation, slot.selection.Generation)
		}
		selected.Generation = account.Generation
		selected.CredentialRevision = read.revision
		s.Selections[platform] = selected
		return nil
	})
	if err != nil {
		return err
	}
	slot.selection.Generation = account.Generation
	slot.selection.CredentialRevision = read.revision
	if err := slot.control.lock(ctx); err != nil {
		return err
	}
	defer slot.control.unlock()
	if slot.resume && !slot.resumeAttempted {
		// Exactly one PUT for this explicit start, including when its response is lost.
		slot.resumeAttempted = true
		paused := false
		result, writeErr := desktopSupplyCall(ctx, state, platform, &paused)
		if writeErr == nil && result.Paused {
			return fmt.Errorf("runtime resume PUT returned paused=true; fresh query required")
		}
		result, getErr := desktopSupplyCall(ctx, state, platform, nil)
		if getErr != nil {
			return fmt.Errorf("runtime resume result unconfirmed: write=%v; query: %w", writeErr, getErr)
		}
		if result.Paused {
			return fmt.Errorf("runtime resume result unconfirmed: write=%v; GET paused=true", writeErr)
		}
	}
	supply, err := desktopSupplyCall(ctx, state, platform, nil)
	if err != nil {
		return err
	}
	public := DesktopSupply{Hive: state.Hive, DeviceID: state.Identity.ID, Platform: platform, Paused: supply.Paused, Ready: supply.Ready, Reasons: supply.Reasons, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	p, unlock, err = r.accounts.acquire(ctx, platform)
	if err != nil {
		return err
	}
	p.snapshot.Authorization = DesktopAccountFact{State: "synchronized", Fingerprint: accountString(account.AccountFingerprint), ObservedAt: accountTime(time.Now())}
	p.snapshot.Revision++
	selected := slot.selection
	selected.Generation = account.Generation
	selected.CredentialRevision = read.revision
	p.selected = &selected
	slot.confirmed = receipt
	slot.selection = selected
	unlock()
	r.mu.Lock()
	if r.snapshot.RunID != nil && *r.snapshot.RunID == *runID && r.snapshot.Local == "running" {
		v := r.snapshot.Platforms[platform]
		v.Supply = &public
		v.SelectionRevision = slot.selection.Revision
		r.snapshot.Platforms[platform] = v
		r.snapshot.Revision++
	}
	r.mu.Unlock()
	return nil
}
func (r *DesktopRuntime) platformFailure(platform, check string, err error) {
	p, release, _ := r.accounts.acquire(context.Background(), platform)
	failure := accountFailure(platform, "runtime_platform_unconfirmed", check, err.Error())
	p.snapshot.Authorization = DesktopAccountFact{State: "unconfirmed", ObservedAt: accountTime(time.Now()), Error: failure}
	p.snapshot.Revision++
	release()
	r.mu.Lock()
	v := r.snapshot.Platforms[platform]
	v.Supply = nil
	r.snapshot.Platforms[platform] = v
	r.snapshot.Revision++
	r.mu.Unlock()
}

func (r *DesktopRuntime) selectionBarrier(ctx context.Context, platform string) (bool, func(*desktopAccountSelection, bool), error) {
	slot := r.slots[platform]
	if err := slot.gate.lock(ctx); err != nil {
		return false, nil, err
	}
	r.mu.Lock()
	owned := r.snapshot.Local == "running"
	r.targets[runtimePlatformTarget(platform)] = false
	v := r.snapshot.Platforms[platform]
	v.Supply = nil
	r.snapshot.Platforms[platform] = v
	r.snapshot.Revision++
	r.mu.Unlock()
	if slot.cancel != nil {
		slot.cancel()
	}
	if slot.done != nil {
		<-slot.done
	}
	slot.confirmed = nil
	if p, release, err := r.accounts.acquire(ctx, platform); err == nil {
		p.snapshot.Authorization = DesktopAccountFact{State: "unconfirmed", ObservedAt: accountTime(time.Now())}
		p.snapshot.Revision++
		release()
	}
	return owned, func(selection *desktopAccountSelection, committed bool) {
		defer slot.gate.unlock()
		slot.config = nil
		if committed && selection != nil && owned {
			cfg, err := r.configForSelection(platform, *selection)
			if err != nil {
				r.platformFailure(platform, "selection_runtime_config", err)
				return
			}
			slot.config = cfg
			slot.selection = *selection
			slot.resume = false
			slot.resumeAttempted = true
			r.mu.Lock()
			r.targets[runtimePlatformTarget(platform)] = true
			r.mu.Unlock()
			r.startSlotLocked(platform, slot, nil)
		}
	}, nil
}

// supplyBarrier binds manual resume to the same owned run and synchronized
// account as automatic resume. Pausing remains available while disconnected.
func (r *DesktopRuntime) supplyBarrier(ctx context.Context, platform string, paused bool) (context.Context, func(), error) {
	slot, ok := r.slots[platform]
	if !ok {
		return ctx, nil, fmt.Errorf("supply platform outside openai,claude")
	}
	if err := slot.gate.lock(ctx); err != nil {
		return ctx, nil, err
	}
	if err := slot.control.lock(ctx); err != nil {
		slot.gate.unlock()
		return ctx, nil, err
	}
	release := func() { slot.control.unlock(); slot.gate.unlock() }
	if paused {
		slot.pauseRevision.Add(1)
		slot.resumeAttempted = true
		return ctx, release, nil
	}
	if err := r.validateManualResume(ctx, platform, slot); err != nil {
		release()
		return ctx, nil, err
	}
	r.syncMu.Lock()
	connection := r.connection
	valid := connection != nil && connection.active && connection.ctx.Err() == nil && connection == slot.workerConnection
	r.syncMu.Unlock()
	if !valid {
		release()
		return ctx, nil, fmt.Errorf("resume blocked: synchronized connection ended before supply write")
	}
	live, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(connection.ctx, cancel)
	slot.resumeAttempted = true
	return live, func() { stop(); cancel(); release() }, nil
}

func (r *DesktopRuntime) validateManualResume(ctx context.Context, platform string, slot *desktopRuntimeSlot) error {
	r.mu.Lock()
	running := r.snapshot.Local == "running" && r.snapshot.Connection == "connected"
	runID := r.snapshot.RunID
	v := r.snapshot.Platforms[platform]
	target := r.targets[runtimePlatformTarget(platform)]
	r.mu.Unlock()
	activeWorker := slot.done != nil
	if activeWorker {
		select {
		case <-slot.done:
			activeWorker = false
		default:
		}
	}
	if !running || runID == nil || v.Supply == nil || !target || slot.config == nil || !activeWorker || slot.confirmed == nil {
		return fmt.Errorf("resume blocked: owned_connected=%t fresh_supply=%t target_enabled=%t worker_active=%t synchronized=%t", running, v.Supply != nil, target, activeWorker, slot.confirmed != nil)
	}
	p, unlock, err := r.accounts.acquire(ctx, platform)
	if err != nil {
		return err
	}
	selected, pending := p.selected, p.pending != nil || p.working
	unlock()
	if selected == nil || pending {
		return fmt.Errorf("resume blocked: selection_present=%t account_operation_pending=%t", selected != nil, pending)
	}
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	state, err := r.accounts.verifiedSelectionDevice(ctx, session)
	if err != nil {
		return err
	}
	r.syncMu.Lock()
	connection := r.connection
	valid := connection != nil && connection.active && connection.ctx.Err() == nil && connection == slot.workerConnection
	r.syncMu.Unlock()
	if !valid {
		return fmt.Errorf("resume blocked: current synchronization connection absent")
	}
	if state.Hive != connection.state.Hive || state.Identity.ID != connection.state.Identity.ID || state.Identity.OwnerID != connection.state.Identity.OwnerID || state.Credential != connection.state.Credential {
		return fmt.Errorf("resume blocked: device binding differs from owned connection")
	}
	receipt := slot.confirmed
	account, err := selectionHiveAccount(ctx, state, platform)
	if err != nil {
		return err
	}
	if account.Status != "ready" || account.PendingFingerprint != "" || account.AccountFingerprint != selected.Fingerprint || account.Generation != selected.Generation || account.CredentialRevision != selected.CredentialRevision || receipt.lease != connection.lease || receipt.generation != account.Generation || receipt.fingerprint != account.AccountFingerprint || receipt.revision != account.CredentialRevision {
		return fmt.Errorf("resume binding unconfirmed: status=%s pending=%t fingerprint_match=%t generation=%d expected_generation=%d revision_match=%t lease_match=%t", account.Status, account.PendingFingerprint != "", account.AccountFingerprint == selected.Fingerprint, account.Generation, selected.Generation, account.CredentialRevision == selected.CredentialRevision, receipt.lease == connection.lease)
	}
	scope, err := r.accounts.selectionScope(session, state, nil)
	if err != nil {
		return err
	}
	stored, ok := scope.Selections[platform]
	_, unresolved := scope.PendingOperations[platform]
	if !ok || stored.Revision != selected.Revision || stored.Generation != selected.Generation || unresolved || !scope.Session.Active || scope.Session.RunID != *runID {
		return fmt.Errorf("resume blocked: persisted selection or run marker no longer matches")
	}
	_, err = r.accounts.selectionSource(ctx, platform, desktopPendingOperation{Source: selected.Source, ToFingerprint: selected.Fingerprint, CredentialRevision: selected.CredentialRevision})
	return err
}
