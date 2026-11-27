package bee

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/tokhive/bee/beewire"
)

// refresh carries out a refresh_authorization task: a new access token from
// Google, saved before Hive is told anything.
//
// Google neither rotates a refresh token nor consumes it, so a refresh whose
// result was lost is simply made again with the next task, and nothing has to
// remember one in flight the way the journal does for Claude. What is
// remembered is a refresh Google refused for good: the store records it, so
// the dead token is not offered again by this Bee or the next one started.
func (source *antigravitySource) refresh(ctx context.Context, task beewire.MaintenanceTask) (antigravityCredential, error) {
	var empty antigravityCredential
	store := source.store()
	unlock, err := store.lock(ctx)
	if err != nil {
		return empty, err
	}
	defer unlock()
	current, err := store.read()
	if err != nil || current.fingerprint() != task.AccountFingerprint || antigravityDigest(current.AccessToken) != task.CredentialRevision {
		return empty, errAntigravitySourceChanged
	}
	if current.RefreshToken == "" {
		return empty, errAntigravityExpired
	}
	updated, err := refreshAntigravity(ctx, current, source.transport)
	var rejection *antigravityRejection
	if errors.As(err, &rejection) {
		slog.Warn("google refused the Antigravity refresh token", "module", "maintenance", "answer", rejection.code)
		current.Rejected = rejection.code
		if saveErr := store.write(current); saveErr != nil {
			slog.Warn("rejected Antigravity sign-in not recorded", "module", "maintenance", "error", saveErr.Error())
		}
		return empty, errAntigravitySignIn
	}
	if err != nil {
		return empty, err
	}
	// The project and plan follow the account. They are asked for again with
	// the new token, and kept as they were when Google does not say.
	if account, err := antigravityLoad(updated.AccessToken, antigravityAnywhere(ctx, source.transport, updated.AccessToken)); err == nil {
		updated.Tier, updated.Plan = account.tier, account.plan
		if beewire.ValidProjectID(account.project) {
			updated.ProjectID = account.project
		}
	}
	if !updated.Private {
		if err := antigravityKeepPrivate(ctx, source.transport, updated.AccessToken, updated.ProjectID); err != nil {
			slog.Warn("Google's product-improvement setting is not confirmed off yet", "module", "antigravity", "error", safeText(err.Error(), updated.AccessToken))
		} else {
			updated.Private = true
			slog.Info("turned off Google's product-improvement setting for the Antigravity account", "module", "antigravity")
		}
	}
	if err := store.write(updated); err != nil {
		return empty, fmt.Errorf("save the refreshed Antigravity sign-in: %w", err)
	}
	saved, err := store.read()
	if err != nil || !saved.same(updated) {
		return empty, errAntigravitySourceChanged
	}
	return saved, nil
}
