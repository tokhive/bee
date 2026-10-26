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
	empty := desktopAccountState{Version: 1, Entries: map[string]desktopAccountNotice{}}
	file, err := openRegularNoFollow(path)
	if errors.Is(err, os.ErrNotExist) {
		return empty, nil
	}
	if err != nil {
		return empty, fmt.Errorf("open account notice state without links: %w", err)
	}
	defer file.Close()
	if err := validatePrivateFile(file); err != nil {
		return empty, fmt.Errorf("account notice state protection failed: %w", err)
	}
	raw, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil {
		return empty, fmt.Errorf("read account notice state: %w", err)
	}
	if len(raw) > 65536 || !json.Valid(raw) {
		return empty, fmt.Errorf("account notice state JSON invalid: bytes=%d; required=valid JSON <=65536 bytes", len(raw))
	}
	if err := uniqueAccountJSON(json.NewDecoder(bytes.NewReader(raw))); err != nil {
		return empty, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return empty, errors.New("account notice root type rejected; required=object")
	}
	for _, name := range []string{"version", "revision", "entries"} {
		value, ok := fields[name]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return empty, fmt.Errorf("account notice field absent or null: field=%s", name)
		}
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	var state desktopAccountState
	if err := d.Decode(&state); err != nil {
		return empty, fmt.Errorf("account notice state schema rejected at byte=%d; required=version,revision,entries", d.InputOffset())
	}
	if state.Version != 1 || state.Revision < 0 || state.Revision >= 9007199254740991 || state.Entries == nil || len(state.Entries) > 256 {
		return empty, fmt.Errorf("account notice state header rejected: version=%d revision=%d entries=%d; required=v1, safe revision, <=256 entries", state.Version, state.Revision, len(state.Entries))
	}
	for key, notice := range state.Entries {
		if !desktopAccountDigest(key) || notice.FirstSeen.IsZero() {
			return empty, errors.New("account notice entry rejected: required=SHA256 key and nonzero first_seen")
		}
		var entryFields map[string]json.RawMessage
		var rawEntries map[string]json.RawMessage
		_ = json.Unmarshal(fields["entries"], &rawEntries)
		_ = json.Unmarshal(rawEntries[key], &entryFields)
		if len(entryFields) != 2 || entryFields["notified"] == nil || bytes.Equal(bytes.TrimSpace(entryFields["notified"]), []byte("null")) {
			return empty, errors.New("account notice entry schema rejected; required=first_seen and explicit boolean notified")
		}
	}
	return state, nil
}

// Caller holds the account-state lock, always after the device lock if any.
func saveDesktopAccountState(path string, state desktopAccountState, expected int64) error {
	current, err := readDesktopAccountState(path)
	if err != nil {
		return err
	}
	if current.Revision != expected {
		return fmt.Errorf("account notice state revision changed: actual=%d required=%d", current.Revision, expected)
	}
	state.Version = 1
	state.Revision = expected + 1
	for key, notice := range state.Entries {
		notice.FirstSeen = notice.FirstSeen.UTC().Round(0)
		state.Entries[key] = notice
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode account notice state: %w", err)
	}
	if len(raw) > 65536 {
		return fmt.Errorf("account notice state exceeds file limit: bytes=%d required<=65536", len(raw))
	}
	if err := writePrivateFile(path, append(raw, '\n'), ".ai-accounts-*"); err != nil {
		return fmt.Errorf("replace account notice state: %w", err)
	}
	readback, err := readDesktopAccountState(path)
	if err != nil {
		return fmt.Errorf("account notice state write unconfirmed: readback failed: %w", err)
	}
	if !reflect.DeepEqual(readback, state) {
		return errors.New("account notice state write unconfirmed: readback does not match written revision and entries")
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
