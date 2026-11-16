//go:build !darwin

package bee

import (
	"context"
	"os/exec"
)

// The macOS adapter uses Terminal. Other platforms retain their existing
// supervisor until a native interaction adapter is available there.
func runDesktopInteractiveAuthorization(ctx context.Context, command *exec.Cmd) error {
	return runDesktopAuthorization(ctx, command)
}
