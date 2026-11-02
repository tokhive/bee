package bee

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/coder/websocket"
	"github.com/tokhive/bee/relay"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func TestDesktopConnectionSnapshotRequiresNullableDetail(t *testing.T) {
	r := NewDesktopRuntime(context.Background(), &DesktopDevice{}, NewDesktopAccounts(nil))
	defer r.Close()
	s, err := r.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(s)
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	if value, ok := fields["connection_detail"]; !ok || string(value) != "null" {
		t.Fatalf("runtime connection_detail must be present and null before observation; actual=%s", raw)
	}
}

func TestDesktopConnectionFailureClassification(t *testing.T) {
	for _, tc := range []struct {
		name        string
		err         error
		stage, code string
	}{
		{"DNS", &net.DNSError{Err: "no such host", Name: "hive.test"}, "connect", "dns_failed"},
		{"TLS", &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}, "connect", "tls_failed"},
		{"refused", &net.OpError{Op: "dial", Net: "tcp", Err: syscall.ECONNREFUSED}, "connect", "connection_refused"},
		{"timeout", fmt.Errorf("handshake: %w", context.DeadlineExceeded), "connect", "timeout"},
		{"heartbeat stalled", relay.ErrStalled, "heartbeat", "timeout"},
		{"heartbeat closed", io.EOF, "heartbeat", "connection_closed"},
		{"no cause", nil, "heartbeat", "connection_closed"},
		{"sync", errors.New("authorization fingerprint changed"), "synchronize", "synchronization_failed"},
		{"sync DNS", &net.DNSError{Err: "lookup failed", Name: "hive.test"}, "synchronize", "dns_failed"},
		{"text not classification", errors.New("DNS TLS timeout connection refused"), "connect", "unknown_failure"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := observedConnectionFailure(tc.err, nil, localState{Hive: "https://hive.test"}, "/api/bee/agent", tc.stage)
			if f.Code != tc.code || f.Stage != tc.stage || f.Message == "" || f.OccurredAt == "" {
				t.Fatalf("failure=%+v expected=%s", f, tc.code)
			}
			if tc.err != nil && !strings.Contains(f.Message, tc.err.Error()) {
				t.Fatalf("safe original cause lost: %+v", f)
			}
		})
	}
}
func TestDesktopConnectionHTTPObservations(t *testing.T) {
	for _, status := range []int{200, 401, 403, 409, 503} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			var requests atomic.Int32
			hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.WriteHeader(status)
				io.WriteString(w, `{"error":{"code":"device_replaced","token":"TOPSECRET"}}`)
			}))
			defer hive.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			var observations []DesktopConnectionObservation
			err := connectObserved(ctx, localState{Hive: hive.URL, Credential: "TOPSECRET"}, nil, io.Discard, func(o DesktopConnectionObservation) {
				observations = append(observations, o)
				if o.Detail.Retry == "scheduled" {
					cancel()
				}
			})
			last := observations[len(observations)-1]
			if last.Detail.Failure == nil || last.Detail.Failure.Evidence["http_status"] != strconv.Itoa(status) || last.Detail.Failure.Evidence["remote_code"] != "device_replaced" {
				t.Fatalf("actual rejection evidence lost: %+v", last)
			}
			raw, _ := json.Marshal(observations)
			var decoded DesktopConnectionDetail
			detailRaw, _ := json.Marshal(last.Detail)
			if e := json.Unmarshal(detailRaw, &decoded); e != nil {
				t.Fatalf("real handshake rejection cannot cross contract: status=%d error=%v", status, e)
			}
			if strings.Contains(string(raw), "TOPSECRET") {
				t.Fatalf("secret leaked: %s", raw)
			}
			if status == 401 || status == 403 {
				if last.Connection != "rejected" || last.Detail.Retry != "halted" || last.Detail.NextRetryAt != nil || requests.Load() != 2 {
					t.Fatalf("auth rejection retried: %s requests=%d err=%v", raw, requests.Load(), err)
				}
			} else if status == 409 {
				if last.Connection != "occupied" || last.Detail.Failure.Code != "ownership_unconfirmed" || requests.Load() != 1 {
					t.Fatalf("ownership retry: %s requests=%d", raw, requests.Load())
				}
			} else {
				if last.Detail.Retry != "scheduled" || last.Detail.NextRetryAt == nil || requests.Load() != 1 {
					t.Fatalf("no real retry: %s", raw)
				}
				next, e := time.Parse(time.RFC3339Nano, *last.Detail.NextRetryAt)
				if e != nil || time.Until(next) > time.Second || time.Until(next) < 500*time.Millisecond {
					t.Fatalf("retry time differs from initial timer: %v", next)
				}
			}
		})
	}
}
func TestDesktopConnectionSafeEvidence(t *testing.T) {
	err := &url.Error{Op: "Get", URL: "https://user:URLSECRET@hive.test/path?token=QUERYSECRET", Err: fmt.Errorf(`Bearer BEARERSECRET credential=TOPSECRET {"token":"QUOTEDSECRET"} password='PASSWORDSECRET': %w`, syscall.ECONNREFUSED)}
	f := observedConnectionFailure(err, nil, localState{Hive: "https://hive.test", Credential: "TOPSECRET"}, "/api/bee/agent", "connect")
	raw, _ := json.Marshal(f)
	for _, secret := range []string{"URLSECRET", "QUERYSECRET", "BEARERSECRET", "TOPSECRET", "QUOTEDSECRET", "PASSWORDSECRET"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("secret leaked: %s", raw)
		}
	}
	if f.Code != "connection_refused" || !strings.Contains(f.Message, "connection refused") {
		t.Fatalf("safe cause lost: %+v", f)
	}
}
func TestDesktopConnectionRuntimeFencesOldAndStoppingObservations(t *testing.T) {
	run := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	r := NewDesktopRuntime(context.Background(), &DesktopDevice{}, NewDesktopAccounts(nil))
	defer r.Close()
	r.snapshot.RunID = &run
	r.snapshot.Local = "running"
	r.snapshot.Operation = &DesktopOperation{}
	failure := observedConnectionFailure(io.EOF, nil, localState{Hive: "https://hive.test"}, "/api/bee/agent", "heartbeat")
	failed := DesktopConnectionObservation{Connection: "reconnecting", Detail: &DesktopConnectionDetail{Failure: failure, Retry: "attempting"}}
	r.connectionObserved(run, DesktopConnectionObservation{Connection: "connected", Detail: &DesktopConnectionDetail{Retry: "idle"}})
	revisionB := r.snapshot.Revision
	r.connectionObserved("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", DesktopConnectionObservation{Connection: "rejected", Detail: failed.Detail})
	if r.snapshot.Connection != "connected" || r.snapshot.ConnectionDetail.Failure != nil || r.snapshot.Revision != revisionB {
		t.Fatal("late run A rejection polluted connected run B")
	}
	r.connectionObserved(run, failed)
	if r.snapshot.ConnectionDetail.Failure != failure || r.snapshot.Local != "running" {
		t.Fatalf("failure missing or local changed: %+v", r.snapshot)
	}
	r.connectionObserved(run, DesktopConnectionObservation{Connection: "connected", Detail: &DesktopConnectionDetail{Retry: "idle"}})
	if r.snapshot.ConnectionDetail.Failure != nil {
		t.Fatal("recovery retained error")
	}
	r.snapshot.Local = "stopping"
	revision := r.snapshot.Revision
	r.connectionObserved(run, failed)
	if r.snapshot.Revision != revision || r.snapshot.ConnectionDetail.Failure != nil {
		t.Fatal("stopping accepted old callback")
	}
}

