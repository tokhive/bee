package bee

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/tokhive/bee/beewire"
)

// The control interface lets a local client, such as the desktop app, see and
// steer a running Bee. It is HTTP + JSON on a socket only the user running Bee
// can reach, with changes pushed as server-sent events. The interface never
// returns a credential.

// controlSocketPath is where a Bee using the device configuration at
// configPath serves its control interface.
func controlSocketPath(configPath string) string {
	return filepath.Join(filepath.Dir(configPath), "control", "bee.sock")
}

// maxSocketPath is the longest socket path both macOS (104 bytes including the
// terminating NUL) and Linux (108) accept.
const maxSocketPath = 103

var errControlPathTooLong = errors.New("control socket path too long")

// Connection states a Bee reports.
const (
	connectionConnecting   = "connecting"
	connectionConnected    = "connected"
	connectionDisconnected = "disconnected"
)

// runStatus is what the running Bee knows about itself that a control client
// cannot ask Hive for, and the subscribers waiting to hear when it changes.
type runStatus struct {
	mu          sync.Mutex
	connection  string
	subscribers map[chan controlEvent]struct{}
}

type controlEvent struct {
	Name string
	Data any
}

type runStatusKey struct{}

func withRunStatus(ctx context.Context, status *runStatus) context.Context {
	return context.WithValue(ctx, runStatusKey{}, status)
}

// runStatusFrom returns the status the run records into, or nil when nothing
// listens; every method accepts a nil status.
func runStatusFrom(ctx context.Context) *runStatus {
	status, _ := ctx.Value(runStatusKey{}).(*runStatus)
	return status
}

func newRunStatus() *runStatus {
	return &runStatus{connection: connectionConnecting, subscribers: map[chan controlEvent]struct{}{}}
}

func (s *runStatus) setConnection(connection string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	changed := s.connection != connection
	s.connection = connection
	s.mu.Unlock()
	if changed {
		s.publish(controlEvent{Name: "connection", Data: map[string]string{"connection": connection}})
	}
}

func (s *runStatus) currentConnection() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.connection
}

// publish tells every subscriber; one that is not keeping up loses the event
// rather than holding the Bee up, and catches up from the next overview.
func (s *runStatus) publish(event controlEvent) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

func (s *runStatus) subscribe() (<-chan controlEvent, func()) {
	ch := make(chan controlEvent, 16)
	s.mu.Lock()
	s.subscribers[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(s.subscribers, ch)
		s.mu.Unlock()
	}
}

// controlServer serves one running Bee.
type controlServer struct {
	state  localState
	egress *egressConfig
	status *runStatus
	client *http.Client
	// keepalive is how often an idle event stream sends a comment.
	keepalive time.Duration
}

type controlOverview struct {
	Version    string          `json:"version"`
	PID        int             `json:"pid"`
	Hive       string          `json:"hive"`
	Device     *controlDevice  `json:"device"`
	Connection string          `json:"connection"`
	Sources    []controlSource `json:"sources"`
}

type controlDevice struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	OwnerEmail string `json:"owner_email"`
}

type controlSource struct {
	Name     string `json:"name"`
	Platform string `json:"platform,omitempty"`
}

// controlPlatform is Hive's view of one platform on this device.
type controlPlatform struct {
	Supply       beewire.PlatformSupply `json:"supply"`
	Capabilities beewire.Capabilities   `json:"capabilities"`
}

