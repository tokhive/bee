//! Installation consumes S1 exit evidence; this module never stops processes by name.
use tauri::Manager;
use crate::{
    protocol::BridgeError,
    updater::{error, PendingUpdate, UpdateManager, UpdateSnapshot, UpdateState},
};
use serde::Deserialize;
use std::future::Future;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateInstallRequest {
    pub operation_id: String,
    pub expected_revision: u64,
    pub confirmed: bool,
}

pub use crate::runtime::OwnedExitReceipt as UpdateExitReceipt;
pub struct InstallTicket {
    operation_id: String,
}

pub fn prepare_install(
    manager: &UpdateManager,
    request: &UpdateInstallRequest,
) -> Result<InstallTicket, BridgeError> {
    if !request.confirmed {
        return Err(error(
            "UPDATE_CONFIRMATION_REQUIRED",
            "update installation confirmed=false; required=explicit quit-and-install confirmation",
        ));
    }
    let mut inner = manager.lock()?;
    UpdateManager::require(&inner, &request.operation_id, UpdateState::Verified)?;
    if request.expected_revision != inner.snapshot.revision {
        return Err(error(
            "UPDATE_STALE_REVISION",
            format!(
                "install revision={}; required=current {}",
                request.expected_revision, inner.snapshot.revision
            ),
        ));
    }
    if inner.bytes.is_none() {
        return Err(error(
            "UPDATE_BYTES_MISSING",
            "verified update bytes missing; no exit or installation performed",
        ));
    }
    let asset = inner.asset.as_ref().ok_or_else(|| {
        error(
            "UPDATE_IDENTITY_MISSING",
            "verified update asset identity missing; no exit performed",
        )
    })?;
    let mut persistent = inner.persistent.clone();
    persistent.pending_update = Some(PendingUpdate {
        from_version: inner.snapshot.current_version.clone(),
        to_version: asset.version.clone(),
        channel: asset.channel.clone(),
        stage: "stopping".into(),
        target_digest: asset.sha256.clone(),
    });
    manager.store.write(&persistent)?;
    inner.persistent = persistent;
    inner.snapshot.state = UpdateState::Stopping;
    inner.snapshot.error = None;
    UpdateManager::advance(&mut inner)?;
    Ok(InstallTicket {
        operation_id: request.operation_id.clone(),
    })
}

pub(crate) fn prepare_owned_install(
    manager: &UpdateManager,
    request: &UpdateInstallRequest,
    bridge: &crate::sidecar::Bridge,
) -> Result<InstallTicket, BridgeError> {
    let ticket = prepare_install(manager, request)?;
    // Freeze on the command's admission path. The detached coordinator may not
    // be polled before another WebView or startup action reaches the bridge.
    bridge.freeze_for_exit();
    Ok(ticket)
}

pub async fn coordinate_install<F, Fut, I>(
    manager: &UpdateManager,
    ticket: InstallTicket,
    prepare_owned_exit: F,
    install: I,
) -> Result<UpdateSnapshot, BridgeError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<UpdateExitReceipt, BridgeError>>,
    I: FnOnce() -> Result<(), BridgeError>,
{
    let id = &ticket.operation_id;
    let result=async{
        let receipt=prepare_owned_exit().await?;
        if !(receipt.intent_saved&&receipt.session_clean&&receipt.child_reaped&&receipt.config_lock_released){return Err(error("UPDATE_EXIT_UNPROVEN",format!("owned exit receipt intent_saved={} session_clean={} child_reaped={} config_lock_released={}; required=all true; installer not called",receipt.intent_saved,receipt.session_clean,receipt.child_reaped,receipt.config_lock_released)));}
        {
            let mut inner=manager.lock()?;UpdateManager::require(&inner,id,UpdateState::Stopping)?;
            let mut next=inner.persistent.clone();let pending=next.pending_update.as_mut().ok_or_else(||error("UPDATE_MARKER_MISSING","pending update missing after owned exit; stopped, installer not called"))?;pending.stage="stopped".into();
            manager.store.write(&next)?;inner.persistent=next;
        }
        // Windows may terminate this process inside install(); persist and expose
        // the handoff before calling the platform API, while the singleton is held.
        {
            let mut inner=manager.lock()?;UpdateManager::require(&inner,id,UpdateState::Stopping)?;
            let mut next=inner.persistent.clone();let pending=next.pending_update.as_mut().ok_or_else(||error("UPDATE_MARKER_MISSING","pending update missing before installer handoff"))?;
            pending.stage="installing".into();manager.store.write(&next)?;inner.persistent=next;
            inner.snapshot.state=UpdateState::Installing;UpdateManager::advance(&mut inner)?;
        }
        if let Err(cause)=install(){
            let mut inner=manager.lock()?;
            let mut next=inner.persistent.clone();
            if let Some(pending)=next.pending_update.as_mut(){pending.stage="stopped".into();}
            let persistence=manager.store.write(&next);
            if persistence.is_ok(){inner.persistent=next;}
            let detail=persistence.err().map(|e|format!("; stopped marker write failed: {}: {}",e.code,e.message)).unwrap_or_default();
            return Err(error("UPDATE_INSTALL_FAILED",format!("owned Bee stopped; native installer failed: {}: {}{detail}; data and pending update preserved; retry using a trusted installer",cause.code,cause.message)));
        }
        manager.snapshot()
    }.await;
    match result {
        Ok(snapshot) => Ok(snapshot),
        Err(cause) => {
            manager.fail(id, cause.clone())?;
            Err(cause)
        }
    }
}

