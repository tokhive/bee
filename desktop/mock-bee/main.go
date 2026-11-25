// Command mock-bee stands in for bee run --desktop while the desktop app is
// developed: it serves the same control interface on the same socket path, with
// canned scenarios instead of a real Hive or real accounts.
//
//	go run ./desktop/mock-bee -config /tmp/beedev/bee.json -scenario sharing
//	go run ./desktop/mock-bee -config /tmp/beedev/bee.json -switch paused
//
// The second form tells a running mock to switch scenario. -list prints them.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	bee "github.com/tokhive/bee/agent"
)

type device struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	OwnerEmail string `json:"owner_email"`
}

type problem struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type pairing struct {
	Status              string    `json:"status"`
	UserCode            string    `json:"user_code,omitempty"`
	VerificationURL     string    `json:"verification_url,omitempty"`
	ExpiresAt           time.Time `json:"expires_at,omitzero"`
	WaitingForOldDevice bool      `json:"waiting_for_old_device,omitempty"`
	Problem             *problem  `json:"problem,omitempty"`
}

type source struct {
	Name     string `json:"name"`
	Platform string `json:"platform,omitempty"`
}

type account struct {
	ID          string    `json:"id"`
	Platform    string    `json:"platform"`
	Source      string    `json:"source"`
	Email       string    `json:"email,omitempty"`
	Plan        string    `json:"plan,omitempty"`
	Fingerprint string    `json:"fingerprint,omitempty"`
	AddedAt     time.Time `json:"added_at"`
}

type overview struct {
	Version    string    `json:"version"`
	PID        int       `json:"pid"`
	Mode       string    `json:"mode"`
	Hive       string    `json:"hive"`
	Binding    string    `json:"binding"`
	Device     *device   `json:"device"`
	Pairing    *pairing  `json:"pairing,omitempty"`
	Connection string    `json:"connection"`
	Problem    *problem  `json:"problem,omitempty"`
	Sources    []source  `json:"sources"`
	Accounts   []account `json:"accounts,omitempty"`
}

type window struct {
	Scope       string    `json:"scope,omitempty"`
	Seconds     int       `json:"seconds"`
	UsedPercent *int      `json:"used_percent"`
	ResetAt     time.Time `json:"reset_at"`
}

type platformState struct {
	Sharing struct {
		State  string `json:"state"`
		Reason string `json:"reason,omitempty"`
	} `json:"sharing"`
	Supply struct {
		Platform string   `json:"platform"`
		Paused   bool     `json:"paused"`
		Ready    bool     `json:"ready"`
		Reasons  []string `json:"reasons"`
	} `json:"supply"`
	Capabilities struct {
		Status     string    `json:"status"`
		Plan       string    `json:"plan,omitempty"`
		Models     []string  `json:"models"`
		ObservedAt time.Time `json:"observed_at"`
		Windows    []window  `json:"windows"`
	} `json:"capabilities"`
}

type login struct {
	Platform    string   `json:"platform"`
	Available   bool     `json:"available"`
	Email       string   `json:"email,omitempty"`
	Plan        string   `json:"plan,omitempty"`
	Fingerprint string   `json:"fingerprint,omitempty"`
	Problem     *problem `json:"problem,omitempty"`
}

// world is everything the mock reports; a scenario sets it.
type world struct {
	// mode is "desktop" (bee run --desktop) or "cli" (bee run): a Bee run
	// from the command line neither pairs nor manages accounts.
	mode       string
	binding    string
	connection string
	problem    *problem
	accounts   []account
	// logins are the official clients' sign-ins on this machine.
	logins map[string]login
	// pairWith is how a pairing ends: "confirm" a few seconds after it
	// starts, "expire" quickly, or "unreachable" when Hive cannot be reached.
	pairWith string
	// failOps makes pause, resume, remove and confirm fail as an
	// unreachable Hive would, leaving everything as it was.
	failOps bool
	// state maps a platform to its sharing state and reason.
	state  map[string][2]string
	paused map[string]bool
	quota  map[string][]window
}

func percent(n int) *int { return &n }

