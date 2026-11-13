package bee

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os/exec"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"time"
)

type DesktopLoginActions struct {
	Open    bool `json:"open"`
	Cancel  bool `json:"cancel"`
	Retry   bool `json:"retry"`
	Recheck bool `json:"recheck"`
	Restart bool `json:"restart"`
}
type DesktopLoginProgress struct {
	Operation       DesktopOperation     `json:"operation"`
	Sequence        int64                `json:"sequence"`
	Phase           string               `json:"phase"`
	StopReason      *string              `json:"stop_reason"`
	RecheckInFlight bool                 `json:"recheck_in_flight"`
	Actions         DesktopLoginActions  `json:"actions"`
	Blocker         *DesktopAccountError `json:"blocker"`
}
type DesktopLoginOpenReceipt struct {
	Opened   bool                 `json:"opened"`
	Error    *DesktopAccountError `json:"error"`
	Progress DesktopLoginProgress `json:"progress"`
}

// Only current owned jobs or the current verified journal may be observed.
// Snapshot(false) neither starts a maintenance worker nor replays a business write.
func (o *DesktopAuthorizer) Progress(ctx context.Context, id string) (DesktopLoginProgress, error) {
	if !desktopHexID(id, 24) {
		return DesktopLoginProgress{}, fmt.Errorf("login progress operation ID requires 48 lowercase hex")
	}
	snapshot, err := o.accounts.Snapshot(ctx, "openai", false)
	if err != nil {
		return DesktopLoginProgress{}, err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	job := o.jobs[id]
	maintenance := snapshot.LoginMaintenance
	if maintenance != nil && maintenance.Operation.ID != id {
		maintenance = nil
	}
	if job == nil && maintenance == nil {
		return DesktopLoginProgress{}, fmt.Errorf("login progress ID is neither owned nor the current verified OpenAI maintenance record")
	}
	value := DesktopLoginProgress{Phase: "finished"}
	if job != nil {
		if job.request.Platform != "openai" {
			return DesktopLoginProgress{}, fmt.Errorf("detailed login progress requires platform=openai; actual=%s", job.request.Platform)
		}
		value.Operation = copyDesktopOperation(job.operation)
		value.Phase = job.phase
		if value.Phase == "" {
			value.Phase = "starting"
		}
		if job.ctx.Err() != nil && (job.operation.State == "pending" || job.operation.State == "running") {
			reason := "cancelled"
			if errors.Is(job.ctx.Err(), context.DeadlineExceeded) {
				reason = "timed_out"
			}
			value.StopReason = &reason
			job.loginLink = ""
			value.Phase = "cleaning_up"
		}
		live := !o.closed && job.ctx.Err() == nil && (job.operation.State == "pending" || job.operation.State == "running")
		value.Actions.Open = live && value.Phase == "waiting_authorization" && job.loginLink != ""
		value.Actions.Cancel = live && value.Phase != "cleaning_up" && value.Phase != "finished"
		if job.processCleanupErr != nil {
			value.Blocker = accountFailure("openai", "login_process_cleanup_unconfirmed", "official_process_cleanup", job.processCleanupErr.Error())
		}
	} else {
		value.Operation = copyDesktopOperation(maintenance.Operation)
	}
	value.RecheckInFlight = o.rechecks[id]
	if maintenance != nil {
		if value.Blocker == nil {
			value.Blocker = maintenance.Error
		}
		value.Actions.Recheck = maintenance.CanRecheck && !value.RecheckInFlight && value.Phase == "finished" && (job == nil || job.processCleanupErr == nil)
	}
	terminal := value.Operation.State == "failed" || value.Operation.State == "cancelled" || value.Operation.State == "unknown"
	value.Actions.Retry = !o.closed && terminal && value.Phase == "finished" && value.Blocker == nil && !value.RecheckInFlight && (maintenance == nil || maintenance.Phase == "restored")
	// Restart has a separate durable workflow and is deliberately not advertised
	// by this extension. Direct retry still executes Start's atomic admission.
	if value.RecheckInFlight {
		value.Actions = DesktopLoginActions{}
	}
	if value.StopReason == nil && value.Operation.State == "failed" {
		reason := "failed"
		if value.Operation.Error != nil && value.Operation.Error.Code == "authorization_timeout" {
			reason = "timed_out"
		}
		value.StopReason = &reason
	}
	if value.Operation.State == "cancelled" {
		reason := "cancelled"
		value.StopReason = &reason
	}
	previous, seen := o.observations[id]
	value.Sequence = previous.Sequence
	compare := previous
	compare.Sequence = value.Sequence
	if seen && !reflect.DeepEqual(compare, value) {
		value.Sequence++
	}
	o.observations[id] = value
	return value, nil
}

// Worker start and completion must advance even when no observer polls between them.
func (o *DesktopAuthorizer) advanceLoginSequenceLocked(id string) {
	previous := o.observations[id]
	previous.Sequence++
	o.observations[id] = previous
}
func (o *DesktopAuthorizer) setLoginPhase(job *desktopAuthorization, phase string) {
	o.mu.Lock()
	job.phase = phase
	if phase != "waiting_authorization" {
		job.loginLink = ""
	}
	o.mu.Unlock()
}
func (o *DesktopAuthorizer) acceptLoginLink(id, link string) {
	if !validDesktopLoginURL(link) {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	job := o.jobs[id]
	if job == nil || o.closed || job.ctx.Err() != nil || job.request.Platform != "openai" || (job.phase != "starting" && job.phase != "waiting_authorization") {
		return
	}
	if job.loginLink != "" && job.loginLink != link {
		return
	}
	job.loginLink, job.phase = link, "waiting_authorization"
}

func (o *DesktopAuthorizer) Open(ctx context.Context, id string) (DesktopLoginOpenReceipt, error) {
	progress, err := o.Progress(ctx, id)
	if err != nil {
		return DesktopLoginOpenReceipt{}, err
	}
	o.mu.Lock()
	job := o.jobs[id]
	link := ""
	var loginContext context.Context
	if job != nil && !o.closed && job.ctx.Err() == nil && job.phase == "waiting_authorization" {
		link = job.loginLink
		loginContext = job.ctx
	}
	o.mu.Unlock()
	var failure *DesktopAccountError
	opened := false
	if link == "" || !progress.Actions.Open {
		failure = accountFailure("openai", "authorization_link_unavailable", "authorization_link", "current login has no openable link; phase="+progress.Phase)
	} else {
		live, cancel := context.WithTimeout(loginContext, 5*time.Second)
		stop := context.AfterFunc(ctx, cancel)
		if ctx.Err() != nil {
			cancel()
		}
		err = o.openBrowser(live, link)
		stop()
		cancel()
		opened = err == nil
		if err != nil {
			failure = accountFailure("openai", "authorization_browser_open_failed", "browser_opener", "system browser launcher failed: "+err.Error())
		}
	}
	latest, err := o.Progress(ctx, id)
	if err != nil {
		return DesktopLoginOpenReceipt{}, err
	}
	return DesktopLoginOpenReceipt{Opened: opened, Error: failure, Progress: latest}, nil
}

func openDesktopLoginURL(ctx context.Context, link string) error {
	if !validDesktopLoginURL(link) {
		return fmt.Errorf("browser opener rejected URL: required=validated official login URL")
	}
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.CommandContext(ctx, "open", "--", link)
	case "windows":
		command = exec.CommandContext(ctx, "rundll32.exe", "url.dll,FileProtocolHandler", link)
	default:
		command = exec.CommandContext(ctx, "xdg-open", link)
	}
	command.Stdout, command.Stderr = io.Discard, io.Discard
	if err := command.Run(); err != nil {
		return errors.Join(ctx.Err(), desktopAuthorizationProcessError("browser launcher", err))
	}
	return nil
}

func validDesktopLoginURL(value string) bool {
	if len(value) > 16384 || strings.ContainsAny(value, "\r\n\t ") {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Host != "auth.openai.com" || u.Path != "/oauth/authorize" || u.RawPath != "" || u.User != nil || u.Fragment != "" {
		return false
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return false
	}
	for _, values := range q {
		if len(values) != 1 || values[0] == "" {
			return false
		}
	}
	if q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" || len(q.Get("state")) < 8 || len(q.Get("code_challenge")) != 43 || q.Get("client_id") == "" {
		return false
	}
	for _, c := range q.Get("code_challenge") {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	callback := q.Get("redirect_uri")
	if callback != "http://127.0.0.1:1455/auth/callback" && callback != "http://127.0.0.1:1457/auth/callback" {
		return false
	}
	return true
}

// A line longer than the bound is discarded to its delimiter, rather than
// keeping its tail and accidentally accepting a URL inside truncated output.
type desktopLoginOutput struct {
	mu       sync.Mutex
	line     []byte
	overflow bool
	accept   func(string)
}

func newDesktopLoginOutput(accept func(string)) *desktopLoginOutput {
	return &desktopLoginOutput{accept: accept}
}
func (s *desktopLoginOutput) Write(value []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range value {
		if c == '\n' || c == '\r' {
			if !s.overflow {
				line := string(bytes.TrimSpace(s.line))
				if validDesktopLoginURL(line) {
					s.accept(line)
				}
			}
			clear(s.line)
			s.line = s.line[:0]
			s.overflow = false
		} else if len(s.line) < 16384 && !s.overflow {
			s.line = append(s.line, c)
		} else {
			clear(s.line)
			s.line = s.line[:0]
			s.overflow = true
		}
	}
	return len(value), nil
}

func (s *desktopLoginOutput) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	clear(s.line)
	s.line = nil
	s.overflow = true
	s.accept = func(string) {}
}
