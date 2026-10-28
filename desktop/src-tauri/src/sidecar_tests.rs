use super::*;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use tokio::time::{sleep, timeout};

#[tokio::test]
async fn queued_account_reply_deadline_does_not_wait_for_child_reaping() {
    let bridge = Bridge::start(fixture("account-timeout"));
    wait(&bridge, BridgePhase::Ready).await;
    let first = bridge.clone();
    let pending = tokio::spawn(async move {
        first
            .request(
                "account_snapshot",
                serde_json::json!({"platform":"openai","refresh":false}),
                Duration::from_millis(100),
            )
            .await
    });
    sleep(Duration::from_millis(20)).await;
    let began = Instant::now();
    let cause = bridge
        .request(
            "account_snapshot",
            serde_json::json!({"platform":"claude","refresh":false}),
            Duration::from_millis(150),
        )
        .await
        .unwrap_err();
    assert!(
        began.elapsed() < Duration::from_millis(600),
        "reply waited for reap: {:?}",
        began.elapsed()
    );
    assert_eq!(cause.code, "REQUEST_QUEUE_TIMEOUT");
    pending.await.unwrap().unwrap_err();
    bridge.stop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn account_native_commands_validate_typed_requests_without_expanding_generic_access() {
    let bridge = Bridge::start(fixture("accounts"));
    wait(&bridge, BridgePhase::Ready).await;
    let app = tauri::test::mock_builder()
        .manage(bridge.clone())
        .manage(crate::experience::StartupGate::verified())
        .invoke_handler(tauri::generate_handler![
            crate::commands::account_defaults,
            crate::commands::account_detect,
            crate::commands::account_snapshot,
            crate::commands::account_action,
            crate::commands::bridge_request
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, body: Value| {
        tauri::test::get_ipc_response(
            &view,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    for body in [
        serde_json::json!({}),
        serde_json::json!({"request":null}),
        serde_json::json!({"request":{"platform":"openai","store":"file","mode":"local"}}),
        serde_json::json!({"request":{"platform":"openai","directory":null,"store":"file","mode":"local","token":"private-secret"}}),
    ] {
        assert!(invoke("account_detect", body).is_err());
    }
    invoke("account_defaults", serde_json::json!({})).unwrap();
    invoke("account_detect",serde_json::json!({"request":{"platform":"openai","directory":null,"store":"file","mode":"local"}})).unwrap();
    for body in [
        serde_json::json!({"platform":"openai"}),
        serde_json::json!({"platform":"openai","refresh":null}),
    ] {
        assert!(invoke("account_snapshot", body).is_err());
    }
    invoke(
        "account_snapshot",
        serde_json::json!({"platform":"openai","refresh":false}),
    )
    .unwrap();
    let reply:Value=invoke("account_action",serde_json::json!({"request":{"platform":"openai","revision":0,"candidate_ref":"a".repeat(48),"action":"select","confirmed":false}})).unwrap().deserialize().unwrap();
    assert_eq!(reply["result"]["error"]["code"], "ACCOUNT_OPERATION_FAILED");
    for method in [
        "account_defaults",
        "account_detect",
        "account_snapshot",
        "account_action",
    ] {
        assert!(invoke("bridge_request", serde_json::json!({"method":method})).is_err());
    }
    bridge.ping().await.unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn account_methods_use_fixed_params_and_survive_business_errors() {
    let bridge = Bridge::start(fixture("accounts"));
    wait(&bridge, BridgePhase::Ready).await;
    assert_eq!(
        bridge.account_defaults().await.unwrap().result["defaults"]["platforms"],
        serde_json::json!([])
    );
    let request: protocol::AccountDetectRequest = serde_json::from_value(
        serde_json::json!({"platform":"claude","directory":null,"store":"file","mode":"local"}),
    )
    .unwrap();
    let reply = bridge.account_detect(request).await.unwrap();
    assert_eq!(reply.result["account"]["platform"], "claude");
    let reply = bridge
        .account_snapshot(SupplyPlatform::Openai, false)
        .await
        .unwrap();
    assert_eq!(reply.result["account"]["platform"], "openai");
    let request:protocol::AccountActionRequest=serde_json::from_value(serde_json::json!({"platform":"openai","revision":0,"candidate_ref":"a".repeat(48),"action":"select","confirmed":false})).unwrap();
    let reply = bridge.account_action(request).await.unwrap();
    assert_eq!(reply.result["error"]["code"], "ACCOUNT_OPERATION_FAILED");
    bridge.ping().await.unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn account_request_uses_its_15_second_boundary() {
    let mut spec = fixture("slow-account");
    spec.timeout = Duration::from_millis(400); // Below the 800ms account reply, with Node startup headroom.
    let bridge = Bridge::start(spec);
    wait(&bridge, BridgePhase::Ready).await;
    let reply = bridge
        .account_snapshot(SupplyPlatform::Openai, false)
        .await
        .unwrap();
    assert_eq!(reply.result["account"]["platform"], "openai");
    bridge.stop().await.unwrap();
}

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

pub(crate) fn fixture(mode: &str) -> LaunchSpec {
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
        assert_eq!(reply.instance, "f".repeat(32));
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
async fn child_failure_retains_safe_management_evidence_without_exposing_stderr() {
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
    assert!(cause.message.contains("stderr bytes="));
    assert!(cause.message.contains("retained="));
    assert!(cause.message.contains("truncated="));
    assert!(!cause.message.contains("MARKER"), "raw stderr leaked into public native status");
    assert!(!serde_json::to_string(&bridge.status()).unwrap().contains("MARKER"));
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
    let bridge = Bridge::start(fixture("owned-exit"));
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

#[tokio::test]
async fn device_business_failure_keeps_owned_bridge_ready() {
    let bridge = Bridge::start(fixture("device"));
    wait(&bridge, BridgePhase::Ready).await;
    let reply = bridge.device_status().await.unwrap();
    assert_eq!(reply.result["error"]["code"], "DEVICE_OPERATION_FAILED");
    assert_eq!(bridge.status().state, BridgePhase::Ready);
    assert_eq!(
        bridge.ping().await.unwrap().result,
        serde_json::json!({"alive":true})
    );
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn unsent_queue_timeout_does_not_kill_a_healthy_device_session() {
    let mut spec = fixture("slow-device");
    spec.timeout = Duration::from_millis(500);
    let bridge = Bridge::start(spec);
    wait(&bridge, BridgePhase::Ready).await;
    let slow = bridge.clone();
    let pending = tokio::spawn(async move { slow.device_status().await });
    sleep(Duration::from_millis(50)).await;
    let cause = bridge.ping().await.unwrap_err();
    assert_eq!(cause.code, "REQUEST_QUEUE_TIMEOUT");
    pending.await.unwrap().unwrap();
    assert_eq!(bridge.status().state, BridgePhase::Ready);
    bridge.ping().await.unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn supply_commands_use_fixed_methods_and_params_on_a_six_capability_child() {
    use crate::protocol::SupplyPlatform;
    let bridge = Bridge::start(fixture("supply"));
    wait(&bridge, BridgePhase::Ready).await;
    for platform in [SupplyPlatform::Openai, SupplyPlatform::Claude] {
        let read = bridge.supply_status(platform).await.unwrap();
        assert_eq!(
            read.result["supply"]["platform"],
            serde_json::to_value(platform).unwrap()
        );
        for paused in [false, true] {
            let write = bridge.supply_set_paused(platform, paused).await.unwrap();
            assert_eq!(write.result["supply"]["paused"], paused);
            assert_eq!(
                write.result["supply"]["platform"],
                serde_json::to_value(platform).unwrap()
            );
        }
    }
    bridge.ping().await.unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn supply_business_failure_keeps_the_owned_session_ready() {
    let bridge = Bridge::start(fixture("supply-error"));
    wait(&bridge, BridgePhase::Ready).await;
    let reply = bridge
        .supply_status(crate::protocol::SupplyPlatform::Openai)
        .await
        .unwrap();
    assert_eq!(reply.result["error"]["code"], "SUPPLY_OPERATION_FAILED");
    assert!(reply.result["error"]["message"]
        .as_str()
        .unwrap()
        .contains("503"));
    assert_eq!(bridge.status().state, BridgePhase::Ready);
    bridge.ping().await.unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn supply_native_commands_require_platform_and_an_explicit_boolean() {
    let bridge = Bridge::start(fixture("supply"));
    wait(&bridge, BridgePhase::Ready).await;
    let app = tauri::test::mock_builder()
        .manage(bridge.clone())
        .invoke_handler(tauri::generate_handler![
            crate::commands::supply_status,
            crate::commands::supply_set_paused,
            crate::commands::bridge_request
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, body: Value| {
        tauri::test::get_ipc_response(
            &view,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    for body in [
        serde_json::json!({"paused":false}),
        serde_json::json!({"platform":null,"paused":false}),
        serde_json::json!({"platform":"/private/credential-path","paused":false}),
        serde_json::json!({"platform":"openai"}),
        serde_json::json!({"platform":"openai","paused":null}),
        serde_json::json!({"platform":"openai","paused":"false"}),
    ] {
        let cause = invoke("supply_set_paused", body)
            .err()
            .expect("unsafe native arguments accepted");
        assert!(!cause.to_string().contains("credential-path"));
    }
    let reply: Value = invoke(
        "supply_set_paused",
        serde_json::json!({"platform":"openai","paused":false}),
    )
    .unwrap()
    .deserialize()
    .unwrap();
    assert_eq!(reply["result"]["supply"]["paused"], false);
    for method in ["supply_status", "supply_set_paused"] {
        assert!(invoke("bridge_request", serde_json::json!({"method":method})).is_err());
    }
    bridge.ping().await.unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn runtime_native_commands_fix_stop_reason_and_keep_internal_actions_private() {
    let bridge = Bridge::start(fixture("runtime"));
    wait(&bridge, BridgePhase::Ready).await;
    let app = tauri::test::mock_builder()
        .manage(bridge.clone())
        .manage(crate::experience::StartupGate::verified())
        .manage(crate::preferences::PreferencesStore::new(std::env::temp_dir().join(format!("bee-s2-command-preferences-{}.json",std::process::id()))))
        .manage(crate::network::NetworkController::default())
        .manage(crate::diagnostics_native::NativeDiagnostics::new(std::env::temp_dir().join(format!("bee-s2-command-logs-{}",std::process::id()))))
        .invoke_handler(tauri::generate_handler![
            crate::commands::runtime_snapshot,
            crate::commands::runtime_start,
            crate::commands::runtime_stop,
            crate::commands::bridge_request
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, body: Value| {
        tauri::test::get_ipc_response(
            &view,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    invoke("runtime_snapshot", serde_json::json!({})).unwrap();
    invoke(
        "runtime_start",
        serde_json::json!({"request":{"expected_revision":0,"resume_platforms":["openai"]}}),
    )
    .unwrap();
    assert!(invoke("runtime_start",serde_json::json!({"request":{"expected_revision":0,"resume_platforms":["openai","openai"]}})).is_err());
    // Untrusted extra arguments cannot change the fixed user-stop intent.
    invoke(
        "runtime_stop",
        serde_json::json!({"expectedRevision":1,"reason":"update"}),
    )
    .unwrap();
    for method in [
        "runtime_snapshot",
        "runtime_start",
        "runtime_stop",
        "runtime_configure_network",
        "runtime_restore",
    ] {
        assert!(invoke("bridge_request", serde_json::json!({"method":method})).is_err());
    }
    bridge.stop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn authorize_native_commands_bind_operation_and_keep_shell_private() {
    let bridge = Bridge::start(fixture("authorize"));
    wait(&bridge, BridgePhase::Ready).await;
    let app = tauri::test::mock_builder()
        .manage(bridge.clone())
        .manage(crate::experience::StartupGate::verified())
        .invoke_handler(tauri::generate_handler![
            crate::commands::authorize_start,
            crate::commands::authorize_status,
            crate::commands::authorize_cancel,
            crate::commands::bridge_request
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, body: Value| {
        tauri::test::get_ipc_response(
            &view,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    let reply:Value=invoke("authorize_start",serde_json::json!({"request":{"platform":"openai","source":{"directory":null,"store":"file"},"expected_revision":0}})).unwrap().deserialize().unwrap();
    assert_eq!(reply["result"]["operation"]["kind"], "authorize");
    for cmd in ["authorize_status", "authorize_cancel"] {
        invoke(cmd, serde_json::json!({"operationId":"a".repeat(48)})).unwrap();
        assert!(invoke(cmd, serde_json::json!({"operationId":"bad"})).is_err());
    }
    for request in [
        serde_json::json!({}),
        serde_json::json!({"platform":"openai","source":{"directory":null,"store":"file","program":"PRIVATE_SECRET"},"expected_revision":0}),
    ] {
        assert!(invoke("authorize_start", serde_json::json!({"request":request})).is_err());
    }
    for method in ["authorize_start", "authorize_status", "authorize_cancel"] {
        assert!(invoke("bridge_request", serde_json::json!({"method":method})).is_err());
    }
    bridge.stop().await.unwrap();
}
