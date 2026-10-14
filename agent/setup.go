package bee

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"
)

// setupInput is where bee setup reads the provider's answers; tests replace it.
var setupInput io.Reader = os.Stdin

// claudeReader opens a Claude Code credential store; tests replace it
// so they never read the developer's own sign-in.
var claudeReader = func(store string, directory *string) func(context.Context) (claudeCredential, error) {
	return func(ctx context.Context) (claudeCredential, error) {
		source, err := resolveClaudeStore(store, directory)
		if err != nil {
			return claudeCredential{}, err
		}
		return source.read(ctx)
	}
}

// detectedAccount is an official sign-in bee setup found on this machine.
type detectedAccount struct {
	platform string
	summary  string
	problem  error
	codex    *codexSource
	claude   *claudeSource
}

func defaultEgressPath(configPath string) string {
	return filepath.Join(filepath.Dir(configPath), "egress.json")
}

func setup(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee setup", flag.ContinueOnError)
	flags.SetOutput(out)
	configPath := flags.String("config", "", "device configuration file")
	egressPath := flags.String("egress-config", "", "egress configuration to write (default: egress.json beside the device configuration)")
	platformList := flags.String("platform", "", "platforms to supply, comma separated: openai, claude (default: every account found)")
	codexHome := flags.String("codex-home", "", "official Codex directory (default: $CODEX_HOME, else ~/.codex)")
	var claudeDir *string
	flags.Func("claude-config-dir", "Claude Code configuration directory namespace, as for claude-status", func(value string) error {
		claudeDir = &value
		return nil
	})
	var proxy *string
	flags.Func("connect-proxy", "local HTTP CONNECT proxy for upstream connections, http://127.0.0.1:PORT; empty removes it", func(value string) error {
		proxy = &value
		return nil
	})
	yes := flags.Bool("yes", false, "supply every selected account without asking")
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
	if *egressPath == "" {
		*egressPath = defaultEgressPath(*configPath)
	}
	var wanted []string
	if *platformList != "" {
		for _, platform := range strings.Split(*platformList, ",") {
			platform = strings.TrimSpace(platform)
			if platform != "openai" && platform != "claude" {
				return failf("BEE-SETUP-PLATFORM", "%q", platform)
			}
			if !slices.Contains(wanted, platform) {
				wanted = append(wanted, platform)
			}
		}
	}

	// Start from the existing configuration so a second run keeps the
	// provider's other settings, such as connect_proxy and claude.refresh.
	existing, err := existingEgress(ctx, *egressPath)
	if err != nil {
		return err
	}
	if proxy != nil && *proxy != "" {
		if _, err := localConnectProxy(*proxy); err != nil {
			return fail("BEE-CONFIG-PROXY", "")
		}
	}

	fmt.Fprintln(out, "Looking for official sign-ins on this machine:")
	var detected []detectedAccount
	for _, platform := range []string{"openai", "claude"} {
		if wanted != nil && !slices.Contains(wanted, platform) {
			continue
		}
		var found detectedAccount
		if platform == "openai" {
			found = detectCodex(ctx, *codexHome)
		} else {
			found = detectClaude(ctx, claudeDir, existing)
		}
		detected = append(detected, found)
		if found.problem != nil {
			_, summary, fix, _ := Coded(found.problem)
			fmt.Fprintf(out, "  %-7s not found: %s\n          fix: %s\n", platform, summary, fix)
		} else {
			fmt.Fprintf(out, "  %-7s %s\n", platform, found.summary)
		}
	}

	reader := bufio.NewReader(setupInput)
	var chosen []detectedAccount
	for _, found := range detected {
		if found.problem != nil {
			if wanted != nil {
				// The provider asked for this platform by name; a silent
				// configuration without it would not be what they asked for.
				return found.problem
			}
			continue
		}
		if !*yes {
			fmt.Fprintf(out, "Supply this %s account to the market? [Y/n] ", found.platform)
			answer, err := reader.ReadString('\n')
			if err != nil && answer == "" {
				return fail("BEE-SETUP-NO-ANSWER", "")
			}
			if answer = strings.ToLower(strings.TrimSpace(answer)); answer == "n" || answer == "no" {
				continue
			}
		}
		chosen = append(chosen, found)
	}
	if len(chosen) == 0 {
		return fail("BEE-SETUP-NOTHING", "")
	}

	cfg := buildEgress(chosen, existing, proxy)
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(*egressPath), 0700); err != nil {
		return fail("BEE-SETUP-WRITE", err.Error())
	}
	if err := writePrivateFile(*egressPath, append(raw, '\n'), ".egress-*"); err != nil {
		return fail("BEE-SETUP-WRITE", err.Error())
	}
	// What setup writes must be what bee run accepts.
	if _, err := readEgress(ctx, *egressPath); err != nil {
		return err
	}
	var names []string
	for _, found := range chosen {
		names = append(names, found.platform)
	}
	fmt.Fprintf(out, "Wrote %s supplying %s.\n", *egressPath, strings.Join(names, " and "))
	run := "bee run"
	if *configPath != defaultConfigPath() {
		run += " --config " + *configPath
	}
	if *egressPath != defaultEgressPath(*configPath) {
		run += " --egress-config " + *egressPath
	}
	fmt.Fprintf(out, "Next: start %q; it reports whether each platform takes work. bee doctor checks the whole setup.\n", run)
	return nil
}

func defaultConfigPath() string {
	directory, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(directory, "tokhive", "bee.json")
}

