package desktopbridge

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"unicode/utf8"
)

const (
	protocolVersion = 1
	maxFrameBytes   = 1 << 20 // Excludes the terminating newline.
)

type request struct {
	Protocol int
	ID       string
	Method   string
	Hive     string
	Name     string
	Platform string
	Paused   bool
}

type protocolError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *protocolError) Error() string { return e.Code + ": " + e.Message }

func rejected(code, format string, args ...any) *protocolError {
	return &protocolError{Code: code, Message: fmt.Sprintf(format, args...)}
}

type reply struct {
	Protocol int            `json:"protocol"`
	ID       string         `json:"id"`
	Instance string         `json:"instance"`
	Result   any            `json:"result,omitempty"`
	Error    *protocolError `json:"error,omitempty"`
}

func decodeRequest(frame []byte) (request, *protocolError) {
	var req request
	if !utf8.Valid(frame) {
		return req, rejected("INVALID_UTF8", "frame contains invalid UTF-8; bytes=%d", len(frame))
	}
	if !json.Valid(frame) {
		var raw json.RawMessage
		err := json.Unmarshal(frame, &raw)
		var offset int64
		if syntax, ok := err.(*json.SyntaxError); ok {
			offset = syntax.Offset
		}
		// JSON error strings may quote payload bytes. Only report the offset.
		return req, rejected("INVALID_JSON", "JSON syntax check failed at byte=%d; frame bytes=%d", offset, len(frame))
	}
	decoder := json.NewDecoder(bytes.NewReader(frame))
	first, _ := decoder.Token() // json.Valid already checked the complete frame.
	if first != json.Delim('{') {
		return req, rejected("INVALID_REQUEST", "frame root must be an object; frame bytes=%d", len(frame))
	}
	fields := make(map[string]json.RawMessage, 4)
	var fieldProblem *protocolError
	fieldIndex, idCount := 0, 0
	for decoder.More() {
		fieldIndex++
		key, _ := decoder.Token()
		name := key.(string)
		if name == "id" {
			idCount++
		}
		var value json.RawMessage
		_ = decoder.Decode(&value)
		if _, exists := fields[name]; exists {
			if fieldProblem == nil {
				fieldProblem = rejected("INVALID_REQUEST", "object field at index=%d is repeated; required=unique fields", fieldIndex)
			}
			continue
		}
		switch name {
		case "protocol", "id", "method", "params":
		default:
			if fieldProblem == nil {
				fieldProblem = rejected("INVALID_REQUEST", "object field at index=%d is unknown; allowed=protocol,id,method,params", fieldIndex)
			}
			continue
		}
		fields[name] = value
	}
	if idCount == 1 {
		_ = json.Unmarshal(fields["id"], &req.ID)
	}
	if fieldProblem != nil {
		return req, fieldProblem
	}
	if fields["id"] == nil {
		return req, rejected("INVALID_REQUEST", "id field is missing; required=nonempty string")
	}
	if json.Unmarshal(fields["id"], &req.ID) != nil {
		return req, rejected("INVALID_REQUEST", "id field has a non-string JSON type; required=nonempty string")
	}
	if req.ID == "" {
		return req, rejected("INVALID_REQUEST", "id decodes to an empty string; required=nonempty string")
	}
	if fields["protocol"] == nil {
		return req, rejected("INVALID_REQUEST", "protocol field is missing; required=%d", protocolVersion)
	}
	if bytes.Equal(fields["protocol"], []byte("null")) {
		return req, rejected("INVALID_REQUEST", "protocol is null; required=integer %d", protocolVersion)
	}
	if json.Unmarshal(fields["protocol"], &req.Protocol) != nil {
		return req, rejected("INVALID_REQUEST", "protocol is not a representable integer; required=%d", protocolVersion)
	}
	if fields["method"] == nil {
		return req, rejected("INVALID_REQUEST", "method field is missing; required=hello,ping,shutdown")
	}
	if json.Unmarshal(fields["method"], &req.Method) != nil {
		return req, rejected("INVALID_REQUEST", "method field has a non-string JSON type; required=hello,ping,shutdown")
	}
	if req.Method == "" {
		return req, rejected("INVALID_REQUEST", "method decodes to an empty string; required=hello,ping,shutdown")
	}
	var params map[string]json.RawMessage
	if fields["params"] == nil {
		return req, rejected("INVALID_REQUEST", "params field is missing; required={}")
	}
	if json.Unmarshal(fields["params"], &params) != nil {
		return req, rejected("INVALID_REQUEST", "params has a non-object JSON type; required={}")
	}
	if params == nil {
		return req, rejected("INVALID_REQUEST", "params is null; required={}")
	}
	if req.Method == "supply_status" || req.Method == "supply_set_paused" {
		decoder := json.NewDecoder(bytes.NewReader(fields["params"]))
		_, _ = decoder.Token()
		seen := map[string]bool{}
		for decoder.More() {
			key, _ := decoder.Token()
			name := key.(string)
			if name != "platform" && !(name == "paused" && req.Method == "supply_set_paused") {
				return req, rejected("INVALID_REQUEST", "supply params field at index=%d is unknown; allowed=platform and paused only for supply_set_paused", len(seen)+1)
			}
			if seen[name] {
				return req, rejected("INVALID_REQUEST", "supply params field=%s is repeated; required=unique fields", name)
			}
			seen[name] = true
			var value json.RawMessage
			_ = decoder.Decode(&value)
			// The full frame is valid JSON. Classify only its leading token;
			// never include an unknown value in a parameter rejection.
			actualType := "number"
			switch bytes.TrimSpace(value)[0] {
			case 'n':
				actualType = "null"
			case '"':
				actualType = "string"
			case 't', 'f':
				actualType = "boolean"
			case '{':
				actualType = "object"
			case '[':
				actualType = "array"
			}
			if name == "platform" {
				if actualType == "null" {
					return req, rejected("INVALID_REQUEST", "supply platform is null; actual type=null; required=string enum openai,claude")
				}
				if actualType != "string" {
					return req, rejected("INVALID_REQUEST", "supply platform JSON type rejected; actual type=%s; required=string", actualType)
				}
				_ = json.Unmarshal(value, &req.Platform)
				if req.Platform != "openai" && req.Platform != "claude" {
					return req, rejected("INVALID_REQUEST", "supply platform enum rejected; actual type=string, string bytes=%d; required=openai,claude", len(req.Platform))
				}
			} else {
				if actualType != "boolean" {
					return req, rejected("INVALID_REQUEST", "supply paused JSON type rejected; actual type=%s; required=explicit boolean", actualType)
				}
				_ = json.Unmarshal(value, &req.Paused)
			}
		}
		if !seen["platform"] {
			return req, rejected("INVALID_REQUEST", "supply platform field is missing; required=openai,claude")
		}
		if req.Method == "supply_set_paused" && !seen["paused"] {
			return req, rejected("INVALID_REQUEST", "supply paused field is missing; required=explicit boolean")
		}
		return req, nil
	}
	if req.Method == "device_begin" {
		decoder := json.NewDecoder(bytes.NewReader(fields["params"]))
		_, _ = decoder.Token()
		seen := map[string]bool{}
		for decoder.More() {
			key, _ := decoder.Token()
			name := key.(string)
			if seen[name] {
				return req, rejected("INVALID_REQUEST", "device params has a repeated field; required=unique hive,name")
			}
			seen[name] = true
			var value json.RawMessage
			_ = decoder.Decode(&value)
			if name != "hive" && name != "name" {
				return req, rejected("INVALID_REQUEST", "device params has an unknown field; allowed=hive,name")
			}
			var text string
			if bytes.Equal(value, []byte("null")) || json.Unmarshal(value, &text) != nil || text == "" {
				return req, rejected("INVALID_REQUEST", "device params field is not a nonempty string; required=hive,name")
			}
			if name == "hive" {
				req.Hive = text
			} else {
				req.Name = text
			}
		}
		if len(seen) != 2 {
			return req, rejected("INVALID_REQUEST", "device params fields=%d; required=hive,name", len(seen))
		}
		return req, nil
	}
	if len(params) != 0 {
		return req, rejected("INVALID_REQUEST", "params contains fields=%d; required=0 fields", len(params))
	}
	return req, nil
}

// readFrame bounds allocations even when the peer never sends a newline.
func readFrame(in *bufio.Reader) ([]byte, *protocolError, error) {
	var frame []byte
	for {
		part, err := in.ReadSlice('\n')
		terminated := len(part) > 0 && part[len(part)-1] == '\n'
		if terminated {
			part = part[:len(part)-1]
		}
		if len(frame)+len(part) > maxFrameBytes {
			return nil, rejected("FRAME_TOO_LARGE", "frame bytes>=%d; maximum=%d before newline", len(frame)+len(part), maxFrameBytes), nil
		}
		frame = append(frame, part...)
		if terminated {
			return frame, nil, nil
		}
		if err == io.EOF {
			if len(frame) == 0 {
				return nil, nil, io.EOF
			}
			return nil, rejected("INCOMPLETE_FRAME", "input EOF after bytes=%d without required newline", len(frame)), nil
		}
		if err != nil && err != bufio.ErrBufferFull {
			return nil, nil, fmt.Errorf("read desktop frame after bytes=%d: %w", len(frame), err)
		}
	}
}
