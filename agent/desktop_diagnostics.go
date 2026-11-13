package bee

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/tokhive/bee/beewire"
)

// DiagnosticCheck contains only public, deliberately constructed evidence. It
// must never carry an error string, response body, credential or source path.
type DiagnosticCheck struct {
	ID         string            `json:"id"`
	Platform   *string           `json:"platform"`
	Status     string            `json:"status"`
	ObservedAt string            `json:"observed_at"`
	Code       string            `json:"code"`
	Evidence   map[string]string `json:"evidence"`
	NextAction string            `json:"next_action"`
}
type DesktopDiagnosticReport struct {
	ID              string            `json:"id"`
	Instance        string            `json:"instance"`
	RunID           *string           `json:"run_id"`
	NetworkRevision int64             `json:"network_revision"`
	BindingRevision int64             `json:"binding_revision"`
	StartedAt       string            `json:"started_at"`
	FinishedAt      *string           `json:"finished_at"`
	State           string            `json:"state"`
	Checks          []DiagnosticCheck `json:"checks"`
}

// DesktopDiagnosticEvent is the event allowlist consumed by the native log
// boundary. Model input/output and ordinary process stderr cannot enter it.
type DesktopDiagnosticEvent struct {
	Time     string            `json:"time"`
	Level    string            `json:"level"`
	Module   string            `json:"module"`
	Platform *string           `json:"platform"`
	Code     string            `json:"code"`
	Evidence map[string]string `json:"evidence"`
}

type DesktopDiagnostics struct {
	mu            sync.Mutex
	ctx           context.Context
	cancel        context.CancelFunc
	workers       sync.WaitGroup
	device        *DesktopDevice
	accounts      *DesktopAccounts
	runtime       *DesktopRuntime
	reports       map[string]DesktopDiagnosticReport
	order         []string
	active        string
	stop          context.CancelFunc
	timeout       time.Duration
	hiveTransport http.RoundTripper
	closed        bool
}

