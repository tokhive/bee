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
	"slices"
	"sync"

	bee "github.com/tokhive/bee/agent"
)

// Devices exposes only the two structured device operations to the transport.
type Devices interface {
	Status(context.Context) (bee.DeviceView, error)
	Begin(context.Context, string, string) (bee.DeviceView, error)
}

// Supplies is detected optionally so existing device-only implementations keep
// their original capabilities and RunWithDevices signature.
type DeviceRecovery interface {
	RecoveryPrepare(context.Context) (bee.DeviceRecoveryView, error)
	RecoveryConfirm(context.Context, string, int64, string) (bee.DeviceRecoveryView, error)
	RecoveryStatus(context.Context) (bee.DeviceRecoveryView, error)
}
type DeviceContext interface {
	Context(context.Context) (bee.DesktopDeviceContext, error)
}
type StartupVerifier interface{ VerifyStartup(context.Context) error }

type Supplies interface {
	SupplyStatus(context.Context, string) (bee.DesktopSupply, error)
	SetPaused(context.Context, string, bool) (bee.DesktopSupply, error)
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
	return RunWithAccounts(ctx, in, out, diagnostics, version, devices, nil)
}

func RunWithAccounts(ctx context.Context, in io.Reader, out io.Writer, diagnostics io.Writer, version string, devices Devices, accounts Accounts) (runErr error) {
	return RunWithRuntime(ctx, in, out, diagnostics, version, devices, accounts, nil)
}
func RunWithRuntime(ctx context.Context, in io.Reader, out io.Writer, diagnostics io.Writer, version string, devices Devices, accounts Accounts, runner Runtime) (runErr error) {
	return RunWithAuthorization(ctx, in, out, diagnostics, version, devices, accounts, runner, nil)
}
func RunWithAuthorization(ctx context.Context, in io.Reader, out io.Writer, diagnostics io.Writer, version string, devices Devices, accounts Accounts, runner Runtime, authorizer Authorizer) (runErr error) {
	return RunWithExperience(ctx, in, out, diagnostics, version, devices, accounts, runner, authorizer, nil, nil)
}