func baseWorld() world {
	added := time.Now().Add(-96 * time.Hour).UTC()
	now := time.Now()
	return world{
		mode: "desktop", binding: "paired", connection: "connected", pairWith: "confirm",
		logins: map[string]login{
			"claude": {Platform: "claude", Available: true, Email: "b.lee@gmail.com", Plan: "max", Fingerprint: "3f9a12c0" + strings.Repeat("0", 56)},
			"openai": {Platform: "openai", Problem: &problem{"BEE-SETUP-CODEX-NOT-FOUND", "no Codex sign-in found"}},
		},
		accounts: []account{
			{ID: "acc_claude0001", Platform: "claude", Source: "local", Email: "b.lee@gmail.com", Plan: "max", Fingerprint: "3f9a12c0" + strings.Repeat("0", 56), AddedAt: added},
			{ID: "acc_openai0001", Platform: "openai", Source: "import", Email: "c.wu@outlook.com", Plan: "plus", Fingerprint: "81d0e7aa" + strings.Repeat("0", 56), AddedAt: added.Add(48 * time.Hour)},
		},
		state:  map[string][2]string{"claude": {"sharing", ""}, "openai": {"sharing", ""}},
		paused: map[string]bool{},
		quota: map[string][]window{
			"claude": {{Seconds: 18000, UsedPercent: percent(42), ResetAt: now.Add(2 * time.Hour)}, {Seconds: 604800, UsedPercent: percent(18), ResetAt: now.Add(72 * time.Hour)}, {Scope: "opus", Seconds: 604800, UsedPercent: percent(33), ResetAt: now.Add(72 * time.Hour)}},
			"openai": {{Seconds: 18000, UsedPercent: percent(10), ResetAt: now.Add(3 * time.Hour)}, {Seconds: 604800, UsedPercent: percent(64), ResetAt: now.Add(96 * time.Hour)}},
		},
	}
}

var scenarios = map[string]func(*world){
	"sharing":  func(w *world) {},
	"unpaired": func(w *world) { w.binding, w.connection, w.accounts = "unpaired", "disconnected", nil },
	"empty":    func(w *world) { w.accounts = nil },
	"syncing": func(w *world) {
		w.accounts = w.accounts[:1]
		w.state["claude"] = [2]string{"syncing", "capabilities_unknown"}
	},
	"paused": func(w *world) { w.paused["claude"], w.paused["openai"] = true, true },
	"quota": func(w *world) {
		w.state["openai"] = [2]string{"waiting", "quota_exhausted"}
		w.quota["openai"][1].UsedPercent = percent(100)
	},
	"auth":       func(w *world) { w.state["claude"] = [2]string{"action", "claude_authorization_rejected"} },
	"authimport": func(w *world) { w.state["openai"] = [2]string{"action", "codex_authorization_rejected"} },
	"switched": func(w *world) {
		w.state["claude"] = [2]string{"action", "claude_confirmation_required"}
		w.logins["claude"] = login{Platform: "claude", Available: true, Email: "d.kim@gmail.com", Plan: "max", Fingerprint: "5b20e4d1" + strings.Repeat("0", 56)}
	},
	"inuse":      func(w *world) { w.state["openai"] = [2]string{"action", "codex_account_in_use"} },
	"restricted": func(w *world) { w.state["openai"] = [2]string{"restricted", "banned"} },
	"reconnect": func(w *world) {
		w.connection, w.problem = "connecting", &problem{"BEE-HIVE-UNREACHABLE", "Bee cannot connect to Hive"}
	},
	"replaced": func(w *world) { w.binding, w.connection = "replaced", "disconnected" },
	"invalid":  func(w *world) { w.binding, w.connection = "invalid", "disconnected" },
	"opfail":   func(w *world) { w.failOps = true },
	"cli":      func(w *world) { w.mode = "cli" },
	"pairexpired": func(w *world) {
		w.binding, w.connection, w.accounts, w.pairWith = "unpaired", "disconnected", nil, "expire"
	},
	"pairoffline": func(w *world) {
		w.binding, w.connection, w.accounts, w.pairWith = "unpaired", "disconnected", nil, "unreachable"
	},
}

