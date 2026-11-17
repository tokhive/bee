package bee

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

type desktopPairingProtocol struct {
	DecisionRevision int64                   `json:"decision_revision"`
	ReplacedDeviceID string                  `json:"replaced_device_id"`
	Version          int                     `json:"version"`
	OperationID      string                  `json:"operation_id"`
	AttemptID        string                  `json:"attempt_id"`
	Input            beewire.PairingAttempt  `json:"input"`
	Deadline         time.Time               `json:"deadline"`
	Failures         int                     `json:"failures"`
	Replayed         bool                    `json:"replayed"`
	Restart          bool                    `json:"restart"`
	Legacy           bool                    `json:"legacy"`
	Cancel           bool                    `json:"cancel"`
	OriginalFailure  *DesktopRecoveryFailure `json:"original_failure"`
	History          []string                `json:"history"`
}

func pairingProtocolPath(s *desktopDeviceSession, id string) string {
	return filepath.Join(filepath.Dir(s.path), "bee-pairing-"+id+".json")
}
func readPairingProtocol(s *desktopDeviceSession, r *desktopRecoveryRecord) (*desktopPairingProtocol, error) {
	raw, err := readDesktopAccountBytes(pairingProtocolPath(s, r.OperationID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var p desktopPairingProtocol
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = uniqueAccountJSON(json.NewDecoder(bytes.NewReader(raw))); err != nil {
		return nil, err
	}
	if err = decoder.Decode(&p); err != nil {
		return nil, fmt.Errorf("decode protected pairing protocol: %w", err)
	}
	if p.Version != 1 || p.OperationID != r.OperationID || p.DecisionRevision < 0 || p.DecisionRevision > r.Revision || !desktopHexID(p.AttemptID, 24) || !pairingTokenPattern.MatchString(p.Input.PairingToken) || !userCodePattern.MatchString(p.Input.UserCode) || p.Input.Name != r.Name || p.Failures < 0 || p.Failures > 4 || p.History == nil || len(p.History) > 128 {
		return nil, errors.New("pairing protocol record rejected; original evidence retained")
	}
	expectedDevice, expectedOwner := "", ""
	if r.OldIdentity != nil {
		expectedDevice = r.OldIdentity.ID
		expectedOwner = r.OldIdentity.OwnerID
	}
	if p.Input.Recovery != (r.Purpose != "initial_pairing") || p.Input.ExpectedDeviceID != expectedDevice || p.Input.ExpectedOwnerID != expectedOwner || p.Deadline.IsZero() {
		return nil, errors.New("protected pairing authorization or observation deadline differs from original recovery; evidence retained")
	}
	seen := map[string]bool{p.AttemptID: true}
	for _, id := range p.History {
		if !desktopHexID(id, 24) || seen[id] {
			return nil, errors.New("protected pairing history has an invalid or duplicate attempt; evidence retained")
		}
		seen[id] = true
	}
	return &p, nil
}
func savePairingProtocol(s *desktopDeviceSession, p *desktopPairingProtocol) error {
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return writePrivateFile(pairingProtocolPath(s, p.OperationID), append(raw, '\n'), ".bee-pairing-*")
}
func pairingCapabilities(ctx context.Context, r *desktopRecoveryRecord) error {
	var capabilities struct {
		Version         int `json:"version"`
		PairingRecovery int `json:"pairing_recovery"`
	}
	err := desktopCall(ctx, localState{Hive: r.Hive}, beewire.PairingRecoveryCapabilitiesPath, http.MethodGet, "", nil, &capabilities)
	if err != nil {
		return fmt.Errorf("check Hive pairing recovery capability: %w; upgrade Hive before generating a new pairing code", err)
	}
	if capabilities.Version != 1 || capabilities.PairingRecovery != 1 {
		return fmt.Errorf("Hive pairing recovery capability rejected: version=%d recovery=%d; required=1,1; upgrade Hive", capabilities.Version, capabilities.PairingRecovery)
	}
	return nil
}
func newPairingProtocol(r *desktopRecoveryRecord) (*desktopPairingProtocol, error) {
	id, err := desktopOperationID()
	if err != nil {
		return nil, err
	}
	token, err := recoveryCredential()
	if err != nil {
		return nil, err
	}
	var code [5]byte
	if _, err = rand.Read(code[:]); err != nil {
		return nil, err
	}
	text := base32.NewEncoding("ABCDEFGHJKLMNPQRSTUVWXYZ23456789").EncodeToString(code[:])
	p := &desktopPairingProtocol{Version: 1, OperationID: r.OperationID, AttemptID: id, Input: beewire.PairingAttempt{Name: r.Name, PairingToken: "beep_" + strings.TrimPrefix(token, "bee_"), UserCode: text[:4] + "-" + text[4:], Recovery: r.Purpose != "initial_pairing"}, Deadline: time.Now().Add(time.Minute), History: []string{}}
	p.OriginalFailure = r.Failure
	if r.OldIdentity != nil {
		p.Input.ExpectedDeviceID = r.OldIdentity.ID
		p.Input.ExpectedOwnerID = r.OldIdentity.OwnerID
	}
	return p, nil
}
func (d *DesktopDevice) sendProtocolPairing(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord) error {
	if err := pairingCapabilities(ctx, r); err != nil {
		return r.change(s, "creation_unknown", err)
	}
	p, err := readPairingProtocol(s, r)
	if err != nil {
		return err
	}
	if p == nil {
		p, err = newPairingProtocol(r)
		if err != nil {
			return err
		}
		if err = savePairingProtocol(s, p); err != nil {
			return err
		}
	}
	var out beewire.PairingRecoveryStatus
	err = desktopCall(ctx, localState{Hive: r.Hive}, beewire.PairingRecoveryPath+p.AttemptID+"/begin", http.MethodPost, r.Credential, p.Input, &out)
	if err != nil {
		if p.OriginalFailure == nil {
			r.fail(err)
			p.OriginalFailure = r.Failure
			if e := savePairingProtocol(s, p); e != nil {
				return e
			}
		}
		return r.change(s, "creation_unknown", err)
	}
	return d.acceptPairingProtocol(ctx, s, r, p, out, false)
}
func (d *DesktopDevice) acceptPairingProtocol(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord, p *desktopPairingProtocol, out beewire.PairingRecoveryStatus, advance bool) error {
	if out.Version != 1 || out.AttemptID != p.AttemptID || out.ObservedAt.IsZero() || out.Blockers == nil || !slices.Contains([]string{"pending", "approved", "draining", "completed", "expired", "closed", "cancelled"}, out.State) {
		return rejectPairingProtocol(s, r, p, errors.New("Hive pairing result schema or original attempt identity rejected; original request retained"))
	}
	if out.Pairing != nil {
		pair := *out.Pairing
		pair.PairingToken = p.Input.PairingToken
		pair.UserCode = p.Input.UserCode
		pair.Status = "pending"
		if err := validateDesktopPairing(localState{Hive: r.Hive}, pair, false); err != nil {
			return rejectPairingProtocol(s, r, p, err)
		}
		r.Pairing = &pair
	}
	if r.OldIdentity != nil && out.ReplacedDeviceID != "" && out.ReplacedDeviceID != r.OldIdentity.ID {
		return rejectPairingProtocol(s, r, p, errors.New("Hive confirmed a different old device; preserved local identity conflicts with recovery authorization"))
	}
	if out.State == "completed" {
		if out.Identity == nil {
			return rejectPairingProtocol(s, r, p, errors.New("completed pairing result omitted original identity"))
		}
		if p.ReplacedDeviceID != "" && p.ReplacedDeviceID != out.ReplacedDeviceID {
			return rejectPairingProtocol(s, r, p, errors.New("completed recovery old device changed; original proof retained"))
		}
		p.ReplacedDeviceID = out.ReplacedDeviceID
		if err := savePairingProtocol(s, p); err != nil {
			return err
		}
		r.RedeemAttempted = true
		return d.acceptRecoveryIdentity(ctx, s, r, *out.Identity)
	}
	if out.State == "cancelled" || out.State == "closed" {
		return r.change(s, "blocked", recoveryFailure("PAIRING_CLOSED", "pairing_recovery", errors.New("original pairing ended; confirmed old device remains stopped; no replacement was reported")))
	}
	if out.State == "expired" {
		r.RedeemAttempted = false
		return r.change(s, "expired", nil)
	}
	if len(out.Blockers) > 0 {
		parts := make([]string, 0, len(out.Blockers))
		manual := false
		for _, b := range out.Blockers {
			parts = append(parts, fmt.Sprintf("%s %s: %s", b.Kind, b.ID, b.Reason))
			manual = manual || b.Manual
		}
		code := "PAIRING_WORK_PENDING"
		if manual {
			code = "PAIRING_ADMIN_REQUIRED"
		}
		return r.change(s, "draining", recoveryFailure(code, "pairing_work", fmt.Errorf("Hive old device %s is blocked: %s; no total wait bound is known", out.ReplacedDeviceID, strings.Join(parts, "; "))))
	}
	if advance && (out.State == "approved" || out.State == "draining") {
		var next beewire.PairingRecoveryStatus
		r.RedeemAttempted = true
		if err := r.change(s, "redeeming", nil); err != nil {
			return err
		}
		if err := desktopCall(ctx, localState{Hive: r.Hive}, beewire.PairingRecoveryPath+p.AttemptID+"/advance", http.MethodPost, r.Credential, struct{}{}, &next); err != nil {
			if e := r.change(s, "redemption_unknown", err); e != nil {
				return e
			}
			var observed beewire.PairingRecoveryStatus
			if e := desktopCall(ctx, localState{Hive: r.Hive}, beewire.PairingRecoveryPath+p.AttemptID, http.MethodGet, r.Credential, nil, &observed); e == nil && observed.State == "completed" {
				return d.acceptPairingProtocol(ctx, s, r, p, observed, false)
			}
			return nil
		}
		return d.acceptPairingProtocol(ctx, s, r, p, next, false)
	}
	phase := out.State
	if phase == "approved" {
		phase = "pending"
	}
	return r.change(s, phase, nil)
}
func (d *DesktopDevice) advancePairingProtocol(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord, p *desktopPairingProtocol) error {
	if decision := latestProtocolDecision(r); decision != nil && decision.ExpectedRevision >= p.DecisionRevision {
		return d.pairingDecision(ctx, s, r, decision.Decision)
	}
	if r.Phase == "blocked" && !p.Cancel && !p.Restart {
		return nil
	}
	if r.Failure != nil && r.Failure.Code == "PAIRING_CLOSED" && !p.Restart {
		return nil
	}
	if time.Now().After(p.Deadline) || p.Failures >= 4 {
		if r.Phase == "blocked" {
			return nil // Keep the rejected proof visible; only an explicit decision starts another round.
		}
		if r.Failure != nil && r.Failure.Code == "PAIRING_OBSERVATION_PAUSED" {
			return nil
		}
		return r.change(s, r.Phase, recoveryFailure("PAIRING_OBSERVATION_PAUSED", "pairing_observation", errors.New("automatic pairing observation paused: round deadline or query retry budget exhausted; continue checking the same request explicitly")))
	}
	if p.Restart {
		return d.restartProtocolPairing(ctx, s, r, p)
	}
	if p.Cancel {
		var out beewire.PairingRecoveryStatus
		path := beewire.PairingRecoveryPath + p.AttemptID + "/cancel"
		var input any = struct{}{}
		if p.Legacy {
			path = beewire.PairingLegacyPath + "/close"
			input = struct {
				ID string `json:"id"`
			}{p.AttemptID}
		}
		if err := desktopCall(ctx, localState{Hive: r.Hive}, path, http.MethodPost, r.Credential, input, &out); err != nil {
			return pairingProtocolFailure(s, r, p, err)
		}
		if p.Legacy && out.Version == 1 && out.AttemptID == p.AttemptID && out.State == "completed" && out.Identity != nil {
			return d.acceptRecoveryIdentity(ctx, s, r, *out.Identity)
		}
		return d.acceptPairingProtocol(ctx, s, r, p, out, false)
	}
	if p.Legacy {
		return d.observeLegacyPairing(ctx, s, r)
	}

	var out beewire.PairingRecoveryStatus
	err := desktopCall(ctx, localState{Hive: r.Hive}, beewire.PairingRecoveryPath+p.AttemptID, http.MethodGet, r.Credential, nil, &out)
	if err != nil {
		var remote *apiFailure
		if errors.As(err, &remote) && remote.Status == 404 && remote.Code == "pairing_attempt_not_found" && !p.Replayed {
			p.Replayed = true
			if err = savePairingProtocol(s, p); err != nil {
				return err
			}
			return d.sendProtocolPairing(ctx, s, r)
		}
		return pairingProtocolFailure(s, r, p, err)
	}
	return d.acceptPairingProtocol(ctx, s, r, p, out, true)
}

// An explicit restart closes the old scope durably before publishing new codes.
func (d *DesktopDevice) restartProtocolPairing(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord, p *desktopPairingProtocol) error {
	var out beewire.PairingRecoveryStatus
	path := beewire.PairingRecoveryPath + p.AttemptID + "/close"
	if p.Legacy {
		path = beewire.PairingLegacyPath + "/close"
	}
	var input any = struct{}{}
	if p.Legacy {
		input = struct {
			ID string `json:"id"`
		}{p.AttemptID}
	}
	err := desktopCall(ctx, localState{Hive: r.Hive}, path, http.MethodPost, r.Credential, input, &out)
	if err != nil {
		return pairingProtocolFailure(s, r, p, err)
	}
	if out.Version != 1 || out.AttemptID != p.AttemptID {
		return rejectPairingProtocol(s, r, p, errors.New("original closure proof identity rejected; no new pairing sent"))
	}
	if out.State == "completed" && out.Identity != nil {
		if !p.Legacy {
			return d.acceptPairingProtocol(ctx, s, r, p, out, false)
		}
		return d.acceptRecoveryIdentity(ctx, s, r, *out.Identity)
	}
	if out.State != "closed" && out.State != "cancelled" {
		return rejectPairingProtocol(s, r, p, fmt.Errorf("original pairing closure unproven: state=%s; no new pairing sent", safeCode(out.State)))
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	archived := filepath.Join(filepath.Dir(s.path), "bee-pairing-"+p.OperationID+"-"+p.AttemptID+".json")
	if err = writePrivateFile(archived, raw, ".bee-pairing-history-*"); err != nil {
		return err
	}
	next, err := newPairingProtocol(r)
	if err != nil {
		return err
	}
	next.History = append(append([]string{}, p.History...), p.AttemptID)
	next.DecisionRevision = p.DecisionRevision
	if len(next.History) > 128 {
		return errors.New("pairing history capacity reached; original evidence retained")
	}
	if err = savePairingProtocol(s, next); err != nil {
		return err
	}
	r.Pairing = nil
	r.RedeemAttempted = false
	r.NewIdentity = nil
	r.CreateAttempted = true
	if err = r.change(s, "creating", nil); err != nil {
		return err
	}
	return d.sendProtocolPairing(ctx, s, r)
}
func (d *DesktopDevice) pairingDecision(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord, decision string) error {
	p, err := readPairingProtocol(s, r)
	if err != nil {
		return err
	}
	if p == nil {
		p, err = newPairingProtocol(r)
		if err != nil {
			return err
		}
		p.Legacy = true
	}
	switch decision {
	case "continue_checking":
		p.Deadline = time.Now().Add(time.Minute)
		p.Failures = 0
	case "restart_pairing", "renew_expired":
		p.Deadline = time.Now().Add(time.Minute)
		p.Failures = 0
		p.Restart = true
		p.Cancel = false
	case "cancel_pairing":
		p.Deadline = time.Now().Add(time.Minute)
		p.Failures = 0
		p.Cancel = true
		p.Restart = false
	}
	if r.Phase == "blocked" {
		phase := "creation_unknown"
		if r.Pairing != nil {
			phase = "pending"
		}
		if err = r.change(s, phase, nil); err != nil {
			return err
		}
	}
	p.DecisionRevision = r.Revision
	if err = savePairingProtocol(s, p); err != nil {
		return err
	}
	return d.advancePairingProtocol(ctx, s, r, p)
}

func latestProtocolDecision(r *desktopRecoveryRecord) *desktopRecoveryDecision {
	for i := len(r.Accepted) - 1; i >= 0; i-- {
		if slices.Contains([]string{"continue_checking", "restart_pairing", "renew_expired", "cancel_pairing"}, r.Accepted[i].Decision) {
			return &r.Accepted[i]
		}
	}
	return nil
}
func (d *DesktopDevice) observeLegacyPairing(ctx context.Context, s *desktopDeviceSession, r *desktopRecoveryRecord) error {
	p, err := readPairingProtocol(s, r)
	if err != nil {
		return err
	}
	if p == nil {
		p, err = newPairingProtocol(r)
		if err != nil {
			return err
		}
		p.Legacy = true
		if err = savePairingProtocol(s, p); err != nil {
			return err
		}
	}
	if !p.Legacy {
		return errors.New("legacy observation cannot replace a modern original attempt")
	}
	if time.Now().After(p.Deadline) || p.Failures >= 4 {
		return r.change(s, r.Phase, recoveryFailure("PAIRING_OBSERVATION_PAUSED", "pairing_observation", errors.New("legacy original observation paused; explicitly continue checking the original request")))
	}

	var out beewire.PairingRecoveryStatus
	if err := desktopCall(ctx, localState{Hive: r.Hive}, beewire.PairingLegacyPath, http.MethodGet, r.Credential, nil, &out); err != nil {
		return pairingProtocolFailure(s, r, p, err)
	}
	if out.Version != 1 || out.AttemptID != "" {
		return rejectPairingProtocol(s, r, p, errors.New("legacy pairing recovery proof rejected; original files retained"))
	}
	if out.State == "completed" && out.Identity != nil {
		return d.acceptRecoveryIdentity(ctx, s, r, *out.Identity)
	}
	if out.State == "unknown" {
		if r.Failure != nil && r.Failure.Code == "PAIRING_LEGACY_UNRESOLVED" {
			return nil
		}
		return r.change(s, "creation_unknown", recoveryFailure("PAIRING_LEGACY_UNRESOLVED", "pairing_legacy", errors.New("original pairing unconfirmed without token; Hive has not reported a successful original binding; explicitly restart pairing to close old requests before creating a new code")))
	}
	return rejectPairingProtocol(s, r, p, fmt.Errorf("original legacy result requires administrator review: state=%s; original credential retained", safeCode(out.State)))
}

func rejectPairingProtocol(s *desktopDeviceSession, r *desktopRecoveryRecord, p *desktopPairingProtocol, cause error) error {
	p.Failures = 4
	if err := savePairingProtocol(s, p); err != nil {
		return err
	}
	return r.change(s, "blocked", recoveryFailure("PAIRING_ADMIN_REQUIRED", "pairing_proof", cause))
}

func pairingProtocolFailure(s *desktopDeviceSession, r *desktopRecoveryRecord, p *desktopPairingProtocol, cause error) error {
	p.Failures++
	var remote *apiFailure
	if errors.As(cause, &remote) && (remote.Status < 500 && remote.Status != 408 && remote.Status != 429 || remote.Status == 501 || remote.Status == 505) {
		p.Failures = 4
	}
	if p.Failures > 4 {
		p.Failures = 4
	}
	if err := savePairingProtocol(s, p); err != nil {
		return err
	}
	return r.change(s, r.Phase, cause)
}
