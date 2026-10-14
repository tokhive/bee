package relay

import (
	"context"
	"errors"
	"time"

	"github.com/coder/websocket"
)

// pongWait is how long Check waits for a pong before it looks at traffic.
var pongWait = 5 * time.Second

// ErrStalled means a heartbeat found the connection silent: no pong, and no
// tunnel byte moved since the previous check.
var ErrStalled = errors.New("no pong and no tunnel traffic since the last heartbeat")

// Liveness decides whether a WebSocket is still alive, one Check per
// heartbeat.
//
// A pong alone is the wrong test once the connection carries a tunnel. The
// ping is written behind whatever the tunnel has queued, so on a slow link a
// large request delays it by as long as the request takes to send — a
// megabyte at tens of kilobytes a second is most of a minute — and a pong
// deadline closes a connection that is busy rather than dead, failing the
// very request that made it busy. So a missing pong only fails the check
// when the tunnel also stood still.
//
// The ping itself carries no deadline: the library closes the connection
// when a deadline expires halfway through writing a frame, which is exactly
// what a congested link makes likely. It stays outstanding across checks
// until its pong arrives or the connection ends.
type Liveness struct {
	conn  *websocket.Conn
	moved func() uint64
	pong  chan error
	last  uint64
}

// NewLiveness checks conn. moved reports the tunnel's byte count, or is nil
// for a connection that carries no tunnel, where only a pong counts.
func NewLiveness(conn *websocket.Conn, moved func() uint64) *Liveness {
	l := &Liveness{conn: conn, moved: moved}
	l.last = l.traffic()
	return l
}

func (l *Liveness) traffic() uint64 {
	if l.moved == nil {
		return 0
	}
	return l.moved()
}

// Check pings, unless a ping is still outstanding, and reports nil when the
// pong arrives within pongWait or the tunnel moved bytes since the previous
// check. ctx bounds the ping, so it should live as long as the connection;
// the same ctx is expected on every call.
func (l *Liveness) Check(ctx context.Context) error {
	if l.pong == nil {
		pong := make(chan error, 1)
		go func() { pong <- l.conn.Ping(ctx) }()
		l.pong = pong
	}
	timer := time.NewTimer(pongWait)
	defer timer.Stop()
	select {
	case err := <-l.pong:
		l.pong = nil
		l.last = l.traffic()
		return err
	case <-timer.C:
	}
	if moved := l.traffic(); l.moved != nil && moved != l.last {
		l.last = moved
		return nil
	}
	return ErrStalled
}
