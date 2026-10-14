package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/logx"
)

// check is one line of bee doctor's report.
type check struct {
	Name     string `json:"name"`
	Platform string `json:"platform,omitempty"`
	// Status is pass, warn, fail or skip. Only fail makes doctor exit non-zero.
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
	Code   string `json:"code,omitempty"`
	Fix    string `json:"fix,omitempty"`
	// Admin marks a problem the market's administrator, not the provider, resolves.
	Admin bool `json:"admin,omitempty"`
}

type doctorReport struct {
	OK     bool    `json:"ok"`
	Checks []check `json:"checks"`
}

func (r *doctorReport) add(c check) { r.Checks = append(r.Checks, c) }

func (r *doctorReport) pass(name, platform, detail string) {
	r.add(check{Name: name, Platform: platform, Status: "pass", Detail: detail})
}

func (r *doctorReport) skip(name, platform, why string) {
	r.add(check{Name: name, Platform: platform, Status: "skip", Detail: why})
}

// problem records a catalogued error as a failure, or as a warning when the
// condition does not by itself stop supply.
func (r *doctorReport) problem(name, platform, status string, err error) {
	code, summary, fix, ok := Coded(err)
	if !ok {
		code, summary, fix = "", err.Error(), ""
	}
	r.add(check{Name: name, Platform: platform, Status: status, Code: code, Detail: summary, Fix: fix})
}

// reason records a supply reason Hive gave, explained from the shared catalog.
func (r *doctorReport) reason(name, platform, reason string) {
	explained, ok := beewire.ExplainReason(reason, platform)
	if !ok {
		r.add(check{Name: name, Platform: platform, Status: "fail", Code: reason, Detail: "[" + reason + "] reason this Bee version does not know"})
		return
	}
	r.add(check{Name: name, Platform: platform, Status: "fail", Code: reason, Detail: "[" + reason + "] " + explained.Cause, Fix: explained.Fix, Admin: explained.Admin})
}

var errDoctorFailed = errors.New("bee doctor found problems; see the report above")

func doctor(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee doctor", flag.ContinueOnError)
	flags.SetOutput(out)
	configPath := flags.String("config", "", "device configuration file")
	egressPath := flags.String("egress-config", "", "egress configuration file")
	asJSON := flags.Bool("json", false, "print the report as JSON")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	if *configPath == "" {
		directory, err := os.UserConfigDir()
		if err != nil {
			return errors.New("failed to locate user configuration directory; use --config")
		}
		*configPath = filepath.Join(directory, "tokhive", "bee.json")
	}
	if !logx.DebugOn() {
		// Every failure is in the report; the request log would say it twice.
		slog.SetDefault(slog.New(slog.DiscardHandler))
	}
	report := diagnose(ctx, *configPath, *egressPath)
	if *asJSON {
		if err := json.NewEncoder(out).Encode(report); err != nil {
			return err
		}
	} else {
		printReport(out, report)
	}
	if !report.OK {
		return errDoctorFailed
	}
	return nil
}

// diagnose runs every check in dependency order. It only reads: it submits no
// envelope, confirms no account and changes no pause, so it is safe beside a
// running bee run and takes no configuration lock.
func diagnose(ctx context.Context, configPath, egressPath string) doctorReport {
	var report doctorReport
	state, deviceOK := checkDevice(&report, configPath)

	platforms := []string{"openai", "claude"}
	var egress *egressConfig
	switch {
	case egressPath == "":
		report.skip("egress", "", "no --egress-config given; account checks show only what Hive sees")
	default:
		cfg, err := readEgress(ctx, egressPath)
		if err != nil {
			report.problem("egress", "", "fail", err)
		} else {
			egress = cfg
			platforms = configuredPlatforms(cfg)
			report.pass("egress", "", fmt.Sprintf("%s supplies %s", egressPath, strings.Join(platforms, " and ")))
		}
	}
	for _, platform := range platforms {
		switch {
		case egressPath == "":
		case egress == nil:
			report.skip("authorization", platform, "egress configuration failed")
		default:
			checkAuthorization(ctx, &report, egress, platform)
		}
	}

	hiveOK := false
	if !deviceOK {
		report.skip("hive", "", "device configuration failed")
	} else {
		hiveOK = checkHive(ctx, &report, state)
	}
	for _, platform := range platforms {
		if !hiveOK {
			report.skip("account", platform, "Hive check failed")
			report.skip("supply", platform, "Hive check failed")
			continue
		}
		checkPlatform(ctx, &report, state, platform, egress != nil)
	}

	report.OK = true
	for _, c := range report.Checks {
		if c.Status == "fail" {
			report.OK = false
		}
	}
	return report
}

