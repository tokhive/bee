//! Consume fixed S1 facts from the owned bridge, independently of WebView lifetime.
use crate::{
    notifications::{
        DeliveryOutcome, Notice, NotificationEvent, NotificationPlatform, NotificationProblem,
        NotificationService,
    },
    preferences::{PreferencesSnapshot, PreferencesStore},
    protocol::BridgeError,
    sidecar::{Bridge, BridgePhase, BridgeReply, BridgeStatus},
};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashSet, sync::Mutex, time::Duration};
use tauri::Manager;

#[derive(Default)]
pub(crate) struct NotificationPollState {
    check: Mutex<(u64, Option<BridgeError>)>,
}
impl NotificationPollState {
    #[cfg(test)]
    fn check(&self) -> (u64, Option<BridgeError>) {
        self.check.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
    #[cfg(test)]
    pub fn error(&self) -> Option<BridgeError> {
        self.check().1
    }
    fn retain(&self, error: BridgeError) {
        self.complete(Err(error));
    }
    fn complete(&self, result: Result<(), BridgeError>) {
        let mut check = self.check.lock().unwrap_or_else(|p| p.into_inner());
        check.0 = check.0.saturating_add(1).min(9_007_199_254_740_991);
        check.1 = result.err();
    }
    pub fn delivery_status(&self, service: &NotificationService) -> Result<Value, BridgeError> {
        // A check receipt is published only once reconciliation has finished.
        // Hold this lock through the durable read so a newer completed check cannot
        // be combined with an older ledger snapshot.
        let check = self.check.lock().unwrap_or_else(|p| p.into_inner());
        let delivery = service.delivery_status()?;
        Ok(serde_json::json!({
            "error": check.1.as_ref().or(delivery.error.as_ref()),
            "retryable_count": delivery.retryable_count,
            "pending_count": delivery.pending_count,
            "uncertain_count": delivery.uncertain_count,
            "check_sequence": check.0,
        }))
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fact {
    identity: String,
    platform: NotificationPlatform,
    problem: NotificationProblem,
    active: bool,
    eligible: bool,
    recovered: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    facts: Vec<Fact>,
    observed_at: String,
    network_revision: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    notifications: Snapshot,
}
fn invalid(message: impl Into<String>) -> BridgeError {
    BridgeError {
        details: None,
        code: "NOTIFICATION_REPLY_INVALID".into(),
        message: message.into(),
    }
}
pub fn validate(value: &Value) -> Result<(), BridgeError> {
    decode(value).map(|_| ())
}
fn json_error(error: serde_json::Error) -> BridgeError {
    invalid(format!("notification fact JSON schema rejected at line={} column={} category={:?}; required=closed fixed schema", error.line(),error.column(),error.classify()))
}
fn digest(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn decode(value: &Value) -> Result<Snapshot, BridgeError> {
    if value.get("error").is_some() {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Failure {
            error: BridgeError,
        }
        let failure: Failure = serde_json::from_value(value.clone()).map_err(json_error)?;
        if failure.error.code != "NOTIFICATIONS_OPERATION_FAILED"
            || failure.error.message.is_empty()
            || failure.error.message.len() > 1024
        {
            return Err(invalid("notification operation failure envelope rejected; required=fixed failure code and bounded nonempty diagnostic message"));
        }
        return Err(failure.error);
    }
    let snapshot = serde_json::from_value::<Envelope>(value.clone())
        .map_err(json_error)?
        .notifications;
    if snapshot.network_revision > 9_007_199_254_740_991
        || !crate::runtime_protocol::timestamp(&snapshot.observed_at)
        || snapshot.facts.len() > 8
    {
        return Err(invalid(format!("notification snapshot limits rejected: facts={}; required=at most 8 facts, UTC observation time and safe network revision",snapshot.facts.len())));
    }
    let mut identities = HashSet::new();
    let mut problems = HashSet::new();
    let mut counts = [0; 2];
    for (index, fact) in snapshot.facts.iter().enumerate() {
        let platform = match fact.platform {
            NotificationPlatform::Openai => 0,
            NotificationPlatform::Claude => 1,
        };
        counts[platform] += 1;
        if !digest(&fact.identity, 64)
            || !identities.insert(&fact.identity)
            || !problems.insert((platform, fact.problem as u8))
            || fact.eligible && !fact.active
            || fact.recovered && fact.active
        {
            return Err(invalid(format!("notification fact rejected at index={index}; required=unique stable identity, unique platform/problem and coherent active/eligible/recovered flags")));
        }
    }
    if counts.iter().any(|count| *count != 0 && *count != 4) {
        return Err(invalid("notification platform facts incomplete; required=all four fixed problem facts for each selected platform"));
    }
    Ok(snapshot)
}
fn events(snapshot: Snapshot) -> Vec<NotificationEvent> {
    snapshot
        .facts
        .into_iter()
        .filter_map(|fact| {
            if fact.recovered {
                Some(NotificationEvent::Recovered {
                    identity: fact.identity,
                })
            } else if fact.active {
                Some(NotificationEvent::Problem {
                    notice: Notice {
                        identity: fact.identity,
                        platform: fact.platform,
                        problem: fact.problem,
                    },
                    eligible: fact.eligible,
                })
            } else {
                None
            }
        })
        .collect()
}
fn ready_instance(status: &BridgeStatus, startup_ready: bool) -> Result<Option<&str>, BridgeError> {
    if status.state == BridgePhase::Failed {
        return Err(status.error.clone().unwrap_or_else(||invalid("notification polling unavailable: management bridge failed without diagnostic evidence")));
    }
    if status.state != BridgePhase::Ready || !startup_ready {
        return Ok(None);
    }
    let instance=status.metadata.as_ref().map(|metadata|metadata.instance.as_str()).filter(|instance|digest(instance,32)).ok_or_else(||invalid("notification polling management identity rejected; required=ready bridge with verified instance"))?;
    Ok(Some(instance))
}
fn sampled(
    expected: &str,
    status: &BridgeStatus,
    startup_ready: bool,
    reply: &BridgeReply,
) -> Result<Snapshot, BridgeError> {
    if ready_instance(status, startup_ready)? != Some(expected)
        || reply.instance != expected
        || reply.protocol != 1
    {
        return Err(BridgeError{ details: None,code:"NOTIFICATION_SAMPLE_STALE".into(),message:"notification sample discarded: current management instance/startup gate differs from the ready instance that began this poll".into()});
    }
    decode(&reply.result)
}
fn apply(
    snapshot: Snapshot,
    preferences: PreferencesSnapshot,
    reconcile: impl FnOnce(bool, &[NotificationEvent]) -> Result<Vec<DeliveryOutcome>, BridgeError>,
) -> Result<(), BridgeError> {
    let enabled = preferences.error.is_none() && preferences.preferences.notifications_enabled;
    // Even a disabled or unreadable preference permits explicit recovery. Missing
    // facts never synthesize recovery and therefore cannot erase delivery history.
    // Delivery failures remain in NotificationService under their stable identity.
    // An empty/suppressed outcome is not evidence of successful delivery.
    reconcile(enabled, &events(snapshot))?;
    if let Some(error) = preferences.error {
        return Err(error);
    }
    Ok(())
}
fn apply_localized(
    snapshot: Snapshot,
    preferences: PreferencesSnapshot,
    locale: Option<crate::lifecycle::NativeLocale>,
    reconcile: impl FnOnce(bool, &[NotificationEvent]) -> Result<Vec<DeliveryOutcome>, BridgeError>,
) -> Result<(), BridgeError> {
    if locale.is_none() {
        return Ok(());
    }
    apply(snapshot, preferences, reconcile)
}
fn safe_code(code: &str) -> &str {
    // A shape check alone would still log caller-controlled uppercase data.
    // Unknown bridge codes stay available in retained state, never in logs.
    match code {
        "NOTIFICATION_LOCK"
        | "NOTIFICATION_INPUT"
        | "NOTIFICATION_IDENTITY"
        | "NOTIFICATION_LEDGER_LIMIT"
        | "NOTIFICATION_REVISION"
        | "NOTIFICATION_LEDGER_SCHEMA"
        | "NOTIFICATION_LEDGER_IO"
        | "NOTIFICATION_LEDGER_READBACK"
        | "NOTIFICATION_APP_IDENTITY"
        | "NOTIFICATION_PERMISSION"
        | "NOTIFICATION_SUBMISSION_UNCERTAIN"
        | "NOTIFICATION_NATIVE"
        | "NOTIFICATION_UNSUPPORTED"
        | "NOTIFICATION_CALLBACK_LIMIT"
        | "NOTIFICATION_DBUS"
        | "NOTIFICATION_CLOCK"
        | "NOTIFICATION_REPLY_INVALID"
        | "NOTIFICATION_SAMPLE_STALE"
        | "NOTIFICATION_WORKER_FAILED"
        | "NOTIFICATIONS_OPERATION_FAILED"
        | "PREFERENCES_SCHEMA"
        | "PREFERENCES_VERSION"
        | "PREFERENCES_IO"
        | "PREFERENCES_LOCK"
        | "PREFERENCES_REVISION"
        | "PREFERENCES_SCOPE"
        | "PREFERENCES_ORIGIN"
        | "PREFERENCES_PROXY" => code,
        _ => "NOTIFICATION_POLL_FAILED",
    }
}
fn retain(app: &tauri::AppHandle, error: BridgeError) {
    eprintln!(
        "notification background poll failed: code={}",
        safe_code(&error.code)
    );
    app.state::<NotificationPollState>().retain(error);
}
pub async fn run(app: tauri::AppHandle, bridge: Bridge) {
    let mut interval = tokio::time::interval(Duration::from_secs(10));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let before = bridge.status();
        if before.state == BridgePhase::Stopped {
            return;
        }
        // System language is resolved by the WebView. Until its first trusted
        // metadata receipt, do not touch the ledger or consume an attempt/retry.
        if app
            .state::<std::sync::Arc<crate::lifecycle::NativeLanguage>>()
            .current()
            .is_none()
        {
            continue;
        }
        let startup_ready = app
            .state::<crate::experience::StartupGate>()
            .check()
            .is_ok();
        let instance = match ready_instance(&before, startup_ready) {
            Ok(Some(instance)) => instance.to_owned(),
            Ok(None) => continue,
            Err(error) => {
                retain(&app, error);
                continue;
            }
        };
        let reply = match bridge.notification_snapshot().await {
            Ok(reply) => reply,
            Err(error) => {
                retain(&app, error);
                continue;
            }
        };
        let after = bridge.status();
        let startup_ready = app
            .state::<crate::experience::StartupGate>()
            .check()
            .is_ok();
        let snapshot = match sampled(&instance, &after, startup_ready, &reply) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                retain(&app, error);
                continue;
            }
        };
        let worker_app = app.clone();
        let worker_bridge = bridge.clone();
        let result=tokio::task::spawn_blocking(move || {
            // Recheck immediately before disk/OS work so a delayed blocking task
            // cannot deliver a sample from a replaced management instance.
            let status=worker_bridge.status();
            let startup_ready=worker_app.state::<crate::experience::StartupGate>().check().is_ok();
            if ready_instance(&status,startup_ready)? != Some(instance.as_str()) {
                return Err(BridgeError{ details: None,code:"NOTIFICATION_SAMPLE_STALE".into(),message:"notification submission blocked: management instance/startup gate changed while scheduling native reconciliation".into()});
            }
            let preferences=worker_app.state::<PreferencesStore>().read();
            let service=worker_app.state::<NotificationService>();
            apply_localized(snapshot,preferences,worker_app.state::<std::sync::Arc<crate::lifecycle::NativeLanguage>>().current(),|enabled,events|service.reconcile(enabled,events))
        }).await;
        match result {
            Ok(Ok(()))=>app.state::<NotificationPollState>().complete(Ok(())),
            Ok(Err(error))=>retain(&app,error),
            Err(error)=>retain(&app,BridgeError{ details: None,code:"NOTIFICATION_WORKER_FAILED".into(),message:format!("notification native worker did not complete: cancelled={} panicked={}; future polling remains enabled",error.is_cancelled(),error.is_panic())}),
        }
    }
}

#[cfg(test)]
#[path = "notification_poll_tests.rs"]
mod tests;
