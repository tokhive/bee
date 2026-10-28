use super::*;
use serde_json::{json, Value};
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};

fn store() -> (PathBuf, NativeDiagnostics) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "bee-runtime-log-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    (path.clone(), NativeDiagnostics::new(path))
}
fn runtime() -> BridgeReply {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../desktopbridge/testdata/runtime-contract.json"
    ))
    .unwrap();
    let mut snapshot = fixture["snapshot"].clone();
    snapshot["local"] = json!("running");
    snapshot["connection"] = json!("connected");
    snapshot["run_id"] = json!("a".repeat(32));
    snapshot["operation"] = json!({"id":"c".repeat(48),"kind":"start","platform":null,"state":"failed","revision":1,"error":{"code":"local_read_failed","check":"runtime","platform":"unknown","message":"Authorization=PRIVATE_RUNTIME_MARKER Cookie=PRIVATE_RUNTIME_MARKER /Users/private/PRIVATE_RUNTIME_MARKER","evidence":{"cause":"PRIVATE_RUNTIME_MARKER"}}});
    for platform in ["openai", "claude"] {
        snapshot["platforms"][platform]["supply"] = json!({"hive":"https://hive.example","device_id":"private-device-id","platform":platform,"paused":false,"ready":true,"reasons":[],"checked_at":snapshot["observed_at"]});
    }
    BridgeReply {
        protocol: 1,
        id: "read-only-observation".into(),
        instance: "b".repeat(32),
        result: json!({"runtime":snapshot}),
    }
}
fn entries(store: &NativeDiagnostics) -> Vec<crate::diagnostic_log::SafeDiagnosticEvent> {
    store
        .page(LogQuery {
            cursor: None,
            limit: 50,
            module: None,
            platform: None,
            level: None,
        })
        .unwrap()
        .entries
}

#[test]
fn diagnostics_native_runtime_logs_validated_safe_facts_without_repeating_identical_reads() {
    let (dir, store) = store();
    let mut reply = runtime();
    store.capture_runtime(&reply).unwrap();
    let first = entries(&store);
    assert!(first
        .iter()
        .any(|e| e.module == "runtime" && e.code == "owned_runtime_connected"));
    assert!(first
        .iter()
        .any(|e| e.module == "network" && e.code == "network_policy_observed"));
    assert!(first
        .iter()
        .any(|e| e.platform.as_deref() == Some("openai") && e.code == "taking_new_work"));
    reply.result["runtime"]["observed_at"] = json!("2026-10-27T04:00:01Z");
    reply.result["runtime"]["revision"] = json!(2);
    store.capture_runtime(&reply).unwrap();
    assert_eq!(entries(&store).len(), first.len());
    reply.result["runtime"]["connection"] = json!("reconnecting");
    store.capture_runtime(&reply).unwrap();
    reply.result["runtime"]["connection"] = json!("connected");
    store.capture_runtime(&reply).unwrap();
    assert_eq!(
        entries(&store)
            .iter()
            .filter(|e| e.code == "owned_runtime_connected")
            .count(),
        2
    );
    reply.instance = "c".repeat(32);
    store.capture_runtime(&reply).unwrap();
    assert_eq!(
        entries(&store)
            .iter()
            .filter(|e| e.code == "owned_runtime_connected")
            .count(),
        3
    );
    let raw = serde_json::to_string(&entries(&store)).unwrap();
    for marker in [
        "private-device-id",
        "hive.example",
        "PRIVATE_RUNTIME_MARKER",
        &"a".repeat(32),
        &"b".repeat(32),
    ] {
        assert!(!raw.contains(marker));
    }
    assert!(
        !String::from_utf8(fs::read(dir.join("diagnostic-0.jsonl")).unwrap())
            .unwrap()
            .contains("PRIVATE_RUNTIME_MARKER")
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn diagnostics_native_runtime_rejects_unknown_dto_without_persisting_untrusted_errors() {
    let (dir, store) = store();
    let mut reply = runtime();
    reply.result["runtime"]["local"] = json!("PRIVATE_STDERR_TOKEN");
    let error = store.capture_runtime(&reply).unwrap_err();
    assert_eq!(error.code, "INVALID_REPLY");
    assert!(!error.message.contains("PRIVATE_STDERR_TOKEN"));
    assert!(entries(&store).is_empty());
    let mut reply = runtime();
    reply.result = json!({"error":{"code":"RUNTIME_OPERATION_FAILED","message":"Authorization=PRIVATE_ERROR_TOKEN /Users/private/path"}});
    store.capture_runtime(&reply).unwrap();
    assert!(entries(&store).is_empty());
    fs::remove_dir_all(dir).unwrap();
}
