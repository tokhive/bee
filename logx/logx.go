// Package logx gives Hive and the Bee one logging setup: every line carries a
// full date-and-time stamp, one environment variable selects the level, and a
// second selects which modules speak at all.
//
// TOKHIVE_LOG_LEVEL picks debug, info (the default), warn or error.
// TOKHIVE_LOG_MODULES is a comma-separated allowlist — "sync,connect" keeps
// only those modules' lines; empty (the default) keeps every module. A line
// without a module tag counts as "core" and survives only when the allowlist
// is empty. The two legacy switches — BEE_DEBUG and HIVE_DEBUG — keep their
// meaning: setting either asks for debug.
//
// The operator debug lines both sides already had ([bee-debug], [hive-debug])
// keep their own gates and gain a stamp through Stamp, because their contract
// is a bare stderr write that tests capture by swapping the variable, which a
// slog handler bound at startup would miss. Stamp applies the same module
// allowlist, so the two mechanisms filter as one.
package logx

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

// stampLayout matches the time format slog's text handler emits, so stamped
// debug lines and structured lifecycle lines interleave in one scrollback.
const stampLayout = "2006-01-02T15:04:05.000Z07:00"

// modules is the allowlist Setup installed: nil means every module speaks.
// Reads race Setup only in tests that spin several Run calls, so it lives
// behind a pointer swap rather than a plain map.
var modules atomic.Pointer[map[string]bool]

// level is the threshold Setup chose, shared by Console's loggers.
var level slog.LevelVar

// Setup installs the process-wide slog default: a text handler on stderr that
// prefixes every line with the date, time, level and the service name, drops
// records whose module is not allowlisted, and levels per TOKHIVE_LOG_LEVEL.
// Call it once at startup, before any request is served.
func Setup(service, legacyDebugEnv string) *slog.Logger {
	threshold := slog.LevelInfo
	switch strings.ToLower(strings.TrimSpace(os.Getenv("TOKHIVE_LOG_LEVEL"))) {
	case "debug":
		threshold = slog.LevelDebug
	case "warn", "warning":
		threshold = slog.LevelWarn
	case "error":
		threshold = slog.LevelError
	}
	if legacyDebugEnv != "" && os.Getenv(legacyDebugEnv) != "" {
		threshold = slog.LevelDebug
	}
	level.Set(threshold)
	var allowed map[string]bool
	if raw := os.Getenv("TOKHIVE_LOG_MODULES"); strings.TrimSpace(raw) != "" {
		allowed = make(map[string]bool)
		for _, name := range strings.Split(raw, ",") {
			if name = strings.ToLower(strings.TrimSpace(name)); name != "" {
				allowed[name] = true
			}
		}
	}
	modules.Store(&allowed)
	logger := Console(os.Stderr, service)
	slog.SetDefault(logger)
	return logger
}

// Console is a logger in Setup's format, level and module allowlist that
// writes to w rather than stderr — the Bee's operator lines on stdout, which
// must look like every other line without moving to another stream.
func Console(w io.Writer, service string) *slog.Logger {
	var allowed map[string]bool
	if current := modules.Load(); current != nil {
		allowed = *current
	}
	base := slog.NewTextHandler(w, &slog.HandlerOptions{Level: &level}).WithAttrs([]slog.Attr{slog.String("service", service)})
	return slog.New(&moduleFilter{Handler: base, allowed: allowed})
}

// DebugOn reports whether TOKHIVE_LOG_LEVEL asks for debug, so the legacy
// debug switches can honour the shared variable without giving up their own.
func DebugOn() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("TOKHIVE_LOG_LEVEL")), "debug")
}

// ModuleOn reports whether the allowlist lets a module speak. An empty
// allowlist lets everything through — the default deployment's behaviour.
func ModuleOn(module string) bool {
	allowed := modules.Load()
	if allowed == nil || len(*allowed) == 0 {
		return true
	}
	return (*allowed)[strings.ToLower(module)]
}

// Stamp writes one operator debug line to stderr led by the same time and
// level fields slog's text handler writes, after the module allowlist has had
// its say. os.Stderr is read at call
// time, not at startup, so tests can capture the line by swapping the
// variable.
func Stamp(prefix, module, format string, args ...any) {
	if !ModuleOn(module) {
		return
	}
	fmt.Fprintf(os.Stderr, "time=%s level=DEBUG %s %s\n", time.Now().Format(stampLayout), prefix, fmt.Sprintf(format, args...))
}

// moduleFilter drops records whose module attr is not allowlisted and hands
// everything else to the wrapped handler.
type moduleFilter struct {
	slog.Handler
	allowed map[string]bool
	// module is a module attr bound through WithAttrs, so it is not repeated
	// in each record; the filter has to remember it itself.
	module string
}

func (h *moduleFilter) Handle(ctx context.Context, r slog.Record) error {
	if len(h.allowed) > 0 {
		module := h.module
		r.Attrs(func(a slog.Attr) bool {
			if a.Key == "module" {
				module = a.Value.String()
				return false
			}
			return true
		})
		if !h.allowed[strings.ToLower(module)] {
			return nil
		}
	}
	return h.Handler.Handle(ctx, r)
}

func (h *moduleFilter) WithAttrs(attrs []slog.Attr) slog.Handler {
	child := &moduleFilter{Handler: h.Handler.WithAttrs(attrs), allowed: h.allowed, module: h.module}
	for _, a := range attrs {
		if a.Key == "module" {
			child.module = a.Value.String()
		}
	}
	return child
}

func (h *moduleFilter) WithGroup(name string) slog.Handler {
	return &moduleFilter{Handler: h.Handler.WithGroup(name), allowed: h.allowed, module: h.module}
}
