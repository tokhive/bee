package bee

import (
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/netip"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func residentialKey() []byte {
	key := make([]byte, beewire.EgressKeyBytes)
	for i := range key {
		key[i] = byte(31 - i)
	}
	return key
}

// echoListener accepts connections and echoes them until closed.
func echoListener(t *testing.T) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	done := make(chan struct{})
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer conn.Close()
				io.Copy(conn, conn)
			}()
		}
	}()
	return listener.Addr().String(), func() {
		close(done)
		listener.Close()
		wg.Wait()
	}
}

func residentialForTest(t *testing.T, target string, allowPrivate bool) (*residential, []byte) {
	t.Helper()
	key := residentialKey()
	plane, err := newResidential(&residentialConfig{
		Enabled:      true,
		HiveKey:      base64.RawURLEncoding.EncodeToString(key),
		Ports:        []int{80},
		MaxStreams:   2,
		AllowPrivate: allowPrivate,
	})
	if err != nil {
		t.Fatal(err)
	}
	plane.seller = "seller-1"
	plane.lookup = func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}
	plane.dial = func(ctx context.Context, network, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, network, target)
	}
	return plane, key
}

func residentialToken(t *testing.T, key []byte, lease beewire.EgressLease) string {
	t.Helper()
	if lease.Version == 0 {
		lease.Version = beewire.EgressLeaseVersion
	}
	if lease.Transport == "" {
		lease.Transport = beewire.EgressRelay
	}
	if lease.Policy == "" {
		lease.Policy = beewire.EgressPolicyV1
	}
	if lease.MaxStreams == 0 {
		lease.MaxStreams = 1
	}
	if lease.ByteCap == 0 {
		lease.ByteCap = 1 << 20
	}
	if lease.Seller == "" {
		lease.Seller = "seller-1"
	}
	if lease.ID == "" {
		lease.ID = "lease-1"
	}
	if lease.JTI == "" {
		lease.JTI = "jti-1"
	}
	if lease.NotBefore == 0 {
		lease.NotBefore = time.Now().Add(-time.Minute).Unix()
	}
	if lease.Expires == 0 {
		lease.Expires = time.Now().Add(time.Hour).Unix()
	}
	token, err := beewire.SignEgressLease(key, lease)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestResidentialEcho(t *testing.T) {
	target, stop := echoListener(t)
	defer stop()
	plane, key := residentialForTest(t, target, true)
	token := residentialToken(t, key, beewire.EgressLease{ID: "echo"})
	server, client := net.Pipe()
	defer client.Close()
	go plane.serve(context.Background(), server, "target.test:80", token)

	if _, err := client.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, 5)
	_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadFull(client, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Fatalf("echo = %q", got)
	}
	plane.mu.Lock()
	used := plane.leases["echo"].used.Load()
	plane.mu.Unlock()
	if used != 10 {
		t.Fatalf("metered bytes = %d, want 10", used)
	}
}

func TestResidentialRejections(t *testing.T) {
	target, stop := echoListener(t)
	defer stop()
	now := time.Now()
	cases := []struct {
		name  string
		host  string
		token func(*testing.T, *residential, []byte) string
	}{
		{"expired", "target.test:80", func(t *testing.T, _ *residential, key []byte) string {
			return residentialToken(t, key, beewire.EgressLease{ID: "expired", NotBefore: now.Add(-2 * time.Hour).Unix(), Expires: now.Add(-time.Hour).Unix()})
		}},
		{"wrong seller", "target.test:80", func(t *testing.T, _ *residential, key []byte) string {
			return residentialToken(t, key, beewire.EgressLease{ID: "seller", Seller: "seller-2"})
		}},
		{"wrong signature", "target.test:80", func(t *testing.T, _ *residential, key []byte) string {
			other := append([]byte(nil), key...)
			other[0] ^= 0xff
			return residentialToken(t, other, beewire.EgressLease{ID: "signature"})
		}},
		{"port", "target.test:8443", func(t *testing.T, _ *residential, key []byte) string {
			return residentialToken(t, key, beewire.EgressLease{ID: "port"})
		}},
		{"literal", "127.0.0.1:80", func(t *testing.T, _ *residential, key []byte) string {
			return residentialToken(t, key, beewire.EgressLease{ID: "literal"})
		}},
		{"blocked destination", "target.test:80", func(t *testing.T, plane *residential, key []byte) string {
			plane.allowPrivate = false
			plane.lookup = func(context.Context, string, string) ([]netip.Addr, error) {
				return []netip.Addr{netip.MustParseAddr("10.0.0.5")}, nil
			}
			return residentialToken(t, key, beewire.EgressLease{ID: "blocked"})
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plane, key := residentialForTest(t, target, true)
			token := tc.token(t, plane, key)
			server, client := net.Pipe()
			defer client.Close()
			go plane.serve(context.Background(), server, tc.host, token)
			_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
			if _, err := client.Read(make([]byte, 1)); err == nil {
				t.Fatal("rejected stream stayed open")
			}
		})
	}
}