func TestDesktopConnectionTransportFailuresReachObserver(t *testing.T) {
	for _, tc := range []struct {
		name, code string
		err        error
	}{
		{"DNS", "dns_failed", &net.DNSError{Name: "hive.test", Err: "no such host"}},
		{"TLS", "tls_failed", &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}},
		{"refused", "connection_refused", &net.OpError{Op: "dial", Net: "tcp", Err: syscall.ECONNREFUSED}},
		{"timeout", "timeout", context.DeadlineExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			saved := http.DefaultTransport
			defer func() { http.DefaultTransport = saved }()
			http.DefaultTransport = claudeTransport(func(*http.Request) (*http.Response, error) { return nil, tc.err })
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var last DesktopConnectionObservation
			err := connectObserved(ctx, localState{Hive: "https://hive.test"}, nil, io.Discard, func(o DesktopConnectionObservation) {
				last = o
				if o.Detail.Retry == "scheduled" {
					cancel()
				}
			})
			if err != nil || last.Detail.Failure.Code != tc.code || last.Detail.Failure.Stage != "connect" {
				t.Fatalf("typed dial failure lost: %+v err=%v", last, err)
			}
			requestErr := call(context.Background(), httpClient(), "https://hive.test", "/api/bee/credentials", "GET", "", nil, nil)
			if !errors.Is(requestErr, tc.err) {
				t.Fatalf("HTTP cause lost: %v", requestErr)
			}
			failure := observedConnectionFailure(requestErr, nil, localState{Hive: "https://hive.test"}, "/api/bee/agent", "synchronize")
			if failure.Code != tc.code || failure.Evidence["path"] != "/api/bee/credentials" {
				t.Fatalf("sync HTTP evidence lost: %+v", failure)
			}
		})
	}
}
func TestDesktopConnectionRetryRetainsFailureUntilRecovery(t *testing.T) {
	var calls atomic.Int32
	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(503)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		<-r.Context().Done()
	}))
	defer hive.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var observations []DesktopConnectionObservation
	err := connectObserved(ctx, localState{Hive: hive.URL}, nil, io.Discard, func(o DesktopConnectionObservation) {
		observations = append(observations, o)
		if o.Connection == "connected" {
			cancel()
		}
	})
	if err != nil || len(observations) != 4 {
		t.Fatalf("attempts=%d err=%v", len(observations), err)
	}
	if observations[0].Detail.Failure != nil || observations[1].Detail.Retry != "scheduled" || observations[2].Detail.Retry != "attempting" || observations[2].Detail.NextRetryAt != nil || observations[1].Detail.Failure != observations[2].Detail.Failure || observations[3].Detail.Failure != nil {
		t.Fatalf("failure retention differs: %+v", observations)
	}
}
func TestDesktopConnectionHeartbeatAndSynchronizationStages(t *testing.T) {
	for _, syncFailure := range []bool{false, true} {
		t.Run(fmt.Sprint(syncFailure), func(t *testing.T) {
			hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := websocket.Accept(w, r, nil)
				if err != nil {
					return
				}
				defer conn.CloseNow()
				if !syncFailure {
					return
				}
				<-conn.CloseRead(r.Context()).Done()
			}))
			defer hive.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			var cfg *egressConfig
			if syncFailure {
				cfg = &egressConfig{Targets: []string{}, desktopAction: func(context.Context, localState, string, io.Writer) (<-chan error, func()) {
					ch := make(chan error, 1)
					ch <- fmt.Errorf("authorization sync: %w", errInboxIdentity)
					return ch, func() {}
				}}
			}
			var last DesktopConnectionObservation
			err := connectObserved(ctx, localState{Hive: hive.URL}, cfg, io.Discard, func(o DesktopConnectionObservation) {
				last = o
				if o.Detail.Retry == "scheduled" {
					cancel()
				}
			})
			if last.Detail.Failure == nil {
				t.Fatalf("no observed failure: %+v err=%v", last, err)
			}
			if syncFailure {
				if err == nil || last.Detail.Failure.Stage != "synchronize" || last.Detail.Failure.Code != "synchronization_failed" || last.Detail.Retry != "halted" {
					t.Fatalf("sync failure lost: %+v err=%v", last, err)
				}
			} else if err != nil || last.Detail.Failure.Stage != "heartbeat" || last.Detail.Retry != "scheduled" {
				t.Fatalf("heartbeat failure lost: %+v err=%v", last, err)
			}
		})
	}
}
func TestDesktopConnectionCanceledHandshakeDoesNotRaiseAlarm(t *testing.T) {
	started := make(chan struct{})
	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done() }))
	defer hive.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { <-started; cancel() }()
	var observations []DesktopConnectionObservation
	if err := connectObserved(ctx, localState{Hive: hive.URL}, nil, io.Discard, func(o DesktopConnectionObservation) { observations = append(observations, o) }); err != nil {
		t.Fatal(err)
	}
	if len(observations) != 1 || observations[0].Detail.Failure != nil {
		t.Fatalf("stop created failure: %+v", observations)
	}
}

