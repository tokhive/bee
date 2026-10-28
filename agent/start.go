package bee

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/tokhive/bee/beewire"
)

const usage = `Bee supplies your AI subscriptions to a TokHive market.

Interactive management:
  bee                       open the numbered management menu in a terminal

Get started (run it again any time to start Bee):
  bee start --hive URL       pair this machine, choose the accounts to supply, and run

Everyday:
  bee status                 what Bee is connected to and whether each account takes work
  bee pause --platform P     stop taking new work for openai or claude
  bee resume --platform P    take new work again
  bee doctor                 check everything and explain what to fix
  bee version                show this build

The steps bee start runs for you:
  bee login --hive URL       pair this machine with your Hive account
  bee setup                  find the subscriptions signed in here and choose which to supply
  bee run                    stay connected and serve work

More:
  bee supply-status --platform P       why Hive is or is not sending work to an account
  bee account-status --platform P      the account Hive knows and any change waiting
  bee confirm-account --platform P --account-fingerprint FP
  bee codex-status / bee claude-status inspect the local sign-in without contacting Hive

Device commands take --config PATH to use another device configuration.
codex-status and claude-status use their own official-client directory options.
help and version do not read device configuration.
Run bee <command> -h for its options.
`

// start takes a provider from nothing to supplying without editing any file:
// it pairs this machine when it is not paired, writes the egress
// configuration when there is none, then runs. Each step is skipped once
// done, so the same command is also how Bee is started afterwards.
func start(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee start", flag.ContinueOnError)
	flags.SetOutput(out)
	configPath := flags.String("config", "", "device configuration file")
	origin := flags.String("hive", "", "Hive address, as shown on the Hive's Devices page; needed only the first time")
	name := flags.String("name", "", "device name shown in Hive (default: this machine's host name)")
	yes := flags.Bool("yes", false, "supply every account found without asking")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	if *configPath == "" {
		*configPath = defaultConfigPath()
		if *configPath == "" {
			return errors.New("failed to locate user configuration directory; use --config")
		}
	}
	state, err := readState(*configPath)
	if err != nil {
		return err
	}
	if *origin != "" && state.Hive != "" {
		want, err := hiveOrigin(*origin)
		if err != nil {
			return err
		}
		if want != state.Hive {
			return fmt.Errorf("this machine is paired with %s; use a separate --config path for another Hive", state.Hive)
		}
	}

	if state.Identity == nil {
		hive := *origin
		if hive == "" {
			hive = state.Hive
		}
		if hive == "" {
			return fail("BEE-START-HIVE", "")
		}
		fmt.Fprint(out, "\nStep 1 of 3: pair this machine with Hive\n\n")
		login := []string{"login", "--config", *configPath, "--hive", hive}
		if *name != "" {
			login = append(login, "--name", *name)
		}
		if err := run(ctx, login, out); err != nil {
			return err
		}
	}

	if _, err := os.Lstat(defaultEgressPath(*configPath)); errors.Is(err, os.ErrNotExist) {
		fmt.Fprint(out, "\nStep 2 of 3: choose the subscriptions to supply\n\n")
		setupArgs := []string{"--config", *configPath}
		if *yes {
			setupArgs = append(setupArgs, "--yes")
		}
		if err := setupWith(ctx, setupArgs, out, false); err != nil {
			return err
		}
	}

	fmt.Fprint(out, "\nStep 3 of 3: supplying. Keep this running; Ctrl-C stops Bee, and bee start starts it again.\n\n")
	return run(ctx, []string{"run", "--config", *configPath}, out)
}

// status shows on one screen what this Bee is and whether each account it
// supplies is taking work.
func status(ctx context.Context, client *http.Client, configPath string, state localState, out io.Writer) error {
	var identity beewire.Identity
	if err := call(ctx, client, state.Hive, "/api/bee/identity", "GET", state.Credential, nil, &identity); err != nil {
		return err
	}
	fmt.Fprintf(out, "Bee:     %s\n", versionLine())
	fmt.Fprintf(out, "Hive:    %s\n", state.Hive)
	fmt.Fprintf(out, "Device:  %s, paired to %s\n", identity.Name, identity.OwnerEmail)

	egressPath := defaultEgressPath(configPath)
	if !fileExists(egressPath) {
		fmt.Fprintln(out, "Supply:  nothing chosen yet; run bee start or bee setup")
		return nil
	}
	cfg, err := readEgress(ctx, egressPath)
	if err != nil {
		code, summary, _, _ := Coded(err)
		fmt.Fprintf(out, "Supply:  %s cannot be used: %s [%s]; run bee doctor\n", egressPath, summary, code)
		return nil
	}
	var platforms []string
	if cfg.Codex != nil {
		platforms = append(platforms, "openai")
	}
	if cfg.Claude != nil {
		platforms = append(platforms, "claude")
	}
	fmt.Fprintf(out, "Supply:  %s (%s)\n", strings.Join(platforms, ", "), filepath.Base(egressPath))
	for _, platform := range platforms {
		var supply beewire.PlatformSupply
		if err := call(ctx, client, state.Hive, "/api/bee/platforms/"+platform, "GET", state.Credential, nil, &supply); err != nil {
			fmt.Fprintf(out, "  %-7s state unknown: %v\n", platform, err)
			continue
		}
		if supply.Ready {
			fmt.Fprintf(out, "  %-7s taking new work\n", platform)
			continue
		}
		var reasons []string
		for _, reason := range supply.Reasons {
			label, ok := supplyReasonLabels[reason]
			if !ok {
				label = reason
			}
			reasons = append(reasons, label)
		}
		fmt.Fprintf(out, "  %-7s not taking work: %s\n", platform, strings.Join(reasons, "; "))
	}
	return nil
}

func fileExists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}
