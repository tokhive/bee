package bee_test

import (
	"context"
	"flag"
	"os"
	"testing"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

var nativeBridgeAudit = flag.String("bee-native-fixture-audit", "", "controlled native integration process audit output")
var nativeLoginFixture = flag.Bool("bee-native-login-fixture", false, "enable controlled official subprocess and browser launcher")

// The Rust integration test launches this compiled test process directly.
// Keeping this external avoids an agent -> desktopbridge production cycle.
func TestDesktopNativeBridgeProcess(t *testing.T) {
	if *nativeBridgeAudit == "" {
		t.Skip("invoked only by the controlled Rust/Go integration test")
	}
	ok := t.Run("serve", func(t *testing.T) {
		device, accounts, runner, network := bee.NewDesktopNativeBridgeFixture(t, *nativeBridgeAudit)
		var authorizer *bee.DesktopAuthorizer
		if *nativeLoginFixture {
			authorizer = bee.NewDesktopNativeLoginFixture(t, accounts)
		}
		var authorization desktopbridge.Authorizer
		if authorizer != nil {
			authorization = authorizer
		}
		if err := desktopbridge.RunWithExperience(context.Background(), os.Stdin, os.Stdout, os.Stderr, "native-fixture", device, accounts, runner, authorization, nil, network); err != nil {
			t.Fatal(err)
		}
	})
	// The protocol's stdout is reserved for JSON lines. Subtest cleanup has
	// already joined owned services; do not append the testing runner's PASS.
	if !ok {
		os.Exit(1)
	}
	os.Exit(0)
}
