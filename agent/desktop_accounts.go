package bee

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

// accountManager is what the control interface needs to manage accounts.
type accountManager interface {
	accounts() []accountRecord
	detect(ctx context.Context, platform string) accountDetection
	addAccount(ctx context.Context, request addAccountRequest) (accountRecord, error)
	removeAccount(ctx context.Context, id string) error
	confirmAccount(ctx context.Context, id string) (beewire.PlatformAccount, error)
}

// accountDetection is what Bee found of a platform's official sign-in on
// this machine.
type accountDetection struct {
	Platform    string          `json:"platform"`
	Available   bool            `json:"available"`
	Email       string          `json:"email,omitempty"`
	Plan        string          `json:"plan,omitempty"`
	Fingerprint string          `json:"fingerprint,omitempty"`
	Problem     *controlProblem `json:"problem,omitempty"`
	codex       *codexSource
	claude      *claudeSource
	antigravity *antigravitySource
}

type addAccountRequest struct {
	Platform string `json:"platform"`
	Source   string `json:"source"`
	// File is the credential file to import: Codex's auth.json or Claude
	// Code's .credentials.json.
	File string `json:"file,omitempty"`
}

// accountError is a refusal the control interface answers with its status.
type accountError struct {
	status  int
	problem controlProblem
}

func (e *accountError) Error() string { return e.problem.Message }

func refuse(status int, code, message string) error {
	return &accountError{status: status, problem: controlProblem{Code: code, Message: message}}
}

// maxImportBytes bounds a credential file to import.
const maxImportBytes = 65536

func (r *desktopRunner) accounts() []accountRecord {
	records, err := readAccounts(r.configPath)
	if err != nil {
		slog.Warn("account records unreadable", "module", "accounts", "error", err.Error())
		return []accountRecord{}
	}
	return records
}

// adoptConfiguredAccounts gives every account the egress configuration
// already names, for example one chosen with bee setup, a record, so the
// desktop app can show and remove it.
func (r *desktopRunner) adoptConfiguredAccounts() error {
	records, err := readAccounts(r.configPath)
	if err != nil {
		return err
	}
	changed := false
	adopt := func(platform, home string) {
		if slices.ContainsFunc(records, func(a accountRecord) bool { return a.Platform == platform }) {
			return
		}
		source := accountSourceLocal
		if home != "" && strings.HasPrefix(filepath.Clean(home)+string(filepath.Separator), filepath.Join(filepath.Dir(r.configPath), "accounts")+string(filepath.Separator)) {
			source = accountSourceImport
		}
		records = append(records, accountRecord{ID: newAccountID(), Platform: platform, Source: source, AddedAt: time.Now().UTC()})
		changed = true
	}
	if r.egress.Codex != nil {
		adopt("openai", r.egress.Codex.Home)
	}
	if r.egress.Claude != nil {
		home := ""
		if r.egress.Claude.ConfigDir != nil {
			home = *r.egress.Claude.ConfigDir
		}
		adopt("claude", home)
	}
	if r.egress.Antigravity != nil {
		adopt(beewire.GooglePlatform, "")
	}
	if !changed {
		return nil
	}
	return writeAccounts(r.configPath, records)
}

// detect reads a platform's official sign-in on this machine. It reads the
// local store only, except that a Claude sign-in is asked for its account
// once so the person can see which one it is.
func (r *desktopRunner) detect(ctx context.Context, platform string) accountDetection {
	found := accountDetection{Platform: platform}
	switch platform {
	case "openai":
		local := detectCodex(ctx, "")
		if local.problem != nil {
			found.Problem = problemOf(local.problem)
			return found
		}
		credential, err := local.codex.readForMaintenance(ctx)
		if err != nil {
			found.Problem = problemOf(failCause("BEE-CODEX-SOURCE", err))
			return found
		}
		found.Available, found.codex = true, local.codex
		found.Email, found.Plan, found.Fingerprint = credential.email, credential.Plan, credential.metadata().AccountFingerprint
	case "claude":
		local := detectClaude(ctx, nil, nil)
		if local.problem != nil {
			found.Problem = problemOf(local.problem)
			return found
		}
		credential, err := claudeReader(local.claude.Store, local.claude.ConfigDir)(ctx)
		if err != nil {
			found.Problem = problemOf(failCause("BEE-CLAUDE-SOURCE", err))
			return found
		}
		if !credential.hasProfileScope {
			found.Problem = &controlProblem{Code: "login_scope", Message: "this Claude Code sign-in cannot be shared: it lacks the user:profile permission; sign in to Claude Code again with a subscription account"}
			return found
		}
		found.Available, found.claude, found.Plan = true, local.claude, credential.plan
		if identity, err := r.claudeProfile(ctx, credential); err == nil {
			found.Email, found.Fingerprint = identity.email, identity.fingerprint()
		}
	case beewire.GooglePlatform:
		// The sign-in is Bee's own; bee antigravity-login puts it there.
		ui, _ := newInstallUI(io.Discard)
		local := detectAntigravity(filepath.Dir(r.configPath), ui)
		if local.problem != nil {
			found.Problem = problemOf(local.problem)
			return found
		}
		credential, err := local.antigravity.store().read()
		if err != nil {
			found.Problem = problemOf(failCause("BEE-ANTIGRAVITY-SOURCE", err))
			return found
		}
		found.Available, found.antigravity = true, local.antigravity
		found.Email, found.Plan, found.Fingerprint = credential.Email, credential.Plan, credential.fingerprint()
	}
	return found
}

