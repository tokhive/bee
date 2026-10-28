use super::*;
fn report() -> Value {
    serde_json::json!({"report":{"id":"a".repeat(48),"instance":"b".repeat(32),"run_id":null,"network_revision":0,"started_at":"2026-10-27T00:00:00Z","finished_at":null,"state":"running","checks":[{"id":"device","platform":null,"status":"skipped","observed_at":"2026-10-27T00:00:00Z","code":"pending","evidence":{},"next_action":"settings"}]}})
}
#[test]
fn diagnostics_protocol_strict_identity_schema_and_unknown_checks() {
    let v = report();
    assert!(validate_report(&v, &"b".repeat(32)).is_ok());
    assert!(validate_report(&v, &"c".repeat(32)).is_err());
    for (path, value) in [
        (
            "/report/network_revision",
            serde_json::json!(9007199254740992u64),
        ),
        ("/report/checks/0/id", serde_json::json!("future_check")),
        ("/report/checks/0/status", serde_json::json!("success")),
        ("/report/checks/0/next_action", serde_json::json!("shell")),
        (
            "/report/checks/0/evidence",
            serde_json::json!({"Authorization":"SECRET_MARKER"}),
        ),
    ] {
        let mut bad = v.clone();
        *bad.pointer_mut(path).unwrap() = value;
        let error = validate_report(&bad, &"b".repeat(32)).unwrap_err();
        assert!(!error.message.contains("SECRET_MARKER"));
    }
}
#[test]
fn diagnostics_protocol_rejects_inconsistent_completion_and_missing_nullable() {
    let mut v = report();
    v["report"]["state"] = serde_json::json!("completed");
    assert!(validate_report(&v, &"b".repeat(32)).is_err());
    let mut v = report();
    v["report"].as_object_mut().unwrap().remove("run_id");
    assert!(validate_report(&v, &"b".repeat(32)).is_err());
}
