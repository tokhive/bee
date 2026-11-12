package beewire

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"regexp"
	"unicode/utf8"
)

const DeviceDrainVersion = 1
const DeviceDrainCapabilitiesPath = "/api/bee/device-drain-capabilities"
const DeviceDrainOperationsPath = "/api/bee/device-drains/"
const DeviceDrainMaxBody = 65536

var drainID = regexp.MustCompile(`^[a-f0-9]{48}$`)
var drainPublicID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// DeviceDrainRequest is immutable, including its raw historical origin. Empty
// epoch/lease identifies an initial, disconnected binding, never a wildcard.
type DeviceDrainRequest struct {
	ID            string `json:"id"`
	DeviceID      string `json:"device_id"`
	OwnerID       string `json:"owner_id"`
	Origin        string `json:"origin"`
	ExpectedEpoch string `json:"expected_epoch"`
	ExpectedLease string `json:"expected_lease"`
}

type DeviceDrainCapabilities struct {
	Version     int `json:"version"`
	DeviceDrain int `json:"device_drain"`
}
type DeviceDrainSealRequest struct {
	ID      string             `json:"id"`
	Request DeviceDrainRequest `json:"request"`
}
type DeviceDrainReleaseRequest struct {
	ID            string             `json:"id"`
	Request       DeviceDrainRequest `json:"request"`
	Mode          string             `json:"mode"`
	ExpectedEpoch string             `json:"expected_epoch"`
	ExpectedLease string             `json:"expected_lease"`
}
type DeviceDrainWork struct {
	Executions          int64 `json:"executions"`
	UnknownTerminations int64 `json:"unknown_terminations"`
	Unsettled           int64 `json:"unsettled"`
}
type DeviceDrainCurrent struct {
	Epoch     string           `json:"epoch"`
	Lease     string           `json:"lease"`
	BarrierID string           `json:"barrier_id"`
	Work      *DeviceDrainWork `json:"work"`
}

// DeviceDrainReceipt is a historical, immutable completion fact. It is never
// evidence of the current connection, epoch, barrier ownership or work count.
type DeviceDrainReceipt struct {
	Version           int                    `json:"version"`
	Seal              DeviceDrainSealRequest `json:"seal"`
	Epoch             string                 `json:"epoch"`
	ConnectionRetired bool                   `json:"connection_retired"`
	Work              DeviceDrainWork        `json:"work"`
}
type DeviceDrainStatus struct {
	Version     int                        `json:"version"`
	DeviceID    string                     `json:"device_id"`
	OwnerID     string                     `json:"owner_id"`
	OperationID string                     `json:"operation_id"`
	State       string                     `json:"state"`
	Request     *DeviceDrainRequest        `json:"request"`
	Seal        *DeviceDrainSealRequest    `json:"seal"`
	Release     *DeviceDrainReleaseRequest `json:"release"`
	Receipt     *DeviceDrainReceipt        `json:"receipt"`
	Current     DeviceDrainCurrent         `json:"current"`
}

func drainCheck(check string, actual any, required string) error {
	return fmt.Errorf("device-drain %s rejected: actual=%v; required=%s", check, actual, required)
}
func drainEpoch(value string) bool { return value == "" || drainID.MatchString(value) }
func drainLease(value string) bool { return value == "" || drainPublicID.MatchString(value) }

func (r DeviceDrainRequest) Validate() error {
	for _, check := range []struct {
		name     string
		valid    bool
		required string
	}{
		{"operation_id", drainID.MatchString(r.ID), "48 lowercase hex characters"},
		{"device_id", drainPublicID.MatchString(r.DeviceID), "bounded public ID"},
		{"owner_id", drainPublicID.MatchString(r.OwnerID), "bounded public ID"},
		{"expected_epoch", drainEpoch(r.ExpectedEpoch), "empty or 48 lowercase hex characters"},
		{"expected_lease", drainLease(r.ExpectedLease), "empty or bounded public ID"},
	} {
		if !check.valid {
			return drainCheck(check.name, false, check.required)
		}
	}
	if _, err := CanonicalHiveOrigin(r.Origin); err != nil {
		return fmt.Errorf("device-drain original origin: %w", err)
	}
	return nil
}

