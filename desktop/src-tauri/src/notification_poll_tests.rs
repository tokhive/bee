use super::*;
use crate::{
    notifications::{
        DeliveryState, NotificationAdapter, Permission, SubmissionFailure, SubmissionReceipt,
    },
    preferences::DesktopPreferences,
    sidecar::Metadata,
};
use serde_json::json;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

fn value() -> Value {
    let facts: Vec<_> = ["authorization_rejected", "confirmation_required", "offline", "quota_exhausted"].into_iter().enumerate().map(|(i, problem)| json!({"identity": format!("{i:064x}"), "platform": "openai", "problem": problem, "active": false, "eligible": false, "recovered": false})).collect();
    json!({"notifications": {"facts": facts, "observed_at": "2026-10-27T00:00:00Z", "network_revision": 3}})
}
fn status(phase: BridgePhase) -> BridgeStatus {
    BridgeStatus {
        state: phase,
        metadata: Some(Metadata {
            bee_version: "test".into(),
            os: "test".into(),
            arch: "test".into(),
            instance: "a".repeat(32),
        }),
        error: None,
    }
}
fn prefs(enabled: bool) -> PreferencesSnapshot {
    PreferencesSnapshot {
        preferences: DesktopPreferences {
            notifications_enabled: enabled,
            ..DesktopPreferences::default()
        },
        error: None,
    }
}

#[test]
fn fixed_facts_validate_and_convert_only_explicit_events() {
    let mut input = value();
    assert!(validate(&input).is_ok());
    assert!(events(decode(&input).unwrap()).is_empty());
    input["notifications"]["facts"][0]["active"] = json!(true);
    input["notifications"]["facts"][0]["eligible"] = json!(true);
    input["notifications"]["facts"][1]["recovered"] = json!(true);
    let events = events(decode(&input).unwrap());
    assert!(
        matches!(&events[0], NotificationEvent::Problem{notice, eligible: true} if notice.problem == NotificationProblem::AuthorizationRejected && notice.platform == NotificationPlatform::Openai)
    );
    assert!(
        matches!(&events[1], NotificationEvent::Recovered{identity} if identity == &format!("{:064x}",1))
    );
    assert_eq!(events.len(), 2);
    assert!(validate(&json!({"notifications":{"facts":[],"observed_at":"2026-10-27T00:00:00.1Z","network_revision":0}})).is_ok());
}

#[test]
fn malformed_facts_fail_closed_without_echoing_payload() {
    let mut cases = vec![json!(null), json!({}), json!({"notifications": null})];
    for key in ["facts", "observed_at", "network_revision"] {
        let mut v = value();
        v["notifications"].as_object_mut().unwrap().remove(key);
        cases.push(v);
    }
    for key in [
        "identity",
        "platform",
        "problem",
        "active",
        "eligible",
        "recovered",
    ] {
        let mut v = value();
        v["notifications"]["facts"][0]
            .as_object_mut()
            .unwrap()
            .remove(key);
        cases.push(v);
    }
    for (key, field) in [
        ("identity", json!("PRIVATE_MARKER")),
        ("platform", json!("PRIVATE_MARKER")),
        ("problem", json!("PRIVATE_MARKER")),
        ("active", json!(null)),
        ("eligible", json!(1)),
        ("recovered", json!("false")),
    ] {
        let mut v = value();
        v["notifications"]["facts"][0][key] = field;
        cases.push(v);
    }
    for (key, field) in [
        ("observed_at", json!("2026-02-30T00:00:00Z")),
        ("observed_at", json!("2026-10-27T00:00:00+00:00")),
        ("network_revision", json!(-1)),
        ("network_revision", json!(9_007_199_254_740_992u64)),
        ("network_revision", json!(1.0)),
        ("facts", json!(null)),
    ] {
        let mut v = value();
        v["notifications"][key] = field;
        cases.push(v);
    }
    let mut unknown = value();
    unknown["notifications"]["PRIVATE_MARKER"] = json!("PRIVATE_MARKER");
    cases.push(unknown);
    let mut unknown = value();
    unknown["notifications"]["facts"][0]["PRIVATE_MARKER"] = json!("PRIVATE_MARKER");
    cases.push(unknown);
    let mut eligible = value();
    eligible["notifications"]["facts"][0]["eligible"] = json!(true);
    cases.push(eligible);
    let mut recovered = value();
    recovered["notifications"]["facts"][0]["active"] = json!(true);
    recovered["notifications"]["facts"][0]["recovered"] = json!(true);
    cases.push(recovered);
    let mut duplicate = value();
    duplicate["notifications"]["facts"][1]["identity"] =
        duplicate["notifications"]["facts"][0]["identity"].clone();
    cases.push(duplicate);
    let mut duplicate = value();
    duplicate["notifications"]["facts"][1]["problem"] = json!("authorization_rejected");
    cases.push(duplicate);
    let mut partial = value();
    partial["notifications"]["facts"]
        .as_array_mut()
        .unwrap()
        .pop();
    cases.push(partial);
    for v in cases {
        let error = validate(&v).expect_err("invalid fixed facts accepted");
        assert!(!error.message.contains("PRIVATE_MARKER"));
    }
}

