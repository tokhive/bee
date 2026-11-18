package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// The target-Hive UI uses RecoveryConfirm after an initial identity read fails.
// That path must preserve the same binding guard as an explicit Begin retry.
func TestInitialPairingConfirmationAfterIdentityFailure(t *testing.T) {
	for _, changed := range []bool{false, true} {
		for _, restart := range []bool{false, true} {
			name := "same-process"
			if restart {
				name = "after-restart"
			}
			if changed {
				name += "/binding-changed"
			}
			t.Run(name, func(t *testing.T) {
				var fail atomic.Bool
				fail.Store(true)
				var creates atomic.Int32
				var origin string
				server := newPairingFixtureServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method == "POST" {
						creates.Add(1)
						json.NewEncoder(w).Encode(beewire.Pairing{PairingToken: "beep_" + strings.Repeat("t", 43), UserCode: "ABCD-EFGH", VerificationURI: origin + "/devices/pair", ExpiresAt: time.Now().Add(time.Hour), PollInterval: 2, Status: "pending"})
						return
					}
					if fail.Load() {
						w.WriteHeader(503)
						w.Write([]byte(`{"error":{"code":"unavailable"}}`))
						return
					}
					w.WriteHeader(401)
					w.Write([]byte(`{"error":{"code":"invalid_device_credential"}}`))
				}))
				defer server.Close()
				origin = server.URL
				path := filepath.Join(t.TempDir(), "bee-desktop.json")
				d := newDesktopTestDevice(t, path)
				if _, err := d.Begin(context.Background(), origin, "Mac"); err == nil {
					t.Fatal("expected initial identity failure")
				}
				before, err := d.session.read()
				if err != nil {
					t.Fatal(err)
				}
				if restart {
					closeDesktopTestDevice(t, d)
					d = newDesktopTestDevice(t, path)
				}
				fail.Store(false)
				v, err := d.RecoveryStatus(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				if v.Phase != "awaiting_confirmation" || creates.Load() != 0 {
					t.Fatalf("before confirmation: phase=%s creates=%d", v.Phase, creates.Load())
				}
				original := v
				if changed {
					altered := before
					altered.Credential = "bee_" + strings.Repeat("z", 43)
					if err := d.session.save(altered); err != nil {
						t.Fatal(err)
					}
					_, err := d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "begin_pairing")
					if err == nil || !strings.Contains(err.Error(), "binding changed") || creates.Load() != 0 {
						t.Fatalf("changed binding was not blocked: creates=%d error=%v", creates.Load(), err)
					}
					after, err := d.session.read()
					if err != nil {
						t.Fatal(err)
					}
					record, err := readDesktopRecovery(&d.session)
					if err != nil {
						t.Fatal(err)
					}
					if after.Credential != altered.Credential || record.Credential != before.Credential || record.CreateAttempted {
						t.Fatal("rejected confirmation modified binding or recovery")
					}
					return
				}
				v, err = d.RecoveryConfirm(context.Background(), v.OperationID, v.Revision, "begin_pairing")
				if err != nil || v.Phase != "pending" || creates.Load() != 1 {
					t.Fatalf("initial confirmation: phase=%s creates=%d error=%v", v.Phase, creates.Load(), err)
				}
				record, err := readDesktopRecovery(&d.session)
				if err != nil {
					t.Fatal(err)
				}
				after, err := d.session.read()
				if err != nil {
					t.Fatal(err)
				}
				if record.Credential != before.Credential || after.Credential != before.Credential {
					t.Fatal("initial confirmation changed the original credential")
				}
				if _, err = d.RecoveryConfirm(context.Background(), original.OperationID, original.Revision, "begin_pairing"); err != nil || creates.Load() != 1 {
					t.Fatalf("duplicate confirmation: creates=%d error=%v", creates.Load(), err)
				}
			})
		}
	}
}
