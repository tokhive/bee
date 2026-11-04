//! Business startup checks are separate from the owned management transport.
use crate::{
    network::NetworkController,
    network_native::BridgeNetworkRuntime,
    preferences::PreferencesStore,
    protocol::BridgeError,
    sidecar::{Bridge, BridgePhase, BridgeStatus},
};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};
#[derive(Clone, Debug, Serialize)]
pub(crate) struct StartupStatus {
    pub state: String,
    pub failure: Option<BridgeError>,
    pub instance: Option<String>,
    pub binding_revision: Option<u64>,
    pub network_revision: Option<u64>,
    pub observed_at: Option<String>,
    pub revision: u64,
}
impl Default for StartupStatus {
    fn default() -> Self {
        Self {
            state: "checking".into(),
            failure: None,
            instance: None,
            binding_revision: None,
            network_revision: None,
            observed_at: None,
            revision: 0,
        }
    }
}
#[derive(Default)]
pub(crate) struct StartupGate {
    ready: AtomicBool,
    status: Mutex<StartupStatus>,
    serial: tokio::sync::Mutex<()>,
}
impl StartupGate {
    #[cfg(test)]
    pub(crate) fn verified() -> Self {
        Self {
            ready: AtomicBool::new(true),
            status: Mutex::new(StartupStatus {
                state: "ready".into(),
                ..Default::default()
            }),
            serial: Default::default(),
        }
    }
    pub fn check(&self) -> Result<(), BridgeError> {
        if self.ready.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(self.snapshot().failure.unwrap_or_else(||BridgeError::new("NETWORK_STARTUP_PENDING","startup prerequisites have not been verified for the current management context".into())))
        }
    }
    // Kept as an identity adapter for existing callers; never rewrites transport.
    pub fn status(&self, status: BridgeStatus) -> BridgeStatus {
        status
    }
    pub(crate) fn snapshot(&self) -> StartupStatus {
        self.status
            .lock()
            .unwrap_or_else(|v| v.into_inner())
            .clone()
    }
    fn checking(&self, instance: Option<String>) {
        self.ready.store(false, Ordering::Release);
        let mut status = self.status.lock().unwrap_or_else(|v| v.into_inner());
        status.state = "checking".into();
        status.failure = None;
        status.instance = instance;
        status.binding_revision = None;
        status.network_revision = None;
        status.observed_at = None;
        status.revision += 1;
    }
    fn finish(&self, result: Result<CheckContext, BridgeError>) {
        let mut status = self.status.lock().unwrap_or_else(|v| v.into_inner());
        status.revision += 1;
        status.observed_at = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .ok();
        match result {
            Ok(context) => {
                status.state = "ready".into();
                status.failure = None;
                status.instance = Some(context.instance);
                status.binding_revision = context.binding;
                status.network_revision = Some(context.network);
                self.ready.store(true, Ordering::Release)
            }
            Err(cause) => {
                status.state = "blocked".into();
                status.failure = Some(cause);
                self.ready.store(false, Ordering::Release)
            }
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
struct CheckContext {
    instance: String,
    binding: Option<u64>,
    network: u64,
    preferences: u64,
}
fn emit<R: tauri::Runtime>(app: &tauri::AppHandle<R>, gate: &StartupGate) {
    if let Err(cause) = app.emit_to("main", "bee://startup-status", gate.snapshot()) {
        eprintln!("deliver native startup check failed: {cause}");
    }
}
async fn wait_bridge(bridge: &Bridge) -> Result<(), BridgeError> {
    let mut statuses = bridge.subscribe();
    loop {
        let status = statuses.borrow_and_update().clone();
        match status.state {
            BridgePhase::Ready => return Ok(()),
            BridgePhase::Starting => statuses.changed().await.map_err(|_| {
                BridgeError::new(
                    "NETWORK_STARTUP_FAILED",
                    "management channel closed before startup verification".into(),
                )
            })?,
            _ => {
                return Err(status.error.unwrap_or_else(|| {
                    BridgeError::new(
                        "NETWORK_STARTUP_FAILED",
                        format!(
                            "startup prerequisites rejected: bridge={:?}; required=ready",
                            status.state
                        ),
                    )
                }))
            }
        }
    }
}
async fn binding(bridge: &Bridge) -> Result<Option<u64>, BridgeError> {
    let reply = bridge.device_context().await?;
    Ok(Some(
        crate::protocol::device_context_state(&reply.result)?.binding_revision,
    ))
}
async fn context(bridge: &Bridge, store: &PreferencesStore) -> Result<CheckContext, BridgeError> {
    let binding = binding(bridge).await?;
    let snapshot = bridge.runtime_snapshot().await?;
    crate::protocol::result_error(&snapshot.result)?;
    let saved = store.read();
    if let Some(cause) = saved.error {
        return Err(cause);
    }
    Ok(CheckContext {
        instance: snapshot.instance,
        binding,
        network: snapshot.result["runtime"]["network_revision"]
            .as_u64()
            .ok_or_else(|| {
                BridgeError::new(
                    "STARTUP_CONTEXT_INVALID",
                    "runtime network revision missing".into(),
                )
            })?,
        preferences: saved.preferences.revision,
    })
}
async fn prerequisites(
    bridge: &Bridge,
    store: &PreferencesStore,
    controller: &NetworkController,
    bootstrap: bool,
) -> Result<CheckContext, BridgeError> {
    wait_bridge(bridge).await?;
    let local = bridge.device_context().await?;
    if let Some(cause) = crate::protocol::device_context_state(&local.result)?.failure {
        if cause.code != "DEVICE_CONTEXT_UNCONFIGURED" {
            return Err(cause);
        }
    }
    let before = context(bridge, store).await?;
    let device = bridge.device_status().await?;
    let scope = controller.bind_verified_device(store, &device.result)?;
    // Device status may not finish into a different saved binding behind our back.
    if binding(bridge).await? != before.binding {
        return Err(BridgeError::new(
            "STARTUP_CONTEXT_CHANGED",
            "saved binding changed during device verification; recheck the current binding".into(),
        ));
    }
    if let Some(scope) = scope {
        let runtime = bridge.runtime_snapshot().await?;
        let fresh = runtime.result["runtime"]["local"] == "stopped"
            && runtime.result["runtime"]["revision"] == 0
            && runtime.result["runtime"]["network_revision"] == 0;
        let network = if fresh && bootstrap {
            controller
                .bootstrap_saved(store, &BridgeNetworkRuntime(bridge), &scope)
                .await
        } else {
            controller
                .snapshot(store, &BridgeNetworkRuntime(bridge), Some(&scope))
                .await
        };
        if let Some(cause) = network.error {
            return Err(cause);
        }
        if network.pending_restart {
            return Err(BridgeError::new("NETWORK_APPLY_REQUIRED",format!("saved network revision={} effective={}; apply the saved network configuration before rechecking",network.saved_revision,network.effective_revision)));
        }
    }
    context(bridge, store).await
}
pub(crate) async fn startup<R: tauri::Runtime>(app: tauri::AppHandle<R>, bridge: Bridge) {
    let gate = app.state::<StartupGate>();
    let _serial = gate.serial.lock().await;
    gate.checking(bridge.status().metadata.map(|v| v.instance));
    emit(&app, &gate);
    let store = app.state::<PreferencesStore>();
    let controller = app.state::<NetworkController>();
    let result = async {
        let checked = prerequisites(&bridge, &store, &controller, true).await?;
        // The only automatic runtime recovery path belongs to initial startup.
        crate::update_install::verify_startup(
            &app.state::<crate::updater::UpdateManager>(),
            &bridge,
            store.read(),
            option_env!("BEE_RELEASE_CHANNEL").unwrap_or(""),
        )
        .await?;
        let current = context(&bridge, &store).await?;
        if current.instance != checked.instance
            || current.binding != checked.binding
            || current.network != checked.network
            || current.preferences != checked.preferences
        {
            return Err(BridgeError::new(
                "STARTUP_CONTEXT_CHANGED",
                "startup context changed before verification completed".into(),
            ));
        }
        enable_presence(&bridge, &current).await?;
        Ok(current)
    }
    .await;
    // Even blocked startup reports the local context that was actually observed.
    if result.is_err() {
        if let Ok(current) = context(&bridge, &store).await {
            let mut status = gate.status.lock().unwrap_or_else(|v| v.into_inner());
            status.instance = Some(current.instance);
            status.binding_revision = current.binding;
            status.network_revision = Some(current.network);
        }
    }
    gate.finish(result);
    emit(&app, &gate);
}
pub(crate) async fn recheck<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    bridge: &Bridge,
) -> StartupStatus {
    recheck_binding(app, bridge, false).await
}

async fn enable_presence(bridge: &Bridge, checked: &CheckContext) -> Result<(), BridgeError> {
    let local = bridge.device_context().await?;
    let state = crate::protocol::device_context_state(&local.result)?;
    if let Some(cause) = state.failure {
        if cause.code == "DEVICE_CONTEXT_UNCONFIGURED" { return Ok(()); }
        return Err(cause);
    }
    if local.result["context"]["device_id"].is_null() { return Ok(()); }
    if checked.binding != Some(state.binding_revision) || local.instance != checked.instance {
        return Err(BridgeError::new("STARTUP_CONTEXT_CHANGED", "presence binding or management instance changed after verification".into()));
    }
    bridge.runtime_enable_presence(state.binding_revision, checked.network).await
}

// Serialize preparation/dispatch with recovery and network apply. Retain the
// verified context rather than authorizing whatever binding happens to be latest.
pub(crate) async fn start_with_presence(bridge: &Bridge, store: &PreferencesStore, controller: &NetworkController, gate: &StartupGate, mut request: crate::runtime_protocol::RuntimeStartRequest) -> Result<crate::sidecar::BridgeReply, BridgeError> {
    let _serial = gate.serial.lock().await;
    gate.check()?;
    request.validate()?;
    let before = context(bridge, store).await?;
    let device = bridge.device_status().await?;
    let scope = controller.bind_verified_device(store, &device.result)?.ok_or_else(||BridgeError::new("NETWORK_SCOPE_REQUIRED", "runtime start requires a freshly verified bound device; actual=no trusted device scope".into()))?;
    if binding(bridge).await? != before.binding { return Err(BridgeError::new("STARTUP_CONTEXT_CHANGED", "start binding changed during device verification".into())); }
    request.expected_revision = controller.prepare_start(store, &BridgeNetworkRuntime(bridge), &scope, request.expected_revision).await?;
    let checked = context(bridge, store).await?;
    if checked.instance != before.instance || checked.binding != before.binding { return Err(BridgeError::new("STARTUP_CONTEXT_CHANGED", "start binding or instance changed during network preparation".into())); }
    let result = bridge.runtime_start(request).await;
    // Dispatch first: enabling idle presence can advance runtime revision. This
    // never retries Start, including when its delivery/outcome is uncertain.
    enable_presence(bridge, &checked).await?;
    result
}

// Pairing changes the saved binding revision. A new binding gets its own scoped
// network preparation; an ordinary status read must never apply a saved draft.
pub(crate) async fn observe_device<R: tauri::Runtime>(app: &tauri::AppHandle<R>, bridge: &Bridge, result: &serde_json::Value) {
    if result["device"]["state"] != "bound" { return; }
    let gate = app.state::<StartupGate>();
    let before = gate.snapshot();
    if let Ok(current) = binding(bridge).await {
        if current != before.binding_revision {
            recheck_binding(app, bridge, true).await;
        }
    }
}

async fn recheck_binding<R: tauri::Runtime>(app: &tauri::AppHandle<R>, bridge: &Bridge, new_binding: bool) -> StartupStatus {
    let gate = app.state::<StartupGate>();
    let Ok(_serial) = gate.serial.try_lock() else {
        return gate.snapshot();
    };
    gate.checking(bridge.status().metadata.map(|v| v.instance));
    emit(app, &gate);
    let store = app.state::<PreferencesStore>();
    let controller = app.state::<NetworkController>();
    let result = async {
        if new_binding {
            crate::update_install::verify_recheck(&app.state::<crate::updater::UpdateManager>(), bridge, store.read()).await?;
            let before = binding(bridge).await?;
            let device = bridge.device_status().await?;
            let scope = controller.bind_verified_device(&store, &device.result)?.ok_or_else(||BridgeError::new("NETWORK_DEVICE_REQUIRED", "new binding requires verified bound device".into()))?;
            if binding(bridge).await? != before { return Err(BridgeError::new("STARTUP_CONTEXT_CHANGED", "binding changed during new-device network preparation".into())); }
            let runtime = bridge.runtime_snapshot().await?;
            crate::protocol::result_error(&runtime.result)?;
            let revision = runtime.result["runtime"]["revision"].as_u64().ok_or_else(||BridgeError::new("STARTUP_CONTEXT_INVALID", "new-device runtime revision missing".into()))?;
            controller.prepare_start(&store, &BridgeNetworkRuntime(bridge), &scope, revision).await?;
        }
        let checked = prerequisites(bridge, &store, &controller, false).await?;
        crate::update_install::verify_recheck(
            &app.state::<crate::updater::UpdateManager>(),
            bridge,
            store.read(),
        )
        .await?;
        let current = context(bridge, &store).await?;
        if checked != current {
            return Err(BridgeError::new(
                "STARTUP_CONTEXT_CHANGED",
                "instance, binding, network or preferences changed during recheck; old result discarded".into(),
            ));
        }
        // Release only the startup data hold after the final context comparison.
        // The independent owned-exit freeze and real bridge state still apply.
        bridge.0.startup_verified.store(true, Ordering::SeqCst);
        enable_presence(bridge, &current).await?;
        Ok(current)
    }
    .await;
    if result.is_err() {
        if let Ok(current) = context(bridge, &store).await {
            let mut status = gate.status.lock().unwrap_or_else(|v| v.into_inner());
            status.instance = Some(current.instance);
            status.binding_revision = current.binding;
            status.network_revision = Some(current.network);
        }
    }
    gate.finish(result);
    emit(app, &gate);
    gate.snapshot()
}
/// An explicit apply can resolve this one startup blocker without releasing the gate.
pub(crate) async fn apply_saved_network(
    bridge: &Bridge,
    store: &PreferencesStore,
    controller: &NetworkController,
    gate: &StartupGate,
    manager: &crate::updater::UpdateManager,
    confirmed: bool,
) -> Result<crate::network::NetworkSnapshot, BridgeError> {
    let _serial = gate.serial.lock().await;
    let recovering = match gate.check() {
        Ok(()) => false,
        Err(cause)
            if gate.snapshot().state == "blocked" && cause.code == "NETWORK_APPLY_REQUIRED" =>
        {
            true
        }
        Err(cause) => return Err(cause),
    };
    if !recovering && !bridge.0.startup_verified.load(Ordering::SeqCst) {
        return Err(BridgeError::new("STARTUP_VERIFICATION_PENDING", "network apply rejected: current management instance is held for startup package/data/runtime verification; required=verified startup or explicit network recovery blocker".into()));
    }
    let before = if recovering {
        wait_bridge(bridge).await?;
        let before = context(bridge, store).await?;
        crate::update_install::verify_recheck(manager, bridge, store.read()).await?;
        Some(before)
    } else {
        None
    };
    let device = bridge.device_status().await?;
    let scope = controller.bind_verified_device(store, &device.result)?.ok_or_else(|| BridgeError::new("NETWORK_DEVICE_REQUIRED", "applying a contribution proxy requires a verified paired device; unpaired drafts can be tested read-only".into()))?;
    if let Some(before) = before {
        let local = bridge.device_context().await?;
        crate::protocol::device_context(&local.result)?;
        if context(bridge, store).await? != before {
            return Err(BridgeError::new("STARTUP_CONTEXT_CHANGED", "network apply context changed during identity verification; required=same instance, binding, network and preferences".into()));
        }
    }
    let restore_intent = !recovering || bridge.0.startup_verified.load(Ordering::SeqCst);
    let applied = controller
        .apply_saved_with_restore(
            store,
            &BridgeNetworkRuntime(bridge),
            &scope,
            confirmed,
            restore_intent,
        )
        .await;
    if applied.error.is_none() && !applied.pending_restart && !recovering {
        let current = context(bridge, store).await?;
        enable_presence(bridge, &current).await?;
        gate.finish(Ok(current));
    }
    Ok(applied)
}
#[cfg(test)]
#[path = "experience_tests.rs"]
mod tests;

// Recovery is available during an identity block. It retains package/update
// checks and serializes against startup results; completion never restores intent.
pub(crate) async fn recover_device<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    bridge: &Bridge,
    decision: Option<crate::protocol::DeviceRecoveryConfirm>,
    prepare: bool,
) -> Result<crate::sidecar::BridgeReply, BridgeError> {
    let gate = app.state::<StartupGate>();
    let _serial = gate.serial.lock().await;
    let store = app.state::<PreferencesStore>();
    crate::update_install::verify_recheck(
        &app.state::<crate::updater::UpdateManager>(),
        bridge,
        store.read(),
    )
    .await?;
    let before = gate.snapshot();
    let status_only = !prepare && decision.is_none();
    if !status_only {
        gate.checking(bridge.status().metadata.map(|v| v.instance));
        emit(app, &gate);
    }
    let result = if prepare {
        bridge.device_recovery_prepare().await
    } else if let Some(decision) = decision {
        bridge.device_recovery_confirm(decision).await
    } else {
        bridge.device_recovery_status().await
    };
    // A successful status read with no transaction observes no recovery change.
    // It neither revokes established readiness nor unlocks a blocked/checking gate.
    if status_only
        && result
            .as_ref()
            .is_err_and(|cause| cause.code == "DEVICE_RECOVERY_NONE")
    {
        return result;
    }
    // A completed transaction can be observed after an explicit recheck. Keep
    // readiness only when this same instance/binding/network was verified.
    if status_only
        && before.state == "ready"
        && result
            .as_ref()
            .is_ok_and(|reply| reply.result["recovery"]["phase"] == "completed")
    {
        if let Ok(current) = context(bridge, &store).await {
            if before.instance.as_ref() == Some(&current.instance)
                && before.binding_revision == current.binding
                && before.network_revision == Some(current.network)
            {
                return result;
            }
        }
    }
    gate.checking(bridge.status().metadata.map(|v| v.instance));
    app.state::<NetworkController>()
        .invalidate_device_scope()
        .await;
    let cause = match &result {
        Ok(reply) => BridgeError::new("DEVICE_RECOVERY_RECHECK_REQUIRED", format!(
            "device recovery phase={}; contribution remains stopped; recheck startup prerequisites after recovery completes",
            reply.result["recovery"]["phase"].as_str().unwrap_or("unknown"),
        )),
        Err(cause) => cause.clone(),
    };
    gate.finish(Err(cause));
    emit(app, &gate);
    if result.as_ref().is_ok_and(|reply| reply.result["recovery"]["phase"] == "completed") {
        drop(_serial);
        recheck_binding(app, bridge, true).await;
    }
    result
}
