package bee

import (
	"context"
	"fmt"
	"io"
	"net"
	"path/filepath"
	"time"
)

// The helper relays directly to the official interaction terminal. Its stream
// never enters the desktop protocol, logging, or a credential file.
func desktopLoginTerminal(ctx context.Context, args []string, in io.Reader, out io.Writer) error {
	if len(args) != 2 || !filepath.IsAbs(args[0]) || !desktopHexID(args[1], 32) {
		return fmt.Errorf("official terminal arguments rejected: required=absolute socket and 64-character session ID")
	}
	conn, err := net.DialTimeout("unix", args[0], 5*time.Second)
	if err != nil {
		return fmt.Errorf("connect official interaction terminal: %w", err)
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if _, err = fmt.Fprintln(conn, args[1]); err != nil {
		return fmt.Errorf("authenticate official interaction terminal: %w", err)
	}
	go func() {
		_, _ = io.Copy(conn, in)
		if socket, ok := conn.(*net.UnixConn); ok {
			_ = socket.CloseWrite()
		}
	}()
	_, err = io.Copy(out, conn)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return fmt.Errorf("read official interaction terminal: %w", err)
	}
	return nil
}
