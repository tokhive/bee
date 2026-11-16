package desktopbridge_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

type controlledSupplies struct {
	fakeDevice
	slow    string
	entered chan string
	release chan struct{}
	exited  chan string
}

func (s *controlledSupplies) SupplyStatus(ctx context.Context, platform string) (bee.DesktopSupply, error) {
	s.entered <- platform
	defer func() { s.exited <- platform }()
	if platform == s.slow {
		select {
		case <-s.release:
		case <-ctx.Done():
			return bee.DesktopSupply{}, ctx.Err()
		}
	}
	return bee.DesktopSupply{Platform: platform}, nil
}
func (s *controlledSupplies) SetPaused(ctx context.Context, platform string, paused bool) (bee.DesktopSupply, error) {
	s.entered <- "write:" + platform
	return bee.DesktopSupply{Platform: platform, Paused: paused}, nil
}

type liveBridge struct {
	feed   *io.PipeWriter
	frames chan reply
	done   chan error
	ended  chan struct{}
	cancel func()
}

func openLiveBridge(t *testing.T, service *controlledSupplies, accounts ...desktopbridge.Accounts) *liveBridge {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	in, feed := io.Pipe()
	out, writer := io.Pipe()
	b := &liveBridge{feed: feed, frames: make(chan reply, 64), done: make(chan error, 1), ended: make(chan struct{}), cancel: func() { cancel(); feed.Close() }}
	go func() {
		if len(accounts) == 0 {
			b.done <- desktopbridge.RunWithDevices(ctx, in, writer, io.Discard, "test", service)
		} else {
			b.done <- desktopbridge.RunWithAccounts(ctx, in, writer, io.Discard, "test", service, accounts[0])
		}
		writer.Close()
		in.Close()
		close(b.ended)
	}()
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		decoder := json.NewDecoder(out)
		for {
			var frame reply
			if decoder.Decode(&frame) != nil {
				return
			}
			b.frames <- frame
		}
	}()
	t.Cleanup(func() {
		cancel()
		feed.Close()
		in.Close()
		out.Close()
		writer.Close()
		select {
		case <-b.ended:
		case <-time.After(5 * time.Second):
			t.Error("bridge did not join after owner cancellation")
		}
		<-readDone
	})
	b.send(t, hello)
	if b.next(t).ID != "hello-1" {
		t.Fatal("hello correlation failed")
	}
	return b
}

func TestSharedBarrierWaitsForEarlierReadsAndFencesLaterPlatform(t *testing.T) {
	s := controlledService("openai")
	b := openLiveBridge(t, s)
	b.send(t, supplyRequest("slow", "supply_status", `{"platform":"openai"}`))
	<-s.entered
	go func() {
		_, _ = io.WriteString(b.feed, supplyRequest("write", "supply_set_paused", `{"platform":"claude","paused":true}`)+supplyRequest("later", "supply_status", `{"platform":"claude"}`))
	}()
	select {
	case event := <-s.entered:
		t.Fatalf("barrier overtook slow read: %s", event)
	case <-time.After(50 * time.Millisecond):
	}
	close(s.release)
	for _, id := range []string{"slow", "write", "later"} {
		if frame := b.next(t); frame.ID != id {
			t.Fatalf("response=%s want=%s", frame.ID, id)
		}
	}
	if <-s.entered != "write:claude" || <-s.entered != "claude" {
		t.Fatal("later read crossed write barrier")
	}
}

