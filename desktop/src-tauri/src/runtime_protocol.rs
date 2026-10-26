use crate::protocol::{
    validate_account_operation, validate_operation, BridgeError, SupplyPlatform,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
fn invalid(message: impl Into<String>) -> BridgeError {
    BridgeError {
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
    #[serde(deserialize_with = "present")]
    run_id: Option<String>,
    revision: u64,
    network_revision: u64,
    observed_at: String,
    local: LocalState,
    connection: ConnectionState,
    platforms: RuntimePlatforms,
    #[serde(deserialize_with = "present")]
    operation: Option<Value>,
    #[serde(deserialize_with = "present")]
    stop_receipt: Option<StopReceipt>,
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

fn timestamp(value: &str) -> bool {
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
            safe(s.revision, "runtime.revision")?;
            safe(s.network_revision, "runtime.network_revision")?;
            if s.run_id.as_ref().is_some_and(|id| !digest(id, 32)) || !timestamp(&s.observed_at) {
                return Err(invalid("runtime run_id or observation timestamp rejected"));
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
}
