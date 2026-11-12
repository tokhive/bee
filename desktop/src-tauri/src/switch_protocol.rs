//! Private native switching boundary. Remote IDs and immutable request objects
//! stay owned by the App journal; no WebView command exposes this channel.
use crate::{profiles::ProfileMode, protocol::BridgeError};
use serde_json::Value;
fn invalid(message: impl Into<String>) -> BridgeError {
    BridgeError::new("HIVE_SWITCH_REPLY_INVALID", message.into())
}
pub(crate) fn allowed(mode: ProfileMode, method: &str) -> bool {
    if mode == ProfileMode::Current {
        return true;
    }
    matches!(
        method,
        "hello"
            | "ping"
            | "shutdown"
            | "device_context"
            | "device_status"
            | "device_begin"
            | "device_recovery_prepare"
            | "device_recovery_confirm"
            | "device_recovery_status"
            | "runtime_inspect_recovery"
            | "runtime_verify"
            | "desktop_switch"
    ) || mode == ProfileMode::Activate
        && matches!(method, "runtime_configure_network" | "network_status")
}
pub(crate) fn action_allowed(mode: ProfileMode, action: &str) -> bool {
    mode != ProfileMode::Prepare || !matches!(action, "connect" | "commit" | "stop")
}
fn fields<'a>(
    v: &'a Value,
    names: &[&str],
    where_: &str,
) -> Result<&'a serde_json::Map<String, Value>, BridgeError> {
    let object = v
        .as_object()
        .ok_or_else(|| invalid(format!("{where_} object required")))?;
    if object.len() != names.len() || names.iter().any(|n| !object.contains_key(*n)) {
        return Err(invalid(format!(
            "{where_} fields rejected: actual_count={} required={}",
            object.len(),
            names.join(",")
        )));
    }
    Ok(object)
}
fn text<'a>(v: &'a Value, name: &str) -> Result<&'a str, BridgeError> {
    v[name]
        .as_str()
        .ok_or_else(|| invalid(format!("switch field={name} requires string")))
}
fn safe(v: &Value, name: &str) -> Result<u64, BridgeError> {
    v[name]
        .as_u64()
        .filter(|n| *n <= 9007199254740991)
        .ok_or_else(|| {
            invalid(format!(
                "switch field={name} requires nonnegative safe integer"
            ))
        })
}
fn hex(v: &str, empty: bool) -> bool {
    empty && v.is_empty()
        || v.len() == 48
            && v.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn public(v: &str, empty: bool) -> bool {
    empty && v.is_empty()
        || !v.is_empty()
            && v.len() <= 128
            && v.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn work(v: &Value, zero: bool) -> Result<(), BridgeError> {
    fields(
        v,
        &["executions", "unknown_terminations", "unsettled"],
        "work",
    )?;
    for n in ["executions", "unknown_terminations", "unsettled"] {
        if safe(v, n)? != 0 && zero {
            return Err(invalid(format!("work field={n} nonzero; required=0")));
        }
    }
    Ok(())
}
pub(crate) fn request(v: &Value) -> Result<(), BridgeError> {
    fields(
        v,
        &[
            "id",
            "device_id",
            "owner_id",
            "origin",
            "expected_epoch",
            "expected_lease",
        ],
        "drain request",
    )?;
    if !hex(text(v, "id")?, false)
        || !public(text(v, "device_id")?, false)
        || !public(text(v, "owner_id")?, false)
        || !hex(text(v, "expected_epoch")?, true)
        || !public(text(v, "expected_lease")?, true)
    {
        return Err(invalid("drain request identifiers rejected"));
    }
    crate::hive_origin::normalize_hive_origin(text(v, "origin")?)
        .map_err(|e| invalid(format!("drain origin rejected: {}: {}", e.code, e.message)))?;
    Ok(())
}
pub(crate) fn seal(v: &Value, original: &Value) -> Result<(), BridgeError> {
    fields(v, &["id", "request"], "seal")?;
    if !hex(text(v, "id")?, false) || v["request"] != *original || v["id"] == original["id"] {
        return Err(invalid("seal original request/action mismatch"));
    }
    request(&v["request"])
}
pub(crate) fn release(v: &Value, original: &Value) -> Result<(), BridgeError> {
    fields(
        v,
        &["id", "request", "mode", "expected_epoch", "expected_lease"],
        "release",
    )?;
    if !hex(text(v, "id")?, false)
        || v["request"] != *original
        || v["id"] == original["id"]
        || !matches!(text(v, "mode")?, "cancel" | "activate")
        || !hex(text(v, "expected_epoch")?, true)
        || !public(text(v, "expected_lease")?, true)
    {
        return Err(invalid("release original request/action mismatch"));
    }
    request(&v["request"])
}
pub(crate) fn drain(v: &Value, original: &Value) -> Result<(), BridgeError> {
    fields(
        v,
        &[
            "version",
            "device_id",
            "owner_id",
            "operation_id",
            "state",
            "request",
            "seal",
            "release",
            "receipt",
            "current",
        ],
        "drain status",
    )?;
    request(original)?;
    if v["version"] != 1
        || v["device_id"] != original["device_id"]
        || v["owner_id"] != original["owner_id"]
        || v["operation_id"] != original["id"]
    {
        return Err(invalid("drain original identity mismatch"));
    }
    let state = text(v, "state")?;
    if !matches!(
        state,
        "absent" | "draining" | "ready" | "sealing" | "sealed" | "released"
    ) {
        return Err(invalid("drain state rejected"));
    }
    fields(
        &v["current"],
        &["epoch", "lease", "barrier_id", "work"],
        "drain current",
    )?;
    let current = &v["current"];
    if !hex(text(current, "epoch")?, true)
        || !hex(text(current, "barrier_id")?, true)
        || !public(text(current, "lease")?, true)
    {
        return Err(invalid("drain current identifiers rejected"));
    }
    if !current["work"].is_null() {
        work(&current["work"], state == "ready")?
    }
    if state == "absent" {
        if ["request", "seal", "release", "receipt"]
            .iter()
            .any(|n| !v[*n].is_null())
        {
            return Err(invalid("absent drain contains historical action"));
        }
        return Ok(());
    }
    if v["request"] != *original {
        return Err(invalid("drain immutable request changed"));
    }
    if matches!(state, "draining" | "ready" | "sealing" | "sealed")
        && current["barrier_id"] != original["id"]
    {
        return Err(invalid("drain barrier mismatch"));
    }
    if matches!(state, "draining" | "ready")
        && (current["epoch"] != original["expected_epoch"]
            || ["seal", "release", "receipt"]
                .iter()
                .any(|n| !v[*n].is_null()))
    {
        return Err(invalid("unsealed drain epoch or actions changed"));
    }
    if state == "ready" && current["work"].is_null() {
        return Err(invalid("ready drain work is unknown"));
    }
    if !v["seal"].is_null() {
        seal(&v["seal"], original)?
    }
    if !v["receipt"].is_null() {
        let receipt = &v["receipt"];
        fields(
            receipt,
            &["version", "seal", "epoch", "connection_retired", "work"],
            "seal receipt",
        )?;
        if receipt["version"] != 1
            || receipt["connection_retired"] != true
            || receipt["seal"] != v["seal"]
            || receipt["epoch"] != v["seal"]["id"]
        {
            return Err(invalid("seal receipt mismatch"));
        }
        work(&receipt["work"], true)?
    }
    if matches!(state, "sealed" | "sealing")
        && (v["seal"].is_null()
            || !v["release"].is_null()
            || state == "sealed" && v["receipt"].is_null()
            || state == "sealing" && !v["receipt"].is_null())
    {
        return Err(invalid("seal state action shape rejected"));
    }
    if state == "released" {
        release(&v["release"], original)?;
        if current["barrier_id"] == original["id"] {
            return Err(invalid("released drain retains original barrier"));
        }
    } else if !v["release"].is_null() {
        return Err(invalid("unreleased drain contains release"));
    }
    Ok(())
}
pub(crate) fn validate(result: &Value, params: &Value) -> Result<(), BridgeError> {
    fields(result, &["switch"], "switch result")?;
    let v = &result["switch"];
    fields(
        v,
        &[
            "mode",
            "binding_revision",
            "network_revision",
            "epoch",
            "lease",
            "connection",
            "frozen",
            "maintenance_allowed",
            "workers_stopped",
            "seal_persisted",
            "capabilities",
            "drain",
        ],
        "switch view",
    )?;
    if !matches!(text(v, "mode")?, "current" | "prepare" | "activate")
        || !matches!(text(v, "connection")?, "connected" | "disconnected")
        || !hex(text(v, "epoch")?, true)
        || !public(text(v, "lease")?, true)
    {
        return Err(invalid("switch view enum/identifier rejected"));
    }
    for n in [
        "frozen",
        "maintenance_allowed",
        "workers_stopped",
        "seal_persisted",
    ] {
        if !v[n].is_boolean() {
            return Err(invalid(format!("switch field={n} requires boolean")));
        }
    }
    for n in ["binding_revision", "network_revision"] {
        safe(v, n)?;
        // First pairing resets the prepared child's network configuration. This
        // read is its only allowed way to observe the effective revision.
        let preparation_observation = n == "network_revision"
            && v["mode"] == "prepare"
            && params["action"] == "inspect";
        if v[n] != params[n] && !preparation_observation {
            return Err(invalid(format!(
                "switch field={n} changed during coordinator action: actual={} required={} action={}",
                v[n], params[n], params["action"]
            )));
        }
    }
    if v["connection"] == "connected" && text(v, "lease")?.is_empty() {
        return Err(invalid("connected switch has no lease"));
    }
    if !v["capabilities"].is_null() {
        fields(
            &v["capabilities"],
            &["version", "device_drain"],
            "drain capabilities",
        )?;
        if v["capabilities"]["version"] != 1 || v["capabilities"]["device_drain"] != 1 {
            return Err(invalid("drain capability version unsupported"));
        }
    }
    if !v["drain"].is_null() {
        let original = if params["operation"].is_null() {
            if !matches!(
                text(params, "action")?,
                "inspect" | "capabilities" | "freeze"
            ) {
                return Err(invalid("switch reply has no original coordinator request"));
            }
            if v["seal_persisted"] != true || v["drain"]["receipt"].is_null() {
                return Err(invalid(
                    "historical switch reply requires persisted seal receipt",
                ));
            }
            &v["drain"]["request"]
        } else {
            &params["operation"]
        };
        drain(&v["drain"], original)?;
        if params["action"] == "drain_seal" && v["drain"]["seal"] != params["seal"] {
            return Err(invalid("seal action reply mismatch"));
        }
        if params["action"] == "drain_release" && v["drain"]["release"] != params["release"] {
            return Err(invalid("release action reply mismatch"));
        }
    }
    if v["mode"] == "prepare"
        && (v["connection"] == "connected" || v["maintenance_allowed"] == true)
    {
        return Err(invalid(
            "preparation reply grants forbidden connection or maintenance",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn preparation_inspect_observes_network_reset_after_first_pairing() {
        let mut params =
            json!({"action":"inspect","binding_revision":1,"network_revision":0,"operation":null});
        let mut result = json!({"switch":{"mode":"prepare","binding_revision":1,"network_revision":1,"epoch":"","lease":"","connection":"disconnected","frozen":true,"maintenance_allowed":false,"workers_stopped":false,"seal_persisted":false,"capabilities":null,"drain":null}});
        assert!(validate(&result, &params).is_ok());
        for action in ["capabilities", "freeze", "drain_begin", "connect", "commit"] {
            params["action"] = json!(action);
            assert!(validate(&result, &params).is_err(), "action={action}");
        }
        params["action"] = json!("inspect");
        result["switch"]["binding_revision"] = json!(2);
        assert!(validate(&result, &params).is_err());
        result["switch"]["binding_revision"] = json!(1);
        result["switch"]["network_revision"] = json!(9007199254740992u64);
        assert!(validate(&result, &params).is_err());
    }
    #[test]
    fn inspect_accepts_strict_saved_receipt_without_new_remote_operation() {
        let op = json!({"id":"1".repeat(48),"device_id":"device","owner_id":"owner","origin":"https://hive.example","expected_epoch":"","expected_lease":""});
        let seal = json!({"id":"2".repeat(48),"request":op});
        let work = json!({"executions":0,"unknown_terminations":0,"unsettled":0});
        let drain = json!({"version":1,"device_id":"device","owner_id":"owner","operation_id":op["id"],"state":"sealed","request":op,"seal":seal,"release":null,"receipt":{"version":1,"seal":seal,"epoch":"2".repeat(48),"connection_retired":true,"work":work},"current":{"epoch":"2".repeat(48),"lease":"","barrier_id":op["id"],"work":work}});
        let params =
            json!({"action":"inspect","binding_revision":1,"network_revision":0,"operation":null});
        let mut result = json!({"switch":{"mode":"current","binding_revision":1,"network_revision":0,"epoch":"2".repeat(48),"lease":"","connection":"disconnected","frozen":true,"maintenance_allowed":false,"workers_stopped":true,"seal_persisted":true,"capabilities":null,"drain":drain}});
        assert!(validate(&result, &params).is_ok());
        result["switch"]["drain"]["receipt"]["epoch"] = json!("3".repeat(48));
        assert!(validate(&result, &params).is_err());
    }
    #[test]
    fn preparation_action_gate_rejects_activation_and_stop() {
        for action in ["connect", "commit", "stop"] {
            assert!(!action_allowed(ProfileMode::Prepare, action));
            assert!(action_allowed(ProfileMode::Activate, action));
        }
    }
}
