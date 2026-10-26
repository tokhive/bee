use crate::protocol::{validate_operation, AccountDetectRequest, BridgeError, SupplyPlatform};
use serde::{Deserialize, Serialize};
use serde_json::Value;
fn invalid(message: &str) -> BridgeError {
    BridgeError {
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
}
