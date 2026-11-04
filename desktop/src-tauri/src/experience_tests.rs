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
    let app = tauri::test::mock_builder()
        .manage(StartupGate::default())
        .manage(bridge.clone())
        .manage(PreferencesStore::new(dir.path().join("preferences.json")))
        .manage(NetworkController::default())
        .manage(
            UpdateManager::new("0.1.0", UpdateStore::new(dir.path().join("update.json"))).unwrap(),
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    (dir, bridge, app)
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
            app.state::<Bridge>(),
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
    start_with_presence(&bridge,&store,&app.state::<NetworkController>(),&app.state::<StartupGate>(),crate::runtime_protocol::RuntimeStartRequest{expected_revision:5,resume_platforms:vec![]}).await.unwrap();
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
