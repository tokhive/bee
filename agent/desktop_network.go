package bee

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"syscall"
	"time"
)

type DesktopNetworkTestRequest struct {
	Proxy string `json:"proxy"`
}

// A successful check proves reachability only. It never proves authorization,
// quota, contribution readiness, or the official client's network settings.
type DesktopNetworkCheck struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	Path       string `json:"path"`
	HTTPStatus *int   `json:"http_status"`
}

type DesktopNetworkTestResult struct {
	ObservedAt string                `json:"observed_at"`
	Checks     []DesktopNetworkCheck `json:"checks"`
}

type DesktopNetworkPaths struct {
	Relay         string `json:"relay"`
	Official      string `json:"official"`
	Hive          string `json:"hive"`
	OfficialLogin string `json:"official_login"`
}

type DesktopNetworkStatus struct {
	EffectiveRevision int64               `json:"effective_revision"`
	EffectiveProxy    string              `json:"effective_proxy"`
	Paths             DesktopNetworkPaths `json:"paths"`
}

type DesktopNetwork struct {
	transport func(string) http.RoundTripper
	accounts  *DesktopAccounts
}

func NewDesktopNetwork(accounts ...*DesktopAccounts) *DesktopNetwork {
	service := &DesktopNetwork{transport: officialTransport}
	if len(accounts) > 0 {
		service.accounts = accounts[0]
	}
	return service
}

// Status reports only the effective policy. Saved preferences belong to Rust.
// It performs no HTTP calls and cannot start, stop, renew or register anything.
func (n *DesktopNetwork) Status(ctx context.Context) (DesktopNetworkStatus, error) {
	if err := ctx.Err(); err != nil {
		return DesktopNetworkStatus{}, err
	}
	if n.accounts == nil {
		return DesktopNetworkStatus{Paths: desktopNetworkPaths("")}, nil
	}
	n.accounts.networkMu.RLock()
	defer n.accounts.networkMu.RUnlock()
	return DesktopNetworkStatus{EffectiveRevision: n.accounts.network.Revision, EffectiveProxy: n.accounts.network.ConnectProxy, Paths: n.accounts.networkPaths}, nil
}

func desktopNetworkPaths(proxy string) DesktopNetworkPaths {
	address, relay := "", "direct"
	if proxy != "" {
		address, _ = localConnectProxy(proxy)
		relay = "local_proxy"
	}
	openai, _ := http.NewRequest(http.MethodGet, "https://chatgpt.com/backend-api/wham/usage", nil)
	claude, _ := http.NewRequest(http.MethodGet, "https://api.anthropic.com/api/oauth/profile", nil)
	return DesktopNetworkPaths{Relay: relay, Official: "openai=" + officialNetworkPath(openai, address) + ";claude=" + officialNetworkPath(claude, address), Hive: "process_environment", OfficialLogin: "official_client"}
}

func ValidateDesktopConnectProxy(raw string) error {
	if raw == "" {
		return nil
	}
	_, err := localConnectProxy(raw)
	return err
}

// Test accepts a proxy draft, never an endpoint, account or write operation.
// Both HTTPS URLs and the CONNECT target are fixed in this trusted core.
func (n *DesktopNetwork) Test(ctx context.Context, input DesktopNetworkTestRequest) (DesktopNetworkTestResult, error) {
	result := DesktopNetworkTestResult{ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Checks: []DesktopNetworkCheck{}}
	if err := ValidateDesktopConnectProxy(input.Proxy); err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	address := ""
	local := DesktopNetworkCheck{ID: "local_proxy", Status: "skipped", Message: "No dedicated local proxy is configured.", Path: "direct"}
	if input.Proxy != "" {
		address, _ = localConnectProxy(input.Proxy)
		local.Path = "local_proxy"
		cfg := egressConfig{ConnectProxy: input.Proxy}
		conn, err := cfg.dialEgress(ctx, "chatgpt.com:443")
		if err != nil {
			local.Status, local.Message = "failed", "Local proxy CONNECT to chatgpt.com:443 failed: "+err.Error()
		} else {
			_ = conn.Close()
			local.Status, local.Message = "ok", "Local proxy established CONNECT to chatgpt.com:443; upstream TLS and account authorization are not verified by this check."
		}
	}
	result.Checks = append(result.Checks, local)
	transport := n.transport(address)
	if closer, ok := transport.(interface{ CloseIdleConnections() }); ok {
		defer closer.CloseIdleConnections()
	}
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, endpoint := range []struct{ id, url string }{
		{"openai_read_only", "https://chatgpt.com/backend-api/wham/usage"},
		{"claude_read_only", "https://api.anthropic.com/api/oauth/profile"},
	} {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.url, nil)
		check := DesktopNetworkCheck{ID: endpoint.id, Status: "failed", Path: officialNetworkPath(req, address)}
		response, err := client.Do(req)
		if err != nil {
			// Network errors may include environment proxy credentials. Describe
			// the fixed failed check and safe category, never echo that URL.
			check.Message = "Official read-only GET received no HTTP response; check=" + endpoint.id + " cause=" + desktopNetworkFailure(err)
		} else {
			status := response.StatusCode
			check.HTTPStatus = &status
			_ = response.Body.Close()
			check.Message = fmt.Sprintf("Official read-only endpoint returned HTTP status=%d; account authorization was not tested.", status)
			if status >= 200 && status < 300 || status == 401 || status == 403 || status == 429 {
				check.Status = "ok"
			}
			switch status {
			case 401:
				check.Message += " Authentication is required; only network reachability is confirmed."
			case 403:
				check.Message += " Access is forbidden; only network reachability is confirmed."
			case 429:
				check.Message += " The endpoint is rate limited; only network reachability is confirmed."
			}
		}
		result.Checks = append(result.Checks, check)
	}
	return result, nil
}

