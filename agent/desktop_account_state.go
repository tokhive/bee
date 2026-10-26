package bee

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"time"
)

type desktopAccountNotice struct {
	FirstSeen time.Time `json:"first_seen"`
	Notified  bool      `json:"notified"`
}
type desktopAccountState struct {
	Version  int                             `json:"version"`
	Revision int64                           `json:"revision"`
	Entries  map[string]desktopAccountNotice `json:"entries"`
	Scopes   map[string]desktopAccountScope  `json:"scopes"`
}

func uniqueAccountJSON(d *json.Decoder) error {
	token, err := d.Token()
	if err != nil {
		return errors.New("account state JSON token invalid")
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	if delim == '{' {
		seen := map[string]bool{}
		for d.More() {
			key, e := d.Token()
			if e != nil {
				return errors.New("account state JSON key invalid")
			}
			name, ok := key.(string)
			if !ok {
				return errors.New("account state key type is not string")
			}
			if seen[name] {
				return fmt.Errorf("account state duplicate field at byte=%d", d.InputOffset())
			}
			seen[name] = true
			if e := uniqueAccountJSON(d); e != nil {
				return e
			}
		}
	} else if delim == '[' {
		for d.More() {
			if e := uniqueAccountJSON(d); e != nil {
				return e
			}
		}
	} else {
		return errors.New("account state unexpected JSON delimiter")
	}
	_, err = d.Token()
	return err
}
func readDesktopAccountState(path string) (desktopAccountState, error) {
	raw, err := readDesktopAccountBytes(path)
	if errors.Is(err, os.ErrNotExist) {
		return desktopAccountState{Version: desktopAccountStateVersion, Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{}}, nil
	}
	if err != nil {
		return desktopAccountState{}, err
	}
	return decodeDesktopAccountState(raw)
}

func readDesktopAccountBytes(path string) ([]byte, error) {
	file, err := openRegularNoFollow(path)
	if err != nil {
		return nil, fmt.Errorf("open account state without links: %w", err)
	}
	defer file.Close()
	if err := validatePrivateFile(file); err != nil {
		return nil, fmt.Errorf("account state protection failed: %w", err)
	}
	raw, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil {
		return nil, fmt.Errorf("read account state: %w", err)
	}
	if len(raw) > 65536 {
		return nil, fmt.Errorf("account state exceeds file limit: bytes=%d required<=65536", len(raw))
	}
	return raw, nil
}

func decodeDesktopAccountState(raw []byte) (desktopAccountState, error) {
	var state desktopAccountState
	if !json.Valid(raw) {
		return state, fmt.Errorf("account state JSON invalid: bytes=%d; required=valid JSON", len(raw))
	}
	if err := uniqueAccountJSON(json.NewDecoder(bytes.NewReader(raw))); err != nil {
		return state, err
	}
	var header struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		return state, errors.New("account state root/version rejected; required=object with integer version")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	switch header.Version {
	case 1:
		var legacy struct {
			Version  int                             `json:"version"`
			Revision int64                           `json:"revision"`
			Entries  map[string]desktopAccountNotice `json:"entries"`
		}
		if err := requireDesktopStateFields(raw, reflect.TypeOf(legacy), "state"); err != nil {
			return state, err
		}
		if err := d.Decode(&legacy); err != nil {
			return state, fmt.Errorf("account v1 schema rejected at byte=%d; required=version,revision,entries", d.InputOffset())
		}
		state = desktopAccountState{Version: 1, Revision: legacy.Revision, Entries: legacy.Entries, Scopes: map[string]desktopAccountScope{}}
	case desktopAccountStateVersion:
		if err := requireDesktopStateFields(raw, reflect.TypeOf(state), "state"); err != nil {
			return state, err
		}
		if err := d.Decode(&state); err != nil {
			return state, fmt.Errorf("account v2 schema rejected at byte=%d; required=known state fields and types", d.InputOffset())
		}
		if err := validateDesktopAccountScopes(state.Scopes); err != nil {
			return state, err
		}
	default:
		return state, fmt.Errorf("account state version rejected: actual=%d; supported=1,2; original preserved", header.Version)
	}
	if !desktopSafeRevision(state.Revision) || state.Entries == nil || len(state.Entries) > 256 {
		return state, fmt.Errorf("account state header rejected: revision=%d entries=%d; required=safe revision,non-null <=256 entries", state.Revision, len(state.Entries))
	}
	for key, notice := range state.Entries {
		if !desktopAccountDigest(key) || notice.FirstSeen.IsZero() {
			return state, errors.New("account notice entry rejected; required=SHA256 key and nonzero first_seen")
		}
	}
	return state, nil
}

// Caller holds the account-state lock, always after the device session if any.
func saveDesktopAccountState(path string, state desktopAccountState, expected int64) error {
	current, err := readDesktopAccountState(path)
	if err != nil {
		return err
	}
	if current.Revision != expected {
		return fmt.Errorf("account state revision changed: actual=%d required=%d", current.Revision, expected)
	}
	if expected < 0 || expected >= desktopMaxRevision-1 {
		return fmt.Errorf("account state next revision exceeds supported range: current=%d; required<%d", expected, desktopMaxRevision-1)
	}
	state.Version = desktopAccountStateVersion
	state.Revision = expected + 1
	if state.Scopes == nil {
		state.Scopes = map[string]desktopAccountScope{}
	}
	for key, notice := range state.Entries {
		notice.FirstSeen = notice.FirstSeen.UTC().Round(0)
		state.Entries[key] = notice
	}
	for key, scope := range state.Scopes {
		for platform, op := range scope.PendingOperations {
			op.StartedAt = op.StartedAt.UTC().Round(0)
			scope.PendingOperations[platform] = op
		}
		state.Scopes[key] = scope
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode account state: %w", err)
	}
	if len(raw) > 65536 {
		return fmt.Errorf("account state exceeds file limit: bytes=%d required<=65536", len(raw))
	}
	if _, err := decodeDesktopAccountState(raw); err != nil {
		return fmt.Errorf("account state pre-write validation: %w", err)
	}
	if current.Version == 1 {
		if err := backupDesktopAccountV1(path); err != nil {
			return err
		}
	}
	if err := writePrivateFile(path, append(raw, '\n'), ".ai-accounts-*"); err != nil {
		return fmt.Errorf("replace account state: %w", err)
	}
	readback, err := readDesktopAccountState(path)
	if err != nil {
		return fmt.Errorf("account state write unconfirmed: readback failed: %w", err)
	}
	if !reflect.DeepEqual(readback, state) {
		return errors.New("account state write unconfirmed: readback does not match written state")
	}
	return nil
}

func backupDesktopAccountV1(path string) error {
	original, err := readDesktopAccountBytes(path)
	if err != nil {
		return fmt.Errorf("read original before account migration: %w", err)
	}
	backup, err := readDesktopAccountBytes(path + ".v1.bak")
	if err == nil {
		if !bytes.Equal(backup, original) {
			return errors.New("account migration backup differs from current v1 original; existing files preserved")
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("account migration backup protection failed: %w", err)
	}
	if err := writePrivateFile(path+".v1.bak", original, ".ai-accounts-backup-*"); err != nil {
		return fmt.Errorf("save account migration backup before replacement: %w", err)
	}
	backup, err = readDesktopAccountBytes(path + ".v1.bak")
	if err != nil {
		return fmt.Errorf("read back account migration backup: %w", err)
	}
	if !bytes.Equal(backup, original) {
		return errors.New("account migration backup readback mismatch; original state preserved")
	}
	return nil
}
func desktopAccountDigest(value string) bool {
	raw, err := hex.DecodeString(value)
	return err == nil && len(raw) == 32 && hex.EncodeToString(raw) == value
}
func desktopNoticeKey(hive, owner, platform, fingerprint, problem string) string {
	if !desktopAccountDigest(fingerprint) {
		return ""
	}
	raw, _ := json.Marshal([]string{hive, owner, platform, fingerprint, problem})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}
func updateDesktopAccountNotice(path, key string, now time.Time, active bool, delay time.Duration) (bool, error) {
	if key == "" {
		return false, nil
	}
	unlock, err := lockState(path)
	if err != nil {
		return false, err
	}
	defer unlock()
	state, err := readDesktopAccountState(path)
	if err != nil {
		return false, err
	}
	old, exists := state.Entries[key]
	if !active {
		if !exists {
			return false, nil
		}
		delete(state.Entries, key)
		return false, saveDesktopAccountState(path, state, state.Revision)
	}
	if !exists {
		if len(state.Entries) >= 256 {
			return false, errors.New("account notice state capacity reached: entries=256; existing deduplication preserved")
		}
		old.FirstSeen = now
	}
	if old.FirstSeen.After(now) {
		return false, errors.New("account notice clock moved before first_seen; deduplication preserved")
	}
	notify := !old.Notified && !now.Before(old.FirstSeen.Add(delay))
	next := old
	next.Notified = next.Notified || notify
	if exists && next == old {
		return false, nil
	}
	state.Entries[key] = next
	if err := saveDesktopAccountState(path, state, state.Revision); err != nil {
		return false, err
	}
	return notify, nil
}
