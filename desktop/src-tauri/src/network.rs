use crate::{
    preferences::{self, DesktopPreferences, PreferencesStore},
    protocol::BridgeError,
    runtime_protocol::{RuntimeNetworkConfig, StopReceipt},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::future::Future;
use tokio::sync::Mutex;

const SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn failure(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError {
        details: None,
        code: code.into(),
        message: message.into(),
    }
}

/// Preserve a producer's concrete check; only otherwise identify this apply stage.
fn at_apply_stage(mut error: BridgeError, check: &str) -> BridgeError {
    if error.details.is_none() {
        if let Ok(observed_at) = time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339) {
            let details = crate::protocol::FailureDetails { check: check.into(), observed_at, evidence: std::collections::BTreeMap::new() };
            if let Ok(enriched) = BridgeError::with_details(&error.code, error.message.clone(), details) { error = enriched; }
        }
    }
    error
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct NetworkPaths {
    pub relay: String,
    pub official: String,
    pub hive: String,
    pub official_login: String,
}
impl Default for NetworkPaths {
    fn default() -> Self {
        Self {
            relay: "unknown".into(),
            official: "unknown".into(),
            hive: "process_environment".into(),
            official_login: "official_client".into(),
        }
    }
}
impl NetworkPaths {
    fn validate(&self) -> Result<(), BridgeError> {
        let official = ["direct", "local_proxy", "environment_proxy"]
            .iter()
            .any(|openai| {
                ["direct", "local_proxy", "environment_proxy"]
                    .iter()
                    .any(|claude| self.official == format!("openai={openai};claude={claude}"))
            });
        if !["direct", "local_proxy"].contains(&self.relay.as_str())
            || !official
            || self.hive != "process_environment"
            || self.official_login != "official_client"
        {
            return Err(failure(
                "NETWORK_REPLY_INVALID",
                "network path summary has an unknown enum; required=fixed safe traffic summaries",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NetworkStatus {
    pub effective_revision: u64,
    pub effective_proxy: String,
    pub paths: NetworkPaths,
}
impl NetworkStatus {
    fn validate(&self) -> Result<(), BridgeError> {
        if self.effective_revision > SAFE_INTEGER {
            return Err(failure(
                "NETWORK_REPLY_INVALID",
                format!(
                    "effective network revision={} exceeds safe integer limit={SAFE_INTEGER}",
                    self.effective_revision
                ),
            ));
        }
        preferences::validate_proxy(&self.effective_proxy)?;
        self.paths.validate()
    }
}

pub(crate) fn decode_network_status(result: &Value) -> Result<NetworkStatus, BridgeError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Envelope {
        network: NetworkStatus,
    }
    let envelope:Envelope=serde_json::from_value(result.clone()).map_err(|error|failure("NETWORK_REPLY_INVALID",format!("network status JSON schema rejected: line={} column={} category={:?}; required=fixed status fields",error.line(),error.column(),error.classify())))?;
    envelope.network.validate()?;
    Ok(envelope.network)
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct NetworkSnapshot {
    pub saved_revision: u64,
    pub effective_revision: u64,
    pub saved_proxy: String,
    pub effective_proxy: String,
    pub paths: NetworkPaths,
    pub pending_restart: bool,
    pub error: Option<BridgeError>,
}

// Only a trusted device_status result constructs this scope; there is no
// Deserialize implementation and no scope input in the webpage command.
#[derive(Clone, Debug)]
pub(crate) struct TrustedNetworkScope {
    origin: String,
    device_scope: String,
}
impl TrustedNetworkScope {
    pub(crate) fn origin(&self) -> &str {
        &self.origin
    }
    pub(crate) fn device_scope(&self) -> &str {
        &self.device_scope
    }
}
pub(crate) fn trusted_scope(result: &Value) -> Result<Option<TrustedNetworkScope>, BridgeError> {
    if let Some(error) = result.get("error") {
        if result.as_object().is_none_or(|v| v.len() != 1) {
            return Err(failure(
                "DEVICE_REPLY_INVALID",
                "device failure result requires exactly one error",
            ));
        }
        let error: BridgeError = serde_json::from_value(error.clone())
            .map_err(|e| crate::protocol::invalid_json("device status error", e))?;
        return Err(error);
    }
    let rejected = || {
        failure("NETWORK_DEVICE_SCOPE","trusted device status did not provide bound Hive, owner and device identity; no scoped proxy may be applied")
    };
    let device = result.get("device").ok_or_else(rejected)?;
    match device.get("state").and_then(Value::as_str) {
        Some("unbound" | "pending" | "draining" | "expired") => return Ok(None),
        Some("bound") => {}
        _ => return Err(rejected()),
    }
    let origin = device
        .get("hive")
        .and_then(Value::as_str)
        .ok_or_else(rejected)?;
    preferences::validate_origin(origin)?;
    let identity = device.get("identity").ok_or_else(rejected)?;
    let id = identity
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(rejected)?;
    let owner = identity
        .get("owner_id")
        .and_then(Value::as_str)
        .ok_or_else(rejected)?;
    if [id, owner].iter().any(|value| {
        value.is_empty()
            || value.len() > 128
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    }) {
        return Err(rejected());
    }
    let bytes = serde_json::to_vec(&[origin, owner, id]).map_err(|_| rejected())?;
    let device_scope = format!("{:x}", Sha256::digest(bytes));
    Ok(Some(TrustedNetworkScope {
        origin: origin.into(),
        device_scope,
    }))
}

// The adapter must combine fresh runtime_snapshot and network_status replies,
// requiring the same owned management instance and network revision. Stop and
// Restore await S1's own operations; this module never implements their state
// machines, starts all platforms, or invents resume authorization.
#[derive(Clone, Debug)]
pub(crate) struct RuntimeObservation {
    pub instance: String,
    pub revision: u64,
    pub network_revision: u64,
    pub local: String,
    pub stop_receipt: Option<StopReceipt>,
    pub network: NetworkStatus,
}
impl RuntimeObservation {
    pub(crate) fn validate(&self) -> Result<(), BridgeError> {
        self.network.validate()?;
        if self.instance.len() != 32
            || !self
                .instance
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || self.revision > SAFE_INTEGER
            || self.network_revision > SAFE_INTEGER
            || self.network_revision != self.network.effective_revision
            || !["stopped", "starting", "running", "stopping", "failed"]
                .contains(&self.local.as_str())
        {
            return Err(failure("NETWORK_RUNTIME_UNCONFIRMED",format!("runtime observation failed instance/revision/local checks: instance_chars={} revision={} runtime_network_revision={} effective_revision={} local_known={}",self.instance.len(),self.revision,self.network_revision,self.network.effective_revision,["stopped","starting","running","stopping","failed"].contains(&self.local.as_str()))));
        }
        Ok(())
    }
}
pub(crate) trait NetworkRuntime: Send + Sync {
    fn observe(&self) -> impl Future<Output = Result<RuntimeObservation, BridgeError>> + Send;
    fn stop_for_network(
        &self,
        expected_revision: u64,
    ) -> impl Future<Output = Result<RuntimeObservation, BridgeError>> + Send;
    fn configure_network(
        &self,
        config: RuntimeNetworkConfig,
    ) -> impl Future<Output = Result<(), BridgeError>> + Send;
    fn restore(&self) -> impl Future<Output = Result<RuntimeObservation, BridgeError>> + Send;
}

#[derive(Default)]
struct NetworkState {
    last: Option<RuntimeObservation>,
    applied_scope: Option<String>,
}
#[derive(Default)]
pub(crate) struct NetworkController {
    state: Mutex<NetworkState>,
}

impl NetworkController {
    pub(crate) async fn invalidate_device_scope(&self) {
        let mut state = self.state.lock().await;
        state.applied_scope = None;
        state.last = None;
    }

    pub fn bind_verified_device(
        &self,
        store: &PreferencesStore,
        result: &Value,
    ) -> Result<Option<TrustedNetworkScope>, BridgeError> {
        let scope = trusted_scope(result)?;
        if let Some(scope) = scope.as_ref() {
            let current = store.read();
            if let Some(error) = current.error {
                return Err(error);
            }
            let bound = store.bind_draft(
                current.preferences.revision,
                &scope.origin,
                &scope.device_scope,
            );
            if let Some(error) = bound.error {
                return Err(error);
            }
        }
        Ok(scope)
    }

    pub async fn snapshot(
        &self,
        store: &PreferencesStore,
        runtime: &impl NetworkRuntime,
        scope: Option<&TrustedNetworkScope>,
    ) -> NetworkSnapshot {
        let mut state = self.state.lock().await;
        let saved = store.read();
        if let Some(error) = saved.error {
            return render(&state, &saved.preferences, scope, Some(error));
        }
        match runtime.observe().await.and_then(|view| {
            view.validate()?;
            Ok(view)
        }) {
            Ok(view) => capture(&mut state, view, scope),
            Err(error) => return render(&state, &saved.preferences, scope, Some(error)),
        }
        render(&state, &saved.preferences, scope, None)
    }

    // Startup invokes this before S1 Restore. It can configure only the fresh,
    // stopped management instance; later changes require apply_saved's stop proof.
    pub async fn bootstrap_saved(
        &self,
        store: &PreferencesStore,
        runtime: &impl NetworkRuntime,
        scope: &TrustedNetworkScope,
    ) -> NetworkSnapshot {
        let mut state = self.state.lock().await;
        let saved = store.read();
        if let Some(error) = saved.error {
            return render(&state, &saved.preferences, Some(scope), Some(error));
        }
        let current = match runtime.observe().await.and_then(|view| {
            view.validate()?;
            Ok(view)
        }) {
            Ok(view) => view,
            Err(error) => return render(&state, &saved.preferences, Some(scope), Some(error)),
        };
        capture(&mut state, current.clone(), Some(scope));
        if current.local != "stopped" || current.revision != 0 || current.network_revision != 0 {
            return render(&state, &saved.preferences, Some(scope), Some(failure(
                "NETWORK_BOOTSTRAP_UNCONFIRMED",
                format!("startup network configuration requires a fresh stopped runtime: local_stopped={} runtime_revision={} network_revision={}; required=stopped with both revisions zero", current.local == "stopped", current.revision, current.network_revision),
            )));
        }
        let proxy = saved
            .preferences
            .proxy_for(&scope.origin, Some(&scope.device_scope))
            .to_owned();
        let revision = saved.preferences.revision.max(1);
        if let Err(error) = runtime
            .configure_network(RuntimeNetworkConfig {
                revision,
                connect_proxy: proxy.clone(),
            })
            .await
        {
            return render(&state, &saved.preferences, Some(scope), Some(error));
        }
        let configured = match runtime.observe().await.and_then(|view| {
            view.validate()?;
            Ok(view)
        }) {
            Ok(view) => view,
            Err(error) => return render(&state, &saved.preferences, Some(scope), Some(error)),
        };
        if configured.instance != current.instance
            || configured.local != "stopped"
            || configured.revision < current.revision
            || configured.network_revision != revision
            || configured.network.effective_proxy != proxy
        {
            return render(&state, &saved.preferences, Some(scope), Some(failure(
                "NETWORK_BOOTSTRAP_UNCONFIRMED",
                format!("startup network readback failed: instance_match={} local_stopped={} actual_runtime_revision={} minimum_runtime_revision={} actual_network_revision={} required_network_revision={revision} proxy_match={}; S1 restore must remain blocked", configured.instance == current.instance, configured.local == "stopped", configured.revision, current.revision, configured.network_revision, configured.network.effective_proxy == proxy),
            )));
        }
        capture(&mut state, configured, Some(scope));
        state.applied_scope = Some(scope.device_scope.clone());
        render(&state, &saved.preferences, Some(scope), None)
    }

    // A user Start keeps its own resume list. Prepare only the selected scope's
    // network while no worker can run, then return S1's fresh expected revision.
    pub async fn prepare_start(
        &self,
        store: &PreferencesStore,
        runtime: &impl NetworkRuntime,
        scope: &TrustedNetworkScope,
        expected_runtime_revision: u64,
    ) -> Result<u64, BridgeError> {
        let mut state = self.state.lock().await;
        let saved = store.read();
        if let Some(error) = saved.error {
            return Err(error);
        }
        let current = runtime.observe().await?;
        current.validate()?;
        capture(&mut state, current.clone(), Some(scope));
        if current.revision != expected_runtime_revision
            || !["stopped", "failed"].contains(&current.local.as_str())
        {
            return Err(failure("NETWORK_START_UNCONFIRMED", format!("network preparation rejected before user Start: actual_runtime_revision={} expected_runtime_revision={expected_runtime_revision} actual_local={}; required=matching revision and stopped or failed runtime", current.revision, current.local)));
        }
        let proxy = saved
            .preferences
            .proxy_for(&scope.origin, Some(&scope.device_scope))
            .to_owned();
        let fresh = store.read();
        if let Some(error) = fresh.error {
            return Err(error);
        }
        if fresh.preferences.revision != saved.preferences.revision
            || fresh
                .preferences
                .proxy_for(&scope.origin, Some(&scope.device_scope))
                != proxy
        {
            return Err(failure("NETWORK_SAVED_CHANGED", format!("saved preferences changed before network preparation: initial_revision={} current_revision={}; user Start was not dispatched", saved.preferences.revision, fresh.preferences.revision)));
        }
        if current.network.effective_proxy == proxy {
            state.applied_scope = Some(scope.device_scope.clone());
            return Ok(current.revision);
        }
        let revision = current.network_revision.checked_add(1).map(|revision| revision.max(saved.preferences.revision)).filter(|revision| *revision <= SAFE_INTEGER).ok_or_else(||failure("NETWORK_REVISION_EXHAUSTED", format!("network preparation revision cannot advance: actual={} maximum={SAFE_INTEGER}", current.network_revision)))?;
        runtime
            .configure_network(RuntimeNetworkConfig {
                revision,
                connect_proxy: proxy.clone(),
            })
            .await?;
        let configured = runtime.observe().await?;
        configured.validate()?;
        if configured.instance != current.instance
            || configured.local != current.local
            || configured.revision <= current.revision
            || configured.network_revision != revision
            || configured.network.effective_proxy != proxy
        {
            return Err(failure("NETWORK_START_UNCONFIRMED", format!("network preparation readback failed before user Start: instance_match={} local_match={} actual_runtime_revision={} previous_runtime_revision={} actual_network_revision={} required_network_revision={revision} proxy_match={}; user Start was not dispatched", configured.instance == current.instance, configured.local == current.local, configured.revision, current.revision, configured.network_revision, configured.network.effective_proxy == proxy)));
        }
        let runtime_revision = configured.revision;
        capture(&mut state, configured, Some(scope));
        state.applied_scope = Some(scope.device_scope.clone());
        let readback = store.read();
        if let Some(error) = readback.error {
            return Err(error);
        }
        if readback.preferences.revision != saved.preferences.revision
            || readback
                .preferences
                .proxy_for(&scope.origin, Some(&scope.device_scope))
                != proxy
        {
            return Err(failure("NETWORK_SAVED_CHANGED", format!("saved preferences changed during network preparation: initial_revision={} current_revision={}; user Start was not dispatched", saved.preferences.revision, readback.preferences.revision)));
        }
        Ok(runtime_revision)
    }

    pub async fn apply_saved(
        &self,
        store: &PreferencesStore,
        runtime: &impl NetworkRuntime,
        scope: &TrustedNetworkScope,
        confirmed: bool,
    ) -> NetworkSnapshot {
        self.apply_saved_with_restore(store, runtime, scope, confirmed, true)
            .await
    }
    pub(crate) async fn apply_saved_with_restore(
        &self,
        store: &PreferencesStore,
        runtime: &impl NetworkRuntime,
        scope: &TrustedNetworkScope,
        confirmed: bool,
        restore_intent: bool,
    ) -> NetworkSnapshot {
        let mut state = self.state.lock().await;
        let saved = store.read();
        if let Some(error) = saved.error {
            return render(&state, &saved.preferences, Some(scope), Some(error));
        }
        if !confirmed {
            return render(&state,&saved.preferences,Some(scope),Some(failure("NETWORK_CONFIRMATION_REQUIRED","network restart was not explicitly confirmed; current contribution may be interrupted")));
        }
        let current = match runtime.observe().await.and_then(|view| {
            view.validate()?;
            Ok(view)
        }) {
            Ok(view) => view,
            Err(error) => return render(&state, &saved.preferences, Some(scope), Some(at_apply_stage(error, "network_observe"))),
        };
        capture(&mut state, current.clone(), Some(scope));
        let proxy = saved
            .preferences
            .proxy_for(&scope.origin, Some(&scope.device_scope))
            .to_owned();
        if proxy == current.network.effective_proxy
            && state.applied_scope.as_deref() == Some(&scope.device_scope)
        {
            return render(&state, &saved.preferences, Some(scope), None);
        }
        let revision=match current.network_revision.checked_add(1).map(|revision|revision.max(saved.preferences.revision)).filter(|revision|*revision<=SAFE_INTEGER){Some(revision)=>revision,None=>return render(&state,&saved.preferences,Some(scope),Some(failure("NETWORK_REVISION_EXHAUSTED",format!("effective network revision={} cannot advance within safe integer limit={SAFE_INTEGER}",current.network_revision))))};
        let stopped = match runtime
            .stop_for_network(current.revision)
            .await
            .and_then(|view| {
                view.validate()?;
                Ok(view)
            }) {
            Ok(view) => view,
            Err(error) => return render(&state, &saved.preferences, Some(scope), Some(at_apply_stage(error, "network_stop"))),
        };
        if stopped.instance != current.instance {
            return render(&state,&saved.preferences,Some(scope),Some(failure("NETWORK_INSTANCE_CHANGED","owned management instance changed during network stop; configuration and restore were not dispatched")));
        }
        let receipt = stopped.stop_receipt.as_ref();
        if stopped.local != "stopped"
            || stopped.revision < current.revision
            || stopped.network_revision != current.network_revision
            || receipt.is_none_or(|r| !r.workers_stopped || !r.intent_saved || !r.session_clean)
        {
            return render(&state,&saved.preferences,Some(scope),Some(failure("NETWORK_STOP_UNCONFIRMED",format!("owned runtime stop is unconfirmed: local_stopped={} actual_runtime_revision={} minimum_runtime_revision={} network_revision_match={} receipt_present={} workers_stopped={} intent_saved={} session_clean={}; all stop proofs are required",stopped.local=="stopped",stopped.revision,current.revision,stopped.network_revision==current.network_revision,receipt.is_some(),receipt.is_some_and(|r|r.workers_stopped),receipt.is_some_and(|r|r.intent_saved),receipt.is_some_and(|r|r.session_clean)))));
        }
        capture(&mut state, stopped, Some(scope));
        let fresh = store.read();
        if let Some(error) = fresh.error {
            return render(&state, &fresh.preferences, Some(scope), Some(error));
        }
        if fresh.preferences.revision != saved.preferences.revision
            || fresh
                .preferences
                .proxy_for(&scope.origin, Some(&scope.device_scope))
                != proxy
        {
            return render(&state,&fresh.preferences,Some(scope),Some(failure("NETWORK_SAVED_CHANGED",format!("saved preferences changed while stopping: initial_revision={} current_revision={}; review the new saved proxy before applying",saved.preferences.revision,fresh.preferences.revision))));
        }
        if let Err(error) = runtime
            .configure_network(RuntimeNetworkConfig {
                revision,
                connect_proxy: proxy.clone(),
            })
            .await
        {
            if let Ok(view) = runtime.observe().await {
                if view.validate().is_ok() && view.instance == current.instance {
                    capture(&mut state, view, Some(scope));
                }
            }
            return render(&state, &fresh.preferences, Some(scope), Some(at_apply_stage(error, "network_configure")));
        }
        let configured = match runtime.observe().await.and_then(|view| {
            view.validate()?;
            Ok(view)
        }) {
            Ok(view) => view,
            Err(error) => return render(&state, &fresh.preferences, Some(scope), Some(at_apply_stage(error, "network_configure_readback"))),
        };
        if configured.instance != current.instance
            || configured.local != "stopped"
            || configured.network_revision != revision
            || configured.network.effective_proxy != proxy
        {
            return render(&state,&fresh.preferences,Some(scope),Some(failure("NETWORK_APPLY_UNCONFIRMED",format!("network configuration readback failed: instance_match={} local_stopped={} actual_revision={} required_revision={revision} proxy_match={}; restore was not dispatched",configured.instance==current.instance,configured.local=="stopped",configured.network_revision,configured.network.effective_proxy==proxy))));
        }
        capture(&mut state, configured, Some(scope));
        state.applied_scope = Some(scope.device_scope.clone());
        if !restore_intent {
            return render(&state, &fresh.preferences, Some(scope), None);
        }
        match runtime.restore().await.and_then(|view| {
            view.validate()?;
            Ok(view)
        }) {
            Ok(restored) => {
                if restored.instance != current.instance
                    || restored.network_revision != revision
                    || restored.network.effective_proxy != proxy
                {
                    return render(&state,&fresh.preferences,Some(scope),Some(failure("NETWORK_RESTORE_UNCONFIRMED",format!("saved-intent restore changed network identity: instance_match={} actual_revision={} required_revision={revision} proxy_match={}",restored.instance==current.instance,restored.network_revision,restored.network.effective_proxy==proxy))));
                }
                capture(&mut state, restored, Some(scope));
                render(&state, &fresh.preferences, Some(scope), None)
            }
            Err(error) => render(&state, &fresh.preferences, Some(scope), Some(at_apply_stage(error, "network_restore"))),
        }
    }
}

fn capture(
    state: &mut NetworkState,
    view: RuntimeObservation,
    scope: Option<&TrustedNetworkScope>,
) {
    if state
        .last
        .as_ref()
        .is_none_or(|previous| previous.instance != view.instance)
    {
        state.applied_scope = scope.map(|scope| scope.device_scope.clone());
    }
    state.last = Some(view);
}
fn render(
    state: &NetworkState,
    prefs: &DesktopPreferences,
    scope: Option<&TrustedNetworkScope>,
    error: Option<BridgeError>,
) -> NetworkSnapshot {
    let saved_proxy = scope
        .map(|scope| prefs.proxy_for(&scope.origin, Some(&scope.device_scope)))
        .unwrap_or("")
        .to_owned();
    let (effective_revision, effective_proxy, paths) = state
        .last
        .as_ref()
        .map(|view| {
            (
                view.network.effective_revision,
                view.network.effective_proxy.clone(),
                view.network.paths.clone(),
            )
        })
        .unwrap_or((0, String::new(), NetworkPaths::default()));
    let pending_restart = saved_proxy != effective_proxy
        || scope.is_some_and(|scope| {
            state
                .applied_scope
                .as_deref()
                .is_some_and(|applied| applied != scope.device_scope)
        });
    NetworkSnapshot {
        saved_revision: prefs.revision,
        effective_revision,
        saved_proxy,
        effective_proxy,
        paths,
        pending_restart,
        error,
    }
}

#[cfg(test)]
#[path = "network_tests.rs"]
mod tests;

#[cfg(test)]
mod desktop_failure_tests {
    use super::*;
    #[test]
    fn device_rejection_precedes_scope_validation() {
        let result = serde_json::json!({"error":{"code":"device_replaced","message":"HTTP 401","details":{"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"http_status":"401","remote_code":"device_replaced"}}}});
        let err = trusted_scope(&result).unwrap_err();
        assert_eq!(err.code, "device_replaced");
        assert_eq!(
            serde_json::to_value(err).unwrap()["details"]["check"],
            "device_identity"
        );
    }
}
