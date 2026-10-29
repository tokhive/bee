package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/tokhive/bee/agent"
)

// version is set by release builds: -ldflags "-X main.version=v1.2.3".
var version string

func main() {
	if version != "" {
		bee.Version = version
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := bee.Run(ctx, os.Args[1:], os.Stdout); err != nil && !errors.Is(err, context.Canceled) {
		if errors.Is(err, bee.ErrInstallHandoffCancelled) {
			os.Exit(3)
		}
		if len(os.Args) > 1 && os.Args[1] == "run" {
			// The long-running process ends on a line shaped like the rest
			// of its log; one-shot commands keep the bare message.
			if code, summary, fix, ok := bee.Coded(err); ok {
				slog.Error("bee stopped", "code", code, "error", summary, "fix", fix)
			} else {
				slog.Error("bee stopped", "error", err.Error())
			}
		} else {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(1)
	}
}
