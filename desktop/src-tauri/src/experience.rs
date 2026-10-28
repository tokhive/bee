//! Native startup ordering only; S1 owns runtime recovery and shutdown.
use crate::{
    network::NetworkController,
    network_native::BridgeNetworkRuntime,
    preferences::PreferencesStore,
    protocol::BridgeError,
    sidecar::{Bridge, BridgePhase, BridgeStatus},
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub(crate) struct StartupGate {
    ready: AtomicBool,
    error: Mutex<Option<BridgeError>>,
}
impl StartupGate {
    #[cfg(test)]
    pub(crate) fn verified() -> Self {
        Self {
            ready: AtomicBool::new(true),
            error: Mutex::new(None),
        }
    }
    pub fn check(&self) -> Result<(), BridgeError> {
        if self.ready.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(self.error.lock().ok().and_then(|v|v.clone()).unwrap_or(BridgeError{code:"NETWORK_STARTUP_PENDING".into(),message:"saved network configuration has not been verified for this management instance; retry after startup completes".into()}))
        }
    }
    pub fn status(&self, mut status: BridgeStatus) -> BridgeStatus {
        if status.state == BridgePhase::Ready && !self.ready.load(Ordering::Acquire) {
            let error = self.error.lock().ok().and_then(|v| v.clone());
            status.state = if error.is_some() {
                BridgePhase::Failed
            } else {
                BridgePhase::Starting
            };
            status.error = error;
        }
        status
    }
}
pub(crate) async fn startup(app: tauri::AppHandle, bridge: Bridge) {
    let result = initialize(&app, &bridge).await;
    let gate = app.state::<StartupGate>();
    match result {
        Ok(()) => gate.ready.store(true, Ordering::Release),
        Err(error) => {
            if let Ok(mut value) = gate.error.lock() {
                *value = Some(error);
            }
        }
    }
    if let Err(error) = app.emit_to("main", "bee://bridge-status", gate.status(bridge.status())) {
        eprintln!("deliver native startup result failed: {error}");
    }
}
async fn initialize(app: &tauri::AppHandle, bridge: &Bridge) -> Result<(), BridgeError> {
    let mut statuses = bridge.subscribe();
    loop {
        let phase = statuses.borrow_and_update().state.clone();
        match phase {
            BridgePhase::Ready => break,
            BridgePhase::Starting => statuses.changed().await.map_err(|_| BridgeError {
                code: "NETWORK_STARTUP_FAILED".into(),
                message: "management status channel closed before network bootstrap".into(),
            })?,
            _ => {
                return Err(BridgeError {
                    code: "NETWORK_STARTUP_FAILED".into(),
                    message: format!("saved network bootstrap rejected: bridge={phase:?}"),
                })
            }
        }
    }
    let store = app.state::<PreferencesStore>();
    let saved = store.read();
    if let Some(error) = saved.error {
        return Err(error);
    }
    let controller = app.state::<NetworkController>();
    let device = bridge.device_status().await?;
    let scope = controller.bind_verified_device(&store, &device.result)?;
    if let Some(scope) = scope {
        let applied = controller
            .bootstrap_saved(&store, &BridgeNetworkRuntime(bridge), &scope)
            .await;
        if let Some(error) = applied.error {
            return Err(error);
        }
    }
    // S2 verifies the saved network before S3 admits S1 recovery. This is the
    // only startup restore path; a pending update must pass identity checks first.
    crate::update_install::verify_startup(
        &app.state::<crate::updater::UpdateManager>(),
        bridge,
        store.read(),
        option_env!("BEE_RELEASE_CHANNEL").unwrap_or(""),
    ).await
}