// existingEgress reads the configuration setup is about to replace. A missing
// file is a first run; a file setup cannot represent is left for the provider.
func existingEgress(ctx context.Context, path string) (*egressConfig, error) {
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	cfg, err := readEgress(ctx, path)
	if err != nil {
		return nil, err
	}
	if cfg.Credential.Token != "" || cfg.Capabilities != nil && cfg.Capabilities.LocalURL != "" {
		return nil, fail("BEE-SETUP-MANUAL", path)
	}
	return cfg, nil
}

func detectCodex(ctx context.Context, home string) detectedAccount {
	found := detectedAccount{platform: "openai"}
	if home == "" {
		home = os.Getenv("CODEX_HOME")
	}
	if home == "" {
		user, err := os.UserHomeDir()
		if err != nil {
			found.problem = fail("BEE-SETUP-CODEX-NOT-FOUND", "cannot locate the home directory; use --codex-home")
			return found
		}
		home = filepath.Join(user, ".codex")
	}
	if info, err := os.Stat(home); err != nil || !info.IsDir() {
		found.problem = fail("BEE-SETUP-CODEX-NOT-FOUND", home)
		return found
	}
	// The official client keeps its sign-in in auth.json unless configured
	// for the system keyring, which Bee reads directly only on macOS.
	stores := []string{"file"}
	if _, err := os.Stat(filepath.Join(home, "auth.json")); errors.Is(err, os.ErrNotExist) && runtime.GOOS == "darwin" {
		// Only a missing auth.json points to the keyring; a present but
		// unusable one is the problem to report.
		stores = []string{"file", "keyring"}
	}
	var first error
	for _, store := range stores {
		source := &codexSource{Home: home, Store: store}
		credential, err := source.readForMaintenance(ctx)
		if err != nil {
			// When neither store has a sign-in, the missing auth.json is
			// what a provider who has not signed in needs to hear.
			if first == nil {
				first = err
			}
			continue
		}
		found.codex = source
		hash := sha256.Sum256([]byte(credential.AccountID + "\x00" + credential.UserID))
		state := "expires " + credential.ExpiresAt.Local().Format(time.RFC3339)
		if !time.Now().Add(30 * time.Second).Before(credential.ExpiresAt) {
			state = "access token expired; Hive refreshes it once bee run is connected"
		}
		found.summary = fmt.Sprintf("Codex sign-in in %s (%s), account %s, plan %s, %s", home, store, hex.EncodeToString(hash[:6]), credential.Plan, state)
		return found
	}
	found.problem = fail("BEE-CODEX-SOURCE", first.Error())
	return found
}

func detectClaude(ctx context.Context, directory *string, existing *egressConfig) detectedAccount {
	found := detectedAccount{platform: "claude"}
	source := &claudeSource{Store: defaultClaudeStore(), Capabilities: true, ConfigDir: directory}
	if existing != nil && existing.Claude != nil {
		// Keep what the provider chose before; a flag given now wins.
		source.Refresh = existing.Claude.Refresh
		if existing.Claude.Store != "" {
			source.Store = existing.Claude.Store
		}
		if directory == nil {
			source.ConfigDir = existing.Claude.ConfigDir
		}
	}
	where := "the macOS Keychain"
	if source.Store == claudeStoreFile {
		where = filepath.Join(resolveClaudeKeychain(source.ConfigDir).directory, ".credentials.json")
	}
	credential, err := claudeReader(source.Store, source.ConfigDir)(ctx)
	switch {
	case err != nil:
		if _, _, _, coded := Coded(err); coded {
			found.problem = err
		} else {
			found.problem = fail("BEE-CLAUDE-SOURCE", err.Error())
		}
	case !credential.hasInferenceScope:
		found.problem = fail("BEE-CLAUDE-SCOPE", "")
	default:
		found.claude = source
		state := "expires " + credential.expiresAt.Local().Format(time.RFC3339)
		if !credential.available(time.Now()) {
			state = "access token expired; open Claude Code to renew it"
		}
		found.summary = fmt.Sprintf("Claude Code sign-in in %s, plan %s, %s", where, credential.plan, state)
	}
	return found
}

// egressFile is the egress configuration as setup writes it: only the fields
// a provider supplying official accounts needs.
type egressFile struct {
	ConnectProxy string         `json:"connect_proxy,omitempty"`
	Targets      []string       `json:"targets"`
	Codex        *codexSource   `json:"codex,omitempty"`
	Capabilities *struct{}      `json:"capabilities,omitempty"`
	Claude       *claudeSetting `json:"claude,omitempty"`
}

type claudeSetting struct {
	Store        string  `json:"store"`
	ConfigDir    *string `json:"config_dir,omitempty"`
	Refresh      bool    `json:"refresh,omitempty"`
	Capabilities bool    `json:"capabilities"`
}

func buildEgress(chosen []detectedAccount, existing *egressConfig, proxy *string) egressFile {
	var cfg egressFile
	if existing != nil {
		cfg.ConnectProxy = existing.ConnectProxy
	}
	if proxy != nil {
		cfg.ConnectProxy = *proxy
	}
	for _, found := range chosen {
		for _, platform := range platformTargets {
			if platform.field == "codex" && found.codex != nil || platform.field == "claude" && found.claude != nil {
				cfg.Targets = append(cfg.Targets, platform.target)
			}
		}
		if found.codex != nil {
			cfg.Codex = &codexSource{Home: found.codex.Home, Store: found.codex.Store}
			cfg.Capabilities = &struct{}{}
		}
		if found.claude != nil {
			cfg.Claude = &claudeSetting{Store: found.claude.Store, ConfigDir: found.claude.ConfigDir, Refresh: found.claude.Refresh, Capabilities: true}
		}
	}
	return cfg
}
