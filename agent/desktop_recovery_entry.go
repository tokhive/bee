package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/tokhive/bee/beewire"
)

func recoveryFileDigest(path string) (string, error) {
	raw, err := readDesktopAccountBytes(path)
	if errors.Is(err, os.ErrNotExist) {
		raw = nil
		err = nil
	}
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// Preserve protected originals before repair; never remove account histories.
func preserveRecoveryEvidence(s *desktopDeviceSession) error {
	evidence := map[string][]byte{}
	for _, name := range []string{filepath.Base(s.path), "bee-desktop-recovery.json", "runtime-session", "ai-accounts.json"} {
		raw, err := readDesktopAccountBytes(filepath.Join(filepath.Dir(s.path), name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("preserve recovery evidence file=%s: %w", name, err)
		}
		evidence[name] = raw
	}
	raw, err := json.Marshal(evidence)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(raw)
	return writePrivateFile(filepath.Join(filepath.Dir(s.path), "bee-recovery-evidence-"+hex.EncodeToString(sum[:])+".json"), raw, ".bee-evidence-*")
}

// RecoveryAt is an explicit entry independent of parsing the device configuration.
// The supplied address is never inferred from untrusted fragments of damaged JSON.
func (d *DesktopDevice) RecoveryAt(ctx context.Context, hive, name string) (DeviceRecoveryView, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	origin, err := hiveOrigin(hive)
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return DeviceRecoveryView{}, errors.New("recovery name requires 1..80 characters without controls")
	}
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
	original, recordErr := readDesktopRecovery(s)
	if recordErr == nil && original != nil && original.Hive != origin {
		return DeviceRecoveryView{}, errors.New("protected original recovery belongs to another Hive; retain and reconcile original transaction")
	}
	if recordErr == nil && original != nil && original.Phase != "completed" {
		if err = d.checkRecoveryBinding(s, original); err == nil {
			return original.view(), nil
		}
	}
	state, stateErr := s.read()
	if stateErr == nil && state.Hive != "" && state.Hive != origin {
		return DeviceRecoveryView{}, errors.New("saved Hive address differs from confirmed recovery address; original binding retained")
	}
	// A complete protected recovery record may retain the original secret even
	// when the ordinary configuration has been damaged or lost.
	candidates := []localState{}
	if stateErr == nil && state.Hive == origin && deviceCredentialPattern.MatchString(state.Credential) {
		candidates = append(candidates, state)
	}
	if recordErr == nil && original != nil && original.Hive == origin {
		candidate := localState{Hive: origin, Name: original.Name, Credential: original.Credential, Identity: original.NewIdentity}
		if candidate.Identity == nil && original.Purpose == "initial_pairing" {
			candidate.Identity = original.OldIdentity
		}
		candidates = append(candidates, candidate)
	}
	for _, candidate := range candidates {
		var identity beewire.Identity
		e := desktopCall(ctx, candidate, "/api/bee/identity", http.MethodGet, candidate.Credential, nil, &identity)
		if e != nil {
			var remote *apiFailure
			if errors.As(e, &remote) && remote.Status == 401 && (remote.Code == "device_replaced" || remote.Code == "invalid_device_credential") {
				continue
			}
			return DeviceRecoveryView{}, e // network/address/version faults cannot authorize replacement
		}
		if e = validateDesktopIdentity(candidate, identity); e != nil {
			return DeviceRecoveryView{}, e
		}
		if e = preserveRecoveryEvidence(s); e != nil {
			return DeviceRecoveryView{}, e
		}
		candidate.Name = identity.Name
		candidate.Identity = &identity
		candidate.Pairing = nil
		if e = s.save(candidate); e != nil {
			return DeviceRecoveryView{}, e
		}
		if recordErr == nil && original != nil && original.Credential == candidate.Credential {
			original.NewIdentity = &identity
			original.ConfirmedOwner = identity.OwnerID
			if e = original.change(s, "completed", nil); e != nil {
				return DeviceRecoveryView{}, e
			}
			return original.view(), nil
		}
		id, e := desktopOperationID()
		if e != nil {
			return DeviceRecoveryView{}, e
		}
		r := &desktopRecoveryRecord{Version: 1, Purpose: "local_recovery", OperationID: id, Revision: 1, Phase: "completed", Hive: origin, Name: candidate.Name, Credential: candidate.Credential, NewIdentity: &identity, ConfirmedOwner: identity.OwnerID, Accepted: []desktopRecoveryDecision{}}
		if e = saveDesktopRecovery(s, r); e != nil {
			return DeviceRecoveryView{}, e
		}
		return r.view(), nil
	}
	if recordErr == nil && original != nil && original.Phase != "completed" {
		if err = preserveRecoveryEvidence(s); err != nil {
			return DeviceRecoveryView{}, err
		}
		digest, e := recoveryFileDigest(s.path)
		if e != nil {
			return DeviceRecoveryView{}, e
		}
		marker, _ := json.Marshal(map[string]string{"operation_id": original.OperationID, "source_digest": digest})
		if e = writePrivateFile(filepath.Join(filepath.Dir(s.path), "bee-recovery-source.json"), marker, ".bee-source-*"); e != nil {
			return DeviceRecoveryView{}, e
		}
		return original.view(), nil
	}
	if err = pairingCapabilities(ctx, &desktopRecoveryRecord{Hive: origin}); err != nil {
		return DeviceRecoveryView{}, err
	}
	if err = preserveRecoveryEvidence(s); err != nil {
		return DeviceRecoveryView{}, err
	}
	credential, err := recoveryCredential()
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	id, err := desktopOperationID()
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	digest, err := recoveryFileDigest(s.path)
	if err != nil {
		return DeviceRecoveryView{}, err
	}
	r := &desktopRecoveryRecord{Version: 1, Purpose: "local_recovery", OperationID: id, Revision: 1, Phase: "awaiting_confirmation", Hive: origin, Name: name, OldBinding: digest, Credential: credential, Accepted: []desktopRecoveryDecision{}}
	if stateErr == nil && state.Identity != nil && validateDesktopIdentity(localState{Credential: credential}, *state.Identity) == nil {
		r.OldIdentity = state.Identity
	} else if recordErr == nil && original != nil && original.NewIdentity != nil {
		r.OldIdentity = original.NewIdentity
	}
	if recordErr != nil {
		r.Phase = "blocked"
		r.fail(recoveryFailure("RECOVERY_EVIDENCE_UNRESOLVED", "recovery_original_record", errors.New("protected original recovery record is damaged; original request cannot be attributed; saved evidence requires Hive administrator review before another pairing")))
	}
	if err = saveDesktopRecovery(s, r); err != nil {
		return DeviceRecoveryView{}, err
	}
	return r.view(), nil
}

// The final Hive replacement proves this exact old device was fenced and its
// connection joined. recoveryAdmission has independently joined local workers.
// Retain old account operations as history; never transfer their intent.
func retirePairingRecoveryGuard(s *desktopDeviceSession, r *desktopRecoveryRecord, p *desktopPairingProtocol) error {
	path := filepath.Join(filepath.Dir(s.path), "runtime-session")
	guard, err := readDesktopAccountBytes(path)
	if errors.Is(err, os.ErrNotExist) || err == nil && string(guard) == "clean\n" {
		return nil
	}
	if err != nil {
		return err
	}
	if p == nil || p.ReplacedDeviceID == "" || r.NewIdentity == nil {
		return errors.New("old runtime guard lacks a completed replacement proof; Hive administrator must attribute the original run")
	}
	disk, err := readDesktopAccountState(filepath.Join(filepath.Dir(s.path), "ai-accounts.json"))
	if err != nil {
		return err
	}
	scope, ok := disk.Scopes[desktopScopeKey(r.Hive, r.NewIdentity.OwnerID, p.ReplacedDeviceID)]
	if !ok || scope.Session.RunID == "" || string(guard) != scope.Session.RunID+"\n" {
		return errors.New("old runtime guard does not match the replaced Hive/owner/device run; Hive administrator must attribute preserved evidence")
	}
	if err = preserveRecoveryEvidence(s); err != nil {
		return err
	}
	return writePrivateFile(path, []byte("clean\n"), ".bee-runtime-*")
}
