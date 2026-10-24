// Package desktopbridge implements the private desktop management transport.
package desktopbridge

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"runtime"
	"sync"

	bee "github.com/tokhive/bee/agent"
)

// Devices exposes only the two structured device operations to the transport.
type Devices interface {
	Status(context.Context) (bee.DeviceView, error)
	Begin(context.Context, string, string) (bee.DeviceView, error)
}

// Run serves a single management session without starting Bee's contribution
// runtime or accessing its configuration. It never closes caller-owned streams.
// The owner must unblock any pending Read/Write on cancellation. Run joins its
// response writer before returning, so no transport goroutine outlives the call.
func Run(ctx context.Context, in io.Reader, out io.Writer, diagnostics io.Writer, version string) error {
	return RunWithDevices(ctx, in, out, diagnostics, version, nil)
}

// Device operations are opt-in. Hello and ping never access device state.
func RunWithDevices(ctx context.Context, in io.Reader, out io.Writer, diagnostics io.Writer, version string, devices Devices) (runErr error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return fmt.Errorf("generate desktop instance identifier: %w", err)
	}
	instance := hex.EncodeToString(nonce[:])
	var pendingMu sync.Mutex
	pending := make(map[string]bool)
	type response struct {
		frame     []byte
		id        string
		releaseID bool
	}
	responses := make(chan response, 16)
	writerDone := make(chan struct{})
	var writerErr error // Read only after writerDone is closed.
	go func() {
		defer close(writerDone)
		for response := range responses {
			if err := ctx.Err(); err != nil {
				writerErr = err
				return
			}
			written, err := out.Write(response.frame)
			if err == nil && written != len(response.frame) {
				err = io.ErrShortWrite
			}
			if err != nil {
				writerErr = fmt.Errorf("write desktop response bytes=%d; required=%d: %w", written, len(response.frame), err)
				return
			}
			if response.releaseID {
				pendingMu.Lock()
				delete(pending, response.id)
				pendingMu.Unlock()
			}
		}
	}()
	defer func() {
		close(responses)
		<-writerDone
		if writerErr != nil {
			runErr = errors.Join(runErr, writerErr)
		}
		if ctx.Err() != nil {
			runErr = errors.Join(runErr, ctx.Err())
		}
		if runErr != nil && !errors.Is(runErr, context.Canceled) {
			if _, err := fmt.Fprintln(diagnostics, runErr); err != nil {
				runErr = errors.Join(runErr, fmt.Errorf("write desktop diagnostics: %w", err))
			}
		}
	}()
	reader := bufio.NewReaderSize(in, 32*1024)
	ready := false
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		select {
		case <-writerDone:
			return nil
		default:
		}
		frame, frameErr, err := readFrame(reader)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		var req request
		problem := frameErr
		if problem == nil {
			req, problem = decodeRequest(frame)
		}
		answer := reply{Protocol: protocolVersion, ID: req.ID, Instance: instance}
		releaseID := false
		if req.ID != "" {
			pendingMu.Lock()
			if pending[req.ID] {
				problem = rejected("DUPLICATE_ID", "id already has an unfinished response; required=no pending ID reuse")
			} else {
				pending[req.ID] = true
				releaseID = true
			}
			pendingMu.Unlock()
		}
		shutdown := false
		if problem == nil {
			switch {
			case req.Protocol != protocolVersion:
				problem = rejected("VERSION_MISMATCH", "protocol=%d; required=%d", req.Protocol, protocolVersion)
			case !ready && req.Method != "hello":
				problem = rejected("NOT_READY", "hello handshake has not succeeded; required=hello before other methods")
			case req.Method == "hello" && ready:
				problem = rejected("ALREADY_READY", "hello handshake has already succeeded for this instance")
			case req.Method == "hello":
				ready = true
				capabilities := []string{"ping", "shutdown"}
				if devices != nil {
					capabilities = append(capabilities, "device_status", "device_begin")
				}
				answer.Result = struct {
					Version      string   `json:"bee_version"`
					OS           string   `json:"os"`
					Arch         string   `json:"arch"`
					Capabilities []string `json:"capabilities"`
				}{version, runtime.GOOS, runtime.GOARCH, capabilities}
			case req.Method == "ping":
				answer.Result = struct {
					Alive bool `json:"alive"`
				}{true}
			case devices != nil && (req.Method == "device_status" || req.Method == "device_begin"):
				var view bee.DeviceView
				var operationErr error
				if req.Method == "device_status" {
					view, operationErr = devices.Status(ctx)
				} else {
					view, operationErr = devices.Begin(ctx, req.Hive, req.Name)
				}
				if operationErr != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{rejected("DEVICE_OPERATION_FAILED", "%s", operationErr)}
				} else {
					answer.Result = struct {
						Device bee.DeviceView `json:"device"`
					}{view}
				}
			case req.Method == "shutdown":
				answer.Result = struct {
					Stopped bool `json:"stopped"`
				}{true}
				shutdown = true
			default:
				problem = rejected("UNKNOWN_METHOD", "method is unrecognized; allowed=hello,ping,shutdown")
			}
		}
		answer.Error = problem
		encoded, err := json.Marshal(answer)
		if err != nil {
			return fmt.Errorf("encode desktop response: %w", err)
		}
		if len(encoded) > maxFrameBytes {
			// JSON string escaping can expand even a legal input frame beyond
			// the output limit. Do not echo its oversized ID or process more input.
			frameErr = rejected("FRAME_TOO_LARGE", "encoded response bytes=%d; maximum=%d before newline", len(encoded), maxFrameBytes)
			encoded, err = json.Marshal(reply{Protocol: protocolVersion, ID: "", Instance: instance, Error: frameErr})
			if err != nil {
				return fmt.Errorf("encode desktop frame limit error: %w", err)
			}
		}
		encoded = append(encoded, '\n')
		select {
		case responses <- response{frame: encoded, id: req.ID, releaseID: releaseID}:
		case <-writerDone:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
		if frameErr != nil {
			return frameErr
		}
		if shutdown {
			return nil
		}
	}
}
