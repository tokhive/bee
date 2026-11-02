package desktopbridge_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/desktopbridge"
)

const hello = `{"protocol":1,"id":"hello-1","method":"hello","params":{}}` + "\n"

// A successful read fixture must keep stdin alive until the response arrives.
// EOF instead means cancellation of all outstanding management reads.
func runDeviceFrames(t *testing.T, device desktopbridge.Devices, frames []string, accounts ...desktopbridge.Accounts) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	in, feed := io.Pipe()
	out, writer := io.Pipe()
	stop := context.AfterFunc(ctx, func() { in.Close(); feed.Close(); out.Close(); writer.Close() })
	defer stop()
	defer in.Close()
	defer feed.Close()
	defer out.Close()
	defer writer.Close()
	done := make(chan error, 1)
	go func() {
		if len(accounts) == 0 {
			done <- desktopbridge.RunWithDevices(ctx, in, writer, io.Discard, "test", device)
		} else {
			done <- desktopbridge.RunWithAccounts(ctx, in, writer, io.Discard, "test", device, accounts[0])
		}
		writer.Close()
	}()
	reader := bufio.NewReader(out)
	var result strings.Builder
	for _, frame := range append(frames, request("fixture-shutdown", "shutdown")) {
		if frame == "" {
			continue
		}
		if _, err := io.WriteString(feed, frame); err != nil {
			t.Fatal(err)
		}
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(frame, `"fixture-shutdown"`) {
			result.WriteString(line)
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	return result.String()
}

func request(id, method string) string {
	return `{"protocol":1,"id":"` + id + `","method":"` + method + `","params":{}}` + "\n"
}

type reply struct {
	Protocol int             `json:"protocol"`
	ID       string          `json:"id"`
	Instance string          `json:"instance"`
	Result   json.RawMessage `json:"result"`
	Error    *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func replies(t *testing.T, output string) []reply {
	t.Helper()
	var result []reply
	decoder := json.NewDecoder(strings.NewReader(output))
	for {
		var frame reply
		if err := decoder.Decode(&frame); err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("stdout contains a non-protocol frame: %v", err)
		}
		if frame.Protocol != 1 || frame.Instance == "" || (frame.Error == nil) == (len(frame.Result) == 0) {
			t.Fatalf("invalid reply envelope: %+v", frame)
		}
		result = append(result, frame)
	}
	return result
}

func TestRunHandshakePingShutdown(t *testing.T) {
	var out, diagnostics bytes.Buffer
	err := desktopbridge.Run(context.Background(), strings.NewReader(hello+request("p", "ping")+request("s", "shutdown")+request("ignored", "ping")), &out, &diagnostics, "test-build")
	if err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if len(frames) != 3 {
		t.Fatalf("replies=%d; want=3; shutdown must stop processing", len(frames))
	}
	var metadata struct {
		Version      string   `json:"bee_version"`
		OS           string   `json:"os"`
		Arch         string   `json:"arch"`
		Capabilities []string `json:"capabilities"`
	}
	if err := json.Unmarshal(frames[0].Result, &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.Version != "test-build" || metadata.OS != runtime.GOOS || metadata.Arch != runtime.GOARCH || strings.Join(metadata.Capabilities, ",") != "ping,shutdown" {
		t.Fatalf("unexpected hello metadata: %+v", metadata)
	}
	for i, id := range []string{"hello-1", "p", "s"} {
		if frames[i].ID != id || frames[i].Error != nil || frames[i].Instance != frames[0].Instance {
			t.Fatalf("reply correlation failed: %+v", frames[i])
		}
	}
	if diagnostics.Len() != 0 {
		t.Fatalf("successful session emitted diagnostics: %q", diagnostics.String())
	}
}

type fragmentReader struct{ io.Reader }

func (r fragmentReader) Read(p []byte) (int, error) { return r.Reader.Read(p[:1]) }

func TestRunAcceptsFragmentedAndCombinedFrames(t *testing.T) {
	for _, fragmented := range []bool{false, true} {
		t.Run(map[bool]string{false: "combined", true: "one-byte"}[fragmented], func(t *testing.T) {
			var in io.Reader = strings.NewReader(hello + request("p", "ping"))
			if fragmented {
				in = fragmentReader{in}
			}
			var out bytes.Buffer
			if err := desktopbridge.Run(context.Background(), in, &out, io.Discard, "test"); err != nil {
				t.Fatal(err)
			}
			if frames := replies(t, out.String()); len(frames) != 2 || frames[1].Error != nil {
				t.Fatalf("expected two success frames: %+v", frames)
			}
		})
	}
}

func TestRunRejectsInvalidRequests(t *testing.T) {
	const secret = "credential-never-echo-this"
	cases := []struct {
		name, input, code, evidence string
	}{
		{"before-hello", request("p", "ping"), "NOT_READY", "hello"},
		{"shutdown-before-hello", request("s", "shutdown"), "NOT_READY", "hello"},
		{"version", `{"protocol":2,"id":"v","method":"hello","params":{}}` + "\n", "VERSION_MISMATCH", "2"},
		{"unknown-method", hello + request("u", "start"), "UNKNOWN_METHOD", "method"},
		{"invalid-json", `{"credential":"` + secret + `",` + "\n", "INVALID_JSON", "byte"},
		{"unknown-field", `{"protocol":1,"id":"u","method":"hello","params":{},"credential":"` + secret + `"}` + "\n", "INVALID_REQUEST", "field"},
		{"unknown-param", `{"protocol":1,"id":"u","method":"hello","params":{"credential":"` + secret + `"}}` + "\n", "INVALID_REQUEST", "params"},
		{"duplicate-key", `{"protocol":1,"protocol":1,"id":"u","method":"hello","params":{}}` + "\n", "INVALID_REQUEST", "repeated"},
		{"null-params", `{"protocol":1,"id":"u","method":"hello","params":null}` + "\n", "INVALID_REQUEST", "params"},
		{"missing-protocol", `{"id":"u","method":"hello","params":{}}` + "\n", "INVALID_REQUEST", "protocol"},
		{"null-protocol", `{"protocol":null,"id":"u","method":"hello","params":{}}` + "\n", "INVALID_REQUEST", "protocol"},
		{"empty-id", `{"protocol":1,"id":"","method":"hello","params":{}}` + "\n", "INVALID_REQUEST", "id"},
		{"trailing-json", strings.TrimSuffix(hello, "\n") + ` {}` + "\n", "INVALID_JSON", "byte"},
		{"non-utf8", "\xff\n", "INVALID_UTF8", "UTF-8"},
		{"unterminated", strings.TrimSuffix(hello, "\n"), "INCOMPLETE_FRAME", "newline"},
		{"too-long", strings.Repeat("x", 1<<20+1) + "\n", "FRAME_TOO_LARGE", "1048576"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var out, diagnostics bytes.Buffer
			_ = desktopbridge.Run(context.Background(), strings.NewReader(tc.input), &out, &diagnostics, "test")
			frames := replies(t, out.String())
			if len(frames) == 0 {
				t.Fatal("no protocol error reply")
			}
			last := frames[len(frames)-1]
			if last.Error == nil || last.Error.Code != tc.code || !strings.Contains(last.Error.Message, tc.evidence) {
				t.Fatalf("error=%+v; want code=%s and evidence=%q", last.Error, tc.code, tc.evidence)
			}
			if strings.Contains(out.String()+diagnostics.String(), secret) {
				t.Fatal("protocol error leaked payload credential")
			}
		})
	}
}

func TestRunVersionFailureDoesNotEnterReady(t *testing.T) {
	var out bytes.Buffer
	in := strings.Replace(hello, `"protocol":1`, `"protocol":7`, 1) + request("p", "ping") + request("retry", "hello")
	if err := desktopbridge.Run(context.Background(), strings.NewReader(in), &out, io.Discard, "test"); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if len(frames) != 3 || frames[1].Error == nil || frames[1].Error.Code != "NOT_READY" || frames[2].Error != nil {
		t.Fatalf("version failure changed readiness: %+v", frames)
	}
}

type blockedWriter struct {
	bytes.Buffer
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (w *blockedWriter) Write(p []byte) (int, error) {
	w.once.Do(func() { close(w.started); <-w.release })
	return w.Buffer.Write(p)
}

type eofNoticeReader struct {
	io.Reader
	eof  chan struct{}
	once sync.Once
}

func (r *eofNoticeReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if err == io.EOF {
		r.once.Do(func() { close(r.eof) })
	}
	return n, err
}

func wait(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("management transport did not reach expected I/O boundary")
	}
}

func TestRunRejectsIDWhileResponseIsUnfinished(t *testing.T) {
	out := &blockedWriter{started: make(chan struct{}), release: make(chan struct{})}
	in := &eofNoticeReader{Reader: strings.NewReader(hello + hello), eof: make(chan struct{})}
	done := make(chan struct{})
	var runErr error
	go func() {
		defer close(done)
		runErr = desktopbridge.Run(context.Background(), in, out, io.Discard, "test")
	}()
	wait(t, out.started)
	wait(t, in.eof)
	close(out.release)
	wait(t, done)
	if runErr != nil {
		t.Fatal(runErr)
	}
	frames := replies(t, out.String())
	if len(frames) != 2 || frames[1].Error == nil || frames[1].Error.Code != "DUPLICATE_ID" {
		t.Fatalf("unfinished ID was accepted: %+v", frames)
	}
}

func TestRunReusesCompletedIDAndHasUniqueInstance(t *testing.T) {
	var instances []string
	for range 2 {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		in, feed := io.Pipe()
		output, readOutput := io.Pipe()
		stop := context.AfterFunc(ctx, func() { in.Close(); feed.Close(); output.Close(); readOutput.Close() })
		defer stop()
		done := make(chan error, 1)
		go func() { done <- desktopbridge.Run(ctx, in, readOutput, io.Discard, "test") }()
		decoder := json.NewDecoder(output)
		var instance string
		// The intervening response proves the first reply's Write has returned.
		for i, method := range []string{"hello", "ping", "shutdown"} {
			id := "same-id"
			if i == 1 {
				id = "barrier"
			}
			if _, err := io.WriteString(feed, request(id, method)); err != nil {
				t.Fatal(err)
			}
			var frame reply
			if err := decoder.Decode(&frame); err != nil || frame.Error != nil {
				t.Fatalf("completed ID reuse: reply=%+v; error=%v", frame, err)
			}
			instance = frame.Instance
		}
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		feed.Close()
		in.Close()
		readOutput.Close()
		output.Close()
		instances = append(instances, instance)
	}
	if instances[0] == "" || instances[0] == instances[1] {
		t.Fatalf("instance identifiers are not unique: %v", instances)
	}
}

type closeTrackingBuffer struct {
	bytes.Buffer
	closed bool
}

func (b *closeTrackingBuffer) Close() error { b.closed = true; return nil }

func TestRunEOFAndCancellationKeepCallerStreamOwnership(t *testing.T) {
	for _, cancelFirst := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		if cancelFirst {
			cancel()
		}
		var in, out, diagnostics closeTrackingBuffer
		err := desktopbridge.Run(ctx, &in, &out, &diagnostics, "test")
		cancel()
		if cancelFirst && !errors.Is(err, context.Canceled) || !cancelFirst && err != nil {
			t.Fatalf("cancelFirst=%v; error=%v", cancelFirst, err)
		}
		if in.closed || out.closed || diagnostics.closed || out.Len() != 0 {
			t.Fatal("Run closed caller streams or emitted unsolicited output")
		}
	}
}