/// These proofs come from actual package, S1 and S2 startup checks, never IPC arguments.
pub struct RecoveryEvidence {
    pub package_source_verified: bool,
    pub protocol_verified: bool,
    pub account_state_verified: bool,
    pub preferences_verified: bool,
    pub pending_actions_verified: bool,
    pub runtime_intent_restored: bool,
}
pub fn complete_recovery(
    manager: &UpdateManager,
    current_version: &str,
    evidence: &RecoveryEvidence,
) -> Result<(), BridgeError> {
    let mut inner = manager.lock()?;
    let pending = inner
        .persistent
        .pending_update
        .as_ref()
        .ok_or_else(|| error("UPDATE_RECOVERY_NOT_PENDING", "no pending update to verify"))?;
    if current_version != pending.to_version {
        return Err(error(
            "UPDATE_RECOVERY_VERSION_MISMATCH",
            format!(
                "running version={current_version}; required=pending target {}; marker preserved",
                pending.to_version
            ),
        ));
    }
    if !(evidence.package_source_verified
        && evidence.protocol_verified
        && evidence.account_state_verified
        && evidence.preferences_verified
        && evidence.pending_actions_verified
        && evidence.runtime_intent_restored)
    {
        return Err(error("UPDATE_RECOVERY_UNPROVEN",format!("recovery evidence package={} protocol={} account_state={} preferences={} pending_actions={} runtime_intent={}; required=all true; update not marked complete",evidence.package_source_verified,evidence.protocol_verified,evidence.account_state_verified,evidence.preferences_verified,evidence.pending_actions_verified,evidence.runtime_intent_restored)));
    }
    let mut next = inner.persistent.clone();
    next.pending_update = None;
    manager.store.write(&next)?;
    inner.persistent = next;
    inner.snapshot.state = UpdateState::Current;
    inner.snapshot.error = None;
    inner.snapshot.current_version = current_version.into();
    UpdateManager::advance(&mut inner)
}

/// This is called before exposing the Bridge to the WebView. The separate startup
/// gate never unfreezes an owned exit that races with startup verification.
pub(crate) fn hold_startup(bridge: &crate::sidecar::Bridge) {
    bridge
        .0
        .startup_verified
        .store(false, std::sync::atomic::Ordering::SeqCst);
}

