//! Real Rust Bridge -> production Go transport/services -> controlled Hive.
//! Official identity uses synthetic sources; this is not a signed App or a live
//! official-client/Hive acceptance test.
use crate::{
    build_source::BuildSource,
    protocol::{AccountActionRequest, AccountDetectRequest, SupplyPlatform},
    runtime::OwnedExitReason,
    runtime_protocol::RuntimeStopReason,
    sidecar::{Bridge, BridgePhase, LaunchSpec},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::time::{sleep, timeout, Duration};

async fn observe(bridge: &Bridge, predicate: impl Fn(&Value) -> bool) -> Value {
    timeout(Duration::from_secs(15), async {
        loop {
            let reply = bridge.runtime_snapshot().await.unwrap();
            let view = reply.result.get("runtime").expect("real Go runtime reply");
            if predicate(view) {
                return view.clone();
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("real runtime did not reach the required state")
}

#[tokio::test]
#[ignore = "build go test -c ./agent and set BEE_NATIVE_BRIDGE_TEST_BINARY"]
async fn native_auto_service_through_real_go_transport_and_controlled_hive() {
    let program = PathBuf::from(std::env::var_os("BEE_NATIVE_BRIDGE_TEST_BINARY").unwrap());
    let audit = tempfile::tempdir().unwrap();
    let audit_path = audit.path().join("audit.json");
    let bytes = std::fs::read(&program).unwrap();
    let bridge = Bridge::start(LaunchSpec {
        program,
        bundle: None,
        args: vec![
            "-test.run=^TestDesktopNativeBridgeProcess$".into(),
            format!("-bee-native-fixture-audit={}", audit_path.display()),
        ],
        source: BuildSource {
            revision: "controlled-go-fixture".into(),
            tee_revision: "controlled-go-fixture".into(),
            target: "controlled-go-fixture".into(),
            goos: if cfg!(target_os = "macos") {
                "darwin"
            } else {
                std::env::consts::OS
            }
            .into(),
            goarch: match std::env::consts::ARCH {
                "aarch64" => "arm64",
                "x86_64" => "amd64",
                arch => arch,
            }
            .into(),
            go: "controlled-go-fixture".into(),
            bee_version: "native-fixture".into(),
            binary_sha256: format!("{:x}", Sha256::digest(bytes)),
        },
        timeout: Duration::from_secs(15),
    });
    timeout(Duration::from_secs(20), async {
        while bridge.status().state == BridgePhase::Starting {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        bridge.status().state,
        BridgePhase::Ready,
        "{:?}",
        bridge.status().error
    );
    let initial = observe(&bridge, |v| {
        v["local"] == "waiting" && v["connection"] == "connected"
    })
    .await;
    assert!(initial["run_id"].is_null());
    for platform in ["openai", "claude"] {
        assert_eq!(
            initial["platforms"][platform]["account"]["selection"]["state"],
            "not_selected"
        );
    }
    let mut run_id = Value::Null;
    for (platform, name) in [
        (SupplyPlatform::Openai, "openai"),
        (SupplyPlatform::Claude, "claude"),
    ] {
        let snapshot = bridge.account_snapshot(platform, false).await.unwrap();
        let source = &snapshot.result["account"]["candidate"]["source"];
        let detected = bridge
            .account_detect(AccountDetectRequest {
                platform,
                directory: source["directory"].as_str().map(str::to_owned),
                store: source["store"].as_str().unwrap().into(),
                mode: "local".into(),
            })
            .await
            .unwrap();
        assert_eq!(
            detected.result["account"]["selection"]["state"],
            "not_selected"
        );
        let account = &detected.result["account"];
        bridge
            .account_action(AccountActionRequest {
                platform,
                revision: account["revision"].as_u64().unwrap(),
                candidate_ref: account["candidate"]["reference"].as_str().unwrap().into(),
                action: "select".into(),
                confirmed: true,
            })
            .await
            .unwrap();
        let running = observe(&bridge, |v| {
            v["local"] == "running"
                && v["platforms"][name]["account"]["authorization"]["state"] == "synchronized"
                && v["platforms"][name]["supply"]["paused"] == true
        })
        .await;
        if run_id.is_null() {
            run_id = running["run_id"].clone();
        } else {
            assert_eq!(running["run_id"], run_id);
        }
    }
    let resumed = bridge
        .supply_set_paused(SupplyPlatform::Openai, false)
        .await
        .unwrap();
    assert_eq!(resumed.result["supply"]["paused"], false);
    let running = observe(&bridge, |v| {
        v["platforms"]["openai"]["supply"]["paused"] == false
    })
    .await;
    assert_eq!(running["platforms"]["claude"]["supply"]["paused"], true);
    // Controlled restart uses the same fixed reason as network application.
    bridge
        .runtime_stop(
            running["revision"].as_u64().unwrap(),
            RuntimeStopReason::NetworkChange,
        )
        .await
        .unwrap();
    observe(&bridge, |v| {
        v["local"] == "stopped" && v["operation"]["state"] == "succeeded"
    })
    .await;
    assert_eq!(bridge.inspect_recovery().await.unwrap().state, "eligible");
    let manager = crate::updater::UpdateManager::new(
        "0.1.0", crate::updater::UpdateStore::new(audit.path().join("update.json")),
    ).unwrap();
    let preferences = crate::preferences::PreferencesStore::new(audit.path().join("preferences.json"));
    crate::update_install::verify_startup_progress(&manager, &bridge, preferences.read(), "stable", &|progress| {
        progress.validate().unwrap();
    }, false).await.unwrap();
    let journal=crate::startup_recovery::RecoveryJournal::beside(manager.store.path());
    assert_eq!(journal.load().unwrap().unwrap().phase,"succeeded");
    let reopened = observe(&bridge, |v| {
        v["local"] == "running"
            && v["platforms"]["openai"]["supply"]["paused"] == false
            && v["platforms"]["claude"]["supply"]["paused"] == true
    })
    .await;
    assert_ne!(reopened["run_id"], run_id);
    bridge
        .supply_set_paused(SupplyPlatform::Openai, true)
        .await
        .unwrap();
    let receipt = bridge
        .prepare_owned_exit(OwnedExitReason::AppExit)
        .await
        .unwrap();
    assert!(
        receipt.intent_saved
            && receipt.session_clean
            && receipt.child_reaped
            && receipt.config_lock_released
    );
    assert_eq!(bridge.ping().await.unwrap_err().code, "OWNED_EXIT_PENDING");
    let evidence: Value = serde_json::from_slice(&std::fs::read(audit_path).unwrap()).unwrap();
    assert_eq!(evidence["resume_writes"], 1);
    assert!(evidence["connections"].as_u64().unwrap() >= 2);
    assert!(evidence["relay_probes"].as_u64().unwrap() >= 2);
    assert_eq!(evidence["relay_failures"], 0);
    for platform in ["openai", "claude"] {
        assert_eq!(evidence["paused"][platform], true);
        assert!(evidence["uploads"][platform].as_u64().unwrap() >= 1);
    }
    println!("controlled native evidence: {evidence}");
}

#[tokio::test]
#[ignore = "build go test -c ./agent and set BEE_NATIVE_BRIDGE_TEST_BINARY"]
async fn native_login_progress_open_cancel_through_real_go_transport() {
    let program = PathBuf::from(std::env::var_os("BEE_NATIVE_BRIDGE_TEST_BINARY").unwrap());
    let audit = tempfile::tempdir().unwrap();
    let audit_path = audit.path().join("audit.json");
    let bytes = std::fs::read(&program).unwrap();
    let bridge = Bridge::start(LaunchSpec {
        program,
        bundle: None,
        args: vec![
            "-test.run=^TestDesktopNativeBridgeProcess$".into(),
            format!("-bee-native-fixture-audit={}", audit_path.display()),
            "-bee-native-login-fixture".into(),
        ],
        source: BuildSource {
            revision: "controlled-go-fixture".into(),
            tee_revision: "controlled-go-fixture".into(),
            target: "controlled-go-fixture".into(),
            goos: if cfg!(target_os = "macos") {
                "darwin"
            } else {
                std::env::consts::OS
            }
            .into(),
            goarch: match std::env::consts::ARCH {
                "aarch64" => "arm64",
                "x86_64" => "amd64",
                arch => arch,
            }
            .into(),
            go: "controlled-go-fixture".into(),
            bee_version: "native-fixture".into(),
            binary_sha256: format!("{:x}", Sha256::digest(bytes)),
        },
        timeout: Duration::from_secs(15),
    });
    timeout(Duration::from_secs(20), async {
        while bridge.status().state == BridgePhase::Starting {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        bridge.status().state,
        BridgePhase::Ready,
        "{:?}",
        bridge.status().error
    );

    let metadata = bridge.status().metadata.unwrap();
    assert!(metadata.capabilities.iter().any(|m| m == "authorize_progress"));
    assert!(metadata.capabilities.iter().any(|m| m == "authorize_open"));
    let snapshot = bridge.account_snapshot(SupplyPlatform::Openai, false).await.unwrap();
    let account = &snapshot.result["account"];
    let operation = bridge.authorize_start(crate::authorize_protocol::AuthorizeRequest {
        platform: SupplyPlatform::Openai,
        source: serde_json::from_value(account["candidate"]["source"].clone()).unwrap(),
        expected_revision: account["revision"].as_u64().unwrap(),
    }).await.unwrap();
    let id = operation.result["operation"]["id"].as_str().unwrap().to_string();
    let waiting = timeout(Duration::from_secs(10), async {
        loop {
            let reply = bridge.authorize_progress(id.clone()).await.unwrap();
            if reply.result["progress"]["actions"]["open"] == true { break reply.result["progress"].clone(); }
            sleep(Duration::from_millis(10)).await;
        }
    }).await.unwrap();
    assert_eq!(waiting["phase"], "waiting_authorization");
    for _ in 0..2 {
        let receipt = bridge.authorize_open(id.clone()).await.unwrap();
        assert_eq!(receipt.result["open"]["opened"], true);
        assert_eq!(receipt.result["open"]["progress"]["operation"]["id"], id);
        let public = receipt.result.to_string();
        assert!(!public.contains("PRIVATE_LOGIN_STATE") && !public.contains("oauth/authorize"));
    }
    bridge.authorize_cancel(id.clone()).await.unwrap();
    let stopped = timeout(Duration::from_secs(10), async {
        loop {
            let reply = bridge.authorize_progress(id.clone()).await.unwrap();
            assert_eq!(reply.result["progress"]["actions"]["open"], false);
            if reply.result["progress"]["phase"] == "finished" { break reply.result["progress"].clone(); }
            sleep(Duration::from_millis(10)).await;
        }
    }).await.unwrap();
    assert_eq!(stopped["operation"]["state"], "cancelled");
    assert!(stopped["sequence"].as_u64().unwrap() > waiting["sequence"].as_u64().unwrap());
    let refused = bridge.authorize_open(id).await.unwrap();
    assert_eq!(refused.result["open"]["opened"], false);
    bridge.stop().await.unwrap();
}
