package desktopbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/beewire"
)

type SwitchRuntime interface {
	SwitchControl(context.Context, bee.DesktopSwitchRequest) (bee.DesktopSwitchView, error)
	SwitchMaintenanceAllowed() bool
}

func decodeSwitchParams(req request, raw json.RawMessage) (request, *protocolError) {
	required := []string{"action", "profile_id", "instance", "binding_revision", "network_revision", "operation", "seal", "release"}
	d := json.NewDecoder(bytes.NewReader(raw))
	_, _ = d.Token()
	fields := map[string]json.RawMessage{}
	for d.More() {
		key, _ := d.Token()
		name := key.(string)
		if !slices.Contains(required, name) || fields[name] != nil {
			return req, rejected("INVALID_REQUEST", "Hive switch field=%s rejected; required=unique fixed fields", name)
		}
		var v json.RawMessage
		_ = d.Decode(&v)
		fields[name] = v
	}
	for _, name := range required {
		if fields[name] == nil {
			return req, rejected("INVALID_REQUEST", "Hive switch field=%s missing; explicit null required for unused remote parameters", name)
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req.Switch); err != nil {
		return req, rejected("INVALID_REQUEST", "Hive switch parameter types rejected: %s", err)
	}
	for _, v := range []int64{req.Switch.BindingRevision, req.Switch.NetworkRevision} {
		if v < 0 || v > 9007199254740991 {
			return req, rejected("INVALID_REQUEST", "Hive switch revision=%d rejected; required=nonnegative safe integer", v)
		}
	}
	if req.Switch.Operation != nil {
		v, err := beewire.DecodeDeviceDrainRequest(fields["operation"])
		if err != nil {
			return req, rejected("INVALID_REQUEST", "%s", err)
		}
		req.Switch.Operation = &v
	}
	if req.Switch.Seal != nil {
		v, err := beewire.DecodeDeviceDrainSealRequest(fields["seal"])
		if err != nil {
			return req, rejected("INVALID_REQUEST", "%s", err)
		}
		req.Switch.Seal = &v
	}
	if req.Switch.Release != nil {
		v, err := beewire.DecodeDeviceDrainReleaseRequest(fields["release"])
		if err != nil {
			return req, rejected("INVALID_REQUEST", "%s", err)
		}
		req.Switch.Release = &v
	}
	if !slices.Contains([]string{"inspect", "capabilities", "freeze", "drain_begin", "drain_status", "drain_seal", "drain_release", "stop", "connect", "commit"}, req.Switch.Action) {
		return req, rejected("INVALID_REQUEST", "Hive switch action rejected: bytes=%d; required=fixed coordinator action", len(req.Switch.Action))
	}
	if req.Switch.ProfileID == "" || req.Switch.Instance == "" {
		return req, rejected("INVALID_REQUEST", "Hive switch native context absent: profile_present=%t instance_present=%t", req.Switch.ProfileID != "", req.Switch.Instance != "")
	}
	return req, nil
}
func switchProfileID(devices Devices) string {
	if d, ok := devices.(interface{ ProfileDirectory() string }); ok {
		if directory := d.ProfileDirectory(); directory != "" {
			return filepath.Base(directory)
		}
	}
	return ""
}
func switchResult(ctx context.Context, runner SwitchRuntime, req request, instance, profile string) (any, error) {
	if req.Switch.Instance != instance || req.Switch.ProfileID != profile {
		return nil, fmt.Errorf("Hive switch owner context changed: instance_match=%t profile_match=%t", req.Switch.Instance == instance, req.Switch.ProfileID == profile)
	}
	value, err := runner.SwitchControl(ctx, req.Switch)
	return struct {
		Switch bee.DesktopSwitchView `json:"switch"`
	}{value}, err
}
