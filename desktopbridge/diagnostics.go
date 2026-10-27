package desktopbridge

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"slices"

	bee "github.com/tokhive/bee/agent"
)

type Diagnostics interface {
	Start(context.Context, string) (bee.DesktopDiagnosticReport, error)
	Snapshot(context.Context, string) (bee.DesktopDiagnosticReport, error)
	Cancel(context.Context, string) (bee.DesktopDiagnosticReport, error)
}

var diagnosticMethods = []string{"diagnostics_start", "diagnostics_snapshot", "diagnostics_cancel"}

// The report ID temporarily occupies OperationID until the shared request
// registration adds a dedicated field. No instance or path comes from params.
func decodeDiagnosticsParams(req request, raw json.RawMessage) (request, *protocolError) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return req, rejected("INVALID_REQUEST", "diagnostics params root rejected; required=object")
	}
	seen := false
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return req, rejected("INVALID_REQUEST", "diagnostics parameter key is invalid")
		}
		key, ok := token.(string)
		if !ok || key != "id" || req.Method == "diagnostics_start" {
			return req, rejected("INVALID_REQUEST", "diagnostics parameter field rejected; required=fixed method fields")
		}
		if seen {
			return req, rejected("INVALID_REQUEST", "diagnostics report ID field repeated; required=unique id")
		}
		seen = true
		var rawID json.RawMessage
		if decoder.Decode(&rawID) != nil {
			return req, rejected("INVALID_REQUEST", "diagnostics report ID JSON is invalid")
		}
		if bytes.Equal(bytes.TrimSpace(rawID), []byte("null")) || json.Unmarshal(rawID, &req.OperationID) != nil {
			return req, rejected("INVALID_REQUEST", "diagnostics report ID type rejected; required=string")
		}
		id, err := hex.DecodeString(req.OperationID)
		if err != nil || len(id) != 24 || hex.EncodeToString(id) != req.OperationID {
			return req, rejected("INVALID_REQUEST", "diagnostics report ID format rejected: bytes=%d; required=48 lowercase hex characters", len(req.OperationID))
		}
	}
	if _, err := decoder.Token(); err != nil {
		return req, rejected("INVALID_REQUEST", "diagnostics params object is incomplete")
	}
	if !slices.Contains(diagnosticMethods, req.Method) {
		return req, rejected("INVALID_REQUEST", "diagnostics method outside fixed method set")
	}
	if req.Method != "diagnostics_start" && !seen {
		return req, rejected("INVALID_REQUEST", "diagnostics report ID missing; required=id")
	}
	return req, nil
}
func diagnosticsResult(ctx context.Context, service Diagnostics, req request, instance string) (any, error) {
	var report bee.DesktopDiagnosticReport
	var err error
	switch req.Method {
	case "diagnostics_start":
		report, err = service.Start(ctx, instance)
	case "diagnostics_snapshot":
		report, err = service.Snapshot(ctx, req.OperationID)
	case "diagnostics_cancel":
		report, err = service.Cancel(ctx, req.OperationID)
	default:
		return nil, rejected("INVALID_REQUEST", "diagnostics dispatch method outside fixed set")
	}
	return struct {
		Report bee.DesktopDiagnosticReport `json:"report"`
	}{report}, err
}