func configuredPlatforms(cfg *egressConfig) []string {
	var platforms []string
	if cfg.Codex != nil {
		platforms = append(platforms, "openai")
	}
	if cfg.Claude != nil {
		platforms = append(platforms, "claude")
	}
	if len(platforms) == 0 {
		// A static credential supplies through no official account.
		return nil
	}
	return platforms
}

func checkDevice(report *doctorReport, path string) (localState, bool) {
	state, err := readState(path)
	switch {
	case err != nil:
		report.problem("device", "", "fail", fail("BEE-DEVICE-CONFIG", err.Error()))
		return state, false
	case state.Credential == "" || state.Identity == nil:
		report.problem("device", "", "fail", fail("BEE-DEVICE-NOT-PAIRED", path))
		return state, false
	}
	origin, err := hiveOrigin(state.Hive)
	if err != nil || len(state.Credential) != 47 || !strings.HasPrefix(state.Credential, "bee_") {
		report.problem("device", "", "fail", fail("BEE-DEVICE-CONFIG", "invalid Hive address or device credential"))
		return state, false
	}
	state.Hive = origin
	report.pass("device", "", fmt.Sprintf("%q paired with %s on %s", state.Identity.Name, state.Identity.OwnerEmail, origin))
	return state, true
}

func checkAuthorization(ctx context.Context, report *doctorReport, cfg *egressConfig, platform string) {
	const name = "authorization"
	if platform == "openai" {
		credential, err := cfg.Codex.readForMaintenance(ctx)
		if err != nil {
			report.problem(name, platform, "fail", fail("BEE-CODEX-SOURCE", err.Error()))
			return
		}
		hash := sha256.Sum256([]byte(credential.AccountID + "\x00" + credential.UserID))
		detail := fmt.Sprintf("Codex %s sign-in, account %s, plan %s", credential.Source, hex.EncodeToString(hash[:6]), credential.Plan)
		if !time.Now().Add(30 * time.Second).Before(credential.ExpiresAt) {
			// Hive schedules a refresh while bee run is connected, so an
			// expired access token is not yet a stopped supply.
			report.problem(name, platform, "warn", failf("BEE-CODEX-EXPIRED", "%s, expired %s", detail, credential.ExpiresAt.Local().Format(time.RFC3339)))
			return
		}
		report.pass(name, platform, fmt.Sprintf("%s, expires %s", detail, credential.ExpiresAt.Local().Format(time.RFC3339)))
		return
	}
	store, err := resolveClaudeStore(cfg.Claude.Store, cfg.Claude.ConfigDir)
	if err != nil {
		report.problem(name, platform, "fail", err)
		return
	}
	credential, err := store.read(ctx)
	switch {
	case err != nil:
		report.problem(name, platform, "fail", fail("BEE-CLAUDE-SOURCE", err.Error()))
	case !credential.hasInferenceScope:
		report.problem(name, platform, "fail", fail("BEE-CLAUDE-SCOPE", ""))
	case !credential.available(time.Now()) && cfg.Claude.Refresh:
		report.problem(name, platform, "warn", failf("BEE-CLAUDE-EXPIRED", "expired %s; automatic renewal is enabled", credential.expiresAt.Local().Format(time.RFC3339)))
	case !credential.available(time.Now()):
		report.problem(name, platform, "fail", failf("BEE-CLAUDE-EXPIRED", "expired %s", credential.expiresAt.Local().Format(time.RFC3339)))
	default:
		report.pass(name, platform, fmt.Sprintf("Claude Code sign-in in %s, plan %s, expires %s", store.where, credential.plan, credential.expiresAt.Local().Format(time.RFC3339)))
	}
}

