package bee

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"

	"github.com/tokhive/bee/logx"
)

// console is where bee run prints its operator lines: still stdout, as
// supervisors and tests read them there, but each line a structured record
// with the same time, level and service fields as the log on stderr.
type console struct {
	logger *slog.Logger
	// Optional menu presentation, called only after a successful Hive handshake.
	onConnected func()
}

func newConsole(out io.Writer) *console {
	if c, ok := out.(*console); ok {
		return c
	}
	if logx.Readable(out) {
		return &console{logger: slog.New(logx.Friendly(out, slog.LevelInfo))}
	}
	return &console{logger: logx.Console(out, "bee")}
}

// Write turns each line it is handed into an INFO record, so a line printed
// without notify still carries a time and level.
func (c *console) Write(p []byte) (int, error) {
	for _, line := range bytes.Split(bytes.TrimRight(p, "\n"), []byte("\n")) {
		if len(bytes.TrimSpace(line)) > 0 {
			c.logger.Info(string(line), "module", "console")
		}
	}
	return len(p), nil
}

// supplyStateLevel is how loud a platform's supply state change is: ready is
// news, anything else means new jobs are not being taken.
func supplyStateLevel(state string) slog.Level {
	if state == "ready" {
		return slog.LevelInfo
	}
	return slog.LevelWarn
}

// notify prints one operator line at level. On the run console it becomes a
// structured record tagged with module and attrs; anywhere else — a one-shot
// command, a test's buffer — it stays the bare sentence.
func notify(out io.Writer, level slog.Level, module, message string, attrs ...any) {
	if c, ok := out.(*console); ok {
		c.logger.Log(context.Background(), level, message, append([]any{"module", module}, attrs...)...)
		return
	}
	fmt.Fprintln(out, message)
}

// notifyConnected keeps the original runtime log and lets an interactive menu
// emphasize connection success without interpreting rendered log text.
func notifyConnected(out io.Writer, endpoint string) {
	notify(out, slog.LevelInfo, "connect", "Bee connected to Hive", "endpoint", endpoint)
	if c, ok := out.(*console); ok && c.onConnected != nil {
		c.onConnected()
	}
}
