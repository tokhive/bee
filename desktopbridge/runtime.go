package desktopbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"slices"

	bee "github.com/tokhive/bee/agent"
)

type Runtime interface {
	Restore(context.Context) (bee.DesktopOperation, error)
	Snapshot(context.Context) (bee.DesktopRuntimeSnapshot, error)
	Start(context.Context, bee.DesktopStartRequest) (bee.DesktopOperation, error)
	Stop(context.Context, bee.DesktopStopRequest) (bee.DesktopOperation, error)
	ConfigureNetwork(context.Context, bee.DesktopNetworkConfig) error
}

type PresenceRuntime interface {
	EnablePresence(context.Context, bee.DesktopPresenceRequest) error
}

var runtimeMethods = []string{"runtime_snapshot", "runtime_start", "runtime_stop", "runtime_configure_network", "runtime_restore", "runtime_enable_presence"}

func decodeRuntimeParams(req request, raw json.RawMessage) (request, *protocolError) {
	required := map[string][]string{"runtime_snapshot": {}, "runtime_restore": {}, "runtime_start": {"expected_revision", "resume_platforms"}, "runtime_stop": {"expected_revision", "reason"}, "runtime_configure_network": {"revision", "connect_proxy"}, "runtime_enable_presence": {"binding_revision", "network_revision"}}[req.Method]
	d := json.NewDecoder(bytes.NewReader(raw))
	_, _ = d.Token()
	fields := map[string]json.RawMessage{}
	for d.More() {
		key, _ := d.Token()
		name := key.(string)
		if !slices.Contains(required, name) {
			return req, rejected("INVALID_REQUEST", "runtime params unknown field at index=%d", len(fields))
		}
		if _, ok := fields[name]; ok {
			return req, rejected("INVALID_REQUEST", "runtime params repeated field=%s", name)
		}
		var value json.RawMessage
		_ = d.Decode(&value)
		fields[name] = value
	}
	for _, name := range required {
		if len(fields[name]) == 0 || bytes.Equal(bytes.TrimSpace(fields[name]), []byte("null")) {
			return req, rejected("INVALID_REQUEST", "runtime field=%s is missing or null; explicit value required", name)
		}
	}
	revision := func(name string) (int64, *protocolError) {
		var v int64
		if json.Unmarshal(fields[name], &v) != nil || v < 0 || v > 9007199254740991 {
			return 0, rejected("INVALID_REQUEST", "runtime field=%s requires nonnegative safe integer", name)
		}
		return v, nil
	}
	switch req.Method {
	case "runtime_enable_presence":
		binding, e := revision("binding_revision")
		if e != nil {
			return req, e
		}
		network, e := revision("network_revision")
		if e != nil {
			return req, e
		}
		req.Presence = bee.DesktopPresenceRequest{BindingRevision: binding, NetworkRevision: network}
	case "runtime_start":
		v, e := revision("expected_revision")
		if e != nil {
			return req, e
		}
		req.Start.ExpectedRevision = v
		if json.Unmarshal(fields["resume_platforms"], &req.Start.ResumePlatforms) != nil || len(req.Start.ResumePlatforms) > 2 {
			return req, rejected("INVALID_REQUEST", "resume_platforms requires at most two platform strings")
		}
		seen := map[string]bool{}
		for _, p := range req.Start.ResumePlatforms {
			if (p != "openai" && p != "claude") || seen[p] {
				return req, rejected("INVALID_REQUEST", "resume_platforms has duplicate or unknown platform")
			}
			seen[p] = true
		}
	case "runtime_stop":
		v, e := revision("expected_revision")
		if e != nil {
			return req, e
		}
		req.Stop.ExpectedRevision = v
		if json.Unmarshal(fields["reason"], &req.Stop.Reason) != nil || !slices.Contains([]string{"user_stop", "app_exit", "update", "network_change", "startup_recovery"}, req.Stop.Reason) {
			return req, rejected("INVALID_REQUEST", "stop reason outside fixed lifecycle reasons")
		}
	case "runtime_configure_network":
		v, e := revision("revision")
		if e != nil {
			return req, e
		}
		req.Network.Revision = v
		if json.Unmarshal(fields["connect_proxy"], &req.Network.ConnectProxy) != nil {
			return req, rejected("INVALID_REQUEST", "connect_proxy requires string")
		}
	}
	return req, nil
}
func runtimeResult(ctx context.Context, service Runtime, req request) (any, error) {
	switch req.Method {
	case "runtime_enable_presence":
		presence, ok := service.(PresenceRuntime)
		if !ok {
			return nil, fmt.Errorf("presence runtime unavailable: required=EnablePresence service")
		}
		err := presence.EnablePresence(ctx, req.Presence)
		return struct {
			Enabled bool `json:"enabled"`
		}{err == nil}, err
	case "runtime_snapshot":
		v, e := service.Snapshot(ctx)
		return struct {
			Runtime bee.DesktopRuntimeSnapshot `json:"runtime"`
		}{v}, e
	case "runtime_restore":
		v, e := service.Restore(ctx)
		return struct {
			Operation bee.DesktopOperation `json:"operation"`
		}{v}, e
	case "runtime_start":
		v, e := service.Start(ctx, req.Start)
		return struct {
			Operation bee.DesktopOperation `json:"operation"`
		}{v}, e
	case "runtime_stop":
		v, e := service.Stop(ctx, req.Stop)
		return struct {
			Operation bee.DesktopOperation `json:"operation"`
		}{v}, e
	default:
		e := service.ConfigureNetwork(ctx, req.Network)
		return struct {
			Configured bool `json:"configured"`
		}{e == nil}, e
	}
}
