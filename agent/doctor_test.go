package bee_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/beewire"
)

type doctorCheck struct {
	Name, Platform, Status, Detail, Code, Fix string
	Admin                                     bool
}

type doctorReport struct {
	OK     bool
	Checks []doctorCheck
}

// fakeHive answers the three reads doctor makes.
type fakeHive struct {
	identityStatus int
	identityCode   string
	accounts       map[string]beewire.PlatformAccount
	supply         map[string]beewire.PlatformSupply
}

func (h *fakeHive) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	switch {
	case r.URL.Path == "/api/bee/identity":
		if h.identityStatus != 0 {
			w.WriteHeader(h.identityStatus)
			json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": h.identityCode}})
			return
		}
		json.NewEncoder(w).Encode(beewire.Identity{ID: "device-1", Name: "doctor", OwnerEmail: "provider@example.com"})
	case strings.HasSuffix(r.URL.Path, "/account"):
		platform := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/bee/platforms/"), "/account")
		json.NewEncoder(w).Encode(h.accounts[platform])
	default:
		platform := strings.TrimPrefix(r.URL.Path, "/api/bee/platforms/")
		json.NewEncoder(w).Encode(h.supply[platform])
	}
}

func readyHive() *fakeHive {
	return &fakeHive{
		accounts: map[string]beewire.PlatformAccount{
			"openai": {Platform: "openai", Status: "ready", AccountFingerprint: strings.Repeat("ab", 32), Generation: 1},
			"claude": {Platform: "claude", Status: "not_configured"},
		},
		supply: map[string]beewire.PlatformSupply{
			"openai": {Platform: "openai", Ready: true, Reasons: []string{}},
			"claude": {Platform: "claude", Reasons: []string{beewire.ReasonNotConfigured}},
		},
	}
}

