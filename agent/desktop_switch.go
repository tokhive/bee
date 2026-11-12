package bee

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/tokhive/bee/beewire"
)

// DesktopSwitchRequest is private native IPC. The App persists original remote
// parameters before sending; these methods never invent IDs or retry writes.
// Instance/profile are checked by the transport, binding/network by this owner.
type DesktopSwitchRequest struct {
	Action          string                             `json:"action"`
	ProfileID       string                             `json:"profile_id"`
	Instance        string                             `json:"instance"`
	BindingRevision int64                              `json:"binding_revision"`
	NetworkRevision int64                              `json:"network_revision"`
	Operation       *beewire.DeviceDrainRequest        `json:"operation"`
	Seal            *beewire.DeviceDrainSealRequest    `json:"seal"`
	Release         *beewire.DeviceDrainReleaseRequest `json:"release"`
}
type DesktopSwitchView struct {
	Mode               DesktopProfileMode               `json:"mode"`
	BindingRevision    int64                            `json:"binding_revision"`
	NetworkRevision    int64                            `json:"network_revision"`
	Epoch              string                           `json:"epoch"`
	Lease              string                           `json:"lease"`
	Connection         string                           `json:"connection"`
	Frozen             bool                             `json:"frozen"`
	MaintenanceAllowed bool                             `json:"maintenance_allowed"`
	WorkersStopped     bool                             `json:"workers_stopped"`
	SealPersisted      bool                             `json:"seal_persisted"`
	Capabilities       *beewire.DeviceDrainCapabilities `json:"capabilities"`
	Drain              *beewire.DeviceDrainStatus       `json:"drain"`
}
type desktopSwitchSeal struct {
	// Written only by the native trusted commit after the original release is
	// confirmed. The receipt remains historical; ordinary retirement may then
	// advance the current epoch under its own durable proof.
	AdmissionCompleted bool                      `json:"admission_completed"`
	Released           bool                      `json:"released"`
	Version            int                       `json:"version"`
	Binding            string                    `json:"binding"`
	OriginalEpoch      string                    `json:"original_epoch"`
	Status             beewire.DeviceDrainStatus `json:"status"`
	WorkersStopped     bool                      `json:"workers_stopped"`
}
type desktopSwitchLifecycle struct {
	writes       sync.RWMutex
	sealing      atomic.Bool
	sealSaved    atomic.Bool
	serial       sync.Mutex
	frozen       atomic.Bool
	maintenance  atomic.Bool
	initialized  bool
	committed    string
	proof        *desktopSwitchSeal
	socket       *websocket.Conn
	socketCancel context.CancelFunc
	socketDone   chan struct{}
	lease        string
	epoch        string
}

