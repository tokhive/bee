package bee

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/relay"
)

// residentialConfig enables the seller's residential egress role. A Bee with
// this block accepts streams that carry a signed Hive lease and dials the
// arbitrary target the buyer named, instead of the fixed AI target allowlist.
type residentialConfig struct {
	Enabled bool   `json:"enabled"`
	HiveKey string `json:"hive_key"`
	// Ports are the destination ports a buyer may reach. Defaults to 80 and
	// 443, and accepts only those: this is a web proxy, not an open relay.
	Ports []int `json:"ports,omitempty"`
	// MaxBPS caps the rate a lease may request, whatever the token says.
	MaxBPS int64 `json:"max_bps,omitempty"`
	// MaxStreams caps concurrent streams per lease.
	MaxStreams int `json:"max_streams,omitempty"`
	// AllowPrivate lets tests reach a loopback target. validate refuses it in
	// a real configuration so a shipped Bee cannot be turned into a LAN proxy.
	AllowPrivate bool `json:"allow_private,omitempty"`
}

var (
	errEgressByteCap = errors.New("residential egress byte cap reached")
	errEgressLease   = errors.New("residential egress lease rejected")
)

// residential is the seller-side data plane. Its state is per process and
// bounded by the leases Hive signed: a token cannot be replayed past its
// expiry, stream ceiling or byte ceiling.
type residential struct {
	key          []byte
	seller       string
	ports        map[int]bool
	maxBPS       int64
	maxStreams   int
	allowPrivate bool

	mu     sync.Mutex
	leases map[string]*residentialLease

	now    func() time.Time
	lookup func(context.Context, string, string) ([]netip.Addr, error)
	dial   func(context.Context, string, string) (net.Conn, error)
}

type residentialLease struct {
	expires time.Time
	streams int
	used    atomic.Int64
	bucket  *egressBucket
}

func newResidential(cfg *residentialConfig) (*residential, error) {
	key, err := beewire.EgressKey(cfg.HiveKey)
	if err != nil {
		return nil, fail("BEE-CONFIG-EGRESS-KEY", "")
	}
	ports := cfg.Ports
	if len(ports) == 0 {
		ports = []int{80, 443}
	}
	allowed := make(map[int]bool, len(ports))
	for _, port := range ports {
		if port != 80 && port != 443 {
			return nil, fail("BEE-CONFIG-EGRESS-PORT", strconv.Itoa(port))
		}
		allowed[port] = true
	}
	maxStreams := cfg.MaxStreams
	if maxStreams <= 0 {
		maxStreams = 8
	}
	return &residential{
		key:          key,
		ports:        allowed,
		maxBPS:       cfg.MaxBPS,
		maxStreams:   maxStreams,
		allowPrivate: cfg.AllowPrivate,
		leases:       make(map[string]*residentialLease),
		now:          time.Now,
		lookup:       net.DefaultResolver.LookupNetIP,
		dial: (&net.Dialer{
			Timeout: 10 * time.Second,
		}).DialContext,
	}, nil
}

// serve handles one stream whose open metadata carried a lease. stream is an
// io.ReadWriteCloser so the policy and bridge can be exercised without a live
// Hive tunnel.
func (r *residential) serve(ctx context.Context, stream io.ReadWriteCloser, hostport, token string) {
	defer stream.Close()
	lease, err := beewire.ParseEgressLease(token, r.key, r.now())
	if err != nil {
		residentialReject(hostport, "lease", err)
		return
	}
	if r.seller == "" || lease.Seller != r.seller {
		residentialReject(hostport, "seller", errEgressLease)
		return
	}
	host, port, err := beewire.ParseEgressHostPort(hostport)
	if err != nil || !r.ports[port] || beewire.NumericEgressHost(host) {
		residentialReject(hostport, "target", errEgressLease)
		return
	}
	addresses, err := r.lookup(ctx, "ip", host)
	if err != nil || len(addresses) == 0 {
		residentialReject(hostport, "resolve", err)
		return
	}
	target, ok := r.destination(addresses, lease.Family)
	if !ok {
		residentialReject(hostport, "destination", errEgressLease)
		return
	}
	state, ok := r.admit(lease)
	if !ok {
		residentialReject(hostport, "admission", errEgressLease)
		return
	}
	defer r.release(lease.ID)

	upstream, err := r.dial(ctx, "tcp", net.JoinHostPort(target.String(), strconv.Itoa(port)))
	if err != nil {
		residentialReject(hostport, "dial", err)
		return
	}
	defer upstream.Close()

	bps := lease.BPS
	if r.maxBPS > 0 && (bps <= 0 || bps > r.maxBPS) {
		bps = r.maxBPS
	}
	meter := &egressMeter{
		Conn:   upstream,
		limit:  lease.ByteCap,
		used:   &state.used,
		bucket: newEgressBucket(bps),
		ctx:    ctx,
	}
	egressDebug("residential stream opened for %q via %s", hostport, target)
	relay.Bridge(ctx, stream, meter)
	egressDebug("residential stream for %q closed after %d bytes", hostport, state.used.Load())
}

