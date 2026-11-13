package bee

import (
	"context"
	"os"
	"os/exec"
	"testing"
)

// Only compiled into the controlled integration test executable. Neither a real
// official client nor the system browser is used by this fixture.
func NewDesktopNativeLoginFixture(t *testing.T, accounts *DesktopAccounts) *DesktopAuthorizer {
	t.Helper()
	owner := NewDesktopAuthorizer(context.Background(), accounts)
	owner.resolve = func(string) (string, error) { return os.Executable() }
	owner.command = func(program string, args ...string) *exec.Cmd {
		command := exec.Command(program, append([]string{"-test.run=^TestDesktopAuthorizeProcessHelper$", "--"}, args...)...)
		command.Env = append(os.Environ(), "BEE_AUTHORIZE_HELPER=1", "GORACE=atexit_sleep_ms=0", "BEE_AUTHORIZE_MODE=link_wait")
		return command
	}
	owner.openBrowser = func(context.Context, string) error { return nil }
	t.Cleanup(owner.Close)
	return owner
}
