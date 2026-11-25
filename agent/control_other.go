//go:build !darwin && !linux

package bee

import (
	"errors"
	"net"
)

// listenControl is not available on this platform yet; Windows gets a named
// pipe once the desktop app supports it.
func listenControl(string) (net.Listener, error) {
	return nil, errors.New("the local control interface is not supported on this platform")
}