func TestReadWorkersJoinOnTerminalInput(t *testing.T) {
	for _, ending := range []string{"eof", "shutdown", "cancel"} {
		t.Run(ending, func(t *testing.T) {
			s := controlledService("openai")
			b := openLiveBridge(t, s)
			b.send(t, supplyRequest("active", "supply_status", `{"platform":"openai"}`))
			<-s.entered
			b.send(t, supplyRequest("queued", "supply_status", `{"platform":"openai"}`))
			b.send(t, supplyRequest("queued-write", "supply_set_paused", `{"platform":"claude","paused":true}`))
			switch ending {
			case "eof":
				b.feed.Close()
			case "cancel":
				b.cancel()
			case "shutdown":
				b.send(t, request("shutdown", "shutdown"))
			}
			select {
			case <-b.ended:
			case <-time.After(time.Second):
				t.Fatal("terminal input did not cancel and join active worker")
			}
			if <-s.exited != "openai" {
				t.Fatal("active worker missing exit")
			}
			select {
			case entered := <-s.entered:
				t.Fatalf("queued read ran after termination: %s", entered)
			default:
			}
			if ending == "shutdown" {
				for {
					if b.next(t).ID == "shutdown" {
						break
					}
				}
			}

		})
	}
}

func TestEOFCancelsReadsBehindAcceptedBarrier(t *testing.T) {
	s := controlledService("openai")
	b := openLiveBridge(t, s)
	b.send(t, supplyRequest("slow", "supply_status", `{"platform":"openai"}`))
	<-s.entered
	b.send(t, request("barrier", "ping"))
	b.send(t, supplyRequest("queued-write", "supply_set_paused", `{"platform":"claude","paused":true}`))
	b.feed.Close()
	select {
	case <-b.ended:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("EOF behind an accepted barrier did not cancel and join the slow read")
	}
	if <-s.exited != "openai" {
		t.Fatal("slow read did not leave before bridge completion")
	}
	select {
	case entered := <-s.entered:
		t.Fatalf("queued operation started after EOF: %s", entered)
	default:
	}
}

func TestEOFPreservesDecodedDuplicateRejection(t *testing.T) {
	s := controlledService("openai")
	b := openLiveBridge(t, s)
	frame := supplyRequest("duplicate", "supply_status", `{"platform":"openai"}`)
	b.send(t, frame)
	<-s.entered
	b.send(t, frame)
	b.feed.Close()
	wait(t, b.ended)
	for {
		frame := b.next(t)
		if frame.Error != nil && frame.Error.Code == "DUPLICATE_ID" {
			break
		}
	}
	if <-s.exited != "openai" {
		t.Fatal("EOF did not join the original read")
	}
}

func TestOversizedReadResponseTerminatesDispatcher(t *testing.T) {
	s := controlledService("neither")
	b := openLiveBridge(t, s)
	b.send(t, supplyRequest(strings.Repeat("<", 200000), "supply_status", `{"platform":"openai"}`))
	frame := b.next(t)
	if frame.ID != "" || frame.Error == nil || frame.Error.Code != "FRAME_TOO_LARGE" {
		t.Fatalf("oversized worker reply missing bounded terminal evidence: %+v", frame)
	}
	// The caller owns input unblocking. This subsequent frame must never execute.
	_, _ = io.WriteString(b.feed, supplyRequest("later", "supply_set_paused", `{"platform":"claude","paused":true}`))
	wait(t, b.ended)
	if err := <-b.done; err == nil || !strings.Contains(err.Error(), "encoded response bytes=") {
		t.Fatalf("worker terminal evidence lost: %v", err)
	}
	if <-s.entered != "openai" {
		t.Fatal("expected original platform read")
	}
	select {
	case entered := <-s.entered:
		t.Fatalf("worker terminal error admitted later operation: %s", entered)
	default:
	}
}

type controlledAccounts struct {
	*bee.DesktopAccounts
	reads *controlledSupplies
}

func (a *controlledAccounts) Detect(ctx context.Context, request bee.DesktopAccountDetectRequest) (bee.DesktopAccountSnapshot, error) {
	_, err := a.reads.SupplyStatus(ctx, request.Platform)
	return bee.DesktopAccountSnapshot{Platform: request.Platform}, err
}
func (a *controlledAccounts) Snapshot(ctx context.Context, platform string, _ bool) (bee.DesktopAccountSnapshot, error) {
	_, err := a.reads.SupplyStatus(ctx, platform)
	return bee.DesktopAccountSnapshot{Platform: platform}, err
}

