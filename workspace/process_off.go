//go:build !workspace_process

package workspace

import (
	"errors"

	"github.com/tokhive/bee/beewire"
)

// processRuntimeEnabled is false in a release build: the process runtime runs
// buyer commands on the Provider's own machine and is not compiled in.
const processRuntimeEnabled = false

func startProcess(beewire.WorkspaceSpec, string) (*process, error) {
	return nil, errors.New("workspace: the process runtime is not in this build")
}
