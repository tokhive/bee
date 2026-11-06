package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

type desktopLoginProcessLease struct {
	file *os.File
	name string
}

type desktopLoginProcessContextKey struct{}

func (a *DesktopAccounts) loginProcessLease(ctx context.Context, id string, create bool) (*desktopLoginProcessLease, error) {
	session, release, err := a.device.acquireSession(ctx)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(filepath.Dir(session.path), "login-operation-"+id+".lock")
	release()
	file, err := openDesktopLoginProcessLock(path, create)
	if err != nil {
		return nil, fmt.Errorf("original login process stop unconfirmed: operation_id=%s guard_create=%t; %w", id, create, err)
	}
	digest := sha256.Sum256([]byte(path))
	return &desktopLoginProcessLease{file: file, name: "Local\\BeeLogin-" + hex.EncodeToString(digest[:])}, nil
}

func (l *desktopLoginProcessLease) close() { _ = l.file.Close() }

func desktopLoginLeaseFromContext(ctx context.Context) *desktopLoginProcessLease {
	lease, _ := ctx.Value(desktopLoginProcessContextKey{}).(*desktopLoginProcessLease)
	return lease
}