func scenarioNames() []string {
	names := make([]string, 0, len(scenarios))
	for name := range scenarios {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

type mock struct {
	mu       sync.Mutex
	scenario string
	w        world
	pairing  *pairing
	subs     map[chan string]struct{}
}

func (m *mock) set(name string) error {
	apply, ok := scenarios[name]
	if !ok {
		return fmt.Errorf("unknown scenario %q; one of %s", name, strings.Join(scenarioNames(), ", "))
	}
	w := baseWorld()
	apply(&w)
	m.mu.Lock()
	m.scenario, m.w, m.pairing = name, w, nil
	m.mu.Unlock()
	m.publish("overview")
	log.Printf("scenario %s", name)
	return nil
}

func (m *mock) publish(event string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for ch := range m.subs {
		select {
		case ch <- event:
		default:
		}
	}
}

func (m *mock) overview() overview {
	m.mu.Lock()
	defer m.mu.Unlock()
	o := overview{Version: "mock", PID: os.Getpid(), Mode: m.w.mode, Hive: "https://console.tokhive.ai", Binding: m.w.binding,
		Connection: m.w.connection, Problem: m.w.problem, Sources: []source{}}
	if m.w.mode == "desktop" {
		o.Pairing, o.Accounts = m.pairing, append([]account{}, m.w.accounts...)
	}
	// Like Bee, which knows no Hive address until a device is linked.
	if m.w.binding == "unpaired" {
		o.Hive = ""
	}
	if m.w.binding != "unpaired" {
		o.Device = &device{ID: "dev_mock", Name: "MacBook", OwnerEmail: "a.chen@gmail.com"}
	}
	for _, a := range m.w.accounts {
		o.Sources = append(o.Sources, source{Name: a.Platform, Platform: a.Platform})
	}
	return o
}

func (m *mock) platform(name string) (platformState, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var p platformState
	if !slices.ContainsFunc(m.w.accounts, func(a account) bool { return a.Platform == name }) {
		return p, false
	}
	state := m.w.state[name]
	p.Sharing.State, p.Sharing.Reason = state[0], state[1]
	p.Supply.Platform, p.Supply.Paused, p.Supply.Reasons = name, m.w.paused[name], []string{}
	if state[1] != "" {
		p.Supply.Reasons = append(p.Supply.Reasons, state[1])
	}
	if m.w.paused[name] {
		p.Supply.Reasons = append(p.Supply.Reasons, "manually_paused")
		if state[0] == "sharing" {
			p.Sharing.State, p.Sharing.Reason = "paused", "manually_paused"
		}
	}
	p.Supply.Ready = len(p.Supply.Reasons) == 0
	p.Capabilities.Status, p.Capabilities.Models, p.Capabilities.ObservedAt = "ready", []string{}, time.Now().Add(-2*time.Minute).UTC()
	for _, a := range m.w.accounts {
		if a.Platform == name {
			p.Capabilities.Plan = a.Plan
		}
	}
	p.Capabilities.Windows = m.w.quota[name]
	if state[0] == "syncing" {
		p.Capabilities.Status, p.Capabilities.Windows = "unknown", []window{}
	}
	return p, true
}

const accountsUnavailable = "this Bee was started from the command line; choose accounts with bee setup"

// desktop answers as a Bee run from the command line does when the scenario
// is one, and reports whether the request may go on.
func (m *mock) desktop(w http.ResponseWriter, code, message string) bool {
	m.mu.Lock()
	mode := m.w.mode
	m.mu.Unlock()
	if mode != "desktop" {
		refuse(w, 409, code, message)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func refuse(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": problem{code, message}})
}

func (m *mock) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/overview", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, m.overview()) })
	mux.HandleFunc("GET /v1/platforms/{platform}", func(w http.ResponseWriter, r *http.Request) {
		if p, ok := m.platform(r.PathValue("platform")); ok {
			writeJSON(w, 200, p)
			return
		}
		refuse(w, 404, "unknown_platform", "no account on this platform in the mock")
	})
	mux.HandleFunc("PUT /v1/platforms/{platform}/supply", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Paused *bool `json:"paused"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || input.Paused == nil {
			refuse(w, 400, "invalid_request", `body must be {"paused": true|false}`)
			return
		}
		time.Sleep(400 * time.Millisecond)
		m.mu.Lock()
		if m.w.failOps {
			m.mu.Unlock()
			refuse(w, 502, "supply_unconfirmed", "mock: Hive did not answer")
			return
		}
		m.w.paused[r.PathValue("platform")] = *input.Paused
		m.mu.Unlock()
		p, _ := m.platform(r.PathValue("platform"))
		m.publish("supply")
		writeJSON(w, 200, p.Supply)
	})
	mux.HandleFunc("POST /v1/pairing", func(w http.ResponseWriter, r *http.Request) {
		if !m.desktop(w, "pairing_unavailable", "this Bee was started from the command line; pair it with bee login") {
			return
		}
		m.mu.Lock()
		outcome := m.w.pairWith
		m.mu.Unlock()
		if outcome == "unreachable" {
			time.Sleep(time.Second)
			refuse(w, 502, "BEE-HIVE-UNREACHABLE", "mock: cannot reach Hive")
			return
		}
		lifetime := 10 * time.Minute
		if outcome == "expire" {
			lifetime = 15 * time.Second
		}
		p := &pairing{Status: "pending", UserCode: "ABCD-EFGH", VerificationURL: "https://console.tokhive.ai/devices/pair?code=ABCD-EFGH", ExpiresAt: time.Now().Add(lifetime).UTC()}
		m.mu.Lock()
		m.pairing = p
		m.mu.Unlock()
		m.publish("pairing")
		if outcome == "expire" {
			time.AfterFunc(lifetime, func() {
				m.mu.Lock()
				if m.pairing == p {
					m.pairing = &pairing{Status: "expired", Problem: &problem{"pairing_expired", "the code expired before it was confirmed"}}
				}
				m.mu.Unlock()
				m.publish("pairing")
			})
			writeJSON(w, 200, p)
			return
		}
		// The person confirms in the browser a few seconds later.
		time.AfterFunc(5*time.Second, func() {
			m.mu.Lock()
			if m.pairing == p {
				m.pairing = &pairing{Status: "completed"}
				m.w.binding, m.w.connection = "paired", "connected"
			}
			m.mu.Unlock()
			m.publish("binding")
		})
		writeJSON(w, 200, p)
	})
	mux.HandleFunc("GET /v1/pairing", func(w http.ResponseWriter, r *http.Request) {
		if !m.desktop(w, "pairing_unavailable", "this Bee was started from the command line; pair it with bee login") {
			return
		}
		m.mu.Lock()
		p := m.pairing
		m.mu.Unlock()
		if p == nil {
			p = &pairing{}
		}
		writeJSON(w, 200, p)
	})
	mux.HandleFunc("DELETE /v1/pairing", func(w http.ResponseWriter, r *http.Request) {
		if !m.desktop(w, "pairing_unavailable", "this Bee was started from the command line; pair it with bee login") {
			return
		}
		m.mu.Lock()
		m.pairing = &pairing{Status: "cancelled"}
		m.mu.Unlock()
		m.publish("pairing")
		writeJSON(w, 200, pairing{Status: "cancelled"})
	})
	mux.HandleFunc("GET /v1/accounts", func(w http.ResponseWriter, r *http.Request) {
		if m.desktop(w, "accounts_unavailable", accountsUnavailable) {
			writeJSON(w, 200, map[string]any{"accounts": m.overview().Accounts})
		}
	})
	mux.HandleFunc("GET /v1/platforms/{platform}/login", func(w http.ResponseWriter, r *http.Request) {
		if !m.desktop(w, "accounts_unavailable", accountsUnavailable) {
			return
		}
		time.Sleep(300 * time.Millisecond)
		m.mu.Lock()
		found, ok := m.w.logins[r.PathValue("platform")]
		m.mu.Unlock()
		if !ok {
			refuse(w, 404, "unknown_platform", "platform must be openai or claude")
			return
		}
		writeJSON(w, 200, found)
	})
	mux.HandleFunc("POST /v1/accounts", func(w http.ResponseWriter, r *http.Request) {
		if !m.desktop(w, "accounts_unavailable", accountsUnavailable) {
			return
		}
		var input struct{ Platform, Source, File string }
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			refuse(w, 400, "invalid_request", "bad body")
			return
		}
		time.Sleep(600 * time.Millisecond)
		m.mu.Lock()
		defer m.mu.Unlock()
		if slices.ContainsFunc(m.w.accounts, func(a account) bool { return a.Platform == input.Platform }) {
			refuse(w, 409, "platform_has_account", "this version shares one account per platform; remove the current one first")
			return
		}
		a := account{ID: fmt.Sprintf("acc_%s%d", input.Platform, time.Now().Unix()), Platform: input.Platform, Source: input.Source, AddedAt: time.Now().UTC()}
		switch input.Source {
		case "local":
			found := m.w.logins[input.Platform]
			if !found.Available {
				writeJSON(w, 422, map[string]any{"error": found.Problem})
				return
			}
			a.Email, a.Plan, a.Fingerprint = found.Email, found.Plan, found.Fingerprint
		case "import":
			// The file is judged by its name: the platform's credential file
			// imports, and a name with "expired" or "scope" fails as such.
			want := map[string]string{"openai": "auth.json", "claude": ".credentials.json"}[input.Platform]
			name := filepath.Base(input.File)
			switch {
			case input.File == "":
				refuse(w, 400, "invalid_request", "file is required to import an account")
				return
			case strings.Contains(name, "expired"):
				refuse(w, 422, "import_expired", "mock: this sign-in has expired")
				return
			case strings.Contains(name, "scope"):
				refuse(w, 422, "import_scope", "mock: this sign-in lacks a required permission")
				return
			case name != want:
				refuse(w, 422, "import_invalid", "mock: not a "+want)
				return
			}
			a.Email = map[string]string{"openai": "f.import@outlook.com", "claude": "e.import@gmail.com"}[input.Platform]
			a.Plan, a.Fingerprint = "pro", "a7c3f019"+strings.Repeat("0", 56)
		default:
			refuse(w, 400, "invalid_request", `source must be "local" or "import"`)
			return
		}
		m.w.accounts = append(m.w.accounts, a)
		m.w.state[input.Platform] = [2]string{"syncing", "capabilities_unknown"}
		go func() {
			time.Sleep(3 * time.Second)
			m.mu.Lock()
			m.w.state[input.Platform] = [2]string{"sharing", ""}
			m.mu.Unlock()
			m.publish("supply")
		}()
		go m.publish("accounts")
		writeJSON(w, 201, a)
	})
	mux.HandleFunc("DELETE /v1/accounts/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !m.desktop(w, "accounts_unavailable", accountsUnavailable) {
			return
		}
		time.Sleep(600 * time.Millisecond)
		m.mu.Lock()
		if m.w.failOps {
			m.mu.Unlock()
			refuse(w, 502, "pause_unconfirmed", "mock: Hive did not confirm the pause")
			return
		}
		i := slices.IndexFunc(m.w.accounts, func(a account) bool { return a.ID == r.PathValue("id") })
		if i >= 0 {
			m.w.accounts = slices.Delete(m.w.accounts, i, i+1)
		}
		m.mu.Unlock()
		if i < 0 {
			refuse(w, 404, "not_found", "no account with this id")
			return
		}
		m.publish("accounts")
		writeJSON(w, 200, map[string]string{"removed": r.PathValue("id")})
	})
	mux.HandleFunc("POST /v1/accounts/{id}/confirm", func(w http.ResponseWriter, r *http.Request) {
		if !m.desktop(w, "accounts_unavailable", accountsUnavailable) {
			return
		}
		time.Sleep(600 * time.Millisecond)
		m.mu.Lock()
		defer m.mu.Unlock()
		i := slices.IndexFunc(m.w.accounts, func(a account) bool { return a.ID == r.PathValue("id") })
		switch {
		case i < 0:
			refuse(w, 404, "not_found", "no account with this id")
			return
		case m.w.failOps:
			refuse(w, 502, "confirmation_unconfirmed", "mock: Hive did not confirm the switch")
			return
		}
		a := &m.w.accounts[i]
		if !strings.HasSuffix(m.w.state[a.Platform][1], "_confirmation_required") {
			refuse(w, 409, "no_pending_switch", "Hive is not waiting for an account switch on this platform")
			return
		}
		found := m.w.logins[a.Platform]
		a.Email, a.Plan, a.Fingerprint = found.Email, found.Plan, found.Fingerprint
		m.w.state[a.Platform] = [2]string{"syncing", "capabilities_unknown"}
		platform := a.Platform
		go func() {
			time.Sleep(3 * time.Second)
			m.mu.Lock()
			m.w.state[platform] = [2]string{"sharing", ""}
			m.mu.Unlock()
			m.publish("supply")
		}()
		go m.publish("accounts")
		writeJSON(w, 200, map[string]any{"platform": platform, "status": "confirmed", "account_fingerprint": found.Fingerprint})
	})
	// The real catalog, so the window shows Bee's own words.
	mux.HandleFunc("GET /v1/explanations", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, bee.ExplanationCatalog())
	})
	mux.HandleFunc("GET /v1/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		o := m.overview()
		if o.Device != nil {
			o.Device.OwnerEmail = "a***@gmail.com"
		}
		for i := range o.Accounts {
			o.Accounts[i].Email = o.Accounts[i].Email[:1] + "***"
		}
		writeJSON(w, 200, map[string]any{"generated_at": time.Now().UTC(), "mock": true, "overview": o, "checks": []any{}})
	})
	mux.HandleFunc("GET /v1/events", func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		ch := make(chan string, 16)
		m.mu.Lock()
		m.subs[ch] = struct{}{}
		m.mu.Unlock()
		defer func() { m.mu.Lock(); delete(m.subs, ch); m.mu.Unlock() }()
		w.Header().Set("Content-Type", "text/event-stream")
		raw, _ := json.Marshal(m.overview())
		fmt.Fprintf(w, "event: overview\ndata: %s\n\n", raw)
		flusher.Flush()
		keepalive := time.NewTicker(15 * time.Second)
		defer keepalive.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-keepalive.C:
				io.WriteString(w, ": keepalive\n\n")
			case name := <-ch:
				fmt.Fprintf(w, "event: %s\ndata: {}\n\n", name)
			}
			flusher.Flush()
		}
	})
	// Development only: switch scenario while running.
	mux.HandleFunc("POST /mock/scenario", func(w http.ResponseWriter, r *http.Request) {
		var input struct{ Name string }
		json.NewDecoder(r.Body).Decode(&input)
		if err := m.set(input.Name); err != nil {
			refuse(w, 400, "unknown_scenario", err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"scenario": input.Name})
	})
	return mux
}

func socketPath(config string) string {
	return filepath.Join(filepath.Dir(config), "control", "bee.sock")
}

func unixClient(path string) *http.Client {
	return &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", path)
	}}}
}

func main() {
	config := flag.String("config", "", "device configuration path whose control socket to serve (required)")
	scenario := flag.String("scenario", "sharing", "scenario to start with")
	switchTo := flag.String("switch", "", "tell the mock serving -config to switch to this scenario, then exit")
	list := flag.Bool("list", false, "list scenarios")
	verbose := flag.Bool("v", false, "log every request")
	flag.Parse()
	if *list {
		fmt.Println(strings.Join(scenarioNames(), "\n"))
		return
	}
	if *config == "" {
		log.Fatal("-config is required")
	}
	path := socketPath(*config)
	if *switchTo != "" {
		body, _ := json.Marshal(map[string]string{"name": *switchTo})
		res, err := unixClient(path).Post("http://bee/mock/scenario", "application/json", bytes.NewReader(body))
		if err != nil {
			log.Fatal(err)
		}
		raw, _ := io.ReadAll(res.Body)
		fmt.Println(strings.TrimSpace(string(raw)))
		if res.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	m := &mock{subs: map[chan string]struct{}{}}
	if err := m.set(*scenario); err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		log.Fatal(err)
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Fatal(err)
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		log.Fatal(err)
	}
	os.Chmod(path, 0o600)
	handler := m.handler()
	if *verbose {
		inner := handler
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			log.Printf("%s %s", r.Method, r.URL.Path)
			inner.ServeHTTP(w, r)
		})
	}
	server := &http.Server{Handler: handler}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		server.Close()
	}()
	log.Printf("mock Bee serving %s; scenarios: %s", path, strings.Join(scenarioNames(), ", "))
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	os.Remove(path)
}
