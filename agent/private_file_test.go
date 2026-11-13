package bee

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrivateFileRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	for _, name := range []string{"first", "replacement"} {
		if err := writePrivateFile(path, []byte(`{"name":"`+name+`"}`), ".private-*"); err != nil {
			t.Fatal(err)
		}
		state, err := readState(path)
		if err != nil || state.Name != name {
			t.Fatalf("private configuration round trip: name=%q; error=%v", state.Name, err)
		}
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil || len(entries) != 1 {
		t.Fatalf("temporary files remain: entries=%d; error=%v", len(entries), err)
	}
}

func TestPrivateFileRejectsSymbolicLinks(t *testing.T) {
	dir := t.TempDir()
	target, link := filepath.Join(dir, "original.json"), filepath.Join(dir, "link.json")
	if err := writePrivateFile(target, []byte(`{"name":"original"}`), ".private-*"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal("creating the symbolic-link security test requires OS support: ", err)
	}
	if _, err := readState(link); err == nil {
		t.Fatal("configuration read accepted a symbolic link")
	}
	if err := writePrivateFile(link, []byte(`{"name":"replacement"}`), ".private-*"); err == nil {
		t.Fatal("private replacement accepted a symbolic link")
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("refused replacement changed the symbolic link: error=%v", err)
	}
	state, err := readState(target)
	if err != nil || state.Name != "original" {
		t.Fatalf("refused replacement changed the original: name=%q; error=%v", state.Name, err)
	}
}

func TestPrivateFileRefreshReplacementRejectsSymbolicLinks(t *testing.T) {
	dir := t.TempDir()
	target, link := filepath.Join(dir, "auth.json"), filepath.Join(dir, "link.json")
	if err := writePrivateFile(target, []byte(`{"name":"original"}`), ".private-*"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := privateReplace(link, []byte(`{"name":"replacement"}`)); err == nil {
		t.Fatal("refresh replacement accepted a symbolic link")
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("refused refresh replacement changed the symbolic link: error=%v", err)
	}
}

func TestPrivateFileWriteFailurePreservesPreviousFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	if err := writePrivateFile(path, []byte(`{"name":"original"}`), ".private-*"); err != nil {
		t.Fatal(err)
	}
	if err := writePrivateFile(path, []byte(`{"name":"replacement"}`), "invalid/pattern"); err == nil {
		t.Fatal("temporary-file creation accepted a path separator")
	}
	state, err := readState(path)
	if err != nil || state.Name != "original" {
		t.Fatalf("failed write changed the previous configuration: name=%q; error=%v", state.Name, err)
	}
}

func TestPrivateFileRefusesDirectoryReplacement(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bee.json")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "preserve"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writePrivateFile(path, []byte(`{}`), ".private-*"); err == nil {
		t.Fatal("private replacement accepted a directory")
	}
	if raw, err := os.ReadFile(filepath.Join(path, "preserve")); err != nil || string(raw) != "original" {
		t.Fatalf("refused replacement changed directory contents: error=%v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("failed replacement left temporary files: entries=%d; error=%v", len(entries), err)
	}
}
