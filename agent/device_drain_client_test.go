package bee_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/beewire"
)

func TestDeviceDrainClientPreservesCancellationWithoutExposingTransportSecrets(t *testing.T) {
	client, err := bee.NewDeviceDrainClient(bee.DeviceDrainClientConfig{Origin: "https://hive.example", Credential: "bee_" + strings.Repeat("s", 43), DeviceID: "device-1", OwnerID: "owner-1"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.Capabilities(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation cause lost: %v", err)
	}
	if strings.Contains(err.Error(), "bee_") {
		t.Fatalf("credential exposed: %v", err)
	}
}

func TestDeviceDrainClientQueriesOriginalOperationWithoutReplayingBegin(t *testing.T) {
	id := strings.Repeat("a", 48)
	credential := "bee_" + strings.Repeat("s", 43)
	var calls []string
	var original beewire.DeviceDrainRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer "+credential || r.Header.Get("X-Hive-Request") != "1" {
			t.Error("missing device authentication")
		}
		if r.URL.Path == beewire.DeviceDrainCapabilitiesPath {
			fmt.Fprint(w, `{"version":1,"device_drain":1}`)
			return
		}
		if r.Method == "POST" {
			if err := json.NewDecoder(r.Body).Decode(&original); err != nil {
				t.Error(err)
			}
		}
		json.NewEncoder(w).Encode(beewire.DeviceDrainStatus{Version: 1, DeviceID: "device-1", OwnerID: "owner-1", OperationID: id, State: "draining", Request: &original, Current: beewire.DeviceDrainCurrent{BarrierID: id}})
	}))
	defer server.Close()
	client, err := bee.NewDeviceDrainClient(bee.DeviceDrainClientConfig{Origin: server.URL, Credential: credential, DeviceID: "device-1", OwnerID: "owner-1"})
	if err != nil {
		t.Fatal(err)
	}
	request := beewire.DeviceDrainRequest{ID: id, DeviceID: "device-1", OwnerID: "owner-1", Origin: server.URL}
	if _, err := client.Begin(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	got, err := client.Status(context.Background(), request)
	if err != nil || got.State != "draining" {
		t.Fatalf("query=%+v err=%v", got, err)
	}
	want := "GET /api/bee/device-drain-capabilities|POST /api/bee/device-drains/" + id + "/begin|GET /api/bee/device-drains/" + id
	if strings.Join(calls, "|") != want {
		t.Fatalf("wire calls=%v; want=%s", calls, want)
	}
}

func TestDeviceDrainClientRejectsAbsentMutationAndRevokedCapability(t *testing.T) {
	capability := 1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == beewire.DeviceDrainCapabilitiesPath {
			fmt.Fprintf(w, `{"version":1,"device_drain":%d}`, capability)
			return
		}
		json.NewEncoder(w).Encode(beewire.DeviceDrainStatus{Version: 1, DeviceID: "device-1", OwnerID: "owner-1", OperationID: strings.Repeat("a", 48), State: "absent"})
	}))
	defer server.Close()
	client, err := bee.NewDeviceDrainClient(bee.DeviceDrainClientConfig{Origin: server.URL, Credential: "bee_" + strings.Repeat("s", 43), DeviceID: "device-1", OwnerID: "owner-1"})
	if err != nil {
		t.Fatal(err)
	}
	request := beewire.DeviceDrainRequest{ID: strings.Repeat("a", 48), DeviceID: "device-1", OwnerID: "owner-1", Origin: server.URL}
	if _, err := client.Begin(context.Background(), request); err == nil {
		t.Fatal("absent response accepted as applied begin")
	}
	capability = 0
	if _, err := client.Capabilities(context.Background()); !errors.Is(err, bee.ErrDeviceDrainUnsupported) {
		t.Fatalf("capability zero=%v", err)
	}
	if _, err := client.Begin(context.Background(), request); !errors.Is(err, bee.ErrDeviceDrainUnsupported) {
		t.Fatalf("operation allowed after unsupported capability: %v", err)
	}
}

