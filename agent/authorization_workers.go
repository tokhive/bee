package bee

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"time"
)

type synchronizedWriter struct {
	mu     sync.Mutex
	writer io.Writer
}

func (w *synchronizedWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.writer.Write(p)
}

// Each platform observes its source independently. A slow OAuth/profile query must
// not prevent another platform from renewing its Hive source observation deadline.
func (cfg *egressConfig) startSynchronization(ctx context.Context, state localState, lease string, out io.Writer) (<-chan error, func()) {
	failures := make(chan error, 1)
	var workers sync.WaitGroup
	start := func(synchronize func(context.Context, localState, string, io.Writer, bool) error, report func(io.Writer, string, string), name, platform string) {
		workers.Go(func() {
			slog.Info("authorization synchronization started", "module", "sync", "platform", name)
			first := true
			for ctx.Err() == nil {
				if err := synchronize(ctx, state, lease, out, first); err != nil && ctx.Err() == nil {
					var failure *apiFailure
					if errors.Is(err, errInboxIdentity) || errors.As(err, &failure) && (failure.Status == 401 || failure.Status == 403) {
						slog.Error("authorization synchronization stopped", "module", "sync", "platform", name, "error", err.Error())
						select {
						case failures <- err:
						default:
						}
						return
					}
					// The cause belongs in the line. This branch is the one
					// that means "something unexpected", and without it a
					// provider is told only that synchronization did not
					// confirm — the same sentence for an unreachable Hive, a
					// rejected lease and a malformed response.
					report(out, "sync_unconfirmed", name+" authorization synchronization unconfirmed; retrying; Hive will stop dispatching when the authorization synchronization deadline is reached: "+err.Error())
				}
				if first {
					workers.Go(func() { reportReadiness(ctx, state, platform, out) })
				}
				first = false
				if pause(ctx, 2*time.Second) != nil {
					return
				}
			}
		})
	}
	if cfg.Codex != nil {
		start(cfg.synchronize, cfg.accountMessage, "OpenAI", "openai")
	}
	if cfg.Claude != nil {
		start(cfg.Claude.synchronize, cfg.Claude.message, "Claude", "claude")
	}
	return failures, workers.Wait
}
