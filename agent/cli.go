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
	if len(args) == 0 {
		return errors.New("usage: bee login|run|status [--config PATH]; bee setup [--config PATH] [--platform openai,claude] [--yes]; bee doctor [--config PATH] [--egress-config PATH] [--json]; bee pause|resume|supply-status|account-status --platform openai|claude [--config PATH]; bee confirm-account --platform openai|claude --account-fingerprint FINGERPRINT; bee codex-status --codex-home PATH --store file|keyring|auto; bee claude-status [--verify]")
	}
	command := args[0]
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
		return errors.New("unknown Bee command; supported commands: login, setup, run, status, doctor, codex-status, claude-status, pause, resume, supply-status, account-status, confirm-account")
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
			if name == "" {
				name, _ = os.Hostname()
			}
			if strings.TrimSpace(name) == "" {
				name = "Bee"
			}
			name = strings.TrimSpace(name)
			if utf8.RuneCountInString(name) > 80 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
				return errors.New("device name must not exceed 80 characters or contain control characters")
			}
			raw := make([]byte, 32)
			_, _ = rand.Read(raw)
			state = localState{Hive: origin, Name: name, Credential: "bee_" + base64.RawURLEncoding.EncodeToString(raw)}
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
	var identity beewire.Identity
	if err = call(ctx, client, state.Hive, "/api/bee/identity", "GET", state.Credential, nil, &identity); err != nil {
		return err
	}
	fmt.Fprintf(out, "Bound: %s\nDevice: %s\nUser: %s\nHive: %s\n", identity.Name, identity.ID, identity.OwnerEmail, state.Hive)
	return nil
}

func login(ctx context.Context, client *http.Client, path string, state localState, out io.Writer) error {
	var identity beewire.Identity
	err := call(ctx, client, state.Hive, "/api/bee/identity", "GET", state.Credential, nil, &identity)
	if err == nil {
		return finishLogin(path, state, identity, out)
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
		slog.Info("pairing started", "module", "identity", "hive", state.Hive)
	}
	fmt.Fprintf(out, "Hive: %s\nPairing page: %s\nPairing code: %s\nExpires at: %s\nWaiting for browser confirmation\n", state.Hive, state.Pairing.VerificationURI, state.Pairing.UserCode, state.Pairing.ExpiresAt.Local().Format(time.RFC3339))
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
				fmt.Fprintln(out, "waiting for the old Bee to finish execution and settlement")
				waitingReported = true
			}
			continue
		}
		if pair.Status == "approved" {
			err = call(ctx, client, state.Hive, "/api/bee/pairings/redeem", "POST", state.Pairing.PairingToken, struct{}{}, &identity)
			if err == nil {
				return finishLogin(path, state, identity, out)
			}
			var pending *apiFailure
			if errors.As(err, &pending) && pending.Code == "device_draining" {
				continue
			}
		}
		// The credential was persisted before exchange, so an uncertain response is recoverable.
		if identityErr := call(ctx, client, state.Hive, "/api/bee/identity", "GET", state.Credential, nil, &identity); identityErr == nil {
			return finishLogin(path, state, identity, out)
		}
		if err != nil {
			return err
		}
		return errors.New("pairing result unconfirmed; preserve the configuration and run bee login again")
	}
}

func finishLogin(path string, state localState, identity beewire.Identity, out io.Writer) error {
	state.Identity = &identity
	state.Pairing = nil
	if err := saveState(path, state); err != nil {
		return err
	}
	slog.Info("device paired", "module", "identity", "device", identity.ID, "owner", identity.OwnerEmail)
	fmt.Fprintf(out, "Pairing complete: %s\nDevice: %s\n", identity.OwnerEmail, identity.ID)
	return nil
}
