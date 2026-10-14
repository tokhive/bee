package relay_test

import (
	"context"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/relay"
)

type observer struct {
	mu    sync.Mutex
	bytes map[string]int
}

func (o *observer) Read(string, int) {}
func (o *observer) Write(direction string, n int, _ time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.bytes[direction] += n
}

func TestObservedBridgeStreamsBothWaysAndKeepsCancellationCause(t *testing.T) {
	left, buyer := net.Pipe()
	right, upstream := net.Pipe()
	defer buyer.Close()
	defer upstream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	o := &observer{bytes: map[string]int{}}
	done := make(chan relay.BridgeResult, 1)
	go func() { done <- relay.BridgeObserved(ctx, left, right, o) }()
	go buyer.Write([]byte("abc"))
	buf := make([]byte, 3)
	if _, err := io.ReadFull(upstream, buf); err != nil {
		t.Fatal(err)
	}
	go upstream.Write([]byte("xyz"))
	if _, err := io.ReadFull(buyer, buf); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case result := <-done:
		if result.Reason != "canceled" {
			t.Fatalf("close reason %q", result.Reason)
		}
	case <-time.After(time.Second):
		t.Fatal("bridge did not cancel")
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.bytes["to_upstream"] != 3 || o.bytes["to_hive"] != 3 {
		t.Fatal(o.bytes)
	}
}