// RunWithExperience opts into diagnostics, read-only network and optional
// account notification facts without expanding earlier capability groups.
func RunWithExperience(ctx context.Context, in io.Reader, out io.Writer, diagnostics io.Writer, version string, devices Devices, accounts Accounts, runner Runtime, authorizer Authorizer, diagnosticService Diagnostics, network NetworkTester) (runErr error) {
	if diagnosticService != nil && runner == nil {
		return errors.New("diagnostics bridge requires the complete runtime capability group")
	}
	if authorizer != nil && runner == nil {
		return errors.New("authorization bridge requires the complete runtime capability group")
	}
	if runner != nil && accounts == nil {
		return errors.New("runtime bridge requires account service")
	}
	recoveries, hasRecovery := devices.(DeviceRecovery)
	contexts, hasContext := devices.(DeviceContext)
	verifier, hasVerifier := runner.(StartupVerifier)
	supplies, hasSupplies := devices.(Supplies)
	notifications, hasNotifications := accounts.(Notifications)
	hasNotifications = hasNotifications && (diagnosticService != nil || network != nil)
	if accounts != nil && !hasSupplies {
		return errors.New("account bridge requires the complete device and supply capability group")
	}
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
				if hasSupplies {
					capabilities = append(capabilities, "supply_status", "supply_set_paused")
				}
				if accounts != nil {
					capabilities = append(capabilities, "account_defaults", "account_detect", "account_snapshot", "account_action")
				}
				if runner != nil {
					capabilities = append(capabilities, runtimeMethods...)
				}
				if authorizer != nil {
					capabilities = append(capabilities, authorizeMethods...)
				}
				if diagnosticService != nil {
					capabilities = append(capabilities, diagnosticMethods...)
				}
				if network != nil {
					capabilities = append(capabilities, networkMethods...)
				}
				if hasNotifications {
					capabilities = append(capabilities, notificationMethods...)
				}
				if hasContext {
					capabilities = append(capabilities, "device_context")
				}
				if hasVerifier {
					capabilities = append(capabilities, "runtime_verify")
				}
				if hasRecovery {
					capabilities = append(capabilities, "device_recovery_prepare", "device_recovery_confirm", "device_recovery_status")
				}
				answer.Result = struct {
					Version      string   `json:"bee_version"`
					OS           string   `json:"os"`
					Arch         string   `json:"arch"`
					Capabilities []string `json:"capabilities"`
				}{version, runtime.GOOS, runtime.GOARCH, capabilities}
			case hasRecovery && slices.Contains([]string{"device_recovery_prepare", "device_recovery_confirm", "device_recovery_status"}, req.Method):
				var value bee.DeviceRecoveryView
				var err error
				switch req.Method {
				case "device_recovery_prepare":
					value, err = recoveries.RecoveryPrepare(ctx)
				case "device_recovery_confirm":
					value, err = recoveries.RecoveryConfirm(ctx, req.OperationID, req.RecoveryRevision, req.RecoveryDecision)
				default:
					value, err = recoveries.RecoveryStatus(ctx)
				}
				if err != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{operationFailure("DEVICE_RECOVERY_FAILED", err)}
				} else {
					answer.Result = struct {
						Recovery bee.DeviceRecoveryView `json:"recovery"`
					}{value}
				}
			case hasContext && req.Method == "device_context":
				value, err := contexts.Context(ctx)
				if err != nil {
					answer.Result = struct {
						Error           *protocolError `json:"error"`
						BindingRevision int64          `json:"binding_revision,omitempty"`
					}{operationFailure("DEVICE_CONTEXT_FAILED", err), value.BindingRevision}
				} else {
					answer.Result = struct {
						Context bee.DesktopDeviceContext `json:"context"`
					}{value}
				}
			case hasVerifier && req.Method == "runtime_verify":
				if err := verifier.VerifyStartup(ctx); err != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{operationFailure("STARTUP_DATA_INVALID", err)}
				} else {
					answer.Result = struct {
						Verified bool `json:"verified"`
					}{true}
				}
			case req.Method == "ping":
				answer.Result = struct {
					Alive bool `json:"alive"`
				}{true}
			case hasNotifications && slices.Contains(notificationMethods, req.Method):
				value, err := notificationsResult(ctx, notifications)
				if err != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{rejected("NOTIFICATIONS_OPERATION_FAILED", "%s", err)}
				} else {
					answer.Result = value
				}
			case diagnosticService != nil && slices.Contains(diagnosticMethods, req.Method):
				value, err := diagnosticsResult(ctx, diagnosticService, req, instance)
				if err != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{rejected("DIAGNOSTICS_OPERATION_FAILED", "%s", err)}
				} else {
					answer.Result = value
				}
			case network != nil && slices.Contains(networkMethods, req.Method):
				value, err := networkResult(ctx, network, req)
				if err != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{rejected("NETWORK_OPERATION_FAILED", "%s", err)}
				} else {
					answer.Result = value
				}
			case authorizer != nil && slices.Contains(authorizeMethods, req.Method):
				value, err := authorizeResult(ctx, authorizer, req)
				if err != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{rejected("AUTHORIZE_OPERATION_FAILED", "%s", err)}
				} else {
					answer.Result = value
				}
			case runner != nil && slices.Contains(runtimeMethods, req.Method):
				value, err := runtimeResult(ctx, runner, req)
				if err != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{rejected("RUNTIME_OPERATION_FAILED", "%s", err)}
				} else {
					answer.Result = value
				}
			case accounts != nil && (req.Method == "account_defaults" || req.Method == "account_detect" || req.Method == "account_snapshot" || req.Method == "account_action"):
				var value any
				var operationErr error
				if req.Method == "account_defaults" {
					var defaults bee.DesktopAccountDefaults
					defaults, operationErr = accounts.Defaults(ctx)
					value = struct {
						Defaults bee.DesktopAccountDefaults `json:"defaults"`
					}{defaults}
				} else {
					var snapshot bee.DesktopAccountSnapshot
					switch req.Method {
					case "account_detect":
						snapshot, operationErr = accounts.Detect(ctx, req.Detect)
					case "account_snapshot":
						snapshot, operationErr = accounts.Snapshot(ctx, req.Platform, req.Refresh)
					case "account_action":
						snapshot, operationErr = accounts.Action(ctx, req.Action)
					}
					value = struct {
						Account bee.DesktopAccountSnapshot `json:"account"`
					}{snapshot}
				}
				if operationErr != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{rejected("ACCOUNT_OPERATION_FAILED", "%s", operationErr)}
				} else {
					answer.Result = value
				}
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
					}{operationFailure("DEVICE_OPERATION_FAILED", operationErr)}
				} else {
					answer.Result = struct {
						Device bee.DeviceView `json:"device"`
					}{view}
				}
			case hasSupplies && (req.Method == "supply_status" || req.Method == "supply_set_paused"):
				var supply bee.DesktopSupply
				var operationErr error
				if req.Method == "supply_status" {
					supply, operationErr = supplies.SupplyStatus(ctx, req.Platform)
				} else {
					supply, operationErr = supplies.SetPaused(ctx, req.Platform, req.Paused)
				}
				if operationErr != nil {
					answer.Result = struct {
						Error *protocolError `json:"error"`
					}{operationFailure("SUPPLY_OPERATION_FAILED", operationErr)}
				} else {
					answer.Result = struct {
						Supply bee.DesktopSupply `json:"supply"`
					}{supply}
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
