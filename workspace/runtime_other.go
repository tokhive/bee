//go:build !linux

package workspace

import (
	"fmt"

	"github.com/tokhive/bee/beewire"
)

// checkGVisor refuses the runtime here rather than at the first session: a
// sandbox is a Linux kernel feature (namespaces, user ids), and this build has
// neither. The macOS answer is a signed app with Virtualization.framework,
// which is not this binary.
func checkGVisor(Config) error {
	return fmt.Errorf("%w: gvisor runs on Linux only", ErrUnsupportedRuntime)
}

func startGVisor(Config, beewire.WorkspaceSpec, string, string) (*process, error) {
	return nil, fmt.Errorf("%w: gvisor runs on Linux only", ErrUnsupportedRuntime)
}