func DecodeDeviceDrainRequest(raw []byte) (DeviceDrainRequest, error) {
	var r DeviceDrainRequest
	if err := decodeDrainJSON(raw, &r); err != nil {
		return r, err
	}
	return r, r.Validate()
}

func (r DeviceDrainSealRequest) Validate() error {
	if err := r.Request.Validate(); err != nil {
		return err
	}
	if !drainID.MatchString(r.ID) || r.ID == r.Request.ID {
		return drainCheck("seal action ID", false, "distinct 48 lowercase hex characters")
	}
	return nil
}
func (r DeviceDrainReleaseRequest) Validate() error {
	if err := r.Request.Validate(); err != nil {
		return err
	}
	if !drainID.MatchString(r.ID) || r.ID == r.Request.ID {
		return drainCheck("release action ID", false, "distinct 48 lowercase hex characters")
	}
	if r.Mode != "cancel" && r.Mode != "activate" {
		return drainCheck("release mode", false, "cancel or activate")
	}
	if !drainEpoch(r.ExpectedEpoch) || !drainLease(r.ExpectedLease) {
		return drainCheck("release current context", false, "valid epoch and lease; empty means absent, not wildcard")
	}
	if r.Mode == "activate" && r.ExpectedEpoch == "" {
		return drainCheck("activation epoch", false, "nonempty sealed epoch")
	}
	if r.Mode == "activate" && (r.ExpectedLease == "" || r.ExpectedLease == r.Request.ExpectedLease) {
		return drainCheck("activation connection lease", false, "new verified connection lease, distinct from original retired lease")
	}
	return nil
}
func (w DeviceDrainWork) Validate() error {
	for _, field := range []struct {
		name  string
		value int64
	}{{"executions", w.Executions}, {"unknown_terminations", w.UnknownTerminations}, {"unsettled", w.Unsettled}} {
		if field.value < 0 || field.value > 9007199254740991 {
			return drainCheck(field.name, field.value, "integer 0..9007199254740991")
		}
	}
	return nil
}
func (w DeviceDrainWork) Complete() bool { return w == DeviceDrainWork{} }
func (r DeviceDrainReceipt) Validate() error {
	if err := r.Seal.Validate(); err != nil {
		return err
	}
	if r.Version != DeviceDrainVersion {
		return drainCheck("receipt version", r.Version, "1")
	}
	if r.Epoch != r.Seal.ID {
		return drainCheck("receipt epoch match", false, "persisted seal action ID")
	}
	if !r.ConnectionRetired {
		return drainCheck("receipt connection_retired", false, "confirmed old connection exit")
	}
	if err := r.Work.Validate(); err != nil {
		return err
	}
	if !r.Work.Complete() {
		return drainCheck("receipt work", r.Work, "all three counts zero")
	}
	return nil
}
func (s DeviceDrainStatus) ValidateFor(expected DeviceDrainRequest) error {
	if err := expected.Validate(); err != nil {
		return err
	}
	if err := s.Validate(); err != nil {
		return err
	}
	if s.OperationID != expected.ID || s.DeviceID != expected.DeviceID || s.OwnerID != expected.OwnerID {
		return drainCheck("response binding match", false, "original operation, device and owner")
	}
	if s.Request != nil && *s.Request != expected {
		return drainCheck("original request match", false, "exact original parameters, including raw origin")
	}
	return nil
}
func (s DeviceDrainStatus) Validate() error {
	if s.Version != DeviceDrainVersion {
		return drainCheck("response version", s.Version, "1")
	}
	if !drainID.MatchString(s.OperationID) || !drainPublicID.MatchString(s.DeviceID) || !drainPublicID.MatchString(s.OwnerID) {
		return drainCheck("response identity", false, "valid operation, device and owner IDs")
	}
	if !drainEpoch(s.Current.Epoch) || !drainLease(s.Current.Lease) || !drainEpoch(s.Current.BarrierID) {
		return drainCheck("current context", false, "valid epoch, lease and barrier ID")
	}
	if s.Current.Work != nil {
		if err := s.Current.Work.Validate(); err != nil {
			return err
		}
	}
	if s.State == "absent" {
		if s.Request != nil || s.Seal != nil || s.Release != nil || s.Receipt != nil {
			return drainCheck("absent operation evidence", true, "all operation fields null")
		}
		if s.Current.BarrierID == s.OperationID {
			return drainCheck("absent barrier", true, "no barrier for absent operation")
		}
		return nil
	}
	if s.Request == nil {
		return drainCheck("original request presence", false, "persisted original request")
	}
	if err := s.Request.Validate(); err != nil {
		return err
	}
	if s.Request.ID != s.OperationID || s.Request.DeviceID != s.DeviceID || s.Request.OwnerID != s.OwnerID {
		return drainCheck("operation request binding", false, "same operation, device and owner")
	}
	if s.Seal != nil {
		if err := s.Seal.Validate(); err != nil {
			return err
		}
		if s.Seal.Request != *s.Request {
			return drainCheck("seal original request match", false, "exact original request")
		}
	}
	if s.Release != nil {
		if err := s.Release.Validate(); err != nil {
			return err
		}
		if s.Release.Request != *s.Request {
			return drainCheck("release original request match", false, "exact original request")
		}
		if s.Seal != nil && s.Release.ID == s.Seal.ID {
			return drainCheck("release action identity", false, "distinct from seal action ID")
		}
	}
	if s.Receipt != nil {
		if err := s.Receipt.Validate(); err != nil {
			return err
		}
		if s.Seal == nil || s.Receipt.Seal != *s.Seal {
			return drainCheck("receipt seal match", false, "exact original seal request")
		}
	}
	switch s.State {
	case "draining", "ready":
		if s.Seal != nil || s.Release != nil || s.Receipt != nil {
			return drainCheck("waiting operation evidence", true, "no seal, release or receipt")
		}
		if s.State == "ready" && (s.Current.Work == nil || !s.Current.Work.Complete()) {
			return drainCheck("ready work", s.Current.Work, "known zero executions, unknown terminations and unsettled work")
		}
	case "sealing":
		if s.Seal == nil || s.Release != nil || s.Receipt != nil {
			return drainCheck("pending seal evidence", false, "seal request with no completed receipt or release")
		}
	case "sealed":
		if s.Seal == nil || s.Receipt == nil || s.Release != nil {
			return drainCheck("sealed evidence", false, "seal and complete receipt, no release")
		}
	case "released":
		if s.Release == nil {
			return drainCheck("release evidence", false, "persisted release, including pre-begin tombstone")
		}
		if (s.Seal == nil) != (s.Receipt == nil) {
			return drainCheck("released seal evidence", false, "both seal and receipt, or neither")
		}
		if s.Release.Mode == "activate" && s.Receipt == nil {
			return drainCheck("activation seal evidence", false, "complete immutable seal receipt")
		}
		if s.Receipt != nil && s.Release.ExpectedEpoch != s.Receipt.Epoch {
			return drainCheck("release epoch match", false, "sealed epoch")
		}
		if s.Receipt != nil && (s.Release.ExpectedLease == "" || s.Release.ExpectedLease == s.Request.ExpectedLease) {
			return drainCheck("sealed release connection lease", false, "new verified connection lease")
		}
		if s.Receipt == nil && s.Release.ExpectedEpoch != s.Request.ExpectedEpoch {
			return drainCheck("unsealed cancellation epoch match", false, "original epoch")
		}
	default:
		return drainCheck("operation state", false, "absent/draining/ready/sealing/sealed/released")
	}
	if (s.State == "draining" || s.State == "ready" || s.State == "sealing") && s.Current.BarrierID != s.OperationID {
		return drainCheck("active barrier match", false, "original operation ID")
	}
	return nil
}

