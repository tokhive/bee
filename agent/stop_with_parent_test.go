package bee

import (
	"io"
	"testing"
	"time"
)

func TestStopsWhenTheParentsPipeCloses(t *testing.T) {
	reader, writer := io.Pipe()
	stopped := make(chan struct{})
	go stopWhenClosed(reader, func() { close(stopped) })

	// Anything the parent writes is ignored and does not stop Bee.
	if _, err := writer.Write([]byte("noise")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stopped:
		t.Fatal("stopped while the parent was still there")
	case <-time.After(100 * time.Millisecond):
	}

	writer.Close()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("did not stop after the parent's pipe closed")
	}
}

func TestStopsWhenTheParentsPipeBreaks(t *testing.T) {
	reader, writer := io.Pipe()
	stopped := make(chan struct{})
	go stopWhenClosed(reader, func() { close(stopped) })
	writer.CloseWithError(io.ErrClosedPipe)
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("did not stop after the pipe failed")
	}
}
