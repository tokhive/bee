package bee

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDesktopOfficialTerminalSession(t *testing.T) {
	for _, mode := range []string{"complete", "cancel", "disconnect", "wrong_session", "launch_failure"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			marker := filepath.Join(t.TempDir(), "official-started")
			command := exec.Command("/bin/sh", "-c", `printf started > "$1"; printf 'Paste code here if prompted > '; IFS= read -r code; [ "$code" = synthetic-code ] || exit 7; printf 'accepted'; if [ "$2" != complete ]; then sleep 10; fi`, "official-test", marker, mode)
			var scriptPath string
			terminalDone := make(chan error, 1)
			launch := func(_ context.Context, script, path, session string) error {
				scriptPath = script
				info, err := os.Stat(filepath.Dir(script))
				if err != nil {
					return err
				}
				if info.Mode().Perm() != 0700 {
					return fmt.Errorf("session directory permissions=%o; required=700", info.Mode().Perm())
				}
				info, err = os.Stat(path)
				if err != nil {
					return err
				}
				if info.Mode().Perm() != 0600 {
					return fmt.Errorf("socket permissions=%o; required=600", info.Mode().Perm())
				}
				if mode == "launch_failure" {
					return fmt.Errorf("synthetic Terminal launch rejected")
				}
				go func() {
					conn, err := net.Dial("unix", path)
					if err != nil {
						terminalDone <- err
						return
					}
					defer conn.Close()
					conn.SetDeadline(time.Now().Add(3 * time.Second))
					if mode == "wrong_session" {
						session = strings.Repeat("0", 64)
					}
					if _, err = fmt.Fprintln(conn, session); err != nil {
						terminalDone <- err
						return
					}
					if mode == "wrong_session" {
						_, err = io.Copy(io.Discard, conn)
						terminalDone <- err
						return
					}
					reader := bufio.NewReader(conn)
					prompt := make([]byte, len("Paste code here if prompted > "))
					_, err = io.ReadFull(reader, prompt)
					if err != nil {
						terminalDone <- err
						return
					}
					if string(prompt) != "Paste code here if prompted > " {
						terminalDone <- fmt.Errorf("official prompt missing")
						return
					}
					if mode == "disconnect" {
						terminalDone <- nil
						return
					}
					if _, err = io.WriteString(conn, "synthetic-code\n"); err != nil {
						terminalDone <- err
						return
					}
					accepted := make([]byte, 8)
					_, err = io.ReadFull(reader, accepted)
					if err != nil {
						terminalDone <- err
						return
					}
					if string(accepted) != "accepted" {
						terminalDone <- fmt.Errorf("input was not accepted")
						return
					}
					if mode == "cancel" {
						cancel()
					}
					_, err = io.Copy(io.Discard, reader)
					terminalDone <- err
				}()
				return nil
			}
			err := desktopAuthorizationTerminal(ctx, command, launch)
			if mode == "complete" && err != nil {
				t.Fatal(err)
			}
			if mode != "complete" && err == nil {
				t.Fatal("required failure was reported as success")
			}
			if (mode == "cancel" || mode == "disconnect") && !errors.Is(err, context.Canceled) {
				t.Fatalf("official process was not cancelled: %v", err)
			}
			if mode != "launch_failure" {
				select {
				case terminalErr := <-terminalDone:
					if terminalErr != nil && !errors.Is(terminalErr, net.ErrClosed) {
						t.Fatal(terminalErr)
					}
				case <-time.After(time.Second):
					t.Fatal("terminal connection outlived operation")
				}
			}
			if _, err = os.Stat(filepath.Dir(scriptPath)); !os.IsNotExist(err) {
				t.Fatalf("private session was not removed: %v", err)
			}
			if mode == "wrong_session" || mode == "launch_failure" {
				if _, err = os.Stat(marker); !os.IsNotExist(err) {
					t.Fatal("official process started before terminal was ready")
				}
			}
		})
	}
}

func TestDesktopTerminalShellQuotesStayLiteral(t *testing.T) {
	value := "path with ' quote; $(printf injected) `printf injected`"
	command := exec.Command("/bin/sh", "-c", "printf '%s' "+desktopTerminalQuote(value))
	result, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result, []byte(value)) {
		t.Fatal("terminal helper argument was interpreted by shell")
	}
}

// Opt in locally; this opens an isolated synthetic prompt in macOS Terminal.
// It never invokes Claude, reads official credentials, or contributes traffic.
func TestDesktopTerminalNativeSmoke(t *testing.T) {
	if os.Getenv("BEE_NATIVE_TERMINAL_SMOKE") != "1" {
		t.Skip("set BEE_NATIVE_TERMINAL_SMOKE=1 for native synthetic input verification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	command := exec.Command("/bin/sh", "-c", `printf '\nBee synthetic input test — no Claude account is used.\nPaste synthetic code here > '; IFS= read -r code; [ "$code" = bee-synthetic-code ] || exit 7; printf '\nSynthetic code accepted. Return to Bee.\n'`)
	program, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	err = desktopAuthorizationTerminal(ctx, command, func(ctx context.Context, script, path, session string) error {
		// The Go test executable uses its subprocess helper instead of cmd/bee.main.
		body := "#!/bin/sh\nexec /usr/bin/env BEE_TERMINAL_RELAY_TEST=1 BEE_TERMINAL_SOCKET=" + desktopTerminalQuote(path) + " BEE_TERMINAL_SESSION=" + desktopTerminalQuote(session) + " " + desktopTerminalQuote(program) + " -test.run='^TestDesktopTerminalRelayHelper$'\n"
		if err := os.WriteFile(script, []byte(body), 0700); err != nil {
			return err
		}
		return exec.CommandContext(ctx, "/usr/bin/open", "-a", "Terminal", script).Run()
	})
	if err != nil {
		t.Fatal(err)
	}
}