func TestResidentialByteCap(t *testing.T) {
	target, stop := echoListener(t)
	defer stop()
	plane, key := residentialForTest(t, target, true)
	token := residentialToken(t, key, beewire.EgressLease{
		ID:      "cap",
		ByteCap: 4,
	})
	server, client := net.Pipe()
	defer client.Close()
	go plane.serve(context.Background(), server, "target.test:80", token)
	_ = client.SetDeadline(time.Now().Add(2 * time.Second))
	_, _ = client.Write([]byte("0123456789"))
	buf := make([]byte, 16)
	_, _ = client.Read(buf)
	plane.mu.Lock()
	used := plane.leases["cap"].used.Load()
	plane.mu.Unlock()
	if used != 4 {
		t.Fatalf("used = %d, want the 4 byte cap", used)
	}
}

func TestResidentialAdmission(t *testing.T) {
	plane, key := residentialForTest(t, "127.0.0.1:9", true)
	token := residentialToken(t, key, beewire.EgressLease{ID: "admit", MaxStreams: 1, ByteCap: 10})
	lease, err := beewire.ParseEgressLease(token, key, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := plane.admit(lease); !ok {
		t.Fatal("first stream refused")
	}
	if _, ok := plane.admit(lease); ok {
		t.Fatal("second stream admitted past MaxStreams")
	}
	plane.release(lease.ID)
	if _, ok := plane.admit(lease); !ok {
		t.Fatal("stream slot not released")
	}
	plane.mu.Lock()
	plane.leases[lease.ID].used.Store(10)
	plane.mu.Unlock()
	if _, ok := plane.admit(lease); ok {
		t.Fatal("exhausted lease admitted")
	}
}

func TestResidentialDomainRules(t *testing.T) {
	plane, err := newResidential(&residentialConfig{
		Enabled: true,
		HiveKey: base64.RawURLEncoding.EncodeToString(residentialKey()),
		Rules: []residentialRule{
			{Suffix: "CN", BPS: 0},
			{Suffix: ".example.cn", BPS: 1000},
			{Suffix: "example.com", BPS: 2000},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		host    string
		bps     int64
		allowed bool
	}{
		{"a.example.cn", 1000, true},
		{"b.cn", 0, false},
		{"example.com", 2000, true},
		{"notexample.com", 0, true},
		{"example.cn.evil.net", 0, true},
	} {
		bps, allowed := plane.rule(test.host)
		if bps != test.bps || allowed != test.allowed {
			t.Fatalf("%q rule = (%d, %v), want (%d, %v)", test.host, bps, allowed, test.bps, test.allowed)
		}
	}
}

func TestResidentialRuleValidation(t *testing.T) {
	for _, rule := range []residentialRule{
		{Suffix: "", BPS: 1000},
		{Suffix: " ", BPS: 1000},
		{Suffix: "a/b", BPS: 0},
		{Suffix: "example.com", BPS: -1},
	} {
		_, err := newResidential(&residentialConfig{
			Enabled: true,
			HiveKey: base64.RawURLEncoding.EncodeToString(residentialKey()),
			Rules:   []residentialRule{rule},
		})
		if err == nil {
			t.Fatalf("accepted rule %+v", rule)
		}
	}
}

func TestResidentialRuleDeniesStream(t *testing.T) {
	plane, key := residentialForTest(t, "127.0.0.1:1", true)
	plane.rules, _ = residentialRules([]residentialRule{{Suffix: "blocked.test", BPS: 0}})
	dialled := false
	plane.dial = func(context.Context, string, string) (net.Conn, error) {
		dialled = true
		return nil, errEgressLease
	}
	client, server := net.Pipe()
	defer client.Close()
	done := make(chan struct{})
	go func() {
		plane.serve(context.Background(), server, "blocked.test:80", residentialToken(t, key, beewire.EgressLease{}))
		close(done)
	}()
	client.SetReadDeadline(time.Now().Add(2 * time.Second))
	if n, err := client.Read(make([]byte, 1)); n != 0 || err == nil {
		t.Fatalf("denied stream read n=%d err=%v", n, err)
	}
	<-done
	if dialled {
		t.Fatal("a denied host was dialled")
	}
}
