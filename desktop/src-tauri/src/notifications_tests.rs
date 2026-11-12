use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

struct FakeAdapter {
    permission: Mutex<Permission>,
    requests: AtomicUsize,
    submissions: AtomicUsize,
    fail: AtomicBool,
    query_fail: AtomicBool,
    uncertain: AtomicBool,
    on_submit: Mutex<Option<Box<dyn Fn() + Send>>>,
}
impl FakeAdapter {
    fn new(permission: Permission) -> Arc<Self> {
        Arc::new(Self {
            permission: Mutex::new(permission),
            requests: AtomicUsize::new(0),
            submissions: AtomicUsize::new(0),
            fail: AtomicBool::new(false),
            query_fail: AtomicBool::new(false),
            uncertain: AtomicBool::new(false),
            on_submit: Mutex::new(None),
        })
    }
}
impl NotificationAdapter for FakeAdapter {
    fn permission(&self) -> Result<Permission, BridgeError> {
        if self.query_fail.load(Ordering::SeqCst) {
            return Err(failure(
                "FAKE_QUERY",
                "permission query failed: fixture=true",
            ));
        }
        Ok(*self.permission.lock().unwrap())
    }
    fn request_permission(&self) -> Result<(), BridgeError> {
        self.requests.fetch_add(1, Ordering::SeqCst);
        *self.permission.lock().unwrap() = Permission::Granted;
        Ok(())
    }
    fn submit(&self, _: &Notice) -> Result<SubmissionReceipt, SubmissionFailure> {
        self.submissions.fetch_add(1, Ordering::SeqCst);
        if let Some(callback) = self.on_submit.lock().unwrap().as_ref() {
            callback();
        }
        if self.uncertain.load(Ordering::SeqCst) {
            Err(SubmissionFailure::uncertain(failure(
                "FAKE_TIMEOUT",
                "OS submission receipt timed out: fixture=true",
            )))
        } else if self.fail.load(Ordering::SeqCst) {
            Err(SubmissionFailure::rejected(failure(
                "FAKE_SUBMIT",
                "OS submission rejected: fixture=true",
            )))
        } else {
            Ok(SubmissionReceipt::Accepted)
        }
    }
}
struct Fixture {
    dir: PathBuf,
    adapter: Arc<FakeAdapter>,
}
impl Fixture {
    fn new(permission: Permission) -> Self {
        static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "bee-notification-tests-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir(&dir).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        Self {
            dir,
            adapter: FakeAdapter::new(permission),
        }
    }
    fn path(&self) -> PathBuf {
        self.dir.join("notification-delivery.json")
    }
    fn service(&self) -> NotificationService {
        NotificationService::new(self.path(), self.adapter.clone())
    }
    fn ledger(&self) -> Ledger {
        read_ledger(&self.path()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
fn notice() -> Notice {
    Notice {
        identity: "a".repeat(64),
        platform: NotificationPlatform::Openai,
        problem: NotificationProblem::AuthorizationRejected,
        source: None,
    }
}
#[test]
fn delivered_notification_retains_its_hive_in_body_and_activation_route() {
    let notice: Notice = serde_json::from_value(serde_json::json!({
        "identity":"a".repeat(64),"platform":"openai","problem":"authorization_rejected",
        "source":{"profile_id":"1".repeat(32),"origin":"https://a.example"}
    })).unwrap();
    assert!(notice.body(NativeLocale::Zh).contains("Hive：https://a.example"));
    assert!(notice.body(NativeLocale::En).contains("Hive: https://a.example"));
    let target = serde_json::to_value(parse_click_route(&click_route(&notice))).unwrap();
    assert_eq!(target["source"]["profile_id"], "1".repeat(32));
    assert_eq!(target["source"]["origin"], "https://a.example");
}
#[test]
fn delivered_hive_notice_checks_durable_current_at_activation_and_global_routes_stay_available() {
    let f = Fixture::new(Permission::Granted);
    let profiles = crate::profiles::ProfileStore::open(f.dir.join("profiles")).unwrap();
    let a = profiles.register("https://a.example").unwrap();
    let b = profiles.register("https://b.example").unwrap();
    profiles.commit_current(profiles.snapshot().unwrap().revision, &a.id, &"a".repeat(48)).unwrap();
    let global = notice().target();
    let mut notice = notice();
    notice.source = Some(NotificationSource { profile_id: a.id.clone(), origin: a.origin });
    f.service().reconcile(true, &[NotificationEvent::Problem { notice: notice.clone(), eligible: true }]).unwrap();
    let delivered_route = click_route(&notice);
    assert!(activate_target(parse_click_route(&delivered_route).unwrap(), Some(&profiles)).can_navigate);
    profiles.commit_current(profiles.snapshot().unwrap().revision, &b.id, &"b".repeat(48)).unwrap();
    let activation = activate_target(parse_click_route(&delivered_route).unwrap(), Some(&profiles));
    assert!(!activation.can_navigate);
    assert_eq!(activation.current_profile.as_deref(), Some(b.id.as_str()));
    assert_eq!(activation.target.source, notice.source);
    assert_eq!(profiles.snapshot().unwrap().current_profile, Some(b.id));
    assert!(activate_target(global, None).can_navigate);
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
}
fn active() -> NotificationEvent {
    NotificationEvent::Problem {
        notice: notice(),
        eligible: true,
    }
}

#[test]
fn notifications_only_explicit_enable_requests_prompt_permission() {
    let f = Fixture::new(Permission::Prompt);
    let service = f.service();
    assert_eq!(service.permission().unwrap(), Permission::Prompt);
    service.reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.requests.load(Ordering::SeqCst), 0);
    assert_eq!(service.enable().unwrap(), Permission::Granted);
    assert_eq!(f.adapter.requests.load(Ordering::SeqCst), 1);
    service.enable().unwrap();
    assert_eq!(f.adapter.requests.load(Ordering::SeqCst), 1);
    *f.adapter.permission.lock().unwrap() = Permission::Denied;
    assert_eq!(service.enable().unwrap(), Permission::Denied);
    assert_eq!(f.adapter.requests.load(Ordering::SeqCst), 1);
}

#[test]
fn notifications_permission_query_error_is_never_invented_prompt() {
    let f = Fixture::new(Permission::Granted);
    f.adapter.query_fail.store(true, Ordering::SeqCst);
    assert_eq!(f.service().permission().unwrap_err().code, "FAKE_QUERY");
    assert_eq!(f.service().enable().unwrap_err().code, "FAKE_QUERY");
    assert_eq!(f.adapter.requests.load(Ordering::SeqCst), 0);
}

#[test]
fn notifications_disabled_denied_and_ineligible_do_not_submit() {
    let f = Fixture::new(Permission::Granted);
    let service = f.service();
    service.reconcile(false, &[active()]).unwrap();
    service
        .reconcile(
            true,
            &[NotificationEvent::Problem {
                notice: notice(),
                eligible: false,
            }],
        )
        .unwrap();
    *f.adapter.permission.lock().unwrap() = Permission::Denied;
    service.reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 0);
    assert!(f.ledger().records.is_empty());
}

