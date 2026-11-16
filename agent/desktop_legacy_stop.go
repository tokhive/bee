package bee

import (
	"context"
	"fmt"
	"slices"
)

// Explicit old wire shape keeps strict missing/null checks on all old fields.
type desktopAccountScopeV2 struct {
	Hive              string                             `json:"hive"`
	OwnerID           string                             `json:"owner_id"`
	DeviceID          string                             `json:"device_id"`
	Selections        map[string]desktopAccountSelection `json:"selections"`
	PendingOperations map[string]desktopPendingOperation `json:"pending_operations"`
	RuntimeIntent     desktopRuntimeIntent               `json:"runtime_intent"`
	Session           desktopSessionMarker               `json:"session"`
}

func (old desktopAccountScopeV2) upgrade() desktopAccountScope {
	migration := desktopLegacyStopMigration{State: "not_required", Platforms: map[string]desktopLegacyStopPlatform{}}
	if !old.RuntimeIntent.Running && len(old.Selections) > 0 {
		original := old.RuntimeIntent
		original.ResumePlatforms = append([]string{}, original.ResumePlatforms...)
		migration.State, migration.OriginalIntent = "pending", &original
		for platform, selection := range old.Selections {
			migration.Platforms[platform] = desktopLegacyStopPlatform{Selection: selection, Stage: "intent"}
		}
	}
	return desktopAccountScope{Hive: old.Hive, OwnerID: old.OwnerID, DeviceID: old.DeviceID, Selections: old.Selections, PendingOperations: old.PendingOperations, RuntimeIntent: old.RuntimeIntent, Session: old.Session, LegacyStop: migration}
}

func validateDesktopLegacyStop(m desktopLegacyStopMigration) error {
	if !slices.Contains([]string{"not_required", "pending", "reconciling", "completed"}, m.State) || m.Platforms == nil || len(m.Platforms) > 2 {
		return fmt.Errorf("legacy stop migration header rejected: state=%q platforms=%d null=%t; required=known state, non-null <=2 platforms", m.State, len(m.Platforms), m.Platforms == nil)
	}
	if m.State == "not_required" {
		if m.OriginalIntent != nil || len(m.Platforms) != 0 {
			return fmt.Errorf("unneeded legacy stop migration has legacy evidence: original_present=%t platforms=%d", m.OriginalIntent != nil, len(m.Platforms))
		}
		return nil
	}
	if m.OriginalIntent == nil || m.OriginalIntent.Running || m.OriginalIntent.ResumePlatforms == nil || len(m.Platforms) == 0 {
		return fmt.Errorf("legacy stop migration origin rejected: original_present=%t platforms=%d; required=explicit stopped original and selected platforms", m.OriginalIntent != nil, len(m.Platforms))
	}
	seen := map[string]bool{}
	for _, platform := range m.OriginalIntent.ResumePlatforms {
		if _, ok := m.Platforms[platform]; !ok || seen[platform] {
			return fmt.Errorf("legacy resume evidence rejected: platform=%s repeated=%t; required=unique original selected platform", platform, seen[platform])
		}
		seen[platform] = true
	}
	for platform, record := range m.Platforms {
		selection := record.Selection
		if err := validateDesktopStoredSource(platform, selection.Source); err != nil {
			return err
		}
		if !desktopAccountDigest(selection.Fingerprint) || !desktopAccountDigest(selection.CredentialRevision) || !desktopSafeRevision(selection.Generation) || !desktopSafeRevision(selection.Revision) || selection.Revision == 0 {
			return fmt.Errorf("legacy stop selection evidence rejected: platform=%s generation=%d revision=%d; required=valid identity digests and safe selection revisions", platform, selection.Generation, selection.Revision)
		}
		if !slices.Contains([]string{"intent", "submitted", "confirmed"}, record.Stage) || m.State == "completed" && record.Stage != "confirmed" {
			return fmt.Errorf("legacy stop platform progress rejected: platform=%s stage=%s state=%s; required=known stage, all confirmed when completed", platform, record.Stage, m.State)
		}
	}
	return nil
}