func desktopNetworkFailure(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "deadline_exceeded"
	}
	if errors.Is(err, context.Canceled) {
		return "context_canceled"
	}
	var operation *net.OpError
	if errors.As(err, &operation) {
		var errno syscall.Errno
		if errors.As(operation.Err, &errno) {
			return fmt.Sprintf("network_operation=%s network=%s system_error=%s", operation.Op, operation.Net, errno.Error())
		}
		return fmt.Sprintf("network_operation=%s network=%s timeout=%t cause_type=%T", operation.Op, operation.Net, operation.Timeout(), operation.Err)
	}
	// URL and address fields can contain an authenticated environment proxy.
	// Keep the concrete failure type without exposing those credential fields.
	var request *url.Error
	if errors.As(err, &request) {
		return fmt.Sprintf("request_operation=%s cause_type=%T", request.Op, request.Err)
	}
	return fmt.Sprintf("cause_type=%T", err)
}

func officialNetworkPath(req *http.Request, dedicated string) string {
	// Use the exact same policy constructor as officialTransport. This exposes
	// only the path category, never the environment variable or proxy address.
	policy, environment := officialProxyPolicy(dedicated)
	proxy, err := policy(req.URL)
	if err == nil && proxy == nil {
		return "direct"
	}
	if environment {
		return "environment_proxy"
	}
	return "local_proxy"
}

// ConfigureNetwork only updates the official read-only/refresh policy. The S1
// runtime owns stop verification and must invoke this inside its own stopped
// ConfigureNetwork transition, before publishing the new effective revision.
// Platform gates remain available while old HTTP calls finish; revision guards
// discard their results and invalidate old cache lazily before any next read.
func (a *DesktopAccounts) ConfigureNetwork(ctx context.Context, config DesktopNetworkConfig) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !desktopSafeRevision(config.Revision) {
		return fmt.Errorf("official network revision=%d; required=0..9007199254740991", config.Revision)
	}
	if err := ValidateDesktopConnectProxy(config.ConnectProxy); err != nil {
		return err
	}
	a.networkMu.Lock()
	if err := ctx.Err(); err != nil {
		a.networkMu.Unlock()
		return err
	}
	if config.Revision < a.network.Revision || config.Revision == a.network.Revision && config.ConnectProxy != a.network.ConnectProxy {
		current := a.network.Revision
		a.networkMu.Unlock()
		return fmt.Errorf("official network configuration conflicts with current revision=%d; requested_revision=%d; changed configuration requires a newer revision", current, config.Revision)
	}
	if config == a.network {
		a.networkMu.Unlock()
		return nil
	}
	address := ""
	if config.ConnectProxy != "" {
		address, _ = localConnectProxy(config.ConnectProxy)
	}
	previous := a.networkTransport
	a.network, a.networkTransport = config, officialTransport(address)
	a.networkPaths = desktopNetworkPaths(config.ConnectProxy)
	a.networkMu.Unlock()
	if closer, ok := previous.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
	return nil
}

// OfficialTransport exposes the shared policy to S1's selected-source refresh
// adapters; it must be captured with the effective runtime network revision.
// It is never assigned to the device/Hive client or official login processes.
func (a *DesktopAccounts) OfficialTransport() http.RoundTripper {
	a.networkMu.RLock()
	defer a.networkMu.RUnlock()
	return a.officialTransportLocked()
}

// OfficialNetwork captures both values under one lock for revision-aware
// diagnostics and selected-source adapters. The config contains no environment
// proxy values, credentials, Hive settings, or official-client configuration.
func (a *DesktopAccounts) OfficialNetwork() (DesktopNetworkConfig, http.RoundTripper) {
	a.networkMu.RLock()
	defer a.networkMu.RUnlock()
	return a.network, a.officialTransportLocked()
}

func (a *DesktopAccounts) officialTransportLocked() http.RoundTripper {
	if a.transport != nil {
		return a.transport
	}
	return a.networkTransport
}

func (a *DesktopAccounts) invalidateOfficialNetworkLocked(p *desktopAccountPlatform) {
	if p.networkRevision == a.network.Revision {
		return
	}
	p.networkRevision = a.network.Revision
	p.official = nil
	p.snapshot.Capabilities[0] = emptyAccountCapabilities("official")
	if p.snapshot.Candidate.IdentityVerified {
		p.snapshot.Candidate.IdentityVerified = false
		if p.snapshot.Platform == "claude" {
			p.snapshot.Candidate.Fingerprint = nil
		}
		p.snapshot.Authorization = DesktopAccountFact{State: "local_structure_only"}
	}
}
