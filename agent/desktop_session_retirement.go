package bee

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"time"

	"github.com/tokhive/bee/beewire"
)

// The remote proof is persisted before either local marker is retired. A crash
// between the two writes resumes this same retirement, without admitting work.
type desktopSessionRetirement struct {
	Version   int                            `json:"version"`
	Binding   string                         `json:"binding"`
	Guard     string                         `json:"guard"`
	Original  desktopAccountScope            `json:"original"`
	Request   beewire.RuntimeRecoveryRequest `json:"request"`
	Proof     *beewire.RuntimeRecoveryResult `json:"proof"`
	Completed bool                           `json:"completed"`
}

func sessionRetirementPath(s *desktopDeviceSession) string {
	return filepath.Join(filepath.Dir(s.path), "desktop-session-retirement.json")
}
func recoveryDigest(v any) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func retirementPreparations(scope desktopAccountScope) map[string]beewire.RuntimeRecoveryPreparation {
	out := map[string]beewire.RuntimeRecoveryPreparation{}
	for platform, selection := range scope.Selections {
		out[platform] = beewire.RuntimeRecoveryPreparation{ID: selection.PreparationID, Fingerprint: selection.Fingerprint}
	}
	return out
}
func retirementBinding(state localState) string {
	state.RuntimeEpoch = ""
	return recoveryDigest(state)
}
func saveSessionRetirement(s *desktopDeviceSession, v *desktopSessionRetirement) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return writePrivateFile(sessionRetirementPath(s), append(raw, '\n'), ".session-retirement-*")
}
func readSessionRetirement(s *desktopDeviceSession) (*desktopSessionRetirement, error) {
	raw, err := readDesktopAccountBytes(sessionRetirementPath(s))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err = uniqueAccountJSON(json.NewDecoder(bytes.NewReader(raw))); err != nil {
		return nil, err
	}
	if err = requireDesktopStateFields(raw, reflect.TypeOf(desktopSessionRetirement{}), "session_retirement"); err != nil {
		return nil, err
	}
	var v desktopSessionRetirement
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&v); err != nil {
		return nil, err
	}
	checks := []struct {
		name     string
		valid    bool
		required string
	}{
		{"version_valid", v.Version == 1, "version 1"},
		{"binding_valid", desktopAccountDigest(v.Binding), "64 lowercase hex characters"},
		{"request_id_valid", desktopHexID(v.Request.ID, 24), "48 lowercase hex characters"},
		{"account_revision_match", v.Request.AccountRevision == recoveryDigest(v.Original), "original account scope digest"},
		{"previous_run_match", v.Request.PreviousRunID == v.Original.Session.RunID, "original session run ID"},
		{"previous_epoch_valid", v.Request.PreviousEpoch == "" || desktopHexID(v.Request.PreviousEpoch, 24), "empty or 48 lowercase hex characters"},
		{"guard_valid", v.Guard == "clean\n" || desktopHexID(string(bytes.TrimSuffix([]byte(v.Guard), []byte("\n"))), 16), "clean marker or 32-character hex run ID"},
		{"previous_run_valid", desktopHexID(v.Request.PreviousRunID, 16), "32 lowercase hex characters"},
		{"preparations_match", reflect.DeepEqual(v.Request.Preparations, retirementPreparations(v.Original)), "original preparation map"},
		{"guard_run_match", v.Guard == "clean\n" || v.Guard == v.Request.PreviousRunID+"\n", "clean marker or original run ID with newline"},
	}
	for _, check := range checks {
		if !check.valid {
			return nil, fmt.Errorf("session retirement metadata rejected: %s=false; required=%s; original evidence retained", check.name, check.required)
		}
	}
	if err = validateDesktopAccountScopes(map[string]desktopAccountScope{desktopScopeKey(v.Original.Hive, v.Original.OwnerID, v.Original.DeviceID): v.Original}); err != nil {
		return nil, err
	}
	if v.Proof != nil {
		state := localState{Identity: &beewire.Identity{ID: v.Original.DeviceID, OwnerID: v.Original.OwnerID}}
		if err = validateRetirementProof(state, v.Request, *v.Proof); err != nil {
			return nil, err
		}
	}
	if v.Completed && v.Proof == nil {
		return nil, fmt.Errorf("completed session retirement lacks remote proof")
	}
	return &v, nil
}
func validateRetirementProof(state localState, request beewire.RuntimeRecoveryRequest, proof beewire.RuntimeRecoveryResult) error {
	if proof.Version != 1 || proof.DeviceID != state.Identity.ID || proof.OwnerID != state.Identity.OwnerID || proof.Request == nil || !reflect.DeepEqual(*proof.Request, request) || proof.State != "retired" || proof.Epoch != request.ID || !proof.ConnectionRetired || !proof.PreparationsRetired || proof.Unfinished {
		return fmt.Errorf("Hive session retirement proof rejected: version=%d device_match=%t owner_match=%t request_match=%t state=%s epoch_match=%t connection_retired=%t preparations_retired=%t unfinished=%t; required=original request and complete durable retirement", proof.Version, proof.DeviceID == state.Identity.ID, proof.OwnerID == state.Identity.OwnerID, proof.Request != nil && reflect.DeepEqual(*proof.Request, request), proof.State, proof.Epoch == request.ID, proof.ConnectionRetired, proof.PreparationsRetired, proof.Unfinished)
	}
	return nil
}
func retirementCall(ctx context.Context, state localState, id, method string, input any) (beewire.RuntimeRecoveryResult, error) {
	var raw json.RawMessage
	err := desktopCall(ctx, state, "/api/bee/runtime-recovery/"+id, method, state.Credential, input, &raw)
	if err != nil {
		return beewire.RuntimeRecoveryResult{}, err
	}
	if err = uniqueAccountJSON(json.NewDecoder(bytes.NewReader(raw))); err != nil {
		return beewire.RuntimeRecoveryResult{}, err
	}
	if err = requireDesktopStateFields(raw, reflect.TypeOf(beewire.RuntimeRecoveryResult{}), "runtime_recovery"); err != nil {
		return beewire.RuntimeRecoveryResult{}, err
	}
	var result beewire.RuntimeRecoveryResult
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&result); err != nil {
		return result, err
	}
	if result.Version != 1 || state.Identity == nil || result.DeviceID != state.Identity.ID || result.OwnerID != state.Identity.OwnerID || result.State != "absent" && result.State != "draining" && result.State != "retired" || result.Epoch != "" && !desktopHexID(result.Epoch, 24) || result.State == "absent" && result.Request != nil || result.State != "absent" && (result.Request == nil || result.Request.ID != id) {
		return result, fmt.Errorf("Hive retirement query rejected: version=%d state=%s request_present=%t device_match=%t owner_match=%t; required=original device and known operation", result.Version, result.State, result.Request != nil, result.DeviceID == state.Identity.ID, result.OwnerID == state.Identity.OwnerID)
	}
	return result, nil
}