// destination picks the first resolved address the policy allows, preferring
// the family the lease advertises. Every candidate is checked; a hostname that
// resolves to a private address is refused rather than dialled.
func (r *residential) destination(addresses []netip.Addr, family string) (netip.Addr, bool) {
	ordered := make([]netip.Addr, 0, len(addresses))
	for _, address := range addresses {
		address = address.Unmap()
		if family == "v4" && address.Is4() || family == "v6" && address.Is6() && !address.Is4() {
			ordered = append(ordered, address)
		}
	}
	for _, address := range addresses {
		address = address.Unmap()
		if !slices.Contains(ordered, address) {
			ordered = append(ordered, address)
		}
	}
	for _, address := range ordered {
		if r.allowPrivate || !beewire.BlockedEgressAddr(address) {
			return address, true
		}
	}
	return netip.Addr{}, false
}

// admit reserves one stream slot and refuses an expired, exhausted or
// over-subscribed lease. Bytes are charged by the meter and survive the
// stream, so closing and reopening does not reset the cap.
func (r *residential) admit(lease beewire.EgressLease) (*residentialLease, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	r.cleanupLocked(now)
	state := r.leases[lease.ID]
	if state == nil {
		state = &residentialLease{expires: time.Unix(lease.Expires, 0)}
		r.leases[lease.ID] = state
	}
	if !now.Before(state.expires) || state.used.Load() >= lease.ByteCap ||
		state.streams >= lease.MaxStreams || state.streams >= r.maxStreams {
		return nil, false
	}
	state.streams++
	return state, true
}

func (r *residential) release(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if state := r.leases[id]; state != nil && state.streams > 0 {
		state.streams--
	}
}

// cleanupLocked forgets leases whose time is up and which have no stream left.
func (r *residential) cleanupLocked(now time.Time) {
	for id, state := range r.leases {
		if state.streams == 0 && !now.Before(state.expires) {
			delete(r.leases, id)
		}
	}
}

func residentialReject(hostport, reason string, err error) {
	if err == nil {
		err = errEgressLease
	}
	slog.Warn("residential egress rejected", "module", "egress", "host", hostport, "reason", reason, "error", err)
}

// egressMeter enforces the lease's byte ceiling and optional rate across both
// directions. A cap breach closes the bridge by returning an error.
type egressMeter struct {
	net.Conn
	limit  int64
	used   *atomic.Int64
	bucket *egressBucket
	ctx    context.Context
}

func (m *egressMeter) Read(p []byte) (int, error) {
	n, err := m.Conn.Read(p)
	if n > 0 {
		if !m.charge(n) {
			return 0, errEgressByteCap
		}
		if m.bucket != nil {
			m.bucket.take(m.ctx, n)
		}
	}
	return n, err
}

func (m *egressMeter) Write(p []byte) (int, error) {
	remaining := m.limit - m.used.Load()
	if remaining <= 0 {
		return 0, errEgressByteCap
	}
	if int64(len(p)) > remaining {
		p = p[:remaining]
	}
	if m.bucket != nil {
		m.bucket.take(m.ctx, len(p))
	}
	n, err := m.Conn.Write(p)
	if n > 0 {
		m.charge(n)
	}
	return n, err
}

func (m *egressMeter) charge(n int) bool {
	if n <= 0 {
		return true
	}
	total := m.used.Add(int64(n))
	if total > m.limit {
		m.used.CompareAndSwap(total, m.limit)
		return false
	}
	return true
}

// egressBucket is a one-second-burst token bucket. It shapes the seller's
// uplink without a dependency on a rate library.
type egressBucket struct {
	mu     sync.Mutex
	rate   float64
	tokens float64
	last   time.Time
}

func newEgressBucket(bps int64) *egressBucket {
	if bps <= 0 {
		return nil
	}
	return &egressBucket{rate: float64(bps) / 8}
}

func (b *egressBucket) take(ctx context.Context, n int) {
	if b == nil || n <= 0 {
		return
	}
	b.mu.Lock()
	now := time.Now()
	if b.last.IsZero() {
		b.last = now
		b.tokens = b.rate
	}
	b.tokens += now.Sub(b.last).Seconds() * b.rate
	if b.tokens > b.rate {
		b.tokens = b.rate
	}
	b.last = now
	wait := 0.0
	if b.tokens < float64(n) {
		wait = (float64(n) - b.tokens) / b.rate
		b.tokens = 0
	} else {
		b.tokens -= float64(n)
	}
	b.mu.Unlock()
	if wait <= 0 {
		return
	}
	timer := time.NewTimer(time.Duration(wait * float64(time.Second)))
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
	}
}
