package bee_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokhive/bee/agent"
)

func TestLoginRejectsInvalidNameBeforeSavingCredential(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
	}))
	defer s.Close()
	for _, name := range []string{strings.Repeat("a", 81), "Bee\nforged log"} {
		path := filepath.Join(t.TempDir(), "bee.json")
		err := bee.Run(context.Background(), []string{"login", "--hive", s.URL, "--name", name, "--config", path}, io.Discard)
		if err == nil {
			t.Fatal("invalid name accepted")
		}
		if _, err = os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("invalid name persisted and prevents login retry")
		}
	}
}
