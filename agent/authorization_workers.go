package bee

import (
	"context"
	"io"
	"sync"
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
	if cfg.synchronizeOverride != nil {
		return cfg.synchronizeOverride(ctx, state, lease, out)
	}
	return cfg.sources().begin(ctx, state, lease, out)
}