// doctorFixture writes a paired device configuration for hive and an egress
// configuration supplying Codex from a synthetic official sign-in.
func doctorFixture(t *testing.T, hive string, expires time.Time) (config, egress string) {
	t.Helper()
	directory := t.TempDir()
	config = filepath.Join(directory, "bee.json")
	state, _ := json.Marshal(map[string]any{
		"hive": hive, "name": "doctor", "credential": "bee_" + strings.Repeat("A", 43),
		"identity": beewire.Identity{ID: "device-1", Name: "doctor", OwnerEmail: "provider@example.com"},
	})
	auth, _ := json.Marshal(codexSample(expires))
	egress = filepath.Join(directory, "egress.json")
	cfg, _ := json.Marshal(map[string]any{"targets": []string{"chatgpt.com:443"}, "codex": map[string]string{"home": directory, "store": "file"}})
	for path, raw := range map[string][]byte{config: state, filepath.Join(directory, "auth.json"): auth, egress: cfg} {
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return config, egress
}

func runDoctor(t *testing.T, args ...string) (doctorReport, error) {
	t.Helper()
	var out bytes.Buffer
	err := bee.Run(context.Background(), append([]string{"doctor", "--json"}, args...), &out)
	var report doctorReport
	if json.Unmarshal(out.Bytes(), &report) != nil {
		t.Fatalf("doctor output is not JSON: %s", out.String())
	}
	return report, err
}

func status(report doctorReport, name, platform string) doctorCheck {
	for _, c := range report.Checks {
		if c.Name == name && c.Platform == platform {
			return c
		}
	}
	return doctorCheck{}
}

func TestDoctorPassesWhenEverythingIsReady(t *testing.T) {
	hive := httptest.NewServer(readyHive())
	defer hive.Close()
	config, egress := doctorFixture(t, hive.URL, time.Now().Add(time.Hour))
	report, err := runDoctor(t, "--config", config, "--egress-config", egress)
	if err != nil || !report.OK {
		t.Fatalf("%v %+v", err, report)
	}
	for _, c := range report.Checks {
		if c.Status != "pass" {
			t.Fatalf("unexpected %+v", c)
		}
		if c.Platform == "claude" {
			t.Fatal("doctor checked a platform the egress configuration does not supply")
		}
	}
	var human bytes.Buffer
	if err := bee.Run(context.Background(), []string{"doctor", "--config", config, "--egress-config", egress}, &human); err != nil || !strings.Contains(human.String(), "No problems found.") {
		t.Fatalf("%v %s", err, human.String())
	}
}

// Doctor only reads, so it runs while bee run holds the configuration lock.
func TestDoctorRunsBesideALockedConfiguration(t *testing.T) {
	hive := httptest.NewServer(readyHive())
	defer hive.Close()
	config, egress := doctorFixture(t, hive.URL, time.Now().Add(time.Hour))
	lock, err := os.OpenFile(config+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	if report, err := runDoctor(t, "--config", config, "--egress-config", egress); err != nil || !report.OK {
		t.Fatalf("%v %+v", err, report)
	}
}

func TestDoctorSkipsWhatDependsOnAFailedCheck(t *testing.T) {
	hive := httptest.NewServer(readyHive())
	defer hive.Close()

	t.Run("not paired", func(t *testing.T) {
		_, egress := doctorFixture(t, hive.URL, time.Now().Add(time.Hour))
		report, err := runDoctor(t, "--config", filepath.Join(t.TempDir(), "absent.json"), "--egress-config", egress)
		if err == nil || report.OK || status(report, "device", "").Code != "BEE-DEVICE-NOT-PAIRED" {
			t.Fatalf("%v %+v", err, report)
		}
		for _, name := range []string{"hive", "account", "supply"} {
			platform := ""
			if name != "hive" {
				platform = "openai"
			}
			if c := status(report, name, platform); c.Status != "skip" || c.Detail == "" {
				t.Fatalf("%s not skipped with a reason: %+v", name, c)
			}
		}
		// The local checks do not depend on pairing and still run.
		if status(report, "authorization", "openai").Status != "pass" {
			t.Fatalf("%+v", report)
		}
	})

	t.Run("broken egress", func(t *testing.T) {
		config, egress := doctorFixture(t, hive.URL, time.Now().Add(time.Hour))
		os.WriteFile(egress, []byte(`{"targets": ["api.anthropic.com:443"], "codex": {"home": "/x", "store": "file"}}`), 0600)
		report, err := runDoctor(t, "--config", config, "--egress-config", egress)
		if err == nil || status(report, "egress", "").Code != "BEE-CONFIG-TARGET-MISSING" {
			t.Fatalf("%v %+v", err, report)
		}
		if status(report, "hive", "").Status != "pass" {
			t.Fatal("Hive check depends only on the device configuration")
		}
	})

	t.Run("unreachable Hive", func(t *testing.T) {
		closed := httptest.NewServer(readyHive())
		closed.Close()
		config, egress := doctorFixture(t, closed.URL, time.Now().Add(time.Hour))
		report, _ := runDoctor(t, "--config", config, "--egress-config", egress)
		if status(report, "hive", "").Code != "BEE-HIVE-UNREACHABLE" || status(report, "supply", "openai").Status != "skip" {
			t.Fatalf("%+v", report)
		}
	})
}

func TestDoctorNamesHiveCredentialProblems(t *testing.T) {
	for _, test := range []struct {
		status int
		code   string
		want   string
	}{
		{401, "invalid_device_credential", "BEE-HIVE-CREDENTIAL"},
		{401, "device_replaced", "BEE-DEVICE-REPLACED"},
		{500, "internal_error", "BEE-HIVE-ERROR"},
	} {
		h := readyHive()
		h.identityStatus, h.identityCode = test.status, test.code
		hive := httptest.NewServer(h)
		config, egress := doctorFixture(t, hive.URL, time.Now().Add(time.Hour))
		report, err := runDoctor(t, "--config", config, "--egress-config", egress)
		hive.Close()
		if err == nil || status(report, "hive", "").Code != test.want {
			t.Fatalf("%s: %v %+v", test.code, err, report)
		}
	}
}

func TestDoctorExplainsEachSupplyReasonOnce(t *testing.T) {
	h := readyHive()
	h.accounts["openai"] = beewire.PlatformAccount{Platform: "openai", Status: "confirmation_required"}
	h.supply["openai"] = beewire.PlatformSupply{Platform: "openai", Reasons: []string{
		beewire.AccountReason("openai", "confirmation_required"), beewire.ReasonManuallyPaused, beewire.ReasonPlanNotConfigured,
	}}
	hive := httptest.NewServer(h)
	defer hive.Close()
	config, egress := doctorFixture(t, hive.URL, time.Now().Add(time.Hour))
	report, err := runDoctor(t, "--config", config, "--egress-config", egress)
	if err == nil || report.OK {
		t.Fatal("doctor passed a platform that takes no work")
	}
	seen := map[string]doctorCheck{}
	for _, c := range report.Checks {
		if c.Status == "fail" {
			if _, again := seen[c.Code]; again {
				t.Fatalf("reason %s reported twice", c.Code)
			}
			seen[c.Code] = c
		}
	}
	if seen["codex_confirmation_required"].Name != "account" || !strings.Contains(seen["codex_confirmation_required"].Fix, "confirm-account") {
		t.Fatalf("%+v", seen)
	}
	if !strings.Contains(seen["manually_paused"].Fix, "--platform openai") || seen["manually_paused"].Admin {
		t.Fatalf("%+v", seen["manually_paused"])
	}
	if !seen["plan_not_configured"].Admin {
		t.Fatal("an administrator's problem was not marked as theirs")
	}
	var human bytes.Buffer
	bee.Run(context.Background(), []string{"doctor", "--config", config, "--egress-config", egress}, &human)
	if !strings.Contains(human.String(), "fix (administrator):") || !strings.Contains(human.String(), "[manually_paused]") {
		t.Fatal(human.String())
	}
}

func TestDoctorWarnsOnAnExpiredCodexToken(t *testing.T) {
	hive := httptest.NewServer(readyHive())
	defer hive.Close()
	config, egress := doctorFixture(t, hive.URL, time.Now().Add(-time.Hour))
	report, err := runDoctor(t, "--config", config, "--egress-config", egress)
	if c := status(report, "authorization", "openai"); c.Status != "warn" || c.Code != "BEE-CODEX-EXPIRED" {
		t.Fatalf("%+v", c)
	}
	// Hive schedules the refresh, so an expired token alone is not a failure.
	if err != nil || !report.OK {
		t.Fatalf("%v %+v", err, report)
	}
}

// Like bee run, doctor uses the egress.json bee setup wrote when it is given
// none, so a provider checks everything with plain bee doctor.
func TestDoctorFindsTheEgressConfigurationSetupWrote(t *testing.T) {
	hive := httptest.NewServer(readyHive())
	defer hive.Close()
	config, egress := doctorFixture(t, hive.URL, time.Now().Add(time.Hour))
	if egress != filepath.Join(filepath.Dir(config), "egress.json") {
		t.Fatal("fixture no longer writes egress.json beside the device configuration")
	}
	report, err := runDoctor(t, "--config", config)
	if err != nil || !report.OK || status(report, "egress", "").Status != "pass" || status(report, "authorization", "openai").Status != "pass" {
		t.Fatalf("%v %+v", err, report)
	}
}

func TestDoctorWithoutEgressReportsOnlyWhatHiveSees(t *testing.T) {
	hive := httptest.NewServer(readyHive())
	defer hive.Close()
	config, egress := doctorFixture(t, hive.URL, time.Now().Add(time.Hour))
	if err := os.Remove(egress); err != nil {
		t.Fatal(err)
	}
	report, err := runDoctor(t, "--config", config)
	if err != nil || !report.OK {
		t.Fatalf("%v %+v", err, report)
	}
	if status(report, "egress", "").Status != "skip" || status(report, "supply", "openai").Status != "pass" || status(report, "account", "claude").Status != "skip" {
		t.Fatalf("%+v", report)
	}
}
