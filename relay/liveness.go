package relay

import (
	"context"
	"errors"
	"time"

	"github.com/coder/websocket"
)

// pongWait is how long Check waits for a pong before it looks at traffic.
var pongWait = 5 * time.Second

// stallLimit is how long a connection may stay silent — no pong, no tunnel
// byte — before Check gives up on it. A proxy in the path can hold an idle
// connection still for several seconds and then carry on: through the
// cross-border proxy one dev provider runs Bee behind, a long-lived
// connection to Hive stalled for ten seconds and recovered, where giving up
// after one pong wait had ended such connections a few times an hour. A link
// that stopped carrying anything is still found, only later: a reconnect
// replaces it, and an attempt that was waiting on it is retried.
var stallLimit = 15 * time.Second

// ErrStalled means the connection stayed silent for stallLimit: no pong, and
// no tunnel byte moved.
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
	// heard is when the connection last showed it carries data: a pong
	// arrived or the tunnel moved bytes.
	heard time.Time
}

// NewLiveness checks conn. moved reports the tunnel's byte count, or is nil
// for a connection that carries no tunnel, where only a pong counts.
func NewLiveness(conn *websocket.Conn, moved func() uint64) *Liveness {
	l := &Liveness{conn: conn, moved: moved, heard: time.Now()}
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
// pong arrives within pongWait, the tunnel moved bytes since the previous
// check, or the connection was last heard from less than stallLimit ago. A
// pong that arrives late still counts. ctx bounds the ping, so it should live
// as long as the connection; the same ctx is expected on every call.
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
		if err == nil {
			l.heard = time.Now()
		}
		return err
	case <-timer.C:
	}
	if moved := l.traffic(); l.moved != nil && moved != l.last {
		l.last = moved
		l.heard = time.Now()
		return nil
	}
	if time.Since(l.heard) < stallLimit {
		return nil
	}
	return ErrStalled
}
