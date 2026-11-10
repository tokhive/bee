package bee

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const desktopTestLoginURL = "https://auth.openai.com/oauth/authorize?response_type=code&client_id=codex&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&scope=openid+profile+email+offline_access&code_challenge=" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ" + "&code_challenge_method=S256&state=PRIVATE_LOGIN_STATE"

func TestDesktopLoginLinkRequiresCompleteOfficialBoundURL(t *testing.T) {
	var found []string
	output := newDesktopLoginOutput(func(link string) { found = append(found, link) })
	for _, part := range []string{"Starting local login server\n", desktopTestLoginURL[:47], desktopTestLoginURL[47:], "\nPRIVATE_TOKEN\n"} {
		if _, err := output.Write([]byte(part)); err != nil {
			t.Fatal(err)
		}
	}
	if len(found) != 1 || found[0] != desktopTestLoginURL {
		t.Fatalf("validated links=%d; required=one complete original URL", len(found))
	}
	for _, unsafe := range []string{
		strings.Replace(desktopTestLoginURL, "auth.openai.com", "auth.openai.com.example", 1),
		strings.Replace(desktopTestLoginURL, "https:", "http:", 1),
		desktopTestLoginURL + "&state=second",
		desktopTestLoginURL + "#fragment",
		strings.Replace(desktopTestLoginURL, "127.0.0.1", "example.com", 1),
		strings.Replace(desktopTestLoginURL, "1455", "9999", 1),
		strings.Replace(desktopTestLoginURL, "S256", "plain", 1),
		strings.Replace(desktopTestLoginURL, "response_type=code", "response_type=token", 1),
		strings.Repeat("x", 20000) + desktopTestLoginURL,
	} {
		count := 0
		stream := newDesktopLoginOutput(func(string) { count++ })
		_, _ = stream.Write([]byte(unsafe + "\n"))
		if count != 0 {
			t.Fatal("unsafe or oversized output provided an openable link")
		}
	}
}

func TestDesktopLoginOpenIsBoundRevocableAndDoesNotStartLogin(t *testing.T) {
	owner, _, request, _ := authorizeFixture(t, "wait")
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	owner.acceptLoginLink(op.ID, desktopTestLoginURL)
	opens := 0
	owner.openBrowser = func(_ context.Context, link string) error {
		if link != desktopTestLoginURL {
			t.Fatal("opener did not receive original validated link")
		}
		opens++
		return errors.New("launcher exit status 7")
	}
	for range 2 {
		receipt, err := owner.Open(context.Background(), op.ID)
		if err != nil || receipt.Opened || receipt.Error == nil || !receipt.Progress.Actions.Open {
			t.Fatalf("open failure did not retain same live login: %+v err=%v", receipt, err)
		}
		raw, _ := json.Marshal(receipt)
		if strings.Contains(string(raw), "PRIVATE_LOGIN_STATE") || strings.Contains(string(raw), "https://auth") {
			t.Fatal("authorization material escaped in public receipt")
		}
	}
	if opens != 2 {
		t.Fatalf("opener calls=%d; required=2", opens)
	}
	before, _ := owner.Progress(context.Background(), op.ID)
	if _, err := owner.Cancel(context.Background(), op.ID); err != nil {
		t.Fatal(err)
	}
	after, err := owner.Progress(context.Background(), op.ID)
	if err != nil || after.Actions.Open || after.StopReason == nil || *after.StopReason != "cancelled" || after.Sequence <= before.Sequence {
		t.Fatalf("cancel did not immediately revoke link: %+v err=%v", after, err)
	}
	receipt, err := owner.Open(context.Background(), op.ID)
	if err != nil || receipt.Opened || opens != 2 {
		t.Fatal("cancelled login called opener")
	}
	if _, err := owner.Progress(context.Background(), strings.Repeat("f", 48)); err == nil {
		t.Fatal("unowned operation accepted")
	}
}

func TestDesktopLoginProgressObservesControlledOfficialStderr(t *testing.T) {
	owner, _, request, _ := authorizeFixture(t, "link_wait")
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(5 * time.Second)
	for {
		progress, err := owner.Progress(context.Background(), op.ID)
		if err != nil {
			t.Fatal(err)
		}
		if progress.Actions.Open {
			if progress.Phase != "waiting_authorization" || progress.Operation.ID != op.ID {
				t.Fatalf("unexpected progress: %+v", progress)
			}
			break
		}
		select {
		case <-deadline:
			t.Fatal("controlled official stderr produced no openable progress")
		case <-time.After(5 * time.Millisecond):
		}
	}
	if _, err := owner.Cancel(context.Background(), op.ID); err != nil {
		t.Fatal(err)
	}
	terminal := waitAuthorize(t, owner, op.ID)
	if terminal.State != "cancelled" {
		t.Fatalf("cancelled controlled process state=%s", terminal.State)
	}
	progress, err := owner.Progress(context.Background(), op.ID)
	if err != nil || progress.Actions.Open || progress.Phase != "finished" {
		t.Fatalf("terminal progress=%+v error=%v", progress, err)
	}
}

func TestDesktopLoginCancellationStopsPendingBrowserLauncher(t *testing.T) {
	owner, _, request, _ := authorizeFixture(t, "wait")
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	owner.acceptLoginLink(op.ID, desktopTestLoginURL)
	started := make(chan struct{})
	owner.openBrowser = func(ctx context.Context, _ string) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	done := make(chan DesktopLoginOpenReceipt, 1)
	go func() { receipt, _ := owner.Open(context.Background(), op.ID); done <- receipt }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("controlled browser launcher did not start")
	}
	if _, err := owner.Cancel(context.Background(), op.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case receipt := <-done:
		if receipt.Opened || receipt.Error == nil || receipt.Progress.Actions.Open {
			t.Fatalf("cancelled launcher retained permission: %+v", receipt)
		}
	case <-time.After(time.Second):
		t.Fatal("browser launcher did not stop with its owned login")
	}
}