func (r *DesktopRuntime) SwitchMaintenanceAllowed() bool { return r.switchAllowsMaintenance() }
func (r *DesktopRuntime) switchAllowsMaintenance() bool {
	return r.device.ProfileMode() != DesktopProfilePrepare && (r.device.ProfileMode() == DesktopProfileCurrent && !r.switching.frozen.Load() || r.switching.maintenance.Load())
}
func (r *DesktopRuntime) switchMaintenanceBarrier() error {
	if !r.switchAllowsMaintenance() {
		return fmt.Errorf("Hive switch maintenance blocked: mode=%s frozen=%t committed_and_released=%t", r.device.ProfileMode(), r.switching.frozen.Load(), r.switching.maintenance.Load())
	}
	return nil
}
func (r *DesktopRuntime) switchProofPath(session *desktopDeviceSession) string {
	return filepath.Join(filepath.Dir(session.path), "desktop-switch-seal.json")
}
func (r *DesktopRuntime) saveSwitchProof(session *desktopDeviceSession, proof *desktopSwitchSeal) error {
	raw, err := json.Marshal(proof)
	if err != nil {
		return err
	}
	if err = writePrivateFile(r.switchProofPath(session), append(raw, '\n'), ".switch-seal-*"); err != nil {
		return fmt.Errorf("persist Hive switch seal: %w", err)
	}
	saved, err := readDesktopAccountBytes(r.switchProofPath(session))
	if err != nil {
		return fmt.Errorf("read back Hive switch seal: %w", err)
	}
	if string(saved) != string(append(raw, '\n')) {
		return fmt.Errorf("Hive switch seal readback differs: match=false; original receipt retained")
	}
	r.switching.proof = proof
	r.switching.sealSaved.Store(!proof.Released)
	return nil
}
func (r *DesktopRuntime) loadSwitchProof(session *desktopDeviceSession, state localState) error {
	if r.switching.initialized {
		return nil
	}
	raw, err := readDesktopAccountBytes(r.switchProofPath(session))
	if errors.Is(err, os.ErrNotExist) {
		r.switching.initialized = true
		return nil
	}
	if err != nil {
		return fmt.Errorf("read saved Hive switch seal: %w", err)
	}
	if err = uniqueAccountJSON(json.NewDecoder(strings.NewReader(string(raw)))); err != nil {
		return fmt.Errorf("saved Hive switch seal unique JSON: %w", err)
	}
	var optional map[string]json.RawMessage
	if err = json.Unmarshal(raw, &optional); err != nil {
		return err
	}
	fields := []string{"released", "version", "binding", "original_epoch", "status", "workers_stopped"}
	if value, ok := optional["admission_completed"]; ok {
		if string(value) != "true" && string(value) != "false" {
			return fmt.Errorf("saved Hive switch admission_completed rejected: boolean_literal=false; required=true or false")
		}
		fields = append(fields, "admission_completed")
	}
	if _, err = connectionObject(raw, fields...); err != nil {
		return fmt.Errorf("saved Hive switch seal fields: %w", err)
	}
	var proof desktopSwitchSeal
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if err = d.Decode(&proof); err != nil {
		return fmt.Errorf("decode saved Hive switch seal: %w", err)
	}
	var proofFields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &proofFields); err != nil {
		return err
	}
	strictStatus, e := beewire.DecodeDeviceDrainStatus(proofFields["status"])
	if e != nil {
		return fmt.Errorf("saved Hive switch seal status: %w", e)
	}
	proof.Status = strictStatus
	if proof.Version != 1 || proof.Binding != retirementBinding(state) || proof.Status.Receipt == nil || proof.Status.Request == nil {
		return fmt.Errorf("saved Hive switch seal rejected: version=%d binding_match=%t receipt_present=%t request_present=%t", proof.Version, proof.Binding == retirementBinding(state), proof.Status.Receipt != nil, proof.Status.Request != nil)
	}
	if proof.AdmissionCompleted && (!proof.Released || proof.WorkersStopped) {
		return fmt.Errorf("saved Hive switch admission completion rejected: released=%t workers_stopped=%t; required=released and workers_stopped=false", proof.Released, proof.WorkersStopped)
	}
	if proof.Released != (proof.Status.State == "released") || proof.OriginalEpoch != proof.Status.Request.ExpectedEpoch || proof.WorkersStopped && state.RuntimeEpoch != proof.Status.Receipt.Epoch {
		return fmt.Errorf("saved Hive switch seal lifecycle rejected: released_match=%t original_epoch_match=%t workers_epoch_match=%t", proof.Released == (proof.Status.State == "released"), proof.OriginalEpoch == proof.Status.Request.ExpectedEpoch, !proof.WorkersStopped || state.RuntimeEpoch == proof.Status.Receipt.Epoch)
	}
	if err = proof.Status.ValidateFor(*proof.Status.Request); err != nil {
		return fmt.Errorf("saved Hive switch seal invalid: %w", err)
	}
	if state.RuntimeEpoch != proof.OriginalEpoch && state.RuntimeEpoch != proof.Status.Receipt.Epoch {
		if !proof.AdmissionCompleted {
			return fmt.Errorf("saved Hive switch seal epoch mismatch: original_match=false sealed_match=false admission_completed=false")
		}
		retirement, e := readSessionRetirement(session)
		if e != nil {
			return fmt.Errorf("completed switch current epoch retirement: %w", e)
		}
		if retirement == nil || !retirement.Completed || retirement.Proof == nil || retirement.Binding != retirementBinding(state) || retirement.Request.ID != state.RuntimeEpoch {
			return fmt.Errorf("completed switch current epoch rejected: matching_completed_retirement=false; historical receipt retained")
		}
	}
	r.switching.initialized = true
	r.switching.proof = &proof
	r.switching.sealSaved.Store(!proof.Released)
	r.switching.sealing.Store(!proof.Released)
	r.switching.frozen.Store(true)
	r.switching.maintenance.Store(false)
	if proof.AdmissionCompleted && r.device.ProfileMode() == DesktopProfileCurrent {
		r.switching.frozen.Store(false)
		r.switching.maintenance.Store(true)
	}
	return nil
}
func (r *DesktopRuntime) switchClient(state localState) (*DeviceDrainClient, error) {
	if state.Identity == nil {
		return nil, fmt.Errorf("Hive switch requires saved identity: present=false")
	}
	return NewDeviceDrainClient(DeviceDrainClientConfig{Origin: state.Hive, Credential: state.Credential, DeviceID: state.Identity.ID, OwnerID: state.Identity.OwnerID})
}
func (r *DesktopRuntime) switchView(state localState, revision int64) DesktopSwitchView {
	r.mu.Lock()
	network := r.network.Revision
	r.mu.Unlock()
	connected := r.switching.socket != nil && r.switching.socketDone != nil
	if connected {
		select {
		case <-r.switching.socketDone:
			connected = false
		default:
		}
	}
	connection := "disconnected"
	lease := ""
	if connected {
		connection = "connected"
		lease = r.switching.lease
	}
	if !connected && r.device.ProfileMode() == DesktopProfileCurrent && r.switching.socketDone == nil {
		r.mu.Lock()
		r.syncMu.Lock()
		if c := r.connection; c != nil && c.active && c.ctx.Err() == nil {
			connection = "connected"
			lease = c.lease
		} else if r.snapshot.Connection == "connected" {
			connection = "connected"
			lease = r.presence.lease
		}
		r.syncMu.Unlock()
		r.mu.Unlock()
	}
	proof := r.switching.proof
	var drain *beewire.DeviceDrainStatus
	if proof != nil {
		saved := proof.Status
		drain = &saved
	}
	return DesktopSwitchView{Mode: r.device.ProfileMode(), BindingRevision: revision, NetworkRevision: network, Epoch: state.RuntimeEpoch, Lease: lease, Connection: connection, Frozen: r.switching.frozen.Load(), MaintenanceAllowed: r.switchAllowsMaintenance(), WorkersStopped: proof != nil && proof.WorkersStopped, SealPersisted: proof != nil, Capabilities: nil, Drain: drain}
}

