// Package beewire carries the control-plane wire types shared by Hive and Bee.
//
// Egress leases are the authorization a buyer's relayed connection carries to
// the seller's Bee. Hive signs one per lease; the Bee verifies it before it
// resolves or dials a target. The token is deliberately self-contained so the
// Bee needs no per-request call to Hive and no database: signature, expiry,
// seller, transport, policy and byte/stream ceilings are all inside it.
package beewire

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

const (
	// EgressLeaseVersion is the only token layout this build understands.
	EgressLeaseVersion = 1

	// EgressPolicyV1 names the target policy both sides enforce: outbound TCP
	// only, ports 80/443, no IP literals, and no private, loopback, link-local,
	// CGNAT or otherwise reserved destination. It is part of the signed token
	// so a Bee with a different policy refuses the lease instead of silently
	// applying a weaker one.
	EgressPolicyV1 = "egress-policy-v1"

	// EgressRelay is a stream carried over the Bee's existing Hive tunnel.
	// EgressDirect is reserved for a later SKU where the buyer reaches the
	// seller's endpoint without Hive in the data path.
	EgressRelay  = "relay"
	EgressDirect = "direct"

	// EgressKeyBytes is the shared HMAC key length. The key is distributed to
	// Hive and the seller's Bee out of band (HIVE_EGRESS_KEY and the Bee's
	// residential.hive_key). It authenticates Hive to the Bee; it is not a
	// buyer credential.
	EgressKeyBytes = 32
)

// EgressLease is the signed authorization for one prepaid lease. Times are
// Unix seconds so the token has one representation on both sides.
type EgressLease struct {
	Version    int    `json:"v"`
	ID         string `json:"lid"`
	JTI        string `json:"jti"`
	Seller     string `json:"sid"`
	Buyer      string `json:"bid,omitempty"`
	IP         string `json:"ip,omitempty"`
	Family     string `json:"fam,omitempty"`
	Transport  string `json:"tr"`
	Policy     string `json:"pol"`
	NotBefore  int64  `json:"nbf"`
	Expires    int64  `json:"exp"`
	ByteCap    int64  `json:"bcap"`
	BPS        int64  `json:"bps,omitempty"`
	MaxStreams int    `json:"ms"`
}

var (
	ErrEgressLeaseMalformed = errors.New("egress lease malformed")
	ErrEgressLeaseSignature = errors.New("egress lease signature invalid")
	ErrEgressLeaseExpired   = errors.New("egress lease expired")
	ErrEgressLeasePolicy    = errors.New("egress lease policy mismatch")
	ErrEgressLeaseTransport = errors.New("egress lease transport mismatch")
	ErrEgressLeaseSeller    = errors.New("egress lease seller mismatch")
)

