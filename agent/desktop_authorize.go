package bee

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type desktopAuthorization struct {
	operation         DesktopOperation
	request           DesktopAuthorizeRequest
	cancel            context.CancelFunc
	ctx               context.Context
	done              chan struct{}
	maintenance       *desktopLoginRecord
	cleanupErr        error
	processCleanupErr error
	phase             string
	loginLink         string // Sensitive, ephemeral; never persisted or returned.
}

// A process cleanup failure is distinct from a nonzero official login result.
// Only the supervisor that joined the owned tree can provide this evidence.
type desktopAuthorizationCleanupError struct{ cause error }

func (e *desktopAuthorizationCleanupError) Error() string { return e.cause.Error() }
func (e *desktopAuthorizationCleanupError) Unwrap() error { return e.cause }

// DesktopAuthorizer supervises only the official commands it starts. It never
// receives login passwords, callback URLs or authorization material from the UI.
type DesktopAuthorizer struct {
	mu           sync.Mutex
	ctx          context.Context
	cancel       context.CancelFunc
	workers      sync.WaitGroup
	closed       bool
	accounts     *DesktopAccounts
	jobs         map[string]*desktopAuthorization
	timeout      time.Duration
	resolve      func(string) (string, error)
	command      func(string, ...string) *exec.Cmd
	interact     func(context.Context, *exec.Cmd) error
	openBrowser  func(context.Context, string) error
	observations map[string]DesktopLoginProgress
	rechecks     map[string]bool
}

func NewDesktopAuthorizer(parent context.Context, a *DesktopAccounts) *DesktopAuthorizer {
	ctx, cancel := context.WithCancel(parent)
	owner := &DesktopAuthorizer{ctx: ctx, cancel: cancel, accounts: a, jobs: map[string]*desktopAuthorization{}, timeout: 10 * time.Minute, resolve: desktopOfficialExecutable, command: exec.Command, interact: runDesktopInteractiveAuthorization, openBrowser: openDesktopLoginURL, observations: map[string]DesktopLoginProgress{}, rechecks: map[string]bool{}}
	a.lifecycleMu.Lock()
	a.authorizer = owner
	a.lifecycleMu.Unlock()
	for platform := range a.platforms {
		p, release, _ := a.acquire(context.Background(), platform)
		p.snapshot.Features.Authorize = DesktopAccountAvailability{Available: true}
		release()
	}
	return owner
}
func (o *DesktopAuthorizer) Close() {
	o.mu.Lock()
	o.closed = true
	o.cancel()
	o.mu.Unlock()
	o.workers.Wait()
}

// CancelAndWait cancels the current owned jobs and joins their complete source
// reconciliation. Shutdown admission is closed by the runtime before this call.
func (o *DesktopAuthorizer) CancelAndWait() error {
	o.mu.Lock()
	jobs := make([]*desktopAuthorization, 0, len(o.jobs))
	for _, job := range o.jobs {
		job.cancel()
		jobs = append(jobs, job)
	}
	o.mu.Unlock()
	var result error
	for _, job := range jobs {
		<-job.done
		o.mu.Lock()
		result = errors.Join(result, job.cleanupErr)
		o.mu.Unlock()
	}
	return result
}