// SwitchControl serializes the native coordinator's machine actions. It never
// interprets missing/unknown responses as completion and never clears a guard
// before the strict matching server seal has been durably saved.
func (r *DesktopRuntime) SwitchControl(ctx context.Context, input DesktopSwitchRequest) (DesktopSwitchView, error) {
	r.switching.serial.Lock()
	defer r.switching.serial.Unlock()
	var zero DesktopSwitchView
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	if r.device.ProfileMode() == DesktopProfilePrepare && (input.Action == "connect" || input.Action == "commit" || input.Action == "stop") {
		return zero, fmt.Errorf("Hive switch action=%s blocked: mode=prepare; required=preparation device barrier actions only", input.Action)
	}
	session, release, err := r.device.acquireSession(ctx)
	if err != nil {
		return zero, err
	}
	state, revision, err := session.readBinding()
	if err != nil {
		release()
		return zero, err
	}
	if revision != input.BindingRevision || !desktopSafeRevision(input.BindingRevision) {
		release()
		return zero, fmt.Errorf("Hive switch binding changed: actual=%d expected=%d", revision, input.BindingRevision)
	}
	if err = r.loadSwitchProof(session, state); err != nil {
		release()
		return zero, err
	}
	client, err := r.switchClient(state)
	if err != nil {
		release()
		return zero, err
	}
	if input.Operation != nil {
		if err = client.checkRequest(*input.Operation); err != nil {
			release()
			return zero, err
		}
		if proof := r.switching.proof; proof != nil && proof.Status.OperationID == input.Operation.ID && *proof.Status.Request != *input.Operation {
			release()
			return zero, fmt.Errorf("Hive switch original operation changed: operation_match=true parameters_match=false; required=persisted immutable request")
		}
	}
	view := r.switchView(state, revision)
	// Never hold the device session while joining workers which may need it.
	release()
	if input.Action == "inspect" {
		return view, nil
	}
	if input.Action == "capabilities" {
		v, e := client.Capabilities(ctx)
		view.Capabilities = &v
		return view, e
	}
	if input.Action == "freeze" {
		r.switching.writes.Lock()
		defer r.switching.writes.Unlock()
		r.accounts.lifecycleMu.Lock()
		r.switching.frozen.Store(true)
		r.switching.sealSaved.Store(false)
		r.switching.maintenance.Store(false)
		active := len(r.accounts.activeActions)
		r.accounts.lifecycleMu.Unlock()
		if active != 0 {
			return r.switchView(state, revision), fmt.Errorf("Hive switch source freeze waiting: admitted_account_actions=%d; required=0 before drain begin", active)
		}
		session, end, e := r.device.acquireSession(ctx)
		if e != nil {
			return zero, e
		}
		scope, e := r.accounts.selectionScope(session, state, nil)
		end()
		if e != nil {
			return zero, e
		}
		if len(scope.PendingOperations) != 0 {
			return zero, fmt.Errorf("Hive switch source freeze blocked: unresolved_account_operations=%d; reconcile original operations", len(scope.PendingOperations))
		}
		return r.switchView(state, revision), nil
	}
	if input.Operation == nil {
		return zero, fmt.Errorf("Hive switch action=%s requires persisted original operation: present=false", input.Action)
	}
	var status beewire.DeviceDrainStatus
	switch input.Action {
	case "drain_begin":
		if !r.switching.frozen.Load() && r.device.ProfileMode() == DesktopProfileCurrent {
			return zero, fmt.Errorf("Hive switch begin rejected: source_frozen=false")
		}
		if input.Operation.ExpectedEpoch != state.RuntimeEpoch || input.Operation.ExpectedLease != view.Lease {
			return zero, fmt.Errorf("Hive switch begin context changed: epoch_match=%t lease_match=%t", input.Operation.ExpectedEpoch == state.RuntimeEpoch, input.Operation.ExpectedLease == view.Lease)
		}
		if view.Connection == "connected" && view.Lease == "" {
			return zero, fmt.Errorf("Hive switch begin rejected: connected=true lease_bytes=0; required=verified current lease")
		}
		status, err = client.Begin(ctx, *input.Operation)
	case "drain_status":
		status, err = client.Status(ctx, *input.Operation)
	case "drain_seal":
		if r.device.ProfileMode() == DesktopProfileCurrent && !r.switching.frozen.Load() {
			return zero, fmt.Errorf("Hive switch seal rejected: source_frozen=false")
		}
		if input.Seal == nil || input.Seal.Request != *input.Operation {
			return zero, fmt.Errorf("Hive switch seal rejected: original_request_match=false")
		}
		r.switching.sealing.Store(true)
		status, err = client.Seal(ctx, *input.Seal)
	case "drain_release":
		if input.Release == nil || input.Release.Request != *input.Operation {
			return zero, fmt.Errorf("Hive switch release rejected: original_request_match=false")
		}
		if input.Release.Mode == "activate" && r.switching.committed != input.Operation.ID {
			return zero, fmt.Errorf("Hive switch activate release rejected: trusted_commit_match=false")
		}
		if input.Release.Mode == "activate" || r.switching.proof != nil && r.switching.proof.Status.OperationID == input.Operation.ID {
			if view.Connection != "connected" || input.Release.ExpectedLease != view.Lease || input.Release.ExpectedEpoch != view.Epoch {
				return zero, fmt.Errorf("Hive switch release connection rejected: connected=%t lease_match=%t epoch_match=%t", view.Connection == "connected", input.Release.ExpectedLease == view.Lease, input.Release.ExpectedEpoch == view.Epoch)
			}
		}
		if r.switching.proof != nil && r.switching.proof.Status.OperationID == input.Operation.ID {
			session, end, e := r.device.acquireSession(ctx)
			if e != nil {
				return zero, e
			}
			proof := *r.switching.proof
			proof.WorkersStopped = false
			e = r.saveSwitchProof(session, &proof)
			end()
			if e != nil {
				return zero, e
			}
		}
		status, err = client.Release(ctx, *input.Release)
		if err == nil && status.State == "released" {
			r.stopSwitchSocket()
			r.connectionGate.lock(context.Background())
			r.handoff = &desktopConnectionHandoff{state: state, expires: time.Now().Add(30 * time.Second)}
			r.connectionGate.unlock()
			r.switching.sealing.Store(false)
			r.mu.Lock()
			r.presence.shutdown = false
			r.presence.suspended = false
			r.mu.Unlock()
		}
	case "stop":
		return r.stopForSwitch(ctx, state, revision, *input.Operation)
	case "connect":
		return r.connectForSwitch(ctx, state, revision, input)
	case "commit":
		if (view.Connection != "connected" && !(r.switching.proof != nil && r.switching.proof.Released && (state.RuntimeEpoch == r.switching.proof.Status.Receipt.Epoch || r.switching.proof.AdmissionCompleted))) || r.switching.proof == nil || r.switching.proof.Status.OperationID != input.Operation.ID {
			return zero, fmt.Errorf("Hive switch trusted commit rejected: connected=%t matching_seal=%t", view.Connection == "connected", r.switching.proof != nil && r.switching.proof.Status.OperationID == input.Operation.ID)
		}
		r.switching.committed = input.Operation.ID
		if r.switching.proof.Released {
			session, end, e := r.device.acquireSession(ctx)
			if e != nil {
				return zero, e
			}
			current, currentRevision, e := session.readBinding()
			if e != nil {
				end()
				return zero, e
			}
			if currentRevision != revision || retirementBinding(current) != retirementBinding(state) {
				end()
				return zero, fmt.Errorf("Hive switch admission completion binding changed: revision_match=%t identity_match=%t", currentRevision == revision, retirementBinding(current) == retirementBinding(state))
			}
			proof := *r.switching.proof
			proof.AdmissionCompleted = true
			e = r.saveSwitchProof(session, &proof)
			end()
			if e != nil {
				return zero, e
			}
			r.switching.frozen.Store(false)
			r.switching.maintenance.Store(true)
		}
		return r.switchView(state, revision), nil
	default:
		return zero, fmt.Errorf("Hive switch action rejected: actual=%q; required=inspect|capabilities|freeze|drain_begin|drain_status|drain_seal|drain_release|stop|connect|commit", input.Action)
	}
	if err != nil {
		return zero, err
	}
	if status.Receipt != nil {
		r.switching.sealing.Store(status.State != "released")
		session, end, e := r.device.acquireSession(ctx)
		if e != nil {
			return zero, e
		}
		defer end()
		current, rev, e := session.readBinding()
		if e != nil {
			return zero, e
		}
		if rev != revision || retirementBinding(current) != retirementBinding(state) {
			return zero, fmt.Errorf("Hive switch binding changed during remote action: revision_match=%t identity_match=%t", rev == revision, retirementBinding(current) == retirementBinding(state))
		}
		proof := r.switching.proof
		if proof == nil || proof.Status.OperationID != status.OperationID {
			if proof != nil {
				old, encodeErr := json.Marshal(proof)
				if encodeErr != nil {
					return zero, encodeErr
				}
				archive := filepath.Join(filepath.Dir(session.path), "desktop-switch-seal-"+proof.Status.OperationID+".json")
				saved, readErr := readDesktopAccountBytes(archive)
				if readErr == nil && string(saved) != string(old) {
					return zero, fmt.Errorf("Hive switch historical seal conflict: operation=%s existing_digest_match=false", proof.Status.OperationID)
				}
				if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
					return zero, readErr
				}
				if errors.Is(readErr, os.ErrNotExist) {
					if e = writePrivateFile(archive, old, ".switch-history-*"); e != nil {
						return zero, e
					}
				}
			}
			proof = &desktopSwitchSeal{Version: 1, Binding: retirementBinding(state), OriginalEpoch: input.Operation.ExpectedEpoch, Status: status}
		}
		// Immutable receipt is kept even after later releases/current facts change.
		if proof.Status.Receipt == nil || *proof.Status.Receipt != *status.Receipt {
			return zero, fmt.Errorf("Hive switch receipt changed: original_receipt_match=false")
		}
		proof.Released = status.State == "released"
		proof.Status = status
		if e = r.saveSwitchProof(session, proof); e != nil {
			return zero, e
		}
	}
	if status.State == "released" && input.Action == "drain_release" {
		r.switching.frozen.Store(false)
		r.switching.maintenance.Store(true)
	}
	view = r.switchView(state, revision)
	view.Drain = &status
	return view, nil
}