#[test]
fn notifications_os_accepted_is_persistent_and_not_read() {
    let f = Fixture::new(Permission::Granted);
    assert_eq!(
        f.service().reconcile(true, &[active()]).unwrap()[0].state,
        DeliveryState::Accepted
    );
    f.service().reconcile(true, &[active()]).unwrap();
    f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
    let raw = std::fs::read_to_string(f.path()).unwrap();
    assert!(!raw.contains("read") && !raw.contains("seen"));
    assert_eq!(f.ledger().records[0].state, DeliveryState::Accepted);
}
#[test]
fn legacy_delivered_notice_without_source_remains_suppressed_after_upgrade() {
    let f = Fixture::new(Permission::Granted);
    f.service().reconcile(true, &[active()]).unwrap();
    let mut scoped = notice();
    scoped.source = Some(NotificationSource { profile_id:"1".repeat(32), origin:"https://a.example".into() });
    f.service().reconcile(true, &[NotificationEvent::Problem { notice: scoped, eligible: true }]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
    assert!(f.ledger().records[0].notice.source.is_none(), "historical delivery cannot be silently attributed");
}

#[test]
fn notifications_failed_submit_is_not_success_and_has_no_automatic_retry() {
    let f = Fixture::new(Permission::Granted);
    f.adapter.fail.store(true, Ordering::SeqCst);
    let result = f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(result[0].state, DeliveryState::Failed);
    assert_eq!(result[0].error.as_ref().unwrap().code, "FAKE_SUBMIT");
    assert_eq!(f.ledger().records[0].state, DeliveryState::Failed);
    f.adapter.fail.store(false, Ordering::SeqCst);
    f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
    f.service().allow_failed_retry().unwrap();
    f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 2);
    assert_eq!(f.ledger().records[0].state, DeliveryState::Accepted);
}

