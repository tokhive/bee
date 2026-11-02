package bee

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"sync"
	"time"
)

// DesktopRuntime owns the existing Go relay and authorization loops inside the
// management child. Its mutex protects observations, never network calls.
type DesktopRuntime struct {
	mu                    sync.Mutex
	ctx                   context.Context
	cancel                context.CancelFunc
	workers               sync.WaitGroup
	closed                bool
	userStopRequested     bool
	ownedSession          *desktopRetiredAccountSession
	recoveryGuardRun      string
	device                *DesktopDevice
	accounts              *DesktopAccounts
	snapshot              DesktopRuntimeSnapshot
	network               DesktopNetworkConfig
	runCancel             context.CancelFunc
	runDone               chan struct{}
	controlCancel         context.CancelFunc
	controlDone           chan struct{}
	retiredAccountSession *desktopRetiredAccountSession
	slots                 map[string]*desktopRuntimeSlot
	targets               map[string]bool
	syncMu                sync.Mutex
	connection            *desktopRuntimeConnection
}

func NewDesktopRuntime(parent context.Context, d *DesktopDevice, a *DesktopAccounts) *DesktopRuntime {
	ctx, cancel := context.WithCancel(parent)
	r := &DesktopRuntime{ctx: ctx, cancel: cancel, device: d, accounts: a, slots: map[string]*desktopRuntimeSlot{}, targets: map[string]bool{}, snapshot: DesktopRuntimeSnapshot{Local: "stopped", Connection: "disconnected", Platforms: map[string]DesktopRuntimePlatform{}}}
	for _, platform := range []string{"openai", "claude"} {
		r.slots[platform] = &desktopRuntimeSlot{gate: make(desktopRuntimeGate, 1), control: make(desktopRuntimeGate, 1)}
		r.snapshot.Platforms[platform] = DesktopRuntimePlatform{Account: initialAccountSnapshot(platform)}
	}
	for _, p := range a.platforms {
		p.snapshot.Features.ConfirmChange = DesktopAccountAvailability{Available: true}
	}
	a.runtime = r
	d.runtime = r
	return r
}
func (r *DesktopRuntime) Close() {
	r.accounts.lifecycleMu.Lock()
	r.mu.Lock()
	r.closed = true
	r.cancel()
	accountWorkers := r.accountWorkersLocked()
	r.mu.Unlock()
	r.accounts.lifecycleMu.Unlock()
	for _, worker := range accountWorkers {
		worker.cancel()
	}
	for _, worker := range accountWorkers {
		<-worker.done
	}
	r.workers.Wait()
}
func (r *DesktopRuntime) Snapshot(ctx context.Context) (DesktopRuntimeSnapshot, error) {
	r.mu.Lock()
	raw, err := json.Marshal(r.snapshot)
	r.mu.Unlock()
	var s DesktopRuntimeSnapshot
	if err != nil {
		return s, fmt.Errorf("encode runtime snapshot: %w", err)
	}
	if err = json.Unmarshal(raw, &s); err != nil {
		return s, fmt.Errorf("copy runtime snapshot: %w", err)
	}
	s.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	for _, platform := range []string{"openai", "claude"} {
		p, release, err := r.accounts.acquire(ctx, platform)
		if err != nil {
			return s, err
		}
		v := s.Platforms[platform]
		v.Account = accountSnapshotCopy(p.snapshot)
		if p.selected != nil {
			v.SelectionRevision = p.selected.Revision
		}
		s.Platforms[platform] = v
		release()
	}
	return s, nil
}
func desktopOperationID() (string, error) {
	var raw [24]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}
