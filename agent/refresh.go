package bee

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/tokhive/bee/beewire"
)

var errRefreshRecovery = errors.New("refresh result could not be safely saved or confirmed; supply paused; waiting for official authorization update; sign in again if needed")
var errSourceChanged = errors.New("official authorization source changed during refresh; reading again")

// This journal contains only hashes and execution state, never tokens or OAuth responses.
type refreshJournal struct {
	TaskID         string `json:"task_id"`
	Revision       string `json:"credential_revision"`
	RefreshDigest  string `json:"refresh_digest"`
	State          string `json:"state"`
	ResultRevision string `json:"result_revision,omitempty"`
}

func privateReplace(path string, raw []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".bee-save-*")
	if err != nil {
		return errRefreshRecovery
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(raw)
	}
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(file.Name(), path)
	}
	if err != nil {
		return errRefreshRecovery
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return errRefreshRecovery
	}
	defer dir.Close()
	if dir.Sync() != nil {
		return errRefreshRecovery
	}
	return nil
}

func readRefreshJournal(path string) (refreshJournal, error) {
	var journal refreshJournal
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return journal, nil
	}
	raw, err := readCodexFile(path)
	if err != nil || json.Unmarshal(raw, &journal) != nil || (journal.State != "started" && journal.State != "saved") {
		return journal, errRefreshRecovery
	}
	return journal, nil
}

func saveRefreshJournal(path string, journal refreshJournal) error {
	raw, err := json.Marshal(journal)
	if err != nil {
		return errRefreshRecovery
	}
	return privateReplace(path, raw)
}

func (source codexSource) executeMaintenance(ctx context.Context, task beewire.MaintenanceTask) (codexCredential, error) {
	var empty codexCredential
	parsed, err := x509.ParsePKIXPublicKey(task.Key.PublicKey)
	key, ok := parsed.(*ecdh.PublicKey)
	if err != nil || !ok || key.Curve() != ecdh.X25519() || sha256.Sum256(task.Key.PublicKey) != task.Key.KeyID {
		return empty, errInboxIdentity
	}
	if task.Kind != "refresh_authorization" && task.Kind != "reencrypt_authorization" {
		return empty, errors.New("unknown authorization maintenance task")
	}
	initial, err := source.readForMaintenance(ctx)
	if err != nil {
		return empty, err
	}
	if initial.metadata().AccountFingerprint != task.AccountFingerprint {
		return empty, errSourceChanged
	}
	if initial.Source != "file" {
		if task.Kind == "refresh_authorization" {
			return empty, errors.New("automatic refresh writeback supports only the official file store; update Keychain credentials using the official client")
		}
		return initial, nil
	}
	unlock, err := lockState(filepath.Join(filepath.Dir(initial.path), ".bee-oauth"))
	if err != nil {
		return empty, errors.New("another Bee is maintaining this authorization; waiting for the next task synchronization")
	}
	defer unlock()
	current, err := source.readForMaintenance(ctx)
	if err != nil {
		return empty, err
	}
	if current.Source != "file" || current.path != initial.path {
		return empty, errSourceChanged
	}
	meta := current.metadata()
	if meta.AccountFingerprint != task.AccountFingerprint {
		return empty, errSourceChanged
	}
	journalPath := filepath.Join(filepath.Dir(current.path), ".bee-maintenance.json")
	journal, err := readRefreshJournal(journalPath)
	if err != nil {
		return empty, err
	}
	digest := sha256.Sum256([]byte(current.refreshToken))
	if journal.State == "started" && journal.Revision == meta.CredentialRevision && journal.RefreshDigest == hex.EncodeToString(digest[:]) {
		return empty, errRefreshRecovery
	}
	if task.Kind == "reencrypt_authorization" || meta.CredentialRevision != task.CredentialRevision || journal.State == "saved" && journal.TaskID == task.ID && journal.ResultRevision == meta.CredentialRevision {
		if !meta.Available(time.Now()) {
			return empty, errCodexExpired
		}
		return current, nil
	}
	if task.Kind != "refresh_authorization" {
		return empty, errors.New("unknown authorization maintenance task")
	}
	if current.refreshToken == "" {
		return empty, errors.New("no local refresh token; update authorization in official Codex")
	}
	journal = refreshJournal{TaskID: task.ID, Revision: meta.CredentialRevision, RefreshDigest: hex.EncodeToString(digest[:]), State: "started"}
	if err = saveRefreshJournal(journalPath, journal); err != nil {
		return empty, err
	}
	updated, err := refreshCodex(ctx, current, source.transport)
	if err != nil {
		latest, readErr := source.read(ctx)
		if readErr == nil && latest.metadata().AccountFingerprint == task.AccountFingerprint && latest.metadata().CredentialRevision != meta.CredentialRevision {
			return latest, nil
		}
		return empty, errRefreshRecovery
	}
	latest, err := source.readForMaintenance(ctx)
	if err != nil || latest.path != current.path || !bytes.Equal(latest.raw, current.raw) {
		return empty, errSourceChanged
	}
	// Official Codex does not take our lock: this check plus rename still has a cross-client race.
	if err = privateReplace(current.path, updated.raw); err != nil {
		return empty, err
	}
	journal.State, journal.ResultRevision = "saved", updated.metadata().CredentialRevision
	if err = saveRefreshJournal(journalPath, journal); err != nil {
		return empty, err
	}
	latest, err = source.read(ctx)
	if err != nil || latest.metadata().AccountFingerprint != task.AccountFingerprint {
		return empty, errSourceChanged
	}
	return latest, nil
}

