package bee

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

func TestMenuForegroundCancellationDoesNotCreateSupply(t *testing.T) {
	m, out := pairedMenu(t, "0\n")
	if err := m.foreground(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(m.egressPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "仅保持在线") || !strings.Contains(out.String(), "Ctrl+C") {
		t.Fatal(out.String())
	}
}

func TestMenuForegroundKeepsConfigurationLock(t *testing.T) {
	m, _ := pairedMenu(t, "1\n")
	unlock, err := lockState(m.configPath)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if err = m.foreground(); err == nil {
		t.Fatal("foreground bypassed running lock")
	}
}

func TestMenuForegroundUsesExplicitEgress(t *testing.T) {
	m, _ := pairedMenu(t, "1\n")
	m.egressExplicit = true
	m.egressPath += ".missing"
	if err := m.foreground(); err == nil || !strings.Contains(err.Error(), m.egressPath) {
		t.Fatal(err)
	}
}

func TestMenuGuidedStartUsesDefaultSupplyAndRestoresSession(t *testing.T) {
	m, _ := pairedMenu(t, "")
	custom := m.egressPath + ".custom"
	m.egressPath, m.egressExplicit = custom, true
	m.configure = func() error {
		if m.egressPath != defaultEgressPath(m.configPath) || m.egressExplicit {
			t.Fatal("guided target", m.egressPath)
		}
		return context.Canceled
	}
	if err := m.guidedStart(); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if m.egressPath != custom || !m.egressExplicit {
		t.Fatal("session target lost")
	}
}

func TestMenuPairingUsesRequestedDeviceName(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(beewire.Identity{ID: "synthetic", Name: "Worker One"})
	}))
	defer server.Close()
	m, _ := menuFixture(t, server.URL+"\nWorker One\n1\n")
	if err := m.pairingWithNext(false); err != nil {
		t.Fatal(err)
	}
	state, err := readState(m.configPath)
	if err != nil || state.Name != "Worker One" {
		t.Fatal(state.Name, err)
	}
}

func TestMenuGuidedCancelPairingReturnsWithoutError(t *testing.T) {
	m, _ := menuFixture(t, "0\n")
	if err := m.guidedStart(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(m.configPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestMenuGuidedCancelAccountSetupReturnsWithoutError(t *testing.T) {
	m, _ := pairedMenu(t, "0\n")
	m.configure = func() error { return m.accountSetup(false) }
	if err := m.guidedStart(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(m.egressPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestMenuGuidedSetupCannotRedirectSupplyFile(t *testing.T) {
	m, _ := pairedMenu(t, "/tmp/another-bee-egress.json\n")
	m.configure = func() error {
		if err := m.selectEgress(); err != nil {
			return err
		}
		if m.egressPath != defaultEgressPath(m.configPath) {
			t.Fatal("guided setup changed supply target", m.egressPath)
		}
		return context.Canceled
	}
	if err := m.guidedStart(); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
