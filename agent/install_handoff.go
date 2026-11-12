package bee

import "errors"

// ErrInstallHandoffCancelled lets the installer distinguish a declined handoff
// from a failed identity check. The CLI maps it to exit status 3.
var ErrInstallHandoffCancelled = errors.New("installation process handoff cancelled")
