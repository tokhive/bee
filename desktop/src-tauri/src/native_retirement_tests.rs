//! Actual Rust -> Go management child -> Hive router -> PostgreSQL acceptance.
//! Invoked by Hive's integration harness with only synthetic state/credentials.
use crate::{
    build_source::BuildSource,
    sidecar::{Bridge, BridgePhase, LaunchSpec},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::time::{sleep, timeout, Duration};

async fn launch(root: &Path, fixture: &Path) -> Bridge {
    let program =
        std::path::PathBuf::from(std::env::var_os("BEE_NATIVE_BRIDGE_TEST_BINARY").unwrap());
    let bytes = std::fs::read(&program).unwrap();
    let bridge = Bridge::start(LaunchSpec {
        program,
        bundle: None,
        args: vec![
            "-test.run=^TestDesktopNativeBridgeProcess$".into(),
            format!(
                "-bee-native-fixture-audit={}",
                root.join("audit.json").display()
            ),
            format!("-bee-native-hive-fixture={}", fixture.display()),
            format!("-bee-native-hive-root={}", root.display()),
        ],
        source: BuildSource {
            revision: "isolated-hive-fixture".into(),
            tee_revision: "isolated-hive-fixture".into(),
            target: "isolated-hive-fixture".into(),
            goos: std::env::consts::OS.replace("macos", "darwin"),
            goarch: match std::env::consts::ARCH {
                "aarch64" => "arm64",
                "x86_64" => "amd64",
                v => v,
            }
            .into(),
            go: "isolated-hive-fixture".into(),
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
    bridge
}

async fn control(fixture: &Value, action: &str) -> Value {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let bytes = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .post(format!(
            "{}/__fixture/{action}",
            fixture["hive"].as_str().unwrap()
        ))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .bytes()
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
#[ignore = "requires Hive integration harness and synthetic fixture"]
async fn native_retirement_through_real_hive() {
    let Some(fixture_path) = std::env::var_os("BEE_RUNTIME_HIVE_FIXTURE") else {
        panic!("BEE_RUNTIME_HIVE_FIXTURE required");
    };
    let fixture_path = std::path::PathBuf::from(fixture_path);
    let fixture: Value = serde_json::from_slice(&std::fs::read(&fixture_path).unwrap()).unwrap();
    let scenario = fixture["scenario"].as_str().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut bridge = launch(root, &fixture_path).await;
    let manager = crate::updater::UpdateManager::new(
        "0.1.0",
        crate::updater::UpdateStore::new(root.join("update.json")),
    )
    .unwrap();
    let preferences = crate::preferences::PreferencesStore::new(root.join("preferences.json"));
    let before = bridge.inspect_recovery().await.unwrap();
    assert_eq!(before.state, "blocked");
    assert_eq!(
        before.failure.as_ref().unwrap().code,
        "RECOVERY_SESSION_UNCONFIRMED"
    );
    if scenario == "success" {
        // A previous manager lost its original restore receipt. Retirement can
        // end its session, while the archived operation must remain unconfirmed.
        crate::startup_recovery::RecoveryJournal::beside(manager.store.path())
            .save(&crate::startup_recovery::RecoveryRecord {
                version: 1,
                attempt_id: "c".repeat(32),
                instance: "d".repeat(32),
                binding_revision: before.binding_revision,
                binding_identity: before.binding_identity.clone(),
                network_revision: 1,
                previous_run_id: before.previous_run_id.clone(),
                account_revision: before.account_revision.clone(),
                intent_running: true,
                trigger: "automatic".into(),
                previous_attempt_id: None,
                operation_id: Some("e".repeat(48)),
                phase: "unknown".into(),
                failure: Some(crate::protocol::BridgeError::new(
                    "RECOVERY_RESULT_UNCONFIRMED",
                    "synthetic original receipt lost".into(),
                )),
            })
            .unwrap();
    }

    if scenario == "exit_race" {
        let other = bridge.clone();
        let verify = crate::update_install::verify_startup_progress(
            &manager,
            &bridge,
            preferences.read(),
            "stable",
            &|_| {},
            false,
        );
        let exiting = async {
            timeout(Duration::from_secs(10), async {
                while control(&fixture, "status").await["post_entered"] != true {
                    sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            let task = tokio::spawn(async move {
                other
                    .prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
                    .await
            });
            timeout(Duration::from_secs(5), async {
                while bridge.check_restore_admission().is_ok() {
                    sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
            control(&fixture, "release").await;
            task.await.unwrap().unwrap()
        };
        let (result, exit) = tokio::join!(verify, exiting);
        assert!(result.is_err(), "late recovery passed an admitted exit");
        assert!(exit.child_reaped && exit.config_lock_released);
        assert!(
            crate::startup_recovery::RecoveryJournal::beside(manager.store.path())
                .load()
                .unwrap()
                .is_none(),
            "exit race submitted a new restore"
        );
        return;
    }

    let first = crate::update_install::verify_startup_progress(
        &manager,
        &bridge,
        preferences.read(),
        "stable",
        &|p| {
            p.validate().unwrap();
        },
        false,
    )
    .await;
    if scenario == "conflict" {
        let error = first.unwrap_err();
        assert_eq!(error.code, "RECOVERY_RETIREMENT_CONFLICT", "{error:?}");
        assert!(error.message.contains("runtime_preparation_conflict"));
        assert_eq!(
            std::fs::read_to_string(root.join("runtime-session")).unwrap(),
            format!("{}\n", "b".repeat(32))
        );
        assert!(
            crate::startup_recovery::RecoveryJournal::beside(manager.store.path())
                .load()
                .unwrap()
                .is_none()
        );
        let exit = bridge
            .prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
            .await
            .unwrap_err();
        assert_eq!(exit.code, "OWNED_EXIT_UNCONFIRMED");
        assert_eq!(bridge.status().state, BridgePhase::Stopped);
        assert_eq!(
            std::fs::read_to_string(root.join("runtime-session")).unwrap(),
            format!("{}\n", "b".repeat(32))
        );
        return;
    }
    if scenario == "draining_restart" {
        assert_eq!(first.unwrap_err().code, "RECOVERY_REMOTE_DRAINING");
        let original: Value = serde_json::from_slice(
            &std::fs::read(root.join("desktop-session-retirement.json")).unwrap(),
        )
        .unwrap();
        // The PID is written by this exact launched test child, in its private
        // state directory. Kill deliberately bypasses normal owned-exit cleanup.
        let pid: i32 =
            serde_json::from_slice(&std::fs::read(root.join("owned-test-pid.json")).unwrap())
                .unwrap();
        assert_eq!(unsafe { libc::kill(pid, libc::SIGKILL) }, 0);
        timeout(Duration::from_secs(10), async {
            while !matches!(
                bridge.status().state,
                BridgePhase::Failed | BridgePhase::Stopped
            ) {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        control(&fixture, "complete").await;
        bridge = launch(root, &fixture_path).await;
        crate::update_install::verify_startup_progress(
            &manager,
            &bridge,
            preferences.read(),
            "stable",
            &|_| {},
            true,
        )
        .await
        .unwrap();
        let completed: Value = serde_json::from_slice(
            &std::fs::read(root.join("desktop-session-retirement.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            completed["request"], original["request"],
            "restart replaced the original retirement"
        );
    } else {
        first.unwrap();
    }
    let reply = timeout(Duration::from_secs(15), async {
        loop {
            let reply = bridge.runtime_snapshot().await.unwrap();
            if reply.result["runtime"]["platforms"]["openai"]["supply"]["paused"].is_boolean() {
                return reply;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("Hive pause readback never reached the desktop snapshot");
    let runtime = &reply.result["runtime"];
    assert_eq!(runtime["local"], "running", "{runtime}");
    assert_eq!(runtime["connection"], "connected");
    assert_eq!(
        runtime["platforms"]["openai"]["supply"]["paused"], true,
        "saved resume list overrode the newer Hive pause"
    );
    assert_ne!(runtime["run_id"], "b".repeat(32));
    let journal = crate::startup_recovery::RecoveryJournal::beside(manager.store.path())
        .load()
        .unwrap()
        .unwrap();
    assert_eq!(journal.phase, "succeeded");
    if scenario == "success" {
        assert_eq!(journal.previous_attempt_id, Some("c".repeat(32)));
        let archived: Value = serde_json::from_slice(
            &std::fs::read(root.join(format!("desktop-startup-recovery-{}.json", "c".repeat(32))))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(archived["phase"], "retired");
        assert_eq!(archived["operation_id"], "e".repeat(48));
        assert_eq!(archived["failure"]["code"], "RECOVERY_PREVIOUS_RETIRED");
        assert!(archived["failure"]["message"]
            .as_str()
            .unwrap()
            .contains("synthetic original receipt lost"));
    }
    let retired: Value = serde_json::from_slice(
        &std::fs::read(root.join("desktop-session-retirement.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(retired["completed"], true);
    assert_eq!(retired["proof"]["state"], "retired");
    let config: Value =
        serde_json::from_slice(&std::fs::read(root.join("desktop.json")).unwrap()).unwrap();
    assert_eq!(config["runtime_epoch"], retired["request"]["id"]);
    let exit = bridge
        .prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
        .await
        .unwrap();
    assert!(exit.session_clean && exit.child_reaped && exit.config_lock_released);
    println!(
        "{}",
        json!({"scenario":scenario,"retirement_id":retired["request"]["id"],"journal":journal.phase,"pause_preserved":true,"owned_exit":true})
    );
}
