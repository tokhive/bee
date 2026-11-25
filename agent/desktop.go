package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/tokhive/bee/beewire"
)

// A desktop Bee (bee run --desktop) is run by the desktop app. Unlike bee run
// it starts unpaired, pairs through the control interface, keeps its tunnel
// open with no account configured, and when Hive revokes the device it stays
// up and waits to be paired again instead of exiting.

// pairer is what the control interface needs to pair a device.
type pairer interface {
	startPairing(ctx context.Context, hive, name string) (pairingStatus, error)
	pairingStatus() pairingStatus
	cancelPairing()
}

// Pairing states.
const (
	pairingNone      = ""
	pairingPending   = "pending"
	pairingCompleted = "completed"
	pairingExpired   = "expired"
	pairingCancelled = "cancelled"
	pairingFailed    = "failed"
)

// pairingStatus is one pairing attempt as the desktop app shows it.
type pairingStatus struct {
	Status string `json:"status"`
	// UserCode is shown so the person can match it with the code Hive's page
	// shows; VerificationURL already carries it.
	UserCode        string    `json:"user_code,omitempty"`
	VerificationURL string    `json:"verification_url,omitempty"`
	ExpiresAt       time.Time `json:"expires_at,omitzero"`
	// WaitingForOldDevice is set while Hive lets the Bee being replaced
	// finish its work before the pairing completes.
	WaitingForOldDevice bool            `json:"waiting_for_old_device,omitempty"`
	Problem             *controlProblem `json:"problem,omitempty"`
}

var errInvalidPairingInput = errors.New("invalid pairing request")

type desktopRunner struct {
	configPath string
	egress     *egressConfig
	status     *runStatus
	out        io.Writer
	client     *http.Client
	// pollInterval is how often a pending pairing asks Hive for its result.
	pollInterval time.Duration
	// connect is the connection loop; tests replace it.
	connect func(context.Context, localState, *egressConfig, io.Writer) error
	// claudeProfile asks Anthropic which account a Claude sign-in is;
	// tests replace it.
	claudeProfile func(context.Context, claudeCredential) (claudeIdentity, error)
	// drainTimeout bounds how long removing an account waits for its
	// streams; confirmWindow and confirmPoll bound confirming a new account.
	drainTimeout  time.Duration
	confirmWindow time.Duration
	confirmPoll   time.Duration
	accountsMu    sync.Mutex

	mu      sync.Mutex
	pairing pairingStatus
	cancel  context.CancelFunc
	// attempt identifies the current pairing, so a cancelled one cannot
	// overwrite its successor's status.
	attempt int
	// rebound is signalled when a new device configuration is saved.
	rebound chan struct{}
}

func newDesktopRunner(configPath string, egress *egressConfig, status *runStatus, out io.Writer) *desktopRunner {
	return &desktopRunner{configPath: configPath, egress: egress, status: status, out: out, client: httpClient(), pollInterval: 2 * time.Second, connect: connect, rebound: make(chan struct{}, 1),
		claudeProfile: func(ctx context.Context, credential claudeCredential) (claudeIdentity, error) {
			return queryClaudeProfile(ctx, credential, nil)
		},
		drainTimeout: time.Minute, confirmWindow: 2 * time.Minute, confirmPoll: 3 * time.Second}
}

// runDesktop is bee run --desktop. The caller holds the configuration lock.
func runDesktop(ctx context.Context, configPath, egressPath string, out io.Writer) error {
	state, err := readState(configPath)
	if err != nil {
		return err
	}
	console := newConsole(out)
	slog.Info(versionLine(), "module", "connect")
	if egressPath == "" && fileExists(defaultEgressPath(configPath)) {
		egressPath = defaultEgressPath(configPath)
	}
	egress := &egressConfig{}
	if egressPath != "" {
		if egress, err = readEgress(ctx, egressPath); err != nil {
			return err
		}
		egress.useStateDirectory(filepath.Dir(configPath))
		notify(console, slog.LevelInfo, "connect", "using egress configuration", "path", egressPath)
	}
	// The tunnel stays open with no account, so adding the first one needs
	// no reconnect.
	egress.liveSources = true
	status := newRunStatus()
	binding := bindingUnpaired
	if state.Identity != nil {
		binding = bindingPaired
	} else {
		// Nothing connects until the device is paired.
		status.setConnection(connectionDisconnected)
	}
	status.setDevice(state, binding)
	runner := newDesktopRunner(configPath, egress, status, console)
	if err := runner.adoptConfiguredAccounts(); err != nil {
		notify(console, slog.LevelWarn, "accounts", "account records unavailable", "error", err.Error())
	}
	ctx = withRunStatus(ctx, status)
	defer serveControl(configPath, egress, status, runner, console)()
	return runWithTelemetry(ctx, runner.run)
}

