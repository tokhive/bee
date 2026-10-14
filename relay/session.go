package relay

import (
	"context"
	"io"
	"net"
	"sync/atomic"

	"github.com/coder/websocket"
	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tunnel"
)

// Session owns both the reference multiplexer and its underlying WebSocket.
type Session struct {
	Mux     *tunnel.Multiplexer
	Context context.Context
	cancel  context.CancelFunc
	carrier *carrier
}

func New(ctx context.Context, conn *websocket.Conn, side tunnel.Endpoint, handle func(context.Context, *tunnel.Stream, []byte)) *Session {
	live, cancel := context.WithCancel(ctx)
	carrier := &carrier{Conn: websocket.NetConn(live, conn, websocket.MessageBinary), ready: make(chan struct{}), cancel: cancel}
	conn.SetReadLimit((1 << 20) + (1 << 10))
	mux := tunnel.New(carrier, side)
	slots := make(chan struct{}, 32)
	mux.Serve(func(stream *tunnel.Stream, metadata []byte) {
		defer stream.Close()
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			return
		}
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
