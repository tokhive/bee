use super::*;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use tokio::time::{sleep, timeout};

fn node() -> (PathBuf, String) {
    static NODE: OnceLock<(PathBuf, String)> = OnceLock::new();
    NODE.get_or_init(|| {
        let output = std::process::Command::new("node")
            .args(["-p", "process.execPath"])
            .output()
            .expect("Node is required for native protocol fixtures");
        assert!(output.status.success());
        let path = PathBuf::from(String::from_utf8(output.stdout).unwrap().trim());
        let hash = format!("{:x}", Sha256::digest(std::fs::read(&path).unwrap()));
        (path, hash)
    })
    .clone()
}

fn fixture(mode: &str) -> LaunchSpec {
    let (program, hash) = node();
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        value => value,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        value => value,
    };
    LaunchSpec {
        program,
        bundle: None,
        args: vec![
            format!(
                "{}/../tests/fixtures/bridge-child.mjs",
                env!("CARGO_MANIFEST_DIR")
            ),
            mode.into(),
        ],
        source: BuildSource {
            revision: "fixture".into(),
            tee_revision: "fixture".into(),
            target: "fixture".into(),
            goos: os.into(),
            goarch: arch.into(),
            go: "fixture".into(),
            bee_version: "fixture".into(),
            binary_sha256: hash,
        },
        timeout: Duration::from_secs(2),
    }
}

