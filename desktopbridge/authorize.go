package desktopbridge

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	bee "github.com/tokhive/bee/agent"
	"slices"
)

type Authorizer interface {
	Start(context.Context, bee.DesktopAuthorizeRequest) (bee.DesktopOperation, error)
	Status(context.Context, string) (bee.DesktopOperation, error)
	Cancel(context.Context, string) (bee.DesktopOperation, error)
}

var authorizeMethods = []string{"authorize_start", "authorize_status", "authorize_cancel"}
var codexLoginMethods = []string{"authorize_progress", "authorize_open"}

type CodexLoginAuthorizer interface {
	Progress(context.Context, string) (bee.DesktopLoginProgress, error)
	Open(context.Context, string) (bee.DesktopLoginOpenReceipt, error)
}

// Decode exact keys before structs so duplicate and case-aliased fields cannot
// replace a validated source, program or revision later in the frame.
func authorizeFields(raw json.RawMessage, allowed []string) (map[string]json.RawMessage, *protocolError) {
	d := json.NewDecoder(bytes.NewReader(raw))
	first, _ := d.Token()
	if first != json.Delim('{') {
		return nil, rejected("INVALID_REQUEST", "authorization params/source requires object")
	}
	fields := map[string]json.RawMessage{}
	for d.More() {
		key, _ := d.Token()
		name := key.(string)
		if !slices.Contains(allowed, name) {
			return nil, rejected("INVALID_REQUEST", "authorization unknown field at index=%d", len(fields))
		}
		if _, ok := fields[name]; ok {
			return nil, rejected("INVALID_REQUEST", "authorization repeated field=%s", name)
		}
		var value json.RawMessage
		_ = d.Decode(&value)
		fields[name] = value
	}
	for _, name := range allowed {
		if _, ok := fields[name]; !ok {
			return nil, rejected("INVALID_REQUEST", "authorization missing field=%s", name)
		}
	}
	return fields, nil
}
func decodeAuthorizeParams(req request, raw json.RawMessage) (request, *protocolError) {
	allowed := []string{"operation_id"}
	if req.Method == "authorize_start" {
		allowed = []string{"platform", "source", "expected_revision"}
	}
	fields, err := authorizeFields(raw, allowed)
	if err != nil {
		return req, err
	}
	if req.Method != "authorize_start" {
		if json.Unmarshal(fields["operation_id"], &req.OperationID) != nil {
			return req, rejected("INVALID_REQUEST", "authorization operation_id requires string")
		}
		raw, err := hex.DecodeString(req.OperationID)
		if err != nil || len(raw) != 24 || hex.EncodeToString(raw) != req.OperationID {
			return req, rejected("INVALID_REQUEST", "authorization operation_id requires 48 lowercase hex")
		}
		return req, nil
	}
	source, err := authorizeFields(fields["source"], []string{"directory", "store"})
	if err != nil {
		return req, err
	}
	if json.Unmarshal(fields["platform"], &req.Authorize.Platform) != nil || json.Unmarshal(source["directory"], &req.Authorize.Source.Directory) != nil || json.Unmarshal(source["store"], &req.Authorize.Source.Store) != nil {
		return req, rejected("INVALID_REQUEST", "authorization platform, directory or store has wrong JSON type")
	}
	revision := bytes.TrimSpace(fields["expected_revision"])
	if bytes.Equal(revision, []byte("null")) || json.Unmarshal(revision, &req.Authorize.ExpectedRevision) != nil || req.Authorize.ExpectedRevision < 0 || req.Authorize.ExpectedRevision > 9007199254740991 {
		return req, rejected("INVALID_REQUEST", "authorization expected_revision requires nonnegative safe integer")
	}
	if e := (bee.DesktopAccountDetectRequest{Platform: req.Authorize.Platform, Directory: req.Authorize.Source.Directory, Store: req.Authorize.Source.Store, Mode: "local"}).Validate(); e != nil {
		return req, rejected("INVALID_REQUEST", "%s", e)
	}
	return req, nil
}
func authorizeResult(ctx context.Context, service Authorizer, req request) (any, error) {
	if slices.Contains(codexLoginMethods, req.Method) {
		extension, ok := service.(CodexLoginAuthorizer)
		if !ok {
			return nil, fmt.Errorf("login extension unavailable: method=%s", req.Method)
		}
		if req.Method == "authorize_progress" {
			progress, err := extension.Progress(ctx, req.OperationID)
			return struct {
				Progress bee.DesktopLoginProgress `json:"progress"`
			}{progress}, err
		}
		opened, err := extension.Open(ctx, req.OperationID)
		return struct {
			Open bee.DesktopLoginOpenReceipt `json:"open"`
		}{opened}, err
	}
	var op bee.DesktopOperation
	var err error
	switch req.Method {
	case "authorize_start":
		op, err = service.Start(ctx, req.Authorize)
	case "authorize_status":
		op, err = service.Status(ctx, req.OperationID)
	case "authorize_cancel":
		op, err = service.Cancel(ctx, req.OperationID)
	}
	return struct {
		Operation bee.DesktopOperation `json:"operation"`
	}{op}, err
}