func checkHive(ctx context.Context, report *doctorReport, state localState) bool {
	var identity beewire.Identity
	err := call(ctx, httpClient(), state.Hive, "/api/bee/identity", "GET", state.Credential, nil, &identity)
	if err != nil {
		report.problem("hive", "", "fail", hiveProblem(err))
		return false
	}
	report.pass("hive", "", fmt.Sprintf("reached %s as device %s", state.Hive, identity.ID))
	return true
}

// hiveProblem catalogues a failed Hive call.
func hiveProblem(err error) error {
	var failure *apiFailure
	switch {
	case !errors.As(err, &failure):
		return fail("BEE-HIVE-UNREACHABLE", err.Error())
	case failure.Code == "device_replaced":
		return fail("BEE-DEVICE-REPLACED", "")
	case failure.Status == 401 || failure.Status == 403:
		return failf("BEE-HIVE-CREDENTIAL", "HTTP %d", failure.Status)
	default:
		return failf("BEE-HIVE-ERROR", "HTTP %d %s", failure.Status, failure.Code)
	}
}

func checkPlatform(ctx context.Context, report *doctorReport, state localState, platform string, configured bool) {
	path := "/api/bee/platforms/" + platform
	var account beewire.PlatformAccount
	explained := ""
	if err := call(ctx, httpClient(), state.Hive, path+"/account", "GET", state.Credential, nil, &account); err != nil {
		// The supply query would fail the same way; say it once.
		report.problem("account", platform, "fail", hiveProblem(err))
		report.skip("supply", platform, "account check failed")
		return
	} else {
		switch account.Status {
		case "ready":
			report.pass("account", platform, fmt.Sprintf("account %s, generation %d", shortFingerprint(account.AccountFingerprint), account.Generation))
		case "not_configured":
			if !configured {
				// Without an egress configuration doctor cannot tell an
				// unsupplied platform from a broken one.
				report.skip("account", platform, "no account registered; this Bee does not appear to supply it")
				report.skip("supply", platform, "no account registered")
				return
			}
			explained = beewire.ReasonNotConfigured
			report.reason("account", platform, explained)
		default:
			explained = beewire.AccountReason(platform, account.Status)
			report.reason("account", platform, explained)
		}
	}
	var supply beewire.PlatformSupply
	if err := call(ctx, httpClient(), state.Hive, path, "GET", state.Credential, nil, &supply); err != nil {
		report.problem("supply", platform, "fail", hiveProblem(err))
		return
	}
	if supply.Ready {
		report.pass("supply", platform, "taking new work")
		return
	}
	for _, reason := range supply.Reasons {
		if reason != explained {
			report.reason("supply", platform, reason)
		}
	}
}

func shortFingerprint(fingerprint string) string {
	if len(fingerprint) > 12 {
		return fingerprint[:12]
	}
	return fingerprint
}

func printReport(out io.Writer, report doctorReport) {
	labels := map[string]string{"pass": "ok", "warn": "WARN", "fail": "FAIL", "skip": "skip"}
	for _, c := range report.Checks {
		name := c.Name
		if c.Platform != "" {
			name += " (" + c.Platform + ")"
		}
		fmt.Fprintf(out, "%-4s  %-22s  %s\n", labels[c.Status], name, c.Detail)
		if c.Fix != "" {
			who := "fix"
			if c.Admin {
				who = "fix (administrator)"
			}
			fmt.Fprintf(out, "      %-22s  %s: %s\n", "", who, c.Fix)
		}
	}
	if report.OK {
		fmt.Fprintln(out, "\nNo problems found.")
	}
}
