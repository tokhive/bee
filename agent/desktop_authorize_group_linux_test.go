package bee

import (
	"errors"
	"io/fs"
	"os"
	"slices"
	"strings"
	"syscall"
	"testing"
	"testing/fstest"
)

type authorizationProcReadFailure struct {
	fstest.MapFS
	err error
}

func (proc authorizationProcReadFailure) ReadFile(name string) ([]byte, error) {
	if name == "11/stat" {
		return nil, &os.PathError{Op: "read", Path: "/proc/11/stat", Err: proc.err}
	}
	return fs.ReadFile(proc.MapFS, name)
}

func TestDesktopAuthorizationProcReadDuringExit(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		gone bool
	}{
		{"entry removed before open", syscall.ENOENT, true},
		{"process exits during read", syscall.ESRCH, true},
		{"permission denied", syscall.EACCES, false},
		{"operation not permitted", syscall.EPERM, false},
		{"io failure", syscall.EIO, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proc := authorizationProcReadFailure{MapFS: fstest.MapFS{
				"11/stat": {Data: []byte("11 (exiting) R 1 10")},
				"12/stat": {Data: []byte("12 (still alive) R 1 10")},
			}, err: tc.err}
			got, err := observeDesktopAuthorizationProcGroup(10, proc, func(int) (int, error) { return 10, nil })
			if !tc.gone {
				if !errors.Is(err, tc.err) || !strings.Contains(err.Error(), "pid=11 group=10") {
					t.Fatalf("read failure lost evidence: got=%+v err=%v want=%v", got, err, tc.err)
				}
				return
			}
			if err != nil {
				t.Fatalf("exited process rejected: %v", err)
			}
			if got.live != 1 || got.moving != 1 || !slices.Equal(got.members, []int{12}) {
				t.Fatalf("remaining live process not retained: %+v", got)
			}
		})
	}
}

func TestDesktopAuthorizationProcStateEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, stat   string
		live, moving int
		wantError    string
	}{
		{"running with command delimiters", "11 (name ) with spaces) R 1 10", 1, 1, ""},
		{"stopped", "11 (child) T 1 10", 1, 0, ""},
		{"traced", "11 (child) t 1 10", 1, 0, ""},
		{"zombie", "11 (child) Z 1 10", 0, 0, ""},
		{"dead", "11 (child) X 1 10", 0, 0, ""},
		{"changed group", "11 (child) R 1 20", 0, 0, "group changed"},
		{"invalid group", "11 (child) R 1 unknown", 0, 0, "group changed"},
		{"missing command", "11 child R 1 10", 0, 0, "missing command boundary"},
		{"incomplete stat", "11 (child) R", 0, 0, "fields=1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proc := fstest.MapFS{"11/stat": {Data: []byte(tc.stat)}}
			got, err := observeDesktopAuthorizationProcGroup(10, proc, func(int) (int, error) { return 10, nil })
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("invalid observation accepted: status=%+v err=%v want=%s", got, err, tc.wantError)
				}
				return
			}
			if err != nil || got.live != tc.live || got.moving != tc.moving || !slices.Equal(got.members, []int{11}) {
				t.Fatalf("unexpected process state: got=%+v err=%v want live=%d moving=%d", got, err, tc.live, tc.moving)
			}
		})
	}
}
