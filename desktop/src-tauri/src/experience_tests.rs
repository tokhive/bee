use super::*;
#[test]
fn startup_business_check_never_changes_real_management_status() {
    let gate = StartupGate::default();
    let real = BridgeStatus {
        state: BridgePhase::Ready,
        metadata: None,
        error: None,
    };
    assert_eq!(gate.status(real).state, BridgePhase::Ready);
    assert!(gate.check().is_err());
}

use crate::{
    preferences::PreferencesStore,
    updater::{UpdateManager, UpdateStore},
};
fn fixture(
    config: serde_json::Value,
) -> (
    tempfile::TempDir,
    Bridge,
    tauri::App<tauri::test::MockRuntime>,
) {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("context.json");
    std::fs::write(&marker, serde_json::to_vec(&config).unwrap()).unwrap();
    let mut spec = crate::sidecar::tests::fixture("startup-recovery");
    spec.args
        .extend(["".into(), marker.to_string_lossy().to_string()]);
    let bridge = Bridge::start(spec);
    let app=fixture_app(dir.path(),&bridge);
    (dir,bridge,app)
}
fn fixture_app(root:&std::path::Path,bridge:&Bridge)->tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_builder()
        .manage(StartupGate::default())
        .manage({let route=crate::hive_switch::CurrentBridge::default();route.replace(None,bridge.clone());route})
        .manage(PreferencesStore::new(root.join("preferences.json")))
        .manage(NetworkController::default())
        .manage(
            UpdateManager::new("0.1.0", UpdateStore::new(root.join("update.json"))).unwrap(),
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    app
}
#[tokio::test]
async fn rejected_startup_keeps_local_reads_and_recheck_unlocks_without_runtime_restore() {
    let (dir, bridge, app) = fixture(serde_json::json!({"rejected":true}));
    startup(app.handle().clone(), bridge.clone()).await;
    let gate = app.state::<StartupGate>();
    assert_eq!(gate.snapshot().failure.unwrap().code, "device_replaced");
    assert_eq!(bridge.status().state, BridgePhase::Ready);
    assert!(gate.check().is_err());
    assert!(bridge.device_context().await.is_ok());
    assert_eq!(
        bridge.runtime_snapshot().await.unwrap().result["runtime"]["local"],
        "stopped"
    );
    let request = crate::protocol::AccountDetectRequest {
        platform: crate::protocol::SupplyPlatform::Openai,
        directory: None,
        store: "file".into(),
        mode: "local".into(),
    };
    assert!(bridge.account_detect(request).await.is_ok());
    assert!(!bridge.0.restored.load(Ordering::SeqCst));
    std::fs::write(
        dir.path().join("context.json"),
        r#"{"rejected":false,"delay":100}"#,
    )
    .unwrap();
    let (first, duplicate) = tokio::join!(
        recheck(app.handle(), &bridge),
        recheck(app.handle(), &bridge)
    );
    assert_eq!(first.state, "ready");
    assert_eq!(duplicate.state, "checking");
    assert!(gate.check().is_ok());
    assert!(!bridge.0.restored.load(Ordering::SeqCst));
    assert_eq!(
        bridge.runtime_snapshot().await.unwrap().result["runtime"]["local"],
        "stopped"
    );
    bridge.stop().await.unwrap();
}
#[tokio::test]
async fn recheck_rejects_changed_binding_network_and_corrupt_local_data() {
    for changed in [
        serde_json::json!({"binding_revision":2}),
        serde_json::json!({"network_revision":2}),
    ] {
        let (dir, bridge, app) = fixture(serde_json::json!({"delay":180}));
        wait_bridge(&bridge).await.unwrap();
        let marker = dir.path().join("context.json");
        let run = recheck(app.handle(), &bridge);
        let change = async {
            tokio::time::timeout(std::time::Duration::from_secs(2), async {
                while !dir.path().join("context.json.verify").exists() {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
            })
            .await
            .expect("fixture never entered runtime_verify");
            std::fs::write(marker, serde_json::to_vec(&changed).unwrap()).unwrap();
        };
        let (status, _) = tokio::join!(run, change);
        assert_eq!(status.state, "blocked");
        assert_eq!(status.failure.unwrap().code, "STARTUP_CONTEXT_CHANGED");
        assert!(app.state::<StartupGate>().check().is_err());
        bridge.stop().await.unwrap();
    }
    for config in [
        serde_json::json!({"corrupt":true}),
        serde_json::json!({"bad_data":true}),
    ] {
        let (_dir, bridge, app) = fixture(config);
        let status = recheck(app.handle(), &bridge).await;
        assert_eq!(status.state, "blocked");
        assert!(!bridge.0.restored.load(Ordering::SeqCst));
        bridge.stop().await.unwrap();
    }
}
#[tokio::test]
async fn unbound_recheck_is_ready_but_bridge_failure_cannot_be_cleared() {
    let (_dir, bridge, app) = fixture(serde_json::json!({"unbound":true}));
    let status = recheck(app.handle(), &bridge).await;
    assert_eq!(status.state, "ready");
    assert_eq!(status.binding_revision, Some(1));
    bridge.stop().await.unwrap();
    let status = recheck(app.handle(), &bridge).await;
    assert_eq!(status.state, "blocked");
    assert!(app.state::<StartupGate>().check().is_err());
}

#[tokio::test]
async fn saved_proxy_recheck_can_be_explicitly_applied_before_rechecking_ready() {
    for held in [false, true] {
        let (dir, bridge, app) = fixture(serde_json::json!({"apply":true,"runtime_revision":5}));
        wait_bridge(&bridge).await.unwrap();
        // Established readiness before the user saves a different proxy.
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        let store = app.state::<PreferencesStore>();
        let device = bridge.device_status().await.unwrap();
        let scope = crate::network::trusted_scope(&device.result)
            .unwrap()
            .unwrap();
        let mut prefs = store.read().preferences;
        prefs.proxies.push(crate::preferences::ProxyPreference {
            origin: scope.origin().into(),
            device_scope: Some(scope.device_scope().into()),
            connect_proxy: "http://127.0.0.1:18080".into(),
        });
        assert!(store.save(prefs.revision, prefs).error.is_none());
        if held {
            bridge.0.startup_verified.store(false, Ordering::SeqCst);
        }
        let blocked = recheck(app.handle(), &bridge).await;
        assert_eq!(blocked.failure.unwrap().code, "NETWORK_APPLY_REQUIRED");
        let before = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert!(!before.contains("runtime_restore"));
        assert!(!before.contains("runtime_start"));
        let applied = crate::commands::network_apply_saved(
            app.handle().clone(),
            app.state::<crate::hive_switch::CurrentBridge>(),
            store,
            app.state::<NetworkController>(),
            app.state::<StartupGate>(),
            app.state::<UpdateManager>(),
            true,
        )
        .await;
        // Invoke the same command through managed states; command recovery must not unlock readiness.
        let applied = applied.unwrap();
        assert!(applied.error.is_none(), "{:?}", applied.error);
        assert!(!applied.pending_restart);
        assert!(app.state::<StartupGate>().check().is_err());
        let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert_eq!(calls.matches("runtime_restore").count(), usize::from(!held));
        assert!(!calls.contains("runtime_start"));
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        let after = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert_eq!(after.matches("runtime_restore").count(), usize::from(!held));
        assert_eq!(
            bridge.runtime_snapshot().await.unwrap().result["runtime"]["local"],
            "stopped"
        );
        assert!(!bridge.0.restored.load(Ordering::SeqCst));
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn recheck_does_not_bootstrap_saved_proxy_on_fresh_runtime() {
    let (dir, bridge, app) = fixture(serde_json::json!({}));
    wait_bridge(&bridge).await.unwrap();
    let store = app.state::<PreferencesStore>();
    let scope = crate::network::trusted_scope(&bridge.device_status().await.unwrap().result)
        .unwrap()
        .unwrap();
    let mut prefs = store.read().preferences;
    prefs.proxies.push(crate::preferences::ProxyPreference {
        origin: scope.origin().into(),
        device_scope: Some(scope.device_scope().into()),
        connect_proxy: "http://127.0.0.1:18080".into(),
    });
    assert!(store.save(prefs.revision, prefs).error.is_none());
    let status = recheck(app.handle(), &bridge).await;
    assert_eq!(status.state, "blocked");
    assert_eq!(status.failure.unwrap().code, "NETWORK_APPLY_REQUIRED");
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    for method in [
        "runtime_restore",
        "runtime_start",
        "runtime_stop",
        "runtime_configure_network",
    ] {
        assert!(!calls.contains(method), "recheck dispatched {method}");
    }
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn network_recovery_keeps_update_identity_data_and_owned_exit_protections() {
    let (dir, bridge, app) = fixture(serde_json::json!({"apply":true,"runtime_revision":5}));
    wait_bridge(&bridge).await.unwrap();
    let gate = app.state::<StartupGate>();
    gate.finish(Ok(context(&bridge, &app.state::<PreferencesStore>())
        .await
        .unwrap()));
    bridge.0.startup_verified.store(false, Ordering::SeqCst);
    assert_eq!(
        apply_saved_network(
            &bridge,
            &app.state::<PreferencesStore>(),
            &app.state::<NetworkController>(),
            &gate,
            &app.state::<UpdateManager>(),
            true
        )
        .await
        .err()
        .unwrap()
        .code,
        "STARTUP_VERIFICATION_PENDING"
    );
    bridge.0.startup_verified.store(true, Ordering::SeqCst);
    gate.finish(Err(BridgeError::new(
        "NETWORK_APPLY_REQUIRED",
        "saved proxy differs from effective proxy".into(),
    )));
    let store = app.state::<PreferencesStore>();
    let controller = app.state::<NetworkController>();
    let manager = app.state::<UpdateManager>();
    manager.lock().unwrap().persistent.pending_update = Some(crate::updater::PendingUpdate {
        from_version: "0.1.0".into(),
        to_version: "0.2.0".into(),
        channel: "stable".into(),
        stage: "prepared".into(),
        target_digest: "a".repeat(64),
    });
    assert_eq!(
        apply_saved_network(&bridge, &store, &controller, &gate, &manager, true)
            .await
            .unwrap_err()
            .code,
        "UPDATE_RECOVERY_PENDING"
    );
    assert!(manager.has_pending().unwrap());
    manager.lock().unwrap().persistent.pending_update = None;
    for (config, code) in [
        (
            serde_json::json!({"rejected":true,"apply":true}),
            "device_replaced",
        ),
        (
            serde_json::json!({"bad_data":true,"apply":true}),
            "STARTUP_DATA_INVALID",
        ),
    ] {
        std::fs::write(
            dir.path().join("context.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        assert_eq!(
            apply_saved_network(&bridge, &store, &controller, &gate, &manager, true)
                .await
                .unwrap_err()
                .code,
            code
        );
    }
    bridge.0.frozen.store(true, Ordering::SeqCst);
    assert_eq!(
        apply_saved_network(&bridge, &store, &controller, &gate, &manager, true)
            .await
            .unwrap_err()
            .code,
        "OWNED_EXIT_PENDING"
    );
    bridge.0.frozen.store(false, Ordering::SeqCst);
    gate.finish(Err(BridgeError::new("device_replaced", "HTTP 401".into())));
    assert_eq!(
        apply_saved_network(&bridge, &store, &controller, &gate, &manager, true)
            .await
            .unwrap_err()
            .code,
        "device_replaced"
    );
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    for method in [
        "runtime_restore",
        "runtime_start",
        "runtime_stop",
        "runtime_configure_network",
    ] {
        assert!(
            !calls.contains(method),
            "rejected recovery dispatched {method}"
        );
    }
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn recovery_observation_during_account_operation_does_not_reverify_startup() {
    for phase in [None, Some("completed")] {
        let (dir, bridge, app) = fixture(serde_json::json!({}));
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        let gate = app.state::<StartupGate>();
        let before = serde_json::to_value(gate.snapshot()).unwrap();
        let config = if let Some(phase) = phase {
            serde_json::json!({"bad_data":true,"recovery_phase":phase})
        } else {
            serde_json::json!({"bad_data":true,"recovery_error":"DEVICE_RECOVERY_NONE"})
        };
        std::fs::write(dir.path().join("context.json"), config.to_string()).unwrap();
        let calls_path = dir.path().join("context.json.calls");
        let calls_before = std::fs::read_to_string(&calls_path).unwrap();
        let result = recover_device(app.handle(), &bridge, None, false).await;
        if phase.is_some() {
            assert_eq!(result.unwrap().result["recovery"]["phase"], "completed");
        } else {
            assert_eq!(result.unwrap_err().code, "DEVICE_RECOVERY_NONE");
        }
        assert_eq!(serde_json::to_value(gate.snapshot()).unwrap(), before);
        let calls = std::fs::read_to_string(calls_path).unwrap();
        let new_calls = &calls[calls_before.len()..];
        assert!(!new_calls.contains("runtime_verify"));
        assert!(!new_calls.contains("runtime_restore"));
        assert!(!new_calls.contains("runtime_start"));
        // Explicit recovery mutations still require full startup verification.
        assert_eq!(recover_device(app.handle(), &bridge, None, true).await.unwrap_err().code, "STARTUP_DATA_INVALID");
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn absent_device_recovery_status_preserves_startup_and_network_scope() {
    for state in ["ready", "blocked", "checking"] {
        let (dir, bridge, app) =
            fixture(serde_json::json!({"recovery_error":"DEVICE_RECOVERY_NONE"}));
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        let gate = app.state::<StartupGate>();
        if state == "blocked" {
            gate.finish(Err(BridgeError::new(
                "device_replaced",
                "GET identity HTTP 401".into(),
            )));
        } else if state == "checking" {
            gate.checking(bridge.status().metadata.map(|v| v.instance));
        }
        let before = serde_json::to_value(gate.snapshot()).unwrap();
        let store = app.state::<PreferencesStore>();
        let controller = app.state::<NetworkController>();
        // A second device scope exposes whether the original applied scope was
        // retained: recapturing after invalidation would incorrectly accept it.
        let probe_scope = crate::network::trusted_scope(&serde_json::json!({"device":{"state":"bound","hive":"https://hive.example","identity":{"id":"other-device","owner_id":"owner","name":"Other","owner_email":"owner@example.com"}}})).unwrap().unwrap();
        let network_before = controller
            .snapshot(&store, &BridgeNetworkRuntime(&bridge), Some(&probe_scope))
            .await;
        assert!(network_before.pending_restart);
        assert_eq!(
            recover_device(app.handle(), &bridge, None, false)
                .await
                .unwrap_err()
                .code,
            "DEVICE_RECOVERY_NONE"
        );
        assert_eq!(
            serde_json::to_value(gate.snapshot()).unwrap(),
            before,
            "status-only absence changed {state} gate"
        );
        assert_eq!(gate.check().is_ok(), state == "ready");
        let network_after = controller
            .snapshot(&store, &BridgeNetworkRuntime(&bridge), Some(&probe_scope))
            .await;
        assert_eq!(
            serde_json::to_value(network_after).unwrap(),
            serde_json::to_value(network_before).unwrap()
        );
        let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert!(!calls.contains("runtime_restore"));
        assert!(!calls.contains("runtime_start"));
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn recovery_errors_and_absent_writes_still_block_startup() {
    for (code, prepare, confirm) in [
        ("DEVICE_RECOVERY_BLOCKED", false, false),
        ("DEVICE_RECOVERY_NONE", true, false),
        ("DEVICE_RECOVERY_NONE", false, true),
    ] {
        let (_dir, bridge, app) = fixture(serde_json::json!({"recovery_error":code}));
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        let decision = confirm.then(|| crate::protocol::DeviceRecoveryConfirm {
            operation_id: "a".repeat(48),
            expected_revision: 1,
            decision: "begin_pairing".into(),
        });
        assert_eq!(
            recover_device(app.handle(), &bridge, decision, prepare)
                .await
                .unwrap_err()
                .code,
            code
        );
        assert_eq!(app.state::<StartupGate>().snapshot().state, "blocked");
        assert!(app.state::<StartupGate>().check().is_err());
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn completed_device_recovery_automatically_connects_without_restoring_contribution() {
    let (dir, bridge, app) = fixture(serde_json::json!({"rejected":true}));
    startup(app.handle().clone(), bridge.clone()).await;
    bridge.0.startup_verified.store(false, Ordering::SeqCst);
    let result = recover_device(app.handle(), &bridge, None, true)
        .await
        .unwrap();
    assert_eq!(result.result["recovery"]["phase"], "awaiting_confirmation");
    assert_eq!(
        app.state::<StartupGate>().snapshot().failure.unwrap().code,
        "DEVICE_RECOVERY_RECHECK_REQUIRED"
    );
    std::fs::write(
        dir.path().join("context.json"),
        r#"{"recovery_phase":"completed","binding_revision":2}"#,
    )
    .unwrap();
    recover_device(app.handle(), &bridge, None, false)
        .await
        .unwrap();
    assert!(app.state::<StartupGate>().check().is_ok());
    let revision = app.state::<StartupGate>().snapshot().revision;
    recover_device(app.handle(), &bridge, None, false)
        .await
        .unwrap();
    assert!(app.state::<StartupGate>().check().is_ok());
    assert_eq!(app.state::<StartupGate>().snapshot().revision, revision);
    assert!(!bridge.0.restored.load(Ordering::SeqCst));
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert!(!calls.contains("runtime_restore"));
    assert!(!calls.contains("runtime_start"));
    assert!(calls.contains("runtime_enable_presence"));
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn binding_after_unbound_startup_enables_presence_automatically() {
    let (dir, bridge, app) = fixture(serde_json::json!({"unbound":true}));
    assert_eq!(recheck(app.handle(), &bridge).await.state,"ready");
    let before = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert!(!before.contains("runtime_enable_presence"));
    std::fs::write(dir.path().join("context.json"),r#"{"binding_revision":2}"#).unwrap();
    let reply = bridge.device_status().await.unwrap();
    observe_device(app.handle(), &bridge, &reply.result).await;
    assert_eq!(app.state::<StartupGate>().snapshot().binding_revision,Some(2));
    let calls=std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert!(calls.contains("runtime_enable_presence"));
    assert!(!calls.contains("runtime_start"));
    assert!(!calls.contains("runtime_restore"));
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn binding_observation_while_running_rechecks_without_preparing_another_start() {
    let (dir, bridge, app) = fixture(
        serde_json::json!({"apply":true,"running":true,"runtime_revision":61,"binding_revision":2}),
    );
    assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
    let gate = app.state::<StartupGate>();
    let mut previous = context(&bridge, &app.state::<PreferencesStore>())
        .await
        .unwrap();
    previous.binding = Some(1);
    gate.finish(Ok(previous));
    let reply = bridge.device_status().await.unwrap();
    observe_device(app.handle(), &bridge, &reply.result).await;
    let status = gate.snapshot();
    assert_eq!(status.state, "ready", "{:?}", status.failure);
    assert_eq!(status.binding_revision, Some(2));
    let runtime = bridge.runtime_snapshot().await.unwrap();
    assert_eq!(runtime.result["runtime"]["local"], "running");
    assert_eq!(runtime.result["runtime"]["run_id"], "d".repeat(32));
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    for method in [
        "runtime_start",
        "runtime_restore",
        "runtime_stop",
        "runtime_configure_network",
    ] {
        assert!(
            !calls.contains(method),
            "binding observation dispatched {method}"
        );
    }
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn startup_query_revalidates_running_context_without_idle_recovery_inspection() {
    let (dir, bridge, app) =
        fixture(serde_json::json!({"apply":true,"running":true,"runtime_revision":61}));
    assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
    let gate = app.state::<StartupGate>();
    gate.finish(Err(BridgeError::new("NETWORK_START_UNCONFIRMED", "network preparation rejected before user Start: actual_runtime_revision=61 expected_runtime_revision=61 actual_local=running; required=matching revision and stopped or failed runtime".into())));
    let before = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    let result = query(app.handle(), &bridge).await;
    assert!(result.is_ok(), "{:?}", result.err());
    assert_eq!(gate.snapshot().state, "ready");
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    for method in [
        "runtime_inspect_recovery",
        "runtime_reconcile_recovery",
        "runtime_start",
        "runtime_restore",
        "runtime_stop",
        "runtime_configure_network",
    ] {
        assert!(
            !calls[before.len()..].contains(method),
            "result query dispatched {method}"
        );
    }
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn late_binding_observation_and_explicit_start_keep_separate_admission() {
    let (dir, bridge, app) =
        fixture(serde_json::json!({"apply":true,"running":true,"runtime_revision":61}));
    assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
    // The observation was scheduled before startup verified this same binding.
    let status = recheck_binding(app.handle(), &bridge, true).await;
    assert_eq!(status.state, "ready", "{:?}", status.failure);
    let failure = start_with_presence(
        app.handle(),
        &bridge,
        &app.state::<PreferencesStore>(),
        &app.state::<NetworkController>(),
        &app.state::<StartupGate>(),
        crate::runtime_protocol::RuntimeStartRequest {
            expected_revision: 61,
            resume_platforms: vec![],
        },
    )
    .await
    .unwrap_err();
    assert_eq!(failure.code, "NETWORK_START_UNCONFIRMED");
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert!(!calls.lines().any(|method| [
        "runtime_start",
        "runtime_restore",
        "runtime_stop",
        "runtime_configure_network"
    ]
    .contains(&method)));
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn live_result_query_keeps_conflicting_evidence_and_original_failure_blocking() {
    for scenario in [
        "device",
        "data",
        "proxy",
        "update",
        "exit",
        "binding",
        "network",
        "unknown",
        "failed",
        "unverified",
        "retirement",
    ] {
        let mut config = serde_json::json!({"apply":true,"running":true,"runtime_revision":61});
        let (dir, bridge, app) = fixture(config.clone());
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        let gate = app.state::<StartupGate>();
        let original = if scenario == "retirement" {
            "RECOVERY_REMOTE_DRAINING"
        } else {
            "NETWORK_START_UNCONFIRMED"
        };
        gate.finish(Err(BridgeError::new(
            original,
            "original preparation failure".into(),
        )));
        let expected = match scenario {
            "device" => {
                config["rejected"] = true.into();
                "device_replaced"
            }
            "data" => {
                config["bad_data"] = true.into();
                "STARTUP_DATA_INVALID"
            }
            "proxy" => {
                let store = app.state::<PreferencesStore>();
                let scope =
                    crate::network::trusted_scope(&bridge.device_status().await.unwrap().result)
                        .unwrap()
                        .unwrap();
                let mut prefs = store.read().preferences;
                prefs.proxies.push(crate::preferences::ProxyPreference {
                    origin: scope.origin().into(),
                    device_scope: Some(scope.device_scope().into()),
                    connect_proxy: "http://127.0.0.1:18080".into(),
                });
                assert!(store.save(prefs.revision, prefs).error.is_none());
                "NETWORK_APPLY_REQUIRED"
            }
            "update" => {
                app.state::<UpdateManager>()
                    .lock()
                    .unwrap()
                    .persistent
                    .pending_update = Some(crate::updater::PendingUpdate {
                    from_version: "0.1.0".into(),
                    to_version: "0.2.0".into(),
                    channel: "stable".into(),
                    stage: "prepared".into(),
                    target_digest: "a".repeat(64),
                });
                "UPDATE_RECOVERY_PENDING"
            }
            "exit" => {
                bridge.freeze_for_exit();
                "OWNED_EXIT_PENDING"
            }
            "binding" => {
                config["binding_revision"] = 2.into();
                "STARTUP_CONTEXT_CHANGED"
            }
            "network" => {
                config["network_revision"] = 1.into();
                "STARTUP_CONTEXT_CHANGED"
            }
            "unknown" | "failed" => {
                let mut record = unknown_startup_record();
                if scenario == "failed" {
                    record.phase = "failed".into();
                    record.failure = Some(BridgeError::new(
                        "RECOVERY_FAILED",
                        "original start failed".into(),
                    ));
                }
                bridge
                    .startup_journal(app.state::<UpdateManager>().store.path())
                    .save(&record)
                    .unwrap();
                if scenario == "failed" {
                    "RECOVERY_FAILED"
                } else {
                    "RECOVERY_RESULT_UNCONFIRMED"
                }
            }
            "unverified" => {
                bridge.0.startup_verified.store(false, Ordering::SeqCst);
                "RECOVERY_OWNER_BUSY"
            }
            "retirement" => "RECOVERY_OWNER_BUSY",
            _ => unreachable!(),
        };
        std::fs::write(
            dir.path().join("context.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        let before = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert_eq!(
            query(app.handle(), &bridge).await.unwrap_err().code,
            expected,
            "{scenario}"
        );
        assert_eq!(gate.snapshot().state, "blocked", "{scenario}");
        assert_eq!(
            gate.snapshot().failure.unwrap().code,
            original,
            "{scenario}"
        );
        let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert!(
            !calls[before.len()..].lines().any(|method| [
                "runtime_start",
                "runtime_restore",
                "runtime_stop",
                "runtime_configure_network",
                "runtime_enable_presence",
                "supply_set_paused"
            ]
            .contains(&method)),
            "{scenario}: {calls}"
        );
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn live_binding_observation_retains_network_draft_and_unknown_start() {
    for unknown in [false, true] {
        let (dir, bridge, app) = fixture(
            serde_json::json!({"apply":true,"running":true,"runtime_revision":61,"binding_revision":2}),
        );
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        let store = app.state::<PreferencesStore>();
        if unknown {
            bridge
                .startup_journal(app.state::<UpdateManager>().store.path())
                .save(&unknown_startup_record())
                .unwrap();
        } else {
            let scope =
                crate::network::trusted_scope(&bridge.device_status().await.unwrap().result)
                    .unwrap()
                    .unwrap();
            let mut prefs = store.read().preferences;
            prefs.proxies.push(crate::preferences::ProxyPreference {
                origin: scope.origin().into(),
                device_scope: Some(scope.device_scope().into()),
                connect_proxy: "http://127.0.0.1:18080".into(),
            });
            assert!(store.save(prefs.revision, prefs).error.is_none());
        }
        let mut previous = context(&bridge, &store).await.unwrap();
        previous.binding = Some(1);
        app.state::<StartupGate>().finish(Ok(previous));
        let reply = bridge.device_status().await.unwrap();
        observe_device(app.handle(), &bridge, &reply.result).await;
        assert_eq!(
            app.state::<StartupGate>().snapshot().failure.unwrap().code,
            if unknown {
                "RECOVERY_RESULT_UNCONFIRMED"
            } else {
                "NETWORK_APPLY_REQUIRED"
            }
        );
        let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert!(!calls.lines().any(|method| [
            "runtime_start",
            "runtime_restore",
            "runtime_stop",
            "runtime_configure_network"
        ]
        .contains(&method)));
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn live_binding_observation_rejects_a_disconnected_session() {
    let (dir, bridge, app) =
        fixture(serde_json::json!({"apply":true,"running":true,"runtime_revision":61}));
    assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
    std::fs::write(dir.path().join("context.json"),r#"{"apply":true,"running":true,"runtime_revision":61,"binding_revision":2,"connection":"connecting"}"#).unwrap();
    let reply = bridge.device_status().await.unwrap();
    observe_device(app.handle(), &bridge, &reply.result).await;
    let status = app.state::<StartupGate>().snapshot();
    assert_eq!(status.state, "blocked");
    let cause = status.failure.unwrap();
    assert_eq!(cause.code, "STARTUP_CONTEXT_CHANGED");
    assert!(
        cause.message.contains("connection_before=\"connecting\""),
        "{}",
        cause.message
    );
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn live_query_does_not_bind_or_discard_a_saved_network_draft() {
    let (_dir, bridge, app) =
        fixture(serde_json::json!({"apply":true,"running":true,"runtime_revision":61}));
    assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
    let store = app.state::<PreferencesStore>();
    let scope = crate::network::trusted_scope(&bridge.device_status().await.unwrap().result)
        .unwrap()
        .unwrap();
    let mut prefs = store.read().preferences;
    for (device_scope, connect_proxy) in [
        (Some(scope.device_scope().into()), ""),
        (None, "http://127.0.0.1:18080"),
    ] {
        prefs.proxies.push(crate::preferences::ProxyPreference {
            origin: scope.origin().into(),
            device_scope,
            connect_proxy: connect_proxy.into(),
        });
    }
    assert!(store.save(prefs.revision, prefs).error.is_none());
    let before = serde_json::to_value(store.read().preferences).unwrap();
    app.state::<StartupGate>().finish(Err(BridgeError::new(
        "NETWORK_START_UNCONFIRMED",
        "synthetic stale start preparation".into(),
    )));
    assert_eq!(query(app.handle(), &bridge).await.unwrap().state, "ready");
    assert_eq!(
        serde_json::to_value(store.read().preferences).unwrap(),
        before
    );
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn live_query_reports_both_connection_observations_before_rechecking_again() {
    let (dir, bridge, app) =
        fixture(serde_json::json!({"apply":true,"running":true,"runtime_revision":61}));
    assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
    let gate = app.state::<StartupGate>();
    gate.finish(Err(BridgeError::new(
        "NETWORK_START_UNCONFIRMED",
        "original preparation failure".into(),
    )));
    std::fs::remove_file(dir.path().join("context.json.verify")).unwrap();
    std::fs::write(dir.path().join("context.json"),r#"{"apply":true,"running":true,"runtime_revision":61,"connection":"connecting","delay":100}"#).unwrap();
    let reconnect = async {
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !dir.path().join("context.json.verify").exists() {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        std::fs::write(
            dir.path().join("context.json"),
            r#"{"apply":true,"running":true,"runtime_revision":61}"#,
        )
        .unwrap();
    };
    let (result, ()) = tokio::join!(query(app.handle(), &bridge), reconnect);
    let cause = result.unwrap_err();
    assert_eq!(cause.code, "STARTUP_CONTEXT_CHANGED");
    assert!(
        cause.message.contains("connection_before=\"connecting\""),
        "{}",
        cause.message
    );
    assert!(
        cause.message.contains("connection_now=\"connected\""),
        "{}",
        cause.message
    );
    assert_eq!(
        gate.snapshot().failure.unwrap().code,
        "NETWORK_START_UNCONFIRMED"
    );
    assert_eq!(query(app.handle(), &bridge).await.unwrap().state, "ready");
    bridge.stop().await.unwrap();
}

#[tokio::test]
#[ignore = "build go test -c ./agent and set BEE_NATIVE_BRIDGE_TEST_BINARY"]
async fn native_live_binding_and_result_query_keep_the_same_owned_run_and_pause() {
    use sha2::{Digest, Sha256};
    let dir = tempfile::tempdir().unwrap();
    let program =
        std::path::PathBuf::from(std::env::var_os("BEE_NATIVE_BRIDGE_TEST_BINARY").unwrap());
    let bytes = std::fs::read(&program).unwrap();
    let bridge = Bridge::start(crate::sidecar::LaunchSpec {
        program,
        bundle: None,
        args: vec![
            "-test.run=^TestDesktopNativeBridgeProcess$".into(),
            format!(
                "-bee-native-fixture-audit={}",
                dir.path().join("audit.json").display()
            ),
        ],
        source: crate::build_source::BuildSource {
            revision: "controlled-go-fixture".into(),
            tee_revision: "controlled-go-fixture".into(),
            target: "controlled-go-fixture".into(),
            goos: std::env::consts::OS.replace("macos", "darwin"),
            goarch: match std::env::consts::ARCH {
                "aarch64" => "arm64",
                "x86_64" => "amd64",
                v => v,
            }
            .into(),
            go: "controlled-go-fixture".into(),
            bee_version: "native-fixture".into(),
            binary_sha256: format!("{:x}", Sha256::digest(bytes)),
        },
        timeout: std::time::Duration::from_secs(15),
    });
    wait_bridge(&bridge).await.unwrap();
    let app = fixture_app(dir.path(), &bridge);
    // The real Go fixture starts with a controlled local proxy already applied.
    let scope = crate::network::trusted_scope(&bridge.device_status().await.unwrap().result)
        .unwrap()
        .unwrap();
    let network = bridge.network_status().await.unwrap();
    let store = app.state::<PreferencesStore>();
    let mut prefs = store.read().preferences;
    prefs.proxies.push(crate::preferences::ProxyPreference {
        origin: scope.origin().into(),
        device_scope: Some(scope.device_scope().into()),
        connect_proxy: network.result["network"]["effective_proxy"]
            .as_str()
            .unwrap()
            .into(),
    });
    assert!(store.save(prefs.revision, prefs).error.is_none());
    let initial = recheck(app.handle(), &bridge).await;
    assert_eq!(initial.state, "ready", "{:?}", initial.failure);
    let platform = crate::protocol::SupplyPlatform::Openai;
    let snapshot = bridge.account_snapshot(platform, false).await.unwrap();
    let source = &snapshot.result["account"]["candidate"]["source"];
    let detected = bridge
        .account_detect(crate::protocol::AccountDetectRequest {
            platform,
            directory: source["directory"].as_str().map(str::to_owned),
            store: source["store"].as_str().unwrap().into(),
            mode: "local".into(),
        })
        .await
        .unwrap();
    let account = &detected.result["account"];
    bridge
        .account_action(crate::protocol::AccountActionRequest {
            platform,
            revision: account["revision"].as_u64().unwrap(),
            candidate_ref: account["candidate"]["reference"].as_str().unwrap().into(),
            action: "select".into(),
            confirmed: true,
        })
        .await
        .unwrap();
    let running = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            let reply = bridge.runtime_snapshot().await.unwrap();
            if reply.result["runtime"]["local"] == "running"
                && reply.result["runtime"]["platforms"]["openai"]["account"]["authorization"]
                    ["state"]
                    == "synchronized"
            {
                break reply.result["runtime"].clone();
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(running["platforms"]["openai"]["supply"]["paused"], true);
    // A late observation carries a stale gate binding, while Go owns the live run.
    let gate = app.state::<StartupGate>();
    let mut previous = context(&bridge, &app.state::<PreferencesStore>())
        .await
        .unwrap();
    previous.binding = previous.binding.map(|v| v + 1);
    gate.finish(Ok(previous));
    let device = bridge.device_status().await.unwrap();
    observe_device(app.handle(), &bridge, &device.result).await;
    assert_eq!(
        gate.snapshot().state,
        "ready",
        "{:?}",
        gate.snapshot().failure
    );
    gate.finish(Err(BridgeError::new(
        "NETWORK_START_UNCONFIRMED",
        "synthetic stale start-preparation failure on the current owned run".into(),
    )));
    let recovered = query(app.handle(), &bridge).await.unwrap();
    assert_eq!(recovered.state, "ready", "{:?}", recovered.failure);
    let after = bridge.runtime_snapshot().await.unwrap();
    assert_eq!(after.result["runtime"]["run_id"], running["run_id"]);
    assert_eq!(after.result["runtime"]["local"], "running");
    assert_eq!(
        after.result["runtime"]["platforms"]["openai"]["supply"]["paused"],
        true
    );
    // Join this isolated child and inspect controlled Hive writes, not the real App.
    bridge
        .prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
        .await
        .unwrap();
    let audit: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("audit.json")).unwrap()).unwrap();
    assert_eq!(audit["connections"], 1);
    assert_eq!(audit["resume_writes"], 0);
    assert_eq!(audit["paused"]["openai"], true);
}

#[tokio::test]
async fn device_recovery_retains_update_data_and_owned_exit_protection() {
    let (dir, bridge, app) = fixture(serde_json::json!({"rejected":true}));
    wait_bridge(&bridge).await.unwrap();
    let manager = app.state::<UpdateManager>();
    manager.lock().unwrap().persistent.pending_update = Some(crate::updater::PendingUpdate {
        from_version: "0.1.0".into(),
        to_version: "0.2.0".into(),
        channel: "stable".into(),
        stage: "prepared".into(),
        target_digest: "a".repeat(64),
    });
    assert_eq!(
        recover_device(app.handle(), &bridge, None, true)
            .await
            .unwrap_err()
            .code,
        "UPDATE_RECOVERY_PENDING"
    );
    assert!(manager.has_pending().unwrap());
    manager.lock().unwrap().persistent.pending_update = None;
    std::fs::write(dir.path().join("context.json"), r#"{"bad_data":true}"#).unwrap();
    assert_eq!(
        recover_device(app.handle(), &bridge, None, true)
            .await
            .unwrap_err()
            .code,
        "STARTUP_DATA_INVALID"
    );
    bridge.0.frozen.store(true, Ordering::SeqCst);
    assert_eq!(
        recover_device(app.handle(), &bridge, None, true)
            .await
            .unwrap_err()
            .code,
        "OWNED_EXIT_PENDING"
    );
    bridge.0.frozen.store(false, Ordering::SeqCst);
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert!(!calls.contains("device_recovery_prepare"));
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn start_with_new_proxy_reenables_presence_after_dispatch_without_replaying_start() {
    let (dir,bridge,app)=fixture(serde_json::json!({"apply":true,"start":true,"runtime_revision":5}));
    assert_eq!(recheck(app.handle(),&bridge).await.state,"ready");
    let store=app.state::<PreferencesStore>();
    let scope=crate::network::trusted_scope(&bridge.device_status().await.unwrap().result).unwrap().unwrap();
    let mut prefs=store.read().preferences;
    prefs.proxies.push(crate::preferences::ProxyPreference {origin:scope.origin().into(),device_scope:Some(scope.device_scope().into()),connect_proxy:"http://127.0.0.1:18080".into()});
    assert!(store.save(prefs.revision,prefs).error.is_none());
    start_with_presence(app.handle(),&bridge,&store,&app.state::<NetworkController>(),&app.state::<StartupGate>(),crate::runtime_protocol::RuntimeStartRequest{expected_revision:5,resume_platforms:vec![]}).await.unwrap();
    let calls=std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert_eq!(calls.matches("runtime_start").count(),1);
    assert!(calls.rfind("runtime_configure_network").unwrap()<calls.find("runtime_start").unwrap());
    assert!(calls.rfind("runtime_enable_presence").unwrap()>calls.find("runtime_start").unwrap());
    assert!(!calls.contains("runtime_restore"));
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn presence_requires_exact_receipt_and_never_bypasses_exit_freeze(){
    for frozen in [false,true]{
        let (_dir,bridge,app)=fixture(serde_json::json!({"presence_bad":!frozen}));
        wait_bridge(&bridge).await.unwrap();
        bridge.0.frozen.store(frozen,Ordering::SeqCst);
        let status=recheck(app.handle(),&bridge).await;
        assert_eq!(status.state,"blocked");
        assert_eq!(status.failure.unwrap().code,if frozen{"OWNED_EXIT_PENDING"}else{"RUNTIME_REPLY_INVALID"});
        bridge.0.frozen.store(false,Ordering::SeqCst);
        bridge.stop().await.unwrap();
    }
}


#[tokio::test]
async fn audit_start_timeout_keeps_original_request_evidence() {
    let (dir, bridge, app) =
        fixture(serde_json::json!({"apply":true,"start":true,"runtime_revision":5}));
    assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
    let store = app.state::<PreferencesStore>();
    let scope = crate::network::trusted_scope(&bridge.device_status().await.unwrap().result)
        .unwrap()
        .unwrap();
    let mut prefs = store.read().preferences;
    prefs.proxies.push(crate::preferences::ProxyPreference {
        origin: scope.origin().into(),
        device_scope: Some(scope.device_scope().into()),
        connect_proxy: "http://127.0.0.1:18080".into(),
    });
    assert!(store.save(prefs.revision, prefs).error.is_none());
    std::fs::write(
        dir.path().join("context.json"),
        r#"{"apply":true,"start":true,"runtime_revision":5,"audit_hold_start":true}"#,
    )
    .unwrap();
    let cause = start_with_presence(
        app.handle(),
        &bridge,
        &app.state::<PreferencesStore>(),
        &app.state::<NetworkController>(),
        &app.state::<StartupGate>(),
        crate::runtime_protocol::RuntimeStartRequest {
            expected_revision: 5,
            resume_platforms: vec![],
        },
    )
    .await
    .unwrap_err();
    let pending = bridge.pending_requests();
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    if cause.code != "RESPONSE_TIMEOUT" {
        bridge.stop().await.unwrap();
    }
    assert_eq!(calls.matches("runtime_start").count(), 1);
    assert_eq!(pending.requests.len(), 1);
    assert_eq!(pending.requests[0].method, "runtime_start");
    assert_eq!(
        cause.code, "RESPONSE_TIMEOUT",
        "a Start already dispatched must retain its original uncertain-delivery outcome"
    );
    let evidence = cause.details.unwrap().evidence;
    assert_eq!(evidence["method"], "runtime_start");
    assert_eq!(evidence["request_id"], pending.requests[0].id);
    assert_eq!(evidence["in_flight"], "true");
    assert_eq!(
        calls.matches("runtime_enable_presence").count(),
        1,
        "presence must wait for the original Start"
    );
    std::fs::write(dir.path().join("context.json.start-release"), "release").unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
            if calls.matches("runtime_enable_presence").count() == 2 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("settled Start never restored device presence");
    let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert_eq!(calls.matches("runtime_start").count(), 1);
    assert!(bridge.pending_requests().requests.is_empty());
    bridge.ping().await.unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn presence_failure_does_not_replace_start_success_or_business_failure() {
    for outcome in ["accepted", "rejected", "remote_timeout"] {
        let (dir, bridge, app) =
            fixture(serde_json::json!({"apply":true,"start":true,"runtime_revision":5}));
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        std::fs::write(dir.path().join("context.json"),serde_json::to_vec(&serde_json::json!({"apply":true,"start":true,"runtime_revision":5,"presence_error":true,"start_error":outcome=="rejected","start_transport_error":outcome=="remote_timeout"})).unwrap()).unwrap();
        let result = start_with_presence(
            app.handle(),
            &bridge,
            &app.state::<PreferencesStore>(),
            &app.state::<NetworkController>(),
            &app.state::<StartupGate>(),
            crate::runtime_protocol::RuntimeStartRequest {
                expected_revision: 5,
                resume_platforms: vec![],
            },
        )
        .await;
        let status = app.state::<StartupGate>().snapshot();
        bridge.ping().await.unwrap();
        bridge.stop().await.unwrap();
        if outcome == "remote_timeout" {
            let cause = result.unwrap_err();
            assert_eq!(cause.code, "RESPONSE_TIMEOUT");
            assert_eq!(cause.message, "start rejected: remote timeout");
            assert!(cause.details.is_none());
        } else {
            let reply = result.expect("secondary presence failure replaced the Start receipt");
            if outcome == "rejected" {
                assert_eq!(reply.result["error"]["message"], "start rejected: no selected account");
            } else {
                assert_eq!(reply.result["operation"]["id"], "a".repeat(48));
            }
        }
        assert_eq!(status.state, "blocked");
        assert_eq!(
            status.failure.unwrap().message,
            "presence admission blocked: suspended=true"
        );
    }
}

#[tokio::test]
async fn late_start_presence_requires_original_context_and_live_admission() {
    for change in [
        "rejected",
        "binding",
        "network",
        "preferences",
        "rechecked",
        "exit",
        "stopped",
    ] {
        let (dir, bridge, app) =
            fixture(serde_json::json!({"apply":true,"start":true,"runtime_revision":5}));
        assert_eq!(recheck(app.handle(), &bridge).await.state, "ready");
        let checked = context(&bridge, &app.state::<PreferencesStore>())
            .await
            .unwrap();
        let gate = app.state::<StartupGate>();
        let gate_revision = gate.snapshot().revision;
        let mut config = serde_json::json!({"apply":true,"start":true,"runtime_revision":5,"audit_hold_start":true,"start_error":change=="rejected"});
        let marker = dir.path().join("context.json");
        std::fs::write(&marker, serde_json::to_vec(&config).unwrap()).unwrap();
        let cause = bridge
            .request(
                "runtime_start",
                serde_json::json!({"expected_revision":5,"resume_platforms":[]}),
                std::time::Duration::from_millis(100),
            )
            .await
            .unwrap_err();
        assert_eq!(cause.code, "RESPONSE_TIMEOUT");
        let id = cause.details.unwrap().evidence["request_id"].clone();
        match change {
            "binding" => config["binding_revision"] = serde_json::json!(2),
            "network" => config["network_revision"] = serde_json::json!(2),
            "preferences" => {
                let store = app.state::<PreferencesStore>();
                let mut prefs = store.read().preferences;
                prefs.autostart_desired = !prefs.autostart_desired;
                assert!(store.save(prefs.revision, prefs).error.is_none());
            }
            "rechecked" => gate.finish(Ok(checked.clone())),
            "exit" => bridge.0.frozen.store(true, Ordering::SeqCst),
            _ => {}
        }
        std::fs::write(&marker, serde_json::to_vec(&config).unwrap()).unwrap();
        if change == "rejected" {
            // Also cover settlement just before the continuation subscribes.
            let mut settled = bridge.subscribe_settled();
            std::fs::write(dir.path().join("context.json.start-release"), "release").unwrap();
            tokio::time::timeout(std::time::Duration::from_secs(2), settled.recv())
                .await
                .unwrap()
                .unwrap();
        }
        let continuation = tokio::spawn(resume_start_presence(
            app.handle().clone(),
            bridge.clone(),
            checked,
            id,
            gate_revision,
        ));
        if change == "stopped" {
            tokio::task::yield_now().await;
            bridge.stop().await.unwrap();
        } else {
            std::fs::write(dir.path().join("context.json.start-release"), "release").unwrap();
        }
        tokio::time::timeout(std::time::Duration::from_secs(3), continuation)
            .await
            .expect("presence continuation did not finish after settlement or exit")
            .unwrap();
        let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert_eq!(
            calls.matches("runtime_start").count(),
            1,
            "Start replayed for {change}"
        );
        assert_eq!(
            calls.matches("runtime_enable_presence").count(),
            if change == "rejected" { 2 } else { 1 },
            "stale presence dispatched for {change}"
        );
        let status = gate.snapshot();
        if ["binding", "network", "preferences"].contains(&change) {
            assert_eq!(status.state, "blocked");
            assert_eq!(status.failure.unwrap().code, "STARTUP_CONTEXT_CHANGED");
        } else {
            assert_eq!(
                status.state, "ready",
                "old continuation replaced newer readiness for {change}"
            );
        }
        if change != "stopped" {
            bridge.0.frozen.store(false, Ordering::SeqCst);
            bridge.ping().await.unwrap();
            assert!(bridge.pending_requests().requests.is_empty());
            bridge.stop().await.unwrap();
        }
    }
}

#[tokio::test]
async fn unsupported_retirement_is_rejected_before_restore_and_management_survives() {
    let (dir, bridge, app) = fixture(serde_json::json!({"apply":true,"recovery_blocked":true}));
    startup(app.handle().clone(),bridge.clone()).await;
    let status=app.state::<StartupGate>().snapshot();
    assert_eq!(status.state,"blocked");
    assert_eq!(status.failure.unwrap().code,"RECOVERY_SERVER_UNSUPPORTED");
    assert_eq!(bridge.status().state,BridgePhase::Ready);
    let calls=std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert!(!calls.lines().any(|line| line=="runtime_restore" || line=="runtime_stop"),"unexpected side effects: {calls}");
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn a_failed_recovery_query_does_not_replace_the_original_startup_failure() {
    let (_dir,bridge,app)=fixture(serde_json::json!({"recovery_blocked":true}));
    startup(app.handle().clone(),bridge.clone()).await;
    let before=app.state::<StartupGate>().snapshot();
    bridge.freeze_for_exit();
    assert_eq!(query(app.handle(),&bridge).await.unwrap_err().code,"OWNED_EXIT_PENDING");
    let after=app.state::<StartupGate>().snapshot();
    assert_eq!(after.failure.unwrap().code,before.failure.unwrap().code);
    assert!(!after.can_retry);
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn retry_after_success_returns_the_same_result_without_a_second_restore() {
    let (dir,bridge,app)=fixture(serde_json::json!({"apply":true}));
    startup(app.handle().clone(),bridge.clone()).await;
    assert_eq!(app.state::<StartupGate>().snapshot().state,"ready");
    let manager=app.state::<UpdateManager>();
    let journal=crate::startup_recovery::RecoveryJournal::beside(manager.store.path());
    let before=journal.load().unwrap().unwrap().attempt_id;
    assert_eq!(retry(app.handle().clone(),bridge.clone()).await.state,"ready");
    assert_eq!(journal.load().unwrap().unwrap().attempt_id,before);
    let calls=std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
    assert_eq!(calls.lines().filter(|method|*method=="runtime_restore").count(),1);
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn startup_query_retains_continuation_for_pending_retirement() {
    let (_dir, bridge, app) = fixture(serde_json::json!({"recovery_blocked":true}));
    wait_bridge(&bridge).await.unwrap();
    let gate=app.state::<StartupGate>();
    gate.status.lock().unwrap().state="blocked".into();
    gate.status.lock().unwrap().failure=Some(BridgeError::new("RECOVERY_REMOTE_DRAINING","original retirement pending".into()));
    let _ = query(app.handle(),&bridge).await;
    assert!(gate.snapshot().can_retry);
    assert_eq!(gate.snapshot().failure.unwrap().code,"RECOVERY_REMOTE_DRAINING");
    assert!(!bridge.0.restored.load(Ordering::SeqCst));
    bridge.stop().await.unwrap();
}


#[tokio::test]
async fn startup_retires_inherited_session_before_restore_including_unknown_previous_attempt() {
    for previous_unknown in [false, true] {
        let (dir, bridge, app) = fixture(serde_json::json!({"apply":true,"recovery_blocked":true,"retirement":true}));
        let manager = app.state::<UpdateManager>();
        let journal = crate::startup_recovery::RecoveryJournal::beside(manager.store.path());
        if previous_unknown {
            journal.save(&unknown_startup_record()).unwrap();
        }
        startup(app.handle().clone(), bridge.clone()).await;
        let status = app.state::<StartupGate>().snapshot();
        assert_eq!(status.state, "ready", "unknown={previous_unknown}: {:?}", status.failure);
        let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        let methods: Vec<_> = calls.lines().collect();
        let index = |method| methods.iter().position(|value| *value == method).unwrap();
        assert!(index("device_status") < index("runtime_reconcile_recovery"));
        assert!(index("runtime_reconcile_recovery") < index("runtime_restore"));
        assert_eq!(methods.iter().filter(|method| **method == "runtime_restore").count(), 1);
        assert_eq!(journal.load().unwrap().unwrap().phase, "succeeded");
        if previous_unknown {
            let archived = std::fs::read_to_string(dir.path().join(format!("desktop-startup-recovery-{}.json", "a".repeat(32)))).unwrap();
            assert!(archived.contains("original receipt lost"));
            assert!(archived.contains("outcome remains unconfirmed"));
        }
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn startup_retirement_keeps_device_and_remote_proof_failures_blocking() {
    for (config, expected, reconciles) in [
        (serde_json::json!({"apply":true,"recovery_blocked":true,"retirement":true,"rejected":true}), "device_replaced", false),
        (serde_json::json!({"apply":true,"recovery_blocked":true,"retirement":true,"retirement_error":"RECOVERY_REMOTE_DRAINING"}), "RECOVERY_REMOTE_DRAINING", true),
    ] {
        let (dir, bridge, app) = fixture(config);
        startup(app.handle().clone(), bridge.clone()).await;
        let status = app.state::<StartupGate>().snapshot();
        assert_eq!(status.state, "blocked");
        assert_eq!(status.failure.unwrap().code, expected);
        let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert_eq!(calls.lines().any(|method| method == "runtime_reconcile_recovery"), reconciles);
        assert!(!calls.lines().any(|method| method == "runtime_restore"));
        bridge.stop().await.unwrap();
    }
}


fn unknown_startup_record() -> crate::startup_recovery::RecoveryRecord {
    crate::startup_recovery::RecoveryRecord {
        version: 1, attempt_id: "a".repeat(32), instance: "d".repeat(32),
        binding_revision: 1, binding_identity: Some("b".repeat(64)), network_revision: 0,
        previous_run_id: Some("d".repeat(32)), account_revision: Some("a".repeat(64)),
        intent_running: true, trigger: "automatic".into(), previous_attempt_id: None,
        operation_id: Some("a".repeat(48)), phase: "unknown".into(),
        failure: Some(BridgeError::new("RECOVERY_RESULT_UNCONFIRMED", "original receipt lost".into())),
    }
}

#[tokio::test]
async fn startup_never_replays_unknown_attempt_without_matching_retirement_proof() {
    for scenario in ["no_proof", "wrong_binding", "same_instance"] {
        let (dir, bridge, app) = fixture(serde_json::json!({"apply":true,"recovery_blocked":scenario!="no_proof","retirement":true}));
        let manager = app.state::<UpdateManager>();
        let journal = crate::startup_recovery::RecoveryJournal::beside(manager.store.path());
        let mut original = unknown_startup_record();
        if scenario == "wrong_binding" { original.binding_identity = Some("c".repeat(64)); }
        if scenario == "same_instance" { original.instance = "f".repeat(32); }
        journal.save(&original).unwrap();
        startup(app.handle().clone(), bridge.clone()).await;
        let status = app.state::<StartupGate>().snapshot();
        assert_eq!(status.state, "blocked", "{scenario}");
        assert_eq!(status.failure.unwrap().code, if scenario == "wrong_binding" { "RECOVERY_CONTEXT_CHANGED" } else { "RECOVERY_RESULT_UNCONFIRMED" });
        let calls = std::fs::read_to_string(dir.path().join("context.json.calls")).unwrap();
        assert!(!calls.lines().any(|method| method == "runtime_restore"), "{scenario}: {calls}");
        if scenario == "same_instance" {
            assert!(!calls.lines().any(|method| method == "runtime_reconcile_recovery"));
        }
        let saved = journal.load().unwrap().unwrap();
        assert_eq!(saved.phase, "unknown");
        assert_eq!(saved.attempt_id, original.attempt_id);
        assert_eq!(saved.failure.unwrap().message, "original receipt lost");
        bridge.stop().await.unwrap();
    }
}
