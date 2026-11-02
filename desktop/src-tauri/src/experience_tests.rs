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
    assert_eq!(status.binding_revision, None);
    bridge.stop().await.unwrap();
    let status = recheck(app.handle(), &bridge).await;
    assert_eq!(status.state, "blocked");
    assert!(app.state::<StartupGate>().check().is_err());
}
