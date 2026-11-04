package bee

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/tokhive/bee/beewire"
)

var desktopRecoveryPhases = []string{"awaiting_confirmation", "creating", "creation_unknown", "pending", "draining", "redeeming", "redemption_unknown", "awaiting_owner_confirmation", "saving", "completed", "expired", "blocked"}

type DesktopRecoveryPairing struct {
	Code            string    `json:"code"`
	VerificationURL string    `json:"verification_url"`
	ExpiresAt       time.Time `json:"expires_at"`
}
type DesktopRecoveryFailure struct {
	Code    string                 `json:"code"`
	Message string                 `json:"message"`
	Details *DesktopFailureDetails `json:"details,omitempty"`
}
type DeviceRecoveryView struct {
	OperationID string                  `json:"operation_id"`
	Revision    int64                   `json:"revision"`
	Phase       string                  `json:"phase"`
	OldIdentity *beewire.Identity       `json:"old_identity"`
	NewIdentity *beewire.Identity       `json:"new_identity"`
	Pairing     *DesktopRecoveryPairing `json:"pairing"`
	Failure     *DesktopRecoveryFailure `json:"failure"`
}
type desktopRecoveryDecision struct {
	OperationID      string `json:"operation_id"`
	ExpectedRevision int64  `json:"expected_revision"`
	Decision         string `json:"decision"`
}
type desktopRecoveryRecord struct {
	Version         int                       `json:"version"`
	Purpose         string                    `json:"purpose"`
	OperationID     string                    `json:"operation_id"`
	Revision        int64                     `json:"revision"`
	Phase           string                    `json:"phase"`
	Hive            string                    `json:"hive"`
	Name            string                    `json:"name"`
	OldIdentity     *beewire.Identity         `json:"old_identity"`
	OldBinding      string                    `json:"old_binding"`
	BindingRevision int64                     `json:"binding_revision"`
	Credential      string                    `json:"credential"`
	CreateAttempted bool                      `json:"create_attempted"`
	RedeemAttempted bool                      `json:"redeem_attempted"`
	Pairing         *beewire.Pairing          `json:"pairing"`
	NewIdentity     *beewire.Identity         `json:"new_identity"`
	ConfirmedOwner  string                    `json:"confirmed_owner"`
	Accepted        []desktopRecoveryDecision `json:"accepted"`
	Failure         *DesktopRecoveryFailure   `json:"failure"`
}

