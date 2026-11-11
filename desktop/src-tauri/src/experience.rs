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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<crate::startup_recovery::RecoveryProgress>,
    pub can_retry: bool,
    pub recovering: bool,
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
            progress: None,
            can_retry: false,
            recovering: false,
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
        status.progress = None;
        status.can_retry = false;
        status.failure = None;
        status.instance = instance;
        status.binding_revision = None;
        status.network_revision = None;
        status.observed_at = None;
        status.revision += 1;
    }
    fn progress(&self, progress: crate::startup_recovery::RecoveryProgress) {
        let mut status=self.status.lock().unwrap_or_else(|v|v.into_inner());
        if status.state=="checking" && status.progress.as_ref()!=Some(&progress) {status.progress=Some(progress);status.revision+=1;status.observed_at=time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).ok();}
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
    startup_mode(app,bridge,false).await;
}
pub(crate) async fn retry<R:tauri::Runtime>(app:tauri::AppHandle<R>,bridge:Bridge)->StartupStatus {
    startup_mode(app.clone(),bridge,true).await;
    app.state::<StartupGate>().snapshot()
}
async fn startup_mode<R:tauri::Runtime>(app:tauri::AppHandle<R>,bridge:Bridge,manual_retry:bool) {
    let gate = app.state::<StartupGate>();
    let Ok(_serial) = gate.serial.try_lock() else { return; };
    let current = bridge.status();
    let verified = gate.snapshot();
    if verified.state == "ready"
        && current.state == BridgePhase::Ready
        && current.metadata.as_ref().is_some_and(|metadata| verified.instance.as_ref() == Some(&metadata.instance))
    {
        return;
    }
    gate.checking(bridge.status().metadata.map(|v| v.instance));
    gate.status.lock().unwrap_or_else(|v|v.into_inner()).recovering=manual_retry;
    emit(&app, &gate);
    let store = app.state::<PreferencesStore>();
    let controller = app.state::<NetworkController>();
    gate.progress(crate::startup_recovery::RecoveryProgress::stage("connecting"));emit(&app,&gate);
    let observer=|progress|{gate.progress(progress);emit(&app,&gate);};
    let result = async {
        if manual_retry && matches!(bridge.status().state,BridgePhase::Failed|BridgePhase::Stopped) {bridge.reconnect().await?;}
        wait_bridge(&bridge).await?;
        observer(crate::startup_recovery::RecoveryProgress::stage("checking_previous"));
        let journal=crate::startup_recovery::RecoveryJournal::beside(app.state::<crate::updater::UpdateManager>().store.path());
        if let Some(old) = journal.load()? {
            // A different manager cannot observe the original in-memory operation.
            // Keep that journal unresolved until verify_startup_progress binds it
            // to durable retirement proof; same-instance operations remain read-only.
            let current_instance = bridge.status().metadata.map(|value| value.instance);
            if current_instance.as_deref() == Some(old.instance.as_str()) {
                journal.observe(&bridge).await?;
            }
            if old.phase == "failed" && !manual_retry {
                return Err(old.failure.expect("validated terminal failure"));
            }
        }
        // Inspect before network bootstrap, runtime reservation or account workers.
        let inspected=bridge.inspect_recovery().await?;
        {
            let mut status=gate.status.lock().unwrap_or_else(|v|v.into_inner());
            status.recovering=manual_retry || inspected.state=="eligible" || inspected.previous_run_id.is_some();
            status.revision+=1;
        }
        if !inspected.requires_retirement() {
            if let Some(cause) = inspected.failure { return Err(cause); }
        }
        observer(crate::startup_recovery::RecoveryProgress::stage("checking_device"));
        let checked = prerequisites(&bridge, &store, &controller, true).await?;
        // The only automatic runtime recovery path belongs to initial startup.
        crate::update_install::verify_startup_progress(
            &app.state::<crate::updater::UpdateManager>(),
            &bridge,
            store.read(),
            option_env!("BEE_RELEASE_CHANNEL").unwrap_or(""),
            &observer,
            manual_retry,
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
    refresh_retry(&gate,&bridge,&app.state::<crate::updater::UpdateManager>()).await;
    emit(&app, &gate);
}
async fn refresh_retry(gate:&StartupGate,bridge:&Bridge,manager:&crate::updater::UpdateManager) {
    if gate.snapshot().state!="blocked" || bridge.status().state!=BridgePhase::Ready{return;}
    if gate.snapshot().failure.as_ref().is_some_and(|v|["RECOVERY_REMOTE_DRAINING","RECOVERY_RETIREMENT_UNCONFIRMED"].contains(&v.code.as_str())) {
        let mut status=gate.status.lock().unwrap_or_else(|v|v.into_inner());status.can_retry=true;status.revision+=1;return;
    }
    let journal=crate::startup_recovery::RecoveryJournal::beside(manager.store.path());
    if let Ok(Some(record))=journal.load() {
        if record.phase=="failed" && bridge.inspect_recovery().await.is_ok_and(|v|v.failure.is_none()) {
            let mut status=gate.status.lock().unwrap_or_else(|v|v.into_inner());status.can_retry=true;status.revision+=1;
        }
    }
}
pub(crate) async fn query<R:tauri::Runtime>(app:&tauri::AppHandle<R>,bridge:&Bridge)->Result<StartupStatus,BridgeError> {
    let gate=app.state::<StartupGate>();
    let Ok(_serial)=gate.serial.try_lock() else {return Ok(gate.snapshot());};
    if bridge.status().state!=BridgePhase::Ready || gate.snapshot().state=="ready" {return Ok(gate.snapshot());}
    let journal=crate::startup_recovery::RecoveryJournal::beside(app.state::<crate::updater::UpdateManager>().store.path());
    let result=async {
        journal.observe(bridge).await?;
        let inspection=bridge.inspect_recovery().await?;
        if let Some(cause)=inspection.failure{return Err(cause);}
        Ok(())
    }.await;
    if gate.snapshot().state=="blocked" {let mut status=gate.status.lock().unwrap_or_else(|v|v.into_inner());status.can_retry=result.is_ok();status.revision+=1;}
    refresh_retry(&gate,bridge,&app.state::<crate::updater::UpdateManager>()).await;
    // A failed read has its own receipt; retain the original startup failure.
    emit(app,&gate);result.map(|_|gate.snapshot())
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
pub(crate) async fn start_with_presence<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    bridge: &Bridge,
    store: &PreferencesStore,
    controller: &NetworkController,
    gate: &StartupGate,
    mut request: crate::runtime_protocol::RuntimeStartRequest,
) -> Result<crate::sidecar::BridgeReply, BridgeError> {
    let _serial = gate.serial.lock().await;
    gate.check()?;
    request.validate()?;
    let before = context(bridge, store).await?;
    let device = bridge.device_status().await?;
    let scope = controller.bind_verified_device(store, &device.result)?.ok_or_else(||BridgeError::new("NETWORK_SCOPE_REQUIRED", "runtime start requires a freshly verified bound device; actual=no trusted device scope".into()))?;
    if binding(bridge).await? != before.binding {
        return Err(BridgeError::new(
            "STARTUP_CONTEXT_CHANGED",
            "start binding changed during device verification".into(),
        ));
    }
    request.expected_revision = controller
        .prepare_start(
            store,
            &BridgeNetworkRuntime(bridge),
            &scope,
            request.expected_revision,
        )
        .await?;
    let checked = context(bridge, store).await?;
    if checked.instance != before.instance || checked.binding != before.binding {
        return Err(BridgeError::new(
            "STARTUP_CONTEXT_CHANGED",
            "start binding or instance changed during network preparation".into(),
        ));
    }
    let result = bridge.runtime_start(request).await;
    // A sent timeout still owns the barrier. Return its evidence immediately;
    // presence maintenance may only follow settlement of that exact request.
    if let Err(cause) = &result {
        if cause.code == "RESPONSE_TIMEOUT" {
            if let Some(id) = cause
                .details
                .as_ref()
                .filter(|details| details.check == "bridge_request_deadline"
                    && details.evidence.get("method").is_some_and(|method| method == "runtime_start")
                    && details.evidence.get("in_flight").is_some_and(|sent| sent == "true"))
                .and_then(|details| details.evidence.get("request_id"))
            {
                tauri::async_runtime::spawn(resume_start_presence(
                    app.clone(),
                    bridge.clone(),
                    checked,
                    id.clone(),
                    gate.snapshot().revision,
                ));
                return result;
            }
        }
    }
    // Dispatch first: presence can advance runtime revision. A maintenance
    // failure has its own startup status and must never replace the Start result.
    maintain_start_presence(app, bridge, store, gate, &checked).await;
    result
}

async fn maintain_start_presence<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    bridge: &Bridge,
    store: &PreferencesStore,
    gate: &StartupGate,
    checked: &CheckContext,
) {
    if bridge.0.frozen.load(Ordering::SeqCst) || bridge.status().state != BridgePhase::Ready {
        return;
    }
    let result = async {
        let current = context(bridge, store).await?;
        if current != *checked {
            return Err(BridgeError::new("STARTUP_CONTEXT_CHANGED", format!("presence recovery context changed after Start; instance_match={} binding_before={:?} binding_now={:?} network_before={} network_now={} preferences_before={} preferences_now={}; required=original verified context", current.instance == checked.instance, checked.binding, current.binding, checked.network, current.network, checked.preferences, current.preferences)));
        }
        enable_presence(bridge, checked).await
    }.await;
    if let Err(cause) = result {
        gate.finish(Err(cause));
        emit(app, gate);
    }
}

async fn resume_start_presence<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    bridge: Bridge,
    checked: CheckContext,
    id: String,
    gate_revision: u64,
) {
    // Subscribe before observing pending state so settlement cannot be lost.
    let mut settled = bridge.subscribe_settled();
    let mut statuses = bridge.subscribe();
    loop {
        let status = statuses.borrow_and_update().clone();
        if status.state != BridgePhase::Ready
            || status
                .metadata
                .as_ref()
                .is_none_or(|metadata| metadata.instance != checked.instance)
            || bridge.0.frozen.load(Ordering::SeqCst)
        {
            return;
        }
        if !bridge
            .pending_requests()
            .requests
            .iter()
            .any(|request| request.id == id && request.method == "runtime_start")
        {
            break;
        }
        tokio::select! {
            event = settled.recv() => match event {
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {},
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            },
            event = statuses.changed() => if event.is_err() { return; },
        }
    }
    let gate = app.state::<StartupGate>();
    let _serial = gate.serial.lock().await;
    // A later recheck/recovery owns its own decision; discard this old work.
    if gate.snapshot().revision != gate_revision || gate.check().is_err() {
        return;
    }
    maintain_start_presence(
        &app,
        &bridge,
        &app.state::<PreferencesStore>(),
        &gate,
        &checked,
    )
    .await;
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
    let previous=gate.snapshot();
    gate.checking(bridge.status().metadata.map(|v| v.instance));
    emit(app, &gate);
    let store = app.state::<PreferencesStore>();
    let controller = app.state::<NetworkController>();
    let result = async {
        if !new_binding {
            if previous.state=="blocked" && previous.failure.as_ref().is_some_and(|v|v.code.starts_with("RECOVERY_")) {
                let inspected=bridge.inspect_recovery().await?;
                if let Some(cause)=inspected.failure{return Err(cause);}
            }
            let journal=crate::startup_recovery::RecoveryJournal::beside(app.state::<crate::updater::UpdateManager>().store.path());
            if let Some(record)=journal.observe(bridge).await? {
                if let Some(cause)=record.failure{return Err(cause);}
            }
        }
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
    refresh_retry(&gate,bridge,&app.state::<crate::updater::UpdateManager>()).await;
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