func refreshCodex(ctx context.Context, current codexCredential, transport http.RoundTripper) (codexCredential, error) {
	var empty codexCredential
	body, _ := json.Marshal(map[string]string{"client_id": "app_EMoamEEZ73f0CkXaXp7hrann", "grant_type": "refresh_token", "refresh_token": current.refreshToken})
	req, err := http.NewRequestWithContext(ctx, "POST", "https://auth.openai.com/oauth/token", bytes.NewReader(body))
	if err != nil {
		return empty, errRefreshRecovery
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client := httpClient()
	client.Transport = transport
	response, err := client.Do(req)
	if err != nil {
		return empty, errRefreshRecovery
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return empty, errRefreshRecovery
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(raw) > 65536 {
		return empty, errRefreshRecovery
	}
	var tokens struct {
		Access  *string `json:"access_token"`
		Refresh *string `json:"refresh_token"`
		ID      *string `json:"id_token"`
	}
	if json.Unmarshal(raw, &tokens) != nil || tokens.Access == nil || *tokens.Access == "" || tokens.Refresh != nil && *tokens.Refresh == "" || tokens.ID != nil && *tokens.ID == "" {
		return empty, errRefreshRecovery
	}
	var auth map[string]json.RawMessage
	var existing map[string]json.RawMessage
	if json.Unmarshal(current.raw, &auth) != nil || json.Unmarshal(auth["tokens"], &existing) != nil {
		return empty, errRefreshRecovery
	}
	for key, value := range map[string]*string{"access_token": tokens.Access, "refresh_token": tokens.Refresh, "id_token": tokens.ID} {
		if value != nil {
			existing[key], _ = json.Marshal(*value)
		}
	}
	auth["tokens"], _ = json.Marshal(existing)
	auth["last_refresh"], _ = json.Marshal(time.Now().UTC().Format(time.RFC3339Nano))
	saved, _ := json.Marshal(auth)
	if len(saved) > 65536 {
		return empty, errRefreshRecovery
	}
	credential, err := parseCodexCredential(saved)
	if err != nil || !credential.metadata().Available(time.Now()) || credential.metadata().AccountFingerprint != current.metadata().AccountFingerprint || credential.Secret.Token == current.Secret.Token {
		return empty, errRefreshRecovery
	}
	credential.raw, credential.path, credential.Source = saved, current.path, "file"
	return credential, nil
}
