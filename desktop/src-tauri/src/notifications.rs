//! Native notification submission is separate from S1's application reminder gate.
//! The caller supplies S1's stable problem identity, eligibility and explicit recovery.
use crate::lifecycle::{NativeLanguage, NativeLocale};
use crate::protocol::BridgeError;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    Granted,
    Denied,
    Prompt,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationPlatform {
    Openai,
    Claude,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationProblem {
    AuthorizationRejected,
    ConfirmationRequired,
    Offline,
    QuotaExhausted,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationPage {
    Accounts,
    Diagnostics,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Notice {
    pub identity: String,
    pub platform: NotificationPlatform,
    pub problem: NotificationProblem,
    #[serde(default)]
    pub source: Option<NotificationSource>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationSource {
    pub profile_id: String,
    pub origin: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NotificationTarget {
    pub page: NotificationPage,
    pub source: Option<NotificationSource>,
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct NotificationActivation {
    pub target: NotificationTarget,
    pub current_profile: Option<String>,
    pub can_navigate: bool,
}
pub(crate) fn activate_target(target: NotificationTarget, profiles: Option<&crate::profiles::ProfileStore>) -> NotificationActivation {
    // Read the durable owner at OS activation, independent of a delayed UI
    // snapshot or the management process that originally submitted the notice.
    let current_profile = match profiles.map(|p| p.snapshot()).transpose() {
        Ok(snapshot) => snapshot.and_then(|p| p.current_profile),
        Err(cause) => {
            eprintln!("notification activation current profile read failed: {}: {}", cause.code, cause.message);
            None
        }
    };
    let can_navigate = target.source.as_ref().is_none_or(|source| current_profile.as_deref() == Some(&source.profile_id));
    NotificationActivation { target, current_profile, can_navigate }
}
#[derive(Clone, Debug)]
pub enum NotificationEvent {
    Problem { notice: Notice, eligible: bool },
    Recovered { identity: String },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubmissionReceipt {
    Accepted,
}
#[derive(Debug)]
pub struct SubmissionFailure {
    pub error: BridgeError,
    pub uncertain: bool,
}
impl SubmissionFailure {
    fn rejected(error: BridgeError) -> Self {
        Self {
            error,
            uncertain: false,
        }
    }
    fn uncertain(error: BridgeError) -> Self {
        Self {
            error,
            uncertain: true,
        }
    }
}
pub trait NotificationAdapter: Send + Sync {
    fn permission(&self) -> Result<Permission, BridgeError>;
    fn request_permission(&self) -> Result<(), BridgeError>;
    fn submit(&self, notice: &Notice) -> Result<SubmissionReceipt, SubmissionFailure>;
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Attempted,
    Accepted,
    Failed,
}
#[derive(Clone, Debug, Serialize)]
pub struct DeliveryOutcome {
    pub identity: String,
    pub state: DeliveryState,
    pub error: Option<BridgeError>,
}
#[derive(Clone, Debug, Serialize)]
pub struct DeliveryStatus {
    pub error: Option<BridgeError>,
    pub retryable_count: usize,
    pub pending_count: usize,
    pub uncertain_count: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeliveryRecord {
    notice: Notice,
    state: DeliveryState,
    attempt_revision: u64,
    #[serde(deserialize_with = "required_nullable")]
    error_code: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ledger {
    version: u32,
    retry_revision: u64,
    #[serde(deserialize_with = "required_nullable")]
    permission: Option<Permission>,
    records: Vec<DeliveryRecord>,
}
fn required_nullable<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
impl Default for Ledger {
    fn default() -> Self {
        Self {
            version: 1,
            retry_revision: 0,
            permission: None,
            records: vec![],
        }
    }
}
pub struct NotificationService {
    path: PathBuf,
    adapter: Arc<dyn NotificationAdapter>,
    gate: Mutex<HashMap<String, BridgeError>>,
}
impl NotificationService {
    pub fn new(path: PathBuf, adapter: Arc<dyn NotificationAdapter>) -> Self {
        Self {
            path,
            adapter,
            gate: Mutex::new(HashMap::new()),
        }
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, BridgeError>>, BridgeError> {
        self.gate.lock().map_err(|_| {
            failure(
                "NOTIFICATION_LOCK",
                "notification gate poisoned; reconciliation blocked until application restart",
            )
        })
    }
    pub fn permission(&self) -> Result<Permission, BridgeError> {
        let _gate = self.lock()?;
        let mut ledger = read_ledger(&self.path)?;
        self.observe_permission(&mut ledger)
    }
    pub fn enable(&self) -> Result<Permission, BridgeError> {
        let _gate = self.lock()?;
        let mut ledger = read_ledger(&self.path)?;
        if self.observe_permission(&mut ledger)? == Permission::Prompt {
            self.adapter.request_permission()?;
            return self.observe_permission(&mut ledger);
        }
        Ok(ledger.permission.expect("observed permission"))
    }
    /// Explicit user action can retry definite rejection; uncertain attempts and accepted
    /// submissions remain suppressed until S1 reports authoritative recovery.
    pub fn allow_failed_retry(&self) -> Result<usize, BridgeError> {
        let _gate = self.lock()?;
        let mut ledger = read_ledger(&self.path)?;
        let count = ledger.records.iter().filter(|record| {
            record.state == DeliveryState::Failed && record.attempt_revision == ledger.retry_revision
        }).count();
        if count == 0 {
            return Ok(0);
        }
        bump_retry(&mut ledger)?;
        write_ledger(&self.path, &ledger)?;
        Ok(count)
    }
    /// Counts and diagnostic selection share the same gate as retry and submission.
    /// Reading status never queries permission or authorizes an external side effect.
    pub fn delivery_status(&self) -> Result<DeliveryStatus, BridgeError> {
        let errors = self.lock()?;
        let ledger = read_ledger(&self.path)?;
        let mut status = DeliveryStatus {
            error: None,
            retryable_count: 0,
            pending_count: 0,
            uncertain_count: 0,
        };
        for record in &ledger.records {
            match record.state {
                DeliveryState::Accepted => continue,
                DeliveryState::Attempted => status.uncertain_count += 1,
                DeliveryState::Failed if record.attempt_revision == ledger.retry_revision => status.retryable_count += 1,
                DeliveryState::Failed => status.pending_count += 1,
            }
            if status.error.is_none() {
                status.error = Some(errors.get(&record.notice.identity).cloned().unwrap_or_else(|| {
                    failure(
                        record.error_code.as_deref().unwrap_or("NOTIFICATION_SUBMISSION_UNCERTAIN"),
                        format!("persisted notification delivery unresolved: state={:?} attempt_revision={} retry_revision={}; full native diagnostic is not stored in the durable ledger; retry_authorized={}", record.state, record.attempt_revision, ledger.retry_revision, record.state == DeliveryState::Failed && record.attempt_revision < ledger.retry_revision),
                    )
                }));
            }
        }
        Ok(status)
    }
    fn observe_permission(&self, ledger: &mut Ledger) -> Result<Permission, BridgeError> {
        let actual = self.adapter.permission()?;
        if ledger.permission != Some(actual) {
            if ledger.permission.is_some() {
                bump_retry(ledger)?;
            }
            ledger.permission = Some(actual);
            write_ledger(&self.path, ledger)?;
        }
        Ok(actual)
    }
    pub fn reconcile(
        &self,
        enabled: bool,
        events: &[NotificationEvent],
    ) -> Result<Vec<DeliveryOutcome>, BridgeError> {
        let mut errors = self.lock()?;
        let mut ledger = read_ledger(&self.path)?;
        let mut identities = HashSet::new();
        if events.len() > 256 {
            return Err(failure(
                "NOTIFICATION_INPUT",
                format!("notification events={} limit=256", events.len()),
            ));
        }
        // Validate the entire batch before recording recovery or submitting anything.
        for event in events {
            let identity = match event {
                NotificationEvent::Problem { notice, .. } => {
                    validate_source(notice.source.as_ref())?;
                    if ledger
                        .records
                        .iter()
                        .any(|r| r.notice.identity == notice.identity
                            && (r.notice.platform != notice.platform
                                || r.notice.problem != notice.problem
                                || r.notice.source.is_some() && r.notice.source != notice.source))
                    {
                        return Err(failure("NOTIFICATION_IDENTITY","stable notification identity reused for different platform/problem/source; original ledger preserved"));
                    }
                    &notice.identity
                }
                NotificationEvent::Recovered { identity } => identity,
            };
            validate_identity(identity)?;
            if !identities.insert(identity) {
                return Err(failure(
                    "NOTIFICATION_INPUT",
                    "duplicate/conflicting notification identity in one event batch",
                ));
            }
        }
        let before = ledger.records.len();
        ledger.records.retain(|r|!events.iter().any(|e|matches!(e,NotificationEvent::Recovered{identity} if identity==&r.notice.identity)));
        if before != ledger.records.len() {
            write_ledger(&self.path, &ledger)?;
            errors.retain(|identity, _| ledger.records.iter().any(|r| &r.notice.identity == identity));
        }
        // Recovery is durable even when disabled or when the OS query is unavailable.
        if !enabled {
            return Ok(vec![]);
        }
        if self.observe_permission(&mut ledger)? != Permission::Granted {
            return Ok(vec![]);
        }
        let mut outcomes = Vec::new();
        for event in events {
            let NotificationEvent::Problem {
                notice,
                eligible: true,
            } = event
            else {
                continue;
            };
            let index = ledger
                .records
                .iter()
                .position(|r| r.notice.identity == notice.identity);
            if let Some(index) = index {
                let record = &ledger.records[index];
                if record.state != DeliveryState::Failed
                    || record.attempt_revision == ledger.retry_revision
                {
                    continue;
                }
            } else if ledger.records.len() >= 128 {
                return Err(failure("NOTIFICATION_LEDGER_LIMIT","active notification delivery records=128 limit=128; await explicit S1 recovery"));
            }
            let attempted = DeliveryRecord {
                notice: notice.clone(),
                state: DeliveryState::Attempted,
                attempt_revision: ledger.retry_revision,
                error_code: None,
            };
            let index = match index {
                Some(index) => {
                    ledger.records[index] = attempted;
                    index
                }
                None => {
                    ledger.records.push(attempted);
                    ledger.records.len() - 1
                }
            };
            // This write must finish before any external side effect.
            write_ledger(&self.path, &ledger)?;
            // The previous definite rejection no longer describes this attempt.
            // If the final write fails, durable Attempted must report uncertainty.
            errors.remove(&notice.identity);
            let error = match self.adapter.submit(notice) {
                Ok(SubmissionReceipt::Accepted) => {
                    ledger.records[index].state = DeliveryState::Accepted;
                    None
                }
                Err(rejection) => {
                    if !rejection.uncertain {
                        ledger.records[index].state = DeliveryState::Failed;
                        ledger.records[index].error_code = Some(rejection.error.code.clone());
                    }
                    Some(rejection.error)
                }
            };
            // An error still leaves a durable attempt or terminal record, suppressing blind resend.
            if let Some(error) = &error {
                errors.insert(notice.identity.clone(), error.clone());
            }
            write_ledger(&self.path, &ledger)?;
            if error.is_none() {
                errors.remove(&notice.identity);
            }
            outcomes.push(DeliveryOutcome {
                identity: notice.identity.clone(),
                state: ledger.records[index].state,
                error,
            });
        }
        Ok(outcomes)
    }
}
const MAX_LEDGER: u64 = 65536;
const MAX_RETRY_REVISION: u64 = 9_007_199_254_740_991;
fn validate_identity(identity: &str) -> Result<(), BridgeError> {
    if identity.len() == 64
        && identity
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err(failure(
            "NOTIFICATION_IDENTITY",
            format!(
                "notification identity rejected: bytes={} required=64 lowercase hexadecimal digest",
                identity.len()
            ),
        ))
    }
}
fn bump_retry(ledger: &mut Ledger) -> Result<(), BridgeError> {
    ledger.retry_revision = ledger
        .retry_revision
        .checked_add(1)
        .filter(|n| *n <= MAX_RETRY_REVISION)
        .ok_or_else(|| {
            failure(
                "NOTIFICATION_REVISION",
                "notification retry revision exhausted safe integer range",
            )
        })?;
    Ok(())
}
fn validate_ledger(ledger: &Ledger) -> Result<(), BridgeError> {
    if ledger.version != 1
        || ledger.records.len() > 128
        || ledger.retry_revision > MAX_RETRY_REVISION
    {
        return Err(failure("NOTIFICATION_LEDGER_SCHEMA",format!("notification ledger limits rejected: version={} records={} retry_revision={}; required=version1 records<=128 safe revision",ledger.version,ledger.records.len(),ledger.retry_revision)));
    }
    let mut identities = HashSet::new();
    for record in &ledger.records {
        validate_identity(&record.notice.identity)?;
        validate_source(record.notice.source.as_ref())?;
        let code_valid = record.error_code.as_ref().is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 64
                && s.bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
        });
        if !identities.insert(&record.notice.identity)
            || record.attempt_revision > ledger.retry_revision
            || (record.state == DeliveryState::Failed) != code_valid
            || (record.state != DeliveryState::Failed && record.error_code.is_some())
        {
            return Err(failure("NOTIFICATION_LEDGER_SCHEMA","notification ledger duplicate identity or inconsistent attempt/error state; original preserved"));
        }
    }
    Ok(())
}
fn io_failure(stage: &str, cause: std::io::Error) -> BridgeError {
    failure(
        "NOTIFICATION_LEDGER_IO",
        format!(
            "{stage} failed: kind={:?} os_code={:?}",
            cause.kind(),
            cause.raw_os_error()
        ),
    )
}
fn read_ledger(path: &Path) -> Result<Ledger, BridgeError> {
    let bytes = match crate::preferences::protected_read_bounded(path, MAX_LEDGER) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Ledger::default()),
        Err(e) => return Err(io_failure("read protected notification ledger", e)),
    };
    let ledger: Ledger = serde_json::from_slice(&bytes).map_err(|e| {
        failure(
            "NOTIFICATION_LEDGER_SCHEMA",
            format!(
                "notification JSON rejected: line={} column={}; original preserved",
                e.line(),
                e.column()
            ),
        )
    })?;
    validate_ledger(&ledger)?;
    Ok(ledger)
}
fn write_ledger(path: &Path, ledger: &Ledger) -> Result<(), BridgeError> {
    validate_ledger(ledger)?;
    let bytes = serde_json::to_vec(ledger).map_err(|_| {
        failure(
            "NOTIFICATION_LEDGER_SCHEMA",
            "serialize notification ledger failed",
        )
    })?;
    if bytes.len() > MAX_LEDGER as usize {
        return Err(failure(
            "NOTIFICATION_LEDGER_LIMIT",
            format!(
                "notification ledger bytes={} limit={MAX_LEDGER}",
                bytes.len()
            ),
        ));
    }
    crate::preferences::private_write(path, &bytes)
        .map_err(|e| io_failure("atomically write notification ledger", e))?;
    if read_ledger(path)? != *ledger {
        return Err(failure("NOTIFICATION_LEDGER_READBACK","notification ledger readback differs from attempted write; no further submission allowed in this operation"));
    }
    Ok(())
}
fn failure(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError {
        details: None,
        code: code.into(),
        message: message.into(),
    }
}
impl Notice {
    fn page(&self) -> NotificationPage {
        if self.problem == NotificationProblem::Offline {
            NotificationPage::Diagnostics
        } else {
            NotificationPage::Accounts
        }
    }
    fn title(&self) -> &'static str {
        match self.platform {
            NotificationPlatform::Openai => "Bee · OpenAI",
            NotificationPlatform::Claude => "Bee · Claude",
        }
    }
    fn body(&self, locale: NativeLocale) -> String {
        let text = self.problem_body(locale);
        match &self.source {
            Some(source) if locale == NativeLocale::Zh => format!("Hive：{}\n{text}", source.origin),
            Some(source) => format!("Hive: {}\n{text}", source.origin),
            None => text.into(),
        }
    }
    fn target(&self) -> NotificationTarget {
        NotificationTarget { page: self.page(), source: self.source.clone() }
    }
    fn problem_body(&self, locale: NativeLocale) -> &'static str {
        if locale == NativeLocale::Zh {
            return match self.problem {
                NotificationProblem::AuthorizationRejected => {
                    "账号授权被拒绝，请打开 AI 账号核对。"
                }
                NotificationProblem::ConfirmationRequired => "账号变更待确认，请打开 AI 账号核对。",
                NotificationProblem::Offline => "Bee 持续离线，请打开诊断核对。",
                NotificationProblem::QuotaExhausted => "账号订阅额度已耗尽，请打开 AI 账号核对。",
            };
        }
        match self.problem {
            NotificationProblem::AuthorizationRejected => {
                "Account authorization was rejected. Open AI Accounts to review."
            }
            NotificationProblem::ConfirmationRequired => {
                "Account confirmation is required. Open AI Accounts to review."
            }
            NotificationProblem::Offline => {
                "Bee is persistently offline. Open Diagnostics to review."
            }
            NotificationProblem::QuotaExhausted => {
                "Account quota is exhausted. Open AI Accounts to review."
            }
        }
    }
}
fn click_route(notice: &Notice) -> String {
    let mut route = format!(
        "bee.{}.{}",
        match notice.page() {
            NotificationPage::Accounts => "accounts",
            NotificationPage::Diagnostics => "diagnostics",
        },
        notice.identity
    );
    if let Some(source) = &notice.source {
        let origin = source.origin.bytes().map(|b| format!("{b:02x}")).collect::<String>();
        route.push_str(&format!(".{}.{origin}", source.profile_id));
    }
    route
}
fn parse_click_route(route: &str) -> Option<NotificationTarget> {
    let mut parts = route.strip_prefix("bee.")?.split('.');
    let page = parts.next()?;
    let identity = parts.next()?;
    validate_identity(identity).ok()?;
    let page = match page {
        "accounts" => NotificationPage::Accounts,
        "diagnostics" => NotificationPage::Diagnostics,
        _ => return None,
    };
    let source = match parts.next() {
        None => None,
        Some(profile_id) => {
            let encoded = parts.next()?;
            if encoded.len() > 4096 || encoded.len() % 2 != 0 || !encoded.is_ascii() { return None; }
            let bytes = (0..encoded.len()).step_by(2).map(|i| u8::from_str_radix(&encoded[i..i+2], 16)).collect::<Result<Vec<_>,_>>().ok()?;
            let source = NotificationSource { profile_id: profile_id.into(), origin: String::from_utf8(bytes).ok()? };
            validate_source(Some(&source)).ok()?;
            Some(source)
        }
    };
    if parts.next().is_some() { return None; }
    Some(NotificationTarget { page, source })
}

fn validate_source(source: Option<&NotificationSource>) -> Result<(), BridgeError> {
    if let Some(source) = source {
        if !crate::startup_recovery::digest(&source.profile_id, 32)
            || source.origin.len() > 2048
            || crate::hive_origin::normalize_hive_origin(&source.origin).ok().as_ref() != Some(&source.origin)
        {
            return Err(failure("NOTIFICATION_INPUT", format!("notification source rejected: profile_id_valid={} origin_bytes={}; required=internal profile ID and canonical public Hive origin",crate::startup_recovery::digest(&source.profile_id,32),source.origin.len())));
        }
    }
    Ok(())
}
type Navigate = Arc<dyn Fn(NotificationTarget) + Send + Sync>;
pub struct NativeNotificationAdapter {
    inner: native::Adapter,
    language: Arc<NativeLanguage>,
}
impl NativeNotificationAdapter {
    /// Construction is inert. Native permission queries and submissions happen only
    /// through the service on a blocking worker, never on the WebView's event loop.
    pub fn new(
        app_identifier: String,
        on_navigate: Navigate,
        language: Arc<NativeLanguage>,
    ) -> Self {
        Self {
            inner: native::Adapter::new(app_identifier, on_navigate),
            language,
        }
    }
}
impl NotificationAdapter for NativeNotificationAdapter {
    fn permission(&self) -> Result<Permission, BridgeError> {
        self.inner.permission()
    }
    fn request_permission(&self) -> Result<(), BridgeError> {
        self.inner.request_permission()
    }
    fn submit(&self, notice: &Notice) -> Result<SubmissionReceipt, SubmissionFailure> {
        validate_identity(&notice.identity).map_err(SubmissionFailure::rejected)?;
        validate_source(notice.source.as_ref()).map_err(SubmissionFailure::rejected)?;
        let locale=self.language.current().ok_or_else(||SubmissionFailure::rejected(failure("NATIVE_LOCALE_UNCONFIRMED","notification submission requires confirmed App language; no OS submission performed")))?;
        self.inner.submit(notice, locale)
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use block2::{DynBlock, RcBlock};
    use objc2::{
        define_class, msg_send,
        rc::Retained,
        runtime::{Bool, ProtocolObject},
        AnyThread, DefinedClass,
    };
    use objc2_foundation::{NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
    use objc2_user_notifications::*;
    use std::{ptr::NonNull, sync::mpsc, time::Duration};

    struct DelegateState {
        navigate: Navigate,
    }
    define_class!(
        // SAFETY: NSObject has no subclass invariants. Ivars are immutable after init.
        #[unsafe(super(NSObject))]
        #[name = "BeeNativeNotificationDelegate"]
        #[ivars = DelegateState]
        struct Delegate;
        unsafe impl NSObjectProtocol for Delegate {}
        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List,));
            }
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn respond(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &DynBlock<dyn Fn()>,
            ) {
                // Only the default user activation navigates. Dismiss/custom actions do nothing.
                if &*response.actionIdentifier() == unsafe { UNNotificationDefaultActionIdentifier }
                {
                    if let Some(page) = parse_click_route(
                        &response.notification().request().identifier().to_string(),
                    ) {
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            (self.ivars().navigate)(page)
                        }));
                    }
                }
                completion.call(());
            }
        }
    );
    // SAFETY: Delegate has only immutable Send+Sync callback state. NSObject retain/release
    // and weak references support concurrent access; no mutable NSObject state is exposed.
    unsafe impl Send for Delegate {}
    unsafe impl Sync for Delegate {}
    impl Delegate {
        fn new(navigate: Navigate) -> Retained<Self> {
            let allocated = Self::alloc().set_ivars(DelegateState { navigate });
            unsafe { msg_send![super(allocated), init] }
        }
    }
    pub(super) struct Adapter {
        app_identifier: String,
        navigate: Navigate,
        // UNUserNotificationCenter.delegate is weak, so retain it for this app service.
        delegate: Mutex<Option<Retained<Delegate>>>,
    }
    impl Adapter {
        pub(super) fn new(app_identifier: String, navigate: Navigate) -> Self {
            Self {
                app_identifier,
                navigate,
                delegate: Mutex::new(None),
            }
        }
        fn center(&self) -> Result<Retained<UNUserNotificationCenter>, BridgeError> {
            let bundle_identifier = NSBundle::mainBundle().bundleIdentifier();
            if bundle_identifier.as_ref().map(|s| s.to_string()).as_deref()
                != Some(self.app_identifier.as_str())
            {
                // Calling currentNotificationCenter outside a real application bundle can
                // raise an Objective-C exception, so reject before invoking it.
                return Err(failure("NOTIFICATION_APP_IDENTITY", format!("NSBundle identifier check failed: bundle_identifier_present={} identifier_matches=false; required=packaged Bee application",bundle_identifier.is_some())));
            }
            let center = UNUserNotificationCenter::currentNotificationCenter();
            let mut delegate = self.delegate.lock().map_err(|_| {
                failure(
                    "NOTIFICATION_LOCK",
                    "macOS notification delegate lock poisoned",
                )
            })?;
            let delegate = delegate.get_or_insert_with(|| Delegate::new(self.navigate.clone()));
            center.setDelegate(Some(ProtocolObject::from_ref::<Delegate>(&*delegate)));
            Ok(center)
        }
        pub(super) fn permission(&self) -> Result<Permission, BridgeError> {
            let center = self.center()?;
            let (sender, receiver) = mpsc::sync_channel(1);
            let block = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                let status = unsafe { settings.as_ref() }.authorizationStatus().0;
                let result = match status {
                    0 => Ok(Permission::Prompt),
                    1 => Ok(Permission::Denied),
                    2..=4 => Ok(Permission::Granted),
                    _ => Err(failure("NOTIFICATION_PERMISSION",format!("UNNotificationSettings authorizationStatus={status}; required=known status 0..4"))),
                };
                let _ = sender.send(result);
            });
            center.getNotificationSettingsWithCompletionHandler(&block);
            receiver.recv_timeout(Duration::from_secs(15)).map_err(|e|failure("NOTIFICATION_PERMISSION",format!("UNUserNotificationCenter settings callback missing: {e}; timeout_seconds=15")))?
        }
        pub(super) fn request_permission(&self) -> Result<(), BridgeError> {
            let center = self.center()?;
            let (sender, receiver) = mpsc::sync_channel(1);
            let block = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
                let result = native_error("requestAuthorization", error).map_or(Ok(()), Err);
                let _ = sender.send(result);
            });
            center.requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &block,
            );
            // Ignore the boolean and re-query actual settings in NotificationService::enable.
            receiver.recv_timeout(Duration::from_secs(60)).map_err(|e|failure("NOTIFICATION_PERMISSION",format!("UNUserNotificationCenter authorization callback missing: {e}; timeout_seconds=60")))?
        }
        pub(super) fn submit(
            &self,
            notice: &Notice,
            locale: NativeLocale,
        ) -> Result<SubmissionReceipt, SubmissionFailure> {
            let center = self.center().map_err(SubmissionFailure::rejected)?;
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(notice.title()));
            content.setBody(&NSString::from_str(&notice.body(locale)));
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(&click_route(notice)),
                &content,
                None,
            );
            let (sender, receiver) = mpsc::sync_channel(1);
            let block = RcBlock::new(move |error: *mut NSError| {
                let result = native_error("addNotificationRequest", error)
                    .map_or(Ok(SubmissionReceipt::Accepted), |e| {
                        Err(SubmissionFailure::rejected(e))
                    });
                let _ = sender.send(result);
            });
            center.addNotificationRequest_withCompletionHandler(&request, Some(&block));
            receiver.recv_timeout(Duration::from_secs(15)).map_err(|e|SubmissionFailure::uncertain(failure("NOTIFICATION_SUBMISSION_UNCERTAIN",format!("UNUserNotificationCenter submission callback missing: {e}; timeout_seconds=15; OS acceptance unknown"))))?
        }
    }
    fn native_error(operation: &str, error: *mut NSError) -> Option<BridgeError> {
        // NSError descriptions can include personal paths; retain known native domains
        // and the concrete code without forwarding localized remote text.
        unsafe { error.as_ref() }.map(|e| {
            let domain=e.domain().to_string();
            let domain=match domain.as_str() {
                "UNErrorDomain"|"NSCocoaErrorDomain"|"NSPOSIXErrorDomain"|"NSOSStatusErrorDomain"=>domain.as_str(),
                _=>"other",
            };
            failure(
                "NOTIFICATION_NATIVE",
                format!(
                    "UNUserNotificationCenter {operation} rejected: NSError domain={domain} code={}",
                    e.code()
                ),
            )
        })
    }
}

