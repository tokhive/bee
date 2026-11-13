package bee

import (
	"context"
	"strconv"
	"time"
)

type desktopRequestDiagnosticKey struct{}

// WithDesktopRequestDiagnostics attaches a private, synchronous safe-event sink
// to this request only. It never installs a process-wide logger.
func WithDesktopRequestDiagnostics(ctx context.Context, sink func(DesktopDiagnosticEvent)) context.Context {
	return context.WithValue(ctx, desktopRequestDiagnosticKey{}, sink)
}

func desktopHTTPDiagnostic(ctx context.Context, path, method string, started time.Time, status int, finished bool, failure error) {
	sink, _ := ctx.Value(desktopRequestDiagnosticKey{}).(func(DesktopDiagnosticEvent))
	if sink == nil {
		return
	}
	// A finite public path excludes query strings, device IDs and credentials.
	switch path {
	case "/api/bee/identity", "/api/bee/pairings", "/api/bee/pairings/redeem", "/api/bee/platforms/openai/account", "/api/bee/platforms/claude/account", "/api/bee/platforms/openai/capabilities", "/api/bee/platforms/claude/capabilities", "/api/bee/platforms/openai", "/api/bee/platforms/claude":
	default:
		return
	}
	phase, code, level := "http_start", "request_http_started", "info"
	if finished {
		phase, code = "http_end", "request_http_finished"
	}
	if failure != nil {
		phase, code, level = "http_error", "request_http_failed", "warning"
	}
	evidence := map[string]string{"method": method, "path": path, "phase": phase, "elapsed_ms": strconv.FormatInt(time.Since(started).Milliseconds(), 10)}
	if failure != nil {
		evidence["failure_kind"] = desktopRequestFailureCode(failure)
	}
	if status != 0 {
		evidence["http_status"] = strconv.Itoa(status)
	}
	sink(DesktopDiagnosticEvent{Time: time.Now().UTC().Format(time.RFC3339Nano), Level: level, Module: "bridge", Code: code, Evidence: evidence})
}