func desktopLegacyStopPending(s desktopAccountScope) bool {
	return s.LegacyStop.State == "pending" || s.LegacyStop.State == "reconciling"
}

func desktopLegacyStopPlatforms(s desktopAccountScope) []string {
	platforms := []string{}
	for _, platform := range []string{"openai", "claude"} {
		if _, ok := s.LegacyStop.Platforms[platform]; ok {
			platforms = append(platforms, platform)
		}
	}
	return platforms
}

func (r *DesktopRuntime) publishLegacyStop(s desktopAccountScope, phase string, failure error, recheck bool) {
	if s.LegacyStop.State == "not_required" {
		return
	}
	var publicError *DesktopAccountError
	if failure != nil {
		publicError = accountFailure("unknown", "legacy_stop_unconfirmed", "legacy_stop_migration", failure.Error())
	}
	r.mu.Lock()
	r.snapshot.LegacyStop = &DesktopLegacyStopStatus{Phase: phase, Platforms: desktopLegacyStopPlatforms(s), Error: publicError, CanRecheck: recheck}
	r.snapshot.Revision++
	r.mu.Unlock()
}

// This phase owns no runtime session/guard and can survive process interruption.
// Once submitted is durable, every later attempt can only read that platform.
func (r *DesktopRuntime) migrateLegacyStop(ctx context.Context, session *desktopDeviceSession, state localState, scope desktopAccountScope) (result desktopAccountScope, failure error) {
	result = scope
	if !desktopLegacyStopPending(scope) {
		if scope.LegacyStop.State == "completed" {
			r.publishLegacyStop(scope, "completed", nil, false)
		}
		return result, nil
	}
	r.publishLegacyStop(scope, "processing", nil, false)
	defer func() {
		if failure != nil {
			phase := "blocked"
			if result.LegacyStop.State == "reconciling" {
				phase = "reconciling"
			}
			r.publishLegacyStop(result, phase, failure, true)
		}
	}()
	if err := r.legacyStopPrerequisites(session, state, scope); err != nil {
		return result, err
	}
	// Verify every original selected source before the first platform write.
	for _, platform := range desktopLegacyStopPlatforms(scope) {
		selection := scope.LegacyStop.Platforms[platform].Selection
		if err := r.verifyLegacyStopSource(ctx, platform, selection); err != nil {
			return result, err
		}
	}
	// Persist even when all platforms are already paused; this preserves the
	// original file before any remote write and binds progress to its selections.
	var err error
	result, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error { return r.legacyStopBinding(scope, *s) })
	if err != nil {
		return result, err
	}
	for _, platform := range desktopLegacyStopPlatforms(result) {
		record := result.LegacyStop.Platforms[platform]
		if record.Stage == "confirmed" {
			continue
		}
		observed, err := desktopSupplyCall(ctx, state, platform, nil)
		if err != nil {
			return result, fmt.Errorf("legacy stop pause read failed: platform=%s stage=%s: %w", platform, record.Stage, err)
		}
		if !observed.Paused {
			if record.Stage == "submitted" {
				return result, fmt.Errorf("legacy stop pause remains unconfirmed: platform=%s stage=submitted GET_paused=false; original PUT must not be replayed", platform)
			}
			if err := r.verifyLegacyStopSource(ctx, platform, record.Selection); err != nil {
				return result, err
			}
			result, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
				if err := r.legacyStopBinding(result, *s); err != nil {
					return err
				}
				record.Stage = "submitted"
				s.LegacyStop.Platforms[platform] = record
				s.LegacyStop.State = "reconciling"
				return nil
			})
			if err != nil {
				return result, err
			}
			if err := ctx.Err(); err != nil {
				return result, err
			}
			yes := true
			written, writeErr := desktopSupplyCall(ctx, state, platform, &yes)
			if writeErr != nil {
				return result, fmt.Errorf("legacy stop pause write result unknown: platform=%s; recheck original result, never replay PUT: %w", platform, writeErr)
			}
			if !written.Paused {
				return result, fmt.Errorf("legacy stop pause PUT unconfirmed: platform=%s paused=false; recheck original result, never replay PUT", platform)
			}
			observed, err = desktopSupplyCall(ctx, state, platform, nil)
			if err != nil {
				return result, fmt.Errorf("legacy stop pause readback unknown: platform=%s; never replay PUT: %w", platform, err)
			}
			if !observed.Paused {
				return result, fmt.Errorf("legacy stop pause readback unconfirmed: platform=%s GET_paused=false; never replay PUT", platform)
			}
		}
		result, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
			if err := r.legacyStopBinding(result, *s); err != nil {
				return err
			}
			record.Stage = "confirmed"
			s.LegacyStop.Platforms[platform] = record
			return nil
		})
		if err != nil {
			return result, err
		}
	}
	// Stop admission and the migration's maintenance intent share the same
	// lock, so completion cannot overwrite a later explicit stop.
	r.mu.Lock()
	if ctx.Err() != nil || r.snapshot.Local != "starting" {
		local := r.snapshot.Local
		r.mu.Unlock()
		return result, fmt.Errorf("legacy stop completion cancelled: local=%s context_cancelled=%t; original migration retained", local, ctx.Err() != nil)
	}
	result, err = r.accounts.selectionScope(session, state, func(s *desktopAccountScope) error {
		if err := r.legacyStopBinding(result, *s); err != nil {
			return err
		}
		for platform, record := range s.LegacyStop.Platforms {
			if record.Stage != "confirmed" {
				return fmt.Errorf("legacy stop completion lacks pause confirmation: platform=%s stage=%s", platform, record.Stage)
			}
		}
		s.LegacyStop.State = "completed"
		s.RuntimeIntent = desktopRuntimeIntent{Running: true, ResumePlatforms: []string{}}
		return nil
	})
	r.mu.Unlock()
	if err != nil {
		return result, err
	}
	r.publishLegacyStop(result, "completed", nil, false)
	return result, nil
}