func (a *DesktopAccounts) cancelAndWaitAuthorizations() error {
	a.lifecycleMu.Lock()
	o := a.authorizer
	a.lifecycleMu.Unlock()
	if o == nil {
		return nil
	}
	return o.CancelAndWait()
}
func copyDesktopOperation(op DesktopOperation) DesktopOperation {
	raw, _ := json.Marshal(op)
	var result DesktopOperation
	_ = json.Unmarshal(raw, &result)
	return result
}
func (o *DesktopAuthorizer) Start(ctx context.Context, request DesktopAuthorizeRequest) (DesktopOperation, error) {
	if err := validateDesktopAccountDetect(DesktopAccountDetectRequest{Platform: request.Platform, Directory: request.Source.Directory, Store: request.Source.Store, Mode: "local"}); err != nil {
		return DesktopOperation{}, err
	}
	if !desktopSafeRevision(request.ExpectedRevision) {
		return DesktopOperation{}, fmt.Errorf("authorize expected_revision outside safe integer range")
	}
	p, release, err := o.accounts.acquire(ctx, request.Platform)
	if err != nil {
		return DesktopOperation{}, err
	}
	defer release()
	if _, err := o.accounts.loadLoginMaintenance(ctx, p, request.Platform); err != nil {
		return DesktopOperation{}, err
	}
	o.accounts.lifecycleMu.Lock()
	defer o.accounts.lifecycleMu.Unlock()
	if o.accounts.runtime != nil {
		if err := o.accounts.runtime.switchMaintenanceBarrier(); err != nil {
			return DesktopOperation{}, err
		}
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.accounts.device != nil {
		if err := o.accounts.device.recoveryWriteBarrier(); err != nil {
			return DesktopOperation{}, err
		}
	}
	if o.closed || o.accounts.closed {
		return DesktopOperation{}, fmt.Errorf("official login rejected: owner closed")
	}
	if p.working || o.accounts.activeActions[request.Platform] {
		return DesktopOperation{}, fmt.Errorf("official login rejected: platform operation already active")
	}
	if p.snapshot.Revision != request.ExpectedRevision {
		return DesktopOperation{}, fmt.Errorf("authorize revision changed: actual=%d expected=%d", p.snapshot.Revision, request.ExpectedRevision)
	}
	if r := o.accounts.runtime; r != nil {
		r.mu.Lock()
		state := r.snapshot.Local
		blocked := r.closed || r.presence.shutdown || r.presence.suspended
		r.mu.Unlock()
		if blocked || (state != "stopped" && state != "failed" && state != "waiting" && state != "running") || (state == "running" && (r.device == nil || r.slots[request.Platform] == nil)) {
			return DesktopOperation{}, fmt.Errorf("official login admission blocked: local=%s shutdown=%t owned_platform=%t; required=stable owned runtime", state, blocked, r.slots[request.Platform] != nil)
		}
	}
	if p.snapshot.LoginMaintenance != nil && p.snapshot.LoginMaintenance.CanRecheck {
		return DesktopOperation{}, fmt.Errorf("official login blocked by unresolved maintenance: phase=%s; recheck the original process before another login", p.snapshot.LoginMaintenance.Phase)
	}
	if _, _, err := desktopAuthorizationArgs(request, o.accounts.goos); err != nil {
		return DesktopOperation{}, err
	}
	id, err := desktopOperationID()
	if err != nil {
		return DesktopOperation{}, err
	}
	live, cancel := context.WithTimeout(o.ctx, o.timeout)
	p.working = true
	o.accounts.activeActions[request.Platform] = true
	p.source = nil
	p.credentialRevision = ""
	p.official = nil
	p.snapshot.Candidate = DesktopAccountCandidate{State: "not_checked"}
	p.snapshot.Revision++
	op := DesktopOperation{ID: id, Kind: "authorize", Platform: accountString(request.Platform), State: "pending", Revision: p.snapshot.Revision}
	p.snapshot.Operation = &op
	job := &desktopAuthorization{operation: op, request: request, ctx: live, cancel: cancel, done: make(chan struct{}), phase: "starting"}
	// Keep at most the latest owned operation per platform; old IDs never attach
	// to another process or a later authorization attempt.
	for key, old := range o.jobs {
		if old.request.Platform == request.Platform {
			delete(o.jobs, key)
			delete(o.observations, key)
		}
	}
	o.jobs[id] = job
	o.workers.Add(1)
	go func() {
		defer o.workers.Done()
		defer close(job.done)
		defer cancel()
		err := o.authorize(job)
		o.reconcileAuthorization(job, err)
		o.finish(job, err)
	}()
	return copyDesktopOperation(op), nil
}
func (o *DesktopAuthorizer) Status(ctx context.Context, id string) (DesktopOperation, error) {
	if err := ctx.Err(); err != nil {
		return DesktopOperation{}, err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	job, ok := o.jobs[id]
	if !ok || !desktopHexID(id, 24) {
		return DesktopOperation{}, fmt.Errorf("authorization operation is not owned by this management instance")
	}
	return copyDesktopOperation(job.operation), nil
}
func (o *DesktopAuthorizer) Cancel(ctx context.Context, id string) (DesktopOperation, error) {
	if err := ctx.Err(); err != nil {
		return DesktopOperation{}, err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	job, ok := o.jobs[id]
	if !ok || !desktopHexID(id, 24) {
		return DesktopOperation{}, fmt.Errorf("authorization operation is not owned by this management instance")
	}
	if job.operation.State == "pending" || job.operation.State == "running" {
		job.loginLink = ""
		job.phase = "cleaning_up"
		job.cancel()
	}
	// Cancellation is terminal only after the owned process has exited and joined.
	return copyDesktopOperation(job.operation), nil
}
func (o *DesktopAuthorizer) authorize(job *desktopAuthorization) (resultErr error) {
	request, ctx := job.request, job.ctx
	check := "official_executable"
	defer func() {
		if ctx.Err() != nil {
			code := "authorization_cancelled"
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				code = "authorization_timeout"
			}
			cause := errors.Join(ctx.Err(), resultErr)
			resultErr = desktopAuthorizationFailure(request.Platform, code, check, cause.Error(), map[string]string{"confirmed": "false"}, cause)
		}
	}()
	program, err := o.resolve(request.Platform)
	if err != nil {
		return accountFailure(request.Platform, "client_missing", "official_executable", err.Error())
	}
	args, env, err := desktopAuthorizationArgs(request, o.accounts.goos)
	if err != nil {
		return err
	}
	check = "official_version"
	version, err := o.probe(ctx, program, env, "--version")
	if err != nil {
		return desktopAuthorizationFailure(request.Platform, "client_version_probe_failed", check, "official version probe failed: "+err.Error(), nil, err)
	}
	if !desktopAuthorizationVersion(request.Platform, version) {
		return desktopAuthorizationFailure(request.Platform, "client_version_unsupported", check, fmt.Sprintf("official client version unsupported: platform=%s response_bytes=%d; supported=Codex 0.162.x/0.163.x or Claude Code 2.1.153+ within 2.1.x", request.Platform, len(version)), map[string]string{"parsed": "false"}, nil)
	}
	helpArgs := []string{"login", "--help"}
	if request.Platform == "claude" {
		helpArgs = []string{"auth", "login", "--help"}
	}
	check = "official_capability"
	help, err := o.probe(ctx, program, env, helpArgs...)
	if err != nil {
		return desktopAuthorizationFailure(request.Platform, "client_capability_probe_failed", check, "official login capability probe failed: "+err.Error(), nil, err)
	}
	if !strings.Contains(help, "login") || request.Platform == "claude" && !strings.Contains(help, "--claudeai") {
		return desktopAuthorizationFailure(request.Platform, "client_capability_missing", check, fmt.Sprintf("official login help lacks required command capability: platform=%s response_bytes=%d", request.Platform, len(help)), map[string]string{"confirmed": "false"}, nil)
	}
	detect := DesktopAccountDetectRequest{Platform: request.Platform, Directory: request.Source.Directory, Store: request.Source.Store, Mode: "local"}
	// Freeze the source actually passed to the official command. In particular,
	// auto login targets file and must not read a fallback keyring or follow a
	// subsequently replaced directory symlink during verification.
	if request.Platform == "openai" {
		directory := env["CODEX_HOME"]
		detect.Directory = &directory
		if detect.Store == "auto" {
			detect.Store = "file"
		}
	} else if request.Source.Store == "file" {
		directory := env["CLAUDE_CONFIG_DIR"]
		detect.Directory = &directory
	}
	check = "official_source_read"
	before, failure := o.accounts.readAccountSource(ctx, detect)
	defer before.clear()
	// A readable but malformed old record must not prevent the official client
	// from replacing it. Access failures still stop here. After login, the same
	// source must parse and pass all existing identity and revision checks; an
	// unchanged malformed record therefore cannot be accepted as success.
	if failure != nil && failure.Code != "source_missing" && failure.Code != "invalid_credentials" {
		return failure
	}
	check = "login_maintenance_prepare"
	if o.accounts.device != nil {
		lease, err := o.accounts.loginProcessLease(ctx, job.operation.ID, true)
		if err != nil {
			return err
		}
		defer lease.close()
		ctx = context.WithValue(ctx, desktopLoginProcessContextKey{}, lease)
		o.mu.Lock()
		job.ctx = ctx
		o.mu.Unlock()
	}
	if err := o.beginLoginMaintenance(job, detect); err != nil {
		return err
	}
	p, release, err := o.accounts.acquire(ctx, request.Platform)
	if err != nil {
		return err
	}
	p.snapshot.Revision++
	o.mu.Lock()
	job.operation.State = "running"
	job.operation.Revision = p.snapshot.Revision
	p.snapshot.Operation = operationPointer(copyDesktopOperation(job.operation))
	o.mu.Unlock()
	release()
	command := o.command(program, args...)
	command.Env = desktopAuthorizationEnvironment(command.Env, env)
	command.Stdin = nil
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if request.Platform == "openai" {
		// The bounded parser retains only a complete validated authorization URL.
		// It never forwards official output into errors, logs or the journal.
		output := newDesktopLoginOutput(func(link string) { o.acceptLoginLink(job.operation.ID, link) })
		command.Stderr = output
		defer output.Close()
	}
	check = "official_process"
	run := runDesktopAuthorization
	if request.Platform == "claude" {
		run = o.interact
	}
	if err := run(ctx, command); err != nil {
		o.setLoginPhase(job, "cleaning_up")
		return desktopAuthorizationFailure(request.Platform, "authorization_process_failed", check, "official login process failed: "+err.Error(), nil, err)
	}
	o.setLoginPhase(job, "verifying")
	if err := ctx.Err(); err != nil {
		return err
	}
	check = "official_source_recheck"
	after, failed := o.accounts.readAccountSource(ctx, detect)
	defer after.clear()
	if failed != nil {
		return failed
	}
	if !sameDesktopAuthorizationSource(after.source, DesktopAccountSource{Directory: detect.Directory, Store: detect.Store}) {
		return desktopAuthorizationFailure(request.Platform, "authorization_namespace_mismatch", "official_namespace", "official login source namespace differs from the started command; detect the intended source again", map[string]string{"source_revision_match": "false"}, nil)
	}
	if failure == nil && before.revision == after.revision {
		return desktopAuthorizationFailure(request.Platform, "authorization_source_unchanged", "official_source_revision", "official login exited successfully but selected source revision is unchanged; recheck official account before retrying", map[string]string{"source_revision_match": "true"}, nil)
	}
	fingerprint, err := o.accounts.selectionSource(ctx, request.Platform, desktopPendingOperation{Source: after.source, CredentialRevision: after.revision})
	if err != nil {
		return err
	}
	p, release, err = o.accounts.acquire(ctx, request.Platform)
	if err != nil {
		return err
	}
	defer release()
	if err := ctx.Err(); err != nil {
		return err
	}
	defer func() {
		if resultErr != nil {
			p.snapshot.Candidate = DesktopAccountCandidate{State: "not_checked"}
			p.source = nil
			p.credentialRevision = ""
			p.official = nil
		}
	}()
	snapshot, err := o.accounts.detectAccountLocked(ctx, p, detect)
	if err != nil {
		return err
	}
	if p.credentialRevision != after.revision || p.source == nil || !sameDesktopAuthorizationSource(*p.source, after.source) {
		return desktopAuthorizationFailure(request.Platform, "source_changed", "official_source_recheck", "official login source changed during final verification; detect the current account again", map[string]string{"source_revision_match": "false"}, nil)
	}
	if snapshot.Candidate.Reference == nil {
		return desktopAuthorizationFailure(request.Platform, "authorization_candidate_unconfirmed", "official_source_recheck", fmt.Sprintf("official login source recheck did not produce a selectable candidate: state=%s", snapshot.Candidate.State), map[string]string{"confirmed": "false"}, nil)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// Claude's fingerprint comes from the verified profile, not its token structure.
	if request.Platform == "claude" {
		p.snapshot.Candidate.Fingerprint = accountString(fingerprint)
		p.snapshot.Candidate.IdentityVerified = true
	}
	return nil
}
func operationPointer(op DesktopOperation) *DesktopOperation { return &op }

// Keep the machine cause and safe process chain together. Official output and
// executable paths are excluded by the existing supervisor/probe boundary.
func desktopAuthorizationFailure(platform, code, check, message string, evidence map[string]string, cause error) error {
	failure := accountFailure(platform, code, check, message)
	for key, value := range evidence {
		failure.Evidence[key] = value
	}
	if cause != nil {
		return errors.Join(failure, cause)
	}
	return failure
}
func (o *DesktopAuthorizer) finish(job *desktopAuthorization, err error) {
	p, release, _ := o.accounts.acquire(context.Background(), job.request.Platform)
	defer release()
	o.accounts.lifecycleMu.Lock()
	defer o.accounts.lifecycleMu.Unlock()
	o.mu.Lock()
	defer o.mu.Unlock()
	job.loginLink = ""
	job.phase = "finished"
	if job.processCleanupErr != nil {
		job.phase = "cleaning_up"
	}
	p.working = false
	delete(o.accounts.activeActions, job.request.Platform)
	p.snapshot.Revision++
	job.operation.Revision = p.snapshot.Revision
	if job.maintenance != nil {
		job.operation = copyDesktopOperation(job.maintenance.Public.Operation)
		job.operation.Revision = p.snapshot.Revision
		job.maintenance.Public.Operation = copyDesktopOperation(job.operation)
		p.snapshot.LoginMaintenance = copyDesktopLoginMaintenance(job.maintenance.Public)
		p.snapshot.Operation = operationPointer(copyDesktopOperation(job.operation))
		return
	}
	job.operation.State = "succeeded"
	if job.ctx.Err() != nil && !errors.Is(err, job.ctx.Err()) {
		code := "authorization_cancelled"
		if errors.Is(job.ctx.Err(), context.DeadlineExceeded) {
			code = "authorization_timeout"
		}
		cause := errors.Join(job.ctx.Err(), err)
		err = desktopAuthorizationFailure(job.request.Platform, code, "official_source_recheck", cause.Error(), map[string]string{"confirmed": "false"}, cause)
	}
	if err != nil {
		job.operation.State = "failed"
		if errors.Is(err, context.Canceled) {
			job.operation.State = "cancelled"
		}
		var failure *DesktopAccountError
		if errors.As(err, &failure) {
			job.operation.Error = failure
		} else {
			job.operation.Error = accountFailure(job.request.Platform, "authorization_unconfirmed", "official_login", err.Error())
		}
		// A cancellation cannot confirm a late result. Official changes may already
		// exist, so require an explicit new detection without selecting anything.
		if job.maintenance == nil {
			p.snapshot.Candidate = DesktopAccountCandidate{State: "not_checked"}
			p.source = nil
			p.credentialRevision = ""
		}
	}
	p.snapshot.Operation = operationPointer(copyDesktopOperation(job.operation))
}
func (o *DesktopAuthorizer) probe(ctx context.Context, program string, env map[string]string, args ...string) (string, error) {
	live, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	command := o.command(program, args...)
	command.Env = desktopAuthorizationEnvironment(command.Env, env)
	var output credentialBuffer
	defer clear(output.Bytes())
	command.Stdout = &output
	command.Stderr = io.Discard
	if err := runDesktopAuthorization(live, command); err != nil {
		return "", err
	}
	return strings.TrimSpace(output.String()), nil
}

var desktopCodexVersion = regexp.MustCompile(`^codex-cli 0\.(162|163)\.\d+$`)
var desktopClaudeVersion = regexp.MustCompile(`^2\.1\.(\d+) \(Claude Code\)$`)

func desktopAuthorizationVersion(platform, value string) bool {
	if platform == "openai" {
		return desktopCodexVersion.MatchString(value)
	}
	match := desktopClaudeVersion.FindStringSubmatch(value)
	if len(match) != 2 {
		return false
	}
	patch, err := strconv.Atoi(match[1])
	return err == nil && patch >= 153
}
func desktopAuthorizationArgs(request DesktopAuthorizeRequest, goos string) ([]string, map[string]string, error) {
	env := map[string]string{}
	if request.Platform == "openai" {
		directory, err := desktopCodexHome(request.Source.Directory)
		if err != nil {
			return nil, nil, err
		}
		if err := validateDesktopAccountDirectory(&directory); err != nil {
			return nil, nil, err
		}
		if canonical, err := filepath.EvalSymlinks(directory); err == nil {
			directory = canonical
		}
		store := request.Source.Store
		if store == "auto" {
			store = "file"
		}
		if store == "keyring" && goos != "darwin" {
			return nil, nil, accountFailure(request.Platform, "unsupported_store", "official_namespace", fmt.Sprintf("official Codex keyring source unsupported on OS=%s", goos))
		}
		env["CODEX_HOME"] = directory
		return []string{"login", "-c", "cli_auth_credentials_store=\"" + store + "\""}, env, nil
	}
	expected := "file"
	if goos == "darwin" {
		expected = "keychain"
	}
	if request.Source.Store != expected {
		return nil, nil, accountFailure(request.Platform, "authorization_namespace_mismatch", "official_namespace", fmt.Sprintf("official Claude login namespace mismatch: selected_store=%s required_store=%s OS=%s", request.Source.Store, expected, goos))
	}
	if expected == "file" {
		directory := resolveClaudeKeychain(request.Source.Directory).directory
		if err := validateDesktopAccountDirectory(&directory); err != nil {
			return nil, nil, err
		}
		if canonical, err := filepath.EvalSymlinks(directory); err == nil {
			directory = canonical
		}
		env["CLAUDE_CONFIG_DIR"] = directory
		env["CLAUDE_SECURESTORAGE_CONFIG_DIR"] = directory
	} else if request.Source.Directory != nil {
		env["CLAUDE_CONFIG_DIR"] = *request.Source.Directory
		env["CLAUDE_SECURESTORAGE_CONFIG_DIR"] = *request.Source.Directory
	}
	return []string{"auth", "login", "--claudeai"}, env, nil
}
func desktopAuthorizationEnvironment(inherited []string, overrides map[string]string) []string {
	if inherited == nil {
		inherited = os.Environ()
	}
	result := make([]string, 0, len(inherited)+len(overrides))
	for _, entry := range inherited {
		key, _, _ := strings.Cut(entry, "=")
		if _, ok := overrides[key]; ok {
			continue
		}
		switch key {
		case "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN":
			continue
		}
		result = append(result, entry)
	}
	for key, value := range overrides {
		result = append(result, key+"="+value)
	}
	return result
}
func desktopOfficialExecutable(platform string) (string, error) {
	name := "codex"
	if platform == "claude" {
		name = "claude"
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("official executable home lookup failed: %w", err)
	}
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	candidates := []string{filepath.Join(home, ".local", "bin", name+suffix), filepath.Join("/opt/homebrew/bin", name), filepath.Join("/usr/local/bin", name)}
	if found, err := exec.LookPath(name); err == nil {
		candidates = append(candidates, found)
	}
	for _, candidate := range candidates {
		if !filepath.IsAbs(candidate) {
			continue
		}
		path, err := filepath.EvalSymlinks(candidate)
		if err != nil {
			continue
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if runtime.GOOS != "windows" && (info.Mode().Perm()&0022 != 0 || info.Mode().Perm()&0111 == 0) {
			continue
		}
		if runtime.GOOS == "windows" && !strings.EqualFold(filepath.Ext(path), ".exe") {
			continue
		}
		return path, nil
	}
	return "", fmt.Errorf("official %s executable missing from supported install paths and PATH; install the official CLI first", name)
}

func sameDesktopAuthorizationSource(a, b DesktopAccountSource) bool {
	if a.Store != b.Store || (a.Directory == nil) != (b.Directory == nil) {
		return false
	}
	return a.Directory == nil || *a.Directory == *b.Directory
}

// PathError and exec.Error include complete local paths; keep only their cause.
func desktopAuthorizationProcessError(check string, err error) error {
	var path *os.PathError
	if errors.As(err, &path) {
		err = path.Err
	}
	var start *exec.Error
	if errors.As(err, &start) {
		err = start.Err
	}
	return fmt.Errorf("%s: %w", check, err)
}
func desktopAuthorizationExit(err error) error {
	if err == nil {
		return nil
	}
	var exited *exec.ExitError
	if errors.As(err, &exited) {
		return fmt.Errorf("official process exited: exit_code=%d", exited.ExitCode())
	}
	return desktopAuthorizationProcessError("wait official process", err)
}