#[test]
fn operation_errors_are_strict_and_keep_the_specific_failure() {
    let error=validate(&json!({"error":{"code":"NOTIFICATIONS_OPERATION_FAILED","message":"notification account_state JSON syntax rejected: byte=17"}})).unwrap_err();
    assert_eq!(error.code, "NOTIFICATIONS_OPERATION_FAILED");
    assert!(error.message.contains("byte=17"));
    for v in [
        json!({"error":{"code":"PRIVATE_MARKER","message":"PRIVATE_MARKER"}}),
        json!({"error":{"code":"NOTIFICATIONS_OPERATION_FAILED","message":""}}),
        json!({"error":{"code":"NOTIFICATIONS_OPERATION_FAILED","message":"x","PRIVATE_MARKER":true}}),
        json!({"error":{"code":"NOTIFICATIONS_OPERATION_FAILED","message":"x"},"notifications":{}}),
    ] {
        let e = validate(&v).unwrap_err();
        assert!(!e.message.contains("PRIVATE_MARKER"));
    }
}

#[test]
fn startup_and_current_management_instance_gate_every_sample() {
    assert_eq!(
        ready_instance(&status(BridgePhase::Ready), true).unwrap(),
        Some("a".repeat(32).as_str())
    );
    for phase in [BridgePhase::Starting, BridgePhase::Stopped] {
        assert_eq!(ready_instance(&status(phase), true).unwrap(), None);
    }
    assert_eq!(
        ready_instance(&status(BridgePhase::Ready), false).unwrap(),
        None
    );
    let reply = BridgeReply {
        protocol: 1,
        id: "notification".into(),
        instance: "a".repeat(32),
        result: value(),
    };
    assert!(sampled(&"a".repeat(32), &status(BridgePhase::Ready), true, &reply).is_ok());
    assert!(sampled(&"a".repeat(32), &status(BridgePhase::Ready), false, &reply).is_err());
    assert!(sampled(&"b".repeat(32), &status(BridgePhase::Ready), true, &reply).is_err());
    assert!(sampled(
        &"a".repeat(32),
        &status(BridgePhase::Starting),
        true,
        &reply
    )
    .is_err());
}

#[test]
fn preferences_failure_blocks_delivery_but_still_applies_explicit_recovery() {
    let mut input = value();
    input["notifications"]["facts"][0]["recovered"] = json!(true);
    let mut saved = prefs(true);
    saved.error = Some(BridgeError {
        details: None,
        code: "PREFERENCES_SCHEMA".into(),
        message: "saved preferences schema failed".into(),
    });
    let result = apply(decode(&input).unwrap(), saved, |enabled, events| {
        assert!(!enabled);
        assert!(matches!(events, [NotificationEvent::Recovered { .. }]));
        Ok(vec![])
    })
    .unwrap_err();
    assert_eq!(result.code, "PREFERENCES_SCHEMA");
    apply(
        decode(&value()).unwrap(),
        prefs(false),
        |enabled, events| {
            assert!(!enabled);
            assert!(events.is_empty());
            Ok(vec![])
        },
    )
    .unwrap();
}