// addAccount adds an account and starts sharing it. The account's source is
// written to the egress configuration and runs on the live connection.
func (r *desktopRunner) addAccount(ctx context.Context, request addAccountRequest) (accountRecord, error) {
	if !supplyPlatform(request.Platform) {
		return accountRecord{}, refuse(http.StatusNotFound, "unknown_platform", "platform must be openai, claude or google")
	}
	r.accountsMu.Lock()
	defer r.accountsMu.Unlock()
	records, err := readAccounts(r.configPath)
	if err != nil {
		return accountRecord{}, err
	}
	if slices.ContainsFunc(records, func(a accountRecord) bool { return a.Platform == request.Platform }) {
		return accountRecord{}, refuse(http.StatusConflict, "platform_has_account", "this version shares one account per platform; remove the current one first")
	}
	record := accountRecord{ID: newAccountID(), Platform: request.Platform, Source: request.Source, AddedAt: time.Now().UTC()}
	var found accountDetection
	switch request.Source {
	case accountSourceLocal:
		if found = r.detect(ctx, request.Platform); !found.Available {
			return accountRecord{}, &accountError{status: http.StatusUnprocessableEntity, problem: *found.Problem}
		}
	case accountSourceImport:
		if request.Platform == beewire.GooglePlatform {
			// There is no file of another client to import: Bee signs in itself.
			return accountRecord{}, refuse(http.StatusUnprocessableEntity, "import_unsupported", "a Google account cannot be imported from a file; run bee antigravity-login on this computer, then add the account from its sign-in")
		}
		if found, err = r.importCredential(ctx, record.ID, request); err != nil {
			return accountRecord{}, err
		}
	default:
		return accountRecord{}, refuse(http.StatusBadRequest, "invalid_request", `source must be "local" or "import"`)
	}
	record.Email, record.Plan, record.Fingerprint = found.Email, found.Plan, found.Fingerprint
	undo := func() {
		if record.Source == accountSourceImport {
			os.RemoveAll(importDirectory(r.configPath, record.ID))
		}
	}

	// The running source is a separate configuration holding only this
	// account, so nothing the connection already uses changes under it.
	sub := &egressConfig{Targets: platformUpstreams(request.Platform), ConnectProxy: r.egress.ConnectProxy}
	var setting any
	if found.codex != nil {
		sub.Codex, sub.Capabilities = &codexSource{Home: found.codex.Home, Store: found.codex.Store}, &capabilitySource{}
		setting = codexSource{Home: found.codex.Home, Store: found.codex.Store}
	} else if found.antigravity != nil {
		sub.Antigravity = &antigravitySource{Capabilities: true}
		setting = antigravitySetting{Capabilities: true}
	} else {
		sub.Claude = &claudeSource{Store: found.claude.Store, ConfigDir: found.claude.ConfigDir, Refresh: found.claude.Refresh, Capabilities: true}
		setting = claudeSetting{Store: found.claude.Store, ConfigDir: found.claude.ConfigDir, Refresh: found.claude.Refresh, Capabilities: true}
	}
	if err := sub.validate(); err != nil {
		undo()
		return accountRecord{}, err
	}
	sub.useStateDirectory(filepath.Dir(r.configPath))
	if err := addEgressSource(ctx, defaultEgressPath(r.configPath), request.Platform, setting); err != nil {
		undo()
		return accountRecord{}, err
	}
	if err := writeAccounts(r.configPath, append(records, record)); err != nil {
		removeEgressSource(ctx, defaultEgressPath(r.configPath), request.Platform)
		undo()
		return accountRecord{}, err
	}
	for _, source := range sub.fileSources() {
		source.targets = sub.Targets
		if err := r.egress.sources().add(source); err != nil {
			slog.Warn("account source already running", "module", "accounts", "platform", request.Platform, "error", err.Error())
		}
	}
	slog.Info("account added", "module", "accounts", "platform", record.Platform, "source", record.Source, "email", maskEmail(record.Email))
	r.status.publish(controlEvent{Name: "accounts", Data: map[string]string{"added": record.ID}})
	go r.startSharing(record)
	return record, nil
}