func TestAccountAndSupplyReadsShareOnePlatformLane(t *testing.T) {
	s := controlledService("openai")
	b := openLiveBridge(t, s, &controlledAccounts{DesktopAccounts: bee.NewDesktopAccounts(nil), reads: s})
	b.send(t, supplyRequest("detect", "account_detect", `{"platform":"openai","directory":null,"store":"file","mode":"official"}`))
	<-s.entered
	b.send(t, supplyRequest("snapshot", "account_snapshot", `{"platform":"openai","refresh":false}`))
	b.send(t, supplyRequest("supply", "supply_status", `{"platform":"openai"}`))
	b.send(t, supplyRequest("other", "supply_status", `{"platform":"claude"}`))
	if entered := <-s.entered; entered != "claude" {
		t.Fatalf("same-platform read crossed method lane: %s", entered)
	}
	if b.next(t).ID != "other" {
		t.Fatal("other platform did not complete while Detect was held")
	}
	close(s.release)
	for _, id := range []string{"detect", "snapshot", "supply"} {
		if frame := b.next(t); frame.ID != id {
			t.Fatalf("platform lane reordered response: got=%s want=%s", frame.ID, id)
		}
	}
}

type blockedReadReplyWriter struct {
	bytes.Buffer
	count   int
	started chan struct{}
	release chan struct{}
}

func (w *blockedReadReplyWriter) Write(p []byte) (int, error) {
	w.count++
	if w.count == 2 {
		close(w.started)
		<-w.release
	}
	return w.Buffer.Write(p)
}