func NewDesktopDiagnostics(parent context.Context, d *DesktopDevice, a *DesktopAccounts, r *DesktopRuntime) *DesktopDiagnostics {
	ctx, cancel := context.WithCancel(parent)
	return &DesktopDiagnostics{ctx: ctx, cancel: cancel, device: d, accounts: a, runtime: r, reports: map[string]DesktopDiagnosticReport{}, timeout: 90 * time.Second}
}
func diagnosticHex(value string, n int) bool {
	raw, err := hex.DecodeString(value)
	return err == nil && len(raw) == n && hex.EncodeToString(raw) == value
}
func (d *DesktopDiagnostics) Start(ctx context.Context, instance string) (DesktopDiagnosticReport, error) {
	if err := ctx.Err(); err != nil {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostics start rejected: request_context=%s", diagnosticErrorCode(err))
	}
	if !diagnosticHex(instance, 16) {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostics instance rejected: bytes=%d; required=32 lowercase hex characters", len(instance))
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed || d.ctx.Err() != nil {
		return DesktopDiagnosticReport{}, errors.New("diagnostics owner closed; start requires a live management session")
	}
	if d.device == nil || d.accounts == nil || d.runtime == nil {
		return DesktopDiagnosticReport{}, errors.New("diagnostics dependencies absent; required=shared desktop device,accounts,runtime")
	}
	if d.active != "" {
		return DesktopDiagnosticReport{}, errors.New("diagnostics already running; cancel or await the active report before starting")
	}
	bindingRevision, bindingErr := d.device.bindingRevision(ctx)
	if bindingErr != nil && bindingRevision == 0 {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostics start binding unavailable: %w", bindingErr)
	}
	runtime, err := d.runtime.Snapshot(ctx)
	if err != nil {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostics start runtime snapshot failed: code=%s", diagnosticErrorCode(err))
	}
	if !desktopSafeRevision(runtime.NetworkRevision) || runtime.RunID != nil && !diagnosticHex(*runtime.RunID, 16) {
		return DesktopDiagnosticReport{}, errors.New("diagnostics start runtime context rejected; required=safe network revision and valid run identifier")
	}
	id, err := desktopOperationID()
	if err != nil {
		return DesktopDiagnosticReport{}, errors.New("diagnostics report ID unavailable: system_random_failed")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	report := DesktopDiagnosticReport{ID: id, Instance: instance, RunID: runtime.RunID, NetworkRevision: runtime.NetworkRevision, BindingRevision: bindingRevision, StartedAt: now, State: "running", Checks: []DiagnosticCheck{}}
	for _, name := range []string{"device", "runtime", "hive", "proxy"} {
		report.Checks = append(report.Checks, newDiagnosticCheck(name, "", "skipped", "pending", now, "diagnostics", nil))
	}
	for _, platform := range []string{"openai", "claude"} {
		for _, name := range []string{"source", "authorization", "quota", "capabilities", "account", "supply"} {
			report.Checks = append(report.Checks, newDiagnosticCheck(name, platform, "skipped", "pending", now, "accounts", nil))
		}
	}
	if len(d.order) == 8 {
		delete(d.reports, d.order[0])
		d.order = d.order[1:]
	}
	d.order = append(d.order, id)
	d.reports[id] = report
	d.active = id
	live, stop := context.WithTimeout(d.ctx, d.timeout)
	d.stop = stop
	d.workers.Add(1)
	go func() { defer d.workers.Done(); defer stop(); d.run(live, id); d.finish(id, live.Err()) }()
	return copyDiagnosticReport(report), nil
}
func copyDiagnosticReport(r DesktopDiagnosticReport) DesktopDiagnosticReport {
	raw, _ := json.Marshal(r)
	var copy DesktopDiagnosticReport
	_ = json.Unmarshal(raw, &copy)
	return copy
}
func (d *DesktopDiagnostics) Snapshot(ctx context.Context, id string) (DesktopDiagnosticReport, error) {
	if err := ctx.Err(); err != nil {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostics snapshot rejected: request_context=%s", diagnosticErrorCode(err))
	}
	revision, readErr := d.device.bindingRevision(ctx)
	d.mu.Lock()
	defer d.mu.Unlock()
	r, ok := d.reports[id]
	if !ok {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostics report not retained: id_bytes=%d; required=known report in this management session", len(id))
	}
	if revision != r.BindingRevision {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostic binding changed: checked_revision=%d current_revision=%d; old report cannot describe the new binding", r.BindingRevision, revision)
	}
	if readErr != nil && revision == 0 {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostic binding cannot be read: %w", readErr)
	}
	return copyDiagnosticReport(r), nil
}
func (d *DesktopDiagnostics) Cancel(ctx context.Context, id string) (DesktopDiagnosticReport, error) {
	if err := ctx.Err(); err != nil {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostics cancel rejected: request_context=%s", diagnosticErrorCode(err))
	}
	revision, readErr := d.device.bindingRevision(ctx)
	d.mu.Lock()
	defer d.mu.Unlock()
	r, ok := d.reports[id]
	if !ok {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostics cancel report not retained: id_bytes=%d; required=known report in this management session", len(id))
	}
	if r.State == "running" && d.active == id {
		d.stop()
		d.finishLocked(id, context.Canceled)
		r = d.reports[id]
	}
	if revision != r.BindingRevision || readErr != nil && revision == 0 {
		return DesktopDiagnosticReport{}, fmt.Errorf("diagnostic cancel binding unconfirmed: checked_revision=%d current_revision=%d; old report cannot describe the current binding", r.BindingRevision, revision)
	}
	return copyDiagnosticReport(r), nil
}
func (d *DesktopDiagnostics) Close() {
	d.mu.Lock()
	d.closed = true
	d.cancel()
	d.mu.Unlock()
	d.workers.Wait()
}
func (d *DesktopDiagnostics) finish(id string, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.finishLocked(id, err)
	if d.active == id {
		d.active = ""
		d.stop = nil
	}
}
func (d *DesktopDiagnostics) finishLocked(id string, err error) {
	r := d.reports[id]
	if r.State != "running" {
		return
	}
	r.State = "completed"
	if errors.Is(err, context.Canceled) {
		r.State = "cancelled"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	r.FinishedAt = &now
	for i, c := range r.Checks {
		if c.Code == "pending" {
			c.Code = "not_checked"
			if err != nil {
				c.Code = diagnosticErrorCode(err)
			}
			c.ObservedAt = now
			r.Checks[i] = c
		}
	}
	d.reports[id] = r
}
func newDiagnosticCheck(id, platform, status, code, at, action string, evidence map[string]string) DiagnosticCheck {
	var p *string
	if platform != "" {
		p = accountString(platform)
	}
	if evidence == nil {
		evidence = map[string]string{}
	}
	return DiagnosticCheck{ID: id, Platform: p, Status: status, Code: code, ObservedAt: at, NextAction: action, Evidence: evidence}
}
func (d *DesktopDiagnostics) set(id, name, platform, status, code, action string, evidence map[string]string) {
	revision, _ := d.device.bindingRevision(d.ctx)
	d.mu.Lock()
	old := d.reports[id]
	if old.BindingRevision != revision {
		if d.active == id && d.stop != nil {
			d.stop()
		}
		d.finishLocked(id, context.Canceled)
		d.mu.Unlock()
		return
	}
	defer d.mu.Unlock()
	r := d.reports[id]
	if r.State != "running" {
		return
	}
	c := newDiagnosticCheck(name, platform, status, code, time.Now().UTC().Format(time.RFC3339Nano), action, evidence)
	for i, old := range r.Checks {
		if old.ID == name && (old.Platform == nil && c.Platform == nil || old.Platform != nil && c.Platform != nil && *old.Platform == *c.Platform) {
			r.Checks[i] = c
			d.reports[id] = r
			return
		}
	}
}
func diagnosticErrorCode(err error) string {
	var dns *net.DNSError
	var cert *tls.CertificateVerificationError
	var unknown x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var op *net.OpError
	var record tls.RecordHeaderError
	switch {
	case errors.Is(err, context.Canceled):
		return "cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.As(err, &dns):
		return "dns_failed"
	case errors.As(err, &cert) || errors.As(err, &unknown) || errors.As(err, &hostname) || errors.As(err, &record):
		return "tls_failed"
	case errors.As(err, &op):
		return "connection_failed"
	default:
		return "unknown_failure"
	}
}

type diagnosticHTTPFailure struct {
	code     string
	evidence map[string]string
}

func (e *diagnosticHTTPFailure) Error() string {
	return fmt.Sprintf("diagnostic read failed: code=%s evidence=%v", e.code, e.evidence)
}
func (d *DesktopDiagnostics) get(ctx context.Context, state localState, path string, output any) error {
	live, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	evidence := map[string]string{"method": "GET", "path": path}
	req, err := http.NewRequestWithContext(live, http.MethodGet, state.Hive+path, nil)
	if err != nil {
		return &diagnosticHTTPFailure{"invalid_origin", evidence}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hive-Request", "1")
	req.Header.Set("User-Agent", userAgent())
	req.Header.Set("Authorization", "Bearer "+state.Credential)
	client := httpClient()
	if d.hiveTransport != nil {
		client.Transport = d.hiveTransport
	}
	response, err := client.Do(req)
	if err != nil {
		return &diagnosticHTTPFailure{diagnosticErrorCode(err), evidence}
	}
	defer response.Body.Close()
	evidence["http_status"] = strconv.Itoa(response.StatusCode)
	raw, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil {
		return &diagnosticHTTPFailure{diagnosticErrorCode(err), evidence}
	}
	if len(raw) > 65536 {
		evidence["response_limit"] = "65536"
		return &diagnosticHTTPFailure{"response_too_large", evidence}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		code := "http_rejected"
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &body)
		public := safeCode(body.Error.Code)
		if public != "" {
			evidence["server_code"] = public
		}
		if response.StatusCode == 429 {
			code = "rate_limited"
		}
		if public == "device_replaced" {
			code = "device_replaced"
		}
		return &diagnosticHTTPFailure{code, evidence}
	}
	if err := json.Unmarshal(raw, output); err != nil {
		return &diagnosticHTTPFailure{"invalid_response", evidence}
	}
	return nil
}
func (d *DesktopDiagnostics) failed(id, name, platform string, err error) {
	code := diagnosticErrorCode(err)
	evidence := map[string]string{}
	var failure *diagnosticHTTPFailure
	if errors.As(err, &failure) {
		code = failure.code
		evidence = failure.evidence
	}
	d.set(id, name, platform, "fail", code, "diagnostics", evidence)
}
func (d *DesktopDiagnostics) run(ctx context.Context, id string) {
	defer func() {
		if snapshot, err := d.runtime.Snapshot(ctx); err == nil {
			d.observeRuntimeContext(id, snapshot)
		}
	}()
	session, release, err := d.device.acquireSession(ctx)
	if err != nil {
		d.set(id, "device", "", "fail", "local_read_failed", "settings", map[string]string{"stage": "session"})
		return
	}
	defer release()
	state, err := session.read()
	if err != nil {
		d.set(id, "device", "", "fail", "local_read_failed", "settings", map[string]string{"stage": "device_configuration"})
		return
	}
	if state.Identity == nil || !deviceCredentialPattern.MatchString(state.Credential) {
		d.set(id, "device", "", "fail", "device_not_paired", "settings", map[string]string{"identity_present": strconv.FormatBool(state.Identity != nil), "credential_valid": strconv.FormatBool(deviceCredentialPattern.MatchString(state.Credential))})
		return
	}
	origin, e := hiveOrigin(state.Hive)
	if e != nil || origin != state.Hive {
		d.set(id, "device", "", "fail", "invalid_origin", "settings", nil)
		return
	}
	if e := validateDesktopIdentity(state, *state.Identity); e != nil {
		d.set(id, "device", "", "fail", "identity_unconfirmed", "settings", nil)
		return
	}
	d.set(id, "device", "", "pass", "device_binding_valid", "settings", map[string]string{"identity_valid": "true", "source_type": "desktop_device"})
	runtime, err := d.runtime.Snapshot(ctx)
	if err != nil {
		d.failed(id, "runtime", "", err)
	} else {
		if !d.observeRuntimeContext(id, runtime) {
			return
		}
		status, code := "warning", "runtime_stopped"
		if runtime.Local == "running" && runtime.Connection == "connected" {
			status, code = "pass", "owned_runtime_connected"
		} else if runtime.Connection == "occupied" {
			status, code = "fail", "runtime_ownership_conflict"
		} else if runtime.Local == "waiting" {
			status, code = "skipped", "runtime_waiting"
		} else if !slices.Contains([]string{"stopped", "waiting", "starting", "stopping", "running", "failed"}, runtime.Local) {
			status, code = "fail", "runtime_unknown"
		}
		d.set(id, "runtime", "", status, code, "overview", map[string]string{"local": diagnosticEnum(runtime.Local, []string{"stopped", "waiting", "starting", "running", "stopping", "failed"}), "connection": diagnosticEnum(runtime.Connection, []string{"connected", "disconnected", "connecting", "reconnecting", "occupied", "rejected"})})
	}
	network, _ := d.accounts.OfficialNetwork()
	upstream := "direct"
	if network.ConnectProxy != "" {
		upstream = "local_connect"
	}
	address := ""
	if network.ConnectProxy != "" {
		address, _ = localConnectProxy(network.ConnectProxy)
	}
	openaiRequest, _ := http.NewRequest(http.MethodGet, "https://chatgpt.com/backend-api/wham/usage", nil)
	claudeRequest, _ := http.NewRequest(http.MethodGet, "https://api.anthropic.com/api/oauth/profile", nil)
	hiveRequest, _ := http.NewRequest(http.MethodGet, state.Hive+"/api/bee/identity", nil)
	hivePath := "direct"
	if proxy, e := http.ProxyFromEnvironment(hiveRequest); e != nil {
		hivePath = "unknown"
	} else if proxy != nil {
		hivePath = "environment_proxy"
	}
	d.set(id, "proxy", "", "pass", "network_policy_observed", "settings", map[string]string{"bee_upstream_path": upstream, "openai_query_path": officialNetworkPath(openaiRequest, address), "claude_query_path": officialNetworkPath(claudeRequest, address), "hive_path": hivePath, "network_revision": strconv.FormatInt(network.Revision, 10)})
	var identity beewire.Identity
	hiveOK := false
	if err := d.get(ctx, state, "/api/bee/identity", &identity); err != nil {
		d.failed(id, "hive", "", err)
	} else if err := validateDesktopIdentity(state, identity); err != nil {
		d.set(id, "hive", "", "fail", "identity_mismatch", "settings", map[string]string{"method": "GET", "path": "/api/bee/identity", "identity_match": "false"})
	} else {
		hiveOK = true
		d.set(id, "hive", "", "pass", "hive_identity_verified", "overview", map[string]string{"method": "GET", "path": "/api/bee/identity", "http_status": "200", "identity_match": "true"})
	}
	if ctx.Err() != nil {
		return
	}
	scope, err := d.accounts.selectionScope(session, state, nil)
	if err != nil {
		for _, p := range []string{"openai", "claude"} {
			d.set(id, "source", p, "fail", "selection_read_failed", "accounts", map[string]string{"stage": "persisted_selection"})
		}
		return
	}
	for _, p := range []string{"openai", "claude"} {
		if ctx.Err() != nil {
			return
		}
		selection, selected := scope.Selections[p]
		if !selected {
			for _, name := range []string{"source", "authorization", "quota", "capabilities", "account", "supply"} {
				d.set(id, name, p, "skipped", "source_not_selected", "accounts", map[string]string{"selected": "false"})
			}
			continue
		}
		if _, pending := scope.PendingOperations[p]; pending {
			d.set(id, "source", p, "fail", "selection_unconfirmed", "accounts", map[string]string{"pending_operation": "true"})
			continue
		}
		d.inspectSelected(ctx, id, p, selection)
		if ctx.Err() != nil {
			return
		}
		if hiveOK {
			d.inspectHivePlatform(ctx, id, state, p, selection)
		} else {
			for _, name := range []string{"account", "supply"} {
				d.set(id, name, p, "skipped", "hive_check_failed", "diagnostics", nil)
			}
		}
	}
}

// Reports retain the context captured before Start returns. A later snapshot
// can invalidate observations, but cannot relabel an old report as a new run.
func (d *DesktopDiagnostics) observeRuntimeContext(id string, snapshot DesktopRuntimeSnapshot) bool {
	d.mu.Lock()
	report := d.reports[id]
	d.mu.Unlock()
	changedNetwork := snapshot.NetworkRevision != report.NetworkRevision
	changedRun := (snapshot.RunID == nil) != (report.RunID == nil) || snapshot.RunID != nil && report.RunID != nil && *snapshot.RunID != *report.RunID
	if changedNetwork {
		evidence := map[string]string{"checked_revision": strconv.FormatInt(report.NetworkRevision, 10)}
		if desktopSafeRevision(snapshot.NetworkRevision) {
			evidence["current_revision"] = strconv.FormatInt(snapshot.NetworkRevision, 10)
		}
		d.set(id, "proxy", "", "skipped", "network_changed", "settings", evidence)
	}
	if changedRun {
		d.set(id, "runtime", "", "skipped", "runtime_unknown", "overview", nil)
	}
	return !changedNetwork && !changedRun
}
func diagnosticEnum(value string, allowed []string) string {
	if slices.Contains(allowed, value) {
		return value
	}
	return "unknown"
}
func (d *DesktopDiagnostics) inspectSelected(ctx context.Context, id, platform string, selection desktopAccountSelection) {
	request := DesktopAccountDetectRequest{Platform: platform, Directory: selection.Source.Directory, Store: selection.Source.Store, Mode: "official"}
	read, failure := d.accounts.readAccountSource(ctx, request)
	defer read.clear()
	if failure != nil {
		code := diagnosticEnum(failure.Code, []string{"source_missing", "source_unavailable", "permission_denied", "unsupported_store", "invalid_directory", "invalid_credentials", "deadline"})
		if code == "unknown" {
			code = "local_read_failed"
		}
		evidence := map[string]string{"stage": "selected_source", "source_type": diagnosticEnum(selection.Source.Store, []string{"file", "keyring", "keychain", "auto"})}
		for _, key := range []string{"not_found", "permission_denied", "parsed"} {
			if value := failure.Evidence[key]; value == "true" || value == "false" {
				evidence[key] = value
			}
		}
		d.set(id, "source", platform, "fail", code, "accounts", evidence)
		return
	}
	if read.revision != selection.CredentialRevision || read.fingerprint != nil && *read.fingerprint != selection.Fingerprint {
		d.set(id, "source", platform, "fail", "source_changed", "accounts", map[string]string{"source_revision_match": strconv.FormatBool(read.revision == selection.CredentialRevision)})
		return
	}
	d.set(id, "source", platform, "pass", "selected_source_read", "accounts", map[string]string{"source_type": diagnosticEnum(read.source.Store, []string{"file", "keyring", "keychain", "auto"}), "source_revision_match": "true"})
	if !d.accounts.now().Add(30 * time.Second).Before(read.expires) {
		d.set(id, "authorization", platform, "fail", "authorization_expired", "accounts", map[string]string{"valid_beyond_safety_window": "false", "safety_seconds": "30"})
		return
	}
	officialNetwork, officialTransport := d.accounts.OfficialNetwork()
	tracker := &diagnosticTrackingTransport{base: officialTransport}
	probe := &DesktopAccounts{now: d.accounts.now, goos: d.accounts.goos, readKeyring: d.accounts.readKeyring, transport: tracker}
	temporary := &desktopAccountPlatform{snapshot: initialAccountSnapshot(platform)}
	probe.observeOfficial(ctx, temporary, request, read)
	currentNetwork, _ := d.accounts.OfficialNetwork()
	if currentNetwork.Revision != officialNetwork.Revision {
		d.set(id, "authorization", platform, "skipped", "network_changed", "settings", map[string]string{"checked_revision": strconv.FormatInt(officialNetwork.Revision, 10), "current_revision": strconv.FormatInt(currentNetwork.Revision, 10)})
		return
	}
	if ctx.Err() != nil {
		d.failed(id, "authorization", platform, ctx.Err())
		return
	}
	if temporary.snapshot.Candidate.Error != nil {
		d.set(id, "authorization", platform, "fail", diagnosticEnum(temporary.snapshot.Candidate.Error.Code, []string{"source_changed", "expired", "unconfirmed"}), "accounts", tracker.evidence())
		return
	}
	if tracker.failure != nil || tracker.status >= 400 {
		d.set(id, "authorization", platform, "fail", tracker.code(), "accounts", tracker.evidence())
		return
	}
	if platform == "claude" && (!temporary.snapshot.Candidate.IdentityVerified || temporary.snapshot.Candidate.Fingerprint == nil || *temporary.snapshot.Candidate.Fingerprint != selection.Fingerprint) {
		d.set(id, "authorization", platform, "fail", "identity_unconfirmed", "accounts", tracker.evidence())
		return
	}
	capabilities := temporary.snapshot.Capabilities[0]
	if capabilities.Error != nil || capabilities.Status != "ready" {
		d.set(id, "authorization", platform, "fail", "official_result_unconfirmed", "accounts", tracker.evidence())
		d.set(id, "quota", platform, "skipped", "quota_unconfirmed", "accounts", nil)
		return
	}
	d.set(id, "authorization", platform, "pass", "official_authorization_observed", "accounts", tracker.evidence())
	status, code, evidence := diagnosticQuotaResult(capabilities, d.accounts.now())
	d.set(id, "quota", platform, status, code, "accounts", evidence)
}

type diagnosticTrackingTransport struct {
	base    http.RoundTripper
	status  int
	path    string
	failure error
}

func (t *diagnosticTrackingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Method != http.MethodGet {
		return nil, errors.New("diagnostic official method rejected; required=GET")
	}
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	t.path = r.URL.Path
	res, err := base.RoundTrip(r)
	t.failure = err
	if res != nil {
		t.status = res.StatusCode
	}
	return res, err
}
func (t *diagnosticTrackingTransport) evidence() map[string]string {
	e := map[string]string{"method": "GET"}
	if slices.Contains([]string{"/backend-api/codex/models", "/backend-api/wham/usage", "/api/oauth/profile", "/api/oauth/usage", "/v1/models"}, t.path) {
		e["path"] = t.path
	}
	if t.status > 0 {
		e["http_status"] = strconv.Itoa(t.status)
	}
	return e
}
func (t *diagnosticTrackingTransport) code() string {
	if t.failure != nil {
		return diagnosticErrorCode(t.failure)
	}
	if t.status == 429 {
		return "rate_limited"
	}
	if t.status >= 400 {
		return "http_rejected"
	}
	return "official_result_unconfirmed"
}
func (d *DesktopDiagnostics) inspectHivePlatform(ctx context.Context, id string, state localState, p string, selection desktopAccountSelection) {
	path := "/api/bee/platforms/" + p
	var account beewire.PlatformAccount
	if err := d.get(ctx, state, path+"/account", &account); err != nil {
		d.failed(id, "account", p, err)
		return
	}
	if err := validateDesktopHiveAccount(account, p); err != nil {
		d.set(id, "account", p, "fail", "account_result_unconfirmed", "accounts", map[string]string{"method": "GET", "path": path + "/account"})
		return
	}
	if account.Status != "ready" || account.AccountFingerprint != selection.Fingerprint || account.CredentialRevision != selection.CredentialRevision || account.Generation != selection.Generation {
		d.set(id, "account", p, "fail", "account_binding_unconfirmed", "accounts", map[string]string{"status": diagnosticEnum(account.Status, []string{"ready", "not_configured", "confirmation_required", "authorization_rejected", "expired"}), "identity_match": strconv.FormatBool(account.AccountFingerprint == selection.Fingerprint), "generation_match": strconv.FormatBool(account.Generation == selection.Generation)})
		return
	}
	var caps beewire.Capabilities
	capErr := d.get(ctx, state, path+"/capabilities", &caps)
	var supply beewire.PlatformSupply
	supplyErr := d.get(ctx, state, path, &supply)
	var after beewire.PlatformAccount
	if err := d.get(ctx, state, path+"/account", &after); err != nil {
		d.failed(id, "account", p, err)
		return
	}
	if err := validateDesktopHiveAccount(after, p); err != nil {
		d.set(id, "account", p, "fail", "account_result_unconfirmed", "accounts", map[string]string{"stage": "account_readback"})
		return
	}
	if account.AccountFingerprint != after.AccountFingerprint || account.CredentialRevision != after.CredentialRevision || account.Generation != after.Generation || account.Status != after.Status || account.PendingFingerprint != after.PendingFingerprint {
		d.set(id, "account", p, "fail", "account_changed", "accounts", map[string]string{"binding_stable": "false", "method": "GET", "path": path + "/account"})
		return
	}
	d.set(id, "account", p, "pass", "account_binding_verified", "accounts", map[string]string{"binding_stable": "true", "identity_match": "true", "generation_match": "true"})
	if capErr != nil {
		d.failed(id, "capabilities", p, capErr)
	} else if err := validateDesktopHiveCapabilities(caps, p, time.Now()); err != nil || caps.Status != "ready" || caps.ObservedAt.IsZero() || !time.Now().Before(caps.ObservedAt.Add(beewire.CapabilityLifetimeFor(p))) {
		d.set(id, "capabilities", p, "fail", "capabilities_unconfirmed", "accounts", map[string]string{"method": "GET", "path": path + "/capabilities"})
	} else {
		d.set(id, "capabilities", p, "pass", "capabilities_synchronized", "accounts", map[string]string{"method": "GET", "path": path + "/capabilities", "binding_stable": "true"})
	}
	if supplyErr != nil {
		d.failed(id, "supply", p, supplyErr)
		return
	}
	if supply.Platform != p {
		d.set(id, "supply", p, "fail", "supply_result_unconfirmed", "overview", map[string]string{"platform_match": "false"})
		return
	}
	checks := doctorSupplyChecks(p, supply, "")
	status, code := "pass", "taking_new_work"
	evidence := map[string]string{"ready": strconv.FormatBool(supply.Ready), "paused": strconv.FormatBool(supply.Paused), "reasons_count": strconv.Itoa(len(supply.Reasons))}
	for _, c := range checks {
		if c.Status != "pass" {
			status = "fail"
			code = "supply_blocked"
			if _, known := beewire.ExplainReason(c.Code, p); known {
				evidence["reason"] = c.Code
			} else {
				code = "supply_result_unconfirmed"
			}
			break
		}
	}
	d.set(id, "supply", p, status, code, "overview", evidence)
}

func diagnosticQuotaResult(capabilities DesktopAccountCapabilities, now time.Time) (string, string, map[string]string) {
	status, code := "pass", "quota_available"
	evidence := map[string]string{"windows": strconv.Itoa(len(capabilities.Windows))}
	until, err := time.Parse(time.RFC3339Nano, valueOrEmpty(capabilities.ValidUntil))
	if capabilities.Status != "ready" || err != nil || !now.Before(until) || len(capabilities.Windows) == 0 {
		return "skipped", "quota_unconfirmed", evidence
	}
	maxUsed := 0
	for _, w := range capabilities.Windows {
		reset, err := time.Parse(time.RFC3339Nano, valueOrEmpty(w.ResetAt))
		if w.UsedPercent == nil || *w.UsedPercent < 0 || *w.UsedPercent > 10000 || err != nil || !now.Before(reset) {
			return "skipped", "quota_unconfirmed", evidence
		}
		if *w.UsedPercent > maxUsed {
			maxUsed = *w.UsedPercent
		}
		if *w.UsedPercent >= 100 {
			status, code = "fail", "quota_exhausted"
		}
	}
	evidence["max_used_percent"] = strconv.Itoa(maxUsed)
	return status, code, evidence
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