// run keeps the paired device connected until ctx ends. It returns only then.
func (r *desktopRunner) run(ctx context.Context) error {
	delay := time.Second
	for ctx.Err() == nil {
		state, binding := r.status.device()
		if binding != bindingPaired {
			r.status.setConnection(connectionDisconnected)
			select {
			case <-ctx.Done():
			case <-r.rebound:
			}
			continue
		}
		live, cancel := context.WithCancel(ctx)
		go func() {
			for {
				select {
				case <-r.rebound:
					// A signal left from an earlier pairing names the
					// device already in use and changes nothing.
					if current, _ := r.status.device(); current.Credential != state.Credential {
						cancel()
						return
					}
				case <-live.Done():
					return
				}
			}
		}()
		err := r.connect(live, state, r.egress, r.out)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if current, _ := r.status.device(); current.Credential != state.Credential {
			// Paired anew; connect with the new device.
			r.status.setProblem(nil)
			delay = time.Second
			continue
		}
		var failure *apiFailure
		switch {
		case err == nil:
			// connect ends on its own only when Hive says another Bee
			// replaced this one.
			r.status.setDevice(state, bindingReplaced)
		case errors.As(err, &failure) && (failure.Status == 401 || failure.Status == 403):
			r.status.setDevice(state, bindingInvalid)
		default:
			r.status.setConnection(connectionDisconnected)
			r.status.setProblem(problemOf(err))
			notify(r.out, slog.LevelWarn, "connect", "connection stopped; retrying", "error", err.Error(), "retry_delay", delay.String())
			select {
			case <-ctx.Done():
			case <-r.rebound:
			case <-time.After(delay):
			}
			delay = min(delay*2, 30*time.Second)
		}
	}
	return nil
}

func (r *desktopRunner) pairingStatus() pairingStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.pairing
}

func (r *desktopRunner) cancelPairing() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil && r.pairing.Status == pairingPending {
		r.cancel()
		r.cancel = nil
		r.pairing = pairingStatus{Status: pairingCancelled}
		r.publishPairing()
	}
}

// startPairing asks Hive for a pairing code for a new device credential and
// waits in the background for the person to confirm it. A pending attempt is
// replaced. The current device keeps running until the new one is confirmed.
func (r *desktopRunner) startPairing(ctx context.Context, hive, name string) (pairingStatus, error) {
	current, _ := r.status.device()
	if hive == "" {
		hive = current.Hive
	}
	if hive == "" {
		hive = DefaultHive
	}
	origin, err := hiveOrigin(hiveInput(hive))
	if err != nil {
		return pairingStatus{}, fmt.Errorf("%w: %v", errInvalidPairingInput, err)
	}
	if name == "" {
		name = current.Name
	}
	next, err := newDeviceState(origin, name)
	if err != nil {
		return pairingStatus{}, fmt.Errorf("%w: %v", errInvalidPairingInput, err)
	}
	hash := sha256.Sum256([]byte(next.Credential))
	request, cancelRequest := context.WithTimeout(ctx, 15*time.Second)
	defer cancelRequest()
	var pair beewire.Pairing
	if err := call(request, r.client, origin, "/api/bee/pairings", "POST", "", beewire.StartPairing{Name: next.Name, CredentialHash: hex.EncodeToString(hash[:])}, &pair); err != nil {
		return pairingStatus{}, err
	}
	link := pair.VerificationURI + "?code=" + url.QueryEscape(pair.UserCode)
	r.mu.Lock()
	if r.cancel != nil {
		r.cancel()
	}
	r.attempt++
	attempt := r.attempt
	wait, cancel := context.WithDeadline(context.Background(), pair.ExpiresAt)
	r.cancel = cancel
	r.pairing = pairingStatus{Status: pairingPending, UserCode: pair.UserCode, VerificationURL: link, ExpiresAt: pair.ExpiresAt}
	status := r.pairing
	r.publishPairing()
	r.mu.Unlock()
	go r.awaitPairing(wait, attempt, next, pair)
	return status, nil
}