func TestRunCancellationJoinsIOAfterOwnerUnblocksRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	in, feed := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- desktopbridge.Run(ctx, in, io.Discard, io.Discard, "test") }()
	cancel()
	feed.Close() // The owner, not Run, interrupts blocking I/O.
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled Run: %v", err)
	}
	in.Close()
}

type brokenWriter struct{ err error }

func (w brokenWriter) Write([]byte) (int, error) { return 0, w.err }

func TestRunOutputFailurePreservesCauseAndDiagnosesStage(t *testing.T) {
	cause := errors.New("test pipe is broken")
	var diagnostics bytes.Buffer
	err := desktopbridge.Run(context.Background(), strings.NewReader(hello), brokenWriter{cause}, &diagnostics, "test")
	if !errors.Is(err, cause) || !strings.Contains(err.Error(), "write") || !strings.Contains(diagnostics.String(), cause.Error()) {
		t.Fatalf("write failure evidence lost: error=%v; diagnostics=%q", err, diagnostics.String())
	}
}

type shortWriter struct{}

func (shortWriter) Write(p []byte) (int, error) { return len(p) - 1, nil }

func TestRunRejectsShortOutputWrite(t *testing.T) {
	err := desktopbridge.Run(context.Background(), strings.NewReader(hello), shortWriter{}, io.Discard, "test")
	if !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("truncated response was treated as complete: %v", err)
	}
}

