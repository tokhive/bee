package bee

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"golang.org/x/net/http/httpproxy"
)

// officialTransport carries Bee's own HTTPS to the official hosts — capability
// queries, OAuth refresh and the Claude profile — through connect_proxy when
// the process has no HTTPS_PROXY, so one proxy setting covers both the TEE
// tunnel and these requests. An HTTPS_PROXY that is set keeps its meaning,
// NO_PROXY included. Requests to Hive never use this transport.
func officialTransport(connectProxy string) http.RoundTripper {
	proxy, _ := officialProxyPolicy(connectProxy)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		return proxy(req.URL)
	}
	return transport
}

func officialProxyPolicy(connectProxy string) (func(*url.URL) (*url.URL, error), bool) {
	// Capture this revision's environment instead of ProxyFromEnvironment's
	// process-wide cache. NO_PROXY applies equally to the dedicated fallback.
	policy := httpproxy.FromEnvironment()
	environment := policy.HTTPSProxy != ""
	if policy.HTTPSProxy == "" && connectProxy != "" {
		policy.HTTPSProxy = "http://" + connectProxy
	}
	return policy.ProxyFunc(), environment
}

func localConnectProxy(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err == nil && u.Scheme == "http" && u.User == nil && u.Opaque == "" && (u.Path == "" || u.Path == "/") && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" {
		ip := net.ParseIP(u.Hostname())
		port, err := strconv.Atoi(u.Port())
		if ip != nil && ip.IsLoopback() && err == nil && port > 0 && port <= 65535 {
			return u.Host, nil
		}
	}
	return "", errors.New("connect_proxy must be an unauthenticated HTTP proxy at an explicit loopback IP address and port")
}

// Preserve classification without exposing proxy/network details in public errors.
type proxyError struct {
	message string
	cause   error
}

func (e proxyError) Error() string {
	if e.cause != nil {
		return e.message + ": " + e.cause.Error()
	}
	return e.message
}
func (e proxyError) Unwrap() error { return e.cause }

type bufferedProxyConn struct {
	net.Conn
	reader io.Reader
}

func (c *bufferedProxyConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

// CONNECT carries the existing TEE TLS stream; Bee never terminates upstream TLS.
func (cfg *egressConfig) dialEgress(ctx context.Context, target string) (net.Conn, error) {
	dialer := net.Dialer{Timeout: 10 * time.Second}
	if cfg.ConnectProxy == "" {
		done := beeEgressPhase(ctx, "direct_dial")
		conn, err := dialer.DialContext(ctx, "tcp", target)
		done(err)
		return conn, err
	}
	address, err := localConnectProxy(cfg.ConnectProxy)
	if err != nil {
		return nil, err
	}
	dialDone := beeEgressPhase(ctx, "proxy_dial")
	conn, err := dialer.DialContext(ctx, "tcp", address)
	dialDone(err)
	if err != nil {
		return nil, proxyError{"failed to connect to local egress proxy", err}
	}
	connectDone := beeEgressPhase(ctx, "proxy_connect")
	ok := false
	defer func() {
		if !ok {
			connectDone(errors.New("proxy connection failed"))
			conn.Close()
		}
	}()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	req := &http.Request{Method: http.MethodConnect, URL: &url.URL{Opaque: target}, Host: target, Header: make(http.Header)}
	if err := req.Write(conn); err != nil {
		return nil, proxyError{"egress proxy handshake failed", err}
	}
	reader := bufio.NewReader(io.LimitReader(conn, 32<<10))
	response, err := http.ReadResponse(reader, req)
	if err != nil {
		return nil, proxyError{"egress proxy did not establish a tunnel", err}
	}
	if response.StatusCode != http.StatusOK {
		return nil, proxyError{fmt.Sprintf("egress proxy CONNECT returned HTTP status=%d; required=200", response.StatusCode), nil}
	}
	// Preserve any bytes read past the bounded CONNECT headers before lifting the limit.
	pending, _ := reader.Peek(reader.Buffered())
	prefix := bytes.Clone(pending)
	if !stop() || ctx.Err() != nil {
		return nil, errors.New("egress proxy handshake cancelled")
	}
	if err = conn.SetDeadline(time.Time{}); err != nil {
		return nil, proxyError{"egress proxy connection closed", err}
	}
	ok = true
	connectDone(nil)
	return &bufferedProxyConn{Conn: conn, reader: io.MultiReader(bytes.NewReader(prefix), conn)}, nil
}
