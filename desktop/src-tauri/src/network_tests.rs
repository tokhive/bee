use super::*;
use crate::preferences::{DesktopPreferences, PreferencesStore, ProxyPreference};
use serde_json::{json, Value};
use std::{
    fs,
    sync::{Arc, Mutex},
};

fn identity(owner: &str, device: &str) -> Value {
    json!({"device":{"state":"bound","hive":"https://hive.example","identity":{"id":device,"owner_id":owner,"name":"My Device","owner_email":"public@example.test"}}})
}

fn preferences(proxy: &str) -> (std::path::PathBuf, PreferencesStore, TrustedNetworkScope) {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "bee-network-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    fs::create_dir_all(&dir).unwrap();
    let store = PreferencesStore::new(dir.join("preferences.json"));
    let scope = trusted_scope(&identity("owner-a", "device-a"))
        .unwrap()
        .unwrap();
    let mut prefs = DesktopPreferences::default();
    prefs.proxies.push(ProxyPreference {
        origin: scope.origin.clone(),
        device_scope: Some(scope.device_scope.clone()),
        connect_proxy: proxy.into(),
    });
    assert!(store.save(0, prefs).error.is_none());
    (dir, store, scope)
}

#[derive(Clone)]
struct FakeState {
    observed: RuntimeObservation,
    events: Vec<String>,
    fail_stop: bool,
    fail_configure: bool,
    fail_restore: bool,
    stop_receipt: StopReceipt,
    change_instance: bool,
    stale_stop_revision: bool,
    mismatched_config_readback: bool,
    block_stop: bool,
    block_configure: bool,
    paused: bool,
    pending_change: bool,
}
struct FakeRuntime {
    state: Mutex<FakeState>,
    stop_started: tokio::sync::Notify,
    stop_release: tokio::sync::Notify,
    configure_started: tokio::sync::Notify,
    configure_release: tokio::sync::Notify,
}
impl FakeRuntime {
    fn new(proxy: &str) -> Self {
        Self {
            state: Mutex::new(FakeState {
                observed: RuntimeObservation {
                    instance: "a".repeat(32),
                    revision: 5,
                    network_revision: 0,
                    local: "running".into(),
                    stop_receipt: None,
                    network: NetworkStatus {
                        effective_revision: 0,
                        effective_proxy: proxy.into(),
                        paths: NetworkPaths {
                            relay: if proxy.is_empty() {
                                "direct"
                            } else {
                                "local_proxy"
                            }
                            .into(),
                            official: if proxy.is_empty() {
                                "openai=direct;claude=direct"
                            } else {
                                "openai=local_proxy;claude=local_proxy"
                            }
                            .into(),
                            hive: "process_environment".into(),
                            official_login: "official_client".into(),
                        },
                    },
                },
                events: vec![],
                fail_stop: false,
                fail_configure: false,
                fail_restore: false,
                stop_receipt: StopReceipt {
                    workers_stopped: true,
                    intent_saved: true,
                    session_clean: true,
                },
                change_instance: false,
                stale_stop_revision: false,
                mismatched_config_readback: false,
                block_stop: false,
                block_configure: false,
                paused: true,
                pending_change: true,
            }),
            stop_started: tokio::sync::Notify::new(),
            stop_release: tokio::sync::Notify::new(),
            configure_started: tokio::sync::Notify::new(),
            configure_release: tokio::sync::Notify::new(),
        }
    }
    fn events(&self) -> Vec<String> {
        self.state.lock().unwrap().events.clone()
    }
}
impl NetworkRuntime for FakeRuntime {
    async fn observe(&self) -> Result<RuntimeObservation, BridgeError> {
        let mut s = self.state.lock().unwrap();
        s.events.push("observe".into());
        Ok(s.observed.clone())
    }
    async fn stop_for_network(
        &self,
        expected_revision: u64,
    ) -> Result<RuntimeObservation, BridgeError> {
        let block = {
            let mut s = self.state.lock().unwrap();
            s.events.push(format!("stop:{expected_revision}"));
            s.block_stop
        };
        if block {
            self.stop_started.notify_one();
            self.stop_release.notified().await;
        }
        let mut s = self.state.lock().unwrap();
        if s.fail_stop {
            return Err(failure(
                "STOP_FAILED",
                "fixture stop did not confirm worker termination",
            ));
        }
        s.observed.revision += 1;
        if s.stale_stop_revision {
            s.observed.revision = 0;
        }
        s.observed.local = "stopped".into();
        s.observed.stop_receipt = Some(s.stop_receipt.clone());
        if s.change_instance {
            s.observed.instance = "b".repeat(32);
        }
        Ok(s.observed.clone())
    }
    async fn configure_network(&self, config: RuntimeNetworkConfig) -> Result<(), BridgeError> {
        let block = {
            let mut state = self.state.lock().unwrap();
            state.events.push(format!("configure:{}", config.revision));
            state.block_configure
        };
        if block {
            self.configure_started.notify_one();
            self.configure_release.notified().await;
        }
        let mut s = self.state.lock().unwrap();
        if s.fail_configure {
            return Err(failure(
                "CONFIGURE_FAILED",
                "fixture config rejected before application",
            ));
        }
        s.observed.network_revision = config.revision;
        s.observed.revision += 1;
        s.observed.network.effective_revision = config.revision;
        if s.mismatched_config_readback {
            s.observed.network_revision += 1;
            s.observed.network.effective_revision += 1;
        }
        s.observed.network.effective_proxy = config.connect_proxy;
        s.observed.network.paths.relay = if s.observed.network.effective_proxy.is_empty() {
            "direct"
        } else {
            "local_proxy"
        }
        .into();
        s.observed.network.paths.official = if s.observed.network.effective_proxy.is_empty() {
            "openai=direct;claude=direct"
        } else {
            "openai=local_proxy;claude=local_proxy"
        }
        .into();
        Ok(())
    }
    async fn restore(&self) -> Result<RuntimeObservation, BridgeError> {
        let mut s = self.state.lock().unwrap();
        s.events.push("restore".into());
        if s.fail_restore {
            return Err(failure(
                "RESTORE_FAILED",
                "fixture saved-intent verification failed",
            ));
        }
        s.observed.local = "running".into();
        Ok(s.observed.clone())
    }
}

