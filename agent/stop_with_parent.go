package bee

import "io"

// stopWhenClosed calls stop once r reaches its end or fails. A parent that
// starts Bee with a pipe on its standard input and keeps the write end open
// holds it up; when the parent is gone, however it ended, the system closes
// the pipe and Bee stops the way it does on SIGTERM instead of running on
// with nothing to manage it.
func stopWhenClosed(r io.Reader, stop func()) {
	io.Copy(io.Discard, r)
	stop()
}
