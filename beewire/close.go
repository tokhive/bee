package beewire

// Close codes a Bee ends its connection to Hive with, so Hive's record of a
// disconnect says who ended it and why instead of only that it ended. They
// sit in the WebSocket range reserved for applications (4000–4999): a
// standard "normal closure" or "going away" reads as a plain end of stream
// on the tunnel and would lose the reason.
//
// A code is all Hive trusts. The reason text a close frame also carries is
// the Bee's to write, and what Hive records comes from CloseReason.
const (
	// CloseStopping: the Bee was stopped, or stopped contributing.
	CloseStopping = 4001
	// CloseStalled: the Bee's own heartbeat found the connection silent and
	// it is about to reconnect.
	CloseStalled = 4002
	// CloseSyncFailed: authorization synchronization failed, so the Bee is
	// leaving the connection rather than serve with a credential it cannot
	// vouch for.
	CloseSyncFailed = 4003
)

// CloseReason is what a close code says, or "" for a code this build does
// not know.
func CloseReason(code int) string {
	switch code {
	case CloseStopping:
		return "the Bee stopped"
	case CloseStalled:
		return "the Bee's heartbeat found the connection silent"
	case CloseSyncFailed:
		return "the Bee's authorization synchronization failed"
	}
	return ""
}