#[tokio::test]
async fn network_saved_preferences_are_pending_without_applying_running_runtime() {
    let (dir, store, scope) = preferences("http://127.0.0.1:7890");
    let runtime = FakeRuntime::new("");
    let service = NetworkController::default();
    let snapshot = service.snapshot(&store, &runtime, Some(&scope)).await;
    assert_eq!(snapshot.saved_revision, 1);
    assert_eq!(snapshot.effective_revision, 0);
    assert_eq!(snapshot.saved_proxy, "http://127.0.0.1:7890");
    assert_eq!(snapshot.effective_proxy, "");
    assert!(snapshot.pending_restart);
    assert!(snapshot.error.is_none());
    assert_eq!(runtime.events(), vec!["observe"]);
    let value = serde_json::to_value(snapshot).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 7);
    assert!(value.get("scope").is_none());
    fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn network_restart_requires_explicit_confirmation_before_stopping() {
    let (dir, store, scope) = preferences("http://127.0.0.1:7890");
    let runtime = FakeRuntime::new("");
    let snapshot = NetworkController::default()
        .apply_saved(&store, &runtime, &scope, false)
        .await;
    assert_eq!(
        snapshot.error.unwrap().code,
        "NETWORK_CONFIRMATION_REQUIRED"
    );
    assert!(runtime.events().is_empty());
    assert_eq!(snapshot.effective_proxy, "");
    fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn network_applies_only_after_owned_stop_and_restores_saved_intent() {
    let (dir, store, scope) = preferences("http://127.0.0.1:7890");
    let runtime = FakeRuntime::new("");
    let snapshot = NetworkController::default()
        .apply_saved(&store, &runtime, &scope, true)
        .await;
    assert!(snapshot.error.is_none(), "{:?}", snapshot.error);
    assert_eq!(snapshot.effective_proxy, "http://127.0.0.1:7890");
    assert_eq!(snapshot.effective_revision, 1);
    assert!(!snapshot.pending_restart);
    assert_eq!(
        runtime.events(),
        vec!["observe", "stop:5", "configure:1", "observe", "restore"]
    );
    let state = runtime.state.lock().unwrap();
    assert!(state.paused);
    assert!(state.pending_change);
    drop(state);
    fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn network_rejects_each_untrusted_stop_receipt_before_configure_or_restore() {
    for receipt in [
        StopReceipt {
            workers_stopped: false,
            intent_saved: true,
            session_clean: true,
        },
        StopReceipt {
            workers_stopped: true,
            intent_saved: false,
            session_clean: true,
        },
        StopReceipt {
            workers_stopped: true,
            intent_saved: true,
            session_clean: false,
        },
    ] {
        let (dir, store, scope) = preferences("http://127.0.0.1:7890");
        let runtime = FakeRuntime::new("");
        runtime.state.lock().unwrap().stop_receipt = receipt;
        let snapshot = NetworkController::default()
            .apply_saved(&store, &runtime, &scope, true)
            .await;
        let error = snapshot.error.unwrap();
        assert_eq!(error.code, "NETWORK_STOP_UNCONFIRMED");
        assert!(error.message.contains("workers_stopped="));
        assert!(runtime
            .events()
            .iter()
            .all(|e| !e.starts_with("configure") && e != "restore"));
        assert_eq!(snapshot.effective_proxy, "");
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tokio::test]
async fn network_failures_preserve_effective_values_and_never_restore_after_failed_config() {
    for phase in ["stop", "configure", "restore"] {
        let (dir, store, scope) = preferences("http://127.0.0.1:7890");
        let runtime = FakeRuntime::new("");
        {
            let mut s = runtime.state.lock().unwrap();
            s.fail_stop = phase == "stop";
            s.fail_configure = phase == "configure";
            s.fail_restore = phase == "restore";
        }
        let snapshot = NetworkController::default()
            .apply_saved(&store, &runtime, &scope, true)
            .await;
        assert!(snapshot.error.is_some());
        if phase != "restore" {
            assert_eq!(snapshot.effective_proxy, "");
            assert!(!runtime.events().contains(&"restore".into()));
        } else {
            assert_eq!(snapshot.effective_proxy, "http://127.0.0.1:7890");
            assert_eq!(snapshot.error.unwrap().code, "RESTORE_FAILED");
        }
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tokio::test]
async fn network_does_not_apply_to_replaced_management_instance() {
    let (dir, store, scope) = preferences("http://127.0.0.1:7890");
    let runtime = FakeRuntime::new("");
    runtime.state.lock().unwrap().change_instance = true;
    let snapshot = NetworkController::default()
        .apply_saved(&store, &runtime, &scope, true)
        .await;
    assert_eq!(snapshot.error.unwrap().code, "NETWORK_INSTANCE_CHANGED");
    assert!(runtime
        .events()
        .iter()
        .all(|e| !e.starts_with("configure") && e != "restore"));
    fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn network_rechecks_saved_revision_after_stop_before_apply() {
    let (dir, store, scope) = preferences("http://127.0.0.1:7890");
    let store = Arc::new(store);
    let runtime = Arc::new(FakeRuntime::new(""));
    runtime.state.lock().unwrap().block_stop = true;
    let controller = Arc::new(NetworkController::default());
    let task = {
        let store = store.clone();
        let runtime = runtime.clone();
        let controller = controller.clone();
        tokio::spawn(async move {
            controller
                .apply_saved(&store, &*runtime, &scope, true)
                .await
        })
    };
    runtime.stop_started.notified().await;
    let mut prefs = store.read().preferences;
    prefs.proxies[0].connect_proxy = "http://127.0.0.1:7892".into();
    assert!(store.save(1, prefs).error.is_none());
    runtime.stop_release.notify_one();
    let snapshot = task.await.unwrap();
    assert_eq!(snapshot.error.unwrap().code, "NETWORK_SAVED_CHANGED");
    assert_eq!(snapshot.saved_proxy, "http://127.0.0.1:7892");
    assert!(runtime
        .events()
        .iter()
        .all(|e| !e.starts_with("configure") && e != "restore"));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn network_verified_scope_binds_draft_without_cross_device_copy() {
    let (dir, store, scope) = preferences("");
    let mut prefs = store.read().preferences;
    prefs.proxies.push(ProxyPreference {
        origin: "https://hive.example".into(),
        device_scope: None,
        connect_proxy: "http://127.0.0.1:7893".into(),
    });
    assert!(store.save(1, prefs).error.is_none());
    let other = trusted_scope(&identity("owner-b", "device-b"))
        .unwrap()
        .unwrap();
    assert_ne!(scope.device_scope, other.device_scope);
    let controller = NetworkController::default();
    let bound = controller
        .bind_verified_device(&store, &identity("owner-b", "device-b"))
        .unwrap()
        .unwrap();
    assert_eq!(bound.device_scope, other.device_scope);
    let prefs = store.read().preferences;
    assert_eq!(
        prefs.proxy_for(&scope.origin, Some(&scope.device_scope)),
        ""
    );
    assert_eq!(
        prefs.proxy_for(&other.origin, Some(&other.device_scope)),
        "http://127.0.0.1:7893"
    );
    assert!(trusted_scope(&json!({"device":{"state":"bound","hive":"https://hive.example","identity":{"id":"device-a"}}})).is_err());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn network_scope_matches_go_json_array_sha256_contract() {
    let scope = trusted_scope(&identity("owner-a", "device-a"))
        .unwrap()
        .unwrap();
    // agent.desktopScopeKey hashes Go json.Marshal([]string{hive, owner, device}).
    // Exact bytes: ["https://hive.example","owner-a","device-a"]
    assert_eq!(
        scope.device_scope,
        "029522b69392f8f434c573cc8322f57191a26c8b2f9c4d85a515e9e010be0b67"
    );
}

#[test]
fn network_scope_accepts_only_actual_device_status_states() {
    for state in ["unbound", "pending", "draining", "expired"] {
        assert!(trusted_scope(&json!({"device":{"state":state}}))
            .unwrap()
            .is_none());
    }
    assert!(trusted_scope(&json!({"device":{"state":"pairing"}})).is_err());
}

#[tokio::test]
async fn network_corrupt_preferences_block_apply_without_stopping() {
    let (dir, store, scope) = preferences("http://127.0.0.1:7890");
    fs::write(dir.join("preferences.json"), b"{broken").unwrap();
    let runtime = FakeRuntime::new("");
    let snapshot = NetworkController::default()
        .apply_saved(&store, &runtime, &scope, true)
        .await;
    assert!(snapshot.error.is_some());
    assert!(runtime.events().is_empty());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn network_status_contract_rejects_unknown_fields_paths_and_sensitive_values() {
    let base = json!({"network":{"effective_revision":0,"effective_proxy":"","paths":{"relay":"direct","official":"openai=direct;claude=direct","hive":"process_environment","official_login":"official_client"}}});
    decode_network_status(&base).unwrap();
    for (pointer, value) in [
        ("/network/effective_revision", json!(9007199254740992u64)),
        ("/network/paths/official", json!("PRIVATE_PROXY_SECRET")),
        (
            "/network/effective_proxy",
            json!("http://user:PRIVATE_PROXY_SECRET@127.0.0.1:7890"),
        ),
    ] {
        let mut bad = base.clone();
        *bad.pointer_mut(pointer).unwrap() = value;
        let error = decode_network_status(&bad).unwrap_err();
        assert!(!error.message.contains("PRIVATE_PROXY_SECRET"));
    }
    let mut bad = base;
    bad["network"]["token"] = json!("PRIVATE_PROXY_SECRET");
    assert!(decode_network_status(&bad).is_err());
}

#[tokio::test]
async fn network_stale_stop_and_mismatched_configuration_readback_block_restore() {
    for phase in ["stop_revision", "configure_readback"] {
        let (dir, store, scope) = preferences("http://127.0.0.1:7890");
        let runtime = FakeRuntime::new("");
        {
            let mut state = runtime.state.lock().unwrap();
            state.stale_stop_revision = phase == "stop_revision";
            state.mismatched_config_readback = phase == "configure_readback";
        }
        let snapshot = NetworkController::default()
            .apply_saved(&store, &runtime, &scope, true)
            .await;
        assert!(
            snapshot.error.is_some(),
            "stale or mismatched readback was accepted: {phase}"
        );
        assert!(!runtime.events().contains(&"restore".into()));
        if phase == "stop_revision" {
            assert!(runtime
                .events()
                .iter()
                .all(|event| !event.starts_with("configure")));
        }
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tokio::test]
async fn network_bootstrap_applies_saved_proxy_before_any_restore() {
    let (dir, store, scope) = preferences("http://127.0.0.1:7890");
    let runtime = FakeRuntime::new("");
    {
        let mut state = runtime.state.lock().unwrap();
        state.observed.local = "stopped".into();
        state.observed.revision = 0;
    }
    let snapshot = NetworkController::default()
        .bootstrap_saved(&store, &runtime, &scope)
        .await;
    assert!(snapshot.error.is_none(), "{:?}", snapshot.error);
    assert_eq!(snapshot.saved_proxy, "http://127.0.0.1:7890");
    assert_eq!(snapshot.effective_proxy, snapshot.saved_proxy);
    assert_eq!(snapshot.effective_revision, 1);
    assert!(!snapshot.pending_restart);
    assert_eq!(runtime.events(), vec!["observe", "configure:1", "observe"]);
    fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn network_bootstrap_requires_initial_stopped_runtime_and_confirmed_configuration() {
    for phase in ["running", "non_initial", "configure", "readback"] {
        let (dir, store, scope) = preferences("http://127.0.0.1:7890");
        let runtime = FakeRuntime::new("");
        {
            let mut state = runtime.state.lock().unwrap();
            state.observed.local = if phase == "running" {
                "running"
            } else {
                "stopped"
            }
            .into();
            state.observed.revision = if phase == "non_initial" { 2 } else { 0 };
            state.fail_configure = phase == "configure";
            state.mismatched_config_readback = phase == "readback";
        }
        let snapshot = NetworkController::default()
            .bootstrap_saved(&store, &runtime, &scope)
            .await;
        assert!(snapshot.error.is_some(), "bootstrap accepted {phase}");
        assert!(!runtime
            .events()
            .iter()
            .any(|event| event.starts_with("stop:") || event == "restore"));
        if ["running", "non_initial"].contains(&phase) {
            assert!(!runtime
                .events()
                .iter()
                .any(|event| event.starts_with("configure:")));
        }
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tokio::test]
async fn network_prepare_start_applies_trusted_saved_scope_without_changing_resume_intent() {
    for local in ["stopped", "failed"] {
        let (dir, store, scope) = preferences("http://127.0.0.1:7890");
        let runtime = FakeRuntime::new("");
        runtime.state.lock().unwrap().observed.local = local.into();
        let revision = NetworkController::default()
            .prepare_start(&store, &runtime, &scope, 5)
            .await
            .unwrap();
        assert_eq!(revision, 6);
        assert_eq!(runtime.events(), vec!["observe", "configure:1", "observe"]);
        let state = runtime.state.lock().unwrap();
        assert!(state.paused && state.pending_change);
        assert_eq!(
            state.observed.network.effective_proxy,
            "http://127.0.0.1:7890"
        );
        drop(state);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tokio::test]
async fn network_prepare_start_avoids_unnecessary_config_and_rejects_untrusted_preconditions() {
    for phase in ["same", "revision", "running", "configure", "readback"] {
        let (dir, store, scope) = preferences("http://127.0.0.1:7890");
        let runtime = FakeRuntime::new(if phase == "same" {
            "http://127.0.0.1:7890"
        } else {
            ""
        });
        {
            let mut state = runtime.state.lock().unwrap();
            state.observed.local = if phase == "running" {
                "running"
            } else {
                "stopped"
            }
            .into();
            state.fail_configure = phase == "configure";
            state.mismatched_config_readback = phase == "readback";
        }
        let result = NetworkController::default()
            .prepare_start(
                &store,
                &runtime,
                &scope,
                if phase == "revision" { 4 } else { 5 },
            )
            .await;
        if phase == "same" {
            assert_eq!(result.unwrap(), 5);
            assert_eq!(runtime.events(), vec!["observe"]);
        } else {
            assert!(result.is_err(), "accepted {phase}");
            if ["revision", "running"].contains(&phase) {
                assert!(runtime
                    .events()
                    .iter()
                    .all(|event| !event.starts_with("configure:")));
            }
        }
        assert!(runtime
            .events()
            .iter()
            .all(|event| !event.starts_with("stop:") && event != "restore"));
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tokio::test]
async fn network_prepare_start_blocks_start_when_saved_preferences_change_during_configuration() {
    let (dir, store, scope) = preferences("http://127.0.0.1:7890");
    let store = Arc::new(store);
    let runtime = Arc::new(FakeRuntime::new(""));
    {
        let mut state = runtime.state.lock().unwrap();
        state.observed.local = "stopped".into();
        state.block_configure = true;
    }
    let controller = Arc::new(NetworkController::default());
    let task = {
        let store = store.clone();
        let runtime = runtime.clone();
        let controller = controller.clone();
        tokio::spawn(async move { controller.prepare_start(&store, &*runtime, &scope, 5).await })
    };
    runtime.configure_started.notified().await;
    let mut prefs = store.read().preferences;
    prefs.proxies[0].connect_proxy = "http://127.0.0.1:7892".into();
    assert!(store.save(1, prefs).error.is_none());
    runtime.configure_release.notify_one();
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(error.code, "NETWORK_SAVED_CHANGED");
    assert!(!runtime
        .events()
        .iter()
        .any(|event| event.starts_with("stop:") || event == "restore"));
    fs::remove_dir_all(dir).unwrap();
}
