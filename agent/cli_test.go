package bee_test

import (
	"bytes"
	"context"
	"encoding/json"
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

func TestVersionNeedsNoConfiguration(t *testing.T) {
	previous := bee.Version
	bee.Version = "v9.8.7"
	defer func() { bee.Version = previous }()
	for _, command := range []string{"version", "--version"} {
		var out bytes.Buffer
		if err := bee.Run(context.Background(), []string{command}, &out); err != nil {
			t.Fatal(command, err)
		}
		if !strings.HasPrefix(out.String(), "bee v9.8.7 ") {
			t.Fatalf("%s printed %q", command, out.String())
		}
	}
}

func TestHelpIsAnAnswerNotAnError(t *testing.T) {
	for _, args := range [][]string{nil, {"help"}, {"--help"}, {"-h"}} {
		var out bytes.Buffer
		if err := bee.Run(context.Background(), args, &out); err != nil || !strings.Contains(out.String(), "bee start [--hive URL]") {
			t.Fatalf("%v: %v %q", args, err, out.String())
		}
	}
	for _, command := range []string{"start", "login", "run", "setup", "doctor"} {
		var out bytes.Buffer
		if err := bee.Run(context.Background(), []string{command, "-h"}, &out); err != nil || !strings.Contains(out.String(), "-config") {
			t.Fatalf("%s -h: %v %q", command, err, out.String())
		}
	}
	if err := bee.Run(context.Background(), []string{"strat"}, io.Discard); err == nil || !strings.Contains(err.Error(), "bee help") {
		t.Fatalf("unknown command: %v", err)
	}
}

func TestLoginPairsWithTheDefaultHiveWhenNoneIsGiven(t *testing.T) {
	hits := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(400)
	}))
	defer s.Close()
	previous := bee.DefaultHive
	bee.DefaultHive = s.URL
	defer func() { bee.DefaultHive = previous }()
	path := filepath.Join(t.TempDir(), "bee.json")
	_ = bee.Run(context.Background(), []string{"login", "--config", path}, io.Discard)
	if hits == 0 {
		t.Fatal("login without --hive did not contact the default Hive")
	}
	if hive := savedHive(t, path); hive != s.URL {
		t.Fatalf("saved Hive %q, want %q", hive, s.URL)
	}
}

func TestLoginReadsABareHostAsHTTPS(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	_ = bee.Run(context.Background(), []string{"login", "--hive", " localhost:1 ", "--config", path}, io.Discard)
	if hive := savedHive(t, path); hive != "https://localhost:1" {
		t.Fatalf("saved Hive %q, want https://localhost:1", hive)
	}
}

func savedHive(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Hive string `json:"hive"`
	}
	if err = json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	return state.Hive
}