// ReconcileRecovery can only end the inherited session. It never opens a relay,
// uploads credentials, changes pause choices or supplies an account.
func (r *DesktopRuntime) ReconcileRecovery(ctx context.Context) DesktopRecoveryInspection {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	r.accounts.lifecycleMu.Lock()
	defer r.accounts.lifecycleMu.Unlock()
	fail := func(code string, err error) DesktopRecoveryInspection {
		return DesktopRecoveryInspection{State: "blocked", Failure: &DesktopStartupFailure{Code: code, Message: err.Error()}}
	}
	r.mu.Lock()
	busy := r.closed || r.presence.shutdown || (r.snapshot.Local != "stopped" && r.snapshot.Local != "failed") || len(r.accounts.activeActions) != 0 || len(r.accounts.accountWorkers) != 0 || r.controlDone != nil || r.runDone != nil && !channelClosed(r.runDone)
	var presenceDone chan struct{}
	if !busy {
		presenceDone = r.cancelPresenceLocked()
		r.presence.enabled = false
	}
	r.mu.Unlock()
	if busy {
		return fail("RECOVERY_OWNER_BUSY", fmt.Errorf("session retirement requires an idle lifecycle owner: busy=true; no remote request submitted"))
	}
	if presenceDone != nil {
		select {
		case <-presenceDone:
		case <-ctx.Done():
			return fail("RECOVERY_OWNER_BUSY", fmt.Errorf("session retirement could not join current presence: %w", ctx.Err()))
		}
	}
	if err := r.device.recoveryWriteBarrier(); err != nil {
		return fail("RECOVERY_OPERATION_UNRESOLVED", err)
	}
	s, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
	}
	defer release()
	state, _, err := s.readBinding()
	if err != nil {
		return fail("STARTUP_DATA_INVALID", err)
	}
	if state.Identity == nil {
		return fail("RECOVERY_BINDING_UNCONFIRMED", fmt.Errorf("session retirement requires a saved device identity"))
	}
	if err = r.accounts.verifyStoredAccountState(s); err != nil {
		return fail("STARTUP_DATA_INVALID", err)
	}
	scope, err := r.accounts.selectionScope(s, state, nil)
	if err != nil {
		return fail("STARTUP_DATA_INVALID", err)
	}
	if len(scope.PendingOperations) != 0 {
		return fail("RECOVERY_OPERATION_UNRESOLVED", fmt.Errorf("session retirement blocked: pending_account_operations=%d; reconcile original operations first", len(scope.PendingOperations)))
	}
	login, err := readDesktopLoginJournal(s)
	if err != nil {
		return fail("STARTUP_DATA_INVALID", err)
	}
	for _, record := range login.Records {
		if record.Public.Phase != "restored" {
			return fail("RECOVERY_LOGIN_UNRESOLVED", fmt.Errorf("session retirement blocked: login_operation=%s phase=%s; verify original login process before retiring its runtime", record.Public.Operation.ID, record.Public.Phase))
		}
	}
	guardPath := filepath.Join(filepath.Dir(s.path), "runtime-session")
	guard, err := readDesktopAccountBytes(guardPath)
	if errors.Is(err, os.ErrNotExist) {
		guard = []byte("clean\n")
	} else if err != nil {
		return fail("STARTUP_DATA_INVALID", err)
	}
	record, err := readSessionRetirement(s)
	if err != nil {
		return fail("RECOVERY_RETIREMENT_INVALID", err)
	}
	if !scope.Session.Active && scope.Session.Clean && bytes.Equal(guard, []byte("clean\n")) && (record == nil || record.Completed) {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.inspectRecoveryLocked(ctx)
	}
	if record != nil && record.Completed {
		archive := filepath.Join(filepath.Dir(s.path), "desktop-session-retirement-"+record.Request.ID+".json")
		raw, _ := json.Marshal(record)
		encoded := append(raw, '\n')
		existing, archiveErr := readDesktopAccountBytes(archive)
		if archiveErr == nil && !bytes.Equal(existing, encoded) {
			return fail("RECOVERY_RETIREMENT_INVALID", fmt.Errorf("previous retirement archive differs: operation=%s; original preserved", record.Request.ID))
		}
		if archiveErr != nil && !errors.Is(archiveErr, os.ErrNotExist) {
			return fail("RECOVERY_STORAGE_UNAVAILABLE", archiveErr)
		}
		if errors.Is(archiveErr, os.ErrNotExist) {
			if err = writePrivateFile(archive, encoded, ".retirement-history-*"); err != nil {
				return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
			}
		}
		record = nil
	}
	if record == nil {
		if scope.Session.RunID == "" || !bytes.Equal(guard, []byte("clean\n")) && !bytes.Equal(guard, []byte(scope.Session.RunID+"\n")) {
			return fail("RECOVERY_GUARD_UNCONFIRMED", fmt.Errorf("session retirement guard binding rejected: session_run_present=%t guard_matches_run=%t; original records preserved", scope.Session.RunID != "", bytes.Equal(guard, []byte(scope.Session.RunID+"\n"))))
		}
		id, err := desktopOperationID()
		if err != nil {
			return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
		}
		preparations := retirementPreparations(scope)
		record = &desktopSessionRetirement{Version: 1, Binding: retirementBinding(state), Guard: string(guard), Original: scope, Request: beewire.RuntimeRecoveryRequest{ID: id, PreviousEpoch: state.RuntimeEpoch, PreviousRunID: scope.Session.RunID, AccountRevision: recoveryDigest(scope), Preparations: preparations}}
		if err = saveSessionRetirement(s, record); err != nil {
			return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
		}
	}
	retired := record.Original
	retired.Session.Active = false
	retired.Session.Clean = true
	if record.Binding != retirementBinding(state) || !reflect.DeepEqual(scope, record.Original) && !(record.Proof != nil && reflect.DeepEqual(scope, retired)) || string(guard) != record.Guard && !(record.Proof != nil && bytes.Equal(guard, []byte("clean\n"))) || state.RuntimeEpoch != record.Request.PreviousEpoch && !(record.Proof != nil && state.RuntimeEpoch == record.Request.ID) {
		return fail("RECOVERY_CONTEXT_CHANGED", fmt.Errorf("session retirement context changed: binding_match=%t original_scope_match=%t guard_original=%t; original operation retained", record.Binding == retirementBinding(state), reflect.DeepEqual(scope, record.Original), string(guard) == record.Guard))
	}
	if record.Proof == nil {
		result, err := retirementCall(ctx, state, record.Request.ID, http.MethodGet, nil)
		if err != nil {
			var api *apiFailure
			if errors.As(err, &api) && (api.Status == 404 || api.Status == 405) {
				return fail("RECOVERY_SERVER_UNSUPPORTED", fmt.Errorf("Hive runtime recovery protocol unavailable: %w; Hive must support durable session retirement before Bee can resume; account and device settings preserved", err))
			}
			return fail("RECOVERY_RETIREMENT_UNCONFIRMED", err)
		}
		if result.State != "absent" && !reflect.DeepEqual(result.Request, &record.Request) {
			return fail("RECOVERY_CONTEXT_CHANGED", fmt.Errorf("Hive original retirement request differs: operation=%s; no new operation submitted", record.Request.ID))
		}
		if result.State != "retired" {
			result, err = retirementCall(ctx, state, record.Request.ID, http.MethodPost, record.Request)
			if err != nil {
				writeErr := err
				result, err = retirementCall(ctx, state, record.Request.ID, http.MethodGet, nil)
				if err != nil {
					return fail("RECOVERY_RETIREMENT_UNCONFIRMED", fmt.Errorf("original retirement result unknown: operation=%s write=%v; query: %w", record.Request.ID, writeErr, err))
				}
				var api *apiFailure
				if result.State != "retired" && errors.As(writeErr, &api) && api.Status >= 400 && api.Status < 500 {
					return fail("RECOVERY_RETIREMENT_CONFLICT", fmt.Errorf("original retirement rejected: operation=%s remote_state=%s; write=%w; original session and preparation retained", record.Request.ID, result.State, writeErr))
				}
			}
		}
		if result.State == "draining" {
			return fail("RECOVERY_REMOTE_DRAINING", fmt.Errorf("Hive is retiring original session: operation=%s connection_retired=%t unfinished=%t; original operation retained, no contribution started", record.Request.ID, result.ConnectionRetired, result.Unfinished))
		}
		if err = validateRetirementProof(state, record.Request, result); err != nil {
			return fail("RECOVERY_RETIREMENT_UNCONFIRMED", err)
		}
		record.Proof = &result
		if err = saveSessionRetirement(s, record); err != nil {
			return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
		}
	}
	// No worker can start under lifecycleMu. Preserve proof before certifying
	// either file; a partial local save remains resumable via the original ID.
	state.RuntimeEpoch = record.Request.ID
	if err = s.save(state); err != nil {
		return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
	}
	_, err = r.accounts.selectionScope(s, state, func(current *desktopAccountScope) error {
		if !reflect.DeepEqual(*current, record.Original) && !reflect.DeepEqual(*current, retired) {
			return fmt.Errorf("session changed after remote retirement; original proof preserved")
		}
		*current = retired
		return nil
	})
	if err != nil {
		return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
	}
	if err = writePrivateFile(guardPath, []byte("clean\n"), ".runtime-session-*"); err != nil {
		return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
	}
	record.Completed = true
	if err = saveSessionRetirement(s, record); err != nil {
		return fail("RECOVERY_STORAGE_UNAVAILABLE", err)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	result := r.inspectRecoveryLocked(ctx)
	id := record.Request.ID
	result.RetirementID = &id
	return result
}
