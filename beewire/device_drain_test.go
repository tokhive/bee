package beewire_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

func drainRequest() beewire.DeviceDrainRequest {
	return beewire.DeviceDrainRequest{ID: strings.Repeat("a", 48), DeviceID: "device-1", OwnerID: "owner-1", Origin: "https://HIVE.example:443", ExpectedEpoch: "", ExpectedLease: ""}
}
func TestDeviceDrainRequestPreservesRawOriginAndRejectsAmbiguousJSON(t *testing.T) {
	request := drainRequest()
	raw, _ := json.Marshal(request)
	got, err := beewire.DecodeDeviceDrainRequest(raw)
	if err != nil || got != request {
		t.Fatalf("original request changed: got=%+v error=%v", got, err)
	}
	for _, bad := range []string{
		strings.Replace(string(raw), `"expected_epoch":"",`, "", 1),
		strings.Replace(string(raw), `"expected_epoch":""`, `"expected_epoch":null`, 1),
		strings.Replace(string(raw), `"id":`, `"id":"`+request.ID+`","id":`, 1),
		strings.TrimSuffix(string(raw), "}") + `,"credential":"bee_SECRET"}`,
		string(raw) + ` {}`, `null`, strings.Repeat(" ", 65537),
	} {
		if _, err := beewire.DecodeDeviceDrainRequest([]byte(bad)); err == nil {
			t.Errorf("accepted ambiguous request: %s", bad)
		} else if strings.Contains(err.Error(), "bee_SECRET") {
			t.Fatalf("secret leaked: %v", err)
		}
	}
}

func TestDeviceDrainStatusDistinguishesAbsencePendingSealAndCancelTombstone(t *testing.T) {
	request := drainRequest()
	status := beewire.DeviceDrainStatus{Version: 1, DeviceID: request.DeviceID, OwnerID: request.OwnerID, OperationID: request.ID, State: "absent", Current: beewire.DeviceDrainCurrent{}}
	decode := func(status beewire.DeviceDrainStatus) error {
		raw, _ := json.Marshal(status)
		got, err := beewire.DecodeDeviceDrainStatus(raw)
		if err != nil {
			return err
		}
		return got.ValidateFor(request)
	}
	if err := decode(status); err != nil {
		t.Fatal(err)
	}
	status.State = "released"
	if err := decode(status); err == nil {
		t.Fatal("absence accepted as completed cancellation")
	}
	release := beewire.DeviceDrainReleaseRequest{ID: strings.Repeat("c", 48), Request: request, Mode: "cancel", ExpectedEpoch: "", ExpectedLease: ""}
	status.Request = &request
	status.Release = &release
	if err := decode(status); err != nil {
		t.Fatalf("cancel-before-begin tombstone rejected: %v", err)
	}
	status.Release = nil
	status.State = "sealing"
	status.Current.BarrierID = request.ID
	seal := beewire.DeviceDrainSealRequest{ID: strings.Repeat("b", 48), Request: request}
	status.Seal = &seal
	if err := decode(status); err != nil {
		t.Fatalf("pending seal rejected: %v", err)
	}
	status.State = "sealed"
	if err := decode(status); err == nil {
		t.Fatal("pending seal accepted as complete without receipt")
	}
}

func TestDeviceDrainHistoricalSealReceiptIsIndependentOfCurrentDeviceFacts(t *testing.T) {
	request := drainRequest()
	seal := beewire.DeviceDrainSealRequest{ID: strings.Repeat("b", 48), Request: request}
	release := beewire.DeviceDrainReleaseRequest{ID: strings.Repeat("c", 48), Request: request, Mode: "activate", ExpectedEpoch: seal.ID, ExpectedLease: "new-lease"}
	receipt := beewire.DeviceDrainReceipt{Version: 1, Seal: seal, Epoch: seal.ID, ConnectionRetired: true, Work: beewire.DeviceDrainWork{}}
	status := beewire.DeviceDrainStatus{Version: 1, DeviceID: request.DeviceID, OwnerID: request.OwnerID, OperationID: request.ID, State: "released", Request: &request, Seal: &seal, Release: &release, Receipt: &receipt, Current: beewire.DeviceDrainCurrent{Epoch: strings.Repeat("d", 48), Lease: "later-lease", BarrierID: strings.Repeat("e", 48), Work: &beewire.DeviceDrainWork{Executions: 3}}}
	raw, _ := json.Marshal(status)
	got, err := beewire.DecodeDeviceDrainStatus(raw)
	if err != nil || got.ValidateFor(request) != nil {
		t.Fatalf("historical receipt rejected: %v", err)
	}
	if got.Receipt.Epoch != seal.ID || got.Current.Epoch == got.Receipt.Epoch || got.Current.Work.Executions != 3 {
		t.Fatalf("historical and current facts conflated: %+v", got)
	}
	conflicting := request
	conflicting.Origin = "https://hive.example"
	if err := got.ValidateFor(conflicting); err == nil {
		t.Fatal("same ID with altered original raw origin accepted")
	}
	got.Receipt.Work.Unsettled = 1
	if err := got.ValidateFor(request); err == nil {
		t.Fatal("unfinished receipt accepted as sealed")
	}
}

func TestDeviceDrainReadyRequiresKnownZeroWorkAndTheOriginalBarrier(t *testing.T) {
	request := drainRequest()
	status := beewire.DeviceDrainStatus{Version: 1, DeviceID: request.DeviceID, OwnerID: request.OwnerID, OperationID: request.ID, State: "ready", Request: &request, Current: beewire.DeviceDrainCurrent{BarrierID: request.ID}}
	if err := status.ValidateFor(request); err == nil {
		t.Fatal("unknown counts treated as ready")
	}
	status.Current.Work = &beewire.DeviceDrainWork{}
	if err := status.ValidateFor(request); err != nil {
		t.Fatal(err)
	}
	status.Current.Work.UnknownTerminations = 1
	if err := status.ValidateFor(request); err == nil {
		t.Fatal("upstream execution still unknown but ready accepted")
	}
	status.Current.Work.UnknownTerminations = 0
	status.Current.BarrierID = strings.Repeat("f", 48)
	if err := status.ValidateFor(request); err == nil {
		t.Fatal("another operation barrier accepted")
	}
}

func TestDeviceDrainActivationRequiresANewVerifiedConnectionLease(t *testing.T) {
	request := drainRequest()
	request.ExpectedLease = "old-lease"
	release := beewire.DeviceDrainReleaseRequest{ID: strings.Repeat("c", 48), Request: request, Mode: "activate", ExpectedEpoch: strings.Repeat("b", 48)}
	if err := release.Validate(); err == nil {
		t.Fatal("activation without verified connection lease accepted")
	}
	release.ExpectedLease = "old-lease"
	if err := release.Validate(); err == nil {
		t.Fatal("activation with retired connection lease accepted")
	}
	release.ExpectedLease = "new-lease"
	if err := release.Validate(); err != nil {
		t.Fatal(err)
	}
}
