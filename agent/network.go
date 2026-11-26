package bee

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/net/http/httpproxy"
)

// The desktop app keeps its own network setting beside the device
// configuration. The egress configuration cannot hold it: that file is
// removed when its last account goes, and cannot be read with no target.

type networkFile struct {
	ConnectProxy string `json:"connect_proxy,omitempty"`
}

func networkPath(configPath string) string {
	return filepath.Join(filepath.Dir(configPath), "network.json")
}

// readDesktopProxy is the proxy the desktop app saved, "" for none.
func readDesktopProxy(configPath string) (string, error) {
	file, err := openRegularNoFollow(networkPath(configPath))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	defer file.Close()
	if err := validatePrivateFile(file); err != nil {
		return "", err
	}
	var stored networkFile
	if err := json.NewDecoder(io.LimitReader(file, 4096)).Decode(&stored); err != nil {
		return "", err
	}
	if stored.ConnectProxy != "" {
		if _, err := localConnectProxy(stored.ConnectProxy); err != nil {
			return "", errors.New("network.json holds a connect_proxy that is not a local HTTP proxy")
		}
	}
	return stored.ConnectProxy, nil
}

func writeDesktopProxy(configPath, proxy string) error {
	if proxy == "" {
		if err := os.Remove(networkPath(configPath)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	raw, err := json.MarshalIndent(networkFile{ConnectProxy: proxy}, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateFile(networkPath(configPath), append(raw, '\n'), ".network-*")
}

// useDesktopProxy gives a desktop Bee the proxy the app saved, unless the
// egress configuration names one of its own, which then wins.
func (cfg *egressConfig) useDesktopProxy(configPath string) error {
	if cfg.ConnectProxy != "" {
		return nil
	}
	proxy, err := readDesktopProxy(configPath)
	if err != nil || proxy == "" {
		return err
	}
	cfg.ConnectProxy, cfg.desktopProxy = proxy, true
	return cfg.applyProxy()
}

// Proxy settings as the control interface reports them.
const (
	proxySourceNone    = ""
	proxySourceDesktop = "desktop"
	proxySourceEgress  = "egress"
)

type controlNetwork struct {
	// ConnectProxy is what Bee uses after its next start.
	ConnectProxy string `json:"connect_proxy"`
	// ActiveProxy is what this Bee uses now.
	ActiveProxy string `json:"active_proxy"`
	// Source is where ConnectProxy is kept: "desktop" (changeable here),
	// "egress" (the egress configuration, changed with bee setup) or "".
	Source          string `json:"source"`
	Editable        bool   `json:"editable"`
	EnvOverride     bool   `json:"env_override"`
	RestartRequired bool   `json:"restart_required"`
}

func (c *controlServer) network() (controlNetwork, error) {
	active := c.egress.ConnectProxy
	out := controlNetwork{ActiveProxy: active, EnvOverride: httpproxy.FromEnvironment().HTTPSProxy != ""}
	if active != "" && !c.egress.desktopProxy {
		out.ConnectProxy, out.Source = active, proxySourceEgress
		return out, nil
	}
	out.Editable = c.manager != nil
	if c.manager == nil {
		out.ConnectProxy = active
		return out, nil
	}
	saved, err := readDesktopProxy(c.configPath)
	if err != nil {
		return out, err
	}
	out.ConnectProxy = saved
	if saved != "" {
		out.Source = proxySourceDesktop
	}
	out.RestartRequired = saved != active
	return out, nil
}

func (c *controlServer) setNetwork(proxy string) (controlNetwork, error) {
	current, err := c.network()
	if err != nil {
		return controlNetwork{}, err
	}
	if c.manager == nil {
		return controlNetwork{}, refuse(http.StatusConflict, "network_unavailable", "this Bee was started from the command line; set connect_proxy with bee setup")
	}
	if current.Source == proxySourceEgress {
		return controlNetwork{}, refuse(http.StatusConflict, "proxy_in_egress", "the proxy is set in the egress configuration; change it with bee setup")
	}
	if proxy != "" {
		if _, err := localConnectProxy(proxy); err != nil {
			return controlNetwork{}, refuse(http.StatusBadRequest, "invalid_proxy", "the proxy must be an unauthenticated HTTP proxy at a loopback IP address and port, for example http://127.0.0.1:7890")
		}
	}
	if err := writeDesktopProxy(c.configPath, proxy); err != nil {
		return controlNetwork{}, err
	}
	return c.network()
}

type controlNetworkCheck struct {
	OK      bool            `json:"ok"`
	Target  string          `json:"target"`
	Problem *controlProblem `json:"problem,omitempty"`
}

// checkNetwork opens one tunnel to an official host through proxy ("" is
// direct), the way Bee opens them for an account, and closes it.
func (c *controlServer) checkNetwork(ctx context.Context, proxy string) (controlNetworkCheck, error) {
	if proxy != "" {
		if _, err := localConnectProxy(proxy); err != nil {
			return controlNetworkCheck{}, refuse(http.StatusBadRequest, "invalid_proxy", "the proxy must be an unauthenticated HTTP proxy at a loopback IP address and port, for example http://127.0.0.1:7890")
		}
	}
	target := "chatgpt.com:443"
	if len(c.egress.Targets) > 0 {
		target = c.egress.Targets[0]
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	conn, err := (&egressConfig{ConnectProxy: proxy}).dialEgress(ctx, target)
	if err == nil {
		conn.Close()
		return controlNetworkCheck{OK: true, Target: target}, nil
	}
	code, message := "target_unreachable", "Bee could not reach the official service directly"
	if proxy != "" {
		code, message = "proxy_refused", "the proxy answered, but would not open a connection to the official service"
		if strings.HasPrefix(err.Error(), "failed to connect to local egress proxy") {
			code, message = "proxy_unreachable", "nothing answers at the proxy's address"
		}
	}
	return controlNetworkCheck{Target: target, Problem: &controlProblem{Code: code, Message: message}}, nil
}
