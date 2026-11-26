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
	state       localState
	binding     string
	problem     *controlProblem
	subscribers map[chan controlEvent]struct{}
}

// Binding states a Bee reports.
const (
	bindingUnpaired = "unpaired"
	bindingPaired   = "paired"
	// bindingReplaced: Hive revoked this device because another Bee replaced it.
	bindingReplaced = "replaced"
	// bindingInvalid: Hive no longer accepts this device's credential.
	bindingInvalid = "invalid"
)

// controlProblem is why a Bee that should be connected is not, as a stable
// code and the error's own words.
type controlProblem struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	// Reason says in both languages what was wrong with a Claude Code sign-in
	// that was found but cannot be used, when Bee knows.
	Reason *controlReason `json:"reason,omitempty"`
}

type controlReason struct {
	En string `json:"en"`
	Zh string `json:"zh"`
}

// reasonOf is the translated reason inside err, if it carries one.
func reasonOf(err error) *controlReason {
	var credential *credentialError
	if errors.As(err, &credential) {
		if text, ok := credentialProblems[credential.kind]; ok {
			return &controlReason{text.en, text.zh}
		}
	}
	for e := err; e != nil; e = errors.Unwrap(e) {
		if text, ok := sentinelText(e); ok {
			return &controlReason{text.en, text.zh}
		}
	}
	return nil
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
	return &runStatus{connection: connectionConnecting, binding: bindingUnpaired, subscribers: map[chan controlEvent]struct{}{}}
}

// setDevice records the device configuration the run uses and how Hive
// regards it.
func (s *runStatus) setDevice(state localState, binding string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.state, s.binding = state, binding
	s.mu.Unlock()
	s.publish(controlEvent{Name: "binding", Data: map[string]string{"binding": binding}})
}

func (s *runStatus) device() (localState, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state, s.binding
}

// setProblem records why the Bee is not connected; nil clears it.
func (s *runStatus) setProblem(problem *controlProblem) {
	if s == nil {
		return
	}
	s.mu.Lock()
	unchanged := s.problem == nil && problem == nil || s.problem != nil && problem != nil && *s.problem == *problem
	s.problem = problem
	s.mu.Unlock()
	if !unchanged {
		s.publish(controlEvent{Name: "problem", Data: problem})
	}
}

func (s *runStatus) currentProblem() *controlProblem {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.problem
}

func problemOf(err error) *controlProblem {
	if code, summary, _, ok := Coded(err); ok {
		return &controlProblem{Code: code, Message: summary, Reason: reasonOf(err)}
	}
	var failure *apiFailure
	if errors.As(err, &failure) && failure.Code != "" {
		return &controlProblem{Code: failure.Code, Message: err.Error()}
	}
	return &controlProblem{Code: "error", Message: err.Error()}
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
	configPath string
	// pairer pairs the device through this interface; nil for a Bee started
	// from the command line, which pairs with bee login.
	pairer pairer
	// manager adds and removes accounts; nil outside desktop mode.
	manager accountManager
	egress  *egressConfig
	status  *runStatus
	client  *http.Client
	// keepalive is how often an idle event stream sends a comment.
	keepalive time.Duration
}

