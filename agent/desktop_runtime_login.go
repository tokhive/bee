package bee

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Called only after normal run reservation/ownership checks, before any
// platform preparation. A failed target retains its gate while the independent
// platform can prepare and connect using its own verified account.
func (r *DesktopRuntime) recoverSavedLoginMaintenance(ctx context.Context, session *desktopDeviceSession, state localState) error {
	journal, err := readDesktopLoginJournal(session)
	if err != nil {
		return err
	}
	for _, platform := range []string{"openai", "claude"} {
		if err := r.recoverSavedPlatformLogin(ctx, session, state, platform, journal); err != nil {
			return err
		}
	}
	return nil
}

func (r *DesktopRuntime) recoverSavedPlatformLogin(ctx context.Context, session *desktopDeviceSession, state localState, platform string, journal desktopLoginJournal) error {
	for {
		key := desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID) + ":" + platform
		record, found := journal.Records[key]
		if !found || record.Public.Phase == "restored" {
			return nil
		}
		markDesktopInterruptedLogin(&record)
		p, unlock, err := r.accounts.acquire(ctx, platform)
		if err != nil {
			return err
		}
		r.accounts.lifecycleMu.Lock()
		if existing := r.accounts.accountWorkers[platform]; existing != nil {
			r.accounts.lifecycleMu.Unlock()
			unlock()
			select {
			case <-existing.done:
				journal, err = readDesktopLoginJournal(session)
				if err != nil {
					return err
				}
				continue
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if p.working || r.accounts.activeActions[platform] || r.accounts.closed {
			working, active, closed := p.working, r.accounts.activeActions[platform], r.accounts.closed
			r.accounts.lifecycleMu.Unlock()
			unlock()
			return fmt.Errorf("saved login recovery admission changed: platform=%s working=%t active=%t closed=%t; original worker retained", platform, working, active, closed)
		}
		live, cancel := context.WithCancel(r.accounts.ctx)
		stopRun := context.AfterFunc(ctx, cancel)
		worker := &desktopAccountWorker{cancel: cancel, done: make(chan struct{})}
		p.working = true
		r.accounts.activeActions[platform] = true
		r.accounts.accountWorkers[platform] = worker
		r.accounts.workers.Add(1)
		o := r.accounts.authorizer
		r.accounts.lifecycleMu.Unlock()
		p.snapshot.LoginMaintenance = copyDesktopLoginMaintenance(record.Public)
		p.snapshot.Revision++
		unlock()
		err = func() (result error) {
			defer r.accounts.workers.Done()
			defer close(worker.done)
			defer cancel()
			defer stopRun()
			defer func() {
				if result != nil {
					record.Public.Phase, record.Public.CanRecheck = "blocked", true
					record.Public.Error = accountFailure(platform, "login_maintenance_unconfirmed", "login_maintenance_recovery", result.Error())
				}
				locked, release, _ := r.accounts.acquire(context.Background(), platform)
				r.accounts.lifecycleMu.Lock()
				if r.accounts.accountWorkers[platform] == worker {
					locked.working = false
					delete(r.accounts.activeActions, platform)
					delete(r.accounts.accountWorkers, platform)
				}
				r.accounts.lifecycleMu.Unlock()
				locked.snapshot.LoginMaintenance = copyDesktopLoginMaintenance(record.Public)
				locked.snapshot.Revision++
				release()
			}()
			if err := r.markLoginMaintenance(live, platform, record.Public.Operation.ID); err != nil {
				return err
			}
			if o == nil {
				err = fmt.Errorf("saved login recovery owner absent: platform=%s; original operation remains isolated", platform)
			} else {
				err = o.recoverLoginMaintenance(live, &record)
			}
			if err != nil {
				record.Public.Phase, record.Public.CanRecheck = "blocked", true
				record.Public.Error = accountFailure(platform, "login_maintenance_unconfirmed", "login_maintenance_recovery", err.Error())
			}
			if o != nil {
				if saveErr := o.saveLoginMaintenance(live, &record); saveErr != nil {
					err = errors.Join(err, saveErr)
					o.blockLoginMaintenance(&record, err)
				}
			}
			return nil
		}()
		return err
	}
}

func (r *DesktopRuntime) markLoginMaintenance(ctx context.Context, platform, id string) error {
	slot := r.slots[platform]
	if slot == nil {
		return fmt.Errorf("login maintenance target slot absent: platform=%s", platform)
	}
	if err := slot.gate.lock(ctx); err != nil {
		return err
	}
	defer slot.gate.unlock()
	if slot.maintenanceID != "" && slot.maintenanceID != id {
		return fmt.Errorf("login maintenance target owned by another operation; original maintenance retained")
	}
	if err := slot.control.lock(ctx); err != nil {
		return err
	}
	slot.maintenanceID = id
	slot.pauseRevision.Add(1)
	slot.resumeAttempted = true
	slot.control.unlock()
	return nil
}

func (r *DesktopRuntime) isolateLoginMaintenance(ctx context.Context, platform, id string) error {
	slot := r.slots[platform]
	if slot == nil {
		return fmt.Errorf("login maintenance isolation target absent: platform=%s", platform)
	}
	if err := slot.gate.lock(ctx); err != nil {
		return err
	}
	defer slot.gate.unlock()
	if slot.maintenanceID != "" && slot.maintenanceID != id {
		return fmt.Errorf("login isolation ownership changed; previous platform maintenance retained")
	}
	slot.maintenanceID = id
	r.mu.Lock()
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
		select {
		case <-slot.done:
		case <-ctx.Done():
			return fmt.Errorf("login target maintenance join unconfirmed: %w", ctx.Err())
		}
	}
	slot.config, slot.confirmed = nil, nil
	p, release, err := r.accounts.acquire(ctx, platform)
	if err != nil {
		return err
	}
	p.snapshot.Authorization = DesktopAccountFact{State: "unconfirmed", ObservedAt: accountTime(time.Now())}
	p.snapshot.Revision++
	release()
	return nil
}