// startSharing resumes the platform in Hive, which a removed account left
// paused, and confirms the switch Hive asks for when the new account differs
// from the one it last knew: adding it was the person's explicit choice.
func (r *desktopRunner) startSharing(record accountRecord) {
	ctx, cancel := context.WithTimeout(context.Background(), r.confirmWindow)
	defer cancel()
	state, binding := r.status.device()
	if binding != bindingPaired {
		return
	}
	if _, err := updatePlatformSupply(ctx, r.client, state, record.Platform, false); err != nil {
		slog.Warn("resuming the platform after adding an account failed", "module", "accounts", "platform", record.Platform, "error", err.Error())
	}
	if record.Fingerprint == "" {
		return
	}
	for ctx.Err() == nil {
		account, err := readPlatformAccount(ctx, state, record.Platform)
		if err == nil {
			if account.Status == "confirmation_required" && account.PendingFingerprint == record.Fingerprint {
				if _, err := submitAccountConfirmation(ctx, state, record.Platform, account.PendingFingerprint, account.ConfirmationID); err != nil {
					slog.Warn("confirming the new account failed", "module", "accounts", "platform", record.Platform, "error", err.Error())
				} else {
					slog.Info("new account confirmed", "module", "accounts", "platform", record.Platform)
					r.status.publish(controlEvent{Name: "accounts", Data: map[string]string{"confirmed": record.ID}})
				}
				return
			}
			if account.AccountFingerprint == record.Fingerprint && account.Status != "confirmation_required" {
				return
			}
		}
		if pause(ctx, r.confirmPoll) != nil {
			return
		}
	}
}

// importCredential checks a credential file and copies it into the
// account's private directory.
func (r *desktopRunner) importCredential(ctx context.Context, id string, request addAccountRequest) (accountDetection, error) {
	found := accountDetection{Platform: request.Platform}
	raw, err := readImportFile(request.File)
	if err != nil {
		return found, err
	}
	defer clear(raw)
	directory := importDirectory(r.configPath, id)
	var name string
	switch request.Platform {
	case "openai":
		credential, err := parseCodexCredential(raw)
		if err != nil {
			return found, refuse(http.StatusUnprocessableEntity, "import_invalid", "this is not a usable Codex sign-in (auth.json): "+err.Error())
		}
		if !time.Now().Before(credential.ExpiresAt) && credential.refreshToken == "" {
			return found, refuse(http.StatusUnprocessableEntity, "import_expired", "this Codex sign-in has expired and cannot be renewed; sign in again and export a new auth.json")
		}
		found.Email, found.Plan, found.Fingerprint = credential.email, credential.Plan, credential.metadata().AccountFingerprint
		found.codex, name = &codexSource{Home: directory, Store: "file"}, "auth.json"
	case "claude":
		credential, err := parseClaudeCredential(raw)
		if err != nil {
			return found, refuse(http.StatusUnprocessableEntity, "import_invalid", "this is not a usable Claude Code sign-in (.credentials.json): "+err.Error())
		}
		if !credential.hasInferenceScope || !credential.hasProfileScope {
			return found, refuse(http.StatusUnprocessableEntity, "import_scope", "this Claude Code sign-in cannot be shared: it lacks a required permission; sign in to Claude Code again with a subscription account and export again")
		}
		if !credential.available(time.Now()) && !credential.hasRefreshToken {
			return found, refuse(http.StatusUnprocessableEntity, "import_expired", "this Claude Code sign-in has expired and cannot be renewed; sign in again and export a new .credentials.json")
		}
		found.Plan = credential.plan
		if identity, err := r.claudeProfile(ctx, credential); err == nil {
			found.Email, found.Fingerprint = identity.email, identity.fingerprint()
		}
		// Nothing else renews an imported sign-in, so Bee does.
		found.claude, name = &claudeSource{Store: claudeStoreFile, ConfigDir: &directory, Refresh: true, Capabilities: true}, ".credentials.json"
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return found, err
	}
	for _, dir := range []string{filepath.Dir(directory), directory} {
		if err := os.Chmod(dir, 0o700); err != nil {
			return found, err
		}
	}
	if err := writePrivateFile(filepath.Join(directory, name), raw, ".import-*"); err != nil {
		os.RemoveAll(directory)
		return found, err
	}
	found.Available = true
	return found, nil
}

