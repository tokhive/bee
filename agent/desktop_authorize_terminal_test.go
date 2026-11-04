package bee

import (
	"bufio"
	"context"
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

func TestDesktopTerminalRelayHelper(t *testing.T) {
	if os.Getenv("BEE_TERMINAL_RELAY_TEST") != "1" {
		return
	}
	session := os.Getenv("BEE_TERMINAL_SESSION")
	if session == "" {
		session = strings.Repeat("a", 64)
	}
	err := Run(context.Background(), []string{"desktop-login-terminal", os.Getenv("BEE_TERMINAL_SOCKET"), session}, os.Stdout)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(0)
}
func TestDesktopTerminalRelayCarriesOfficialPromptAndInput(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("Unix terminal transport")
	}
	dir, err := os.MkdirTemp("/tmp", "bee-terminal-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "io.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	served := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			served <- err
			return
		}
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(3 * time.Second))
		auth := make([]byte, 65)
		_, err = io.ReadFull(conn, auth)
		if err != nil {
			served <- err
			return
		}
		if string(auth) != strings.Repeat("a", 64)+"\n" {
			served <- fmt.Errorf("session authentication mismatch")
			return
		}
		if _, err = io.WriteString(conn, "Paste code here if prompted > "); err != nil {
			served <- err
			return
		}
		code, err := bufio.NewReader(conn).ReadString('\n')
		if err != nil {
			served <- err
			return
		}
		if code != "synthetic-code\n" {
			served <- fmt.Errorf("official input mismatch")
			return
		}
		_, err = io.WriteString(conn, "Synthetic official login completed\n")
		served <- err
	}()
	program, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, program, "-test.run=^TestDesktopTerminalRelayHelper$")
	command.Env = append(os.Environ(), "BEE_TERMINAL_RELAY_TEST=1", "BEE_TERMINAL_SOCKET="+path, "GORACE=atexit_sleep_ms=0")
	command.Stdin = strings.NewReader("synthetic-code\n")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("official terminal relay failed: %v; output=%s", err, output)
	}
	if err = <-served; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(output), "Paste code here if prompted > ") || !strings.Contains(string(output), "Synthetic official login completed") {
		t.Fatalf("terminal output missing: %q", output)
	}
}