func (r *DesktopRuntime) releaseUnselectedLoginMaintenance(ctx context.Context, platform, id string) error {
	slot := r.slots[platform]
	if err := slot.gate.lock(ctx); err != nil {
		return err
	}
	defer slot.gate.unlock()
	if slot.maintenanceID != id {
		return fmt.Errorf("unselected login maintenance ownership changed; no target is enabled")
	}
	slot.maintenanceID = ""
	return nil
}

func (r *DesktopRuntime) restoreLoginMaintenance(ctx context.Context, platform string, record *desktopLoginRecord, selected desktopAccountSelection) error {
	cfg, err := r.configForSelection(platform, selected)
	if err != nil {
		return err
	}
	slot := r.slots[platform]
	if err := slot.gate.lock(ctx); err != nil {
		return err
	}
	defer slot.gate.unlock()
	if slot.maintenanceID != record.Public.Operation.ID {
		return fmt.Errorf("login restoration ownership changed; late maintenance result discarded")
	}
	r.mu.Lock()
	adoptedRun := r.snapshot.RunID != nil && slot.loginRecoveryRun == *r.snapshot.RunID && r.ownedSession != nil && r.ownedSession.run == *r.snapshot.RunID
	blocked := r.closed || r.presence.shutdown || r.presence.suspended || r.snapshot.Local == "starting" && !adoptedRun || r.snapshot.Local == "stopping"
	running := r.snapshot.Local == "running"
	matchingRun := record.RunID != nil && r.snapshot.RunID != nil && *record.RunID == *r.snapshot.RunID
	networkMatch := record.NetworkRevision == r.network.Revision
	if blocked || running && !(matchingRun && networkMatch || !matchingRun && adoptedRun) {
		r.mu.Unlock()
		return fmt.Errorf("login restoration context changed: shutdown_or_transition=%t running=%t run_match=%t network_match=%t; late result cannot enable forwarding", blocked, running, matchingRun, networkMatch)
	}
	r.mu.Unlock()
	slot.config = cfg
	slot.selection = selected
	slot.resume, slot.resumeAttempted = false, true
	return nil
}

// The verified configuration remains isolated until the exact restored journal
// has been written and read back. A failed final save leaves this gate available
// for a later read-only repair, with manual resume and new forwarding blocked.
func (r *DesktopRuntime) completeLoginMaintenance(ctx context.Context, record *desktopLoginRecord) error {
	platform := *record.Public.Operation.Platform
	if record.Selection == nil {
		return r.releaseUnselectedLoginMaintenance(ctx, platform, record.Public.Operation.ID)
	}
	slot := r.slots[platform]
	if err := slot.gate.lock(ctx); err != nil {
		return err
	}
	defer slot.gate.unlock()
	if slot.maintenanceID != record.Public.Operation.ID || slot.config == nil {
		return fmt.Errorf("login completion ownership unconfirmed: operation_match=%t configured=%t; maintenance remains isolated", slot.maintenanceID == record.Public.Operation.ID, slot.config != nil)
	}
	r.mu.Lock()
	adoptedRun := r.snapshot.RunID != nil && slot.loginRecoveryRun == *r.snapshot.RunID && r.ownedSession != nil && r.ownedSession.run == *r.snapshot.RunID
	blocked := r.closed || r.presence.shutdown || r.presence.suspended || r.snapshot.Local == "starting" && !adoptedRun || r.snapshot.Local == "stopping"
	running := r.snapshot.Local == "running"
	matchingRun := record.RunID != nil && r.snapshot.RunID != nil && *record.RunID == *r.snapshot.RunID
	networkMatch := record.NetworkRevision == r.network.Revision
	if blocked || running && !(matchingRun && networkMatch || !matchingRun && adoptedRun) {
		r.mu.Unlock()
		return fmt.Errorf("login completion context changed: shutdown_or_transition=%t running=%t run_match=%t network_match=%t; maintenance remains isolated", blocked, running, matchingRun, networkMatch)
	}
	if running || r.snapshot.Local == "starting" && adoptedRun {
		r.targets[runtimePlatformTarget(platform)] = true
	}
	r.mu.Unlock()
	slot.maintenanceID = ""
	if running {
		r.startSlotLocked(platform, slot, nil)
	}
	return nil
}

// Caller owns the selection barrier and an existing live connection. A stopped
// user's temporary confirmation connection retains its empty relay allowlist.
func (r *DesktopRuntime) prepareAccountChangeForwarding(platform string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.snapshot.Local == "stopping" || r.presence.shutdown {
		return fmt.Errorf("account change forwarding blocked by runtime shutdown")
	}
	if r.snapshot.Local != "running" {
		if r.controlDone == nil {
			return fmt.Errorf("account change forwarding has no owned confirmation connection")
		}
		r.targets[runtimePlatformTarget(platform)] = true
		return nil
	}
	r.syncMu.Lock()
	connection := r.connection
	valid := connection != nil && connection.active && connection.ctx.Err() == nil
	r.syncMu.Unlock()
	if !valid {
		return fmt.Errorf("account change forwarding has no live owned relay")
	}
	r.targets[runtimePlatformTarget(platform)] = true
	return nil
}