#[test]
fn notifications_permission_change_retries_definite_failure_once() {
    let f = Fixture::new(Permission::Granted);
    f.adapter.fail.store(true, Ordering::SeqCst);
    f.service().reconcile(true, &[active()]).unwrap();
    *f.adapter.permission.lock().unwrap() = Permission::Denied;
    f.service().permission().unwrap();
    *f.adapter.permission.lock().unwrap() = Permission::Granted;
    f.adapter.fail.store(false, Ordering::SeqCst);
    f.service().reconcile(true, &[active()]).unwrap();
    f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 2);
}

#[test]
fn notifications_explicit_recovery_allows_recurrence_even_when_disabled() {
    let f = Fixture::new(Permission::Granted);
    f.service().reconcile(true, &[active()]).unwrap();
    f.adapter.query_fail.store(true, Ordering::SeqCst);
    f.service()
        .reconcile(
            false,
            &[NotificationEvent::Recovered {
                identity: notice().identity,
            }],
        )
        .unwrap();
    assert!(f.ledger().records.is_empty());
    f.adapter.query_fail.store(false, Ordering::SeqCst);
    f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 2);
}

#[test]
fn notifications_attempt_is_durable_before_os_and_uncertain_restart_is_suppressed() {
    let f = Fixture::new(Permission::Granted);
    let path = f.path();
    *f.adapter.on_submit.lock().unwrap() = Some(Box::new(move || {
        assert_eq!(
            read_ledger(&path).unwrap().records[0].state,
            DeliveryState::Attempted
        );
    }));
    f.service().reconcile(true, &[active()]).unwrap();
    let mut ledger = f.ledger();
    ledger.records[0].state = DeliveryState::Attempted;
    write_ledger(&f.path(), &ledger).unwrap();
    f.service().allow_failed_retry().unwrap();
    f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
}

#[test]
fn notifications_corrupt_ledger_and_identity_reuse_fail_closed() {
    let f = Fixture::new(Permission::Granted);
    f.service().reconcile(true, &[active()]).unwrap();
    let mut changed = notice();
    changed.platform = NotificationPlatform::Claude;
    assert!(f
        .service()
        .reconcile(
            true,
            &[NotificationEvent::Problem {
                notice: changed,
                eligible: true
            }]
        )
        .is_err());
    let mut value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(f.path()).unwrap()).unwrap();
    let duplicate = value["records"][0].clone();
    value["records"].as_array_mut().unwrap().push(duplicate);
    let raw = serde_json::to_vec(&value).unwrap();
    crate::preferences::private_write(&f.path(), &raw).unwrap();
    assert!(f.service().reconcile(true, &[active()]).is_err());
    assert_eq!(std::fs::read(f.path()).unwrap(), raw);
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
}

#[test]
fn notifications_untrusted_fields_and_routes_are_rejected() {
    assert!(serde_json::from_str::<Notice>(
        r#"{"identity":"bad","platform":"openai","problem":"offline","body":"secret"}"#
    )
    .is_err());
    let f = Fixture::new(Permission::Granted);
    let mut invalid = notice();
    invalid.identity = "https://bad.example/command".into();
    assert!(f
        .service()
        .reconcile(
            true,
            &[NotificationEvent::Problem {
                notice: invalid,
                eligible: true
            }]
        )
        .is_err());
    assert_eq!(
        parse_click_route(&click_route(&notice())),
        Some(notice().target())
    );
    assert_eq!(parse_click_route("bee.accounts.abcdef"), None);
    assert_eq!(
        parse_click_route(&format!("bee.shell.{}", "a".repeat(64))),
        None
    );
    let mut offline = notice();
    offline.problem = NotificationProblem::Offline;
    assert_eq!(
        parse_click_route(&click_route(&offline)),
        Some(offline.target())
    );
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 0);
}