#[cfg(target_os = "linux")]
use linux_native as native;
// Also type-check the Linux binding in macOS tests without opening a session bus.
#[cfg(any(target_os = "linux", all(test, target_os = "macos")))]
#[allow(dead_code)]
mod linux_native {
    use super::*;
    use std::{
        collections::HashMap,
        sync::atomic::{AtomicBool, Ordering},
        time::{Duration, Instant},
    };
    use zbus::{
        blocking::{connection::Builder, Connection, MessageIterator},
        MatchRule,
    };
    const DEST: &str = "org.freedesktop.Notifications";
    const PATH: &str = "/org/freedesktop/Notifications";
    type Routes = Arc<Mutex<HashMap<u32, (String, NotificationTarget, Instant)>>>;
    #[derive(Clone)]
    struct Bus {
        connection: Connection,
        routes: Routes,
        alive: Arc<AtomicBool>,
    }
    struct ListenerAlive(Arc<AtomicBool>);
    impl Drop for ListenerAlive {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    pub(super) struct Adapter {
        app_identifier: String,
        navigate: Navigate,
        bus: Mutex<Option<Bus>>,
    }
    impl Adapter {
        pub(super) fn new(app_identifier: String, navigate: Navigate) -> Self {
            Self {
                app_identifier,
                navigate,
                bus: Mutex::new(None),
            }
        }
        fn bus(&self) -> Result<Bus, BridgeError> {
            let mut slot = self.bus.lock().map_err(|_| {
                failure(
                    "NOTIFICATION_LOCK",
                    "Linux notification connection lock poisoned",
                )
            })?;
            if let Some(bus) = slot.as_ref().filter(|b| b.alive.load(Ordering::SeqCst)) {
                return Ok(bus.clone());
            }
            let connection = Builder::session()
                .map_err(|e| db_error("connect session bus", e))?
                .method_timeout(Duration::from_secs(15))
                .build()
                .map_err(|e| db_error("authenticate session bus", e))?;
            let rule = MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .sender(DEST)
                .and_then(|r| r.interface(DEST))
                .and_then(|r| r.path(PATH))
                .map_err(|e| db_error("build notification signal match", e))?
                .build();
            let iterator = MessageIterator::for_match_rule(rule, &connection, Some(256))
                .map_err(|e| db_error("subscribe notification signals", e))?;
            let bus = Bus {
                connection,
                routes: Arc::new(Mutex::new(HashMap::new())),
                alive: Arc::new(AtomicBool::new(true)),
            };
            let routes = Arc::downgrade(&bus.routes);
            let navigate = self.navigate.clone();
            let connection = bus.connection.clone();
            let alive = bus.alive.clone();
            std::thread::Builder::new()
                .name("bee-notification-actions".into())
                .spawn(move || {
                    let _alive = ListenerAlive(alive);
                    for message in iterator {
                        let message = match message {
                            Ok(message) => message,
                            Err(e) => {
                                eprintln!("{}", db_error("receive notification signal", e).message);
                                break;
                            }
                        };
                        let Some(routes) = routes.upgrade() else {
                            break;
                        };
                        let header = message.header();
                        // MatchRule cannot locally resolve a well-known sender. Validate the
                        // unique owner against the bus before trusting an activation signal.
                        let Ok(owner) = server_owner(&connection) else {
                            continue;
                        };
                        if header.sender().map(|s| s.as_str()) != Some(owner.as_str()) {
                            continue;
                        }
                        match header.member().map(|m| m.as_str()) {
                            Some("ActionInvoked") => {
                                let Ok((id, action)) =
                                    message.body().deserialize::<(u32, String)>()
                                else {
                                    continue;
                                };
                                if action != "default" {
                                    continue;
                                }
                                let page = routes.lock().ok().and_then(|mut map| {
                                    if map.get(&id).is_some_and(|(sender, _, _)| sender == &owner) {
                                        map.remove(&id).map(|(_, page, _)| page)
                                    } else {
                                        None
                                    }
                                });
                                if let Some(page) = page {
                                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                                        || navigate(page),
                                    ));
                                }
                            }
                            Some("NotificationClosed") => {
                                let Ok((id, _)) = message.body().deserialize::<(u32, u32)>() else {
                                    continue;
                                };
                                if let Ok(mut map) = routes.lock() {
                                    if map.get(&id).is_some_and(|(sender, _, _)| sender == &owner) {
                                        map.remove(&id);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                })
                .map_err(|e| io_failure("spawn notification action listener", e))?;
            *slot = Some(bus.clone());
            Ok(bus)
        }
        pub(super) fn permission(&self) -> Result<Permission, BridgeError> {
            let bus = self.bus()?;
            // The FDO protocol has no per-app prompt API. Granted means this user bus
            // currently accepts notification API access, not that DND permits a banner.
            let message = match bus.connection.call_method(
                Some(DEST),
                PATH,
                Some(DEST),
                "GetCapabilities",
                &(),
            ) {
                Ok(message) => message,
                Err(zbus::Error::MethodError(name, _, _))
                    if name.as_str() == "org.freedesktop.DBus.Error.AccessDenied" =>
                {
                    return Ok(Permission::Denied)
                }
                Err(e) => return Err(db_error("GetCapabilities", e)),
            };
            let capabilities = message
                .body()
                .deserialize::<Vec<String>>()
                .map_err(|e| db_error("decode GetCapabilities", e))?;
            if !capabilities.iter().any(|c| c == "actions") {
                return Err(failure("NOTIFICATION_UNSUPPORTED","GetCapabilities actions=false; navigation-only notification actions unavailable"));
            }
            Ok(Permission::Granted)
        }
        pub(super) fn request_permission(&self) -> Result<(), BridgeError> {
            self.permission().map(|_| ())
        }
        pub(super) fn submit(
            &self,
            notice: &Notice,
            locale: NativeLocale,
        ) -> Result<SubmissionReceipt, SubmissionFailure> {
            let bus = self.bus().map_err(SubmissionFailure::rejected)?;
            let owner = server_owner(&bus.connection).map_err(SubmissionFailure::rejected)?;
            let mut routes = bus.routes.lock().map_err(|_| {
                SubmissionFailure::rejected(failure(
                    "NOTIFICATION_LOCK",
                    "Linux notification route map poisoned",
                ))
            })?;
            routes.retain(|_, (_, _, created)| created.elapsed() < Duration::from_secs(86_400));
            if routes.len() >= 128 {
                return Err(SubmissionFailure::rejected(failure(
                    "NOTIFICATION_CALLBACK_LIMIT",
                    "Linux active notification callbacks=128 limit=128",
                )));
            }
            if self.app_identifier.is_empty()
                || self.app_identifier.len() > 128
                || !self
                    .app_identifier
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
            {
                return Err(SubmissionFailure::rejected(failure("NOTIFICATION_APP_IDENTITY","Linux desktop-entry identifier rejected: required=bounded canonical application identifier")));
            }
            let actions = vec![
                "default",
                if locale == NativeLocale::Zh {
                    "打开 Bee"
                } else {
                    "Open Bee"
                },
            ];
            let hints = HashMap::from([(
                "desktop-entry",
                zbus::zvariant::Value::from(self.app_identifier.as_str()),
            )]);
            // Hold the routes lock until insertion so a fast signal cannot beat the receipt.
            let reply=bus.connection.call_method(Some(owner.as_str()),PATH,Some(DEST),"Notify",&("Bee",0u32,"",notice.title(),notice.body(locale),actions,hints,60_000i32)).map_err(|e| {
                let definite=matches!(&e,zbus::Error::MethodError(name,_,_) if matches!(name.as_str(),"org.freedesktop.DBus.Error.AccessDenied"|"org.freedesktop.DBus.Error.InvalidArgs"|"org.freedesktop.DBus.Error.UnknownMethod"|"org.freedesktop.DBus.Error.ServiceUnknown"|"org.freedesktop.DBus.Error.NameHasNoOwner"));
                let error=db_error("Notify",e);
                if definite { SubmissionFailure::rejected(error) } else { SubmissionFailure::uncertain(error) }
            })?;
            let id = reply
                .body()
                .deserialize::<u32>()
                .map_err(|e| SubmissionFailure::uncertain(db_error("decode Notify receipt", e)))?;
            if id == 0 {
                return Err(SubmissionFailure::uncertain(failure("NOTIFICATION_SUBMISSION_UNCERTAIN","Notify receipt server_id=0; required=positive server identifier; OS acceptance unknown")));
            }
            routes.insert(id, (owner, notice.target(), Instant::now()));
            Ok(SubmissionReceipt::Accepted)
        }
    }
    fn server_owner(connection: &Connection) -> Result<String, BridgeError> {
        connection
            .call_method(
                Some("org.freedesktop.DBus"),
                "/org/freedesktop/DBus",
                Some("org.freedesktop.DBus"),
                "GetNameOwner",
                &(DEST,),
            )
            .and_then(|r| r.body().deserialize::<String>())
            .map_err(|e| db_error("GetNameOwner notification service", e))
    }
    fn db_error(operation: &str, error: zbus::Error) -> BridgeError {
        // Bus addresses and remote error text can contain user paths. Preserve the real
        // failure variant, native I/O code or bounded protocol error name instead.
        let evidence = match error {
            zbus::Error::InputOutput(e) | zbus::Error::Connection(e, _) => {
                format!("kind={:?} os_code={:?}", e.kind(), e.raw_os_error())
            }
            zbus::Error::MethodError(name, _, _) => format!(
                "method_error={}",
                if name.as_str().starts_with("org.freedesktop.DBus.Error.")
                    && name.as_str().len() <= 128
                {
                    name.as_str()
                } else {
                    "other"
                }
            ),
            zbus::Error::Address(_) => "variant=Address".into(),
            zbus::Error::Handshake(_) => "variant=Handshake".into(),
            zbus::Error::InvalidReply => "variant=InvalidReply".into(),
            zbus::Error::Variant(_) => "variant=Variant".into(),
            zbus::Error::FDO(e) => {
                use zbus::DBusError;
                format!("fdo_error={}", e.name())
            }
            zbus::Error::Failure(_) => "variant=Failure".into(),
            zbus::Error::InvalidMatchRule => "variant=InvalidMatchRule".into(),
            other => format!("variant={:?}", std::mem::discriminant(&other)),
        };
        failure(
            "NOTIFICATION_DBUS",
            format!("org.freedesktop.Notifications {operation} failed: {evidence}"),
        )
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{
        collections::HashMap,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use windows::{
        core::{IInspectable, Interface, HSTRING},
        Data::Xml::Dom::XmlDocument,
        Foundation::{DateTime, IReference, PropertyValue, TypedEventHandler},
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        UI::Notifications::{
            ToastDismissedEventArgs, ToastFailedEventArgs, ToastNotification,
            ToastNotificationManager, ToastNotifier,
        },
    };
    type Toasts = Arc<Mutex<HashMap<String, (Instant, ToastNotification)>>>;
    pub(super) struct Adapter {
        app_identifier: String,
        navigate: Navigate,
        toasts: Toasts,
    }
    struct Apartment(bool);
    impl Apartment {
        fn enter() -> Result<Self, BridgeError> {
            match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
                Ok(()) => Ok(Self(true)),
                // An existing STA apartment is valid; do not uninitialize it.
                Err(e) if e.code().0 == 0x80010106u32 as i32 => Ok(Self(false)),
                Err(e) => Err(win_error("RoInitialize", e)),
            }
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            if self.0 {
                unsafe { RoUninitialize() }
            }
        }
    }
    impl Adapter {
        pub(super) fn new(app_identifier: String, navigate: Navigate) -> Self {
            Self {
                app_identifier,
                navigate,
                toasts: Arc::new(Mutex::new(HashMap::new())),
            }
        }
        fn notifier(&self) -> Result<ToastNotifier, BridgeError> {
            if self.app_identifier.is_empty() || self.app_identifier.len() > 128 {
                return Err(failure(
                    "NOTIFICATION_APP_IDENTITY",
                    "Windows AUMID rejected: required=nonempty application identifier <=128 bytes",
                ));
            }
            // Use only Bee's registered AUMID, never a PowerShell/system-app fallback.
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
                &self.app_identifier,
            ))
            .map_err(|e| win_error("CreateToastNotifierWithId", e))
        }
        pub(super) fn permission(&self) -> Result<Permission, BridgeError> {
            let _apartment = Apartment::enter()?;
            let setting = self
                .notifier()?
                .Setting()
                .map_err(|e| win_error("ToastNotifier.Setting", e))?
                .0;
            match setting {
                0 => Ok(Permission::Granted),
                1..=4 => Ok(Permission::Denied),
                _ => Err(failure(
                    "NOTIFICATION_PERMISSION",
                    format!(
                        "ToastNotifier.Setting={setting}; required=known NotificationSetting 0..4"
                    ),
                )),
            }
        }
        // Windows has no app notification authorization prompt API. The settings query
        // remains authoritative; UI can direct a denied user to Windows Settings.
        pub(super) fn request_permission(&self) -> Result<(), BridgeError> {
            self.permission().map(|_| ())
        }
        pub(super) fn submit(
            &self,
            notice: &Notice,
            locale: NativeLocale,
        ) -> Result<SubmissionReceipt, SubmissionFailure> {
            self.submit_inner(notice, locale).map_err(|error| {
                if error.code == "NOTIFICATION_SUBMISSION_UNCERTAIN" {
                    SubmissionFailure::uncertain(error)
                } else {
                    SubmissionFailure::rejected(error)
                }
            })
        }
        fn submit_inner(
            &self,
            notice: &Notice,
            locale: NativeLocale,
        ) -> Result<SubmissionReceipt, BridgeError> {
            let _apartment = Apartment::enter()?;
            let notifier = self.notifier()?;
            let document = XmlDocument::new().map_err(|e| win_error("XmlDocument.new", e))?;
            // Text uses fixed copy and a validated public origin; routes use hex.
            let xml=format!("<toast launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",click_route(notice),notice.title(),notice.body(locale));
            document
                .LoadXml(&HSTRING::from(xml))
                .map_err(|e| win_error("XmlDocument.LoadXml", e))?;
            let toast = ToastNotification::CreateToastNotification(&document)
                .map_err(|e| win_error("CreateToastNotification", e))?;
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| {
                failure(
                    "NOTIFICATION_CLOCK",
                    "Windows notification expiration check failed: clock_before_unix_epoch=true",
                )
            })?;
            let ticks = now
                .as_secs()
                .checked_add(11_644_473_600 + 86_400)
                .and_then(|s| s.checked_mul(10_000_000))
                .and_then(|n| i64::try_from(n).ok())
                .ok_or_else(|| {
                    failure(
                        "NOTIFICATION_CLOCK",
                        "Windows expiration ticks overflowed i64",
                    )
                })?;
            let expiration: IReference<DateTime> = PropertyValue::CreateDateTime(DateTime {
                UniversalTime: ticks,
            })
            .and_then(|v| v.cast())
            .map_err(|e| win_error("CreateDateTime expiration", e))?;
            toast
                .SetExpirationTime(&expiration)
                .map_err(|e| win_error("ToastNotification.SetExpirationTime", e))?;
            let route = click_route(notice);
            let navigate = self.navigate.clone();
            let target = notice.target();
            let routes = Arc::downgrade(&self.toasts);
            let activated_route = route.clone();
            toast
                .Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(
                    move |_, _| {
                        if let Some(routes) = routes.upgrade() {
                            if let Ok(mut routes) = routes.lock() {
                                routes.remove(&activated_route);
                            }
                        }
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            navigate(target.clone())
                        }));
                        Ok(())
                    },
                ))
                .map_err(|e| win_error("ToastNotification.Activated", e))?;
            let routes = Arc::downgrade(&self.toasts);
            let dismissed_route = route.clone();
            toast
                .Dismissed(&TypedEventHandler::<
                    ToastNotification,
                    ToastDismissedEventArgs,
                >::new(move |_, _| {
                    if let Some(routes) = routes.upgrade() {
                        if let Ok(mut routes) = routes.lock() {
                            routes.remove(&dismissed_route);
                        }
                    }
                    Ok(())
                }))
                .map_err(|e| win_error("ToastNotification.Dismissed", e))?;
            let immediate_failure = Arc::new(Mutex::new(None));
            let observed_failure = immediate_failure.clone();
            let routes = Arc::downgrade(&self.toasts);
            let failed_route = route.clone();
            toast.Failed(&TypedEventHandler::<ToastNotification,ToastFailedEventArgs>::new(move |_,args| {
                if let Some(args)=args.as_ref() {
                    if let Ok(code)=args.ErrorCode() {
                        if let Ok(mut failed)=observed_failure.lock() { *failed=Some(code.0); }
                        eprintln!("Windows ToastNotification.Failed: HRESULT=0x{:08x}; visibility unconfirmed",code.0 as u32);
                    }
                }
                if let Some(routes)=routes.upgrade() { if let Ok(mut routes)=routes.lock() { routes.remove(&failed_route); } }
                Ok(())
            })).map_err(|e|win_error("ToastNotification.Failed",e))?;
            {
                let mut toasts = self.toasts.lock().map_err(|_| {
                    failure(
                        "NOTIFICATION_LOCK",
                        "Windows notification callback map poisoned",
                    )
                })?;
                toasts.retain(|_, (created, _)| created.elapsed() < Duration::from_secs(86_400));
                if toasts.len() >= 128 {
                    return Err(failure(
                        "NOTIFICATION_CALLBACK_LIMIT",
                        "Windows active notification callbacks=128 limit=128",
                    ));
                }
                toasts.insert(route.clone(), (Instant::now(), toast.clone()));
            }
            if let Err(e) = notifier.Show(&toast) {
                if let Ok(mut toasts) = self.toasts.lock() {
                    toasts.remove(&route);
                }
                return Err(win_error("ToastNotifier.Show", e));
            }
            if let Some(code) = *immediate_failure.lock().map_err(|_| {
                failure(
                    "NOTIFICATION_SUBMISSION_UNCERTAIN",
                    "Windows immediate failure receipt lock poisoned after successful Show; final notification outcome unknown",
                )
            })? {
                return Err(failure(
                    "NOTIFICATION_NATIVE",
                    format!(
                        "ToastNotification.Failed during Show: HRESULT=0x{:08x}",
                        code as u32
                    ),
                ));
            }
            // Show's HRESULT confirms submission only, never display or user reading.
            Ok(SubmissionReceipt::Accepted)
        }
    }
    fn win_error(operation: &str, error: windows::core::Error) -> BridgeError {
        failure(
            "NOTIFICATION_NATIVE",
            format!(
                "Windows {operation} failed: HRESULT=0x{:08x}",
                error.code().0 as u32
            ),
        )
    }
}

#[cfg(test)]
#[path = "notifications_tests.rs"]
mod tests;
