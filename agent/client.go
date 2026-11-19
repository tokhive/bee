package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/relay"
)

type apiFailure struct {
	Status int
	Code   string
	Body   string
}

func (e *apiFailure) Error() string {
	detail := e.hint()
	text := fmt.Sprintf("Hive request rejected: HTTP %d; code=%q; required=HTTP 2xx", e.Status, desktopSafeText(e.Code))
	if e.Body != "" {
		text += "; response_body=" + e.Body
	}
	if detail != "" {
		text += "; " + detail
	}
	return text
}
func (e *apiFailure) hint() string {
	switch e.Code {
	case "device_exists":
		return "this user already has a Bee; review and confirm replacement in the web console"
	case "device_draining":
		return "waiting for the old Bee to finish execution and settlement"
	case "replacement_pending":
		return "a new Bee is already waiting for replacement"
	case "pairing_expired":
		return "pairing expired; run bee login again"
	case "pairing_redeemed":
		return "pairing already redeemed; verify device identity"
	case "invalid_device_credential":
		return "invalid device credential; verify the Hive address and local configuration"
	case "device_replaced":
		return "device replaced; the old device credential has been revoked"
	case "rate_limited":
		return "too many requests; try again later"
	}
	return ""
}

// DefaultHive is the Hive a new device pairs with when no address is given.
// Builds for another Hive override it: -ldflags "-X main.defaultHive=https://hive.example".
var DefaultHive = "https://console.tokhive.ai"

// hiveInput turns a typed Hive address into a URL, reading a bare host as HTTPS.
func hiveInput(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw != "" && !strings.Contains(raw, "://") {
		return "https://" + raw
	}
	return raw
}

func hiveOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("Hive address must be a valid HTTPS origin")
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || (u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback())) {
			return "", errors.New("HTTP is allowed only for loopback addresses; remote Hive must use HTTPS")
		}
	}
	return u.Scheme + "://" + u.Host, nil
}

func httpClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func call(ctx context.Context, client *http.Client, origin, path, method, secret string, input, output any) error {
	return callWithEpoch(ctx, client, origin, path, method, secret, "", input, output)
}

func callState(ctx context.Context, client *http.Client, state localState, path, method string, input, output any) error {
	return callStateLimit(ctx, client, state, path, method, 65536, input, output)
}

// callStateLimit is callState with a caller-chosen response ceiling. The
// credential-key statement is the one answer that can legitimately exceed the
// default: it carries the enclave's evidence inline.
func callStateLimit(ctx context.Context, client *http.Client, state localState, path, method string, limit int64, input, output any) error {
	return callWithEpochLimit(ctx, client, state.Hive, path, method, state.Credential, state.RuntimeEpoch, limit, input, output)
}

func callWithEpoch(ctx context.Context, client *http.Client, origin, path, method, secret, epoch string, input, output any) error {
	return callWithEpochLimit(ctx, client, origin, path, method, secret, epoch, 65536, input, output)
}

func callWithEpochLimit(ctx context.Context, client *http.Client, origin, path, method, secret, epoch string, limit int64, input, output any) (failure error) {
	defer func() { failure = recordRequestFailure(ctx, "hive_request", failure, secret) }()
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return &connectionRequestFailure{cause: fmt.Errorf("encode Hive request %s: %w", method, err), origin: origin, path: path, credential: secret}
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, origin+path, body)
	if err != nil {
		return &connectionRequestFailure{cause: fmt.Errorf("build Hive request %s: %w", method, err), origin: origin, path: path, credential: secret}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hive-Request", "1")
	req.Header.Set("User-Agent", userAgent())
	if epoch != "" {
		req.Header.Set(beewire.RuntimeEpochHeader, epoch)
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	started := time.Now()
	response, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return &connectionRequestFailure{cause: ctx.Err(), origin: origin, path: path, credential: secret}
		}
		return &connectionRequestFailure{cause: err, origin: origin, path: path, credential: secret}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, readErr := io.ReadAll(io.LimitReader(response.Body, 65537))
		var result struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(data, &result)
		failure := error(&apiFailure{Status: response.StatusCode, Code: result.Error.Code, Body: safeResponseBody(data, secret)})
		if readErr != nil {
			failure = errors.Join(failure, fmt.Errorf("read Hive error response: %w", readErr))
		}
		return &connectionRequestFailure{cause: failure, origin: origin, path: path, credential: secret}
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, limit))
	slog.Debug("Hive request", "module", "request", "method", method, "path", path, "status", response.StatusCode, "duration_ms", time.Since(started).Milliseconds())
	if output != nil {
		if err := decoder.Decode(output); err != nil {
			return &connectionRequestFailure{cause: fmt.Errorf("decode Hive response: %w", err), origin: origin, path: path, credential: secret}
		}
	}
	return nil
}

