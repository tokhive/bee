package bee

import (
	"context"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
)

func TestHiveRequestsCarryTheBuild(t *testing.T) {
	previous := Version
	Version = "v9.8.7"
	defer func() { Version = previous }()
	want := "tokhive-bee/v9.8.7 (" + runtime.GOOS + "/" + runtime.GOARCH + ")"
	if userAgent() != want {
		t.Fatalf("user agent %q", userAgent())
	}
	var got string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.UserAgent()
		w.Write([]byte(`{}`))
	}))
	defer server.Close()
	if err := call(context.Background(), httpClient(), server.URL, "/api/bee/status", "GET", "", nil, &struct{}{}); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("Hive saw %q", got)
	}
}
