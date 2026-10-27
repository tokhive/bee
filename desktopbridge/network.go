package desktopbridge

import (
	"bytes"
	"context"
	"encoding/json"

	bee "github.com/tokhive/bee/agent"
)

// NetworkTester is independent of paired devices, authorization and runtime
// start/stop. It accepts a proxy draft and fixed read-only checks only.
type NetworkTester interface {
	Test(context.Context, bee.DesktopNetworkTestRequest) (bee.DesktopNetworkTestResult, error)
	Status(context.Context) (bee.DesktopNetworkStatus, error)
}

var networkMethods = []string{"network_status", "network_test"}

func decodeNetworkParams(req request, raw json.RawMessage) (request, *protocolError) {
	if req.Method == "network_test" {
		input, err := decodeNetworkTestParams(raw)
		req.NetworkTest = input
		return req, err
	}
	if !json.Valid(raw) || !bytes.Equal(bytes.TrimSpace(raw), []byte("{}")) {
		// Whitespace inside an empty object is legal JSON as well.
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil || fields == nil || len(fields) != 0 {
			return req, rejected("INVALID_REQUEST", "network status params must be an empty object; no endpoint or proxy input allowed")
		}
	}
	return req, nil
}

func decodeNetworkTestParams(raw json.RawMessage) (bee.DesktopNetworkTestRequest, *protocolError) {
	var input bee.DesktopNetworkTestRequest
	if !json.Valid(raw) {
		return input, rejected("INVALID_REQUEST", "network params failed JSON syntax validation; bytes=%d", len(raw))
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	first, _ := decoder.Token()
	if first != json.Delim('{') {
		return input, rejected("INVALID_REQUEST", "network params root is not an object; required=proxy draft object")
	}
	seen := false
	for decoder.More() {
		key, _ := decoder.Token()
		if key != "proxy" {
			return input, rejected("INVALID_REQUEST", "network params contains an unknown field; allowed=proxy only")
		}
		if seen {
			return input, rejected("INVALID_REQUEST", "network params repeats proxy; required=one proxy field")
		}
		seen = true
		var value json.RawMessage
		_ = decoder.Decode(&value)
		value = bytes.TrimSpace(value)
		if len(value) == 0 || value[0] != '"' {
			return input, rejected("INVALID_REQUEST", "network proxy has non-string JSON type; required=string including explicit empty string")
		}
		_ = json.Unmarshal(value, &input.Proxy)
	}
	if !seen {
		return input, rejected("INVALID_REQUEST", "network proxy field is missing; required=explicit string")
	}
	if err := bee.ValidateDesktopConnectProxy(input.Proxy); err != nil {
		return input, rejected("INVALID_REQUEST", "%s", err)
	}
	return input, nil
}

func networkTestResult(ctx context.Context, service NetworkTester, input bee.DesktopNetworkTestRequest) (any, error) {
	value, err := service.Test(ctx, input)
	return struct {
		NetworkTest bee.DesktopNetworkTestResult `json:"network_test"`
	}{value}, err
}

func networkResult(ctx context.Context, service NetworkTester, req request) (any, error) {
	if req.Method == "network_test" {
		return networkTestResult(ctx, service, req.NetworkTest)
	}
	value, err := service.Status(ctx)
	return struct {
		Network bee.DesktopNetworkStatus `json:"network"`
	}{value}, err
}