func DecodeDeviceDrainCapabilities(raw []byte) (DeviceDrainCapabilities, error) {
	var r DeviceDrainCapabilities
	if err := decodeDrainJSON(raw, &r); err != nil {
		return r, err
	}
	if r.Version != DeviceDrainVersion {
		return r, drainCheck("capability version", r.Version, "1")
	}
	if r.DeviceDrain != 0 && r.DeviceDrain != DeviceDrainVersion {
		return r, drainCheck("device_drain capability", r.DeviceDrain, "0 or 1")
	}
	return r, nil
}
func DecodeDeviceDrainSealRequest(raw []byte) (DeviceDrainSealRequest, error) {
	var r DeviceDrainSealRequest
	if err := decodeDrainJSON(raw, &r); err != nil {
		return r, err
	}
	return r, r.Validate()
}
func DecodeDeviceDrainReleaseRequest(raw []byte) (DeviceDrainReleaseRequest, error) {
	var r DeviceDrainReleaseRequest
	if err := decodeDrainJSON(raw, &r); err != nil {
		return r, err
	}
	return r, r.Validate()
}
func DecodeDeviceDrainStatus(raw []byte) (DeviceDrainStatus, error) {
	var r DeviceDrainStatus
	if err := decodeDrainJSON(raw, &r); err != nil {
		return r, err
	}
	return r, r.Validate()
}

