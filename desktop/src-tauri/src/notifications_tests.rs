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
    }
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
        Some(NotificationPage::Accounts)
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
        Some(NotificationPage::Diagnostics)
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
