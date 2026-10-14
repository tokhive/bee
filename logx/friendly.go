package logx

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
)

// Readable reports whether w is a terminal a person is watching and nobody
// asked for structured lines: none of the log variables is set, and
// TOKHIVE_LOG_FORMAT is not "logfmt". A service manager, a pipe or a file
// always gets the structured format.
func Readable(w io.Writer) bool {
	for _, name := range []string{"TOKHIVE_LOG_LEVEL", "TOKHIVE_LOG_MODULES", "BEE_DEBUG"} {
		if os.Getenv(name) != "" {
			return false
		}
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("TOKHIVE_LOG_FORMAT")), "logfmt") {
		return false
	}
	file, ok := w.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// Friendly is a handler for a person at a terminal: the time of day, a mark
// for the level, the message, then only what helps them act — an error code
// in brackets, the error itself, and the fix on a line of its own. The
// platform, when there is one, leads the line.
func Friendly(w io.Writer, minimum slog.Leveler) slog.Handler {
	return &friendly{w: w, minimum: minimum, mu: &sync.Mutex{}}
}

type friendly struct {
	w       io.Writer
	minimum slog.Leveler
	mu      *sync.Mutex
	attrs   []slog.Attr
}

func (h *friendly) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.minimum.Level()
}

func (h *friendly) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := *h
	next.attrs = append(append([]slog.Attr{}, h.attrs...), attrs...)
	return &next
}

func (h *friendly) WithGroup(string) slog.Handler { return h }

func (h *friendly) Handle(_ context.Context, r slog.Record) error {
	mark := "·"
	switch {
	case r.Level >= slog.LevelError:
		mark = "✗"
	case r.Level >= slog.LevelWarn:
		mark = "!"
	}
	var platform, code, problem, fix string
	var extra []string
	visit := func(a slog.Attr) bool {
		value := a.Value.Resolve().String()
		switch a.Key {
		case "service", "module", "state":
		case "platform":
			platform = strings.ToLower(value)
		case "code":
			code = value
		case "error":
			problem = value
		case "fix":
			fix = value
		default:
			extra = append(extra, a.Key+"="+value)
		}
		return true
	}
	for _, a := range h.attrs {
		visit(a)
	}
	r.Attrs(visit)
	var line strings.Builder
	line.WriteString(r.Time.Format("15:04:05") + " " + mark + " ")
	if platform != "" {
		line.WriteString(platform + ": ")
	}
	line.WriteString(r.Message)
	if problem != "" && problem != r.Message {
		line.WriteString(": " + problem)
	}
	if code != "" {
		line.WriteString(" [" + code + "]")
	}
	if len(extra) > 0 {
		line.WriteString("  (" + strings.Join(extra, ", ") + ")")
	}
	line.WriteString("\n")
	if fix != "" {
		line.WriteString("           fix: " + fix + "\n")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := fmt.Fprint(h.w, line.String())
	return err
}