// SignEgressLease returns payload.signature, both base64url without padding.
// The JSON encoding of a struct is deterministic in Go (fixed field order), so
// Hive and Bee sign identical bytes without a canonicalisation step.
func SignEgressLease(key []byte, lease EgressLease) (string, error) {
	if len(key) != EgressKeyBytes {
		return "", fmt.Errorf("egress key must be %d bytes", EgressKeyBytes)
	}
	if lease.ID == "" || lease.Seller == "" || lease.JTI == "" || lease.MaxStreams < 1 || lease.ByteCap < 1 {
		return "", ErrEgressLeaseMalformed
	}
	payload, err := json.Marshal(lease)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

// ParseEgressLease verifies a token and every invariant the Bee relies on.
// now is passed in so callers and tests share one clock.
func ParseEgressLease(token string, key []byte, now time.Time) (EgressLease, error) {
	if len(key) != EgressKeyBytes {
		return EgressLease{}, fmt.Errorf("egress key must be %d bytes", EgressKeyBytes)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return EgressLease{}, ErrEgressLeaseMalformed
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return EgressLease{}, ErrEgressLeaseMalformed
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(signature) != sha256.Size {
		return EgressLease{}, ErrEgressLeaseMalformed
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return EgressLease{}, ErrEgressLeaseSignature
	}
	var lease EgressLease
	if err := json.Unmarshal(payload, &lease); err != nil {
		return EgressLease{}, ErrEgressLeaseMalformed
	}
	if lease.Version != EgressLeaseVersion || lease.ID == "" || lease.Seller == "" ||
		lease.JTI == "" || lease.ByteCap < 1 || lease.MaxStreams < 1 ||
		lease.Expires <= lease.NotBefore {
		return EgressLease{}, ErrEgressLeaseMalformed
	}
	if lease.Transport != EgressRelay {
		return EgressLease{}, ErrEgressLeaseTransport
	}
	if lease.Policy != EgressPolicyV1 {
		return EgressLease{}, ErrEgressLeasePolicy
	}
	// A small skew allowance keeps a freshly minted token valid on a Bee whose
	// clock is a few seconds behind Hive without extending its real life.
	if lease.NotBefore > now.Add(5*time.Minute).Unix() {
		return EgressLease{}, ErrEgressLeaseMalformed
	}
	if now.Unix() >= lease.Expires {
		return EgressLease{}, ErrEgressLeaseExpired
	}
	return lease, nil
}

// EgressKey decodes a base64 key in any of the usual alphabets and rejects
// anything that is not exactly 32 bytes.
func EgressKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, errors.New("egress key is empty")
	}
	for _, encoding := range []*base64.Encoding{
		base64.RawURLEncoding, base64.URLEncoding,
		base64.RawStdEncoding, base64.StdEncoding,
	} {
		if key, err := encoding.DecodeString(value); err == nil && len(key) == EgressKeyBytes {
			return key, nil
		}
	}
	return nil, fmt.Errorf("egress key must be %d bytes, base64 encoded", EgressKeyBytes)
}

// ParseEgressHostPort splits the authority form a CONNECT request carries and
// enforces a numeric port in range. It does not resolve anything.
func ParseEgressHostPort(value string) (string, int, error) {
	host, portText, err := net.SplitHostPort(strings.TrimSpace(value))
	if err != nil || host == "" || portText == "" {
		return "", 0, ErrEgressLeaseMalformed
	}
	number, err := strconv.Atoi(portText)
	if err != nil || number < 1 || number > 65535 {
		return "", 0, ErrEgressLeaseMalformed
	}
	return strings.ToLower(host), number, nil
}

// NumericEgressHost reports whether host is an IP literal or a bare numeric
// form such as 2130706433, 127.1 or 0x7f000001 that a resolver could still
// turn into an address. Hostnames with a letter are allowed and resolved by
// the Bee, then checked with BlockedEgressAddr.
func NumericEgressHost(host string) bool {
	host = strings.TrimSpace(host)
	if host == "" {
		return true
	}
	if _, err := netip.ParseAddr(host); err == nil {
		return true
	}
	// Hexadecimal IPv4 spellings are resolved by some libc implementations but
	// netip rejects them, so they need the literal check explicitly.
	if strings.HasPrefix(host, "0x") || strings.HasPrefix(host, "0X") {
		return true
	}
	numeric := true
	for _, r := range host {
		if !(r >= '0' && r <= '9' || r == '.' || r == ':') {
			numeric = false
			break
		}
	}
	return numeric
}

// BlockedEgressAddr is the destination policy applied to every resolved
// address. IPv4-mapped IPv6 is unmapped first so ::ffff:10.0.0.1 cannot slip
// past the IPv4 checks.
func BlockedEgressAddr(ip netip.Addr) bool {
	if !ip.IsValid() {
		return true
	}
	ip = ip.Unmap()
	if ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsInterfaceLocalMulticast() {
		return true
	}
	for _, prefix := range blockedEgressPrefixes {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}

var blockedEgressPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),   // carrier-grade NAT
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),    // TEST-NET-1
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking
	netip.MustParsePrefix("198.51.100.0/24"), // TEST-NET-2
	netip.MustParsePrefix("203.0.113.0/24"),  // TEST-NET-3
	netip.MustParsePrefix("240.0.0.0/4"),     // reserved, includes broadcast
	netip.MustParsePrefix("2001:db8::/32"),   // documentation
	netip.MustParsePrefix("2001:2::/48"),     // benchmarking
	netip.MustParsePrefix("64:ff9b::/96"),    // NAT64
}
