package bee

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"time"
)

// DesktopLoginMaintenance separates the result of the owned official command
// from the current safety and availability of the selected platform.
type DesktopLoginMaintenance struct {
	Operation  DesktopOperation     `json:"operation"`
	Phase      string               `json:"phase"`
	Source     DesktopAccountSource `json:"source"`
	StartedAt  string               `json:"started_at"`
	CanRecheck bool                 `json:"can_recheck"`
	Error      *DesktopAccountError `json:"error"`
}

type desktopLoginRecord struct {
	Hive            string                   `json:"hive"`
	OwnerID         string                   `json:"owner_id"`
	DeviceID        string                   `json:"device_id"`
	BindingRevision int64                    `json:"binding_revision"`
	BindingDigest   string                   `json:"binding_digest"`
	NetworkRevision int64                    `json:"network_revision"`
	RunID           *string                  `json:"run_id"`
	Selection       *desktopAccountSelection `json:"selection"`
	PauseRequired   bool                     `json:"pause_required"`
	PauseConfirmed  bool                     `json:"pause_confirmed"`
	Isolated        bool                     `json:"isolated"`
	LoginStarted    bool                     `json:"login_started"`
	Public          DesktopLoginMaintenance  `json:"maintenance"`
}

type desktopLoginJournal struct {
	Version int                           `json:"version"`
	Records map[string]desktopLoginRecord `json:"records"`
}

func copyDesktopLoginMaintenance(value DesktopLoginMaintenance) *DesktopLoginMaintenance {
	raw, _ := json.Marshal(value)
	var result DesktopLoginMaintenance
	json.Unmarshal(raw, &result)
	return &result
}

func loginRecordKey(record desktopLoginRecord) string {
	return desktopScopeKey(record.Hive, record.OwnerID, record.DeviceID) + ":" + *record.Public.Operation.Platform
}

func readDesktopLoginJournal(session *desktopDeviceSession) (desktopLoginJournal, error) {
	path := filepath.Join(filepath.Dir(session.path), "login-maintenance.json")
	raw, err := readDesktopAccountBytes(path)
	if errors.Is(err, os.ErrNotExist) {
		return desktopLoginJournal{Version: 1, Records: map[string]desktopLoginRecord{}}, nil
	}
	if err != nil {
		return desktopLoginJournal{}, fmt.Errorf("read login maintenance journal: %w", err)
	}
	return decodeDesktopLoginJournal(raw)
}

