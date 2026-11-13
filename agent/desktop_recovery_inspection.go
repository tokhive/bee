package bee

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// DesktopRecoveryInspection is read-only evidence, never an admission ticket.
// Restore repeats the reservation checks while holding the lifecycle locks.
type DesktopRecoveryInspection struct {
	State           string                 `json:"state"`
	BindingRevision int64                  `json:"binding_revision"`
	PreviousRunID   *string                `json:"previous_run_id"`
	AccountRevision *string                `json:"account_revision"`
	IntentRunning   bool                   `json:"intent_running"`
	Failure         *DesktopStartupFailure `json:"failure"`
	RetirementID    *string                `json:"retirement_id,omitempty"`
	BindingIdentity *string                `json:"binding_identity,omitempty"`
}
type DesktopStartupFailure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (r *DesktopRuntime) InspectRecovery(ctx context.Context) DesktopRecoveryInspection {
	r.accounts.lifecycleMu.Lock()
	defer r.accounts.lifecycleMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.inspectRecoveryLocked(ctx)
}

func (r *DesktopRuntime) inspectRecoveryLocked(ctx context.Context) DesktopRecoveryInspection {
	out := DesktopRecoveryInspection{State: "blocked"}
	reject := func(code string, err error) DesktopRecoveryInspection {
		out.State = "blocked"
		out.Failure = &DesktopStartupFailure{Code: code, Message: err.Error()}
		return out
	}
	if r.closed || r.snapshot.Local != "stopped" && r.snapshot.Local != "failed" || len(r.accounts.activeActions) > 0 {
		return reject("RECOVERY_OWNER_BUSY", fmt.Errorf("recovery inspection rejected: closed=%t local=%s account_actions=%d; required=idle lifecycle owner", r.closed, r.snapshot.Local, len(r.accounts.activeActions)))
	}
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return reject("RECOVERY_STORAGE_UNAVAILABLE", err)
	}
	defer release()
	state, revision, err := session.readBinding()
	out.BindingRevision = revision
	if err != nil {
		return reject("STARTUP_DATA_INVALID", err)
	}
	if err = r.accounts.verifyStoredAccountState(session); err != nil {
		return reject("STARTUP_DATA_INVALID", err)
	}
	if state.Identity != nil {
		binding := retirementBinding(state)
		out.BindingIdentity = &binding
		scope, err := r.accounts.selectionScope(session, state, nil)
		if err != nil {
			return reject("STARTUP_DATA_INVALID", err)
		}
		if scope.Session.RunID != "" {
			run := scope.Session.RunID
			out.PreviousRunID = &run
		}
		// Bind the journal to the exact saved scope without copying source paths
		// or credentials into the native startup record.
		encoded, err := json.Marshal(scope)
		if err != nil {
			return reject("STARTUP_DATA_INVALID", fmt.Errorf("encode saved recovery scope: %w", err))
		}
		digest := sha256.Sum256(encoded)
		accountRevision := hex.EncodeToString(digest[:])
		out.AccountRevision = &accountRevision
		out.IntentRunning = scope.RuntimeIntent.Running && !r.userStopRequested
		if len(scope.PendingOperations) > 0 {
			return reject("RECOVERY_OPERATION_UNRESOLVED", fmt.Errorf("recovery inspection blocked: unresolved account operations=%d; query original operations before any new writes", len(scope.PendingOperations)))
		}
		if scope.Session.Active || !scope.Session.Clean {
			return reject("RECOVERY_SESSION_UNCONFIRMED", fmt.Errorf("recovery inspection blocked: previous_session_active=%t clean=%t; old workers and remote preparation ownership not proven retired", scope.Session.Active, scope.Session.Clean))
		}
		if scope.RuntimeIntent.Running && !r.userStopRequested {
			out.State = "eligible"
		} else {
			out.State = "idle"
		}
	} else {
		out.State = "idle"
	}
	guard, err := readDesktopAccountBytes(filepath.Join(filepath.Dir(session.path), "runtime-session"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		out.State = "blocked"
		return reject("STARTUP_DATA_INVALID", fmt.Errorf("read startup recovery guard: %w", err))
	}
	if err == nil && !bytes.Equal(guard, []byte("clean\n")) {
		out.State = "blocked"
		return reject("RECOVERY_GUARD_UNCONFIRMED", fmt.Errorf("recovery inspection blocked: previous recovery guard is not clean; prior worker and remote ownership unconfirmed; protected record preserved"))
	}
	receipt, receiptErr := readSessionRetirement(session)
	if receiptErr != nil {
		return reject("RECOVERY_RETIREMENT_INVALID", receiptErr)
	}
	if receipt != nil && !receipt.Completed {
		return reject("RECOVERY_RETIREMENT_UNCONFIRMED", fmt.Errorf("original session retirement is not locally complete: operation=%s; reconcile original operation", receipt.Request.ID))
	}
	if receipt != nil && receipt.Completed && state.Identity != nil && receipt.Binding == retirementBinding(state) && state.RuntimeEpoch == receipt.Request.ID {
		scope, scopeErr := r.accounts.selectionScope(session, state, nil)
		if scopeErr != nil {
			return reject("STARTUP_DATA_INVALID", scopeErr)
		}
		retired := receipt.Original
		retired.Session.Active = false
		retired.Session.Clean = true
		if recoveryDigest(scope) == recoveryDigest(retired) {
			id := receipt.Request.ID
			out.RetirementID = &id
		}
	}
	return out
}
