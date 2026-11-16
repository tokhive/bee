use crate::protocol::{validate_operation, AccountDetectRequest, BridgeError, SupplyPlatform};
use serde::{Deserialize, Serialize};
use serde_json::Value;
fn invalid(message: &str) -> BridgeError {
    BridgeError { details: None,
        code: "AUTHORIZE_REPLY_INVALID".into(),
        message: message.into(),
    }
}
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizeSource {
    #[serde(deserialize_with = "present")]
    pub directory: Option<String>,
    pub store: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizeRequest {
    pub platform: SupplyPlatform,
    pub source: AuthorizeSource,
    pub expected_revision: u64,
}
impl AuthorizeRequest {
    pub fn validate(&self) -> Result<(), BridgeError> {
        if self.expected_revision > 9_007_199_254_740_991 {
            return Err(invalid("authorization revision exceeds JS safe integer"));
        }
        AccountDetectRequest {
            platform: self.platform,
            directory: self.source.directory.clone(),
            store: self.source.store.clone(),
            mode: "local".into(),
        }
        .validate()
    }
}
pub fn validate_operation_id(id: &str) -> Result<(), BridgeError> {
    if id.len() != 48
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid(
            "authorization operation ID requires 48 lowercase hex",
        ));
    }
    Ok(())
}
pub fn validate_authorize_reply(
    result: &Value,
    platform: Option<SupplyPlatform>,
    id: Option<&str>,
) -> Result<(), BridgeError> {
    let object = result
        .as_object()
        .ok_or_else(|| invalid("authorization result requires object"))?;
    if object.len() != 1 {
        return Err(invalid(
            "authorization result requires exactly one operation or error",
        ));
    }
    if let Some(e) = object.get("error") {
        let e: BridgeError = serde_json::from_value(e.clone())
            .map_err(|e| crate::protocol::invalid_json("authorization error", e))?;
        if e.code != "AUTHORIZE_OPERATION_FAILED" || e.message.len() > 32768 {
            return Err(invalid(
                "authorization error code or message length rejected",
            ));
        }
        return Ok(());
    }
    let op = object
        .get("operation")
        .ok_or_else(|| invalid("authorization result.operation missing"))?;
    let actual: SupplyPlatform = serde_json::from_value(
        op.get("platform")
            .cloned()
            .ok_or_else(|| invalid("authorization operation.platform missing"))?,
    )
    .map_err(|e| crate::protocol::invalid_json("authorization platform", e))?;
    if platform.is_some_and(|p| p != actual) {
        return Err(invalid("authorization platform differs from request"));
    }
    validate_operation(op, Some(actual), &["authorize"])?;
    if id.is_some_and(|id| op.get("id").and_then(Value::as_str) != Some(id)) {
        return Err(invalid("authorization operation ID differs from request"));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginActions { open: bool, cancel: bool, retry: bool, recheck: bool, restart: bool }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginProgress { operation: Value, sequence: u64, phase: String, stop_reason: Value, recheck_in_flight: bool, actions: LoginActions, blocker: Value }

fn validate_login_progress(value: &Value, id: &str) -> Result<(), BridgeError> {
    let p: LoginProgress = serde_json::from_value(value.clone()).map_err(|e| crate::protocol::invalid_json("login progress", e))?;
    validate_operation(&p.operation, Some(SupplyPlatform::Openai), &["authorize"])?;
    if p.operation["id"].as_str() != Some(id) || p.sequence > 9_007_199_254_740_991 || !["starting","waiting_authorization","verifying","cleaning_up","finished"].contains(&p.phase.as_str()) {
        return Err(invalid("login progress ID, sequence or phase rejected; required=current operation, safe sequence and known phase"));
    }
    if !p.stop_reason.is_null() && ![Some("cancelled"),Some("timed_out"),Some("failed")].contains(&p.stop_reason.as_str()) { return Err(invalid("login stop reason rejected")); }
    crate::protocol::validate_account_error(&p.blocker, Some(SupplyPlatform::Openai))?;
    let live = [Some("pending"),Some("running")].contains(&p.operation["state"].as_str());
    if p.actions.cancel && (!live || ["cleaning_up","finished"].contains(&p.phase.as_str()) || !p.stop_reason.is_null()) || p.actions.recheck && p.phase != "finished" || p.actions.open && (p.phase != "waiting_authorization" || !live || !p.stop_reason.is_null()) || p.phase == "finished" && live || p.actions.retry && (p.phase != "finished" || ![Some("failed"),Some("cancelled"),Some("unknown")].contains(&p.operation["state"].as_str()) || !p.blocker.is_null()) || p.recheck_in_flight && (p.actions.open || p.actions.cancel || p.actions.retry || p.actions.recheck || p.actions.restart) {
        return Err(invalid("login progress action permission contradicts phase, stop, blocker or worker evidence"));
    }
    Ok(())
}

pub fn validate_login_reply(result: &Value, id: &str, open: bool) -> Result<(), BridgeError> {
    let object = result.as_object().ok_or_else(|| invalid("login extension result requires object"))?;
    if object.len() != 1 { return Err(invalid("login extension result requires exactly one field")); }
    if object.contains_key("error") { return validate_authorize_reply(result, None, None); }
    if !open { return validate_login_progress(object.get("progress").ok_or_else(|| invalid("login progress field missing"))?, id); }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct OpenReceipt { opened: bool, error: Value, progress: Value }
    let receipt: OpenReceipt = serde_json::from_value(object.get("open").ok_or_else(|| invalid("login open field missing"))?.clone()).map_err(|e| crate::protocol::invalid_json("login open", e))?;
    if receipt.opened != receipt.error.is_null() { return Err(invalid("login open receipt success and error disagree")); }
    crate::protocol::validate_account_error(&receipt.error, Some(SupplyPlatform::Openai))?;
    validate_login_progress(&receipt.progress, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn authorize_requests_and_receipts_are_bound_and_strict() {
        let good = json!({"platform":"openai","source":{"directory":null,"store":"file"},"expected_revision":0});
        serde_json::from_value::<AuthorizeRequest>(good.clone())
            .unwrap()
            .validate()
            .unwrap();
        for key in ["platform", "source", "expected_revision"] {
            let mut bad = good.clone();
            bad.as_object_mut().unwrap().remove(key);
            assert!(serde_json::from_value::<AuthorizeRequest>(bad).is_err());
        }
        let mut bad = good.clone();
        bad["source"]["program"] = json!("PRIVATE_SECRET");
        assert!(serde_json::from_value::<AuthorizeRequest>(bad).is_err());
        let id = "a".repeat(48);
        let op = json!({"operation":{"id":id,"kind":"authorize","platform":"openai","state":"running","revision":1,"error":null}});
        validate_authorize_reply(&op, Some(SupplyPlatform::Openai), Some(&id)).unwrap();
        assert!(validate_authorize_reply(&op, Some(SupplyPlatform::Claude), None).is_err());
        assert!(validate_authorize_reply(&op, None, Some(&"b".repeat(48))).is_err());
        for (field, value) in [
            ("kind", json!("start")),
            ("state", json!("PRIVATE_SECRET")),
            ("platform", json!(null)),
            ("token", json!("PRIVATE_SECRET")),
        ] {
            let mut bad = op.clone();
            bad["operation"][field] = value;
            let error = validate_authorize_reply(&bad, None, None).unwrap_err();
            assert!(!error.message.contains("PRIVATE_SECRET"));
        }
    }
    #[test]
    fn login_extension_rejects_unbound_or_contradictory_permissions() {
        let id = "a".repeat(48);
        let good = json!({"progress":{"operation":{"id":id,"kind":"authorize","platform":"openai","state":"running","revision":1,"error":null},"sequence":1,"phase":"waiting_authorization","stop_reason":null,"recheck_in_flight":false,"actions":{"open":true,"cancel":true,"retry":false,"recheck":false,"restart":false},"blocker":null}});
        validate_login_reply(&good, &id, false).unwrap();
        for (field, value) in [("url",json!("PRIVATE_SECRET")),("phase",json!("finished")),("stop_reason",json!("cancelled")),("sequence",json!(9_007_199_254_740_992u64)),("recheck_in_flight",json!(true))] {
            let mut bad = good.clone(); bad["progress"][field] = value;
            let error = validate_login_reply(&bad, &id, false).unwrap_err();
            assert!(!error.message.contains("PRIVATE_SECRET"));
        }
        assert!(validate_login_reply(&good, &"b".repeat(48), false).is_err());
        let opened = json!({"open":{"opened":true,"error":null,"progress":good["progress"]}});
        validate_login_reply(&opened, &id, true).unwrap();
        let mut bad = opened; bad["open"]["url"] = json!("PRIVATE_SECRET");
        assert!(validate_login_reply(&bad, &id, true).is_err());
    }

}