func TestDesktopConnectionSynchronizationObservationIsScoped(t *testing.T) {
	run := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	r := NewDesktopRuntime(context.Background(), &DesktopDevice{}, NewDesktopAccounts(nil))
	defer r.Close()
	r.snapshot.RunID = &run
	r.snapshot.Local = "running"
	r.snapshot.Connection = "connected"
	live, cancel := context.WithCancel(context.Background())
	defer cancel()
	current := &desktopRuntimeConnection{ctx: live, active: true, state: localState{Hive: "https://hive.test"}}
	r.connection = current
	r.snapshot.Platforms["claude"] = DesktopRuntimePlatform{Supply: &DesktopSupply{Ready: true}}
	r.synchronizationObserved(current, &run, errors.New("openai authorization readback differs"))
	if r.snapshot.ConnectionDetail == nil || r.snapshot.ConnectionDetail.Failure.Stage != "synchronize" || r.snapshot.ConnectionDetail.Retry != "idle" || r.snapshot.Connection != "connected" || r.snapshot.Platforms["claude"].Supply == nil {
		t.Fatalf("sync failure misrepresented link/other platform: %+v", r.snapshot)
	}
	first := r.snapshot.ConnectionDetail
	r.synchronizationObserved(current, &run, nil)
	if r.snapshot.ConnectionDetail != first {
		t.Fatal("another platform's success cleared unproved recovery")
	}
	oldRun := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	r.synchronizationObserved(current, &oldRun, errors.New("late run A rejection"))
	if r.snapshot.ConnectionDetail != first {
		t.Fatal("old run failure replaced current failure")
	}
	old := &desktopRuntimeConnection{ctx: live, active: true, state: current.state}
	r.synchronizationObserved(old, &run, errors.New("late connection A rejection"))
	if r.snapshot.ConnectionDetail != first {
		t.Fatal("old connection replaced current failure")
	}
	r.snapshot.Local = "stopping"
	r.synchronizationObserved(current, &run, errors.New("late stop failure"))
	if r.snapshot.ConnectionDetail != first {
		t.Fatal("stopping accepted sync failure")
	}
}

