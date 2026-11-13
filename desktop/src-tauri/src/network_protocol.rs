use crate::protocol::BridgeError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkCheck {
    pub id: String,
    pub status: String,
    pub message: String,
    pub path: String,
    #[serde(deserialize_with = "nullable")]
    pub http_status: Option<u16>,
}
fn nullable<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<u16>, D::Error> {
    Option::<u16>::deserialize(d)
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkTest {
    pub observed_at: String,
    pub checks: Vec<NetworkCheck>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    network_test: NetworkTest,
}
pub fn validate_test(v: &Value) -> Result<NetworkTest, BridgeError> {
    crate::protocol::result_error(v)?;
    let invalid = || {
        BridgeError{ details: None,code:"NETWORK_REPLY_INVALID".into(),message:"network test rejected: required=three fixed read-only checks, valid timestamp and bounded safe fields".into()}
    };
    let result: Envelope = serde_json::from_value(v.clone()).map_err(|_| invalid())?;
    if !crate::runtime_protocol::timestamp(&result.network_test.observed_at)
        || result.network_test.checks.len() != 3
    {
        return Err(invalid());
    }
    for (check, id) in result.network_test.checks.iter().zip([
        "local_proxy",
        "openai_read_only",
        "claude_read_only",
    ]) {
        if check.id != id
            || !["ok", "failed", "skipped"].contains(&check.status.as_str())
            || !["direct", "environment_proxy", "local_proxy"].contains(&check.path.as_str())
            || check.message.len() > 1024
            || check.message.chars().any(|c| c.is_control())
            || check.http_status.is_some_and(|s| !(100..=599).contains(&s))
        {
            return Err(invalid());
        }
    }
    Ok(result.network_test)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_failure_envelopes_preserve_the_bridge_error() {
        let failure = serde_json::json!({"error":{
            "code":"NETWORK_OPERATION_FAILED",
            "message":"network observation cancelled: context canceled",
            "details":{"check":"network_observation","observed_at":"2026-10-27T00:00:00Z","evidence":{"actual":"context canceled"}}
        }});
        for result in [validate_test(&failure).map(|_| ()), crate::network::decode_network_status(&failure).map(|_| ())] {
            let error = result.unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap(), failure["error"]);
        }
        let ambiguous = serde_json::json!({"error":failure["error"],"network":{}});
        assert_eq!(validate_test(&ambiguous).unwrap_err().code, "INVALID_REPLY");
        assert_eq!(crate::network::decode_network_status(&ambiguous).unwrap_err().code, "INVALID_REPLY");
    }
    #[test]
    fn network_test_rejects_unknown_endpoint_and_missing_nullable() {
        let checks=["local_proxy","openai_read_only","claude_read_only"].map(|id|serde_json::json!({"id":id,"status":"failed","path":"direct","message":"GET failed","http_status":null}));
        let mut v = serde_json::json!({"network_test":{"observed_at":"2026-10-27T00:00:00Z","checks":checks}});
        assert!(validate_test(&v).is_ok());
        v["network_test"]["checks"][0]["id"] = serde_json::json!("arbitrary_url");
        assert!(validate_test(&v).is_err());
    }
}