#[test]
fn notifications_native_constructor_is_inert_without_application_bundle() {
    let _adapter = NativeNotificationAdapter::new(
        "invalid-for-runtime-test".into(),
        Arc::new(|_| panic!("constructor must not navigate")),
        Arc::new(NativeLanguage::default()),
    );
}

#[test]
fn notifications_timeout_stays_uncertain_across_permission_changes_and_explicit_retry() {
    let f = Fixture::new(Permission::Granted);
    f.adapter.uncertain.store(true, Ordering::SeqCst);
    let outcome = f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(outcome[0].state, DeliveryState::Attempted);
    assert_eq!(outcome[0].error.as_ref().unwrap().code, "FAKE_TIMEOUT");
    assert_eq!(f.ledger().records[0].state, DeliveryState::Attempted);
    *f.adapter.permission.lock().unwrap() = Permission::Denied;
    f.service().permission().unwrap();
    *f.adapter.permission.lock().unwrap() = Permission::Granted;
    f.service().allow_failed_retry().unwrap();
    f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
}

#[test]
fn notifications_s1_eligibility_and_problem_identities_are_independent() {
    let f = Fixture::new(Permission::Granted);
    let mut offline = notice();
    offline.identity = "b".repeat(64);
    offline.problem = NotificationProblem::Offline;
    let offline_event = NotificationEvent::Problem {
        notice: offline.clone(),
        eligible: true,
    };
    f.service()
        .reconcile(
            true,
            &[
                active(),
                NotificationEvent::Problem {
                    notice: offline,
                    eligible: false,
                },
            ],
        )
        .unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
    // S1's eligible flag is sufficient; there is no second offline timer here.
    f.service()
        .reconcile(true, &[active(), offline_event])
        .unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 2);
    f.service().reconcile(true, &[]).unwrap();
    assert_eq!(
        f.ledger().records.len(),
        2,
        "absence never invents recovery"
    );
}

#[test]
fn notifications_missing_unknown_duplicate_fields_and_version_preserve_original() {
    let f = Fixture::new(Permission::Granted);
    f.service().reconcile(true, &[active()]).unwrap();
    let original: serde_json::Value =
        serde_json::from_slice(&std::fs::read(f.path()).unwrap()).unwrap();
    let mut no_permission = original.clone();
    no_permission.as_object_mut().unwrap().remove("permission");
    let mut unknown = original.clone();
    unknown["token"] = serde_json::json!("secret-must-not-be-echoed");
    let mut version = original.clone();
    version["version"] = serde_json::json!(2);
    let mut no_error_code = original.clone();
    no_error_code["records"][0]
        .as_object_mut()
        .unwrap()
        .remove("error_code");
    let duplicate =
        br#"{"version":1,"version":1,"retry_revision":0,"permission":null,"records":[]}"#.to_vec();
    let mut variants = vec![duplicate];
    variants.extend(
        [no_permission, unknown, version, no_error_code]
            .into_iter()
            .map(|value| serde_json::to_vec(&value).unwrap()),
    );
    for raw in variants {
        crate::preferences::private_write(&f.path(), &raw).unwrap();
        let error = f.service().reconcile(true, &[active()]).unwrap_err();
        assert!(!error.message.contains("secret-must-not-be-echoed"));
        assert_eq!(std::fs::read(f.path()).unwrap(), raw);
    }
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
}

#[test]
fn notifications_conflicting_batch_has_no_partial_submission_or_recovery() {
    let f = Fixture::new(Permission::Granted);
    f.service().reconcile(true, &[active()]).unwrap();
    let before = std::fs::read(f.path()).unwrap();
    assert!(f
        .service()
        .reconcile(
            true,
            &[
                NotificationEvent::Recovered {
                    identity: notice().identity
                },
                active()
            ]
        )
        .is_err());
    assert_eq!(std::fs::read(f.path()).unwrap(), before);
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
}

#[test]
fn notifications_recovery_is_saved_before_unavailable_permission_query() {
    let f = Fixture::new(Permission::Granted);
    f.service().reconcile(true, &[active()]).unwrap();
    f.adapter.query_fail.store(true, Ordering::SeqCst);
    let error = f
        .service()
        .reconcile(
            true,
            &[NotificationEvent::Recovered {
                identity: notice().identity,
            }],
        )
        .unwrap_err();
    assert_eq!(error.code, "FAKE_QUERY");
    assert!(f.ledger().records.is_empty());
}