func pause(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func connect(ctx context.Context, state localState, egress *egressConfig, out io.Writer) error {
	return connectObserved(ctx, state, egress, out, nil)
}

func connectObserved(ctx context.Context, state localState, egress *egressConfig, out io.Writer, observe func(DesktopConnectionObservation)) error {
	return connectObservedOwned(ctx, state, egress, out, false, observe)
}

func connectObservedOwned(ctx context.Context, state localState, egress *egressConfig, out io.Writer, owned bool, observe func(DesktopConnectionObservation)) error {
	var lastFailure *DesktopConnectionFailure
	var currentLease string
	emit := func(value, retry string, next *string) {
		if observe != nil {
			observe(DesktopConnectionObservation{Connection: value, Lease: currentLease, Detail: &DesktopConnectionDetail{Failure: lastFailure, Retry: retry, NextRetryAt: next}})
		}
	}
	if _, ok := out.(*console); !ok {
		// The console's handler serialises its own writes, and notify needs
		// to see it unwrapped to print records rather than bare lines.
		out = &synchronizedWriter{writer: out}
	}
	client := httpClient()
	client.Timeout = 0
	// A Bee with egress carries the tunnel; one without only keeps presence.
	path := "/api/bee/connect"
	if egress != nil {
		path = "/api/bee/agent"
	}
	endpoint := strings.Replace(strings.Replace(state.Hive, "https:", "wss:", 1), "http:", "ws:", 1) + path
	metrics := beeMetrics(ctx)
	defer metrics.disconnect()
	attempted := false
	delay := time.Second
	conflicts := 0
	rejectionReported := false
	for {
		if !desktopReconnectPermitted(ctx) {
			emit("disconnected", "halted", nil)
			return nil
		}
		if ctx.Err() != nil {
			return nil
		}
		if attempted {
			metrics.reconnect()
		}
		attempted = true
		if owned {
			emit("reconnecting", "attempting", nil)
		} else {
			emit("connecting", "attempting", nil)
		}
		connectStart := time.Now()
		handshake, cancel := context.WithTimeout(ctx, 10*time.Second)
		slog.Info("connecting to Hive", "module", "connect", "endpoint", endpoint, "delay_backoff", delay.String())
		header := http.Header{"Authorization": []string{"Bearer " + state.Credential}, "User-Agent": []string{userAgent()}, beewire.RuntimeEpochHeader: []string{state.RuntimeEpoch}}
		if egress != nil {
			header.Set(beewire.ControlsHeader, beewire.ControlCapabilities)
		}
		conn, response, err := websocket.Dial(handshake, endpoint, &websocket.DialOptions{HTTPClient: client, HTTPHeader: header})
		cancel()
		metrics.connect(connectStart, err)
		handshakeConnected := err == nil
		if handshakeConnected {
			currentLease = response.Header.Get("X-Bee-Lease")
			owned = true
			lastFailure = nil
			emit("connected", "idle", nil)
			delay, conflicts = time.Second, 0
			notifyConnected(out, endpoint)
			var live context.Context
			var end func()
			var syncFailures <-chan error
			var moved func() uint64
			if egress != nil {
				// The session ends a moment after ctx, not with it: a Bee
				// that is stopping tells Hive so first (leave), and only then
				// is the tunnel torn down. Ending both at once would close
				// the connection before the close frame could be written.
				sessionCtx, stopSession := context.WithCancel(context.WithoutCancel(beeSession(ctx)))
				session := egress.start(sessionCtx, conn, out)
				stopLeaving := context.AfterFunc(ctx, func() {
					leave(conn, beewire.CloseStopping)
					stopSession()
				})
				live, end, moved = session.Context, session.Close, session.Moved
				forwardDone := make(chan struct{})
				go func() { defer close(forwardDone); egress.failures.forward(live, state) }()
				finish := func() { stopLeaving(); session.Close(); session.Wait(); stopSession(); <-forwardDone }
				end = finish
				if egress.dynamicAuthorization() {
					var wait func()
					syncFailures, wait = egress.startSynchronization(live, state, response.Header.Get("X-Bee-Lease"), out)
					end = func() { finish(); wait() }
				} else {
					err = egress.register(live, state, response.Header.Get("X-Bee-Lease"))
				}
				if err != nil {
					lastFailure = observedConnectionFailure(err, nil, state, path, "synchronize")
					end()
					conn.CloseNow()
					metrics.disconnect()
					var failure *apiFailure
					if errors.Is(err, errInboxIdentity) || errors.Is(err, errCodexExpired) || errors.Is(err, errCodexAuthorization) || errors.As(err, &failure) && failure.Status >= 400 && failure.Status < 500 && failure.Status != 409 && failure.Status != 429 {
						emit("disconnected", "halted", nil)
						if replacedDevice(err, out) {
							return nil
						}
						return err
					}
				} else {
					notify(out, slog.LevelInfo, "connect", "encrypted egress connected")
				}
			} else {
				conn.SetReadLimit(1024)
				live = conn.CloseRead(ctx)
				end = func() {}
			}
			liveness := relay.NewLiveness(conn, moved)
			var syncErr error
			stalled := false
			for live.Err() == nil && syncErr == nil {
				if egress != nil && !egress.dynamicAuthorization() && !rejectionReported {
					statusCtx, stopStatus := context.WithTimeout(live, 5*time.Second)
					var status struct {
						Status string `json:"status"`
					}
					statusErr := callState(statusCtx, httpClient(), state, "/api/bee/supply-status", "GET", nil, &status)
					stopStatus()
					if statusErr == nil && status.Status == "codex_authorization_rejected" {
						notify(out, slog.LevelError, "connect", "upstream rejected Codex authorization; supply stopped; update the official login and restart Bee, then have the operator verify and restart Hive to restore supply")
						rejectionReported = true
					}
				}
				pingStart := time.Now()
				err = liveness.Check(live)
				metrics.ping(pingStart, err)
				if err != nil {
					stalled = errors.Is(err, relay.ErrStalled)
					lastFailure = observedConnectionFailure(err, nil, state, path, "heartbeat")
					slog.Warn("Hive connection lost", "module", "connect", "error", err.Error())
					break
				}
				// Waiting on the failure channel lets a synchronization failure
				// end the wait at once instead of being polled for. The
				// heartbeat is what notices a link that silently stopped
				// carrying anything, which a proxy in the path makes common:
				// once it has been silent for the relay's stall limit, a
				// reconnect replaces the stalled connection Hive still holds.
				// A nil channel — every configuration without an official
				// account source — simply never fires.
				timer := time.NewTimer(heartbeatInterval)
				select {
				case syncErr = <-syncFailures:
					timer.Stop()
				case <-timer.C:
				case <-live.Done():
					timer.Stop()
				}
			}
			// A Bee that ends the connection itself says why first. With a
			// tunnel, end() closes whatever the goodbye left open.
			switch {
			case egress != nil && stalled:
				leave(conn, beewire.CloseStalled)
			case egress != nil && syncErr != nil && live.Err() == nil:
				leave(conn, beewire.CloseSyncFailed)
			default:
				conn.CloseNow()
			}
			metrics.disconnect()
			end()
			// Join synchronization before choosing a reconnect. The transport
			// may close at the same time a worker queues a terminal failure;
			// that failure must still halt instead of becoming a heartbeat retry.
			if syncErr == nil {
				select {
				case syncErr = <-syncFailures:
				default:
				}
			}
			if syncErr != nil {
				if ctx.Err() == nil {
					lastFailure = observedConnectionFailure(syncErr, nil, state, path, "synchronize")
					emit("disconnected", "halted", nil)
				}
				slog.Error("authorization synchronization failed", "module", "sync", "error", syncErr.Error())
				if replacedDevice(syncErr, out) {
					return nil
				}
				return syncErr
			}
		} else if response != nil && (response.StatusCode == 401 || response.StatusCode == 403) {
			if ctx.Err() != nil {
				return nil
			}
			lastFailure = observedConnectionFailure(err, response, state, path, "connect")
			emit("rejected", "halted", nil)
			identityErr := callState(ctx, httpClient(), state, "/api/bee/identity", "GET", nil, nil)
			if replacedDevice(identityErr, out) {
				return nil
			}
			return &apiFailure{Status: response.StatusCode, Code: "invalid_device_credential"}
		}
		if ctx.Err() != nil {
			return nil
		}
		if observe != nil && response != nil && response.StatusCode == http.StatusConflict && (!owned || conflicts >= conflictRetries) {
			lastFailure = observedConnectionFailure(err, response, state, path, "connect")
			lastFailure.Code = "ownership_unconfirmed"
			lastFailure.Evidence["owned_session"] = fmt.Sprint(owned)
			lastFailure.Evidence["consecutive_conflicts"] = fmt.Sprint(conflicts + 1)
			emit("occupied", "halted", nil)
			return fmt.Errorf("Hive connection ownership unconfirmed: HTTP 409 owned_session=%t consecutive_conflicts=%d", owned, conflicts+1)
		}
		if !handshakeConnected {
			lastFailure = observedConnectionFailure(err, response, state, path, "connect")
		} else if lastFailure == nil {
			lastFailure = observedConnectionFailure(err, nil, state, path, "heartbeat")
		}
		if err != nil {
			notify(out, slog.LevelWarn, "connect", "connection lost; reconnecting", "error", err.Error(), "retry_delay", delay.String())
		} else {
			notify(out, slog.LevelInfo, "connect", "connection lost; reconnecting", "retry_delay", delay.String())
		}
		deadline := time.Now().Add(delay)
		timer := time.NewTimer(time.Until(deadline))
		next := deadline.UTC().Format(time.RFC3339Nano)
		emit("reconnecting", "scheduled", &next)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
		if ctx.Err() != nil {
			return nil
		}
		// Hive refuses a reconnect as a duplicate while it still holds a
		// connection it has not yet found dead, and lets go within its own
		// heartbeat. Backing off past that moment only adds downtime, so a
		// run of refusals retries at a short steady interval first.
		if response != nil && response.StatusCode == http.StatusConflict && conflicts < conflictRetries {
			conflicts++
			delay = conflictRetryDelay
			continue
		}
		if delay < 30*time.Second {
			delay *= 2
			if delay > 30*time.Second {
				delay = 30 * time.Second
			}
		}
	}
}

// heartbeatInterval is the pause between liveness checks of the connection.
const heartbeatInterval = 5 * time.Second

// leaveGrace bounds how long a Bee waits for Hive to take its goodbye. Over a
// working link the exchange takes a round trip; over a stalled one it never
// completes, and the reconnect that follows must not wait on it.
var leaveGrace = time.Second

// leave ends the connection with a close frame naming why (beewire's close
// codes), so Hive records a Bee that stopped or gave up on a silent link as
// that, rather than as a connection that merely ended. It returns once Hive
// has answered or leaveGrace has passed; in the second case the connection is
// still open, and closing the tunnel session is what ends it.
func leave(conn *websocket.Conn, code int) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = conn.Close(websocket.StatusCode(code), beewire.CloseReason(code))
	}()
	timer := time.NewTimer(leaveGrace)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
	}
}

// conflictRetries refusals as a duplicate, conflictRetryDelay apart, outlast
// the time Hive takes to give up on a dead connection.
var (
	conflictRetries    = 15
	conflictRetryDelay = 2 * time.Second
)

func replacedDevice(err error, out io.Writer) bool {
	var failure *apiFailure
	if errors.As(err, &failure) && failure.Code == "device_replaced" {
		notify(out, slog.LevelInfo, "identity", "device replaced; old Bee stopped")
		return true
	}
	return false
}