func readImportFile(path string) ([]byte, error) {
	if path == "" {
		return nil, refuse(http.StatusBadRequest, "invalid_request", "file is required to import an account")
	}
	file, err := openRegularNoFollow(path)
	if err != nil {
		return nil, refuse(http.StatusUnprocessableEntity, "import_unreadable", "cannot read the credential file: "+err.Error())
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxImportBytes+1))
	if err != nil {
		return nil, refuse(http.StatusUnprocessableEntity, "import_unreadable", "cannot read the credential file: "+err.Error())
	}
	if len(raw) > maxImportBytes {
		return nil, refuse(http.StatusUnprocessableEntity, "import_invalid", "the file is too large to be a credential file")
	}
	return raw, nil
}

// removeAccount stops sharing an account and forgets it. On a live connection
// the platform is paused in Hive first and its streams are given time to
// finish, so no buyer request is cut off.
func (r *desktopRunner) removeAccount(ctx context.Context, id string) error {
	r.accountsMu.Lock()
	defer r.accountsMu.Unlock()
	records, err := readAccounts(r.configPath)
	if err != nil {
		return err
	}
	i := slices.IndexFunc(records, func(a accountRecord) bool { return a.ID == id })
	if i < 0 {
		return refuse(http.StatusNotFound, "not_found", "no account with this id")
	}
	record := records[i]
	state, binding := r.status.device()
	if binding == bindingPaired && r.status.currentConnection() == connectionConnected {
		if _, err := updatePlatformSupply(ctx, r.client, state, record.Platform, true); err != nil {
			return refuse(http.StatusBadGateway, "pause_unconfirmed", err.Error())
		}
		open := func() (n int) {
			for _, target := range platformUpstreams(record.Platform) {
				n += r.egress.activeStreams(target)
			}
			return n
		}
		deadline := time.Now().Add(r.drainTimeout)
		for open() > 0 && time.Now().Before(deadline) {
			if pause(ctx, 200*time.Millisecond) != nil {
				return ctx.Err()
			}
		}
		if n := open(); n > 0 {
			slog.Warn("removing account with streams still open", "module", "accounts", "platform", record.Platform, "streams", n)
		}
	}
	r.egress.sources().remove(sourceName(record.Platform))
	if err := removeEgressSource(ctx, defaultEgressPath(r.configPath), record.Platform); err != nil {
		return err
	}
	if err := writeAccounts(r.configPath, slices.Delete(records, i, i+1)); err != nil {
		return err
	}
	if record.Source == accountSourceImport {
		if err := os.RemoveAll(importDirectory(r.configPath, record.ID)); err != nil {
			slog.Warn("imported credential copy not removed", "module", "accounts", "error", err.Error())
		}
	}
	slog.Info("account removed", "module", "accounts", "platform", record.Platform)
	r.status.publish(controlEvent{Name: "accounts", Data: map[string]string{"removed": record.ID}})
	return nil
}

// confirmAccount accepts the account an official client switched to.
func (r *desktopRunner) confirmAccount(ctx context.Context, id string) (beewire.PlatformAccount, error) {
	r.accountsMu.Lock()
	defer r.accountsMu.Unlock()
	records, err := readAccounts(r.configPath)
	if err != nil {
		return beewire.PlatformAccount{}, err
	}
	i := slices.IndexFunc(records, func(a accountRecord) bool { return a.ID == id })
	if i < 0 {
		return beewire.PlatformAccount{}, refuse(http.StatusNotFound, "not_found", "no account with this id")
	}
	state, binding := r.status.device()
	if binding != bindingPaired {
		return beewire.PlatformAccount{}, refuse(http.StatusConflict, "not_paired", "this Bee is not paired with Hive")
	}
	platform := records[i].Platform
	account, err := readPlatformAccount(ctx, state, platform)
	if err != nil {
		return account, refuse(http.StatusBadGateway, "hive_unavailable", err.Error())
	}
	if account.Status != "confirmation_required" || account.PendingFingerprint == "" {
		return account, refuse(http.StatusConflict, "no_pending_switch", "Hive is not waiting for an account switch on this platform")
	}
	confirmed, err := submitAccountConfirmation(ctx, state, platform, account.PendingFingerprint, account.ConfirmationID)
	if err != nil {
		return confirmed, refuse(http.StatusBadGateway, "confirmation_unconfirmed", err.Error())
	}
	records[i].Fingerprint = confirmed.AccountFingerprint
	records[i].Email, records[i].Plan = "", ""
	if records[i].Source == accountSourceLocal {
		if found := r.detect(ctx, platform); found.Available && found.Fingerprint == confirmed.AccountFingerprint {
			records[i].Email, records[i].Plan = found.Email, found.Plan
		}
	}
	if err := writeAccounts(r.configPath, records); err != nil {
		return confirmed, fmt.Errorf("account confirmed, but its record was not updated: %w", err)
	}
	r.status.publish(controlEvent{Name: "accounts", Data: map[string]string{"confirmed": id}})
	return confirmed, nil
}