func (r *DesktopRuntime) verifyLegacyStopSource(ctx context.Context, platform string, selection desktopAccountSelection) error {
	current, sourceErr := r.accounts.readAccountSource(ctx, DesktopAccountDetectRequest{Platform: platform, Directory: selection.Source.Directory, Store: selection.Source.Store, Mode: "local"})
	revision := current.revision
	current.clear()
	if sourceErr != nil {
		return sourceErr
	}
	_, err := r.accounts.selectionSource(ctx, platform, desktopPendingOperation{Source: selection.Source, ToFingerprint: selection.Fingerprint, CredentialRevision: revision})
	return err
}

func (r *DesktopRuntime) legacyStopBinding(original, current desktopAccountScope) error {
	if !desktopLegacyStopPending(current) || len(current.PendingOperations) != 0 || current.Session.Active || !current.Session.Clean || len(original.LegacyStop.Platforms) != len(current.LegacyStop.Platforms) || len(current.Selections) != len(original.LegacyStop.Platforms) {
		return fmt.Errorf("legacy stop evidence changed: state=%s pending=%d session_active=%t session_clean=%t selected=%d original_platforms=%d", current.LegacyStop.State, len(current.PendingOperations), current.Session.Active, current.Session.Clean, len(current.Selections), len(original.LegacyStop.Platforms))
	}
	for platform, record := range original.LegacyStop.Platforms {
		selected, ok := current.Selections[platform]
		if !ok || selected.Fingerprint != record.Selection.Fingerprint || selected.Generation != record.Selection.Generation || selected.Revision != record.Selection.Revision || !sameDesktopAuthorizationSource(selected.Source, record.Selection.Source) {
			return fmt.Errorf("legacy stop selection changed: platform=%s selection_present=%t; original migration retained", platform, ok)
		}
	}
	return nil
}

func (r *DesktopRuntime) legacyStopPrerequisites(session *desktopDeviceSession, state localState, scope desktopAccountScope) error {
	if err := r.legacyStopBinding(scope, scope); err != nil {
		return err
	}
	return r.verifyCleanLegacyStopGuard(session)
}
