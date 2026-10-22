package relay

import (
	"context"
	"io"
	"log/slog"
	"net"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/tokhive/tee/tunnel"
)

// Session owns both the reference multiplexer and its underlying WebSocket.
type Session struct {
	Mux     *tunnel.Multiplexer
	Context context.Context
	cancel  context.CancelFunc
	carrier *carrier
}

// Stream bounds for the two kinds of tunnel. A stream is one upstream TCP
// connection, and it stays open while the TEE keeps that connection idle in its
// pool (five minutes), so a bound counts idle connections as well as busy ones.
const (
	// HubStreams bounds the TEE's tunnel to Hive. The TEE carries every
	// provider connection in the market over that one tunnel, so this is the
	// market's concurrent upstream connections. It matches the tunnel
	// library's own default.
	HubStreams = tunnel.DefaultMaxStreams
	// BeeStreams bounds one Bee's tunnel: the upstream connections of its
	// accounts. An account takes at most 16 requests at once by plan, and
	// the TEE pools at most 32 connections per account and host.
	BeeStreams = 128
)

// Options tunes a Session.
type Options struct {
	// MaxStreams bounds the streams handled at once; zero means BeeStreams.
	MaxStreams int
	// Refused, when set, is called for each stream refused at the bound.
	Refused func()
}

// refusedLogEvery spaces out the warning for refused streams, so a burst at
// the bound says so without flooding the log.
const refusedLogEvery = time.Minute

func New(ctx context.Context, conn *websocket.Conn, side tunnel.Endpoint, handle func(context.Context, *tunnel.Stream, []byte), options Options) *Session {
	live, cancel := context.WithCancel(ctx)
	carrier := &carrier{Conn: websocket.NetConn(live, conn, websocket.MessageBinary), ready: make(chan struct{}), cancel: cancel}
	conn.SetReadLimit((1 << 20) + (1 << 10))
	limit := options.MaxStreams
	if limit <= 0 {
		limit = BeeStreams
	}
	// The tunnel's own bound sits above this one, so a refusal is always
	// this session's — counted and logged — rather than the library's silent one.
	mux := tunnel.NewLimited(carrier, side, limit+64)
	slots := make(chan struct{}, limit)
	var refused atomic.Uint64
	var lastLogged atomic.Int64
	mux.Serve(func(stream *tunnel.Stream, metadata []byte) {
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			// Reset, not close: the peer must not take a refused connection
			// for one the upstream ended.
			_ = stream.Reset()
			total := refused.Add(1)
			if options.Refused != nil {
				options.Refused()
			}
			now := time.Now().UnixNano()
			if last := lastLogged.Load(); now-last >= int64(refusedLogEvery) && lastLogged.CompareAndSwap(last, now) {
				slog.Warn("relay stream refused: tunnel at its stream limit", "module", "relay", "limit", limit, "refused", total)
			}
			return
		}
		defer stream.Close()
		if handle != nil && live.Err() == nil {
			handle(live, stream, metadata)
		}
	})
	close(carrier.ready)
	context.AfterFunc(live, func() { conn.CloseNow(); mux.Close() })
	return &Session{Mux: mux, Context: live, cancel: cancel, carrier: carrier}
}

func (s *Session) Close() { s.cancel() }

// Moved is how many tunnel bytes have crossed the WebSocket so far, in both
// directions.
func (s *Session) Moved() uint64 { return s.carrier.moved.Load() }

type carrier struct {
	net.Conn
	ready  chan struct{}
	cancel context.CancelFunc
	moved  atomic.Uint64
}

func (c *carrier) Read(p []byte) (int, error) {
	<-c.ready
	n, err := c.Conn.Read(p)
	c.moved.Add(uint64(n))
	if err != nil {
		c.cancel()
	}
	return n, err
}

func (c *carrier) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	c.moved.Add(uint64(n))
	if err != nil {
		c.cancel()
	}
	return n, err
}

func Bridge(ctx context.Context, left, right io.ReadWriteCloser) {
	BridgeObserved(ctx, left, right, nil)
}
