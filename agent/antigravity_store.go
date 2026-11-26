package bee

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// antigravityStore is the file holding the Antigravity sign-in: mode 0600 in
// a 0700 directory beside the device configuration, like the credential an
// imported account keeps under accounts/.
type antigravityStore struct{ path string }

func antigravityStoreIn(configDirectory string) antigravityStore {
	return antigravityStore{path: filepath.Join(configDirectory, "accounts", "antigravity", "credentials.json")}
}

func (s antigravityStore) read() (antigravityCredential, error) {
	var credential antigravityCredential
	file, err := openRegularNoFollow(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return credential, errAntigravityMissing
	}
	if err != nil {
		return credential, fmt.Errorf("%w: %w", errAntigravityUnreadable, err)
	}
	defer file.Close()
	if err := validatePrivateFile(file); err != nil {
		return credential, fmt.Errorf("%w: %w", errAntigravityUnreadable, err)
	}
	raw, err := io.ReadAll(io.LimitReader(file, 65537))
	defer clear(raw)
	if err != nil || len(raw) > 65536 {
		return credential, fmt.Errorf("%w: %s cannot be read or exceeds 64 KiB", errAntigravityUnreadable, s.path)
	}
	// What is wrong with the content is not said: a decoding error quotes it.
	if json.Unmarshal(raw, &credential) != nil || !credential.valid() {
		return antigravityCredential{}, fmt.Errorf("%w: %s is not a complete sign-in", errAntigravityUnreadable, s.path)
	}
	// One location, so that two reads of the same file compare equal.
	credential.ExpiresAt = credential.ExpiresAt.UTC()
	return credential, nil
}

func (s antigravityStore) write(credential antigravityCredential) error {
	if !credential.valid() {
		return errors.New("refusing to store an incomplete Antigravity sign-in")
	}
	raw, err := json.MarshalIndent(credential, "", "  ")
	defer clear(raw)
	if err != nil {
		return err
	}
	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	// A link here would put the sign-in wherever it points.
	if info, err := os.Lstat(directory); err != nil || !info.IsDir() {
		return fmt.Errorf("%s must be a directory, not a link", directory)
	}
	for _, private := range []string{filepath.Dir(directory), directory} {
		if err := os.Chmod(private, 0700); err != nil {
			return err
		}
	}
	return writePrivateFile(s.path, append(raw, '\n'), ".antigravity-*")
}

// lock serializes the writers of the store: a refresh in the running Bee and
// a sign-in from another terminal. Both are short, so it waits a holder out
// for a moment before giving up.
func (s antigravityStore) lock(ctx context.Context) (func(), error) {
	deadline := time.Now().Add(5 * time.Second)
	for {
		unlock, err := lockState(filepath.Join(filepath.Dir(s.path), ".bee-oauth"))
		if err == nil {
			return unlock, nil
		}
		if time.Now().After(deadline) || pause(ctx, 100*time.Millisecond) != nil {
			return nil, fmt.Errorf("%w: %w", errAntigravityLock, err)
		}
	}
}
