package bee

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
)

// The preparation envelope is opt-in, preserving the existing supply DTO.
type desktopSupplyPreparation struct {
	ID                 string `json:"id"`
	Action             string `json:"action"`
	AccountFingerprint string `json:"account_fingerprint"`
	Lease              string `json:"lease,omitempty"`
	AccountGeneration  int64  `json:"account_generation,omitempty"`
	CredentialRevision string `json:"credential_revision,omitempty"`
}

// Each new connection must finish preparation before its newly uploaded
// credentials can admit work. Persist a fresh ID only after the previous ID
// is proven completed; an uncertain/active ID is always recovered in place.
func (r *DesktopRuntime) prepareConnectionSupply(ctx context.Context, state localState, platform string, slot *desktopRuntimeSlot) error {
	if slot.selection.PreparationID == "" {
		return nil
	} // Legacy/manual-login flow.
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return err
	}
	scope, err := r.accounts.selectionScope(session, state, nil)
	release()
	if err != nil {
		return err
	}
	selected := scope.Selections[platform]
	if selected.Revision != slot.selection.Revision || selected.Fingerprint != slot.selection.Fingerprint || selected.PreparationID == "" {
		return fmt.Errorf("connection preparation selection differs from durable scope; synchronization blocked")
	}
	// Adopt only read-back evidence, including a rename whose fsync/readback
	// failed after the new intent had actually reached disk.
	slot.selection.PreparationID = selected.PreparationID
	id := slot.selection.PreparationID
	status, err := desktopPreparationCall(ctx, state, platform, id, nil)
	if err != nil {
		return err
	}
	if status == "completed" || status == "cancelled" {
		var raw [24]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return fmt.Errorf("connection preparation ID generation failed: %w", err)
		}
		next := hex.EncodeToString(raw[:])
		session, release, err := r.device.acquireSession(ctx)
		if err != nil {
			return err
		}
		_, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
			selected := s.Selections[platform]
			if selected.Revision != slot.selection.Revision || selected.PreparationID != id || selected.Fingerprint != slot.selection.Fingerprint {
				return fmt.Errorf("connection preparation selection changed before durable intent; original ID retained")
			}
			selected.PreparationID = next
			s.Selections[platform] = selected
			return nil
		})
		release()
		if err != nil {
			return err
		}
		slot.selection.PreparationID = next
		id = next
	}
	return ensureDesktopPreparation(ctx, state, platform, desktopSupplyPreparation{ID: id, Action: "begin", AccountFingerprint: slot.selection.Fingerprint}, "active")
}

func desktopPreparationCall(ctx context.Context, state localState, platform, id string, input *desktopSupplyPreparation) (string, error) {
	method, path := http.MethodGet, "/api/bee/platforms/"+platform+"?preparation_id="+id
	var body any
	if input != nil {
		method = http.MethodPut
		body = struct {
			Preparation *desktopSupplyPreparation `json:"preparation"`
		}{input}
	}
	var result struct {
		Preparation struct {
			ID    string `json:"id"`
			State string `json:"state"`
		} `json:"preparation"`
		Supply json.RawMessage `json:"supply"`
	}
	if err := desktopCall(ctx, state, path, method, state.Credential, body, &result); err != nil {
		return "", err
	}
	if result.Preparation.ID != id || (result.Preparation.State != "absent" && result.Preparation.State != "active" && result.Preparation.State != "completed" && result.Preparation.State != "cancelled") {
		return "", fmt.Errorf("preparation readback rejected: id_match=%t state_known=%t; original operation retained", result.Preparation.ID == id, result.Preparation.State == "absent" || result.Preparation.State == "active" || result.Preparation.State == "completed")
	}
	if _, err := decodeDesktopSupply(result.Supply, platform); err != nil {
		return "", err
	}
	return result.Preparation.State, nil
}

// A lost response is reconciled against the original durable ID. Repeating
// this request is safe because Hive retains completed IDs across restarts.
func ensureDesktopPreparation(ctx context.Context, state localState, platform string, input desktopSupplyPreparation, expected string) error {
	// Inspect first: steady-state synchronization and restarts must not issue
	// another write after Hive already confirmed this operation's outcome.
	if got, err := desktopPreparationCall(ctx, state, platform, input.ID, nil); err != nil {
		return err
	} else if got == expected {
		return nil
	} else if got == "completed" || got == "cancelled" || input.Action != "begin" && got != "active" {
		return fmt.Errorf("preparation %s rejected: state=%s required=%s; original operation retained", input.Action, got, expected)
	}
	got, writeErr := desktopPreparationCall(ctx, state, platform, input.ID, &input)
	if writeErr != nil {
		var err error
		got, err = desktopPreparationCall(ctx, state, platform, input.ID, nil)
		if err != nil {
			return fmt.Errorf("preparation %s unresolved: write=%v; query: %w", input.Action, writeErr, err)
		}
	}
	if got != expected {
		return fmt.Errorf("preparation %s unconfirmed: state=%s required=%s write=%v; reconcile original operation", input.Action, got, expected, writeErr)
	}
	return nil
}
