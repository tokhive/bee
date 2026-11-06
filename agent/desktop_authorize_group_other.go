//go:build !darwin && !linux && !windows

package bee

import (
	"fmt"
	"runtime"
)

func observeDesktopAuthorizationGroup(group int) (desktopAuthorizationGroupStatus, error) {
	return desktopAuthorizationGroupStatus{}, fmt.Errorf("owned login group observation unsupported: OS=%s group=%d; required=Darwin or Linux", runtime.GOOS, group)
}
