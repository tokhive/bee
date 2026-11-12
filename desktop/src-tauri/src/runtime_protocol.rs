use crate::protocol::{
    validate_account_operation, validate_operation, BridgeError, SupplyPlatform,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryProgress {
    pub stage: String,
    pub operation_id: Option<String>,
    pub completed: Option<u64>,
    pub total: Option<u64>,
}
impl RecoveryProgress {
    pub fn stage(stage: &str) -> Self { Self {stage:stage.into(),operation_id:None,completed:None,total:None} }
    pub fn validate(&self) -> Result<(),BridgeError> {
        if !["connecting","checking_previous","checking_device","preparing_accounts","confirming_service"].contains(&self.stage.as_str())
            || self.operation_id.as_ref().is_some_and(|v| !digest(v,48))
            || self.completed.is_some()!=self.total.is_some()
            || self.total.is_some_and(|v|v==0 || v>2)
            || self.completed.zip(self.total).is_some_and(|(a,b)|a>b)
            || self.total.is_some() && self.stage!="preparing_accounts" {
            return Err(invalid("startup progress requires a known stage, bound operation and consistent account counts"));
        }
        Ok(())
    }
}

const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
fn invalid(message: impl Into<String>) -> BridgeError {
    BridgeError {
        details: None,
        code: "RUNTIME_REPLY_INVALID".into(),
        message: message.into(),
    }
}
fn safe(value: u64, field: &str) -> Result<(), BridgeError> {
    if value > SAFE_INTEGER {
        Err(invalid(format!(
            "{field} exceeds safe integer: actual={value}"
        )))
    } else {
        Ok(())
    }
}
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
fn decode<T: serde::de::DeserializeOwned>(value: &Value, at: &str) -> Result<T, BridgeError> {
    serde_json::from_value(value.clone()).map_err(|e| crate::protocol::invalid_json(at, e))
}
fn digest(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeStartRequest {
    pub expected_revision: u64,
    pub resume_platforms: Vec<SupplyPlatform>,
}
impl RuntimeStartRequest {
    pub fn validate(&self) -> Result<(), BridgeError> {
        safe(self.expected_revision, "expected_revision")?;
        if self.resume_platforms.len() > 2
            || self
                .resume_platforms
                .iter()
                .enumerate()
                .any(|(i, p)| self.resume_platforms[..i].contains(p))
        {
            return Err(invalid(format!(
                "resume_platforms must be unique and contain at most two platforms: count={}",
                self.resume_platforms.len()
            )));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeNetworkConfig {
    pub revision: u64,
    pub connect_proxy: String,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // Exit/update/network entry points are wired in T6/S2/S3.
pub(crate) enum RuntimeStopReason {
    UserStop,
    AppExit,
    Update,
    NetworkChange,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LocalState {
    Stopped,
    Waiting,
    Starting,
    Running,
    Stopping,
    Failed,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Rejected,
    Occupied,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ConnectionFailureCode {
    DnsFailed,
    TlsFailed,
    ConnectionRefused,
    Timeout,
    HttpRejected,
    ConnectionClosed,
    SynchronizationFailed,
    OwnershipUnconfirmed,
    UnknownFailure,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ConnectionStage {
    Connect,
    Heartbeat,
    Synchronize,
}
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ConnectionRetry {
    Idle,
    Attempting,
    Scheduled,
    Halted,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConnectionFailure {
    code: ConnectionFailureCode,
    stage: ConnectionStage,
    occurred_at: String,
    message: String,
    evidence: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConnectionDetail {
    #[serde(deserialize_with = "present")]
    failure: Option<ConnectionFailure>,
    retry: ConnectionRetry,
    #[serde(deserialize_with = "present")]
    next_retry_at: Option<String>,
}
impl ConnectionDetail {
    fn validate(&self) -> Result<(), BridgeError> {
        if (self.retry == ConnectionRetry::Scheduled) != self.next_retry_at.is_some()
            || self.next_retry_at.as_ref().is_some_and(|v| !timestamp(v))
        {
            return Err(invalid("connection retry timestamp rejected; required=valid UTC timestamp exactly when scheduled"));
        }
        let Some(f) = &self.failure else {
            return Ok(());
        };
        let observed = time::OffsetDateTime::parse(
            &f.occurred_at,
            &time::format_description::well_known::Rfc3339,
        );
        if !timestamp(&f.occurred_at)
            || observed.is_err()
            || observed
                .is_ok_and(|v| v > time::OffsetDateTime::now_utc() + time::Duration::seconds(5))
            || f.message.len() > 32768
        {
            return Err(invalid(
                "connection failure observation timestamp or message length rejected",
            ));
        }
        let allowed = [
            "target_origin",
            "path",
            "http_status",
            "remote_code",
            "response_body",
            "owned_session",
            "consecutive_conflicts",
        ];
        for (key, value) in &f.evidence {
            if !allowed.contains(&key.as_str()) || value.len() > 32768 {
                return Err(invalid(
                    "connection failure evidence key or value length rejected",
                ));
            }
            let valid = match key.as_str() {
                "target_origin" => tauri::Url::parse(value).is_ok_and(|u| {
                    // Preserve the producer's spelling, but check the original
                    // authority before URL parsing normalizes hosts and ports.
                    let authority = value
                        .strip_prefix("https://")
                        .or_else(|| value.strip_prefix("http://"));
                    let shape = authority.is_some_and(|a| {
                        !a.is_empty()
                            && !a.chars().any(|c| c.is_whitespace() || "/?#@\\".contains(c))
                    });
                    let host = authority
                        .map(|a| {
                            if a.starts_with('[') {
                                a.split_once(']').map_or(a, |(host, _)| &host[1..])
                            } else {
                                a.split_once(':').map_or(a, |(host, _)| host)
                            }
                        })
                        .unwrap_or("");
                    let local = host == "localhost"
                        || host.parse::<std::net::IpAddr>().is_ok_and(|ip| {
                            ip.is_loopback()
                                || match ip {
                                    std::net::IpAddr::V6(ip) => {
                                        ip.to_ipv4_mapped().is_some_and(|ip| ip.is_loopback())
                                    }
                                    _ => false,
                                }
                        });
                    shape
                        && u.username().is_empty()
                        && u.password().is_none()
                        && u.query().is_none()
                        && u.fragment().is_none()
                        && (u.scheme() == "https" || u.scheme() == "http" && local)
                }),
                "path" => {
                    value.starts_with("/api/bee/")
                        && value.len() > 9
                        && value.bytes().all(|b| {
                            b.is_ascii_lowercase() || b.is_ascii_digit() || b"/_-".contains(&b)
                        })
                }
                "http_status" => {
                    value.len() == 3 && value.parse::<u16>().is_ok_and(|n| (100..=599).contains(&n))
                }
                "remote_code" => {
                    !value.is_empty()
                        && value.len() <= 128
                        && value.as_bytes()[0].is_ascii_lowercase()
                        && value
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
                }
                "owned_session" => value == "true" || value == "false",
                "consecutive_conflicts" => {
                    !value.is_empty()
                        && (*value == "0" || !value.starts_with('0'))
                        && value.bytes().all(|b| b.is_ascii_digit())
                        && value.parse::<u64>().is_ok_and(|n| n <= SAFE_INTEGER)
                }
                _ => true,
            };
            if !valid {
                return Err(invalid(format!(
                    "connection failure evidence rejected at key={key}"
                )));
            }
        }
        let _ = (&f.code, &f.stage);
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StopReceipt {
    pub workers_stopped: bool,
    pub intent_saved: bool,
    pub session_clean: bool,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeSnapshot {
    #[serde(default)]
    startup_progress: Option<RecoveryProgress>,
    #[serde(deserialize_with = "present")]
    run_id: Option<String>,
    revision: u64,
    network_revision: u64,
    observed_at: String,
    local: LocalState,
    connection: ConnectionState,
    #[serde(deserialize_with = "present")]
    connection_detail: Option<ConnectionDetail>,
    #[serde(deserialize_with = "present")]
    legacy_stop: Option<LegacyStopStatus>,
    platforms: RuntimePlatforms,
    #[serde(deserialize_with = "present")]
    operation: Option<Value>,
    #[serde(deserialize_with = "present")]
    stop_receipt: Option<StopReceipt>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyStopStatus {
    phase: String,
    platforms: Vec<SupplyPlatform>,
    #[serde(deserialize_with = "present")]
    error: Option<Value>,
    can_recheck: bool,
}
impl LegacyStopStatus {
    fn validate(&self) -> Result<(), BridgeError> {
        if !["processing", "reconciling", "blocked", "completed"].contains(&self.phase.as_str())
            || self.platforms.len() > 2
            || self
                .platforms
                .iter()
                .enumerate()
                .any(|(i, p)| self.platforms[..i].contains(p))
        {
            return Err(invalid(
                "legacy stop phase/platforms rejected; required=known phase and unique platforms",
            ));
        }
        if let Some(error) = &self.error {
            let platform = match error.get("platform").and_then(Value::as_str) {
                Some("openai") => Some(SupplyPlatform::Openai),
                Some("claude") => Some(SupplyPlatform::Claude),
                _ => None,
            };
            crate::protocol::validate_account_error(error, platform)?;
            if platform.is_some_and(|p| !self.platforms.contains(&p)) {
                return Err(invalid(
                    "legacy stop error platform differs from conversion scope",
                ));
            }
        }
        let _ = self.can_recheck;
        Ok(())
    }
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimePlatforms {
    openai: RuntimePlatform,
    claude: RuntimePlatform,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimePlatform {
    account: Value,
    #[serde(deserialize_with = "present")]
    supply: Option<RuntimeSupply>,
    selection_revision: u64,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeSupply {
    hive: String,
    device_id: String,
    platform: SupplyPlatform,
    paused: bool,
    ready: bool,
    reasons: Vec<String>,
    checked_at: String,
}

pub(crate) fn timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() < 20
        || b.len() > 30
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b.last() != Some(&b'Z')
    {
        return false;
    }
    let number = |start: usize, end: usize| -> Option<u32> {
        let p = &b[start..end];
        if p.iter().all(u8::is_ascii_digit) {
            Some(p.iter().fold(0, |n, c| n * 10 + (c - b'0') as u32))
        } else {
            None
        }
    };
    let (Some(y), Some(m), Some(d), Some(h), Some(min), Some(sec)) = (
        number(0, 4),
        number(5, 7),
        number(8, 10),
        number(11, 13),
        number(14, 16),
        number(17, 19),
    ) else {
        return false;
    };
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    };
    d >= 1
        && d <= days
        && h < 24
        && min < 60
        && sec < 60
        && (b.len() == 20
            || b.len() >= 22 && b[19] == b'.' && b[20..b.len() - 1].iter().all(u8::is_ascii_digit))
}
impl RuntimeSupply {
    fn validate(&self, platform: SupplyPlatform) -> Result<(), BridgeError> {
        let url = tauri::Url::parse(&self.hive)
            .map_err(|_| invalid("runtime supply Hive origin cannot be parsed"))?;
        let local = url.host_str() == Some("localhost")
            || url.host_str().is_some_and(|h| {
                h.trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
            });
        if !(url.scheme() == "https" || url.scheme() == "http" && local)
            || url.host_str().is_none()
            || url.origin().ascii_serialization() != self.hive
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err(invalid(
                "runtime supply Hive is not a canonical allowed origin",
            ));
        }
        if self.platform != platform
            || self.device_id.is_empty()
            || self.device_id.len() > 128
            || !self
                .device_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err(invalid(
                "runtime supply platform or public device identifier rejected",
            ));
        }
        let reasons = [
            "account_not_registered",
            "market_not_open",
            "supply_not_enabled",
            "supply_device_restricted",
            "account_not_admitted",
            "manually_paused",
            "banned",
            "device_draining",
            "offline",
            "not_configured",
            "model_unavailable",
            "authorization_unavailable",
            "capabilities_unknown",
            "rate_limited",
            "quota_unknown",
            "quota_exhausted",
            "plan_not_configured",
            "concurrency_full",
            "codex_source_unavailable",
            "codex_confirmation_required",
            "codex_authorization_rejected",
            "claude_source_unavailable",
            "claude_confirmation_required",
            "claude_authorization_rejected",
        ];
        for (i, reason) in self.reasons.iter().enumerate() {
            if !reasons.contains(&reason.as_str())
                || self.reasons[..i].contains(reason)
                || platform == SupplyPlatform::Openai && reason.starts_with("claude_")
                || platform == SupplyPlatform::Claude && reason.starts_with("codex_")
            {
                return Err(invalid(format!(
                    "runtime supply reason rejected at index={i}"
                )));
            }
        }
        if self.ready != self.reasons.is_empty()
            || self.paused != self.reasons.iter().any(|s| s == "manually_paused")
            || !timestamp(&self.checked_at)
        {
            return Err(invalid(
                "runtime supply readiness, pause reasons or timestamp inconsistent",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Copy)]
pub enum RuntimeReplyKind {
    Snapshot,
    Operation,
    Configured,
}
pub fn validate_runtime_reply(result: &Value, kind: RuntimeReplyKind) -> Result<(), BridgeError> {
    let object = result
        .as_object()
        .ok_or_else(|| invalid("runtime result requires object"))?;
    if object.len() != 1 {
        return Err(invalid(format!(
            "runtime result field count rejected: actual={} expected=1",
            object.len()
        )));
    }
    if let Some(e) = object.get("error") {
        let e: BridgeError = decode(e, "runtime error")?;
        if e.code != "RUNTIME_OPERATION_FAILED" || e.message.len() > 32768 {
            return Err(invalid("runtime error code or message length rejected"));
        }
        return Ok(());
    }
    match kind {
        RuntimeReplyKind::Operation => validate_operation(
            object
                .get("operation")
                .ok_or_else(|| invalid("runtime operation result missing"))?,
            None,
            &["start", "stop"],
        ),
        RuntimeReplyKind::Configured => {
            if object.get("configured") == Some(&Value::Bool(true)) {
                Ok(())
            } else {
                Err(invalid("runtime network configuration was not confirmed"))
            }
        }
        RuntimeReplyKind::Snapshot => {
            let s: RuntimeSnapshot = decode(
                object
                    .get("runtime")
                    .ok_or_else(|| invalid("runtime snapshot result missing"))?,
                "runtime snapshot",
            )?;
            if let Some(progress)=&s.startup_progress {
                progress.validate()?;
                if progress.operation_id.as_deref()!=s.operation.as_ref().and_then(|v|v["id"].as_str()) {return Err(invalid("startup progress operation differs from runtime operation"));}
            }
            safe(s.revision, "runtime.revision")?;
            safe(s.network_revision, "runtime.network_revision")?;
            if s.run_id.as_ref().is_some_and(|id| !digest(id, 32)) || !timestamp(&s.observed_at) {
                return Err(invalid("runtime run_id or observation timestamp rejected"));
            }
            if let Some(detail) = &s.connection_detail {
                detail.validate()?;
            }
            if let Some(legacy) = &s.legacy_stop {
                legacy.validate()?;
            }
            for (platform, p) in [
                (SupplyPlatform::Openai, &s.platforms.openai),
                (SupplyPlatform::Claude, &s.platforms.claude),
            ] {
                safe(p.selection_revision, "runtime.selection_revision")?;
                validate_account_operation(&serde_json::json!({"account":p.account}), platform)?;
                if let Some(supply) = &p.supply {
                    supply.validate(platform)?
                }
            }
            if let Some(op) = s.operation {
                validate_operation(&op, None, &["start", "stop"])?
            }
            // Deserialization checks the independent local/connection/receipt enums.
            let _ = (s.local, s.connection, s.stop_receipt);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../desktopbridge/testdata/runtime-contract.json"
        ))
        .unwrap()
    }
    #[test]
    fn startup_progress_requires_the_current_runtime_operation() {
        let f = fixture();
        let mut snapshot = f["snapshot"].clone();
        snapshot["startup_progress"] = json!({
            "stage":"checking_device", "operation_id":f["operation"]["id"],
            "completed":null, "total":null
        });
        // A reset operation cannot retain progress from the previous device.
        let error = validate_runtime_reply(&json!({"runtime":snapshot}), RuntimeReplyKind::Snapshot).unwrap_err();
        assert_eq!(error.code, "RUNTIME_REPLY_INVALID");
        assert!(error.message.contains("startup progress operation differs"));
        snapshot["operation"] = f["operation"].clone();
        validate_runtime_reply(&json!({"runtime":snapshot}), RuntimeReplyKind::Snapshot).unwrap();
        // A new failed start also cannot inherit another operation's progress.
        snapshot["operation"]["id"] = json!("b".repeat(48));
        assert!(validate_runtime_reply(&json!({"runtime":snapshot}), RuntimeReplyKind::Snapshot).is_err());
        snapshot.as_object_mut().unwrap().remove("startup_progress");
        validate_runtime_reply(&json!({"runtime":snapshot}), RuntimeReplyKind::Snapshot).unwrap();
        snapshot["operation"] = Value::Null;
        validate_runtime_reply(&json!({"runtime":snapshot}), RuntimeReplyKind::Snapshot).unwrap();
    }
    #[test]
    fn legacy_stop_requires_explicit_progress_and_bounded_recovery_fields() {
        let mut valid = fixture()["snapshot"].clone();
        valid["legacy_stop"] =
            json!({"phase":"reconciling","platforms":["openai"],"error":null,"can_recheck":true});
        validate_runtime_reply(&json!({"runtime":valid}), RuntimeReplyKind::Snapshot).unwrap();
        for (path, value) in [
            ("/legacy_stop/phase", json!("unknown")),
            ("/legacy_stop/platforms", json!(["openai", "openai"])),
            ("/legacy_stop/platforms", json!(["unknown"])),
            ("/legacy_stop/can_recheck", Value::Null),
            (
                "/legacy_stop/error",
                json!({"code":"blocked","check":"upgrade","platform":"unknown","message":"blocked","evidence":{"token":"SECRET_PAYLOAD"}}),
            ),
        ] {
            let mut bad = valid.clone();
            *bad.pointer_mut(path).unwrap() = value;
            let error = validate_runtime_reply(&json!({"runtime":bad}), RuntimeReplyKind::Snapshot)
                .unwrap_err();
            assert!(!error.message.contains("SECRET_PAYLOAD"));
        }
        valid.as_object_mut().unwrap().remove("legacy_stop");
        assert!(
            validate_runtime_reply(&json!({"runtime":valid}), RuntimeReplyKind::Snapshot).is_err()
        );
    }
    #[test]
    fn runtime_shared_contract_and_requests() {
        let f = fixture();
        validate_runtime_reply(
            &json!({"runtime": f["snapshot"]}),
            RuntimeReplyKind::Snapshot,
        )
        .unwrap();
        validate_runtime_reply(
            &json!({"operation": f["operation"]}),
            RuntimeReplyKind::Operation,
        )
        .unwrap();
        let request: RuntimeStartRequest = serde_json::from_value(f["start"].clone()).unwrap();
        request.validate().unwrap();
        for request in [
            json!({"expected_revision":0,"resume_platforms":["openai","openai"]}),
            json!({"expected_revision":9007199254740992u64,"resume_platforms":[]}),
        ] {
            assert!(serde_json::from_value::<RuntimeStartRequest>(request)
                .unwrap()
                .validate()
                .is_err());
        }
        for request in [
            json!({"expected_revision":0}),
            json!({"expected_revision":0,"resume_platforms":null}),
            json!({"expected_revision":0,"resume_platforms":[],"reason":"update"}),
        ] {
            assert!(serde_json::from_value::<RuntimeStartRequest>(request).is_err());
        }
    }
    #[test]
    fn runtime_accepts_zero_account_waiting_snapshot() {
        let mut waiting = fixture()["snapshot"].clone();
        waiting["local"] = json!("waiting");
        waiting["connection"] = json!("connected");
        validate_runtime_reply(&json!({"runtime": waiting}), RuntimeReplyKind::Snapshot).unwrap();
    }
    #[test]
    fn runtime_snapshot_rejects_unknown_missing_and_cross_platform_fields() {
        let base = fixture()["snapshot"].clone();
        for (pointer, value) in [
            ("/local", json!("active")),
            ("/connection", json!("ready")),
            ("/revision", json!(9007199254740992u64)),
            ("/run_id", json!("bad")),
            ("/observed_at", json!("2026-02-30T00:00:00Z")),
            ("/platforms/openai/account/platform", json!("claude")),
            ("/platforms/openai/selection_revision", json!(-1)),
            (
                "/stop_receipt",
                json!({"workers_stopped":true,"intent_saved":true,"session_clean":true,"extra":true}),
            ),
        ] {
            let mut bad = base.clone();
            *bad.pointer_mut(pointer).unwrap() = value;
            assert!(
                validate_runtime_reply(&json!({"runtime":bad}), RuntimeReplyKind::Snapshot)
                    .is_err(),
                "accepted {pointer}"
            );
        }
        let mut bad = base.clone();
        bad.as_object_mut().unwrap().remove("operation");
        assert!(
            validate_runtime_reply(&json!({"runtime":bad}), RuntimeReplyKind::Snapshot).is_err()
        );
        let mut bad = base;
        bad["platforms"]["other"] = json!({});
        assert!(
            validate_runtime_reply(&json!({"runtime":bad}), RuntimeReplyKind::Snapshot).is_err()
        );
    }
    #[test]
    fn runtime_schema_errors_do_not_echo_untrusted_values() {
        for key in ["local", "revision", "observed_at"] {
            let mut snapshot = fixture()["snapshot"].clone();
            snapshot[key] = serde_json::json!("PRIVATE_AUTH_TOKEN");
            let err = validate_runtime_reply(
                &serde_json::json!({"runtime":snapshot}),
                RuntimeReplyKind::Snapshot,
            )
            .unwrap_err();
            assert!(
                !err.message.contains("PRIVATE_AUTH_TOKEN"),
                "schema error leaked value for {key}"
            );
        }
    }
    #[test]
    fn runtime_operation_and_fixed_capabilities_are_strict() {
        let f = fixture();
        for (key, value) in [
            ("kind", json!("authorize")),
            ("platform", json!("openai")),
            ("id", json!("short")),
            ("state", json!("done")),
            ("error", json!({"token":"secret"})),
        ] {
            let mut op = f["operation"].clone();
            op[key] = value;
            assert!(
                validate_runtime_reply(&json!({"operation":op}), RuntimeReplyKind::Operation)
                    .is_err()
            );
        }
        let mut hello = json!({"bee_version":"v1","os":"darwin","arch":"arm64","capabilities":["ping","shutdown","device_status","device_begin","supply_status","supply_set_paused","account_defaults","account_detect","account_snapshot","account_action","runtime_snapshot","runtime_start","runtime_stop","runtime_configure_network"]});
        crate::protocol::hello(hello.clone(), "v1", "darwin", "arm64").unwrap();
        hello["capabilities"][13] = json!("runtime_restore");
        assert!(crate::protocol::hello(hello, "v1", "darwin", "arm64").is_err());
    }
    #[test]
    fn runtime_supply_detailed_reasons_preserve_strict_contract() {
        for platform in [SupplyPlatform::Openai, SupplyPlatform::Claude] {
            for reason in [
                "account_not_registered",
                "market_not_open",
                "supply_not_enabled",
                "supply_device_restricted",
                "account_not_admitted",
            ] {
                let base = json!({"hive":"https://hive.example","device_id":"device-1","platform":platform,"paused":false,"ready":false,"reasons":[reason],"checked_at":"2026-10-27T00:00:00Z"});
                let supply: RuntimeSupply = serde_json::from_value(base.clone()).unwrap();
                assert!(
                    supply.validate(platform).is_ok(),
                    "defined detailed reason rejected: {reason}"
                );
                for (field, value) in [
                    ("reasons", json!([reason, reason])),
                    ("ready", json!(true)),
                    ("paused", json!(true)),
                    ("reasons", json!([reason, "manually_paused"])),
                    (
                        "reasons",
                        json!([
                            reason,
                            if platform == SupplyPlatform::Openai {
                                "claude_source_unavailable"
                            } else {
                                "codex_source_unavailable"
                            }
                        ]),
                    ),
                    ("reasons", json!([reason, "unrecognized_reason"])),
                ] {
                    let mut bad = base.clone();
                    bad[field] = value;
                    let supply: RuntimeSupply = serde_json::from_value(bad).unwrap();
                    assert!(
                        supply.validate(platform).is_err(),
                        "invalid detailed supply accepted: reason={reason} field={field}"
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod connection_tests {
    use super::*;
    use serde_json::json;
    fn detail() -> Value {
        json!({"failure":{"code":"dns_failed","stage":"connect","occurred_at":"2026-10-26T00:00:00Z","message":"lookup hive.test: no such host","evidence":{"target_origin":"https://hive.test","path":"/api/bee/agent"}},"retry":"scheduled","next_retry_at":"2099-01-01T00:00:00Z"})
    }
    fn check(d: Value) -> Result<(), BridgeError> {
        let mut snapshot: Value = serde_json::from_str::<Value>(include_str!(
            "../../../desktopbridge/testdata/runtime-contract.json"
        ))
        .unwrap()["snapshot"]
            .clone();
        snapshot["connection_detail"] = d;
        validate_runtime_reply(&json!({"runtime":snapshot}), RuntimeReplyKind::Snapshot)
    }
    #[test]
    fn runtime_connection_accepts_all_failure_stages_and_retry_states() {
        for code in [
            "dns_failed",
            "tls_failed",
            "connection_refused",
            "timeout",
            "http_rejected",
            "connection_closed",
            "synchronization_failed",
            "ownership_unconfirmed",
            "unknown_failure",
        ] {
            for stage in ["connect", "heartbeat", "synchronize"] {
                let mut d = detail();
                d["failure"]["code"] = json!(code);
                d["failure"]["stage"] = json!(stage);
                check(d).unwrap();
            }
        }
        for retry in ["idle", "attempting", "halted"] {
            check(json!({"failure":null,"retry":retry,"next_retry_at":null})).unwrap();
        }
        check(Value::Null).unwrap();
    }
    #[test]
    fn runtime_connection_details_consume_go_origin_contract() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../desktopbridge/testdata/connection-origin-contract.json"
        ))
        .unwrap();
        let mut rejected = Vec::new();
        for sample in fixture["accepted"].as_array().unwrap() {
            if let Err(error) = check(sample["connection_detail"].clone()) {
                rejected.push(format!("hive={} error={}", sample["hive"], error.message));
            }
        }
        assert!(
            rejected.is_empty(),
            "Go observer origins rejected: {rejected:?}"
        );
        for origin in fixture["rejected"].as_array().unwrap() {
            let mut d = detail();
            d["failure"]["evidence"]["target_origin"] = origin.clone();
            assert!(check(d).is_err(), "unsafe origin accepted: {origin}");
        }
    }
    #[test]
    fn runtime_connection_rejects_unsafe_and_contradictory_details() {
        for (pointer, value) in [
            ("/retry", json!("waiting")),
            ("/next_retry_at", Value::Null),
            ("/next_retry_at", json!("2026-02-30T00:00:00Z")),
            ("/failure/code", json!("guessed")),
            ("/failure/stage", json!("proxy")),
            ("/failure/occurred_at", json!("2099-01-01T00:00:00Z")),
            ("/failure/message", json!("x".repeat(32769))),
            ("/failure/evidence", json!({"authorization":"secret"})),
            ("/failure/evidence", json!({"http_status":401})),
            ("/failure/evidence", json!({"http_status":"600"})),
            (
                "/failure/evidence",
                json!({"target_origin":"https://user:secret@hive.test/?token=secret"}),
            ),
            (
                "/failure/evidence",
                json!({"path":"/api/bee/agent?token=secret"}),
            ),
            ("/failure/evidence", json!({"owned_session":"yes"})),
            ("/failure/evidence", json!({"consecutive_conflicts":"-1"})),
            ("/failure/evidence", json!({"remote_code":"unsafe code"})),
            (
                "/failure/evidence",
                json!({"response_body":"x".repeat(32769)}),
            ),
        ] {
            let mut d = detail();
            *d.pointer_mut(pointer).unwrap() = value;
            assert!(
                check(d).is_err(),
                "accepted invalid connection detail at {pointer}"
            );
        }
        for key in ["failure", "retry", "next_retry_at"] {
            let mut d = detail();
            d.as_object_mut().unwrap().remove(key);
            assert!(check(d).is_err(), "missing {key} accepted");
        }
        let mut d = detail();
        d["retry"] = json!("idle");
        assert!(check(d).is_err());
        let mut d = detail();
        d["extra"] = json!(true);
        assert!(check(d).is_err());
    }
}