func (r *DesktopRuntime) Start(ctx context.Context, input DesktopStartRequest) (DesktopOperation, error) {
	return r.beginStart(ctx, input, false)
}
func (r *DesktopRuntime) beginStart(ctx context.Context, input DesktopStartRequest, restoring bool) (DesktopOperation, error) {
	if err := ctx.Err(); err != nil {
		return DesktopOperation{}, err
	}
	if input.ResumePlatforms == nil || len(input.ResumePlatforms) > 2 {
		return DesktopOperation{}, fmt.Errorf("runtime resume list invalid: required=explicit list of at most two platforms")
	}
	seen := map[string]bool{}
	for _, p := range input.ResumePlatforms {
		if !desktopPlatform(p) || seen[p] {
			return DesktopOperation{}, fmt.Errorf("runtime resume list contains duplicate or unknown platform")
		}
		seen[p] = true
	}
	r.accounts.lifecycleMu.Lock()
	defer r.accounts.lifecycleMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return DesktopOperation{}, fmt.Errorf("runtime owner closed; start rejected")
	}
	if !restoring && input.ExpectedRevision != r.snapshot.Revision {
		return DesktopOperation{}, fmt.Errorf("runtime revision changed: actual=%d expected=%d", r.snapshot.Revision, input.ExpectedRevision)
	}
	if r.snapshot.Local == "running" || r.snapshot.Local == "starting" || r.snapshot.Local == "stopping" {
		return DesktopOperation{}, fmt.Errorf("runtime start rejected: local=%s; required=stopped or failed", r.snapshot.Local)
	}
	if len(r.accounts.activeActions) > 0 {
		return DesktopOperation{}, fmt.Errorf("runtime start blocked: active account actions=%d", len(r.accounts.activeActions))
	}
	id, err := desktopOperationID()
	if err != nil {
		return DesktopOperation{}, err
	}
	var runID [16]byte
	if _, err = rand.Read(runID[:]); err != nil {
		return DesktopOperation{}, err
	}
	run := hex.EncodeToString(runID[:])
	r.snapshot.RunID = &run
	r.snapshot.Revision++
	r.snapshot.NetworkRevision = r.network.Revision
	r.snapshot.Local = "starting"
	r.snapshot.Connection = "disconnected"
	r.snapshot.ConnectionDetail = nil
	r.snapshot.StopReceipt = nil
	op := DesktopOperation{ID: id, Kind: "start", State: "pending", Revision: r.snapshot.Revision}
	r.snapshot.Operation = &op
	pauseRevisions := map[string]uint64{}
	for platform, slot := range r.slots {
		pauseRevisions[platform] = slot.pauseRevision.Load()
	}
	live, cancel := context.WithCancel(r.ctx)
	r.runCancel = cancel
	r.runDone = make(chan struct{})
	done := r.runDone
	r.workers.Add(1)
	// Reserve the session before returning admission, before any cancellable
	// network verification. Stop cannot observe the old clean recovery marker.
	reservationErr := r.reserveRuntimeSession(ctx, run, restoring)
	go func() {
		defer r.workers.Done()
		defer close(done)
		err := reservationErr
		if err == nil {
			err = r.run(live, run, input.ResumePlatforms, pauseRevisions, restoring)
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.snapshot.RunID == nil || *r.snapshot.RunID != run || r.snapshot.Local == "stopping" {
			return
		}
		if errors.Is(err, errDesktopRuntimeIdle) {
			r.snapshot.Local = "stopped"
			r.snapshot.RunID = nil
			r.snapshot.Revision++
			r.snapshot.Operation.State = "succeeded"
			r.snapshot.Operation.Revision = r.snapshot.Revision
			return
		}
		r.snapshot.Local = "failed"
		r.snapshot.Revision++
		if r.snapshot.Connection != "occupied" && r.snapshot.Connection != "rejected" {
			r.snapshot.Connection = "disconnected"
		}
		if err == nil {
			err = fmt.Errorf("owned contribution loop ended: context_cancelled=%t", live.Err() != nil)
		}
		r.snapshot.Operation.State = "failed"
		r.snapshot.Operation.Revision = r.snapshot.Revision
		r.snapshot.Operation.Error = accountFailure("unknown", "runtime_failed", "contribution_loop", err.Error())
	}()
	return op, nil
}
func (r *DesktopRuntime) run(ctx context.Context, run string, resume []string, pauseRevisions map[string]uint64, restoring bool) error {
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	defer release()
	state, err := r.accounts.verifiedSelectionDevice(ctx, session)
	if err != nil {
		return err
	}
	scope, err := r.accounts.selectionScope(session, state, nil)
	if err != nil {
		return err
	}
	if restoring {
		if !scope.Session.Active || scope.Session.RunID != run || !scope.RuntimeIntent.Running {
			return fmt.Errorf("saved runtime recovery evidence changed during device verification")
		}
		resume, err = recoveryResumePlatforms(ctx, state, scope)
		if err != nil {
			return err
		}
	}
	if len(scope.Selections) == 0 {
		return fmt.Errorf("runtime start requires a persisted account selection: selections=0")
	}
	if len(scope.PendingOperations) > 0 {
		return fmt.Errorf("runtime start blocked by unresolved account operations: count=%d", len(scope.PendingOperations))
	}
	for _, p := range resume {
		if _, ok := scope.Selections[p]; !ok {
			return fmt.Errorf("runtime resume requested for unselected platform=%s", p)
		}
	}
	// Serialize the first durable intent with Stop's state transition. A stop
	// admitted during preparation must not be overwritten by a late start save.
	r.mu.Lock()
	if r.snapshot.Local != "starting" || ctx.Err() != nil {
		r.mu.Unlock()
		return fmt.Errorf("runtime start cancelled before persisting intent")
	}
	_, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
		if len(s.PendingOperations) > 0 {
			return fmt.Errorf("runtime start raced an unresolved selection")
		}
		s.RuntimeIntent = desktopRuntimeIntent{Running: true, ResumePlatforms: append([]string{}, resume...)}
		if s.Session.RunID != run || !s.Session.Active {
			return fmt.Errorf("runtime session reservation changed before intent save")
		}
		return nil
	})
	if err == nil && !restoring {
		r.userStopRequested = false
	}
	r.mu.Unlock()
	if err != nil {
		return err
	}
	// No configuration or relay target survives into a different run/scope.
	for _, slot := range r.slots {
		if err := slot.gate.lock(ctx); err != nil {
			return err
		}
		slot.config = nil
		slot.workerConnection = nil
		slot.gate.unlock()
	}
	r.mu.Lock()
	r.targets = map[string]bool{}
	r.mu.Unlock()
	var prepared sync.WaitGroup
	for platform, selection := range scope.Selections {
		prepared.Go(func() {
			ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
			defer cancel()
			err := r.preparePlatform(ctx, session, state, platform, selection, slices.Contains(resume, platform), pauseRevisions[platform])
			if err != nil {
				r.platformFailure(platform, "runtime_prepare", err)
			}
		})
	}
	prepared.Wait()
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	targets := []string{}
	for target, allowed := range r.targets {
		if allowed {
			targets = append(targets, target)
		}
	}
	network := r.network
	r.mu.Unlock()
	if len(targets) == 0 {
		return fmt.Errorf("runtime start has no verified paused platforms; inspect platform errors")
	}
	cfg := &egressConfig{Targets: targets, ConnectProxy: network.ConnectProxy, desktop: r}
	return connectObserved(ctx, state, cfg, io.Discard, func(observation DesktopConnectionObservation) { r.connectionObserved(run, observation) })
}
func (r *DesktopRuntime) connectionObserved(run string, observation DesktopConnectionObservation) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.snapshot.RunID == nil || *r.snapshot.RunID != run || (r.snapshot.Local != "starting" && r.snapshot.Local != "running") {
		return
	}
	connection := observation.Connection
	r.snapshot.Connection = connection
	r.snapshot.ConnectionDetail = observation.Detail
	r.snapshot.Revision++
	if connection == "connected" {
		r.snapshot.Local = "running"
		r.snapshot.Operation.State = "succeeded"
		r.snapshot.Operation.Revision = r.snapshot.Revision
	}
	if connection != "connected" {
		for p, v := range r.snapshot.Platforms {
			v.Supply = nil
			r.snapshot.Platforms[p] = v
		}
	}
}
func (r *DesktopRuntime) Stop(ctx context.Context, input DesktopStopRequest) (DesktopOperation, error) {
	if err := ctx.Err(); err != nil {
		return DesktopOperation{}, err
	}
	if !slices.Contains([]string{"user_stop", "app_exit", "update", "network_change"}, input.Reason) {
		return DesktopOperation{}, fmt.Errorf("runtime stop reason outside fixed entry points")
	}
	r.accounts.lifecycleMu.Lock()
	defer r.accounts.lifecycleMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return DesktopOperation{}, fmt.Errorf("runtime owner closed; stop rejected")
	}
	if input.ExpectedRevision != r.snapshot.Revision {
		return DesktopOperation{}, fmt.Errorf("runtime revision changed: actual=%d expected=%d", r.snapshot.Revision, input.ExpectedRevision)
	}
	if r.snapshot.Local == "stopping" {
		return DesktopOperation{}, fmt.Errorf("runtime stop already in progress")
	}
	id, err := desktopOperationID()
	if err != nil {
		return DesktopOperation{}, err
	}
	r.snapshot.Revision++
	r.snapshot.Local = "stopping"
	r.snapshot.ConnectionDetail = nil
	if input.Reason == "user_stop" {
		r.userStopRequested = true
	}
	stoppedIntent := r.userStopRequested
	owned := r.ownedSession
	r.retiredAccountSession = nil
	op := DesktopOperation{ID: id, Kind: "stop", State: "pending", Revision: r.snapshot.Revision}
	r.snapshot.Operation = &op
	cancel, done := r.runCancel, r.runDone
	controlCancel, controlDone := r.controlCancel, r.controlDone
	accountWorkers := r.accountWorkersLocked()
	r.workers.Add(1)
	go func() {
		defer r.workers.Done()
		receipt, err := r.stop(stoppedIntent, owned, cancel, done, controlCancel, controlDone, accountWorkers)
		r.mu.Lock()
		defer r.mu.Unlock()
		r.snapshot.Revision++
		r.snapshot.Local = "stopped"
		r.snapshot.Connection = "disconnected"
		r.snapshot.ConnectionDetail = nil
		r.snapshot.StopReceipt = &receipt
		r.snapshot.Operation.State = "succeeded"
		r.snapshot.Operation.Revision = r.snapshot.Revision
		if err != nil {
			r.snapshot.Operation.State = "failed"
			r.snapshot.Operation.Error = accountFailure("unknown", "stop_unconfirmed", "stop_persistence", err.Error())
		}
		for p, v := range r.snapshot.Platforms {
			v.Supply = nil
			r.snapshot.Platforms[p] = v
		}
	}()
	return op, nil
}
func (r *DesktopRuntime) stop(stoppedIntent bool, owned *desktopRetiredAccountSession, cancel context.CancelFunc, done chan struct{}, controlCancel context.CancelFunc, controlDone chan struct{}, accountWorkers []*desktopAccountWorker) (DesktopStopReceipt, error) {
	receipt := DesktopStopReceipt{}
	var saveErr error
	session, release, err := r.device.acquireSession(context.Background())
	var state localState
	if err == nil {
		defer release()
		state, err = session.read()
	}
	unpaired := err == nil && state.Identity == nil
	cleanable := false
	if unpaired {
		receipt.IntentSaved = true // No device binding means no resumable runtime scope.
	} else if err == nil {
		_, saveErr = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
			if stoppedIntent {
				s.RuntimeIntent = desktopRuntimeIntent{ResumePlatforms: []string{}}
			}
			cleanable = !s.Session.Active && s.Session.Clean || owned != nil && owned.run == s.Session.RunID && owned.scope == desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID)
			// Never sign off an active/dirty session inherited from another owner.
			if cleanable {
				s.Session.Clean = false
			}
			return nil
		})
		receipt.IntentSaved = saveErr == nil
	} else {
		saveErr = err
	}
	// A failed intent save must never leave workers running. Cancel every
	// admitted account operation, including work before a tunnel exists.
	for _, worker := range accountWorkers {
		worker.cancel()
	}
	if controlCancel != nil {
		controlCancel()
	}
	if cancel != nil {
		cancel()
	}
	for _, worker := range accountWorkers {
		<-worker.done
	}
	if controlDone != nil {
		<-controlDone
	}
	if done != nil {
		<-done
	}
	receipt.WorkersStopped = true
	if receipt.IntentSaved && unpaired {
		receipt.SessionClean = true
	} else if receipt.IntentSaved && cleanable {
		_, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
			if s.Session.Active && (owned == nil || s.Session.RunID != owned.run) {
				return fmt.Errorf("stop session ownership changed before cleanup")
			}
			s.Session.Active = false
			s.Session.Clean = true
			return nil
		})
		receipt.SessionClean = err == nil
	} else if receipt.IntentSaved {
		err = fmt.Errorf("stop cannot certify a prior unclean session: current_owner_proof=false; explicit start required")
	}
	if receipt.SessionClean {
		if guardErr := r.cleanRecoveryGuard(session); guardErr != nil {
			receipt.SessionClean = false
			err = errors.Join(err, guardErr)
		}
	}
	return receipt, errors.Join(saveErr, err)
}

