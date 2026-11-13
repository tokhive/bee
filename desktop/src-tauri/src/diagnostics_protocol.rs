use crate::protocol::BridgeError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
fn invalid(message: impl Into<String>) -> BridgeError {
    BridgeError {
        details: None,
        code: "DIAGNOSTICS_REPLY_INVALID".into(),
        message: message.into(),
    }
}
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
fn digest(v: &str, n: usize) -> bool {
    v.len() == n
        && v.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticCheck {
    pub id: String,
    #[serde(deserialize_with = "present")]
    pub platform: Option<String>,
    pub status: String,
    pub observed_at: String,
    pub code: String,
    pub evidence: BTreeMap<String, String>,
    pub next_action: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticReport {
    pub id: String,
    pub instance: String,
    #[serde(deserialize_with = "present")]
    pub run_id: Option<String>,
    pub network_revision: u64,
    pub binding_revision: u64,
    pub started_at: String,
    #[serde(deserialize_with = "present")]
    pub finished_at: Option<String>,
    pub state: String,
    pub checks: Vec<DiagnosticCheck>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReportEnvelope {
    report: DiagnosticReport,
}
pub fn validate_report(value: &Value, instance: &str) -> Result<DiagnosticReport, BridgeError> {
    if let Some(error) = value.get("error") {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Failure {
            error: BridgeError,
        }
        let failure: Failure = serde_json::from_value(value.clone())
            .map_err(|e| crate::protocol::invalid_json("diagnostics error", e))?;
        if failure.error.code != "DIAGNOSTICS_OPERATION_FAILED"
            || !error.is_object()
            || failure.error.message.len() > 1024
        {
            return Err(invalid("diagnostics operation error envelope rejected"));
        }
        return Err(failure.error);
    }
    let report: ReportEnvelope = serde_json::from_value(value.clone())
        .map_err(|e| crate::protocol::invalid_json("diagnostics report", e))?;
    let r = report.report;
    if !digest(&r.id, 48)
        || !digest(&r.instance, 32)
        || r.instance != instance
        || r.run_id.as_deref().is_some_and(|s| !digest(s, 32))
        || r.network_revision > 9_007_199_254_740_991
        || r.binding_revision > 9_007_199_254_740_991
    {
        return Err(invalid("diagnostics identity or network revision rejected; required=current instance, safe revision and valid identifiers"));
    }
    if !["running", "completed", "cancelled"].contains(&r.state.as_str())
        || !crate::runtime_protocol::timestamp(&r.started_at)
        || r.finished_at
            .as_deref()
            .is_some_and(|s| !crate::runtime_protocol::timestamp(s))
        || (r.state == "running") != r.finished_at.is_none()
        || r.checks.len() > 16
    {
        return Err(invalid(
            "diagnostics state, timestamps or check count rejected",
        ));
    }
    let mut seen = HashSet::new();
    for (index, c) in r.checks.iter().enumerate() {
        let general =
            ["device", "runtime", "hive", "proxy"].contains(&c.id.as_str()) && c.platform.is_none();
        let platform = [
            "source",
            "authorization",
            "quota",
            "capabilities",
            "account",
            "supply",
        ]
        .contains(&c.id.as_str())
            && c.platform
                .as_deref()
                .is_some_and(|p| ["openai", "claude"].contains(&p));
        let pass_code = match c.id.as_str() {
            "device" => "device_binding_valid",
            "runtime" => "owned_runtime_connected",
            "hive" => "hive_identity_verified",
            "proxy" => "network_policy_observed",
            "source" => "selected_source_read",
            "authorization" => "official_authorization_observed",
            "quota" => "quota_available",
            "capabilities" => "capabilities_synchronized",
            "account" => "account_binding_verified",
            "supply" => "taking_new_work",
            _ => "",
        };
        if (c.status == "pass" && c.code != pass_code)
            || !(general || platform)
            || !seen.insert((&c.id, &c.platform))
            || !["pass", "warning", "fail", "skipped"].contains(&c.status.as_str())
            || !["overview", "accounts", "diagnostics", "settings"]
                .contains(&c.next_action.as_str())
            || !crate::runtime_protocol::timestamp(&c.observed_at)
            || !crate::diagnostic_log::is_public_code(&c.code)
            || crate::diagnostic_log::sanitize_evidence(&c.evidence) != c.evidence
        {
            return Err(invalid(format!("diagnostics check rejected at index={index}; required=known check/status/action and safe public evidence")));
        }
    }
    Ok(r)
}
#[cfg(test)]
#[path = "diagnostics_protocol_tests.rs"]
mod tests;
