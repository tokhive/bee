//! Production coordinator -> fixed-profile Go children -> two real Hive/PG
//! servers. The external harness supplies only synthetic official HTTP and TLS.
use crate::{
    build_source::BuildSource,
    hive_switch::HiveSwitch,
    preferences::{PreferencesStore, ProxyPreference},
    profiles::ProfileStore,
    protocol::{AccountActionRequest, AccountDetectRequest, SupplyPlatform},
    sidecar::{Bridge, BridgePhase, LaunchSpec},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::time::{sleep, timeout};

async fn ready(bridge: &Bridge) {
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
}
async fn control(f: &Value, action: &str, body: Value) -> Value {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .post(format!("{}/{}", f["control"].as_str().unwrap(), action))
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = response.status();
    let raw = response.text().await.unwrap();
    assert!(
        status.is_success(),
        "control {action}: status={status} body={raw}"
    );
    serde_json::from_str(&raw).unwrap()
}
async fn running(bridge: &Bridge) -> Value {
    timeout(Duration::from_secs(25),async{loop{let v=bridge.runtime_snapshot().await.unwrap().result["runtime"].clone();if v["local"]=="running" && v["platforms"]["openai"]["supply"]["ready"]==true{return v};println!("MANAGED_RUNTIME {}",json!({"local":v["local"],"connection":v["connection"],"openai_supply":v["platforms"]["openai"]["supply"],"operation":v["operation"]}));sleep(Duration::from_millis(500)).await;}}).await.expect("managed profile supply did not become ready")
}
async fn startup_current(coordinator: &HiveSwitch, prefs: crate::preferences::PreferencesSnapshot) {
    coordinator.restore_current_admission().await.unwrap();
    let bridge = coordinator.current.get().unwrap();
    let context = coordinator.current.context().unwrap();
    let manager = crate::updater::UpdateManager::new(
        "0.1.0",
        crate::updater::UpdateStore::new(context.directory().join("desktop-update-state.json")),
    )
    .unwrap();
    crate::update_install::verify_startup_progress(
        &manager,
        &bridge,
        prefs,
        "stable",
        &|_| {},
        false,
    )
    .await
    .unwrap();
    let context = bridge.device_context().await.unwrap();
    let binding = crate::protocol::device_context_state(&context.result)
        .unwrap()
        .binding_revision;
    let network =
        crate::network::decode_network_status(&bridge.network_status().await.unwrap().result)
            .unwrap();
    bridge
        .runtime_enable_presence(binding, network.effective_revision)
        .await
        .unwrap();
    timeout(Duration::from_secs(20), async {
        loop {
            let runtime = bridge.runtime_snapshot().await.unwrap();
            if runtime.result["runtime"]["connection"] == "connected" {
                break;
            }
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("committed profile presence did not connect");
}
fn launch() -> LaunchSpec {
    let program = PathBuf::from(std::env::var_os("BEE_SWITCH_NATIVE_WRAPPER").unwrap());
    let bytes = std::fs::read(&program).unwrap();
    LaunchSpec {
        program,
        bundle: None,
        args: vec!["desktop".into()],
        source: BuildSource {
            revision: "hive-switch-fixture".into(),
            tee_revision: "hive-switch-fixture".into(),
            target: "hive-switch-fixture".into(),
            goos: std::env::consts::OS.replace("macos", "darwin"),
            goarch: if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "amd64"
            }
            .into(),
            go: "hive-switch-fixture".into(),
            bee_version: "native-fixture".into(),
            binary_sha256: format!("{:x}", Sha256::digest(bytes)),
        },
        timeout: Duration::from_secs(15),
    }
}
#[tokio::test]
#[ignore = "requires two real Hive/PG servers and synthetic account/TEE harness"]
async fn managed_profile_task_settles_before_roundtrip() {
    let f: Value = serde_json::from_slice(
        &std::fs::read(std::env::var_os("BEE_SWITCH_FIXTURE").unwrap()).unwrap(),
    )
    .unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let profiles = Arc::new(ProfileStore::open(root.join("tokhive")).unwrap());
    let a = profiles
        .register(f["source"]["hive"].as_str().unwrap())
        .unwrap();
    let mut source = f["source"].clone();
    source["name"] = json!("Synthetic managed A");
    crate::preferences::private_write(&a.device_path(), &serde_json::to_vec(&source).unwrap())
        .unwrap();
    profiles
        .commit_current(
            profiles.snapshot().unwrap().revision,
            &a.id,
            &"a".repeat(48),
        )
        .unwrap();
    let mut coordinator = HiveSwitch::from_store(profiles.clone(), launch()).unwrap();
    let current = coordinator.current.get().unwrap();
    ready(&current).await;
    let status = current.device_status().await.unwrap();
    let scope = crate::network::trusted_scope(&status.result)
        .unwrap()
        .unwrap();
    let mut prefs = PreferencesStore::new(root.join("preferences.json")).read();
    prefs.preferences.revision = 1;
    prefs.preferences.proxies.push(ProxyPreference {
        origin: a.origin.clone(),
        device_scope: Some(scope.device_scope().into()),
        connect_proxy: f["proxy"].as_str().unwrap().into(),
    });
    current
        .runtime_configure_network(crate::runtime_protocol::RuntimeNetworkConfig {
            revision: 1,
            connect_proxy: f["proxy"].as_str().unwrap().into(),
        })
        .await
        .unwrap();
    let manager = crate::updater::UpdateManager::new(
        "0.1.0",
        crate::updater::UpdateStore::new(a.directory().join("desktop-update-state.json")),
    )
    .unwrap();
    crate::update_install::verify_startup_progress(
        &manager,
        &current,
        prefs.clone(),
        "stable",
        &|_| {},
        false,
    )
    .await
    .unwrap();
    let context = current.device_context().await.unwrap();
    let binding = crate::protocol::device_context_state(&context.result)
        .unwrap()
        .binding_revision;
    current.runtime_enable_presence(binding, 1).await.unwrap();
    let detected = current
        .account_detect(AccountDetectRequest {
            platform: SupplyPlatform::Openai,
            directory: Some(f["source_directory"].as_str().unwrap().into()),
            store: "file".into(),
            mode: "local".into(),
        })
        .await
        .unwrap();
    let account = &detected.result["account"];
    assert_eq!(account["candidate"]["state"], "available");
    current
        .account_action(AccountActionRequest {
            platform: SupplyPlatform::Openai,
            revision: account["revision"].as_u64().unwrap(),
            candidate_ref: account["candidate"]["reference"].as_str().unwrap().into(),
            action: "select".into(),
            confirmed: true,
        })
        .await
        .unwrap();
    running(&current).await;
    let admitted = control(&f, "start", json!({})).await;
    assert_eq!(admitted["status"], 200);
    let preparing = coordinator
        .start(
            f["target"].as_str().unwrap().into(),
            "Synthetic managed B".into(),
            prefs.clone(),
        )
        .await
        .unwrap();
    assert_eq!(
        preparing.operation.as_ref().unwrap().phase,
        "preparing_target"
    );
    assert_eq!(
        current.runtime_snapshot().await.unwrap().result["runtime"]["connection"],
        "connected"
    );
    let mut pair = coordinator
        .target_begin("Synthetic managed B".into())
        .await
        .unwrap();
    for _ in 0..10 {
        if pair.result["device"]["user_code"].as_str().is_some() {
            break;
        };
        println!("TARGET_PAIR {}", pair.result);
        pair = coordinator.target_status().await.unwrap();
        sleep(Duration::from_millis(30)).await;
    }
    assert!(
        pair.result["device"]["user_code"].as_str().is_some(),
        "target pairing code missing: {}",
        pair.result
    );
    control(
        &f,
        "confirm",
        json!({"code":pair.result["device"]["user_code"]}),
    )
    .await;
    let bound = coordinator.target_status().await.unwrap();
    assert_eq!(bound.result["device"]["state"], "bound", "{}", bound.result);
    let draining = coordinator.continue_waiting(prefs.clone()).await.unwrap();
    let record = draining.operation.as_ref().unwrap();
    assert_eq!(record.phase, "draining_source", "{record:?}");
    assert_eq!(
        record.source.status.as_ref().unwrap()["current"]["work"]["executions"],
        1
    );
    assert!(!record.source.child_reaped);
    control(&f, "blocked", json!({})).await;
    // Cancelling a real active drain preserves the admitted task and current A.
    let cancelled = coordinator.cancel(prefs.clone()).await.unwrap();
    assert_eq!(
        cancelled.operation.as_ref().unwrap().phase,
        "cancelled",
        "{:?}",
        cancelled.operation
    );
    assert_eq!(cancelled.profiles.current_profile, Some(a.id.clone()));
    let waiting = coordinator
        .start(
            f["target"].as_str().unwrap().into(),
            "Synthetic managed B".into(),
            prefs.clone(),
        )
        .await
        .unwrap();
    assert_eq!(waiting.operation.as_ref().unwrap().phase, "draining_source");
    let original = waiting.operation.as_ref().unwrap().id.clone();
    let settled = control(&f, "finish", json!({})).await;
    assert_eq!(settled["state"], "settled");
    assert_eq!(settled["device_id"], f["source"]["identity"]["id"]);
    let lost_release = f["lost_release"] == true;
    if lost_release {
        let pending = coordinator.continue_waiting(prefs.clone()).await.unwrap();
        let pending = pending.operation.unwrap();
        assert_eq!(pending.phase, "releasing_target", "{pending:?}");
        assert!(pending.committed);
        assert_eq!(pending.target.pending.as_deref(), Some("drain_release"));
        let quit = coordinator.request_quit(prefs.clone()).await.unwrap();
        assert!(!quit.operation.unwrap().terminal());
        coordinator = HiveSwitch::from_store(profiles.clone(), launch()).unwrap();
        let recovered = coordinator.snapshot().unwrap().operation.unwrap();
        assert_eq!(recovered.id, pending.id);
        assert_eq!(recovered.target.operation, pending.target.operation);
        assert_eq!(recovered.target.seal, pending.target.seal);
        assert_eq!(recovered.target.release, pending.target.release);
        assert_eq!(control(&f, "recover", json!({})).await["release_posts"], 1);
    }
    let done = timeout(Duration::from_secs(25), async {
        loop {
            let s = coordinator.continue_waiting(prefs.clone()).await.unwrap();
            if s.operation.as_ref().unwrap().terminal() {
                break s;
            };
            sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap();
    let record = done.operation.as_ref().unwrap();
    assert_eq!(record.phase, "succeeded", "{record:?}");
    assert_eq!(record.id, original);
    assert!(record.source.child_reaped && record.source.workers_stopped && record.source.ipc_empty);
    assert!(record.source.status.as_ref().unwrap()["receipt"]["work"]["executions"] == 0);
    assert!(record.committed && record.target.verified);
    startup_current(&coordinator, prefs.clone()).await;
    let b = coordinator.current.get().unwrap();
    let empty = b
        .account_snapshot(SupplyPlatform::Openai, false)
        .await
        .unwrap();
    assert_eq!(
        empty.result["account"]["selection"]["state"],
        "not_selected"
    );
    // A's selection and proxy survive a real A -> B -> A handoff.
    let back = coordinator
        .start(
            a.origin.clone(),
            "Synthetic managed A".into(),
            prefs.clone(),
        )
        .await
        .unwrap();
    assert_eq!(
        back.operation.as_ref().unwrap().phase,
        "succeeded",
        "{:?}",
        back.operation
    );
    assert_eq!(back.profiles.current_profile, Some(a.id.clone()));
    startup_current(&coordinator, prefs.clone()).await;
    let restored = coordinator.current.get().unwrap();
    let selected = restored
        .account_snapshot(SupplyPlatform::Openai, false)
        .await
        .unwrap();
    assert_eq!(selected.result["account"]["selection"]["state"], "selected");
    running(&restored).await;
    let terminal = coordinator.journal.load().unwrap().unwrap();
    println!(
        "REAL_HIVE_SWITCH_ACCEPTANCE {}",
        json!({"source_device":settled["device_id"],"request_id":admitted["request_id"],"first_switch":original,"return_switch":terminal.id,"current":back.profiles.current_profile,"settled":true,"empty_target":true,"lost_release_restart":lost_release})
    );
    restored
        .prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
        .await
        .unwrap();
    coordinator.shutdown_target().await.unwrap();
}
