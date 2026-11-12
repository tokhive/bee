//go:build !linux

package bee

import (
	"context"
	"fmt"
	"io"
	"runtime"
)

func installHandoff(context.Context, []string, io.Writer) error {
	return fmt.Errorf("install-handoff requires Linux /proc and pidfd; platform=%s; stop the existing Bee manually", runtime.GOOS)
}