// awaitPairing polls Hive until the pairing is confirmed, expires or is
// cancelled, and on confirmation saves the new device configuration.
func (r *desktopRunner) awaitPairing(ctx context.Context, attempt int, next localState, pair beewire.Pairing) {
	finish := func(update func(*pairingStatus)) {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.attempt != attempt {
			return
		}
		update(&r.pairing)
		if r.pairing.Status != pairingPending && r.cancel != nil {
			r.cancel()
			r.cancel = nil
		}
		r.publishPairing()
	}
	for {
		if pause(ctx, r.pollInterval) != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				finish(func(p *pairingStatus) { p.Status = pairingExpired; p.WaitingForOldDevice = false })
			}
			return
		}
		var polled beewire.Pairing
		if err := call(ctx, r.client, next.Hive, "/api/bee/pairings", "GET", pair.PairingToken, nil, &polled); err != nil {
			if ctx.Err() != nil {
				continue
			}
			// A failed poll is retried; Hive may be briefly unreachable.
			slog.Warn("pairing status unavailable; retrying", "module", "identity", "error", err.Error())
			continue
		}
		switch polled.Status {
		case "pending":
			continue
		case "draining":
			finish(func(p *pairingStatus) { p.WaitingForOldDevice = true })
			continue
		case "approved":
		default:
			finish(func(p *pairingStatus) {
				p.Status = pairingFailed
				p.Problem = &controlProblem{Code: "pairing_" + polled.Status, Message: "Hive ended the pairing: " + polled.Status}
			})
			return
		}
		var identity beewire.Identity
		err := call(ctx, r.client, next.Hive, "/api/bee/pairings/redeem", "POST", pair.PairingToken, struct{}{}, &identity)
		var failure *apiFailure
		if errors.As(err, &failure) && failure.Code == "device_draining" {
			finish(func(p *pairingStatus) { p.WaitingForOldDevice = true })
			continue
		}
		if err != nil {
			// The exchange may have succeeded with only the answer lost; the
			// new credential tells.
			if identityErr := callState(ctx, r.client, next, "/api/bee/identity", "GET", nil, &identity); identityErr != nil {
				finish(func(p *pairingStatus) { p.Status = pairingFailed; p.Problem = problemOf(err) })
				return
			}
		}
		next.Identity = &identity
		if err := r.adopt(next); err != nil {
			finish(func(p *pairingStatus) { p.Status = pairingFailed; p.Problem = problemOf(err) })
			return
		}
		finish(func(p *pairingStatus) { p.Status = pairingCompleted; p.WaitingForOldDevice = false })
		slog.Info("device paired", "module", "identity", "device", identity.ID, "owner", identity.OwnerEmail)
		return
	}
}

// adopt saves a newly paired device configuration, keeping a private copy of
// the one it replaces, and switches the run over to it.
func (r *desktopRunner) adopt(next localState) error {
	if previous, err := os.ReadFile(r.configPath); err == nil {
		directory, err := os.MkdirTemp(filepath.Dir(r.configPath), "bee.json.backup.")
		if err != nil {
			return fmt.Errorf("create private backup: %w", err)
		}
		if err := privateReplace(filepath.Join(directory, "bee.json"), previous); err != nil {
			return fmt.Errorf("back up %s: %w", r.configPath, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := saveState(r.configPath, next); err != nil {
		return err
	}
	r.status.setDevice(next, bindingPaired)
	select {
	case r.rebound <- struct{}{}:
	default:
	}
	return nil
}

// publishPairing tells event subscribers; the caller holds r.mu.
func (r *desktopRunner) publishPairing() {
	r.status.publish(controlEvent{Name: "pairing", Data: r.pairing})
}
