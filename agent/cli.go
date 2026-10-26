package bee

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/bee/logx"
)

func Run(ctx context.Context, args []string, out io.Writer) error {
	logx.Setup("bee", "BEE_DEBUG")
	if len(args) == 0 && logx.Readable(os.Stdin) && logx.Readable(out) {
		return runManagement(ctx, out)
	}
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Fprint(out, usage)
		return nil
	}
	if (args[0] == "run" || args[0] == "start") && logx.Readable(os.Stderr) {
		// A person is watching: only problems from the process log, and the
		// operator lines in a form they can read. See newConsole.
		slog.SetDefault(slog.New(logx.Friendly(os.Stderr, slog.LevelWarn)))
	}
	err := run(ctx, args, out)
	if errors.Is(err, flag.ErrHelp) {
		// The flag package has already printed the command's flags.
		return nil
	}
	return err
}

func run(ctx context.Context, args []string, out io.Writer) error {
	command := args[0]
	if command == "login" {
		if _, err := newInstallUI(out); err != nil {
			return err
		}
	}
	if command == "start" {
		return start(ctx, args[1:], out)
	}
	if command == "version" || command == "--version" {
		fmt.Fprintln(out, versionLine())
		return nil
	}
	if command == "codex-status" {
		return codexStatus(ctx, args[1:], out)
	}
	if command == "claude-status" {
		return claudeStatus(ctx, args[1:], out)
	}
	if command == "doctor" {
		return doctor(ctx, args[1:], out)
	}
	if command == "setup" {
		return setup(ctx, args[1:], out)
	}
	control := command == "pause" || command == "resume" || command == "supply-status"
	accountCommand := command == "account-status" || command == "confirm-account"
	if command != "login" && command != "run" && command != "status" && !control && !accountCommand {
		return fmt.Errorf("unknown Bee command %q; run bee help to list the commands", command)
	}
	flags := flag.NewFlagSet("bee "+command, flag.ContinueOnError)
	flags.SetOutput(out)
	configPath := flags.String("config", "", "device configuration file")
	var origin, name string
	var egressPath string
	var platform string
	var fingerprint string
	if control || accountCommand {
		flags.StringVar(&platform, "platform", "", "supply platform: openai or claude")
	}
	if command == "confirm-account" {
		flags.StringVar(&fingerprint, "account-fingerprint", "", "full account fingerprint to confirm")
	}
	if command == "run" {
		flags.StringVar(&egressPath, "egress-config", "", "encrypted egress configuration file")
	}
	if command == "login" {
		flags.StringVar(&origin, "hive", "", "Hive address")
		flags.StringVar(&name, "name", "", "Device name")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	if (control || accountCommand) && platform != "openai" && platform != "claude" {
		return errors.New("--platform must specify openai or claude")
	}
	if *configPath == "" {
		directory, err := os.UserConfigDir()
		if err != nil {
			return errors.New("failed to locate user configuration directory; use --config")
		}
		*configPath = filepath.Join(directory, "tokhive", "bee.json")
	}
	if command == "login" || command == "run" {
		unlock, err := lockState(*configPath)
		if err != nil {
			return err
		}
		defer unlock()
	}
	state, err := readState(*configPath)
	if err != nil {
		return err
	}
	if command == "login" {
		if origin == "" {
			origin = state.Hive
		}
		if origin == "" {
			origin = "http://localhost:8080"
		}
		origin, err = hiveOrigin(origin)
		if err != nil {
			return err
		}
		if state.Hive != "" && state.Hive != origin {
			return errors.New("this configuration belongs to another Hive; use a separate --config path")
		}
		if state.Credential == "" {
			state, err = newDeviceState(origin, name)
			if err != nil {
				return err
			}
			if err = saveState(*configPath, state); err != nil {
				return err
			}
		}
	} else if state.Credential == "" {
		return errors.New("not paired; run bee login first")
	}
	validOrigin, err := hiveOrigin(state.Hive)
	if err != nil {
		return err
	}
	state.Hive = validOrigin
	if len(state.Credential) != 47 || !strings.HasPrefix(state.Credential, "bee_") {
		return errors.New("invalid device credential in Bee configuration")
	}
	client := httpClient()
	if accountCommand {
		return accountControl(ctx, state, platform, fingerprint, command == "confirm-account", out)
	}
	if control {
		return platformControl(ctx, client, state, platform, command, out)
	}
	if command == "login" {
		return login(ctx, client, *configPath, state, out)
	}
	if command == "run" {
		if state.Identity == nil {
			return errors.New("pairing incomplete; run bee login first")
		}
		slog.Info(versionLine(), "module", "connect")
		var egress *egressConfig
		if egressPath == "" {
			// bee setup writes here; an explicit --egress-config wins.
			if _, err := os.Lstat(defaultEgressPath(*configPath)); err == nil {
				egressPath = defaultEgressPath(*configPath)
			}
		}
		console := newConsole(out)
		if egressPath != "" {
			egress, err = readEgress(ctx, egressPath)
			if err != nil {
				return err
			}
			egress.useStateDirectory(filepath.Dir(*configPath))
			notify(console, slog.LevelInfo, "connect", "using egress configuration", "path", egressPath)
		} else {
			code, summary, fix, _ := Coded(fail("BEE-SETUP-NEEDED", ""))
			notify(console, slog.LevelWarn, "connect", summary, "code", code, "fix", fix)
		}
		return runWithTelemetry(ctx, func(live context.Context) error { return connect(live, state, egress, console) })
	}
	return status(ctx, client, *configPath, state, out)
}

func login(ctx context.Context, client *http.Client, path string, state localState, out io.Writer) error {
	ui, err := newInstallUI(out)
	if err != nil {
		return err
	}
	return loginWithUI(ctx, client, path, state, out, ui)
}

func loginWithUI(ctx context.Context, client *http.Client, path string, state localState, out io.Writer, ui installUI) error {
	var identity beewire.Identity
	err := call(ctx, client, state.Hive, "/api/bee/identity", "GET", state.Credential, nil, &identity)
	if err == nil {
		return finishLoginWithUI(path, state, identity, out, ui)
	}
	var failure *apiFailure
	if !errors.As(err, &failure) || failure.Status != 401 {
		return err
	}
	if state.Identity != nil {
		return errors.New("bound device credential is invalid; silent pairing is not allowed")
	}
	if state.Pairing == nil || !time.Now().Before(state.Pairing.ExpiresAt) {
		hash := sha256.Sum256([]byte(state.Credential))
		var pair beewire.Pairing
		err = call(ctx, client, state.Hive, "/api/bee/pairings", "POST", "", beewire.StartPairing{Name: state.Name, CredentialHash: hex.EncodeToString(hash[:])}, &pair)
		if err != nil {
			return err
		}
		state.Pairing = &pair
		if err = saveState(path, state); err != nil {
			return err
		}
		if !ui.installer {
			slog.Info("pairing started", "module", "identity", "hive", state.Hive)
		}
	}
	link := state.Pairing.VerificationURI + "?code=" + url.QueryEscape(state.Pairing.UserCode)
	fmt.Fprintf(out, ui.text("Open this link in a browser where you are signed in to Hive, check the device name and confirm:\n\n  %s\n\nPairing code: %s (expires %s)\n", "请在浏览器中打开以下链接，登录 Hive，核对设备名称并确认绑定：\n\n  %s\n\n配对码：%s（有效期至 %s）\n"), link, state.Pairing.UserCode, state.Pairing.ExpiresAt.Local().Format("15:04"))
	ui.status(out, "⏳", "33", "Waiting for confirmation...", "等待你在网页确认…")
	waitingReported := false
	for {
		if err = pause(ctx, 2*time.Second); err != nil {
			return err
		}
		var pair beewire.Pairing
		err = call(ctx, client, state.Hive, "/api/bee/pairings", "GET", state.Pairing.PairingToken, nil, &pair)
		if err != nil {
			return err
		}
		if pair.Status == "pending" {
			continue
		}
		if pair.Status == "draining" {
			if !waitingReported {
				fmt.Fprintln(out, ui.text("waiting for the old Bee to finish execution and settlement", "等待旧 Bee 完成执行与结算"))
				waitingReported = true
			}
			continue
		}
		if pair.Status == "approved" {
			err = call(ctx, client, state.Hive, "/api/bee/pairings/redeem", "POST", state.Pairing.PairingToken, struct{}{}, &identity)
			if err == nil {
				return finishLoginWithUI(path, state, identity, out, ui)
			}
			var pending *apiFailure
			if errors.As(err, &pending) && pending.Code == "device_draining" {
				continue
			}
		}
		// The credential was persisted before exchange, so an uncertain response is recoverable.
		if identityErr := call(ctx, client, state.Hive, "/api/bee/identity", "GET", state.Credential, nil, &identity); identityErr == nil {
			return finishLoginWithUI(path, state, identity, out, ui)
		}
		if err != nil {
			return err
		}
		return errors.New("pairing result unconfirmed; preserve the configuration and run bee login again")
	}
}

func finishLogin(path string, state localState, identity beewire.Identity, out io.Writer) error {
	ui, err := newInstallUI(out)
	if err != nil {
		return err
	}
	return finishLoginWithUI(path, state, identity, out, ui)
}

func finishLoginWithUI(path string, state localState, identity beewire.Identity, out io.Writer, ui installUI) error {
	state.Identity = &identity
	state.Pairing = nil
	if err := saveState(path, state); err != nil {
		return err
	}
	if !ui.installer {
		slog.Info("device paired", "module", "identity", "device", identity.ID, "owner", identity.OwnerEmail)
	}
	ui.status(out, "✅", "32", fmt.Sprintf("Pairing complete: %s\nDevice: %s", identity.OwnerEmail, identity.ID), fmt.Sprintf("设备配对完成：%s\n设备：%s", identity.OwnerEmail, identity.ID))
	return nil
}

func newDeviceState(origin, name string) (localState, error) {
	if name == "" {
		name, _ = os.Hostname()
	}
	if strings.TrimSpace(name) == "" {
		name = "Bee"
	}
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > 80 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return localState{}, errors.New("device name must not exceed 80 characters or contain control characters")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return localState{}, fmt.Errorf("generate device credential: %w", err)
	}
	return localState{Hive: origin, Name: name, Credential: "bee_" + base64.RawURLEncoding.EncodeToString(raw)}, nil
}