// Caller holds accounts.lifecycleMu. Official-login processes have a separate
// lifecycle and are not stopped by the contribution stop action.
func (r *DesktopRuntime) accountWorkersLocked() []*desktopAccountWorker {
	result := make([]*desktopAccountWorker, 0, len(r.accounts.accountWorkers))
	for _, worker := range r.accounts.accountWorkers {
		result = append(result, worker)
	}
	return result
}
func (r *DesktopRuntime) ConfigureNetwork(ctx context.Context, network DesktopNetworkConfig) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !desktopSafeRevision(network.Revision) {
		return fmt.Errorf("network revision outside safe integer range")
	}
	if network.ConnectProxy != "" {
		if _, err := localConnectProxy(network.ConnectProxy); err != nil {
			return fmt.Errorf("runtime proxy rejected: %w", err)
		}
	}
	r.accounts.lifecycleMu.Lock()
	defer r.accounts.lifecycleMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || len(r.accounts.activeActions) > 0 || r.controlDone != nil {
		return fmt.Errorf("network change blocked: closed=%t active_account_actions=%d account_connection=%t", r.closed, len(r.accounts.activeActions), r.controlDone != nil)
	}
	if r.snapshot.Local != "stopped" && r.snapshot.Local != "failed" {
		return fmt.Errorf("network change requires stopped runtime: local=%s", r.snapshot.Local)
	}
	if network.Revision < r.network.Revision {
		return fmt.Errorf("network revision moved backwards: actual=%d current=%d", network.Revision, r.network.Revision)
	}
	if err := r.accounts.ConfigureNetwork(ctx, network); err != nil {
		return err
	}
	r.network = network
	r.snapshot.NetworkRevision = network.Revision
	r.snapshot.Revision++
	return nil
}
func (r *DesktopRuntime) allowsTarget(target string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.targets[target]
}
