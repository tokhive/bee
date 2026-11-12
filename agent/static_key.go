package bee

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/tokhive/tee/tee"
)

// readStaticKeyFile is shared by official API and reseller sources. The
// caller supplies its public diagnostic code; key bytes are never echoed.
func readStaticKeyFile(path, code string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fail(code, "key_file must be an absolute path")
	}
	info, err := os.Lstat(path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return "", fail(code, path+" does not exist")
	case err != nil || !info.Mode().IsRegular():
		return "", fail(code, path+" is not a readable regular file")
	case info.Mode().Perm()&0077 != 0:
		return "", failf(code, "%s has mode %04o", path, info.Mode().Perm())
	case info.Size() > 1024:
		return "", fail(code, path+" is too large for a key")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fail(code, path+" is not a readable regular file")
	}
	key := strings.TrimSpace(string(raw))
	if key == "" || strings.IndexFunc(key, unicode.IsSpace) >= 0 || (tee.Secret{Header: "authorization", Scheme: "Bearer", Token: key}).Validate() != nil {
		// The key is never echoed.
		return "", fail(code, path+" does not hold a single key")
	}
	return key, nil
}
