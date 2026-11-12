use super::*;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use tokio::time::{sleep, timeout};

#[test]
fn launch_spec_keeps_its_original_profile_and_mode_after_current_changes() {
    let tmp=tempfile::tempdir().unwrap();
    let store=crate::profiles::ProfileStore::open(tmp.path().join("tokhive")).unwrap();
    let a=store.register("https://a.example").unwrap();
    let b=store.register("https://b.example").unwrap();
    let spec=fixture("echo").for_profile(&a,crate::profiles::ProfileMode::Prepare).unwrap();
    let before=store.snapshot().unwrap();
    store.commit_current(before.revision,&b.id,&"a".repeat(48)).unwrap();
    let reconnect=spec.clone();
    assert_eq!(reconnect.args,vec!["desktop","--profile-dir",a.directory().to_str().unwrap(),"--mode","prepare"]);
    assert_ne!(reconnect.args[2],b.directory().to_str().unwrap());
    assert_eq!(fixture("echo").args.len(),2);
}

#[tokio::test]
async fn zero_byte_backpressure_preserves_unsent_cancellation_and_deadline() {
    for deadline in [false, true] {
        let (mut writer, mut reader) = tokio::io::duplex(1);
        writer.write_all(b"x").await.unwrap();
        let phase = Arc::new(StdMutex::new(RequestPhase::Queued));
        let guard = CancelUnsent(phase.clone(), Arc::new(Notify::new()));
        let mut frame = Outgoing {
            id: "test".into(),
            bytes: b"request\n".to_vec(),
            written: 0,
        };
        let frozen = AtomicBool::new(false);
        let at = Instant::now() + Duration::from_secs(5);
        assert!(timeout(
            Duration::from_millis(20),
            write_step(&mut writer, &mut frame, &phase, at, &frozen, true)
        )
        .await
        .is_err());
        assert_eq!(frame.written, 0);
        assert!(
            *phase.lock().unwrap() == RequestPhase::Queued,
            "pending first write must not become sent"
        );
        let at = if deadline {
            Instant::now()
        } else {
            drop(guard);
            at
        };
        let mut byte = [0];
        reader.read_exact(&mut byte).await.unwrap();
        assert_eq!(&byte, b"x");
        assert!(
            write_step(&mut writer, &mut frame, &phase, at, &frozen, true)
                .await
                .unwrap()
        );
        assert_eq!(frame.written, 0);
        assert!(
            timeout(Duration::from_millis(20), reader.read(&mut byte))
                .await
                .is_err(),
            "canceled request emitted bytes after backpressure lifted"
        );
    }
}

#[tokio::test]
async fn emitted_first_byte_cannot_be_reclassified_as_unsent() {
    let (mut writer, mut reader) = tokio::io::duplex(1);
    let phase = Arc::new(StdMutex::new(RequestPhase::Queued));
    let guard = CancelUnsent(phase.clone(), Arc::new(Notify::new()));
    let frozen = AtomicBool::new(false);
    let mut frame = Outgoing {
        id: "test".into(),
        bytes: b"ab".to_vec(),
        written: 0,
    };
    assert!(!write_step(
        &mut writer,
        &mut frame,
        &phase,
        Instant::now() + Duration::from_secs(1),
        &frozen,
        true
    )
    .await
    .unwrap());
    drop(guard);
    assert!(*phase.lock().unwrap() == RequestPhase::Sent);
    assert_eq!(frame.written, 1);
    let mut byte = [0];
    reader.read_exact(&mut byte).await.unwrap();
    assert_eq!(&byte, b"a");
}

async fn controlled_bridge(
    config: Value,
    mode: &str,
) -> (tempfile::TempDir, Bridge, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let control = dir.path().join("control.json");
    std::fs::write(&control, serde_json::to_vec(&config).unwrap()).unwrap();
    let mut spec = fixture(mode);
    spec.args
        .push(dir.path().join("pid").to_string_lossy().into_owned());
    spec.args.push(control.to_string_lossy().into_owned());
    let bridge = Bridge::start(spec);
    wait(&bridge, BridgePhase::Ready).await;
    (dir, bridge, control)
}
async fn observed_requests(control: &std::path::Path, count: usize) -> Vec<Value> {
    timeout(Duration::from_secs(2), async {
        loop {
            let raw = std::fs::read_to_string(control.with_extension("json.requests"))
                .unwrap_or_default();
            let values: Vec<Value> = raw
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            if values.len() >= count {
                return values;
            }
            tokio::task::yield_now().await
        }
    })
    .await
    .expect("child did not receive expected request frames")
}