pub(crate) async fn verify_startup(
    manager: &UpdateManager,
    bridge: &crate::sidecar::Bridge,
    preferences: crate::preferences::PreferencesSnapshot,
    current_channel: &str,
) -> Result<(), BridgeError> {
    verify_startup_progress(manager, bridge, preferences, current_channel, &|_| {}, false).await
}
pub(crate) async fn verify_startup_progress(
    manager: &UpdateManager,
    bridge: &crate::sidecar::Bridge,
    preferences: crate::preferences::PreferencesSnapshot,
    current_channel: &str,
    progress: &(impl Fn(crate::startup_recovery::RecoveryProgress) + Send + Sync),
    manual_retry: bool,
) -> Result<(), BridgeError> {
    bridge.check_restore_admission()?;
    let pending = manager.lock()?.persistent.pending_update.clone();
    let mut restore_attempted = false;
    let result = async {
        if let Some(cause) = preferences.error {
            return Err(error("UPDATE_PREFERENCES_UNVERIFIED",format!("startup preferences rejected: {}: {}; runtime restore not started",cause.code,cause.message)));
        }
        if let Some(pending) = &pending {
            let version=manager.snapshot()?.current_version;
            if (pending.to_version != version && pending.from_version != version) || pending.channel != current_channel {
                return Err(error("UPDATE_RECOVERY_IDENTITY_MISMATCH",format!("startup version={version} channel={current_channel}; required=pending target {} or trusted previous {} in channel {}; runtime restore not started",pending.to_version,pending.from_version,pending.channel)));
            }
        }
        // S1 verifies the bundled child, protocol, pairing, account format, pending
        // operations and saved running/paused intent. Admission alone is insufficient.
        progress(crate::startup_recovery::RecoveryProgress::stage("checking_previous"));
        let mut inspection = bridge.inspect_recovery().await?;
        if inspection.requires_retirement() {
            inspection=bridge.reconcile_recovery().await?;
        }
        if let Some(cause)=inspection.failure { return Err(cause); }
        let journal=bridge.startup_journal(manager.store.path());
        let current_instance=bridge.status().metadata.ok_or_else(||error("RECOVERY_CONTEXT_INVALID","management metadata missing after session retirement"))?.instance;
        journal.retire_previous(&inspection,&current_instance)?;
        let previous=journal.observe(bridge).await?;
        if let Some(old)=previous.as_ref() {
            if old.phase=="failed" && manual_retry {bridge.0.restored.store(false,std::sync::atomic::Ordering::SeqCst);}
            else if !["succeeded","retired"].contains(&old.phase.as_str()) {
                return Err(old.failure.clone().unwrap_or_else(||error("RECOVERY_RESULT_UNCONFIRMED",format!("prior recovery attempt={} operation={:?} phase={}; query original result before retry; no restore submitted",old.attempt_id,old.operation_id,old.phase))));
            }
        }
        let status=bridge.status();
        let instance=status.metadata.ok_or_else(||error("RECOVERY_CONTEXT_INVALID","management metadata missing before restore"))?.instance;
        let local=bridge.device_context().await?;
        if local.instance!=instance || crate::protocol::device_context_state(&local.result)?.binding_revision!=inspection.binding_revision {
            return Err(error("STARTUP_CONTEXT_CHANGED","binding or instance changed after recovery inspection; no restore submitted"));
        }
        let runtime=bridge.runtime_snapshot().await?;
        let network=runtime.result["runtime"]["network_revision"].as_u64().ok_or_else(||error("RECOVERY_CONTEXT_INVALID","runtime network revision missing"))?;
        let mut record=crate::startup_recovery::RecoveryRecord{version:1,attempt_id:format!("{:032x}",time::OffsetDateTime::now_utc().unix_timestamp_nanos() as u128),instance,binding_revision:inspection.binding_revision,binding_identity:inspection.binding_identity,network_revision:network,previous_run_id:inspection.previous_run_id,account_revision:inspection.account_revision,intent_running:inspection.intent_running,trigger:if manual_retry{"manual"}else{"automatic"}.into(),previous_attempt_id:previous.as_ref().map(|v|v.attempt_id.clone()),operation_id:None,phase:"submitted".into(),failure:None};
        journal.save(&record)?;
        restore_attempted = true;
        let restored=bridge.restore_with_progress(&|p| { progress(p); }, Some((&journal,&mut record))).await;
        if record.phase!="failed" {
            record.phase=if restored.is_ok(){"succeeded"}else{"unknown"}.into();
            record.failure=restored.as_ref().err().cloned();
        }
        // Unknown submissions stay unresolved even when cleanup later succeeds.
        journal.save(&record)?;
        restored?;
        bridge.check_restore_admission()?;
        if let Some(pending) = &pending {
            let version = manager.snapshot()?.current_version;
            if version == pending.to_version {
                complete_recovery(manager, &version, &RecoveryEvidence {
                    package_source_verified:true, protocol_verified:true, account_state_verified:true,
                    preferences_verified:true, pending_actions_verified:true, runtime_intent_restored:true,
                })?;
            } else {
                // The bundled source/protocol and S1/S2 readers have all succeeded
                // in the previous trusted package. Permit another update attempt,
                // while reporting that the target was never installed.
                let mut inner = manager.lock()?;
                let mut next = inner.persistent.clone();
                next.pending_update = None;
                manager.store.write(&next)?;
                inner.persistent = next;
                inner.snapshot.state = UpdateState::Failed;
                inner.snapshot.error = Some(error("UPDATE_PREVIOUS_NOT_INSTALLED",format!("running trusted previous version={version}; pending target={} was not installed; data and runtime verified; update may be retried",pending.to_version)));
                UpdateManager::advance(&mut inner)?;
            }
        }
        bridge.0.startup_verified.store(true,std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }.await;
    if let Err(mut cause) = result {
        // An admitted App exit or update owns the stop now. A late startup
        // result must neither replay its stop nor replace the install state.
        if bridge.check_restore_admission().is_err() {
            return Err(cause);
        }
        if restore_attempted {
            match bridge.stop_failed_restore().await {
                Ok(()) => {
                    bridge
                        .0
                        .startup_verified
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    cause.message.push_str("; recovery stopped with saved intent and clean session; management readback and explicit actions available; pending update preserved, restart after resolving the failure");
                }
                Err(cleanup) => cause.message.push_str(&format!(
                    "; {}: {}; startup remains blocked",
                    cleanup.code, cleanup.message
                )),
            }
        }
        if pending.is_some()
            || restore_attempted
            || !bridge
                .0
                .startup_verified
                .load(std::sync::atomic::Ordering::SeqCst)
        {
            let mut inner = manager.lock()?;
            inner.snapshot.state = UpdateState::Failed;
            inner.snapshot.error = Some(cause.clone());
            UpdateManager::advance(&mut inner)?;
        }
        return Err(cause);
    }
    Ok(())
}

/// Business rechecks never restore intent or claim pending-update recovery.
pub(crate) async fn verify_recheck(
    manager: &UpdateManager,
    bridge: &crate::sidecar::Bridge,
    preferences: crate::preferences::PreferencesSnapshot,
) -> Result<(), BridgeError> {
    if let Some(cause) = preferences.error {
        return Err(cause);
    }
    if manager.has_pending()? {
        return Err(error("UPDATE_RECOVERY_PENDING","pending update recovery has not proven all required startup evidence; device recheck cannot restore runtime intent or clear the update marker"));
    }
    bridge.verify_local_startup().await?;
    Ok(())
}

#[tauri::command]
pub(crate) fn update_install(
    app: tauri::AppHandle,
    manager: tauri::State<'_, UpdateManager>,
    bridge: tauri::State<'_, crate::hive_switch::CurrentBridge>,
    request: UpdateInstallRequest,
) -> Result<UpdateSnapshot, BridgeError> {
    let bridge=bridge.get()?;
    if app.state::<crate::hive_switch::HiveSwitch>().pending()? {return Err(error("HIVE_SWITCH_BUSY","update installation waits for the existing Hive switch to settle"));}
    if !request.confirmed {
        return Err(error(
            "UPDATE_CONFIRMATION_REQUIRED",
            "quit-and-install requires confirmed=true",
        ));
    }
    let (native, bytes) = {
        let inner = manager.lock()?;
        UpdateManager::require(&inner, &request.operation_id, UpdateState::Verified)?;
        (
            inner.native.clone().ok_or_else(|| {
                error(
                    "UPDATE_NATIVE_HANDLE_MISSING",
                    "verified native updater handle absent; no exit performed",
                )
            })?,
            inner.bytes.clone().ok_or_else(|| {
                error(
                    "UPDATE_BYTES_MISSING",
                    "verified update bytes absent; no exit performed",
                )
            })?,
        )
    };
    crate::updater::check_native_space(&app, (bytes.len() as u64).saturating_mul(3))?;
    let ticket = prepare_owned_install(&manager, &request, &bridge)?;
    let snapshot = manager.snapshot()?;
    let manager = manager.inner().clone();
    let bridge = bridge.clone();
    // The fixed command returns admission promptly. Cancelling the IPC caller cannot
    // abandon an admitted shutdown or leave an unobserved half-frozen child.
    tauri::async_runtime::spawn(async move {
        let result = coordinate_install(
            &manager,
            ticket,
            || bridge.prepare_owned_exit(crate::runtime::OwnedExitReason::Update),
            || {
                native.install(bytes.as_ref()).map_err(|cause| {
                    error(
                        "UPDATE_NATIVE_INSTALL_FAILED",
                        format!("Tauri platform installation failed: {cause}"),
                    )
                })
            },
        )
        .await;
        match result {
            Ok(_) => app.exit(0),
            Err(cause) => eprintln!("{}: {}", cause.code, cause.message),
        }
    });
    Ok(snapshot)
}