func decodeDesktopLoginJournal(raw []byte) (desktopLoginJournal, error) {
	var result desktopLoginJournal
	if !json.Valid(raw) {
		return result, fmt.Errorf("login maintenance JSON invalid: bytes=%d; required=valid JSON", len(raw))
	}
	if err := uniqueAccountJSON(json.NewDecoder(bytes.NewReader(raw))); err != nil {
		return result, err
	}
	if err := requireDesktopStateFields(raw, reflect.TypeOf(result), "login_maintenance"); err != nil {
		return result, err
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&result); err != nil {
		return result, fmt.Errorf("login maintenance schema rejected at byte=%d; required=known fields and types", d.InputOffset())
	}
	if result.Version != 1 || result.Records == nil || len(result.Records) > 32 {
		return result, fmt.Errorf("login maintenance header rejected: version=%d records=%d; required=version 1 and <=32 non-null records", result.Version, len(result.Records))
	}
	for key, record := range result.Records {
		op := record.Public.Operation
		if op.Platform == nil || !desktopPlatform(*op.Platform) || op.Kind != "authorize" || !desktopHexID(op.ID, 24) || !desktopSafeRevision(op.Revision) || !slices.Contains([]string{"pending", "running", "succeeded", "failed", "cancelled", "unknown"}, op.State) {
			return result, fmt.Errorf("login maintenance operation rejected: kind=%s state=%s platform_present=%t; required=owned platform authorize operation", op.Kind, op.State, op.Platform != nil)
		}
		if key != loginRecordKey(record) || !publicIDPattern.MatchString(record.OwnerID) || !publicIDPattern.MatchString(record.DeviceID) || !desktopAccountDigest(record.BindingDigest) || !desktopSafeRevision(record.BindingRevision) || !desktopSafeRevision(record.NetworkRevision) {
			return result, fmt.Errorf("login maintenance scope rejected: key_match=%t binding_revision=%d network_revision=%d", key == loginRecordKey(record), record.BindingRevision, record.NetworkRevision)
		}
		origin, err := hiveOrigin(record.Hive)
		if err != nil || origin != record.Hive {
			return result, fmt.Errorf("login maintenance Hive origin is not canonical; original record retained")
		}
		if err := validateDesktopStoredSource(*op.Platform, record.Public.Source); err != nil {
			return result, err
		}
		if !slices.Contains([]string{"pause_pending", "paused", "isolated", "authorizing", "reconciling", "restored", "confirmation_required", "blocked"}, record.Public.Phase) || record.RunID != nil && !desktopHexID(*record.RunID, 16) {
			return result, fmt.Errorf("login maintenance stage rejected: phase=%s run_present=%t; required=known phase and owned run", record.Public.Phase, record.RunID != nil)
		}
		if started, err := time.Parse(time.RFC3339Nano, record.Public.StartedAt); err != nil || started.IsZero() {
			return result, fmt.Errorf("login maintenance timestamp rejected: bytes=%d; required=nonzero RFC3339 timestamp", len(record.Public.StartedAt))
		}
		if record.Public.CanRecheck != slices.Contains([]string{"confirmation_required", "blocked"}, record.Public.Phase) || record.Isolated && !record.PauseConfirmed || record.LoginStarted && !record.Isolated {
			return result, fmt.Errorf("login maintenance safety evidence rejected: phase=%s can_recheck=%t paused=%t isolated=%t login_started=%t", record.Public.Phase, record.Public.CanRecheck, record.PauseConfirmed, record.Isolated, record.LoginStarted)
		}
		if record.Selection != nil {
			s := record.Selection
			if err := validateDesktopStoredSource(*op.Platform, s.Source); err != nil {
				return result, err
			}
			if !desktopAccountDigest(s.Fingerprint) || !desktopAccountDigest(s.CredentialRevision) || !desktopSafeRevision(s.Generation) || !desktopSafeRevision(s.Revision) || s.Revision == 0 {
				return result, fmt.Errorf("login maintenance original selection rejected: generation=%d revision=%d", s.Generation, s.Revision)
			}
		}
	}
	return result, nil
}

// The session owns the cross-process configuration lock. Its separate journal
// gate serializes the complete transaction across independent platform workers;
// no session, storage or platform locks are acquired while holding this gate.
func saveDesktopLoginRecord(session *desktopDeviceSession, record desktopLoginRecord, fresh bool) error {
	session.loginJournalMu.Lock()
	defer session.loginJournalMu.Unlock()
	journal, err := readDesktopLoginJournal(session)
	if err != nil {
		return err
	}
	key := loginRecordKey(record)
	if old, found := journal.Records[key]; found {
		if fresh && old.Public.Phase != "restored" || !fresh && old.Public.Operation.ID != record.Public.Operation.ID {
			return fmt.Errorf("login maintenance journal ownership changed: existing_operation_match=%t unresolved=%t; original record retained", old.Public.Operation.ID == record.Public.Operation.ID, old.Public.CanRecheck)
		}
	} else if !fresh {
		return fmt.Errorf("login maintenance original journal record absent; operation is not recreated")
	}
	journal.Records[key] = record
	raw, err := json.Marshal(journal)
	if err != nil {
		return fmt.Errorf("encode login maintenance journal: %w", err)
	}
	if len(raw) > 65536 {
		return fmt.Errorf("login maintenance journal exceeds limit: bytes=%d required<=65536", len(raw))
	}
	if _, err := decodeDesktopLoginJournal(raw); err != nil {
		return fmt.Errorf("login maintenance pre-write validation: %w", err)
	}
	path := filepath.Join(filepath.Dir(session.path), "login-maintenance.json")
	if err := writePrivateFile(path, append(raw, '\n'), ".login-maintenance-*"); err != nil {
		return fmt.Errorf("replace login maintenance journal: %w", err)
	}
	readback, err := readDesktopLoginJournal(session)
	if err != nil {
		return fmt.Errorf("login maintenance write unconfirmed: %w", err)
	}
	if !reflect.DeepEqual(journal, readback) {
		return fmt.Errorf("login maintenance write unconfirmed: readback differs from written record")
	}
	return nil
}
