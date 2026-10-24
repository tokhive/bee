package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

// version is set by release builds: -ldflags "-X main.version=v1.2.3".
var version string

func main() {
	if version != "" {
		bee.Version = version
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := runCommand(ctx, os.Args[1:]); err != nil && !(ctx.Err() != nil && errors.Is(err, ctx.Err())) {
		if len(os.Args) > 1 && os.Args[1] == "run" {
			// The long-running process ends on a line shaped like the rest
			// of its log; one-shot commands keep the bare message.
			if code, summary, fix, ok := bee.Coded(err); ok {
				slog.Error("bee stopped", "code", code, "error", summary, "fix", fix)
			} else {
				slog.Error("bee stopped", "error", err.Error())
			}
		} else {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(1)
	}
}

func runCommand(ctx context.Context, args []string) error {
	if len(args) == 0 || args[0] != "desktop" {
		return bee.Run(ctx, args, os.Stdout)
	}
	if len(args) != 1 {
		return fmt.Errorf("bee desktop received additional arguments=%d; required=0", len(args)-1)
	}
	return runDesktop(ctx, os.Stdin, os.Stdout, os.Stderr)
}

// The command owns its standard pipes. Closing them on cancellation interrupts
// native blocked I/O; desktopbridge.Run itself never closes caller-owned streams.
func runDesktop(ctx context.Context, in, out *os.File, diagnostics io.Writer) error {
	input, err := prepareDesktopPipe(in)
	if err != nil {
		return fmt.Errorf("prepare desktop input pipe: %w", err)
	}
	output, err := prepareDesktopPipe(out)
	if err != nil {
		return errors.Join(fmt.Errorf("prepare desktop output pipe: %w", err), closeDesktopPipe(input))
	}
	in, out = input, output
	managed, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	closed := make(chan error, 1)
	go func() {
		select {
		case <-managed.Done():
			closed <- errors.Join(closeDesktopPipe(in), closeDesktopPipe(out))
		case <-done:
			closed <- nil
		}
	}()
	err = desktopbridge.RunWithDevices(managed, in, cancelFailedWrite{out, cancel}, diagnostics, bee.BuildVersion(), bee.NewDesktopDevice())
	close(done)
	closeErr := <-closed
	return errors.Join(err, closeErr, closeDesktopPipe(in), closeDesktopPipe(out))
}

func closeDesktopPipe(file *os.File) error {
	err := file.Close()
	if errors.Is(err, os.ErrClosed) {
		return nil
	}
	return err
}

type cancelFailedWrite struct {
	io.Writer
	cancel context.CancelFunc
}

func (w cancelFailedWrite) Write(data []byte) (int, error) {
	n, err := w.Writer.Write(data)
	if err == nil && n != len(data) {
		err = io.ErrShortWrite
	}
	if err != nil {
		w.cancel() // Unblock the command's reader if the parent stopped reading.
	}
	return n, err
}
