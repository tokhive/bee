package desktopbridge_test

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

type codexLoginFixture struct {
	authorizeFixture
	reads, opens int
}

func (f *codexLoginFixture) Progress(_ context.Context, id string) (bee.DesktopLoginProgress, error) {
	f.reads++
	p := "openai"
	return bee.DesktopLoginProgress{Operation: bee.DesktopOperation{ID: id, Kind: "authorize", Platform: &p, State: "running"}, Phase: "waiting_authorization", Actions: bee.DesktopLoginActions{Open: true, Cancel: true}}, nil
}
func (f *codexLoginFixture) Open(ctx context.Context, id string) (bee.DesktopLoginOpenReceipt, error) {
	f.opens++
	p, e := f.Progress(ctx, id)
	return bee.DesktopLoginOpenReceipt{Opened: true, Progress: p}, e
}
func TestCodexLoginBridgeExtensionsAreOptionalAndAcceptOnlyOperationID(t *testing.T) {
	f := &codexLoginFixture{}
	var out bytes.Buffer
	params := `{"operation_id":"` + strings.Repeat("a", 48) + `"}`
	input := hello + supplyRequest("progress", "authorize_progress", params) + supplyRequest("open", "authorize_open", params) + supplyRequest("bad", "authorize_open", strings.TrimSuffix(params, "}")+`,"url":"PRIVATE_SECRET"}`)
	if err := desktopbridge.RunWithAuthorization(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil), &runtimeFixture{}, f); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if f.starts != 0 || f.opens != 1 || f.reads != 2 || !bytes.Contains(frames[0].Result, []byte(`"authorize_progress"`)) || frames[3].Error == nil || strings.Contains(out.String(), "PRIVATE_SECRET") {
		t.Fatalf("login extension protocol rejected: starts=%d opens=%d reads=%d frames=%s", f.starts, f.opens, f.reads, out.String())
	}
}