// decodeDrainJSON checks presence before typed decoding: Go's normal decoder
// accepts missing bools, null strings, duplicate fields and trailing values.
func decodeDrainJSON(raw []byte, output any) error {
	if len(raw) == 0 || len(raw) > DeviceDrainMaxBody || !utf8.Valid(raw) {
		return drainCheck("JSON body", len(raw), "1..65536 UTF-8 bytes")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := uniqueDrainJSON(decoder); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return drainCheck("JSON termination", err == io.EOF, "one complete JSON value")
	}
	if err := drainJSONFields(raw, reflect.TypeOf(output).Elem(), "response"); err != nil {
		return err
	}
	if err := json.Unmarshal(raw, output); err != nil {
		return drainCheck("JSON field type", fmt.Sprintf("%T", err), "declared field types and integer ranges")
	}
	return nil
}
func uniqueDrainJSON(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return drainCheck("JSON syntax", decoder.InputOffset(), "complete valid JSON at byte offset")
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := map[string]bool{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return drainCheck("JSON object", decoder.InputOffset(), "valid field name")
			}
			name, ok := key.(string)
			if !ok || seen[name] {
				return drainCheck("JSON duplicate field", true, "unique object keys")
			}
			seen[name] = true
			if err := uniqueDrainJSON(decoder); err != nil {
				return err
			}
		}
	case '[':
		for decoder.More() {
			if err := uniqueDrainJSON(decoder); err != nil {
				return err
			}
		}
	default:
		return drainCheck("JSON delimiter", decoder.InputOffset(), "object or array opening delimiter")
	}
	if _, err := decoder.Token(); err != nil {
		return drainCheck("JSON closing delimiter", decoder.InputOffset(), "complete object or array")
	}
	return nil
}
func drainJSONFields(raw []byte, kind reflect.Type, path string) error {
	if kind.Kind() == reflect.Pointer {
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return nil
		}
		return drainJSONFields(raw, kind.Elem(), path)
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return drainCheck(path+" null", true, "non-null declared value")
	}
	if kind.Kind() != reflect.Struct {
		return nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return drainCheck(path+" object", false, "object with every declared field")
	}
	if len(fields) != kind.NumField() {
		return drainCheck(path+" fields", len(fields), fmt.Sprintf("exactly %d declared fields", kind.NumField()))
	}
	for i := 0; i < kind.NumField(); i++ {
		field := kind.Field(i)
		name := field.Tag.Get("json")
		value, ok := fields[name]
		if !ok {
			return drainCheck(path+"."+name+" presence", false, "explicit declared field")
		}
		if err := drainJSONFields(value, field.Type, path+"."+name); err != nil {
			return err
		}
	}
	return nil
}