func TestRunAcceptsExactlyOneMiBBeforeNewline(t *testing.T) {
	var out bytes.Buffer
	in := strings.TrimSuffix(hello, "\n") + strings.Repeat(" ", (1<<20)-(len(hello)-1)) + "\n"
	if err := desktopbridge.Run(context.Background(), strings.NewReader(in), &out, io.Discard, "test"); err != nil {
		t.Fatal(err)
	}
	if frames := replies(t, out.String()); len(frames) != 1 || frames[0].Error != nil {
		t.Fatalf("boundary-size frame rejected: %+v", frames)
	}
}

type brokenReader struct{ err error }

func (r brokenReader) Read([]byte) (int, error) { return 0, r.err }

func TestRunInputFailurePreservesCause(t *testing.T) {
	cause := errors.New("test input failed")
	var diagnostics bytes.Buffer
	err := desktopbridge.Run(context.Background(), brokenReader{cause}, io.Discard, &diagnostics, "test")
	if !errors.Is(err, cause) || !strings.Contains(err.Error(), "read desktop frame") || !strings.Contains(diagnostics.String(), cause.Error()) {
		t.Fatalf("read failure evidence lost: error=%v; diagnostics=%q", err, diagnostics.String())
	}
}

func TestRunEncodedResponseStaysWithinOneMiB(t *testing.T) {
	var out bytes.Buffer
	in := request(strings.Repeat("<", 200000), "hello") + request("later", "ping")
	err := desktopbridge.Run(context.Background(), strings.NewReader(in), &out, io.Discard, "test")
	for _, line := range strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n") {
		if len(line) > 1<<20 {
			t.Fatalf("encoded reply bytes=%d; maximum=%d", len(line), 1<<20)
		}
	}
	frames := replies(t, out.String())
	if err == nil || len(frames) != 1 || frames[0].ID != "" || frames[0].Error == nil || frames[0].Error.Code != "FRAME_TOO_LARGE" {
		t.Fatalf("oversized response did not terminate with a bounded protocol error: frames=%d; error=%v", len(frames), err)
	}
}

func TestRunInvalidEnvelopePreservesUnambiguousID(t *testing.T) {
	for _, tc := range []struct{ input, id string }{
		{`{"protocol":1,"id":"request-17","method":"hello","params":{},"extra":true}`, "request-17"},
		{`{"extra":true,"protocol":1,"id":"request-17","method":"hello","params":{}}`, "request-17"},
		{`{"protocol":1,"id":"request-17","method":"hello","method":"ping","params":{}}`, "request-17"},
		{`{"protocol":1,"id":"first","id":"second","method":"hello","params":{}}`, ""},
	} {
		var out bytes.Buffer
		if err := desktopbridge.Run(context.Background(), strings.NewReader(tc.input+"\n"), &out, io.Discard, "test"); err != nil {
			t.Fatal(err)
		}
		frames := replies(t, out.String())
		if len(frames) != 1 || frames[0].ID != tc.id || frames[0].Error == nil || frames[0].Error.Code != "INVALID_REQUEST" {
			t.Fatalf("invalid request correlation: frames=%+v; want ID=%q", frames, tc.id)
		}
	}
}