func (c *controlServer) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/overview", func(w http.ResponseWriter, r *http.Request) {
		writeControlJSON(w, http.StatusOK, c.overview())
	})
	mux.HandleFunc("GET /v1/platforms/{platform}", func(w http.ResponseWriter, r *http.Request) {
		platform, ok := controlPlatformName(w, r)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		var result controlPlatform
		if err := callState(ctx, c.client, c.state, "/api/bee/platforms/"+platform, "GET", nil, &result.Supply); err != nil {
			writeControlError(w, http.StatusBadGateway, "hive_unavailable", err.Error())
			return
		}
		if err := callState(ctx, c.client, c.state, "/api/bee/platforms/"+platform+"/capabilities", "GET", nil, &result.Capabilities); err != nil {
			writeControlError(w, http.StatusBadGateway, "hive_unavailable", err.Error())
			return
		}
		writeControlJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("PUT /v1/platforms/{platform}/supply", func(w http.ResponseWriter, r *http.Request) {
		platform, ok := controlPlatformName(w, r)
		if !ok {
			return
		}
		var input struct {
			Paused *bool `json:"paused"`
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil || input.Paused == nil {
			writeControlError(w, http.StatusBadRequest, "invalid_request", `body must be {"paused": true} or {"paused": false}`)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		supply, err := updatePlatformSupply(ctx, c.client, c.state, platform, *input.Paused)
		if err != nil {
			writeControlError(w, http.StatusBadGateway, "supply_unconfirmed", err.Error())
			return
		}
		c.status.publish(controlEvent{Name: "supply", Data: supply})
		writeControlJSON(w, http.StatusOK, supply)
	})
	mux.HandleFunc("GET /v1/events", c.events)
	return mux
}

func (c *controlServer) overview() controlOverview {
	overview := controlOverview{Version: Version, PID: os.Getpid(), Hive: c.state.Hive, Connection: c.status.currentConnection(), Sources: []controlSource{}}
	if c.state.Identity != nil {
		overview.Device = &controlDevice{ID: c.state.Identity.ID, Name: c.state.Identity.Name, OwnerEmail: c.state.Identity.OwnerEmail}
	}
	if c.egress != nil {
		for _, source := range c.egress.sources().list() {
			overview.Sources = append(overview.Sources, controlSource{Name: source.name, Platform: source.platform})
		}
	}
	return overview
}

// events streams changes. The first event carries the whole overview, so a
// client that (re)subscribes needs no separate read to be current.
func (c *controlServer) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeControlError(w, http.StatusInternalServerError, "streaming_unsupported", "")
		return
	}
	events, unsubscribe := c.status.subscribe()
	defer unsubscribe()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	writeEvent(w, controlEvent{Name: "overview", Data: c.overview()})
	flusher.Flush()
	keepalive := time.NewTicker(c.keepalive)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepalive.C:
			io.WriteString(w, ": keepalive\n\n")
		case event := <-events:
			writeEvent(w, event)
		}
		flusher.Flush()
	}
}

func writeEvent(w io.Writer, event controlEvent) {
	data, _ := json.Marshal(event.Data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Name, data)
}

func controlPlatformName(w http.ResponseWriter, r *http.Request) (string, bool) {
	platform := r.PathValue("platform")
	if platform != "openai" && platform != "claude" {
		writeControlError(w, http.StatusNotFound, "unknown_platform", "platform must be openai or claude")
		return "", false
	}
	return platform, true
}

func writeControlJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func writeControlError(w http.ResponseWriter, status int, code, message string) {
	writeControlJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

// serveControl serves the control interface until the returned stop is
// called. A Bee that cannot open its socket keeps running without one and
// says why.
func serveControl(configPath string, state localState, egress *egressConfig, status *runStatus, out io.Writer) (stop func()) {
	path := controlSocketPath(configPath)
	listener, err := listenControl(path)
	if err != nil {
		notify(out, slog.LevelWarn, "control", "local control interface unavailable; the desktop app cannot manage this Bee", "path", path, "error", err.Error())
		return func() {}
	}
	server := &http.Server{Handler: (&controlServer{state: state, egress: egress, status: status, client: httpClient(), keepalive: 15 * time.Second}).handler(), ReadHeaderTimeout: 5 * time.Second}
	slog.Info("local control interface listening", "module", "control", "path", path)
	served := make(chan struct{})
	go func() {
		defer close(served)
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, net.ErrClosed) {
			slog.Warn("local control interface stopped", "module", "control", "error", err.Error())
		}
	}()
	return func() {
		// Event streams never end on their own, so a short graceful window
		// is followed by closing whatever is still open.
		shutdown, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		server.Shutdown(shutdown)
		server.Close()
		<-served
		os.Remove(path)
	}
}
