package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
)

// Claude Code keeps its sign-in in the macOS Keychain, and on every other
// system in a .credentials.json file (mode 0600) in its storage directory —
// the same directory whose name the Keychain entry hashes. Both hold the same
// JSON object. Bee reads whichever the egress configuration names and never
// falls back from one to the other: a Keychain that cannot be read is not
// evidence that a stale file is the current sign-in.
const (
	claudeStoreKeychain = "keychain"
	claudeStoreFile     = "file"
)

var (
	errClaudeFileMissing     = errors.New("the Claude Code sign-in file was not found; sign in with Claude Code on this machine and check claude.config_dir")
	errClaudeFileUnavailable = errors.New("failed to read the Claude Code sign-in file; it must be a regular file readable by the user running Bee")
)

// defaultClaudeStore is where Claude Code on this system keeps its sign-in.
func defaultClaudeStore() string {
	if runtime.GOOS == "darwin" {
		return claudeStoreKeychain
	}
	return claudeStoreFile
}

// claudeStore is one Claude Code credential store, as the readers and the
// refresh maintenance use it.
type claudeStore struct {
	kind string
	// directory is Claude Code's storage directory, where its locks and
	// Bee's refresh records live.
	directory string
	// namespace tells apart stores that share a directory.
	namespace string
	// where names the store for a provider reading Bee's output.
	where         string
	readRaw       func(context.Context) ([]byte, error)
	writeRaw      func(context.Context, []byte) error
	validateWrite func([]byte) error
}

// resolveClaudeStore opens the store of kind for the Claude Code
// configuration directory, nil meaning the one Claude Code itself would use.
func resolveClaudeStore(kind string, directory *string) (claudeStore, error) {
	keychain := resolveClaudeKeychain(directory)
	switch kind {
	case claudeStoreKeychain:
		if runtime.GOOS != "darwin" {
			return claudeStore{}, fail("BEE-CLAUDE-UNSUPPORTED", runtime.GOOS)
		}
		return claudeStore{
			kind: kind, directory: keychain.directory, namespace: keychain.service + "\x00" + keychain.account,
			where: "the macOS Keychain", readRaw: keychain.readRaw, writeRaw: keychain.writeRaw,
			validateWrite: func(raw []byte) error { _, err := keychain.writeCommand(raw); return err },
		}, nil
	case claudeStoreFile:
		file := claudeFile{path: filepath.Join(keychain.directory, ".credentials.json")}
		return claudeStore{
			kind: kind, directory: keychain.directory, namespace: "file\x00" + file.path,
			where: file.path, readRaw: file.readRaw, writeRaw: file.writeRaw, validateWrite: file.validate,
		}, nil
	}
	return claudeStore{}, failf("BEE-CONFIG-CLAUDE-STORE", "store is %q", kind)
}

func (store claudeStore) read(ctx context.Context) (claudeCredential, error) {
	raw, err := store.readRaw(ctx)
	defer clear(raw)
	if err != nil {
		return claudeCredential{}, err
	}
	return parseClaudeCredential(raw)
}

type claudeFile struct{ path string }

func (file claudeFile) readRaw(context.Context) ([]byte, error) {
	info, err := os.Lstat(file.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, errClaudeFileMissing
	}
	if err != nil || !info.Mode().IsRegular() {
		// Claude Code itself refuses a symbolic link here.
		return nil, errClaudeFileUnavailable
	}
	fd, err := syscall.Open(file.path, syscall.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errClaudeFileUnavailable
	}
	opened := os.NewFile(uintptr(fd), file.path)
	defer opened.Close()
	if info, err = opened.Stat(); err != nil || !info.Mode().IsRegular() {
		return nil, errClaudeFileUnavailable
	}
	var raw credentialBuffer
	if _, err = io.Copy(&raw, opened); err != nil {
		clear(raw.Bytes())
		return nil, errClaudeFileUnavailable
	}
	defer clear(raw.Bytes())
	return bytes.Clone(bytes.TrimSpace(raw.Bytes())), nil
}

func (file claudeFile) validate(raw []byte) error {
	if len(raw) > 65536 || !json.Valid(raw) {
		return errRefreshRecovery
	}
	return nil
}

// writeRaw replaces the file the way Claude Code writes it: whole, mode
// 0600, through a rename so a reader never sees half of it. The rename also
// moves the modification time Claude Code watches to notice a new sign-in.
func (file claudeFile) writeRaw(_ context.Context, raw []byte) error {
	if err := file.validate(raw); err != nil {
		return err
	}
	if info, err := os.Lstat(file.path); err != nil || !info.Mode().IsRegular() {
		return errRefreshRecovery
	}
	return privateReplace(file.path, raw)
}