func TestDesktopConnectionStrictDetailDecoding(t *testing.T) {
	for _, raw := range []string{
		`{"failure":{"code":"dns_failed","stage":"connect","occurred_at":"2026-10-26T00:00:00Z","message":"failed","evidence":{"response_body":null}},"retry":"halted","next_retry_at":null}`,
		`{}`, `{"failure":null,"retry":"idle"}`, `{"failure":null,"retry":"scheduled","next_retry_at":null}`,
		`{"failure":null,"retry":"idle","next_retry_at":"2026-10-26T00:00:00Z"}`,
		`{"failure":null,"retry":"waiting","next_retry_at":null}`,
		`{"failure":null,"retry":"idle","next_retry_at":null,"extra":true}`,
		`{"failure":{"code":"guessed","stage":"connect","occurred_at":"2026-10-26T00:00:00Z","message":"failed","evidence":{}},"retry":"halted","next_retry_at":null}`,
		`{"failure":{"code":"dns_failed","stage":"proxy","occurred_at":"2026-10-26T00:00:00Z","message":"failed","evidence":{}},"retry":"halted","next_retry_at":null}`,
		`{"failure":{"code":"dns_failed","stage":"connect","occurred_at":"2026-02-30T00:00:00Z","message":"failed","evidence":{}},"retry":"halted","next_retry_at":null}`,
		`{"failure":{"code":"dns_failed","stage":"connect","occurred_at":"2026-10-26T00:00:00Z","message":"failed","evidence":{"authorization":"secret"}},"retry":"halted","next_retry_at":null}`,
		`{"failure":{"code":"dns_failed","stage":"connect","occurred_at":"2026-10-26T00:00:00Z","message":"failed","evidence":{"target_origin":"https://user:secret@hive.test/"}},"retry":"halted","next_retry_at":null}`,
	} {
		var detail DesktopConnectionDetail
		if err := json.Unmarshal([]byte(raw), &detail); err == nil {
			t.Fatalf("unsafe or contradictory detail accepted: %s", raw)
		}
	}
}

func TestDesktopConnectionSnapshotDecodingRequiresExplicitDetail(t *testing.T) {
	raw := `{"run_id":null,"revision":0,"network_revision":0,"observed_at":"2026-10-26T00:00:00Z","local":"stopped","connection":"disconnected","platforms":{},"operation":null,"stop_receipt":null}`
	var snapshot DesktopRuntimeSnapshot
	if err := json.Unmarshal([]byte(raw), &snapshot); err == nil {
		t.Fatal("missing connection_detail accepted")
	}
}
func TestDesktopConnectionSharedRequestErrorIsSafe(t *testing.T) {
	saved := http.DefaultTransport
	defer func() { http.DefaultTransport = saved }()
	http.DefaultTransport = claudeTransport(func(*http.Request) (*http.Response, error) {
		return nil, &url.Error{Op: "proxyconnect", URL: "http://user:PROXYSECRET@127.0.0.1:7890/?secret=QUERYSECRET", Err: errors.New("request credential=DEVICESECRET denied")}
	})
	err := call(context.Background(), httpClient(), "https://hive.test", "/api/bee/credentials", "GET", "DEVICESECRET", nil, nil)
	if err == nil {
		t.Fatal("transport accepted")
	}
	for _, secret := range []string{"PROXYSECRET", "QUERYSECRET", "DEVICESECRET"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("shared request error leaked %s", secret)
		}
	}
}

func TestDesktopConnectionMalformedUpgradeKeepsConnectStage(t *testing.T) {
	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusSwitchingProtocols) }))
	defer hive.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var last DesktopConnectionObservation
	err := connectObserved(ctx, localState{Hive: hive.URL}, nil, io.Discard, func(o DesktopConnectionObservation) {
		last = o
		if o.Detail.Retry == "scheduled" {
			cancel()
		}
	})
	if err != nil || last.Detail.Failure == nil || last.Detail.Failure.Stage != "connect" || last.Detail.Failure.Code != "http_rejected" || last.Detail.Failure.Evidence["http_status"] != "101" {
		t.Fatalf("malformed handshake misclassified: %+v err=%v", last.Detail.Failure, err)
	}
}