func TestCompletedReadRetainsIDUntilResponseWriteFinishes(t *testing.T) {
	s := controlledService("neither")
	in, feed := io.Pipe()
	defer in.Close()
	defer feed.Close()
	input := &eofNoticeReader{Reader: in, eof: make(chan struct{})}
	out := &blockedReadReplyWriter{started: make(chan struct{}), release: make(chan struct{})}
	done := make(chan error, 1)
	go func() { done <- desktopbridge.RunWithDevices(context.Background(), input, out, io.Discard, "test", s) }()
	frame := supplyRequest("read", "supply_status", `{"platform":"claude"}`)
	_, _ = io.WriteString(feed, hello+frame)
	wait(t, out.started)
	<-s.exited // Handler returned, but its response has not been written.
	_, _ = io.WriteString(feed, frame+request("barrier", "ping"))
	feed.Close()
	wait(t, input.eof)
	close(out.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if len(frames) != 4 || frames[2].Error == nil || frames[2].Error.Code != "DUPLICATE_ID" {
		t.Fatalf("read ID released before response write: %+v", frames)
	}
	select {
	case <-s.exited:
		t.Fatal("duplicate read reached the platform handler")
	default:
	}
}

func TestFullPlatformQueueRejectsWithoutBlockingOtherPlatform(t *testing.T) {
	s := controlledService("openai")
	b := openLiveBridge(t, s)
	b.send(t, supplyRequest("active", "supply_status", `{"platform":"openai"}`))
	<-s.entered
	for i := 0; i < 17; i++ {
		b.send(t, supplyRequest(fmt.Sprint("queued-", i), "supply_status", `{"platform":"openai"}`))
	}
	full := b.next(t)
	if full.ID != "queued-16" || full.Error == nil || full.Error.Code != "REQUEST_QUEUE_FULL" {
		t.Fatalf("unbounded or wrong queue rejection: %+v", full)
	}
	b.send(t, supplyRequest("fast", "supply_status", `{"platform":"claude"}`))
	if b.next(t).ID != "fast" {
		t.Fatal("full OpenAI queue blocked Claude")
	}
}

type failSecondWrite struct {
	count   int
	failed  chan struct{}
	started chan struct{}
	release chan struct{}
	cause   error
}

func (w *failSecondWrite) Write(p []byte) (int, error) {
	w.count++
	if w.count == 2 {
		close(w.started)
		<-w.release
		close(w.failed)
		return 0, w.cause
	}
	return len(p), nil
}
func TestWriterFailureCancelsReadsBeforeOwnerUnblocksInput(t *testing.T) {
	s := controlledService("openai")
	in, feed := io.Pipe()
	defer in.Close()
	defer feed.Close()
	cause := errors.New("controlled writer failure")
	writer := &failSecondWrite{failed: make(chan struct{}), started: make(chan struct{}), release: make(chan struct{}), cause: cause}
	done := make(chan error, 1)
	go func() { done <- desktopbridge.RunWithDevices(context.Background(), in, writer, io.Discard, "test", s) }()
	_, _ = io.WriteString(feed, hello+supplyRequest("slow", "supply_status", `{"platform":"openai"}`))
	<-s.entered
	_, _ = io.WriteString(feed, supplyRequest("fast", "supply_status", `{"platform":"claude"}`))
	wait(t, writer.started)
	_, _ = io.WriteString(feed, supplyRequest("queued-write", "supply_set_paused", `{"platform":"claude","paused":true}`))
	close(writer.release)
	select {
	case <-writer.failed:
	case <-time.After(time.Second):
		t.Fatal("writer failure not reached")
	}
	for i := 0; i < 2; i++ {
		select {
		case <-s.exited:
		case <-time.After(time.Second):
			t.Fatal("writer failure did not cancel active worker")
		}
	}
	feed.Close() // Caller owns the blocked input, including on output failure.
	if err := <-done; !errors.Is(err, cause) {
		t.Fatalf("writer failure evidence lost: %v", err)
	}
	if entered := <-s.entered; entered != "claude" {
		t.Fatalf("unexpected read entry: %s", entered)
	}
	select {
	case entered := <-s.entered:
		t.Fatalf("queued write started after writer failure: %s", entered)
	default:
	}
}
func (b *liveBridge) send(t *testing.T, frame string) {
	t.Helper()
	if _, err := io.WriteString(b.feed, frame); err != nil {
		t.Fatal(err)
	}
}
func (b *liveBridge) next(t *testing.T) reply {
	t.Helper()
	select {
	case frame := <-b.frames:
		return frame
	case <-time.After(time.Second):
		t.Fatal("response did not arrive while controlled slow read remained blocked")
		return reply{}
	}
}
func controlledService(slow string) *controlledSupplies {
	return &controlledSupplies{slow: slow, entered: make(chan string, 64), release: make(chan struct{}), exited: make(chan string, 64)}
}

func TestPlatformReadsBypassSamePlatformWaiters(t *testing.T) {
	for _, slow := range []string{"openai", "claude"} {
		t.Run(slow, func(t *testing.T) {
			fast := "claude"
			if slow == fast {
				fast = "openai"
			}
			s := controlledService(slow)
			b := openLiveBridge(t, s)
			b.send(t, supplyRequest("slow", "supply_status", `{"platform":"`+slow+`"}`))
			select {
			case <-s.entered:
			case <-time.After(time.Second):
				t.Fatal("slow handler not entered")
			}
			go func() {
				_, _ = io.WriteString(b.feed, supplyRequest("same", "supply_status", `{"platform":"`+slow+`"}`)+supplyRequest("fast", "supply_status", `{"platform":"`+fast+`"}`))
			}()
			if frame := b.next(t); frame.ID != "fast" {
				t.Fatalf("first reply=%s; required=fast before release", frame.ID)
			}
			if entered := <-s.entered; entered != fast {
				t.Fatalf("same-platform request entered early: %s", entered)
			}
			close(s.release)
			if b.next(t).ID != "slow" || b.next(t).ID != "same" {
				t.Fatal("same-platform response order changed")
			}
		})
	}
}
