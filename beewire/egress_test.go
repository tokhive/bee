package beewire

import (
	"errors"
	"net/netip"
	"testing"
	"time"
)

func testEgressKey() []byte {
	key := make([]byte, EgressKeyBytes)
	for i := range key {
		key[i] = byte(i + 7)
	}
	return key
}

func testLease(now time.Time) EgressLease {
	return EgressLease{
		Version:    EgressLeaseVersion,
		ID:         "lease-1",
		JTI:        "jti-1",
		Seller:     "provider-1",
		Buyer:      "buyer-1",
		Transport:  EgressRelay,
		Policy:     EgressPolicyV1,
		NotBefore:  now.Unix(),
		Expires:    now.Add(time.Hour).Unix(),
		ByteCap:    1 << 20,
		BPS:        20_000_000,
		MaxStreams: 4,
	}
}

func TestEgressLeaseRoundTrip(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	key := testEgressKey()
	want := testLease(now)
	token, err := SignEgressLease(key, want)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseEgressLease(token, key, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("lease round trip = %+v, want %+v", got, want)
	}
}

func TestEgressLeaseRejectsTampering(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	key := testEgressKey()
	token, err := SignEgressLease(key, testLease(now))
	if err != nil {
		t.Fatal(err)
	}
	tampered := token[:len(token)-1]
	if token[len(token)-1] == 'A' {
		tampered += "B"
	} else {
		tampered += "A"
	}
	if _, err := ParseEgressLease(tampered, key, now); !errors.Is(err, ErrEgressLeaseSignature) {
		t.Fatalf("tampered token error = %v, want signature", err)
	}
	other := testEgressKey()
	other[0]++
	if _, err := ParseEgressLease(token, other, now); !errors.Is(err, ErrEgressLeaseSignature) {
		t.Fatalf("wrong key error = %v, want signature", err)
	}
}

func TestEgressLeaseLifecycleChecks(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	key := testEgressKey()
	lease := testLease(now)
	token, err := SignEgressLease(key, lease)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseEgressLease(token, key, time.Unix(lease.Expires, 0)); !errors.Is(err, ErrEgressLeaseExpired) {
		t.Fatalf("expired error = %v, want expired", err)
	}
	other := lease
	other.Transport = EgressDirect
	other.ID = "lease-2"
	direct, _ := SignEgressLease(key, other)
	if _, err := ParseEgressLease(direct, key, now); !errors.Is(err, ErrEgressLeaseTransport) {
		t.Fatalf("direct transport error = %v, want transport", err)
	}
	old := lease
	old.Policy = "egress-policy-v0"
	old.ID = "lease-3"
	mismatch, _ := SignEgressLease(key, old)
	if _, err := ParseEgressLease(mismatch, key, now); !errors.Is(err, ErrEgressLeasePolicy) {
		t.Fatalf("policy error = %v, want policy", err)
	}
	bad := lease
	bad.MaxStreams = 0
	if _, err := SignEgressLease(key, bad); !errors.Is(err, ErrEgressLeaseMalformed) {
		t.Fatalf("unsigned malformed lease error = %v, want malformed", err)
	}
}

func TestEgressKeyDecoding(t *testing.T) {
	key := testEgressKey()
	for _, value := range []string{
		base64RawURL(key), base64Std(key),
	} {
		got, err := EgressKey(value)
		if err != nil || string(got) != string(key) {
			t.Fatalf("EgressKey(%q) = %x, %v", value, got, err)
		}
	}
	if _, err := EgressKey("short"); err == nil {
		t.Fatal("short key accepted")
	}
}

func base64RawURL(key []byte) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	return encodeBase64(key, alphabet, false)
}

func base64Std(key []byte) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	return encodeBase64(key, alphabet, true)
}

func encodeBase64(src []byte, alphabet string, padding bool) string {
	out := make([]byte, 0, (len(src)+2)/3*4)
	for i := 0; i < len(src); i += 3 {
		var chunk [3]byte
		n := copy(chunk[:], src[i:])
		out = append(out, alphabet[chunk[0]>>2])
		out = append(out, alphabet[(chunk[0]&0x03)<<4|chunk[1]>>4])
		if n > 1 {
			out = append(out, alphabet[(chunk[1]&0x0f)<<2|chunk[2]>>6])
		} else if padding {
			out = append(out, '=')
		}
		if n > 2 {
			out = append(out, alphabet[chunk[2]&0x3f])
		} else if padding {
			out = append(out, '=')
		}
	}
	return string(out)
}

func TestBlockedEgressAddr(t *testing.T) {
	blocked := []string{
		"0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.1.1", "100.64.0.1",
		"192.0.2.10", "198.18.0.1", "203.0.113.9", "224.0.0.1", "255.255.255.255",
		"::1", "::", "fe80::1", "fc00::1", "2001:db8::1", "::ffff:10.0.0.1",
		"64:ff9b::7f00:1",
	}
	for _, text := range blocked {
		if !BlockedEgressAddr(netip.MustParseAddr(text)) {
			t.Errorf("%s allowed", text)
		}
	}
	for _, text := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"} {
		if BlockedEgressAddr(netip.MustParseAddr(text)) {
			t.Errorf("%s blocked", text)
		}
	}
}

func TestNumericEgressHost(t *testing.T) {
	for _, host := range []string{"1.2.3.4", "127.1", "2130706433", "0x7f000001", "::1", "123"} {
		if !NumericEgressHost(host) {
			t.Errorf("%q not treated as numeric", host)
		}
	}
	for _, host := range []string{"example.com", "api.example.com", "a1.example"} {
		if NumericEgressHost(host) {
			t.Errorf("%q treated as numeric", host)
		}
	}
}

func TestParseEgressHostPort(t *testing.T) {
	host, port, err := ParseEgressHostPort("Example.COM:443")
	if err != nil || host != "example.com" || port != 443 {
		t.Fatalf("parse = %q, %d, %v", host, port, err)
	}
	for _, value := range []string{"example.com", "example.com:0", "example.com:70000", ":443", "[::1]"} {
		if _, _, err := ParseEgressHostPort(value); err == nil {
			t.Errorf("%q accepted", value)
		}
	}
}