async fn wait(bridge: &Bridge, expected: BridgePhase) -> BridgeStatus {
    timeout(Duration::from_secs(30), async {
        loop {
            let status = bridge.status();
            if status.state == expected {
                return status;
            }
            if status.state == BridgePhase::Failed && expected != BridgePhase::Failed {
                panic!("bridge failed: {:?}", status.error);
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("sidecar did not reach expected state")
}

#[tokio::test]
async fn fragmented_child_responses_and_concurrent_requests_are_correlated() {
    let bridge = Bridge::start(fixture("split"));
    let ready = wait(&bridge, BridgePhase::Ready).await;
    assert_eq!(ready.metadata.unwrap().bee_version, "fixture");
    let mut pending = tokio::task::JoinSet::new();
    for _ in 0..8 {
        let bridge = bridge.clone();
        pending.spawn(async move { bridge.ping().await });
    }
    let mut ids = std::collections::HashSet::new();
    while let Some(result) = pending.join_next().await {
        let reply = result.unwrap().unwrap();
        assert_eq!(reply.instance, "fixture-instance");
        assert_eq!(reply.result, serde_json::json!({"alive":true}));
        assert!(ids.insert(reply.id));
    }
    bridge.stop().await.unwrap();
    bridge.stop().await.unwrap();
    assert_eq!(bridge.status().state, BridgePhase::Stopped);
    assert!(bridge.ping().await.is_err());
}

#[tokio::test]
async fn invalid_utf8_version_exit_and_timeout_never_become_ready() {
    for mode in ["utf8", "version", "exit", "timeout"] {
        let mut spec = fixture(mode);
        spec.timeout = Duration::from_millis(500);
        let bridge = Bridge::start(spec);
        let status = wait(&bridge, BridgePhase::Failed).await;
        assert!(
            status.metadata.is_none(),
            "failed child exposed ready metadata: {mode}"
        );
        let error = status.error.unwrap();
        assert!(!error.code.is_empty() && !error.message.is_empty());
        if mode == "timeout" {
            assert_eq!(error.code, "RESPONSE_TIMEOUT");
        }
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn child_failure_retains_exit_status_and_bounded_management_diagnostic() {
    let bridge = Bridge::start(fixture("diagnostic-exit"));
    wait(&bridge, BridgePhase::Failed).await;
    bridge.stop().await.unwrap();
    let cause = bridge.status().error.unwrap();
    let exit = std::process::Command::new(node().0)
        .args(["-e", "process.exit(9)"])
        .status()
        .unwrap();
    assert_eq!(exit.code(), Some(9));
    assert!(
        cause
            .message
            .contains(&format!("owned child status={exit}")),
        "missing actual exit: {}",
        cause.message
    );
    assert!(
        cause.message.contains("E42"),
        "missing management diagnostic: {}",
        cause.message
    );
    assert!(cause.message.contains("stderr bytes="));
}

#[tokio::test]
async fn missing_and_changed_binaries_fail_before_handshake() {
    for missing in [true, false] {
        let mut spec = fixture("split");
        if missing {
            spec.program = PathBuf::from("/bee-desktop-missing-fixture/bee");
        } else {
            spec.source.binary_sha256 = "0".repeat(64);
        }
        let bridge = Bridge::start(spec);
        let status = wait(&bridge, BridgePhase::Failed).await;
        assert_eq!(status.error.unwrap().code, "BUNDLED_BEE_INVALID");
        assert!(status.metadata.is_none());
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn native_go_management_binary_can_handshake_ping_and_stop() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    };
    let binary = root.join(format!(
        "binaries/bee-{target}{}",
        std::env::consts::EXE_SUFFIX
    ));
    let source_file = binary.with_file_name(format!(
        "{}.source.json",
        binary.file_name().unwrap().to_str().unwrap()
    ));
    let bytes = std::fs::read(&source_file)
        .expect("build the native Bee before running native bridge tests");
    let metadata: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let source = BuildSource::parse(
        &bytes,
        target,
        metadata["revision"].as_str().unwrap(),
        metadata["teeRevision"].as_str().unwrap(),
    )
    .unwrap();
    let bridge = Bridge::start(LaunchSpec {
        program: binary,
        bundle: None,
        args: vec!["desktop".into()],
        source,
        timeout: Duration::from_secs(3),
    });
    wait(&bridge, BridgePhase::Ready).await;
    assert_eq!(
        bridge.ping().await.unwrap().result,
        serde_json::json!({"alive":true})
    );
    bridge.stop().await.unwrap();
    assert_eq!(bridge.status().state, BridgePhase::Stopped);
}

#[test]
fn bundled_program_is_always_next_to_the_app_executable() {
    let app = PathBuf::from("installed Bee directory")
        .join(format!("bee-desktop{}", std::env::consts::EXE_SUFFIX));
    assert_eq!(
        bundled_program(&app).unwrap(),
        app.parent()
            .unwrap()
            .join(format!("bee{}", std::env::consts::EXE_SUFFIX))
    );
    assert!(bundled_program(std::path::Path::new("/")).is_err());
}

#[tokio::test]
async fn failed_ping_revokes_ready_before_returning_and_stop_waits_for_reaping() {
    let mut spec = fixture("ping-timeout");
    spec.timeout = Duration::from_millis(400);
    let bridge = Bridge::start(spec);
    wait(&bridge, BridgePhase::Ready).await;
    let error = bridge.ping().await.unwrap_err();
    assert_eq!(error.code, "RESPONSE_TIMEOUT");
    assert_eq!(
        bridge.status().state,
        BridgePhase::Failed,
        "failed ping still exposes ready before child reaping"
    );
    assert!(bridge.status().metadata.is_none());
    assert!(bridge.ping().await.is_err());
    let (first, second) = tokio::join!(bridge.stop(), bridge.stop());
    first.unwrap();
    second.unwrap();
}

#[test]
fn cleanup_failure_preserves_the_original_protocol_error() {
    let original = error("INVALID_UTF8", "reply UTF-8 failed at byte=7");
    let cleanup = error("CHILD_REAP_FAILED", "wait failed: actual=permission denied");
    let combined = with_cleanup(Some(original), cleanup);
    assert!(combined.message.contains("INVALID_UTF8") && combined.message.contains("byte=7"));
    assert!(
        combined.message.contains("CHILD_REAP_FAILED")
            && combined.message.contains("permission denied")
    );
}

#[cfg(unix)]
#[tokio::test]
async fn concurrent_stop_reaps_stubborn_owned_child_and_preserves_external_process() {
    let pid_file = std::env::temp_dir().join(format!("bee-owned-child-{}.pid", std::process::id()));
    let mut spec = fixture("stubborn");
    spec.args.push(pid_file.to_str().unwrap().into());
    let bridge = Bridge::start(spec);
    wait(&bridge, BridgePhase::Ready).await;
    let pid = std::fs::read_to_string(&pid_file).unwrap();
    let _ = std::fs::remove_file(&pid_file);
    let mut external = std::process::Command::new(node().0)
        .args(["-e", "setInterval(()=>{},1000)"])
        .spawn()
        .unwrap();
    struct External<'a>(&'a mut std::process::Child);
    impl Drop for External<'_> {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let external = External(&mut external);
    let (first, second) = timeout(Duration::from_secs(5), async {
        tokio::join!(bridge.stop(), bridge.stop())
    })
    .await
    .unwrap();
    first.unwrap();
    second.unwrap();
    assert_eq!(bridge.status().state, BridgePhase::Stopped);
    let owned_exists = std::process::Command::new("/bin/kill")
        .args(["-0", &pid])
        .output()
        .unwrap();
    assert!(
        !owned_exists.status.success(),
        "owned child PID={pid} still exists after both stop calls returned"
    );
    assert!(
        external.0.try_wait().unwrap().is_none(),
        "unowned process was stopped"
    );
}

#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "requires a freshly built signed Bee Dev.app; run explicitly after tauri build"]
async fn signed_app_bee_handshakes_pings_and_reaps_without_gui_or_path_lookup() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let bundle = root.join("target/debug/bundle/macos/Bee Dev.app");
    let bytes = include_bytes!(env!("BEE_SOURCE_FILE"));
    let source = BuildSource::parse(
        bytes,
        env!("BEE_TARGET"),
        env!("BEE_REVISION"),
        env!("BEE_TEE_REVISION"),
    )
    .unwrap();
    let bridge = Bridge::start(LaunchSpec {
        program: bundle.join("Contents/MacOS/bee"),
        bundle: Some(bundle),
        args: vec!["desktop".into()],
        source,
        timeout: Duration::from_secs(3),
    });
    wait(&bridge, BridgePhase::Ready).await;
    assert_eq!(
        bridge.ping().await.unwrap().result,
        serde_json::json!({"alive":true})
    );
    bridge.stop().await.unwrap();
    assert_eq!(bridge.status().state, BridgePhase::Stopped);
}

#[tokio::test]
async fn owned_process_is_reaped_before_singleton_release() {
    let bridge = Bridge::start(fixture("stubborn"));
    wait(&bridge, BridgePhase::Ready).await;
    let state_at_release = std::cell::RefCell::new(BridgePhase::Starting);
    crate::lifecycle::shutdown_owned(&bridge, || {
        *state_at_release.borrow_mut() = bridge.status().state;
    })
    .await
    .unwrap();
    assert_eq!(
        *state_at_release.borrow(),
        BridgePhase::Stopped,
        "singleton endpoint released before owned management Child stop/reap completed"
    );
}
