use super::*;
use serde_json::json;
use std::{fs, path::PathBuf};

fn store() -> (PathBuf, DiagnosticLogStore) {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "bee-diagnostic-log-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    (path.clone(), DiagnosticLogStore::new(path))
}
fn event() -> serde_json::Value {
    json!({"time":"2026-10-27T03:30:00Z","level":"error","module":"diagnostics","platform":"openai","code":"http_rejected","evidence":{"method":"GET","path":"/api/bee/identity","http_status":"401"}})
}
fn query(limit: u16) -> LogQuery {
    LogQuery {
        cursor: None,
        limit,
        module: None,
        platform: None,
        level: None,
    }
}

#[test]
fn diagnostic_log_persists_only_known_fields_and_values() {
    let (dir, store) = store();
    let mut input = event();
    let marker="Authorization=MARKER-A Cookie=MARKER-C token=MARKER-T confirmation_id=MARKER-I /Users/secret/MARKER-P model input=MARKER-IN output=MARKER-OUT";
    input["message"] = json!(marker);
    input["stderr"] = json!(marker);
    input["evidence"]["cause"] = json!(marker);
    input["evidence"]["path"] = json!(marker);
    input["evidence"]["fingerprint"] = json!("abcdef0123456789".repeat(4));
    input["evidence"]["http_status"] = json!(marker);
    let safe = store.record(input).unwrap();
    assert_eq!(safe.evidence.get("method").unwrap(), "GET");
    let raw = fs::read(dir.join("diagnostic-0.jsonl")).unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("MARKER"));
    assert!(!String::from_utf8_lossy(&raw).contains("abcdef0123456789"));
    assert!(store.record(json!(marker)).is_err());
    let page = store.page(query(20)).unwrap();
    assert_eq!(page.entries.len(), 1);
    assert!(!serde_json::to_string(&page).unwrap().contains("MARKER"));
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn diagnostic_log_rejects_untrusted_enum_time_and_query_without_echo() {
    let (dir, store) = store();
    for field in ["time", "level", "module", "platform"] {
        let mut input = event();
        input[field] = json!("/Users/MARKER/token");
        let err = store.record(input).unwrap_err();
        assert!(!err.message.contains("MARKER"));
    }
    for limit in [0, 201, u16::MAX] {
        assert!(store.page(query(limit)).is_err())
    }
    for field in ["module", "platform", "level"] {
        let mut value = serde_json::to_value(query(10)).unwrap();
        value[field] = json!("MARKER");
        let q: LogQuery = serde_json::from_value(value).unwrap();
        let err = store.page(q).unwrap_err();
        assert!(!err.message.contains("MARKER"));
    }
    let mut q = query(10);
    q.cursor = Some("MARKER".into());
    let err = store.page(q).unwrap_err();
    assert!(!err.message.contains("MARKER"));
    assert!(serde_json::from_value::<LogQuery>(
        json!({"cursor":null,"limit":10,"module":null,"platform":null,"level":null,"path":"MARKER"})
    )
    .is_err());
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn diagnostic_log_pages_are_bounded_stable_and_filter_bound() {
    let (dir, store) = store();
    for _ in 0..6 {
        store.record(event()).unwrap();
    }
    let first = store.page(query(2)).unwrap();
    assert_eq!(first.entries.len(), 2);
    assert!(first.next_cursor.is_some());
    store.record(event()).unwrap();
    let mut next = query(200);
    next.cursor = first.next_cursor.clone();
    let rest = store.page(next).unwrap();
    assert_eq!(rest.entries.len(), 4);
    assert!(rest.next_cursor.is_none());
    let mut mismatch = query(2);
    mismatch.cursor = first.next_cursor;
    mismatch.level = Some("info".into());
    assert!(store.page(mismatch).is_err());
    let restarted = DiagnosticLogStore::new(dir.clone());
    let cursor = store.page(query(1)).unwrap().next_cursor;
    let mut q = query(10);
    q.cursor = cursor;
    assert!(restarted.page(q).is_err());
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn diagnostic_log_rotates_at_the_byte_boundary_and_keeps_three_files() {
    let (dir, mut store) = store();
    assert_eq!(LOG_FILE_BYTES, 5 * 1024 * 1024);
    assert_eq!(LOG_FILES, 3);
    let safe = sanitize_event(event()).unwrap();
    let record = serde_json::to_vec(&StoredRecord {
        sequence: 1,
        event: safe,
    })
    .unwrap();
    store.file_limit = record.len() + 1;
    store.record(event()).unwrap();
    assert!(!dir.join("diagnostic-1.jsonl").exists());
    for _ in 0..5 {
        store.record(event()).unwrap();
    }
    let paths = fs::read_dir(&dir)
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(paths.len(), 3);
    for path in paths {
        assert!(path.metadata().unwrap().len() <= store.file_limit as u64);
    }
    let page = store.page(query(200)).unwrap();
    assert_eq!(page.entries.len(), 3);
    assert!(page.truncated);
    fs::remove_dir_all(dir).unwrap();
}
#[cfg(unix)]
#[test]
fn diagnostic_log_rejects_linked_and_public_files_without_exposing_paths() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    for kind in ["symlink", "hardlink", "permissions"] {
        let (dir, store) = store();
        let target = dir.join("private-MARKER");
        fs::write(&target, b"MARKER-SECRET").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        let log = dir.join("diagnostic-0.jsonl");
        match kind {
            "symlink" => symlink(&target, &log).unwrap(),
            "hardlink" => fs::hard_link(&target, &log).unwrap(),
            _ => {
                fs::write(&log, b"MARKER-SECRET").unwrap();
                fs::set_permissions(&log, fs::Permissions::from_mode(0o644)).unwrap();
            }
        }
        let err = store.record(event()).unwrap_err();
        assert!(!err.message.contains("MARKER"));
        assert_eq!(fs::read(&target).unwrap(), b"MARKER-SECRET");
        fs::remove_dir_all(dir).unwrap();
    }
}

fn report() -> crate::diagnostics_protocol::DiagnosticReport {
    crate::diagnostics_protocol::validate_report(&json!({"report":{"id":"a".repeat(48),"instance":"b".repeat(32),"run_id":null,"network_revision":2,"binding_revision":0,"started_at":"2026-10-27T03:30:00Z","finished_at":"2026-10-27T03:31:00Z","state":"completed","checks":[{"id":"hive","platform":null,"status":"fail","observed_at":"2026-10-27T03:30:00Z","code":"http_rejected","evidence":{"http_status":"401"},"next_action":"diagnostics"}]}}),&"b".repeat(32)).unwrap()
}
#[test]
fn diagnostic_log_export_is_safe_bounded_and_explicit_about_truncation() {
    let metadata = ExportMetadata {
        app_version: "0.1.0".into(),
        bee_version: "dev".into(),
        os: "darwin".into(),
        arch: "arm64".into(),
    };
    let safe = sanitize_event(event()).unwrap();
    let logs = vec![safe; 30_000];
    let export = assemble_export(metadata, report(), logs).unwrap();
    let bytes = serde_json::to_vec(&export).unwrap();
    assert!(bytes.len() <= REPORT_BYTES);
    assert!(export.truncated);
    assert!(export.truncated_sections.contains(&"logs".into()));
    assert_eq!(export.report.checks.len(), 1);
    assert!(serde_json::from_slice::<serde_json::Value>(&bytes).is_ok());
    let mut hostile = sanitize_event(event()).unwrap();
    hostile
        .evidence
        .insert("path".into(), "/Users/MARKER/token".into());
    hostile
        .evidence
        .insert("token".into(), "MARKER-TOKEN".into());
    let export = assemble_export(
        ExportMetadata {
            app_version: "0.1.0".into(),
            bee_version: "dev".into(),
            os: "darwin".into(),
            arch: "arm64".into(),
        },
        report(),
        vec![hostile],
    )
    .unwrap();
    assert!(!serde_json::to_string(&export).unwrap().contains("MARKER"));
}
#[test]
fn diagnostic_log_export_snapshot_filters_tampered_persisted_records() {
    let (dir, store) = store();
    store.record(event()).unwrap();
    assert_eq!(store.export_entries().unwrap().len(), 1);
    let path = dir.join("diagnostic-0.jsonl");
    crate::preferences::private_write(
        &path,
        b"{\"sequence\":2,\"event\":{\"message\":\"MARKER-TOKEN\"}}\n",
    )
    .unwrap();
    let error = store.export_entries().unwrap_err();
    assert!(!error.message.contains("MARKER"));
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn diagnostic_log_export_accepts_real_development_versions_with_a_closed_shape() {
    for bee_version in ["dev+d9e9ca44be57", "dev+d9e9ca44be57-dirty"] {
        let export = assemble_export(
            ExportMetadata {
                app_version: "0.1.0".into(),
                bee_version: bee_version.into(),
                os: "darwin".into(),
                arch: "arm64".into(),
            },
            report(),
            vec![],
        )
        .unwrap();
        assert_eq!(export.bee_version, bee_version);
    }
    for bee_version in ["dev+MARKER", "dev+/Users/MARKER", "dev+abcdef012345-secret"] {
        let failure = assemble_export(
            ExportMetadata {
                app_version: "0.1.0".into(),
                bee_version: bee_version.into(),
                os: "darwin".into(),
                arch: "arm64".into(),
            },
            report(),
            vec![],
        )
        .unwrap_err();
        assert_eq!(failure.code, "DIAGNOSTIC_EXPORT_REJECTED");
        assert!(!failure.message.contains("MARKER"));
    }
}