#[test]
fn delivery_outcome_failures_do_not_become_poll_read_errors() {
    let retained = NotificationPollState::default();
    apply(decode(&value()).unwrap(), prefs(true), |_, _| {
        Ok(vec![DeliveryOutcome {
            identity: "a".repeat(64),
            state: DeliveryState::Failed,
            error: Some(BridgeError {
                details: None,
                code: "NOTIFICATION_SUBMISSION_FAILED".into(),
                message: "native submit HRESULT=5".into(),
            }),
        }])
    })
    .unwrap();
    retained.complete(Ok(()));
    assert_eq!(retained.error(), None);
    assert_eq!(
        safe_code("PRIVATE_MARKER\nsecret"),
        "NOTIFICATION_POLL_FAILED"
    );
    assert_eq!(safe_code("PRIVATE_MARKER"), "NOTIFICATION_POLL_FAILED");
    assert_eq!(safe_code("NOTIFICATION_NATIVE"), "NOTIFICATION_NATIVE");
}

struct Adapter(AtomicUsize);
impl NotificationAdapter for Adapter {
    fn permission(&self) -> Result<Permission, BridgeError> {
        Ok(Permission::Granted)
    }
    fn request_permission(&self) -> Result<(), BridgeError> {
        panic!("background polling must never prompt")
    }
    fn submit(&self, _: &Notice) -> Result<SubmissionReceipt, SubmissionFailure> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(SubmissionReceipt::Accepted)
    }
}
#[test]
fn repeated_polls_and_absent_facts_preserve_dedupe_until_explicit_recovery() {
    let path = std::env::temp_dir().join(format!(
        "bee-poll-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&path).unwrap();
    let adapter = Arc::new(Adapter(AtomicUsize::new(0)));
    let service = NotificationService::new(path.join("delivery.json"), adapter.clone());
    let mut active = value();
    active["notifications"]["facts"][0]["active"] = json!(true);
    active["notifications"]["facts"][0]["eligible"] = json!(true);
    let reconcile = |enabled, events: &[NotificationEvent]| service.reconcile(enabled, events);
    apply(decode(&active).unwrap(), prefs(true), reconcile).unwrap();
    apply(decode(&value()).unwrap(), prefs(true), reconcile).unwrap();
    apply(decode(&active).unwrap(), prefs(true), reconcile).unwrap();
    assert_eq!(adapter.0.load(Ordering::SeqCst), 1);
    let mut recovery = value();
    recovery["notifications"]["facts"][0]["recovered"] = json!(true);
    apply(decode(&recovery).unwrap(), prefs(false), reconcile).unwrap();
    apply(decode(&active).unwrap(), prefs(true), reconcile).unwrap();
    assert_eq!(adapter.0.load(Ordering::SeqCst), 2);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn unconfirmed_system_language_never_changes_delivery_ledger_or_consumes_permission_and_retry() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("delivery.json");
    let adapter = Arc::new(Adapter(AtomicUsize::new(0)));
    let service = NotificationService::new(path.clone(), adapter.clone());
    let mut active = value();
    active["notifications"]["facts"][0]["active"] = json!(true);
    active["notifications"]["facts"][0]["eligible"] = json!(true);
    let reconcile = |enabled, events: &[NotificationEvent]| service.reconcile(enabled, events);
    apply_localized(decode(&active).unwrap(), prefs(true), None, reconcile).unwrap();
    assert!(!path.exists());
    assert_eq!(adapter.0.load(Ordering::SeqCst), 0);
    apply_localized(
        decode(&active).unwrap(),
        prefs(true),
        Some(crate::lifecycle::NativeLocale::Zh),
        reconcile,
    )
    .unwrap();
    let before = std::fs::read(&path).unwrap();
    apply_localized(
        decode(&active).unwrap(),
        prefs(true),
        Some(crate::lifecycle::NativeLocale::En),
        reconcile,
    )
    .unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(adapter.0.load(Ordering::SeqCst), 1);
}

#[test]
fn completed_notification_checks_clear_read_errors_and_advance_exact_sequence() {
    let retained = NotificationPollState::default();
    retained.complete(Err(invalid("read failed: fixture=true")));
    assert_eq!(retained.check().0, 1);
    assert!(retained.check().1.is_some());
    retained.complete(Ok(()));
    assert_eq!(retained.check(), (2, None));
    retained.complete(Err(invalid("read failed again: fixture=true")));
    assert_eq!(retained.check().0, 3);
}

#[test]
fn notification_status_successful_read_does_not_clear_unrecovered_delivery_failure() {
    struct Rejected;
    impl NotificationAdapter for Rejected {
        fn permission(&self) -> Result<Permission, BridgeError> { Ok(Permission::Granted) }
        fn request_permission(&self) -> Result<(), BridgeError> { panic!("status must not prompt") }
        fn submit(&self, _: &Notice) -> Result<SubmissionReceipt, SubmissionFailure> {
            Err(SubmissionFailure { error: invalid("native rejection: fixture=true"), uncertain: false })
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let service = NotificationService::new(dir.path().join("delivery.json"), Arc::new(Rejected));
    let poll = NotificationPollState::default();
    let mut active = value();
    active["notifications"]["facts"][0]["active"] = json!(true);
    active["notifications"]["facts"][0]["eligible"] = json!(true);
    let result = apply(decode(&active).unwrap(), prefs(true), |enabled, events| service.reconcile(enabled, events));
    poll.complete(result);
    let failed = poll.delivery_status(&service).unwrap();
    assert_eq!(failed["retryable_count"], 1);
    assert_eq!(failed["check_sequence"], 1);
    assert_eq!(failed["error"]["message"], "native rejection: fixture=true");
    poll.retain(invalid("bridge read failed: fixture=true"));
    assert_eq!(poll.delivery_status(&service).unwrap()["error"]["message"], "bridge read failed: fixture=true");
    let result = apply(decode(&value()).unwrap(), prefs(true), |enabled, events| service.reconcile(enabled, events));
    poll.complete(result);
    let suppressed = poll.delivery_status(&service).unwrap();
    assert_eq!(suppressed["check_sequence"], 3);
    assert_eq!(suppressed["error"]["message"], "native rejection: fixture=true");
    assert_eq!(suppressed["retryable_count"], 1);
    service.allow_failed_retry().unwrap();
    let pending = poll.delivery_status(&service).unwrap();
    assert_eq!((pending["retryable_count"].as_u64(), pending["pending_count"].as_u64()), (Some(0), Some(1)));
    let mut recovery = value();
    recovery["notifications"]["facts"][0]["recovered"] = json!(true);
    poll.complete(apply(decode(&recovery).unwrap(), prefs(false), |enabled, events| service.reconcile(enabled, events)));
    let recovered = poll.delivery_status(&service).unwrap();
    assert!(recovered["error"].is_null());
    assert_eq!(recovered["check_sequence"], 4);
    assert_eq!(recovered["pending_count"], 0);
    assert_eq!(recovered.as_object().unwrap().len(), 5);
}

#[test]
fn notification_status_ledger_read_failure_keeps_original_diagnostic() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("delivery.json");
    crate::preferences::private_write(&path, b"{").unwrap();
    let service = NotificationService::new(path, Arc::new(Adapter(AtomicUsize::new(0))));
    let error = NotificationPollState::default().delivery_status(&service).unwrap_err();
    assert_eq!(error.code, "NOTIFICATION_LEDGER_SCHEMA");
    assert!(error.message.contains("line=1"));
}