#[cfg(unix)]
#[test]
fn notifications_ledger_write_failure_prevents_os_submission() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new(Permission::Granted);
    std::fs::set_permissions(&f.dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    let result = f.service().reconcile(true, &[active()]);
    std::fs::set_permissions(&f.dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err());
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 0);
}

#[cfg(unix)]
#[test]
fn notifications_accepted_but_commit_failed_remains_uncertain_and_suppressed() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new(Permission::Granted);
    let dir = f.dir.clone();
    *f.adapter.on_submit.lock().unwrap() = Some(Box::new(move || {
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    }));
    assert!(f.service().reconcile(true, &[active()]).is_err());
    std::fs::set_permissions(&f.dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(f.ledger().records[0].state, DeliveryState::Attempted);
    f.service().reconcile(true, &[active()]).unwrap();
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
}

#[test]
fn notifications_retry_receipt_counts_only_newly_authorized_failures() {
    let f = Fixture::new(Permission::Granted);
    let service = f.service();
    assert_eq!(serde_json::to_value(service.allow_failed_retry().unwrap()).unwrap(), serde_json::json!(0));
    assert!(!f.path().exists(), "zero retry must not create a ledger");
    f.adapter.fail.store(true, Ordering::SeqCst);
    service.reconcile(true, &[active()]).unwrap();
    let revision = f.ledger().retry_revision;
    assert_eq!(serde_json::to_value(service.allow_failed_retry().unwrap()).unwrap(), serde_json::json!(1));
    assert_eq!(f.ledger().retry_revision, revision + 1);
    let pending = std::fs::read(f.path()).unwrap();
    assert_eq!(serde_json::to_value(service.allow_failed_retry().unwrap()).unwrap(), serde_json::json!(0));
    assert_eq!(std::fs::read(f.path()).unwrap(), pending, "pending retry cannot be reauthorized");
    service.reconcile(true, &[active()]).unwrap();
    assert_eq!(serde_json::to_value(service.allow_failed_retry().unwrap()).unwrap(), serde_json::json!(1));
}