func TestDeviceDrainClientFailsClosedAtTheHTTPBoundary(t *testing.T) {
	for _, sample := range []struct {
		name            string
		capability      string
		status          int
		body            string
		wantUnsupported bool
	}{
		{"unsupported", `{"version":1,"device_drain":0}`, 200, `{}`, true},
		{"identity_is_not_capability", `{"id":"device-1","owner_id":"owner-1"}`, 200, `{}`, false},
		{"future_version", `{"version":2,"device_drain":1}`, 200, `{}`, false},
		{"duplicate_capability", `{"version":1,"device_drain":1,"device_drain":0}`, 200, `{}`, false},
		{"status_404_is_not_absence", `{"version":1,"device_drain":1}`, 404, `{"error":{"code":"missing","message":"not found"}}`, false},
		{"credential_rejection_is_not_revocation", `{"version":1,"device_drain":1}`, 401, `{"error":{"code":"invalid_device_credential","message":"authorization: Bearer bee_SECRET"}}`, false},
		{"secret_disguised_as_code", `{"version":1,"device_drain":1}`, 403, `{"error":{"code":"bee_` + strings.Repeat("s", 43) + `","message":"rejected"}}`, false},
		{"malformed_status", `{"version":1,"device_drain":1}`, 200, `{"version":1}`, false},
		{"oversize_status", `{"version":1,"device_drain":1}`, 200, strings.Repeat("x", 65537), false},
	} {
		t.Run(sample.name, func(t *testing.T) {
			writes := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					writes++
				}
				if r.URL.Path == beewire.DeviceDrainCapabilitiesPath {
					fmt.Fprint(w, sample.capability)
					return
				}
				w.WriteHeader(sample.status)
				fmt.Fprint(w, sample.body)
			}))
			defer server.Close()
			client, err := bee.NewDeviceDrainClient(bee.DeviceDrainClientConfig{Origin: server.URL, Credential: "bee_" + strings.Repeat("s", 43), DeviceID: "device-1", OwnerID: "owner-1"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.Status(context.Background(), beewire.DeviceDrainRequest{ID: strings.Repeat("a", 48), DeviceID: "device-1", OwnerID: "owner-1", Origin: server.URL})
			if err == nil || errors.Is(err, bee.ErrDeviceDrainUnsupported) != sample.wantUnsupported {
				t.Fatalf("failure=%v; unsupported=%t", err, sample.wantUnsupported)
			}
			if writes != 0 {
				t.Fatalf("read-only query performed %d writes", writes)
			}
			if strings.Contains(err.Error(), "bee_") {
				t.Fatalf("credential exposed: %v", err)
			}
			if sample.status == 401 {
				var failure *bee.DeviceDrainHTTPError
				if !errors.As(err, &failure) || failure.Code != "invalid_device_credential" || !strings.Contains(err.Error(), "401") {
					t.Fatalf("lost API evidence: %v", err)
				}
			}
		})
	}
}

func TestDeviceDrainClientReturnsPendingSealThenRecoversOriginalActionsByStatus(t *testing.T) {
	var request beewire.DeviceDrainRequest
	var seal beewire.DeviceDrainSealRequest
	var release beewire.DeviceDrainReleaseRequest
	var state = "absent"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == beewire.DeviceDrainCapabilitiesPath {
			fmt.Fprint(w, `{"version":1,"device_drain":1}`)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/seal") {
			json.NewDecoder(r.Body).Decode(&seal)
			request = seal.Request
			state = "sealing"
		}
		if strings.HasSuffix(r.URL.Path, "/release") {
			json.NewDecoder(r.Body).Decode(&release)
			state = "released"
		}
		result := beewire.DeviceDrainStatus{Version: 1, DeviceID: "device-1", OwnerID: "owner-1", OperationID: request.ID, State: state, Request: &request, Seal: &seal, Current: beewire.DeviceDrainCurrent{BarrierID: request.ID}}
		if state == "sealed" || state == "released" {
			result.Receipt = &beewire.DeviceDrainReceipt{Version: 1, Seal: seal, Epoch: seal.ID, ConnectionRetired: true}
		}
		if state == "released" {
			result.Release = &release
			result.Current.Epoch = seal.ID
			result.Current.BarrierID = ""
		}
		json.NewEncoder(w).Encode(result)
	}))
	defer server.Close()
	client, err := bee.NewDeviceDrainClient(bee.DeviceDrainClientConfig{Origin: server.URL, Credential: "bee_" + strings.Repeat("s", 43), DeviceID: "device-1", OwnerID: "owner-1"})
	if err != nil {
		t.Fatal(err)
	}
	request = beewire.DeviceDrainRequest{ID: strings.Repeat("a", 48), DeviceID: "device-1", OwnerID: "owner-1", Origin: server.URL}
	seal = beewire.DeviceDrainSealRequest{ID: strings.Repeat("b", 48), Request: request}
	pending, err := client.Seal(context.Background(), seal)
	if err != nil || pending.State != "sealing" || pending.Receipt != nil {
		t.Fatalf("pending=%+v err=%v", pending, err)
	}
	state = "sealed"
	sealed, err := client.Status(context.Background(), request)
	if err != nil || sealed.Receipt == nil || *sealed.Seal != seal {
		t.Fatalf("lost seal not recovered: %+v %v", sealed, err)
	}
	release = beewire.DeviceDrainReleaseRequest{ID: strings.Repeat("c", 48), Request: request, Mode: "activate", ExpectedEpoch: seal.ID, ExpectedLease: "new-lease"}
	done, err := client.Release(context.Background(), release)
	if err != nil || done.State != "released" {
		t.Fatalf("release=%+v err=%v", done, err)
	}
	got, err := client.Status(context.Background(), request)
	if err != nil || *got.Release != release || got.Receipt.Epoch != seal.ID {
		t.Fatalf("lost release not recovered: %+v %v", got, err)
	}
}