func recoveryPath(s *desktopDeviceSession) string {
	return filepath.Join(filepath.Dir(s.path), "bee-desktop-recovery.json")
}
func recoveryBinding(state localState) string {
	raw, _ := json.Marshal([]any{state.Hive, state.Name, state.Credential, state.Identity})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func readDesktopRecovery(s *desktopDeviceSession) (*desktopRecoveryRecord, error) {
	raw, err := readDesktopAccountBytes(recoveryPath(s))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read protected recovery record: %w", err)
	}
	if err = uniqueAccountJSON(json.NewDecoder(bytes.NewReader(raw))); err != nil {
		return nil, fmt.Errorf("recovery record JSON rejected: %w", err)
	}
	// Pointer identity/pairing contracts have optional legacy wire fields; validate them separately.
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		return nil, errors.New("recovery record requires one JSON object")
	}
	kind := reflect.TypeOf(desktopRecoveryRecord{})
	if len(fields) != kind.NumField() {
		return nil, fmt.Errorf("recovery record fields=%d required=%d", len(fields), kind.NumField())
	}
	for i := 0; i < kind.NumField(); i++ {
		if fields[kind.Field(i).Tag.Get("json")] == nil {
			return nil, errors.New("recovery record field missing; original file preserved")
		}
	}
	for name, value := range fields {
		if slices.Contains([]string{"old_identity", "new_identity", "pairing", "failure"}, name) {
			continue
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, fmt.Errorf("recovery field=%s is null; required=explicit typed value", name)
		}
	}
	var r desktopRecoveryRecord
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&r); err != nil {
		return nil, errors.New("recovery record schema rejected; original file preserved")
	}
	if err = validateDesktopRecovery(r); err != nil {
		return nil, err
	}
	return &r, nil
}
func validateDesktopRecovery(r desktopRecoveryRecord) error {
	origin, err := hiveOrigin(r.Hive)
	if err != nil || origin != r.Hive || r.Version != 1 || !slices.Contains([]string{"initial_pairing", "credential_recovery"}, r.Purpose) || !desktopHexID(r.OperationID, 24) || !desktopSafeRevision(r.Revision) || r.Revision < 1 || !desktopSafeRevision(r.BindingRevision) || !slices.Contains(desktopRecoveryPhases, r.Phase) || !deviceCredentialPattern.MatchString(r.Credential) || r.Accepted == nil || len(r.Accepted) > 128 {
		return errors.New("recovery record metadata rejected; required=version 1, canonical Hive, safe revisions, known purpose/phase and protected credential")
	}
	if strings.TrimSpace(r.Name) == "" || utf8.RuneCountInString(r.Name) > 80 || strings.IndexFunc(r.Name, unicode.IsControl) >= 0 {
		return errors.New("recovery device name rejected; required=1..80 characters without controls")
	}
	if r.Failure != nil {
		raw, _ := json.Marshal(r.Failure)
		var value struct {
			Code    string                 `json:"code"`
			Message string                 `json:"message"`
			Details *DesktopFailureDetails `json:"details,omitempty"`
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&value) != nil || value.Code == "" || len(value.Code) > 128 || value.Message == "" || desktopSafeText(value.Message) != value.Message {
			return errors.New("recovery failure rejected; required=safe structured evidence")
		}
	}
	state := localState{Hive: r.Hive, Name: r.Name, Credential: r.Credential}
	if r.OldIdentity != nil {
		if err = validateDesktopIdentity(state, *r.OldIdentity); err != nil {
			return err
		}
	}
	if r.Purpose == "credential_recovery" && (r.OldIdentity == nil || !desktopHexID(r.OldBinding, 32)) {
		return errors.New("credential recovery requires original binding identity and digest")
	}
	if r.Purpose == "initial_pairing" && (r.OldIdentity != nil || r.OldBinding != "") {
		return errors.New("initial pairing record contains an original binding; transaction preserved and blocked")
	}
	if slices.Contains([]string{"saving", "completed"}, r.Phase) && (r.NewIdentity == nil || r.ConfirmedOwner != r.NewIdentity.OwnerID) {
		return errors.New("recovery save phase lacks confirmed ownership of the verified new identity")
	}
	if r.Pairing != nil {
		if err = validateDesktopPairing(state, *r.Pairing, false); err != nil {
			return err
		}
	}
	if r.NewIdentity != nil {
		if err = validateDesktopIdentity(state, *r.NewIdentity); err != nil {
			return err
		}
	}
	if slices.Contains([]string{"redeeming", "redemption_unknown"}, r.Phase) && !r.RedeemAttempted {
		return errors.New("recovery exchange phase lacks durable attempt marker; original record preserved")
	}
	if slices.Contains([]string{"creation_unknown", "pending", "draining"}, r.Phase) && !r.CreateAttempted {
		return errors.New("recovery phase lacks durable creation marker")
	}
	if r.RedeemAttempted && (!r.CreateAttempted || r.Pairing == nil) {
		return errors.New("recovery exchange attempt lacks original pairing; record preserved")
	}
	if slices.Contains([]string{"pending", "draining", "redeeming", "redemption_unknown"}, r.Phase) && r.Pairing == nil {
		return errors.New("recovery phase requires the original pairing token")
	}
	if slices.Contains([]string{"saving", "completed", "awaiting_owner_confirmation"}, r.Phase) && r.NewIdentity == nil {
		return errors.New("recovery adoption phase lacks verified new identity")
	}
	for _, a := range r.Accepted {
		if a.OperationID != r.OperationID || a.ExpectedRevision < 1 || a.ExpectedRevision >= r.Revision || !slices.Contains([]string{"begin_pairing", "adopt_owner", "renew_expired"}, a.Decision) {
			return errors.New("recovery accepted confirmation metadata rejected")
		}
	}
	return nil
}
func saveDesktopRecovery(s *desktopDeviceSession, r *desktopRecoveryRecord) error {
	if err := validateDesktopRecovery(*r); err != nil {
		return err
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if len(raw) > 65536 {
		return fmt.Errorf("recovery record bytes=%d required<=65536", len(raw))
	}
	if err = writePrivateFile(recoveryPath(s), append(raw, '\n'), ".bee-recovery-*"); err != nil {
		return fmt.Errorf("persist recovery phase=%s revision=%d: %w", r.Phase, r.Revision, err)
	}
	return nil
}
func (r *desktopRecoveryRecord) view() DeviceRecoveryView {
	v := DeviceRecoveryView{OperationID: r.OperationID, Revision: r.Revision, Phase: r.Phase, OldIdentity: r.OldIdentity, NewIdentity: r.NewIdentity, Failure: r.Failure}
	if r.Pairing != nil {
		v.Pairing = &DesktopRecoveryPairing{Code: r.Pairing.UserCode, VerificationURL: r.Pairing.VerificationURI + "?code=" + url.QueryEscape(r.Pairing.UserCode), ExpiresAt: r.Pairing.ExpiresAt}
	}
	return v
}
func recoveryFailure(code, check string, err error) *DesktopFailure {
	return &DesktopFailure{Code: code, Message: err.Error(), Cause: err, Details: &DesktopFailureDetails{Check: check, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Evidence: map[string]string{}}}
}
func (r *desktopRecoveryRecord) fail(cause error) {
	var f *DesktopFailure
	if errors.As(cause, &f) {
		r.Failure = &DesktopRecoveryFailure{Code: f.Code, Message: desktopSafeText(cause.Error()), Details: f.Details}
	} else {
		r.Failure = &DesktopRecoveryFailure{Code: "DEVICE_RECOVERY_BLOCKED", Message: desktopSafeText(cause.Error()), Details: &DesktopFailureDetails{Check: "device_recovery", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Evidence: map[string]string{}}}
	}
}
func (r *desktopRecoveryRecord) change(s *desktopDeviceSession, phase string, cause error) error {
	r.Phase = phase
	r.Revision++
	r.Failure = nil
	if cause != nil {
		r.fail(cause)
	}
	return saveDesktopRecovery(s, r)
}
func recoveryCredential() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "bee_" + base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

// Admission uses the same lifecycle order as Start/account workers, and releases
// ordinary mutexes before I/O. Durable records fence admissions after restart.
func (d *DesktopDevice) recoveryAdmission(s *desktopDeviceSession) (func(), error) {
	if d.runtime != nil {
		a := d.runtime.accounts
		a.lifecycleMu.Lock()
		defer a.lifecycleMu.Unlock()
		d.runtime.mu.Lock()
		r := d.runtime
		runExited := r.runDone != nil && channelClosed(r.runDone)
		controlExited := r.controlDone != nil && channelClosed(r.controlDone)
		runPending := r.runCancel != nil && r.runDone != nil && !runExited
		controlPending := r.controlDone != nil && !controlExited
		if r.closed || r.snapshot.Local != "stopped" || len(a.activeActions) > 0 || len(a.accountWorkers) > 0 || runPending || controlPending {
			defer r.mu.Unlock()
			return nil, fmt.Errorf("device recovery admission rejected: runtime_closed=%t local=%s active_actions=%d account_workers=%d run_cancel_present=%t run_done_present=%t run_done_closed=%t run_worker_pending=%t control_done_present=%t control_done_closed=%t control_worker_pending=%t; required=live runtime, stopped and all workers exited", r.closed, r.snapshot.Local, len(a.activeActions), len(a.accountWorkers), r.runCancel != nil, r.runDone != nil, runExited, runPending, r.controlDone != nil, controlExited, controlPending)
		}
		done := r.cancelPresenceLocked()
		r.presence.enabled = false
		r.snapshot.Connection = "disconnected"
		r.snapshot.ConnectionDetail = nil
		r.snapshot.Revision++
		r.mu.Unlock()
		if done != nil {
			<-done
		}
	}
	s.mu.Lock()
	if s.deviceWrites > 0 {
		count := s.deviceWrites
		s.mu.Unlock()
		return nil, fmt.Errorf("device recovery blocked by in-flight device writes: count=%d", count)
	}
	s.recoveryBusy = true
	s.mu.Unlock()
	return func() { s.mu.Lock(); s.recoveryBusy = false; s.mu.Unlock() }, nil
}
func channelClosed(c <-chan struct{}) bool {
	select {
	case <-c:
		return true
	default:
		return false
	}
}
func (d *DesktopDevice) recoveryWriteBarrier() error {
	s := &d.session
	s.mu.Lock()
	defer s.mu.Unlock()
	return recoveryWriteBarrierLocked(s)
}
func recoveryWriteBarrierLocked(s *desktopDeviceSession) error {
	if s.recoveryBusy {
		return errors.New("device recovery owns operation admission; start/account writes blocked")
	}
	if s.path == "" {
		return nil
	}
	r, err := readDesktopRecovery(s)
	if err != nil {
		return err
	}
	if r != nil && r.Phase != "completed" {
		return fmt.Errorf("device recovery transaction unresolved: phase=%s revision=%d; start/account writes blocked", r.Phase, r.Revision)
	}
	return nil
}

func (d *DesktopDevice) recoverySession(ctx context.Context) (*desktopDeviceSession, func(), error) {
	s, release, err := d.acquireSession(ctx)
	if err != nil {
		return nil, nil, err
	}
	end, err := s.beginPairing(ctx)
	if err != nil {
		release()
		return nil, nil, err
	}
	return s, func() { end(); release() }, nil
}
func (d *DesktopDevice) RecoveryPrepare(ctx context.Context) (DeviceRecoveryView, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	s, end, err := d.recoverySession(ctx)
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	defer end()
	finish, err := d.recoveryAdmission(s)
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	defer finish()
	r, err := readDesktopRecovery(s)
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	if r != nil && r.Phase != "completed" {
		if r.Purpose != "credential_recovery" {
			return DeviceRecoveryView{}, errors.New("initial pairing transaction already occupies device recovery record")
		}
		return r.view(), nil
	}
	state, revision, err := s.readBinding()
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	if state.Identity == nil || state.Pairing != nil {
		return DeviceRecoveryView{}, errors.New("credential recovery requires saved bound identity and no pending device pairing")
	}
	if _, err = d.Context(ctx); err != nil {
		return DeviceRecoveryView{}, err
	}
	// Inspect durable old scope before invoking any possible worker. Revoked
	// credentials cannot authorize reconciliation, so pending facts remain blocked.
	if d.runtime != nil {
		scope, e := d.runtime.accounts.selectionScope(s, state, nil)
		if e != nil {
			return DeviceRecoveryView{}, e
		}
		if len(scope.PendingOperations) > 0 || scope.Session.Active || !scope.Session.Clean {
			return DeviceRecoveryView{}, fmt.Errorf("device recovery blocked by original scope: pending=%d session_active=%t clean=%t; reconcile the original operations before replacement", len(scope.PendingOperations), scope.Session.Active, scope.Session.Clean)
		}
		if e = d.runtime.VerifyStartup(ctx); e != nil {
			return DeviceRecoveryView{}, e
		}
	}
	if err = d.recoveryOldScope(s, state.Identity, state.Hive); err != nil {
		return DeviceRecoveryView{}, err
	}
	var identity beewire.Identity
	err = desktopCall(ctx, state, "/api/bee/identity", http.MethodGet, state.Credential, nil, &identity)
	var remote *apiFailure
	if !errors.As(err, &remote) || remote.Status != 401 || !slices.Contains([]string{"device_replaced", "invalid_device_credential"}, remote.Code) {
		if err == nil {
			err = errors.New("device credential remains accepted; automatic replacement is not authorized")
		}
		return DeviceRecoveryView{}, err
	}
	credential, e := recoveryCredential()
	if e != nil {
		return DeviceRecoveryView{}, e
	}
	id, e := desktopOperationID()
	if e != nil {
		return DeviceRecoveryView{}, e
	}
	r = &desktopRecoveryRecord{Version: 1, Purpose: "credential_recovery", OperationID: id, Revision: 1, Phase: "awaiting_confirmation", Hive: state.Hive, Name: state.Name, OldIdentity: state.Identity, OldBinding: recoveryBinding(state), BindingRevision: revision, Credential: credential, Accepted: []desktopRecoveryDecision{}}
	r.fail(err)
	if err = saveDesktopRecovery(s, r); err != nil {
		return DeviceRecoveryView{}, err
	}
	return r.view(), nil
}
func (d *DesktopDevice) RecoveryConfirm(ctx context.Context, id string, revision int64, decision string) (DeviceRecoveryView, error) {
	return d.recoveryOperate(ctx, &desktopRecoveryDecision{id, revision, decision})
}
func (d *DesktopDevice) RecoveryStatus(ctx context.Context) (DeviceRecoveryView, error) {
	return d.recoveryOperate(ctx, nil)
}
func (d *DesktopDevice) recoveryOperate(ctx context.Context, decision *desktopRecoveryDecision) (DeviceRecoveryView, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	s, end, err := d.recoverySession(ctx)
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	defer end()
	r, err := readDesktopRecovery(s)
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	if r == nil || r.Purpose != "credential_recovery" {
		if decision == nil {
			return DeviceRecoveryView{}, recoveryFailure("DEVICE_RECOVERY_NONE", "device_recovery_status", errors.New("no credential recovery transaction exists; prepare explicitly first"))
		}
		return DeviceRecoveryView{}, recoveryFailure("DEVICE_RECOVERY_PRECONDITION", "device_recovery_confirm", errors.New("no credential recovery transaction exists; confirmation requires a prepared transaction"))
	}
	if r.Phase == "completed" {
		if err = d.checkRecoveryBinding(s, r); err != nil {
			return DeviceRecoveryView{}, err
		}
		if decision != nil && !slices.Contains(r.Accepted, *decision) {
			return DeviceRecoveryView{}, errors.New("completed recovery rejects an unaccepted confirmation; refresh the transaction")
		}
		return r.view(), nil
	}
	finish, err := d.recoveryAdmission(s)
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	defer finish()
	if err = d.recoveryOldScope(s, r.OldIdentity, r.Hive); err != nil {
		return DeviceRecoveryView{}, err
	}
	if err = d.checkRecoveryBinding(s, r); err != nil {
		return DeviceRecoveryView{}, err
	}
	if decision != nil {
		if slices.Contains(r.Accepted, *decision) {
			return r.view(), nil
		}
		if decision.OperationID != r.OperationID || decision.ExpectedRevision != r.Revision {
			return DeviceRecoveryView{}, fmt.Errorf("recovery confirmation revision conflict: actual=%d expected=%d operation_match=%t", r.Revision, decision.ExpectedRevision, decision.OperationID == r.OperationID)
		}
		allowed := decision.Decision == "begin_pairing" && r.Phase == "awaiting_confirmation" || decision.Decision == "adopt_owner" && r.Phase == "awaiting_owner_confirmation" || decision.Decision == "renew_expired" && r.Phase == "expired" && !r.RedeemAttempted
		if !allowed {
			return DeviceRecoveryView{}, fmt.Errorf("recovery decision rejected: phase=%s; decision must match the authorized stage", r.Phase)
		}
		if decision.Decision == "adopt_owner" {
			r.ConfirmedOwner = r.NewIdentity.OwnerID
			r.Phase = "saving"
		} else {
			credential, e := recoveryCredential()
			if e != nil {
				return DeviceRecoveryView{}, e
			}
			r.Credential = credential
			r.Pairing = nil
			r.CreateAttempted = true
			r.RedeemAttempted = false
			r.NewIdentity = nil
			r.Phase = "creating"
		}
		r.Accepted = append(r.Accepted, *decision)
		r.Revision++
		r.Failure = nil
		if err = saveDesktopRecovery(s, r); err != nil {
			return DeviceRecoveryView{}, err
		}
		if decision.Decision != "adopt_owner" {
			if err = d.sendRecoveryPairing(ctx, s, r); err != nil {
				return DeviceRecoveryView{}, err
			}
			return r.view(), nil
		}
	}
	if err = d.advanceRecovery(ctx, s, r); err != nil {
		return DeviceRecoveryView{}, err
	}
	return r.view(), nil
}
func (d *DesktopDevice) checkRecoveryBinding(s *desktopDeviceSession, r *desktopRecoveryRecord) error {
	state, err := s.read()
	if err != nil {
		return err
	}
	if r.NewIdentity != nil && state.Credential == r.Credential && state.Identity != nil && *state.Identity == *r.NewIdentity && state.Hive == r.Hive {
		return nil
	}
	if r.Phase == "completed" {
		return errors.New("completed recovery no longer matches the saved new binding; current configuration preserved")
	}
	if r.Purpose == "initial_pairing" {
		if state.Hive == r.Hive && state.Credential == r.Credential && state.Identity == nil {
			return nil
		}
	} else if recoveryBinding(state) == r.OldBinding {
		return nil
	}
	return errors.New("recovery original binding changed; late transaction result rejected and current configuration preserved")
}
func (d *DesktopDevice) createRecoveryPairing(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord) error {
	if err := d.checkRecoveryBinding(s, r); err != nil {
		return err
	}
	if r.CreateAttempted {
		return nil
	}
	r.CreateAttempted = true
	if err := r.change(s, "creating", nil); err != nil {
		return err
	}
	return d.sendRecoveryPairing(ctx, s, r)
}

// Called only by the invocation that durably accepted the creation attempt.
func (d *DesktopDevice) sendRecoveryPairing(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord) error {
	if err := d.checkRecoveryBinding(s, r); err != nil {
		return err
	}
	state := localState{Hive: r.Hive, Name: r.Name, Credential: r.Credential}
	sum := sha256.Sum256([]byte(r.Credential))
	var pair beewire.Pairing
	err := desktopCall(ctx, state, "/api/bee/pairings", http.MethodPost, "", beewire.StartPairing{Name: r.Name, CredentialHash: hex.EncodeToString(sum[:])}, &pair)
	if err == nil {
		err = validateDesktopPairing(state, pair, true)
	}
	if err != nil {
		return r.change(s, "creation_unknown", err)
	}
	r.Pairing = &pair
	if err = r.change(s, "pending", nil); err != nil {
		return err
	}
	if r.Purpose == "initial_pairing" {
		state.Pairing = &pair
		if err = s.save(state); err != nil {
			return err
		}
	}
	return nil
}
func (d *DesktopDevice) advanceRecovery(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord) error {
	if err := d.checkRecoveryBinding(s, r); err != nil {
		return err
	}
	if slices.Contains([]string{"awaiting_confirmation", "awaiting_owner_confirmation", "completed", "blocked", "expired"}, r.Phase) {
		return nil
	}
	state := localState{Hive: r.Hive, Name: r.Name, Credential: r.Credential, Pairing: r.Pairing}
	if r.Phase == "saving" {
		return d.saveRecoveryIdentity(ctx, s, r)
	}
	if r.CreateAttempted && r.Pairing == nil {
		// No request or new observation occurred. Preserve the original failure
		// (including its timestamp) instead of replacing it on every read.
		if r.Phase == "creation_unknown" && r.Failure != nil {
			return nil
		}
		r.Phase = "creation_unknown"
		r.Revision++
		if r.Failure == nil {
			r.fail(errors.New("pairing creation result unknown without token; verify the original request in the Hive console and export diagnostics; existing protocol cannot retrieve its token"))
		}
		return saveDesktopRecovery(s, r)
	}
	if !r.CreateAttempted {
		return r.change(s, "blocked", errors.New("pairing creation was not authorized by a current explicit confirmation; no POST sent"))
	}
	// Identity can prove a successful unknown exchange; a rejection cannot prove
	// that an in-flight transaction did not commit.
	if r.RedeemAttempted {
		var identity beewire.Identity
		err := desktopCall(ctx, state, "/api/bee/identity", http.MethodGet, r.Credential, nil, &identity)
		if err == nil {
			return d.acceptRecoveryIdentity(ctx, s, r, identity)
		}
		// Keep this observation's evidence; recursively embedding prior failures
		// would grow the protected record on every status read until writes fail.
		return r.change(s, "redemption_unknown", fmt.Errorf("pairing result unconfirmed; new credential identity query: %w", err))
	}
	var pair beewire.Pairing
	err := desktopCall(ctx, state, "/api/bee/pairings", http.MethodGet, r.Pairing.PairingToken, nil, &pair)
	if err != nil {
		var failure *apiFailure
		if errors.As(err, &failure) && failure.Status == 410 && failure.Code == "pairing_expired" {
			return r.change(s, "expired", nil)
		}
		r.fail(err)
		r.Revision++
		return saveDesktopRecovery(s, r)
	}
	switch pair.Status {
	case "pending", "draining":
		return r.change(s, pair.Status, nil)
	case "approved":
		r.RedeemAttempted = true
		if err = r.change(s, "redeeming", nil); err != nil {
			return err
		}
		if r.Purpose == "initial_pairing" {
			state.Pairing.Status = "redeeming"
			if err = s.save(state); err != nil {
				return err
			}
		}
		var identity beewire.Identity
		err = desktopCall(ctx, state, "/api/bee/pairings/redeem", http.MethodPost, r.Pairing.PairingToken, struct{}{}, &identity)
		if err == nil {
			return d.acceptRecoveryIdentity(ctx, s, r, identity)
		}
		var failure *apiFailure
		if errors.As(err, &failure) && failure.Status == 409 && failure.Code == "device_draining" {
			r.RedeemAttempted = false
			return r.change(s, "draining", nil)
		}
		if errors.As(err, &failure) && failure.Status == 410 && failure.Code == "pairing_expired" {
			r.RedeemAttempted = false
			return r.change(s, "expired", nil)
		}
		if persist := r.change(s, "redemption_unknown", err); persist != nil {
			return persist
		}
		if e := desktopCall(ctx, state, "/api/bee/identity", http.MethodGet, r.Credential, nil, &identity); e == nil {
			return d.acceptRecoveryIdentity(ctx, s, r, identity)
		} else {
			r.fail(fmt.Errorf("pairing result unconfirmed: %w; identity recovery: %w", err, e))
			r.Revision++
			return saveDesktopRecovery(s, r)
		}
	case "redeemed":
		r.RedeemAttempted = true
		return r.change(s, "redemption_unknown", errors.New("Hive pairing reports redeemed; query the new credential identity before adoption"))
	default:
		return r.change(s, "blocked", fmt.Errorf("pairing status rejected: actual=%s required=pending,draining,approved,redeemed", safeCode(pair.Status)))
	}
}
func (d *DesktopDevice) acceptRecoveryIdentity(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord, identity beewire.Identity) error {
	if err := validateDesktopIdentity(localState{Hive: r.Hive, Credential: r.Credential, Pairing: r.Pairing}, identity); err != nil {
		return r.change(s, "redemption_unknown", err)
	}
	if r.OldIdentity != nil && identity.ID == r.OldIdentity.ID {
		return r.change(s, "blocked", errors.New("recovery new device ID matches the original device; a distinct verified device scope is required"))
	}
	r.NewIdentity = &identity
	if r.OldIdentity != nil && r.OldIdentity.OwnerID != identity.OwnerID && r.ConfirmedOwner != identity.OwnerID {
		return r.change(s, "awaiting_owner_confirmation", nil)
	}
	r.ConfirmedOwner = identity.OwnerID
	if err := r.change(s, "saving", nil); err != nil {
		return err
	}
	return d.saveRecoveryIdentity(ctx, s, r)
}
func (d *DesktopDevice) saveRecoveryIdentity(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord) error {
	if err := d.checkRecoveryBinding(s, r); err != nil {
		return err
	}
	state := localState{Hive: r.Hive, Name: r.Name, Credential: r.Credential}
	var identity beewire.Identity
	if err := desktopCall(ctx, state, "/api/bee/identity", http.MethodGet, r.Credential, nil, &identity); err != nil {
		r.fail(err)
		r.Revision++
		return saveDesktopRecovery(s, r)
	}
	if r.NewIdentity == nil || identity != *r.NewIdentity || r.ConfirmedOwner != identity.OwnerID {
		return errors.New("new device identity changed before protected save; adoption blocked")
	}
	state.Identity = &identity
	if err := s.save(state); err != nil {
		return err
	}
	if d.runtime != nil {
		rt := d.runtime
		rt.mu.Lock()
		reset := DesktopNetworkConfig{Revision: rt.network.Revision + 1}
		rt.network = reset
		rt.targets = map[string]bool{}
		rt.snapshot.NetworkRevision = reset.Revision
		rt.snapshot.Revision++
		rt.snapshot.RunID = nil
		rt.snapshot.Operation = nil
		rt.snapshot.Connection = "disconnected"
		rt.snapshot.ConnectionDetail = nil
		rt.ownedSession = nil
		rt.retiredAccountSession = nil
		rt.runCancel = nil
		rt.runDone = nil
		rt.controlCancel = nil
		rt.controlDone = nil
		for platform := range rt.snapshot.Platforms {
			rt.snapshot.Platforms[platform] = DesktopRuntimePlatform{Account: initialAccountSnapshot(platform)}
		}
		rt.mu.Unlock()
		if err := rt.accounts.ConfigureNetwork(ctx, reset); err != nil {
			return err
		}
		for _, platform := range []string{"openai", "claude"} {
			p, release, err := rt.accounts.acquire(ctx, platform)
			if err != nil {
				return err
			}
			gate := p.gate
			features := p.snapshot.Features
			snapshot := initialAccountSnapshot(platform)
			snapshot.Features = features
			*p = desktopAccountPlatform{gate: gate, snapshot: snapshot}
			release()
		}
	}

	return r.change(s, "completed", nil)
}

func (r *desktopRecoveryRecord) initialUnsubmitted() bool {
	return r.Purpose == "initial_pairing" && r.Phase == "awaiting_confirmation" && !r.CreateAttempted && !r.RedeemAttempted && r.Pairing == nil && r.NewIdentity == nil && r.ConfirmedOwner == "" && len(r.Accepted) == 0
}

func (d *DesktopDevice) initialRecoveryOperate(ctx context.Context, s *desktopDeviceSession, state localState, r *desktopRecoveryRecord, begin bool) (DeviceView, error) {
	if r != nil && r.Purpose != "initial_pairing" {
		return DeviceView{}, errors.New("credential recovery already occupies the device transaction")
	}
	if r == nil {
		id, err := desktopOperationID()
		if err != nil {
			return DeviceView{}, err
		}
		_, revision, err := s.readBinding()
		if err != nil {
			return DeviceView{}, err
		}
		r = &desktopRecoveryRecord{Version: 1, Purpose: "initial_pairing", OperationID: id, Revision: 1, Phase: "creating", Hive: state.Hive, Name: state.Name, Credential: state.Credential, BindingRevision: revision, Accepted: []desktopRecoveryDecision{}}
		if state.Pairing != nil {
			r.Pairing = state.Pairing
			r.CreateAttempted = true
			r.Phase = "pending"
			if state.Pairing.Status == "redeeming" {
				r.RedeemAttempted = true
				r.Phase = "redemption_unknown"
			}
		} else {
			r.CreateAttempted = true
			r.Phase = "creation_unknown"
		}
		if err = saveDesktopRecovery(s, r); err != nil {
			return DeviceView{}, err
		}
	}
	if r.Phase == "expired" && begin && !r.RedeemAttempted {
		r.Pairing = nil
		r.CreateAttempted = false
		r.Phase = "creating"
		if err := r.change(s, "creating", nil); err != nil {
			return DeviceView{}, err
		}
	}
	if !r.CreateAttempted && begin {
		if err := d.createRecoveryPairing(ctx, s, r); err != nil {
			return DeviceView{}, err
		}
	} else {
		if err := d.advanceRecovery(ctx, s, r); err != nil {
			return DeviceView{}, err
		}
	}
	if r.Phase == "expired" && r.Pairing != nil {
		pair := *r.Pairing
		state.Pairing = &pair
		state.Pairing.Status = "pending"
		state.Pairing.ExpiresAt = time.Time{}
		if err := s.save(state); err != nil {
			return DeviceView{}, err
		}
	}
	return initialRecoveryView(r, state), nil
}

func initialRecoveryView(r *desktopRecoveryRecord, state localState) DeviceView {
	view := r.view()
	switch r.Phase {
	case "completed":
		return DeviceView{State: "bound", Hive: r.Hive, Name: r.NewIdentity.Name, Identity: r.NewIdentity, Recovery: &view}
	case "pending", "draining":
		state.Pairing = r.Pairing
		device := desktopPairingView(state, r.Phase)
		device.Recovery = &view
		return device
	case "expired":
		return DeviceView{State: "expired", Hive: r.Hive, Name: r.Name, Recovery: &view}
	default:
		return DeviceView{State: "pairing", Hive: r.Hive, Name: r.Name, Recovery: &view}
	}
}

// Short admission reservation for a device supply write. Recovery rejects while
// any admitted writer can still send; no ordinary mutex spans its HTTP calls.
func (d *DesktopDevice) beginDeviceWrite(ctx context.Context) (func(), error) {
	if d.runtime != nil {
		d.runtime.accounts.lifecycleMu.Lock()
		defer d.runtime.accounts.lifecycleMu.Unlock()
	}
	s, release, err := d.acquireSession(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	if err = recoveryWriteBarrierLocked(s); err != nil {
		s.mu.Unlock()
		release()
		return nil, err
	}
	s.deviceWrites++
	s.mu.Unlock()
	return func() { s.mu.Lock(); s.deviceWrites--; s.mu.Unlock(); release() }, nil
}

func (d *DesktopDevice) recoveryOldScope(s *desktopDeviceSession, identity *beewire.Identity, hive string) error {
	if d.runtime != nil {
		d.runtime.accounts.storageMu.Lock()
		defer d.runtime.accounts.storageMu.Unlock()
	}
	path := filepath.Join(filepath.Dir(s.path), "ai-accounts.json")
	unlock, err := lockState(path)
	if err != nil {
		return fmt.Errorf("lock original account scope before recovery: %w", err)
	}
	defer unlock()
	disk, err := readDesktopAccountState(path)
	if err != nil {
		return err
	}
	if identity != nil {
		if scope, ok := disk.Scopes[desktopScopeKey(hive, identity.OwnerID, identity.ID)]; ok {
			if len(scope.PendingOperations) > 0 || scope.Session.Active || !scope.Session.Clean {
				return fmt.Errorf("original account scope blocks recovery: pending=%d active=%t clean=%t; reconcile the original operations without clearing them", len(scope.PendingOperations), scope.Session.Active, scope.Session.Clean)
			}
		}
	}
	guard, err := readDesktopAccountBytes(filepath.Join(filepath.Dir(s.path), "runtime-session"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read runtime guard before recovery: %w", err)
	}
	if err == nil && !bytes.Equal(guard, []byte("clean\n")) {
		return errors.New("runtime recovery guard is not clean; stopped worker ownership must be proven before device recovery")
	}
	return nil
}
