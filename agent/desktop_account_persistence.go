package bee

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"
	"unicode"
)

const desktopAccountStateVersion = 2
const desktopMaxRevision int64 = 9007199254740991

type desktopAccountScope struct {
	Hive              string                             `json:"hive"`
	OwnerID           string                             `json:"owner_id"`
	DeviceID          string                             `json:"device_id"`
	Selections        map[string]desktopAccountSelection `json:"selections"`
	PendingOperations map[string]desktopPendingOperation `json:"pending_operations"`
	RuntimeIntent     desktopRuntimeIntent               `json:"runtime_intent"`
	Session           desktopSessionMarker               `json:"session"`
}

type desktopAccountSelection struct {
	Source             DesktopAccountSource `json:"source"`
	Fingerprint        string               `json:"fingerprint"`
	Generation         int64                `json:"generation"`
	CredentialRevision string               `json:"credential_revision"`
	Revision           int64                `json:"revision"`
}

type desktopPendingOperation struct {
	ID                 string               `json:"id"`
	Kind               string               `json:"kind"`
	Stage              string               `json:"stage"`
	Source             DesktopAccountSource `json:"source"`
	FromFingerprint    string               `json:"from_fingerprint"`
	FromGeneration     int64                `json:"from_generation"`
	ToFingerprint      string               `json:"to_fingerprint"`
	CredentialRevision string               `json:"credential_revision"`
	ConfirmationID     string               `json:"confirmation_id"`
	StartedAt          time.Time            `json:"started_at"`
}

type desktopRuntimeIntent struct {
	Running         bool     `json:"running"`
	ResumePlatforms []string `json:"resume_platforms"`
}

type desktopSessionMarker struct {
	RunID  string `json:"run_id"`
	Active bool   `json:"active"`
	Clean  bool   `json:"clean"`
}