#[tokio::test]
async fn shared_barrier_fences_later_platform_on_owned_pipe() {
    let (_dir, bridge, control) =
        controlled_bridge(serde_json::json!({"slow":"openai"}), "parallel-reads").await;
    let b = bridge.clone();
    let slow = tokio::spawn(async move {
        b.request(
            "account_snapshot",
            serde_json::json!({"platform":"openai","refresh":false}),
            Duration::from_secs(5),
        )
        .await
    });
    observed_requests(&control, 1).await;
    let b = bridge.clone();
    let barrier = tokio::spawn(async move { b.ping().await });
    timeout(Duration::from_secs(2), async {
        while bridge.0.capacity.available_permits() != 14 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("barrier was not admitted");
    let b = bridge.clone();
    let fast = tokio::spawn(async move {
        b.request(
            "account_snapshot",
            serde_json::json!({"platform":"claude","refresh":false}),
            Duration::from_secs(5),
        )
        .await
    });
    sleep(Duration::from_millis(30)).await;
    assert_eq!(observed_requests(&control, 1).await.len(), 1);
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    slow.await.unwrap().unwrap();
    barrier.await.unwrap().unwrap();
    fast.await.unwrap().unwrap();
    let calls = observed_requests(&control, 3).await;
    assert_eq!(calls[1]["method"], "ping");
    assert_eq!(calls[2]["params"]["platform"], "claude");
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn canceled_waiters_release_total_budget_without_sending() {
    let (_dir, bridge, control) =
        controlled_bridge(serde_json::json!({"slow":"openai"}), "parallel-reads").await;
    let b = bridge.clone();
    let slow = tokio::spawn(async move {
        b.request(
            "account_snapshot",
            serde_json::json!({"platform":"openai","refresh":false}),
            Duration::from_secs(5),
        )
        .await
    });
    observed_requests(&control, 1).await;
    let mut queued = Vec::new();
    for _ in 0..15 {
        let b = bridge.clone();
        queued.push(tokio::spawn(async move {
            b.supply_status(SupplyPlatform::Openai).await
        }));
    }
    timeout(Duration::from_secs(1), async {
        while bridge.0.capacity.available_permits() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(bridge.ping().await.unwrap_err().code, "REQUEST_NOT_QUEUED");
    for handle in queued {
        handle.abort();
        let _ = handle.await;
    }
    timeout(Duration::from_secs(1), async {
        while bridge.0.capacity.available_permits() != 15 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancelled queue did not promptly release admission budget");
    let fast = bridge
        .request(
            "account_snapshot",
            serde_json::json!({"platform":"claude","refresh":false}),
            Duration::from_secs(1),
        )
        .await
        .unwrap();
    assert_eq!(fast.result["platform"], "claude");
    assert_eq!(observed_requests(&control, 2).await.len(), 2);
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    slow.await.unwrap().unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn invalid_concurrent_replies_revoke_owned_session() {
    for fault in ["unknown", "old", "instance", "duplicate"] {
        let (_dir, bridge, control) = controlled_bridge(
            serde_json::json!({"slow":"openai","fault":fault}),
            "parallel-reads",
        )
        .await;
        let b = bridge.clone();
        let slow =
            tokio::spawn(async move { b.account_snapshot(SupplyPlatform::Openai, false).await });
        observed_requests(&control, 1).await;
        let result = bridge
            .request(
                "account_snapshot",
                serde_json::json!({"platform":"claude","refresh":false}),
                Duration::from_secs(2),
            )
            .await;
        if fault != "duplicate" {
            assert!(result.is_err());
        }
        let failed = wait(&bridge, BridgePhase::Failed).await;
        assert_eq!(
            failed.error.unwrap().code,
            if fault == "instance" {
                "INSTANCE_MISMATCH"
            } else {
                "UNEXPECTED_REPLY"
            }
        );
        assert!(slow.await.unwrap().is_err());
        assert!(bridge.ping().await.is_err());
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn sent_deadline_and_abandoned_caller_preserve_live_session() {
    for abandon in [false, true] {
        let (_dir, bridge, control) =
            controlled_bridge(serde_json::json!({"slow":"openai"}), "parallel-reads").await;
        let b = bridge.clone();
        let slow = tokio::spawn(async move {
            b.request(
                "account_detect",
                serde_json::json!({"platform":"openai"}),
                Duration::from_millis(200),
            )
            .await
        });
        observed_requests(&control, 1).await;
        bridge
            .request(
                "account_snapshot",
                serde_json::json!({"platform":"claude","refresh":false}),
                Duration::from_secs(1),
            )
            .await
            .unwrap();
        if abandon {
            slow.abort();
            let _ = slow.await;
        } else {
            assert_eq!(slow.await.unwrap().unwrap_err().code, "RESPONSE_TIMEOUT");
        }
        sleep(Duration::from_millis(250)).await;
        assert_eq!(bridge.status().state, BridgePhase::Ready);
        assert_eq!(bridge.0.capacity.available_permits(), 15);
        std::fs::write(control.with_extension("json.release"), b"release").unwrap();
        bridge.ping().await.unwrap();
        // Ping may overtake the abandoned account read. Wait for that original
        // response to release its permit instead of assuming response order.
        timeout(Duration::from_secs(2), async {
            while bridge.0.capacity.available_permits() != 16 {
                tokio::task::yield_now().await;
            }
        }).await.expect("original account read did not release capacity");
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn owned_exit_joins_both_reads_and_rejects_queued_write() {
    let (_dir, bridge, control) =
        controlled_bridge(serde_json::json!({"holdBoth":true}), "owned-exit-parallel").await;
    let b = bridge.clone();
    let one = tokio::spawn(async move {
        b.request(
            "account_snapshot",
            serde_json::json!({"platform":"openai","refresh":false}),
            Duration::from_secs(5),
        )
        .await
    });
    let b = bridge.clone();
    let two = tokio::spawn(async move {
        b.request(
            "account_snapshot",
            serde_json::json!({"platform":"claude","refresh":false}),
            Duration::from_secs(5),
        )
        .await
    });
    observed_requests(&control, 2).await;
    let b = bridge.clone();
    let write =
        tokio::spawn(async move { b.supply_set_paused(SupplyPlatform::Openai, false).await });
    timeout(Duration::from_secs(2), async {
        while bridge.0.capacity.available_permits() != 13 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("write was not admitted");
    let b = bridge.clone();
    let exiting = tokio::spawn(async move {
        b.prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
            .await
    });
    timeout(Duration::from_secs(2), async {
        while !bridge.0.frozen.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned exit did not freeze admission");
    exiting.abort();
    let _ = exiting.await;
    assert_eq!(write.await.unwrap().unwrap_err().code, "OWNED_EXIT_PENDING");
    assert_eq!(observed_requests(&control, 2).await.len(), 2);
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    one.await.unwrap().unwrap();
    two.await.unwrap().unwrap();
    assert!(
        bridge
            .prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
            .await
            .unwrap()
            .child_reaped
    );
}

#[tokio::test]
async fn owned_exit_reclaims_full_budget_before_internal_requests() {
    let (_dir, bridge, control) =
        controlled_bridge(serde_json::json!({"holdBoth":true}), "owned-exit-parallel").await;
    let mut reads = Vec::new();
    for platform in ["openai", "claude"] {
        let b = bridge.clone();
        reads.push(tokio::spawn(async move {
            b.request(
                "account_snapshot",
                serde_json::json!({"platform":platform,"refresh":false}),
                Duration::from_secs(8),
            )
            .await
        }));
    }
    observed_requests(&control, 2).await;
    let mut queued = Vec::new();
    for _ in 0..14 {
        let b = bridge.clone();
        queued.push(tokio::spawn(async move {
            b.supply_set_paused(SupplyPlatform::Openai, false).await
        }));
    }
    timeout(Duration::from_secs(2), async {
        while bridge.0.capacity.available_permits() != 0 || bridge.0.requests.lock().unwrap().capacity() != 16 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("requests did not fill the internal waiting budget");
    let b = bridge.clone();
    let exiting = tokio::spawn(async move {
        b.prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
            .await
    });
    let rejected = timeout(Duration::from_secs(2), async {
        let mut errors = Vec::new();
        for request in queued {
            errors.push(request.await.unwrap().unwrap_err().code);
        }
        errors
    })
    .await;
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    let receipt = exiting.await.unwrap();
    for read in reads {
        let _ = read.await;
    }
    let rejected = rejected.expect("freezing did not release ordinary waiting requests");
    assert!(
        rejected.iter().all(|code| code == "OWNED_EXIT_PENDING"),
        "frozen waiting results: {rejected:?}"
    );
    assert!(
        receipt
            .expect("owned exit must wait within its existing deadline for budget reclamation")
            .intent_saved
    );
}

#[tokio::test]
async fn platform_reads_bypass_same_platform_waiters_on_owned_pipe() {
    for (slow, fast) in [("openai", "claude"), ("claude", "openai")] {
        let dir = tempfile::tempdir().unwrap();
        let control = dir.path().join("control.json");
        std::fs::write(
            &control,
            serde_json::to_vec(&serde_json::json!({"slow":slow})).unwrap(),
        )
        .unwrap();
        let mut spec = fixture("parallel-reads");
        spec.args
            .push(dir.path().join("pid").to_string_lossy().into_owned());
        spec.args.push(control.to_string_lossy().into_owned());
        let bridge = Bridge::start(spec);
        wait(&bridge, BridgePhase::Ready).await;
        let b = bridge.clone();
        let first = tokio::spawn(async move {
            b.request(
                "account_snapshot",
                serde_json::json!({"platform":slow,"refresh":false}),
                Duration::from_secs(5),
            )
            .await
        });
        let requests = control.with_extension("json.requests");
        timeout(Duration::from_secs(2), async {
            while !requests.exists() {
                tokio::task::yield_now().await
            }
        })
        .await
        .unwrap();
        let b = bridge.clone();
        let same = tokio::spawn(async move {
            b.request(
                "supply_status",
                serde_json::json!({"platform":slow}),
                Duration::from_millis(400),
            )
            .await
        });
        tokio::task::yield_now().await;
        let result = timeout(
            Duration::from_millis(250),
            bridge.request(
                "account_snapshot",
                serde_json::json!({"platform":fast,"refresh":false}),
                Duration::from_secs(3),
            ),
        )
        .await;
        let arrived_before_release = result.is_ok();
        if let Ok(ref reply) = result {
            assert_eq!(reply.as_ref().unwrap().result["platform"], fast);
        }
        let queued = same.await.unwrap().unwrap_err();
        std::fs::write(control.with_extension("json.release"), b"release").unwrap();
        first.await.unwrap().unwrap();
        assert_eq!(bridge.status().state, BridgePhase::Ready);
        bridge.stop().await.unwrap();
        assert_eq!(queued.code, "REQUEST_QUEUE_TIMEOUT");
        assert!(
            arrived_before_release,
            "fast platform did not reply before controlled slow platform release"
        );
    }
}

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
                Duration::from_millis(250),
            )
            .await
    });
    sleep(Duration::from_millis(20)).await;
    let began = Instant::now();
    let cause = bridge
        .request(
            "account_snapshot",
            serde_json::json!({"platform":"openai","refresh":false}),
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
    assert!(
        !cause.message.contains("MARKER"),
        "raw stderr leaked into public native status"
    );
    assert!(!serde_json::to_string(&bridge.status())
        .unwrap()
        .contains("MARKER"));
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

fn native_spec() -> LaunchSpec {
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
    LaunchSpec {
        program: binary,
        bundle: None,
        args: vec!["desktop".into()],
        source,
        timeout: Duration::from_secs(3),
    }
}

#[tokio::test]
async fn native_go_management_binary_can_handshake_ping_and_stop() {
    let bridge = Bridge::start(native_spec());
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
async fn unanswered_ping_preserves_ready_and_stop_waits_for_reaping() {
    let mut spec = fixture("ping-timeout");
    spec.timeout = Duration::from_millis(400);
    let bridge = Bridge::start(spec);
    wait(&bridge, BridgePhase::Ready).await;
    let error = bridge.ping().await.unwrap_err();
    assert_eq!(error.code, "RESPONSE_TIMEOUT");
    assert_eq!(
        bridge.status().state,
        BridgePhase::Ready,
        "reply timeout must preserve live owned child"
    );
    assert!(bridge.status().metadata.is_some());
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
#[ignore = "requires a freshly built signed Bee.app; set BEE_TEST_APP_BUNDLE for a release candidate"]
async fn signed_app_bee_handshakes_pings_and_reaps_without_gui_or_path_lookup() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let bundle = std::env::var_os("BEE_TEST_APP_BUNDLE")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("target/debug/bundle/macos/Bee.app"));
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
    crate::lifecycle::shutdown_owned(&bridge, None, || {
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
        .manage(crate::experience::StartupGate::verified())
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
        .manage(crate::preferences::PreferencesStore::new(
            std::env::temp_dir().join(format!(
                "bee-s2-command-preferences-{}.json",
                std::process::id()
            )),
        ))
        .manage(crate::network::NetworkController::default())
        .manage(crate::diagnostics_native::NativeDiagnostics::new(
            std::env::temp_dir().join(format!("bee-s2-command-logs-{}", std::process::id())),
        ))
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
        "runtime_enable_presence",
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

#[tokio::test]
async fn device_recovery_methods_keep_fixed_contract_and_startup_hold_exit_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("recovery.json");
    std::fs::write(&marker, "{}").unwrap();
    let mut spec = fixture("startup-recovery");
    spec.args
        .extend(["".into(), marker.to_string_lossy().to_string()]);
    let bridge = Bridge::start(spec);
    wait(&bridge, BridgePhase::Ready).await;
    bridge.0.startup_verified.store(false, Ordering::SeqCst);
    assert_eq!(
        bridge.device_recovery_prepare().await.unwrap().result["recovery"]["phase"],
        "awaiting_confirmation"
    );
    let request = protocol::DeviceRecoveryConfirm {
        operation_id: "a".repeat(48),
        expected_revision: 1,
        decision: "begin_pairing".into(),
    };
    bridge.device_recovery_confirm(request).await.unwrap();
    bridge.device_recovery_status().await.unwrap();
    let invalid = protocol::DeviceRecoveryConfirm {
        operation_id: "a".repeat(48),
        expected_revision: 0,
        decision: "begin_pairing".into(),
    };
    assert_eq!(
        bridge
            .device_recovery_confirm(invalid)
            .await
            .unwrap_err()
            .code,
        "DEVICE_RECOVERY_REQUEST_INVALID"
    );
    bridge.0.frozen.store(true, Ordering::SeqCst);
    assert_eq!(
        bridge.device_recovery_prepare().await.unwrap_err().code,
        "OWNED_EXIT_PENDING"
    );
    bridge.0.frozen.store(false, Ordering::SeqCst);
    std::fs::write(marker, r#"{"recovery_extra":true}"#).unwrap();
    assert_eq!(
        bridge.device_recovery_status().await.unwrap_err().code,
        "DEVICE_RECOVERY_INVALID"
    );
    bridge.stop().await.unwrap();
    assert!(bridge.device_recovery_status().await.is_err());
}

#[path = "sidecar_native_concurrency_tests.rs"]
mod native_concurrency;

#[tokio::test]
async fn unsent_waiters_keep_the_sent_request_terminal_evidence() {
    let (_dir, bridge, control) =
        controlled_bridge(serde_json::json!({"slow":"openai"}), "parallel-reads").await;
    let b = bridge.clone();
    let sent = tokio::spawn(async move { b.account_snapshot(SupplyPlatform::Openai, false).await });
    observed_requests(&control, 1).await;
    let b = bridge.clone();
    let queued = tokio::spawn(async move { b.ping().await });
    timeout(Duration::from_secs(1), async {
        while bridge.0.capacity.available_permits() != 14 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let cause = BridgeError::with_details("PIPE_READ_FAILED", "read owned stdout: fixture pipe error 13".into(), serde_json::from_value(serde_json::json!({"check":"pipe_read","observed_at":"2026-10-30T12:00:00Z","evidence":{"actual":"read returned error 13","required":"complete reply"}})).unwrap()).unwrap();
    bridge
        .0
        .status_tx
        .send_replace(status(BridgePhase::Failed, None, Some(cause.clone())));
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    let sent_error = sent.await.unwrap().unwrap_err();
    let unsent_error = queued.await.unwrap().unwrap_err();
    assert_eq!(sent_error, cause);
    assert_eq!(unsent_error.code, "REQUEST_NOT_SENT");
    assert!(
        unsent_error.message.contains(&cause.message),
        "missing cause: {}",
        unsent_error.message
    );
    assert_eq!(unsent_error.details, cause.details);
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn unsent_mpsc_requests_keep_terminal_evidence() {
    let mut spec = fixture("timeout");
    spec.timeout = Duration::from_millis(150);
    let bridge = Bridge::start(spec);
    let (reply, receive) = oneshot::channel();
    let sender=bridge.0.requests.lock().unwrap().clone();
    sender.send(Request {
            exit_request: false,
            method: "ping",
            params: serde_json::json!({}),
            deadline: Instant::now() + Duration::from_secs(5),
            queued_at: Instant::now(),
            started_at: None,
            duration: Duration::from_secs(5),
            timed_out: false,
            phase: Arc::new(StdMutex::new(RequestPhase::Queued)),
            _permit: bridge.0.capacity.clone().acquire_owned().await.unwrap(),
            reply: Some(reply),
        })
        .await
        .unwrap();
    let unsent = receive.await.unwrap().unwrap_err();
    let cause = bridge.status().error.unwrap();
    assert_eq!(unsent.code, "REQUEST_NOT_SENT");
    assert!(
        unsent.message.contains(&cause.code),
        "missing code: {}",
        unsent.message
    );
    assert!(
        unsent.message.contains(&cause.message),
        "missing cause: {}",
        unsent.message
    );
    bridge.stop().await.unwrap();
}

#[test]
fn unsent_error_preserves_safe_details_and_enforces_public_limits() {
    let details: protocol::FailureDetails = serde_json::from_value(serde_json::json!({"check":"pipe_read","observed_at":"2026-10-30T12:00:00Z","evidence":{"actual":"fixture error 13"}})).unwrap();
    let mut cause =
        BridgeError::with_details("PIPE_READ_FAILED", "界".repeat(10922), details.clone()).unwrap();
    let bounded = request_not_sent("ping", &cause);
    assert!(bounded.message.len() <= 32768);
    assert!(bounded
        .message
        .contains("cause text truncated; actual bytes="));
    assert_eq!(bounded.details, Some(details.clone()));
    let decoded: BridgeError =
        serde_json::from_value(serde_json::to_value(&bounded).unwrap()).unwrap();
    assert_eq!(decoded, bounded);
    cause.message = "Bearer TEST_SECRET".into();
    let safe = request_not_sent("ping", &cause);
    assert!(!safe.message.contains("TEST_SECRET"));
    assert!(safe.message.contains("unsafe cause text omitted"));
    assert_eq!(safe.details, Some(details));
    cause
        .details
        .as_mut()
        .unwrap()
        .evidence
        .insert("token".into(), "TEST_SECRET".into());
    let invalid = request_not_sent("ping", &cause);
    assert_eq!(invalid.details, None);
    assert!(invalid.message.contains("cause details rejected"));
    assert!(!serde_json::to_string(&invalid)
        .unwrap()
        .contains("TEST_SECRET"));
}

#[tokio::test]
async fn execution_budget_starts_after_same_platform_queue_wait() {
    let (_dir, bridge, control) = controlled_bridge(
        serde_json::json!({"slow":"openai", "delay":100}),
        "parallel-reads",
    )
    .await;
    let b = bridge.clone();
    let first = tokio::spawn(async move {
        b.request(
            "account_snapshot",
            serde_json::json!({"platform":"openai"}),
            Duration::from_secs(1),
        )
        .await
    });
    observed_requests(&control, 1).await;
    let b = bridge.clone();
    let second = tokio::spawn(async move {
        b.request(
            "supply_status",
            serde_json::json!({"platform":"openai"}),
            Duration::from_millis(250),
        )
        .await
    });
    sleep(Duration::from_millis(100)).await;
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    first.await.unwrap().unwrap();
    second
        .await
        .unwrap()
        .expect("queue time consumed the execution budget");
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn timed_out_original_is_queryable_until_settled_without_business_payload() {
    for fail in [false, true] {
        let (_dir, bridge, control) = controlled_bridge(
            serde_json::json!({"slow":"openai", "businessFailure": fail}),
            "parallel-reads",
        )
        .await;
        let instance = bridge.status().metadata.unwrap().instance;
        let pid = std::fs::read_to_string(_dir.path().join("pid")).unwrap();
        let mut settled = bridge.subscribe_settled();
        let cause = bridge
            .request(
                "account_snapshot",
                serde_json::json!({"platform":"openai"}),
                Duration::from_millis(100),
            )
            .await
            .unwrap_err();
        assert_eq!(cause.code, "RESPONSE_TIMEOUT");
        assert_eq!(bridge.status().metadata.unwrap().instance, instance);
        #[cfg(unix)]
        assert!(std::process::Command::new("/bin/kill").args(["-0", &pid]).status().unwrap().success(), "original owned PID={pid} exited after request timeout");
        let details = cause.details.unwrap();
        details
            .validate()
            .expect("timeout evidence must match strict wire contract");
        let pending = serde_json::to_value(bridge.pending_requests()).unwrap();
        assert_eq!(
            pending,
            serde_json::json!({"instance":instance,"requests":[{"id":"shell-2","method":"account_snapshot","platform":"openai"}]})
        );
        assert_eq!(details.evidence["request_id"], "shell-2");
        assert_eq!(details.evidence["fully_sent"], "true");
        assert_eq!(details.evidence["in_flight"], "true");
        assert_eq!(details.evidence["phase"], "response");
        std::fs::write(control.with_extension("json.release"), b"release").unwrap();
        let event = timeout(Duration::from_secs(2), settled.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({"instance":instance,"id":"shell-2","method":"account_snapshot","platform":"openai"})
        );
        assert!(bridge.pending_requests().requests.is_empty());
        bridge.ping().await.unwrap();
        assert_eq!(bridge.status().metadata.unwrap().instance, instance);
        assert_eq!(std::fs::read_to_string(_dir.path().join("pid")).unwrap(), pid);
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn late_reply_still_rejects_forged_duplicate_and_cross_instance_frames() {
    for fault in ["unknown", "duplicate", "old", "instance"] {
        let (_dir, bridge, control) = controlled_bridge(
            serde_json::json!({"slow":"openai", "fault":fault}),
            "parallel-reads",
        )
        .await;
        assert_eq!(
            bridge
                .request(
                    "account_snapshot",
                    serde_json::json!({"platform":"openai"}),
                    Duration::from_millis(100)
                )
                .await
                .unwrap_err()
                .code,
            "RESPONSE_TIMEOUT"
        );
        std::fs::write(control.with_extension("json.release"), b"release").unwrap();
        let failed = wait(&bridge, BridgePhase::Failed).await;
        assert_eq!(
            failed.error.unwrap().code,
            if fault == "instance" {
                "INSTANCE_MISMATCH"
            } else {
                "UNEXPECTED_REPLY"
            }
        );
        assert!(bridge.pending_requests().requests.is_empty());
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn partial_frame_survives_deadline_and_caller_drop_and_finishes_exactly_once() {
    let (mut writer, mut reader) = tokio::io::duplex(1);
    let phase = Arc::new(StdMutex::new(RequestPhase::Queued));
    let guard = CancelUnsent(phase.clone(), Arc::new(Notify::new()));
    let frozen = AtomicBool::new(false);
    let mut frame = Outgoing {
        id: "shell-2".into(),
        bytes: b"abc\n".to_vec(),
        written: 0,
    };
    assert!(!write_step(
        &mut writer,
        &mut frame,
        &phase,
        Instant::now() + Duration::from_secs(1),
        &frozen,
        true
    )
    .await
    .unwrap());
    drop(guard);
    frozen.store(true, Ordering::SeqCst);
    let reading = tokio::spawn(async move {
        let mut bytes = [0; 4];
        reader.read_exact(&mut bytes).await.unwrap();
        bytes
    });
    while !write_step(
        &mut writer,
        &mut frame,
        &phase,
        Instant::now() - Duration::from_secs(1),
        &frozen,
        true,
    )
    .await
    .unwrap()
    {}
    assert_eq!(reading.await.unwrap(), *b"abc\n");
    assert_eq!(frame.written, 4);
}

#[test]
fn retry_evidence_contract_rejects_noncanonical_and_unbounded_values() {
    let evidence = serde_json::json!({"request_id":"shell-42","method":"supply_status","platform":"openai","phase":"response","queue_ms":"0","execution_ms":"15000","fully_sent":"true","in_flight":"true","retry_after_seconds":"2147483647","elapsed_ms":"1","failure_kind":"timeout"});
    let details = |evidence: Value| serde_json::json!({"check":"bridge_request_deadline","observed_at":"2026-10-30T12:00:00Z","evidence":evidence});
    serde_json::from_value::<protocol::FailureDetails>(details(evidence.clone()))
        .expect("valid retry evidence");
    assert_eq!(
        crate::diagnostic_log::sanitize_evidence(
            &serde_json::from_value(evidence.clone()).unwrap()
        ),
        serde_json::from_value(evidence.clone()).unwrap()
    );
    for (key, bad) in [
        ("request_id", "shell-01"),
        ("request_id", "arbitrary-secret"),
        ("method", "DELETE"),
        ("method", "supply_status;secret"),
        ("platform", "other"),
        ("phase", "other"),
        ("queue_ms", "01"),
        ("execution_ms", "9007199254740992"),
        ("fully_sent", "1"),
        ("in_flight", "yes"),
        ("retry_after_seconds", "2147483648"),
        ("elapsed_ms", "-1"),
        ("failure_kind", "arbitrary-text"),
    ] {
        let mut invalid = evidence.clone();
        invalid[key] = serde_json::json!(bad);
        assert!(
            serde_json::from_value::<protocol::FailureDetails>(details(invalid)).is_err(),
            "accepted {key}={bad}"
        );
        let mut fields = std::collections::BTreeMap::new();
        fields.insert(key.into(), bad.into());
        assert!(
            crate::diagnostic_log::sanitize_evidence(&fields).is_empty(),
            "logged unsafe {key}={bad}"
        );
    }
    for method in ["GET", "POST", "PUT"] {
        let mut http = evidence.clone();
        http["method"] = serde_json::json!(method);
        http["phase"] = serde_json::json!("http_error");
        serde_json::from_value::<protocol::FailureDetails>(details(http)).unwrap();
    }
}

#[tokio::test]
async fn late_account_payload_must_pass_original_method_validation() {
    let (_dir, bridge, control) = controlled_bridge(
        serde_json::json!({"slow":"openai","invalidAccount":true}),
        "parallel-reads",
    )
    .await;
    assert_eq!(
        bridge
            .request(
                "account_snapshot",
                serde_json::json!({"platform":"openai"}),
                Duration::from_millis(100)
            )
            .await
            .unwrap_err()
            .code,
        "RESPONSE_TIMEOUT"
    );
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    let failed = timeout(Duration::from_secs(2), wait(&bridge, BridgePhase::Failed))
        .await
        .expect("late invalid method result was accepted");
    assert_eq!(failed.error.unwrap().code, "ACCOUNT_REPLY_INVALID");
    bridge.stop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn pending_command_bypasses_business_queue_and_timeout_events_persist_safely() {
    let (dir, bridge, control) =
        controlled_bridge(serde_json::json!({"slow":"openai"}), "parallel-reads").await;
    let mut events = bridge.subscribe_diagnostics();
    let cause = bridge
        .request(
            "account_snapshot",
            serde_json::json!({"platform":"openai"}),
            Duration::from_millis(100),
        )
        .await
        .unwrap_err();
    assert_eq!(cause.code, "RESPONSE_TIMEOUT");
    let app = tauri::test::mock_builder()
        .manage(bridge.clone())
        .invoke_handler(tauri::generate_handler![
            crate::commands::bridge_pending_requests
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let response = tauri::test::get_ipc_response(
        &view,
        tauri::webview::InvokeRequest {
            cmd: "bridge_pending_requests".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(serde_json::json!({})),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .unwrap()
    .deserialize::<Value>()
    .unwrap();
    assert_eq!(response["requests"].as_array().unwrap().len(), 1);
    assert_eq!(
        observed_requests(&control, 1).await.len(),
        1,
        "local pending read entered owned pipe"
    );
    let diagnostics =
        crate::diagnostics_native::NativeDiagnostics::new(dir.path().join("safe-logs"));
    let event = timeout(Duration::from_secs(1), events.recv())
        .await
        .unwrap()
        .unwrap();
    diagnostics.logs.record(event).unwrap();
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    let event = timeout(Duration::from_secs(2), events.recv())
        .await
        .unwrap()
        .unwrap();
    diagnostics.logs.record(event).unwrap();
    let logs = diagnostics.logs.export_entries().unwrap();
    assert_eq!(logs.len(), 2);
    let timed_out = logs
        .iter()
        .find(|event| event.code == "request_timed_out")
        .unwrap();
    let settled = logs
        .iter()
        .find(|event| event.code == "request_settled")
        .unwrap();
    assert_eq!(timed_out.evidence["in_flight"], "true");
    assert_eq!(settled.evidence["in_flight"], "false");
    for event in logs {
        assert_eq!(event.evidence.len(), 8);
        assert!(!event.evidence.contains_key("params"));
    }
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn timed_out_original_retains_shared_barrier_and_total_sixteen_budget() {
    let (_dir, bridge, control) =
        controlled_bridge(serde_json::json!({"slow":"openai"}), "parallel-reads").await;
    assert_eq!(
        bridge
            .request(
                "account_snapshot",
                serde_json::json!({"platform":"openai"}),
                Duration::from_millis(100)
            )
            .await
            .unwrap_err()
            .code,
        "RESPONSE_TIMEOUT"
    );
    bridge
        .request(
            "supply_status",
            serde_json::json!({"platform":"claude"}),
            Duration::from_secs(1),
        )
        .await
        .unwrap();
    let b = bridge.clone();
    let write =
        tokio::spawn(async move { b.supply_set_paused(SupplyPlatform::Openai, true).await });
    timeout(Duration::from_secs(1), async {
        while bridge.0.capacity.available_permits() != 14 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut queued = Vec::new();
    for _ in 0..14 {
        let b = bridge.clone();
        queued.push(tokio::spawn(async move {
            b.supply_status(SupplyPlatform::Claude).await
        }));
    }
    timeout(Duration::from_secs(1), async {
        while bridge.0.capacity.available_permits() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(bridge.ping().await.unwrap_err().code, "REQUEST_NOT_QUEUED");
    assert_eq!(bridge.pending_requests().requests.len(), 1);
    sleep(Duration::from_millis(50)).await;
    assert_eq!(
        observed_requests(&control, 2).await.len(),
        2,
        "queued reads bypassed write barrier after timeout"
    );
    for task in queued {
        task.abort();
        let _ = task.await;
    }
    std::fs::write(control.with_extension("json.release"), b"release").unwrap();
    write.await.unwrap().unwrap();
    bridge.ping().await.unwrap();
    let frames = observed_requests(&control, 4).await;
    assert_eq!(
        frames
            .iter()
            .filter(|v| v["method"] == "supply_set_paused")
            .count(),
        1
    );
    assert_eq!(
        frames
            .iter()
            .filter(|v| v["method"] == "account_snapshot")
            .count(),
        1
    );
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn late_nested_business_failures_settle_without_killing_owned_session() {
    let (_dir, bridge, control) = controlled_bridge(serde_json::json!({}), "parallel-reads").await;
    let mut settled = bridge.subscribe_settled();
    for (method, code, binding_revision) in [
        ("device_recovery_prepare", "DEVICE_RECOVERY_FAILED", None),
        ("device_recovery_confirm", "http_rejected", None),
        ("device_recovery_status", "timeout", None),
        ("network_status", "NETWORK_OPERATION_FAILED", None),
        ("network_test", "NETWORK_OPERATION_FAILED", None),
        ("diagnostics_start", "DIAGNOSTICS_OPERATION_FAILED", None),
        ("diagnostics_snapshot", "DIAGNOSTICS_OPERATION_FAILED", None),
        ("diagnostics_cancel", "DIAGNOSTICS_OPERATION_FAILED", None),
        (
            "notification_snapshot",
            "NOTIFICATIONS_OPERATION_FAILED",
            None,
        ),
        ("device_context", "DEVICE_CONTEXT_FAILED", None),
        ("device_context", "DEVICE_CONTEXT_INVALID", Some(7)),
    ] {
        let mut failure = serde_json::json!({"error":{"code":code,"message":"read failed: fixture HTTP 503","details":{"check":"late_read","observed_at":"2026-10-30T12:00:00Z","evidence":{"http_status":"503"}}}});
        if let Some(revision) = binding_revision {
            failure["binding_revision"] = serde_json::json!(revision);
        }
        std::fs::write(
            &control,
            serde_json::to_vec(&serde_json::json!({"holdMethod":method,"nestedFailure":failure}))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            bridge
                .request(method, serde_json::json!({}), Duration::from_millis(100))
                .await
                .unwrap_err()
                .code,
            "RESPONSE_TIMEOUT"
        );
        assert_eq!(bridge.pending_requests().requests.len(), 1);
        std::fs::write(control.with_extension("json.release"), b"release").unwrap();
        let event = timeout(Duration::from_secs(2), settled.recv())
            .await
            .unwrap_or_else(|_| {
                panic!("legal nested {method} failure killed the session or did not settle")
            })
            .unwrap();
        assert_eq!(event.method, method);
        assert_eq!(
            bridge.status().state,
            BridgePhase::Ready,
            "nested failure {method} changed owned lifecycle"
        );
        assert!(bridge.pending_requests().requests.is_empty());
        std::fs::remove_file(control.with_extension("json.release")).unwrap();
        bridge.ping().await.unwrap();
    }
    bridge.stop().await.unwrap();
}

async fn request_for_late_validation(method: &'static str) -> Request {
    let (reply, _receive) = oneshot::channel();
    Request {
        exit_request: false,
        method,
        params: serde_json::json!({}),
        deadline: Instant::now() + Duration::from_secs(15),
        queued_at: Instant::now(),
        started_at: Some(Instant::now()),
        duration: Duration::from_secs(15),
        timed_out: true,
        phase: Arc::new(StdMutex::new(RequestPhase::Sent)),
        _permit: Arc::new(Semaphore::new(1)).acquire_owned().await.unwrap(),
        reply: Some(reply),
    }
}

#[tokio::test]
async fn late_nested_failure_validation_preserves_closed_method_contracts() {
    for method in [
        "device_recovery_prepare",
        "network_status",
        "network_test",
        "diagnostics_snapshot",
        "notification_snapshot",
        "device_context",
    ] {
        let request = request_for_late_validation(method).await;
        let code = match method {
            "diagnostics_snapshot" => "DIAGNOSTICS_OPERATION_FAILED",
            "notification_snapshot" => "NOTIFICATIONS_OPERATION_FAILED",
            _ => "DEVICE_RECOVERY_FAILED",
        };
        let failure = serde_json::json!({"error":{"code":code,"message":"fixture failure"}});
        assert!(
            validate_method_result(&request, &failure, &"f".repeat(32)).is_ok(),
            "valid failure rejected for {method}"
        );
        for invalid in [
            serde_json::json!({"error":{"code":"bad-code!","message":"fixture failure"}}),
            serde_json::json!({"error":{"code":code,"message":"fixture failure","extra":true}}),
            serde_json::json!({"error":{"code":code,"message":"fixture failure"},"extra":true}),
            serde_json::json!({"error":{"code":code,"message":"fixture failure","details":{"check":"late_read","observed_at":"2026-10-30T12:00:00Z","evidence":{"token":"PRIVATE"}}}}),
            serde_json::json!({"error":{"code":code,"message":""}}),
        ] {
            assert!(
                validate_method_result(&request, &invalid, &"f".repeat(32)).is_err(),
                "invalid nested {method} failure accepted"
            );
        }
        if ["diagnostics_snapshot", "notification_snapshot"].contains(&method) {
            for invalid in [
                serde_json::json!({"error":{"code":"OTHER_VALID_CODE","message":"fixture failure"}}),
                serde_json::json!({"error":{"code":code,"message":"x".repeat(1025)}}),
            ] {
                assert!(
                    validate_method_result(&request, &invalid, &"f".repeat(32)).is_err(),
                    "method-specific failure restriction bypassed for {method}"
                );
            }
        }
    }
    let request = request_for_late_validation("device_context").await;
    for (code, revision) in [
        ("DEVICE_CONTEXT_INVALID", 0),
        ("DEVICE_CONTEXT_INVALID", 9_007_199_254_740_992u64),
        ("OTHER_VALID_CODE", 7),
    ] {
        assert!(validate_method_result(&request,&serde_json::json!({"error":{"code":code,"message":"fixture failure"},"binding_revision":revision}),&"f".repeat(32)).is_err());
    }
}

#[tokio::test]
async fn late_nested_invalid_failure_variants_still_fail_owned_session() {
    for (method, failure, expected_code) in [
        (
            "network_test",
            serde_json::json!({"error":{"code":"NETWORK_OPERATION_FAILED","message":"fixture failure"},"extra":true}),
            "INVALID_REPLY",
        ),
        (
            "device_recovery_status",
            serde_json::json!({"error":{"code":"invalid-code!","message":"fixture failure"}}),
            "INVALID_REPLY",
        ),
        (
            "diagnostics_snapshot",
            serde_json::json!({"error":{"code":"OTHER_VALID_CODE","message":"fixture failure"}}),
            "DIAGNOSTICS_REPLY_INVALID",
        ),
    ] {
        let (_dir, bridge, control) = controlled_bridge(
            serde_json::json!({"holdMethod":method,"nestedFailure":failure}),
            "parallel-reads",
        )
        .await;
        let mut settled = bridge.subscribe_settled();
        assert_eq!(
            bridge
                .request(method, serde_json::json!({}), Duration::from_millis(100))
                .await
                .unwrap_err()
                .code,
            "RESPONSE_TIMEOUT"
        );
        std::fs::write(control.with_extension("json.release"), b"release").unwrap();
        let failed = timeout(Duration::from_secs(2), wait(&bridge, BridgePhase::Failed))
            .await
            .expect("invalid nested failure was accepted");
        assert_eq!(failed.error.unwrap().code, expected_code);
        assert!(bridge.pending_requests().requests.is_empty());
        assert!(matches!(
            settled.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        bridge.stop().await.unwrap();
    }
}


#[tokio::test]
async fn audit_on_time_invalid_account_reply_fails_session() {
    let (_dir, bridge, _control) =
        controlled_bridge(serde_json::json!({"invalidAccount":true}), "parallel-reads").await;
    let cause = bridge
        .account_snapshot(SupplyPlatform::Openai, false)
        .await
        .unwrap_err();
    assert_eq!(cause.code, "ACCOUNT_REPLY_INVALID");
    let phase = wait(&bridge, BridgePhase::Failed).await.state;
    let ping_ok = bridge.ping().await.is_ok();
    println!(
        "audit invalid reply code={}; phase={:?}; subsequent_ping_ok={}",
        cause.code, phase, ping_ok
    );
    bridge.stop().await.unwrap();
    assert_eq!(
        phase,
        BridgePhase::Failed,
        "an invalid on-time method result must fail closed just like the same late result"
    );
    assert!(!ping_ok, "an invalid session must reject further commands");
}

#[tokio::test]
async fn on_time_business_failures_preserve_evidence_and_keep_session_ready() {
    let (_dir, bridge, control) = controlled_bridge(serde_json::json!({}), "parallel-reads").await;
    for (method, code, binding_revision) in [
        ("device_recovery_prepare", "DEVICE_RECOVERY_FAILED", None),
        ("device_recovery_confirm", "http_rejected", None),
        ("device_recovery_status", "timeout", None),
        ("network_status", "NETWORK_OPERATION_FAILED", None),
        ("network_test", "NETWORK_OPERATION_FAILED", None),
        ("diagnostics_start", "DIAGNOSTICS_OPERATION_FAILED", None),
        ("diagnostics_snapshot", "DIAGNOSTICS_OPERATION_FAILED", None),
        ("diagnostics_cancel", "DIAGNOSTICS_OPERATION_FAILED", None),
        (
            "notification_snapshot",
            "NOTIFICATIONS_OPERATION_FAILED",
            None,
        ),
        ("device_context", "DEVICE_CONTEXT_FAILED", None),
        ("device_context", "DEVICE_CONTEXT_INVALID", Some(7)),
        ("runtime_start", "RUNTIME_OPERATION_FAILED", None),
        ("account_action", "ACCOUNT_OPERATION_FAILED", None),
        ("supply_status", "SUPPLY_OPERATION_FAILED", None),
    ] {
        let mut failure = serde_json::json!({"error":{"code":code,"message":"fixture HTTP 503","details":{"check":"read_check","observed_at":"2026-10-30T12:00:00Z","evidence":{"http_status":"503"}}}});
        if let Some(revision) = binding_revision {
            failure["binding_revision"] = serde_json::json!(revision);
        }
        std::fs::write(
            &control,
            serde_json::to_vec(&serde_json::json!({"nestedFailure":failure})).unwrap(),
        )
        .unwrap();
        let reply = bridge
            .request(
                method,
                serde_json::json!({"platform":"openai"}),
                Duration::from_secs(2),
            )
            .await
            .unwrap();
        assert_eq!(
            reply.result, failure,
            "business failure evidence changed for {method}"
        );
        assert_eq!(bridge.status().state, BridgePhase::Ready);
        bridge.ping().await.unwrap();
    }
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn on_time_invalid_nested_failures_revoke_owned_session() {
    for (method, failure, expected_code) in [
        (
            "network_test",
            serde_json::json!({"error":{"code":"NETWORK_OPERATION_FAILED","message":"fixture failure"},"extra":true}),
            "INVALID_REPLY",
        ),
        (
            "diagnostics_snapshot",
            serde_json::json!({"error":{"code":"OTHER_VALID_CODE","message":"fixture failure"}}),
            "DIAGNOSTICS_REPLY_INVALID",
        ),
        (
            "notification_snapshot",
            serde_json::json!({"error":{"code":"NOTIFICATIONS_OPERATION_FAILED","message":"x".repeat(1025)}}),
            "NOTIFICATION_REPLY_INVALID",
        ),
    ] {
        let (_dir, bridge, _control) = controlled_bridge(
            serde_json::json!({"nestedFailure":failure}),
            "parallel-reads",
        )
        .await;
        let result = bridge
            .request(method, serde_json::json!({}), Duration::from_secs(2))
            .await;
        let status = wait(&bridge, BridgePhase::Failed).await;
        assert!(
            bridge.ping().await.is_err(),
            "invalid {method} session accepted another command"
        );
        bridge.stop().await.unwrap();
        assert_eq!(result.unwrap_err().code, expected_code);
        assert_eq!(status.state, BridgePhase::Failed);
        assert!(bridge.pending_requests().requests.is_empty());
    }
}

#[tokio::test]
async fn explicit_management_reconnect_reaps_old_child_and_respects_exit_freeze() {
    let bridge=Bridge::start(fixture("owned-exit"));
    let mut statuses=bridge.subscribe();
    while statuses.borrow_and_update().state==BridgePhase::Starting {statuses.changed().await.unwrap();}
    bridge.stop().await.unwrap();
    bridge.reconnect().await.unwrap();
    while statuses.borrow_and_update().state==BridgePhase::Starting {statuses.changed().await.unwrap();}
    assert_eq!(bridge.status().state,BridgePhase::Ready);
    assert!(!bridge.0.startup_verified.load(Ordering::SeqCst));
    bridge.freeze_for_exit();
    assert_eq!(bridge.reconnect().await.unwrap_err().code,"OWNED_EXIT_PENDING");
    bridge.stop().await.unwrap();
}