type controlOverview struct {
	Version string `json:"version"`
	PID     int    `json:"pid"`
	// Mode is "desktop" for a Bee the desktop app runs and "cli" otherwise;
	// only a desktop Bee pairs through this interface.
	Mode       string          `json:"mode"`
	Hive       string          `json:"hive"`
	Binding    string          `json:"binding"`
	Device     *controlDevice  `json:"device"`
	Pairing    *pairingStatus  `json:"pairing,omitempty"`
	Connection string          `json:"connection"`
	Problem    *controlProblem `json:"problem,omitempty"`
	Sources    []controlSource `json:"sources"`
	// Accounts are the accounts the desktop app added; desktop mode only.
	Accounts []accountRecord `json:"accounts,omitempty"`
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
	// Sharing is the one conclusion to show; Supply keeps every reason.
	Sharing      sharingState           `json:"sharing"`
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
		state, ok := c.paired(w)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		var result controlPlatform
		// The detailed reasons tell apart what the person and TokHive must fix.
		if err := callState(ctx, c.client, state, "/api/bee/platforms/"+platform+"?reason_detail=1", "GET", nil, &result.Supply); err != nil {
			writeControlError(w, http.StatusBadGateway, "hive_unavailable", err.Error())
			return
		}
		if err := callState(ctx, c.client, state, "/api/bee/platforms/"+platform+"/capabilities", "GET", nil, &result.Capabilities); err != nil {
			writeControlError(w, http.StatusBadGateway, "hive_unavailable", err.Error())
			return
		}
		result.Sharing = sharingOf(result.Supply)
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
		state, ok := c.paired(w)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		supply, err := updatePlatformSupply(ctx, c.client, state, platform, *input.Paused)
		if err != nil {
			writeControlError(w, http.StatusBadGateway, "supply_unconfirmed", err.Error())
			return
		}
		c.status.publish(controlEvent{Name: "supply", Data: supply})
		writeControlJSON(w, http.StatusOK, supply)
	})
	mux.HandleFunc("POST /v1/pairing", func(w http.ResponseWriter, r *http.Request) {
		if !c.canPair(w) {
			return
		}
		var input struct {
			Hive string `json:"hive"`
			Name string `json:"name"`
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, 4096))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil && !errors.Is(err, io.EOF) {
			writeControlError(w, http.StatusBadRequest, "invalid_request", `body must be {} or {"hive": "...", "name": "..."}`)
			return
		}
		pairing, err := c.pairer.startPairing(r.Context(), input.Hive, input.Name)
		if err != nil {
			problem := problemOf(err)
			status := http.StatusBadGateway
			if errors.Is(err, errInvalidPairingInput) {
				status = http.StatusBadRequest
			}
			writeControlError(w, status, problem.Code, problem.Message)
			return
		}
		writeControlJSON(w, http.StatusOK, pairing)
	})
	mux.HandleFunc("GET /v1/pairing", func(w http.ResponseWriter, r *http.Request) {
		if !c.canPair(w) {
			return
		}
		writeControlJSON(w, http.StatusOK, c.pairer.pairingStatus())
	})
	mux.HandleFunc("DELETE /v1/pairing", func(w http.ResponseWriter, r *http.Request) {
		if !c.canPair(w) {
			return
		}
		c.pairer.cancelPairing()
		writeControlJSON(w, http.StatusOK, c.pairer.pairingStatus())
	})
	mux.HandleFunc("GET /v1/accounts", func(w http.ResponseWriter, r *http.Request) {
		if c.canManage(w) {
			writeControlJSON(w, http.StatusOK, map[string]any{"accounts": c.manager.accounts()})
		}
	})
	mux.HandleFunc("GET /v1/platforms/{platform}/login", func(w http.ResponseWriter, r *http.Request) {
		platform, ok := controlPlatformName(w, r)
		if ok && c.canManage(w) {
			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()
			writeControlJSON(w, http.StatusOK, c.manager.detect(ctx, platform))
		}
	})
	mux.HandleFunc("POST /v1/accounts", func(w http.ResponseWriter, r *http.Request) {
		if !c.canManage(w) {
			return
		}
		var input addAccountRequest
		decoder := json.NewDecoder(io.LimitReader(r.Body, 8192))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			writeControlError(w, http.StatusBadRequest, "invalid_request", `body must be {"platform": "openai"|"claude"|"google", "source": "local"|"import", "file": "..."}`)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		record, err := c.manager.addAccount(ctx, input)
		if err != nil {
			writeAccountError(w, err)
			return
		}
		writeControlJSON(w, http.StatusCreated, record)
	})
	mux.HandleFunc("DELETE /v1/accounts/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !c.canManage(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		if err := c.manager.removeAccount(ctx, r.PathValue("id")); err != nil {
			writeAccountError(w, err)
			return
		}
		writeControlJSON(w, http.StatusOK, map[string]string{"removed": r.PathValue("id")})
	})
	mux.HandleFunc("POST /v1/accounts/{id}/confirm", func(w http.ResponseWriter, r *http.Request) {
		if !c.canManage(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		account, err := c.manager.confirmAccount(ctx, r.PathValue("id"))
		if err != nil {
			writeAccountError(w, err)
			return
		}
		writeControlJSON(w, http.StatusOK, account)
	})
	mux.HandleFunc("GET /v1/network", func(w http.ResponseWriter, r *http.Request) {
		network, err := c.network()
		if err != nil {
			writeControlError(w, http.StatusInternalServerError, "error", "the network setting cannot be read")
			return
		}
		writeControlJSON(w, http.StatusOK, network)
	})
	mux.HandleFunc("PUT /v1/network", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ConnectProxy *string `json:"connect_proxy"`
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, 4096))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil || input.ConnectProxy == nil {
			writeControlError(w, http.StatusBadRequest, "invalid_request", `body must be {"connect_proxy": "http://127.0.0.1:7890"}, or an empty string for no proxy`)
			return
		}
		network, err := c.setNetwork(*input.ConnectProxy)
		if err != nil {
			writeAccountError(w, err)
			return
		}
		writeControlJSON(w, http.StatusOK, network)
	})
	mux.HandleFunc("POST /v1/network/check", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ConnectProxy *string `json:"connect_proxy"`
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, 4096))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil || input.ConnectProxy == nil {
			writeControlError(w, http.StatusBadRequest, "invalid_request", `body must be {"connect_proxy": "http://127.0.0.1:7890"}, or an empty string to try without a proxy`)
			return
		}
		result, err := c.checkNetwork(r.Context(), *input.ConnectProxy)
		if err != nil {
			writeAccountError(w, err)
			return
		}
		writeControlJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /v1/explanations", func(w http.ResponseWriter, r *http.Request) {
		writeControlJSON(w, http.StatusOK, ExplanationCatalog())
	})
	mux.HandleFunc("GET /v1/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
		defer cancel()
		raw, err := c.diagnostics(ctx)
		if err != nil {
			writeControlError(w, http.StatusInternalServerError, "error", err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(raw)
	})
	mux.HandleFunc("GET /v1/events", c.events)
	return mux
}