func desktopScopeKey(hive, owner, device string) string {
	raw, _ := json.Marshal([]string{hive, owner, device})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func newDesktopAccountScope(state localState) desktopAccountScope {
	return desktopAccountScope{Hive: state.Hive, OwnerID: state.Identity.OwnerID, DeviceID: state.Identity.ID,
		Selections: map[string]desktopAccountSelection{}, PendingOperations: map[string]desktopPendingOperation{},
		RuntimeIntent: desktopRuntimeIntent{ResumePlatforms: []string{}}, Session: desktopSessionMarker{Clean: true}}
}

func validateDesktopAccountScopes(scopes map[string]desktopAccountScope) error {
	if scopes == nil || len(scopes) > 16 {
		return fmt.Errorf("account scope count rejected: null=%t count=%d; required=object with <=16 scopes", scopes == nil, len(scopes))
	}
	for key, scope := range scopes {
		origin, err := hiveOrigin(scope.Hive)
		if err != nil || origin != scope.Hive {
			return fmt.Errorf("account scope Hive origin is not canonical; scope retained")
		}
		if !publicIDPattern.MatchString(scope.OwnerID) || !publicIDPattern.MatchString(scope.DeviceID) {
			return fmt.Errorf("account scope identity rejected: owner_bytes=%d device_bytes=%d; required=public IDs", len(scope.OwnerID), len(scope.DeviceID))
		}
		if key != desktopScopeKey(scope.Hive, scope.OwnerID, scope.DeviceID) {
			return fmt.Errorf("account scope key does not match Hive/owner/device; cross-scope state rejected")
		}
		if scope.Selections == nil || scope.PendingOperations == nil || len(scope.Selections) > 2 || len(scope.PendingOperations) > 2 {
			return fmt.Errorf("account scope maps rejected: selections=%d operations=%d; required=non-null maps with <=2 platforms", len(scope.Selections), len(scope.PendingOperations))
		}
		for platform, selection := range scope.Selections {
			if err := validateDesktopStoredSource(platform, selection.Source); err != nil {
				return err
			}
			if !desktopAccountDigest(selection.Fingerprint) || !desktopAccountDigest(selection.CredentialRevision) {
				return fmt.Errorf("account selection identity digest rejected: platform=%s; required=SHA256 fingerprint and credential revision", platform)
			}
			if !desktopSafeRevision(selection.Revision) || selection.Revision == 0 || !desktopSafeRevision(selection.Generation) {
				return fmt.Errorf("account selection revision rejected: revision=%d generation=%d; required=positive safe selection revision and nonnegative safe generation", selection.Revision, selection.Generation)
			}
		}
		for platform, op := range scope.PendingOperations {
			if err := validateDesktopStoredSource(platform, op.Source); err != nil {
				return err
			}
			if !desktopHexID(op.ID, 24) || !slices.Contains([]string{"select", "confirm_change"}, op.Kind) || !slices.Contains([]string{"intent", "paused", "submitted", "reconciling", "confirmed", "committed", "synchronized"}, op.Stage) {
				return fmt.Errorf("account operation identity or stage rejected: id_bytes=%d kind_known=%t stage_known=%t", len(op.ID), slices.Contains([]string{"select", "confirm_change"}, op.Kind), slices.Contains([]string{"intent", "paused", "submitted", "reconciling", "confirmed", "committed", "synchronized"}, op.Stage))
			}
			if op.StartedAt.IsZero() || !desktopSafeRevision(op.FromGeneration) || !desktopAccountDigest(op.ToFingerprint) || !desktopAccountDigest(op.CredentialRevision) || (op.FromFingerprint != "" && !desktopAccountDigest(op.FromFingerprint)) {
				return fmt.Errorf("account operation provenance rejected: platform=%s generation=%d; required=timestamp and valid identity revisions", platform, op.FromGeneration)
			}
			if len(op.ConfirmationID) > 512 || strings.IndexFunc(op.ConfirmationID, unicode.IsControl) >= 0 {
				return fmt.Errorf("account operation confirmation reference rejected: bytes=%d; required=<=512 without control characters", len(op.ConfirmationID))
			}
		}
		if scope.RuntimeIntent.ResumePlatforms == nil || len(scope.RuntimeIntent.ResumePlatforms) > 2 {
			return fmt.Errorf("runtime resume platforms rejected: required=non-null list with <=2 entries")
		}
		seen := map[string]bool{}
		for _, platform := range scope.RuntimeIntent.ResumePlatforms {
			if !desktopPlatform(platform) || seen[platform] {
				return fmt.Errorf("runtime resume platform duplicated or outside openai,claude")
			}
			if _, ok := scope.Selections[platform]; !ok {
				return fmt.Errorf("runtime resume platform lacks persisted selection: platform=%s", platform)
			}
			seen[platform] = true
		}
		if scope.Session.Active && scope.Session.Clean {
			return fmt.Errorf("runtime session cannot be active and clean simultaneously; automatic recovery blocked")
		}
		if (scope.Session.Active || scope.Session.RunID != "") && !desktopHexID(scope.Session.RunID, 16) {
			return fmt.Errorf("runtime session identifier rejected: bytes=%d; required=32 lowercase hex characters", len(scope.Session.RunID))
		}
	}
	return nil
}

func desktopSafeRevision(n int64) bool { return n >= 0 && n < desktopMaxRevision }
func desktopPlatform(p string) bool    { return p == "openai" || p == "claude" }
func desktopHexID(s string, size int) bool {
	raw, err := hex.DecodeString(s)
	return err == nil && len(raw) == size && hex.EncodeToString(raw) == s
}
func validateDesktopStoredSource(platform string, source DesktopAccountSource) error {
	if err := validateDesktopAccountDetect(DesktopAccountDetectRequest{Platform: platform, Directory: source.Directory, Store: source.Store, Mode: "local"}); err != nil {
		return err
	}
	if source.Store == "auto" {
		return fmt.Errorf("persisted account source is unresolved: store=auto; required=explicit selected store")
	}
	return nil
}

// Null/missing booleans must not silently become false during recovery. The
// decoder separately rejects unknown fields; errors report paths, never values.
func requireDesktopStateFields(raw json.RawMessage, kind reflect.Type, at string) error {
	if kind.Kind() == reflect.Pointer {
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return nil
		}
		return requireDesktopStateFields(raw, kind.Elem(), at)
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return fmt.Errorf("account state field is null: field=%s; required=explicit non-null value", at)
	}
	if kind == reflect.TypeOf(time.Time{}) {
		return nil
	}
	switch kind.Kind() {
	case reflect.Struct:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return fmt.Errorf("account state object required: field=%s", at)
		}
		expected := make(map[string]bool, kind.NumField())
		for i := 0; i < kind.NumField(); i++ {
			expected[strings.Split(kind.Field(i).Tag.Get("json"), ",")[0]] = true
		}
		for name := range fields {
			if !expected[name] {
				return fmt.Errorf("account state object contains an unknown field: object=%s; required=exact JSON field names without case aliases", at)
			}
		}
		for i := 0; i < kind.NumField(); i++ {
			field := kind.Field(i)
			name := strings.Split(field.Tag.Get("json"), ",")[0]
			value, ok := fields[name]
			if !ok {
				return fmt.Errorf("account state field absent: field=%s.%s", at, name)
			}
			if err := requireDesktopStateFields(value, field.Type, at+"."+name); err != nil {
				return err
			}
		}
	case reflect.Map:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return fmt.Errorf("account state map required: field=%s", at)
		}
		for _, value := range fields {
			if err := requireDesktopStateFields(value, kind.Elem(), at+"[]"); err != nil {
				return err
			}
		}
	case reflect.Slice:
		var fields []json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return fmt.Errorf("account state list required: field=%s", at)
		}
		for _, value := range fields {
			if err := requireDesktopStateFields(value, kind.Elem(), at+"[]"); err != nil {
				return err
			}
		}
	}
	return nil
}