#[test]
fn notifications_retry_does_not_revise_accepted_or_uncertain_records() {
    for uncertain in [false, true] {
        let f = Fixture::new(Permission::Granted);
        f.adapter.uncertain.store(uncertain, Ordering::SeqCst);
        let service = f.service();
        service.reconcile(true, &[active()]).unwrap();
        let before = std::fs::read(f.path()).unwrap();
        assert_eq!(serde_json::to_value(service.allow_failed_retry().unwrap()).unwrap(), serde_json::json!(0));
        assert_eq!(std::fs::read(f.path()).unwrap(), before);
        service.reconcile(true, &[active()]).unwrap();
        assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn notifications_delivery_status_tracks_durable_retry_pending_and_uncertain() {
    let f = Fixture::new(Permission::Granted);
    let service = f.service();
    let initial = service.delivery_status().unwrap();
    assert_eq!((initial.retryable_count, initial.pending_count, initial.uncertain_count), (0, 0, 0));
    assert!(initial.error.is_none());
    f.adapter.fail.store(true, Ordering::SeqCst);
    service.reconcile(true, &[active()]).unwrap();
    let failed = service.delivery_status().unwrap();
    assert_eq!((failed.retryable_count, failed.pending_count, failed.uncertain_count), (1, 0, 0));
    assert_eq!(failed.error.unwrap().message, "OS submission rejected: fixture=true");
    service.allow_failed_retry().unwrap();
    let pending = f.service().delivery_status().unwrap();
    assert_eq!((pending.retryable_count, pending.pending_count, pending.uncertain_count), (0, 1, 0));
    assert_eq!(pending.error.unwrap().code, "FAKE_SUBMIT");
    service.reconcile(false, &[]).unwrap();
    assert!(service.delivery_status().unwrap().error.is_some());
    f.adapter.fail.store(false, Ordering::SeqCst);
    f.adapter.uncertain.store(true, Ordering::SeqCst);
    service.reconcile(true, &[active()]).unwrap();
    let uncertain = f.service().delivery_status().unwrap();
    assert_eq!((uncertain.retryable_count, uncertain.pending_count, uncertain.uncertain_count), (0, 0, 1));
    assert!(uncertain.error.is_some());
    assert_eq!(service.allow_failed_retry().unwrap(), 0);
    service.reconcile(false, &[NotificationEvent::Recovered { identity: notice().identity }]).unwrap();
    let recovered = service.delivery_status().unwrap();
    assert!(recovered.error.is_none());
    assert_eq!(recovered.uncertain_count, 0);
}

#[test]
fn notifications_acceptance_and_recovery_clear_only_the_relevant_delivery_error() {
    let f = Fixture::new(Permission::Granted);
    let service = f.service();
    let mut other = notice();
    other.identity = "b".repeat(64);
    other.problem = NotificationProblem::Offline;
    f.adapter.fail.store(true, Ordering::SeqCst);
    service.reconcile(true, &[active(), NotificationEvent::Problem { notice: other.clone(), eligible: true }]).unwrap();
    service.allow_failed_retry().unwrap();
    f.adapter.fail.store(false, Ordering::SeqCst);
    service.reconcile(true, &[active()]).unwrap();
    let remaining = service.delivery_status().unwrap();
    assert_eq!(remaining.pending_count, 1);
    assert_eq!(remaining.error.unwrap().message, "OS submission rejected: fixture=true");
    service.reconcile(false, &[NotificationEvent::Recovered { identity: other.identity }]).unwrap();
    assert!(service.delivery_status().unwrap().error.is_none());
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 3);
}

#[test]
fn notifications_concurrent_retry_accepts_each_definite_failure_once() {
    let f = Fixture::new(Permission::Granted);
    let service = Arc::new(f.service());
    f.adapter.fail.store(true, Ordering::SeqCst);
    service.reconcile(true, &[active()]).unwrap();
    let workers: Vec<_> = (0..8).map(|_| {
        let service = service.clone();
        std::thread::spawn(move || service.allow_failed_retry().unwrap())
    }).collect();
    let accepted: usize = workers.into_iter().map(|worker| worker.join().unwrap()).sum();
    assert_eq!(accepted, 1);
    assert_eq!(service.delivery_status().unwrap().pending_count, 1);
}

#[cfg(unix)]
#[test]
fn notifications_retry_commit_failure_reports_uncertain_instead_of_previous_rejection() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new(Permission::Granted);
    let service = f.service();
    f.adapter.fail.store(true, Ordering::SeqCst);
    service.reconcile(true, &[active()]).unwrap();
    service.allow_failed_retry().unwrap();
    f.adapter.fail.store(false, Ordering::SeqCst);
    let dir = f.dir.clone();
    *f.adapter.on_submit.lock().unwrap() = Some(Box::new(move || {
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    }));
    let error = service.reconcile(true, &[active()]).unwrap_err();
    std::fs::set_permissions(&f.dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(error.code, "NOTIFICATION_LEDGER_IO");
    let status = service.delivery_status().unwrap();
    assert_eq!((status.retryable_count, status.pending_count, status.uncertain_count), (0, 0, 1));
    assert_eq!(status.error.unwrap().code, "NOTIFICATION_SUBMISSION_UNCERTAIN");
    assert_eq!(service.allow_failed_retry().unwrap(), 0);
}

#[test]
fn notifications_status_is_read_only_and_zero_retry_works_at_revision_limit() {
    let f = Fixture::new(Permission::Granted);
    let service = f.service();
    service.reconcile(true, &[active()]).unwrap();
    let mut ledger = f.ledger();
    ledger.retry_revision = MAX_RETRY_REVISION;
    write_ledger(&f.path(), &ledger).unwrap();
    let before = std::fs::read(f.path()).unwrap();
    f.adapter.query_fail.store(true, Ordering::SeqCst);
    assert!(service.delivery_status().unwrap().error.is_none());
    assert_eq!(service.allow_failed_retry().unwrap(), 0);
    assert_eq!(std::fs::read(f.path()).unwrap(), before);
    assert_eq!(f.adapter.requests.load(Ordering::SeqCst), 0);
    assert_eq!(f.adapter.submissions.load(Ordering::SeqCst), 1);
}
