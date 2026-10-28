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
	Admin              bool `json:"admin,omitempty"`
	err                error
	skipReason, reason string
}

type doctorReport struct {
	OK     bool    `json:"ok"`
	Checks []check `json:"checks"`
}

func (r *doctorReport) add(c check) { r.Checks = append(r.Checks, c) }

func (r *doctorReport) pass(name, platform, detail string) {
	r.add(check{Name: name, Platform: platform, Status: "pass", Detail: detail})
}

var doctorSkipReasons = map[string]bilingualText{
	"no_egress":      {"no egress configuration; run bee start or bee setup to choose accounts. Account checks show only what Hive sees", "尚未选择供给账号；请选择供给账号。账号检查仅显示 Hive 已知的状态。"},
	"egress_failed":  {"egress configuration failed", "供给配置检查未通过，暂不检查授权。"},
	"device_failed":  {"device configuration failed", "设备配置检查未通过，暂不连接 Hive。"},
	"hive_failed":    {"Hive check failed", "Hive 检查未通过，暂时无法查询。"},
	"account_failed": {"account check failed", "账号检查未通过，暂时无法查询接单状态。"},
	"not_supplied":   {"no account registered; this Bee does not appear to supply it", "未注册账号，本机也未配置该平台的供给。"},
	"no_account":     {"no account registered", "该平台尚未注册账号。"},
}

func (r *doctorReport) skip(name, platform, reason string) {
	r.add(check{Name: name, Platform: platform, Status: "skip", Detail: doctorSkipReasons[reason].en, skipReason: reason})
}

// problem records a catalogued error as a failure, or as a warning when the
// condition does not by itself stop supply.
func (r *doctorReport) problem(name, platform, status string, err error) {
	code, summary, fix, ok := Coded(err)
	if !ok {
		code, summary, fix = "", err.Error(), ""
	}
	r.add(check{Name: name, Platform: platform, Status: status, Code: code, Detail: summary, Fix: fix, err: err})
}

// reason records a supply reason Hive gave, explained from the shared catalog.
func (r *doctorReport) reason(name, platform, reason string) {
	explained, ok := beewire.ExplainReason(reason, platform)
	if !ok {
		r.add(check{Name: name, Platform: platform, Status: "fail", Code: reason, Detail: "[" + reason + "] reason this Bee version does not know", reason: reason})
		return
	}
	r.add(check{Name: name, Platform: platform, Status: "fail", Code: reason, Detail: "[" + reason + "] " + explained.Cause, Fix: explained.Fix, Admin: explained.Admin, reason: reason})
}

var errDoctorFailed = errors.New("bee doctor found problems; see the report above")

func doctor(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee doctor", flag.ContinueOnError)
	flags.SetOutput(out)
	configPath := flags.String("config", "", "device configuration file")
	egressPath := flags.String("egress-config", "", "egress configuration file (default: the egress.json bee setup wrote, if any)")
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
	if *egressPath == "" && fileExists(defaultEgressPath(*configPath)) {
		// The same file bee run uses when it is given none.
		*egressPath = defaultEgressPath(*configPath)
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
		report.skip("egress", "", "no_egress")
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
			report.skip("authorization", platform, "egress_failed")
		default:
			checkAuthorization(ctx, &report, egress, platform)
		}
	}

	hiveOK := false
	if !deviceOK {
		report.skip("hive", "", "device_failed")
	} else {
		hiveOK = checkHive(ctx, &report, state)
	}
	for _, platform := range platforms {
		if !hiveOK {
			report.skip("account", platform, "hive_failed")
			report.skip("supply", platform, "hive_failed")
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
			report.problem(name, platform, "fail", failCause("BEE-CODEX-SOURCE", err))
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
		report.problem(name, platform, "fail", failCause("BEE-CLAUDE-SOURCE", err))
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
		return failCause("BEE-HIVE-UNREACHABLE", err)
	case failure.Code == "device_replaced":
		return failCause("BEE-DEVICE-REPLACED", err)
	case failure.Status == 401 || failure.Status == 403:
		return failCause("BEE-HIVE-CREDENTIAL", err)
	default:
		return failCause("BEE-HIVE-ERROR", err)
	}
}

func checkPlatform(ctx context.Context, report *doctorReport, state localState, platform string, configured bool) {
	path := "/api/bee/platforms/" + platform
	var account beewire.PlatformAccount
	explained := ""
	if err := call(ctx, httpClient(), state.Hive, path+"/account", "GET", state.Credential, nil, &account); err != nil {
		// The supply query would fail the same way; say it once.
		report.problem("account", platform, "fail", hiveProblem(err))
		report.skip("supply", platform, "account_failed")
		return
	} else {
		switch account.Status {
		case "ready":
			report.pass("account", platform, fmt.Sprintf("account %s, generation %d", shortFingerprint(account.AccountFingerprint), account.Generation))
		case "not_configured":
			if !configured {
				// Without an egress configuration doctor cannot tell an
				// unsupplied platform from a broken one.
				report.skip("account", platform, "not_supplied")
				report.skip("supply", platform, "no_account")
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