func (r *DesktopRuntime) stopSwitchSocket() {
	if r.switching.socketCancel != nil {
		r.switching.socketCancel()
	}
	if r.switching.socket != nil {
		r.switching.socket.CloseNow()
	}
	if r.switching.socketDone != nil {
		<-r.switching.socketDone
	}
	r.switching.socket = nil
	r.switching.socketDone = nil
	r.switching.socketCancel = nil
	r.switching.lease = ""
}
func (r *DesktopRuntime) connectForSwitch(ctx context.Context, state localState, revision int64, input DesktopSwitchRequest) (DesktopSwitchView, error) {
	var zero DesktopSwitchView
	if r.device.ProfileMode() == DesktopProfilePrepare {
		return zero, fmt.Errorf("Hive switch connect blocked: mode=prepare; required=activate or current recovery")
	}
	if err := r.VerifyStartup(ctx); err != nil {
		return zero, fmt.Errorf("Hive switch target local preflight: %w", err)
	}
	proof := r.switching.proof
	if proof == nil || proof.Status.Request == nil || *proof.Status.Request != *input.Operation || proof.Status.Receipt == nil {
		return zero, fmt.Errorf("Hive switch connect blocked: matching_saved_seal=false")
	}
	r.mu.Lock()
	network := r.network
	r.mu.Unlock()
	if input.NetworkRevision != network.Revision {
		return zero, fmt.Errorf("Hive switch network changed: actual=%d expected=%d", network.Revision, input.NetworkRevision)
	}
	if view := r.switchView(state, revision); view.Connection == "connected" && view.Epoch == proof.Status.Receipt.Epoch {
		return view, nil
	}
	r.accounts.lifecycleMu.Lock()
	r.switching.frozen.Store(true)
	r.switching.maintenance.Store(false)
	active := len(r.accounts.activeActions)
	r.accounts.lifecycleMu.Unlock()
	if active != 0 {
		return zero, fmt.Errorf("Hive switch connect blocked: admitted_account_actions=%d", active)
	}
	// Reverify device identity without reading any official account source.
	var identity beewire.Identity
	if err := desktopCall(ctx, state, "/api/bee/identity", http.MethodGet, state.Credential, nil, &identity); err != nil {
		return zero, fmt.Errorf("Hive switch device verification: %w", err)
	}
	if state.Identity == nil || identity.ID != state.Identity.ID || identity.OwnerID != state.Identity.OwnerID {
		return zero, fmt.Errorf("Hive switch identity changed: device_match=%t owner_match=%t", state.Identity != nil && identity.ID == state.Identity.ID, state.Identity != nil && identity.OwnerID == state.Identity.OwnerID)
	}
	// Query the original barrier immediately before dialing. A historical receipt
	// alone cannot authorize connection under a superseded/released operation.
	client, err := r.switchClient(state)
	if err != nil {
		return zero, err
	}
	status, err := client.Status(ctx, *input.Operation)
	if err != nil {
		return zero, err
	}
	receiptMatch := status.Receipt != nil && *status.Receipt == *proof.Status.Receipt
	if status.State != "sealed" || status.Current.BarrierID != input.Operation.ID || status.Current.Epoch != proof.Status.Receipt.Epoch || status.Current.Lease != "" || !receiptMatch {
		return zero, fmt.Errorf("Hive switch connect barrier rejected: state=%s barrier_match=%t epoch_match=%t lease_empty=%t receipt_match=%t", status.State, status.Current.BarrierID == input.Operation.ID, status.Current.Epoch == proof.Status.Receipt.Epoch, status.Current.Lease == "", receiptMatch)
	}
	r.stopSwitchSocket()
	session, end, err := r.device.acquireSession(ctx)
	if err != nil {
		return zero, err
	}
	current, rev, err := session.readBinding()
	if err == nil && rev != revision {
		err = fmt.Errorf("Hive switch epoch save binding changed: actual=%d expected=%d", rev, revision)
	}
	if err == nil {
		proof.WorkersStopped = false
		if err = r.saveSwitchProof(session, proof); err == nil {
			current.RuntimeEpoch = proof.Status.Receipt.Epoch
			err = session.save(current)
		}
	}
	end()
	if err != nil {
		return zero, err
	}
	state = current
	clientHTTP := httpClient()
	clientHTTP.Timeout = 0
	if network.ConnectProxy != "" {
		clientHTTP.Transport = officialTransport(network.ConnectProxy)
	}
	endpoint := strings.Replace(strings.Replace(state.Hive, "https:", "wss:", 1), "http:", "ws:", 1) + "/api/bee/connect"
	conn, response, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{HTTPClient: clientHTTP, HTTPHeader: http.Header{"Authorization": []string{"Bearer " + state.Credential}, "User-Agent": []string{userAgent()}, beewire.RuntimeEpochHeader: []string{state.RuntimeEpoch}}})
	if err != nil {
		return zero, fmt.Errorf("Hive switch device socket verification failed: %s", connectionMessage(err, state.Credential))
	}
	lease := response.Header.Get("X-Bee-Lease")
	if lease == "" {
		conn.CloseNow()
		return zero, fmt.Errorf("Hive switch device socket lease missing: bytes=0; required=verified current lease")
	}
	live, cancel := context.WithCancel(r.ctx)
	done := make(chan struct{})
	conn.SetReadLimit(1024)
	reader := conn.CloseRead(live)
	r.workers.Add(1)
	go func() { defer r.workers.Done(); defer close(done); <-reader.Done(); cancel(); conn.CloseNow() }()
	r.switching.socket = conn
	r.switching.socketCancel = cancel
	r.switching.socketDone = done
	r.switching.lease = lease
	r.switching.epoch = state.RuntimeEpoch
	ping, stop := context.WithTimeout(ctx, 5*time.Second)
	defer stop()
	if err = conn.Ping(ping); err != nil {
		r.stopSwitchSocket()
		return zero, fmt.Errorf("Hive switch device socket heartbeat failed: %s", connectionMessage(err, state.Credential))
	}
	// Binding revision may include the persisted epoch; return its actual value.
	session, end, err = r.device.acquireSession(ctx)
	if err != nil {
		return zero, err
	}
	state, revision, err = session.readBinding()
	end()
	if err != nil {
		return zero, err
	}
	return r.switchView(state, revision), nil
}
func (r *DesktopRuntime) stopForSwitch(ctx context.Context, state localState, revision int64, request beewire.DeviceDrainRequest) (DesktopSwitchView, error) {
	proof := r.switching.proof
	if proof == nil || proof.Released || proof.Status.Request == nil || *proof.Status.Request != request || proof.Status.Receipt == nil {
		return DesktopSwitchView{}, fmt.Errorf("Hive switch stop blocked: durable_matching_seal=false; original guard preserved")
	}
	r.switching.frozen.Store(true)
	r.switching.maintenance.Store(false)
	r.mu.Lock()
	rev := r.snapshot.Revision
	r.mu.Unlock()
	op, err := r.Stop(ctx, DesktopStopRequest{ExpectedRevision: rev, Reason: "hive_switch"})
	if err != nil {
		return DesktopSwitchView{}, err
	}
	for {
		r.mu.Lock()
		operation := r.snapshot.Operation
		var result DesktopOperation
		if operation != nil {
			result = *operation
		}
		r.mu.Unlock()
		if result.ID != op.ID {
			return DesktopSwitchView{}, fmt.Errorf("Hive switch stop ownership changed: operation_match=false")
		}
		if result.State != "pending" {
			if result.State != "succeeded" {
				return DesktopSwitchView{}, fmt.Errorf("Hive switch owned stop unconfirmed: state=%s error=%v", result.State, result.Error)
			}
			break
		}
		select {
		case <-ctx.Done():
			return DesktopSwitchView{}, ctx.Err()
		case <-time.After(5 * time.Millisecond):
		}
	}
	r.stopSwitchSocket()
	session, end, err := r.device.acquireSession(ctx)
	if err != nil {
		return DesktopSwitchView{}, err
	}
	defer end()
	current, rev, err := session.readBinding()
	if err != nil {
		return DesktopSwitchView{}, err
	}
	if rev != revision {
		return DesktopSwitchView{}, fmt.Errorf("Hive switch stop binding changed: actual=%d expected=%d", rev, revision)
	}
	current.RuntimeEpoch = proof.Status.Receipt.Epoch
	if err = session.save(current); err != nil {
		return DesktopSwitchView{}, err
	}
	proof.WorkersStopped = true
	if err = r.saveSwitchProof(session, proof); err != nil {
		return DesktopSwitchView{}, err
	}
	return r.switchView(current, revision), nil
}
