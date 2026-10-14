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
	"github.com/tokhive/bee/relay"
)

type apiFailure struct {
	Status int
	Code   string
}

func (e *apiFailure) Error() string {
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
	return fmt.Sprintf("Hive request failed (HTTP %d)", e.Status)
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
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return errors.New("failed to encode Bee request")
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, origin+path, body)
	if err != nil {
		return errors.New("invalid Hive request URL")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hive-Request", "1")
	req.Header.Set("User-Agent", userAgent())
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	started := time.Now()
	response, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		slog.Warn("Hive request failed", "module", "request", "method", method, "path", path, "error", err.Error())
		return errors.New("failed to connect to Hive")
	}
	defer response.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(response.Body, 65536))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var result struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = decoder.Decode(&result)
		slog.Debug("Hive request rejected", "module", "request", "method", method, "path", path, "status", response.StatusCode, "code", result.Error.Code, "duration_ms", time.Since(started).Milliseconds())
		return &apiFailure{Status: response.StatusCode, Code: result.Error.Code}
	}
	slog.Debug("Hive request", "module", "request", "method", method, "path", path, "status", response.StatusCode, "duration_ms", time.Since(started).Milliseconds())
	if output != nil && decoder.Decode(output) != nil {
		return errors.New("invalid Hive response format")
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
	rejectionReported := false
	for {
		if ctx.Err() != nil {
			return nil
		}
		if attempted {
			metrics.reconnect()
		}
		attempted = true
		connectStart := time.Now()
		handshake, cancel := context.WithTimeout(ctx, 10*time.Second)
		slog.Info("connecting to Hive", "module", "connect", "endpoint", endpoint, "delay_backoff", delay.String())
		conn, response, err := websocket.Dial(handshake, endpoint, &websocket.DialOptions{HTTPClient: client, HTTPHeader: http.Header{"Authorization": []string{"Bearer " + state.Credential}, "User-Agent": []string{userAgent()}}})
		cancel()
		metrics.connect(connectStart, err)
		if err == nil {
			delay = time.Second
			notify(out, slog.LevelInfo, "connect", "Bee connected to Hive", "endpoint", endpoint)
			var live context.Context
			var end func()
			var syncFailures <-chan error
			var moved func() uint64
			if egress != nil {
				session := egress.start(beeSession(ctx), conn, out)
				live, end, moved = session.Context, session.Close, session.Moved
				go egress.failures.forward(live, state)
				if egress.dynamicAuthorization() {
					var wait func()
					syncFailures, wait = egress.startSynchronization(live, state, response.Header.Get("X-Bee-Lease"), out)
					end = func() { session.Close(); wait() }
				} else {
					err = egress.register(live, state, response.Header.Get("X-Bee-Lease"))
				}
				if err != nil {
					end()
					conn.CloseNow()
					metrics.disconnect()
					var failure *apiFailure
					if errors.Is(err, errInboxIdentity) || errors.Is(err, errCodexExpired) || errors.Is(err, errCodexAuthorization) || errors.As(err, &failure) && failure.Status >= 400 && failure.Status < 500 && failure.Status != 409 && failure.Status != 429 {
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
			for live.Err() == nil {
				if egress != nil && !egress.dynamicAuthorization() && !rejectionReported {
					statusCtx, stopStatus := context.WithTimeout(live, 5*time.Second)
					var status struct {
						Status string `json:"status"`
					}
					statusErr := call(statusCtx, httpClient(), state.Hive, "/api/bee/supply-status", "GET", state.Credential, nil, &status)
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
					slog.Warn("Hive connection lost", "module", "connect", "error", err.Error())
					break
				}
				// Waiting on the failure channel is what lets this match the
				// ten second heartbeat Hive keeps from its own side. The
				// cadence was two seconds so that a non-blocking check of the
				// channel would notice a synchronization failure reasonably
				// soon: it cost a ping every two seconds and still reported
				// the failure up to two seconds late. A nil channel — every
				// configuration without an official account source — simply
				// never fires.
				timer := time.NewTimer(10 * time.Second)
				select {
				case syncErr := <-syncFailures:
					timer.Stop()
					conn.CloseNow()
					end()
					slog.Error("authorization synchronization failed", "module", "sync", "error", syncErr.Error())
					if replacedDevice(syncErr, out) {
						return nil
					}
					return syncErr
				case <-timer.C:
				case <-live.Done():
					timer.Stop()
				}
			}
			conn.CloseNow()
			metrics.disconnect()
			end()
		} else if response != nil && (response.StatusCode == 401 || response.StatusCode == 403) {
			identityErr := call(ctx, httpClient(), state.Hive, "/api/bee/identity", "GET", state.Credential, nil, nil)
			if replacedDevice(identityErr, out) {
				return nil
			}
			return &apiFailure{Status: response.StatusCode, Code: "invalid_device_credential"}
		}
		if ctx.Err() != nil {
			return nil
		}
		if err != nil {
			notify(out, slog.LevelWarn, "connect", "connection lost; reconnecting", "error", err.Error(), "retry_delay", delay.String())
		} else {
			notify(out, slog.LevelInfo, "connect", "connection lost; reconnecting", "retry_delay", delay.String())
		}
		if pause(ctx, delay) != nil {
			return nil
		}
		if delay < 30*time.Second {
			delay *= 2
			if delay > 30*time.Second {
				delay = 30 * time.Second
			}
		}
	}
}

func replacedDevice(err error, out io.Writer) bool {
	var failure *apiFailure
	if errors.As(err, &failure) && failure.Code == "device_replaced" {
		notify(out, slog.LevelInfo, "identity", "device replaced; old Bee stopped")
		return true
	}
	return false
}