func (c *controlServer) canManage(w http.ResponseWriter) bool {
	if c.manager == nil {
		writeControlError(w, http.StatusConflict, "accounts_unavailable", "this Bee was started from the command line; choose accounts with bee setup")
		return false
	}
	return true
}

func writeAccountError(w http.ResponseWriter, err error) {
	var refused *accountError
	if errors.As(err, &refused) {
		writeControlError(w, refused.status, refused.problem.Code, refused.problem.Message)
		return
	}
	problem := problemOf(err)
	writeControlError(w, http.StatusInternalServerError, problem.Code, problem.Message)
}

// paired returns the device configuration for a request that needs Hive, or
// answers that this Bee is not paired.
func (c *controlServer) paired(w http.ResponseWriter) (localState, bool) {
	state, binding := c.status.device()
	if binding != bindingPaired || state.Identity == nil {
		writeControlError(w, http.StatusConflict, "not_paired", "this Bee is not paired with Hive")
		return state, false
	}
	return state, true
}

func (c *controlServer) canPair(w http.ResponseWriter) bool {
	if c.pairer == nil {
		writeControlError(w, http.StatusConflict, "pairing_unavailable", "this Bee was started from the command line; pair it with bee login")
		return false
	}
	return true
}

func (c *controlServer) overview() controlOverview {
	state, binding := c.status.device()
	overview := controlOverview{Version: Version, PID: os.Getpid(), Mode: controlMode(c.pairer), Hive: state.Hive, Binding: binding, Connection: c.status.currentConnection(), Problem: c.status.currentProblem(), Sources: []controlSource{}}
	if state.Identity != nil {
		overview.Device = &controlDevice{ID: state.Identity.ID, Name: state.Identity.Name, OwnerEmail: state.Identity.OwnerEmail}
	}
	if c.pairer != nil {
		if pairing := c.pairer.pairingStatus(); pairing.Status != pairingNone {
			overview.Pairing = &pairing
		}
	}
	if c.manager != nil {
		overview.Accounts = c.manager.accounts()
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
	if !supplyPlatform(platform) {
		writeControlError(w, http.StatusNotFound, "unknown_platform", "platform must be openai, claude or google")
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
func serveControl(configPath string, egress *egressConfig, status *runStatus, pairer pairer, out io.Writer) (stop func()) {
	path := controlSocketPath(configPath)
	listener, err := listenControl(path)
	if err != nil {
		notify(out, slog.LevelWarn, "control", "local control interface unavailable; the desktop app cannot manage this Bee", "path", path, "error", err.Error())
		return func() {}
	}
	server := &http.Server{Handler: (&controlServer{configPath: configPath, pairer: pairer, manager: managerOf(pairer), egress: egress, status: status, client: httpClient(), keepalive: 15 * time.Second}).handler(), ReadHeaderTimeout: 5 * time.Second}
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

func controlMode(p pairer) string {
	if p == nil {
		return "cli"
	}
	return "desktop"
}

// managerOf is the account manager of a desktop run, which also pairs.
func managerOf(p pairer) accountManager {
	manager, _ := p.(accountManager)
	return manager
}
