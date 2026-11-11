//! A local recovery journal is written before dispatch. Unknown submissions are
//! never replayed into a new management instance.
use crate::{
    preferences::{private_write, protected_read_bounded},
    protocol::BridgeError,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub(crate) use crate::runtime_protocol::RecoveryProgress;
pub(crate) fn digest(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn error(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError::new(code, message.into())
}

// serde may quote a corrupt value or unknown field name. Preserve its failure
// description and expected schema, but only expose names from our fixed schema.
fn journal_schema_reason(error: &serde_json::Error) -> String {
    let message = error.to_string();
    if message.starts_with("unknown field ") {
        return "unknown field (name redacted); required=declared recovery journal schema fields".into();
    }
    let known_fields = ["version", "attempt_id", "instance", "binding_revision", "binding_identity", "network_revision", "previous_run_id", "account_revision", "intent_running", "trigger", "previous_attempt_id", "operation_id", "phase", "failure", "code", "message", "details"];
    let mut chars = message.chars().peekable();
    let mut safe = String::new();
    while let Some(character) = chars.next() {
        if character != '"' && character != '`' {
            safe.push(character);
            continue;
        }
        let mut quoted = String::new();
        while let Some(next) = chars.next() {
            if next == character { break; }
            quoted.push(next);
            if next == '\\' {
                if let Some(escaped) = chars.next() { quoted.push(escaped); }
            }
        }
        if character == '`' && known_fields.contains(&quoted.as_str()) {
            safe.push('`'); safe.push_str(&quoted); safe.push('`');
        } else {
            safe.push_str("[redacted]");
        }
    }
    safe
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryInspection {
    pub state: String,
    pub binding_revision: u64,
    #[serde(default)]
    pub binding_identity: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub previous_run_id: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub account_revision: Option<String>,
    pub intent_running: bool,
    #[serde(default)]
    pub retirement_id: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub failure: Option<BridgeError>,
}
impl RecoveryInspection {
    pub fn requires_retirement(&self) -> bool {
        self.failure.as_ref().is_some_and(|failure| {
            ["RECOVERY_SESSION_UNCONFIRMED", "RECOVERY_GUARD_UNCONFIRMED", "RECOVERY_RETIREMENT_UNCONFIRMED"]
                .contains(&failure.code.as_str())
        })
    }
}
fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
pub(crate) fn inspection(value: &serde_json::Value) -> Result<RecoveryInspection, BridgeError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Reply {
        recovery: RecoveryInspection,
    }
    let r: Reply = serde_json::from_value(value.clone())
        .map_err(|e| crate::protocol::invalid_json("recovery inspection", e))?;
    let v = r.recovery;
    if !["eligible", "idle", "blocked"].contains(&v.state.as_str())
        || (v.state == "blocked") != v.failure.is_some()
        || v.binding_identity.as_ref().is_some_and(|id| !digest(id,64))
        || v.binding_revision > 9_007_199_254_740_991
        || v.previous_run_id.as_ref().is_some_and(|id| !digest(id, 32))
        || v.account_revision
            .as_ref()
            .is_some_and(|id| !digest(id, 64))
        || v.retirement_id.as_ref().is_some_and(|id|!digest(id,48))
        || v.state == "eligible" && (!v.intent_running || v.account_revision.is_none())
    {
        return Err(error("RECOVERY_REPLY_INVALID",format!("recovery inspection rejected: state={} failure={} binding_revision={}; required=known disposition with matching failure and bounded context",v.state,v.failure.is_some(),v.binding_revision)));
    }
    Ok(v)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryRecord {
    pub version: u32,
    pub attempt_id: String,
    pub instance: String,
    pub binding_revision: u64,
    #[serde(default)]
    pub binding_identity: Option<String>,
    pub network_revision: u64,
    pub previous_run_id: Option<String>,
    pub account_revision: Option<String>,
    pub intent_running: bool,
    pub trigger: String,
    pub previous_attempt_id: Option<String>,
    pub operation_id: Option<String>,
    pub phase: String,
    pub failure: Option<BridgeError>,
}
pub(crate) struct RecoveryJournal {
    path: PathBuf,
}
impl RecoveryJournal {
    pub fn beside(path: &Path) -> Self {
        Self {
            path: path.with_file_name("desktop-startup-recovery.json"),
        }
    }
    pub fn load(&self) -> Result<Option<RecoveryRecord>, BridgeError> {
        let raw = match protected_read_bounded(&self.path, 65536) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => {
                return Err(error(
                    "RECOVERY_JOURNAL_IO",
                    format!(
                        "read recovery journal failed: kind={:?} os_code={:?}",
                        e.kind(),
                        e.raw_os_error()
                    ),
                ))
            }
        };
        let v: RecoveryRecord = serde_json::from_slice(&raw).map_err(|e| {
            error(
                "RECOVERY_JOURNAL_INVALID",
                format!(
                    "recovery journal schema rejected: {}; category={:?} line={} column={}; original preserved",
                    journal_schema_reason(&e),
                    e.classify(),
                    e.line(),
                    e.column()
                ),
            )
        })?;
        Self::validate(&v)?;
        Ok(Some(v))
    }
    fn validate(v: &RecoveryRecord) -> Result<(), BridgeError> {
        let checks = [
            ("version", v.version == 1, "1"),
            ("attempt_id", digest(&v.attempt_id, 32), "32 lowercase hex characters"),
            ("instance", digest(&v.instance, 32), "32 lowercase hex characters"),
            ("binding_identity", v.binding_identity.as_ref().is_none_or(|id| digest(id, 64)), "absent or 64 lowercase hex characters"),
            ("binding_revision", v.binding_revision <= 9_007_199_254_740_991, "safe integer"),
            ("network_revision", v.network_revision <= 9_007_199_254_740_991, "safe integer"),
            ("operation_id", v.operation_id.as_ref().is_none_or(|id| digest(id, 48)), "absent or 48 lowercase hex characters"),
            ("previous_run_id", v.previous_run_id.as_ref().is_none_or(|id| digest(id, 32)), "absent or 32 lowercase hex characters"),
            ("account_revision", v.account_revision.as_ref().is_none_or(|id| digest(id, 64)), "absent or 64 lowercase hex characters"),
            ("previous_attempt_id", v.previous_attempt_id.as_ref().is_none_or(|id| digest(id, 32) && id != &v.attempt_id), "absent or distinct 32-character hex identity"),
            ("trigger", ["automatic", "manual"].contains(&v.trigger.as_str()), "automatic or manual"),
            ("phase", ["submitted", "succeeded", "failed", "unknown", "retired"].contains(&v.phase.as_str()), "known recovery phase"),
            ("retired_failure", v.phase != "retired" || v.failure.as_ref().is_some_and(|failure| failure.code == "RECOVERY_PREVIOUS_RETIRED"), "retired phase retains RECOVERY_PREVIOUS_RETIRED evidence"),
            ("failure_presence", !(v.phase == "failed" && v.failure.is_none() || ["submitted", "succeeded"].contains(&v.phase.as_str()) && v.failure.is_some()), "failed requires failure; submitted and succeeded require no failure"),
        ];
        if let Some((field, _, required)) = checks.iter().find(|(_, valid, _)| !valid) {
            return Err(error("RECOVERY_JOURNAL_INVALID", format!("recovery journal {field}_valid=false; required={required}; original preserved")));
        }
        Ok(())
    }
    // A new manager may retire an unknown *session*, while preserving the
    // original operation's unknown outcome. Never label that operation failed.
    pub fn retire_previous(&self, inspection:&RecoveryInspection, instance:&str) -> Result<(),BridgeError> {
        let Some(proof)=inspection.retirement_id.as_ref() else {return Ok(());};
        let Some(mut old)=self.load()? else {return Ok(());};
        if !["submitted","unknown"].contains(&old.phase.as_str()) {return Ok(());}
        if old.instance==instance || old.binding_identity.is_none() || old.binding_identity!=inspection.binding_identity {
            return Err(error("RECOVERY_CONTEXT_CHANGED", "retirement cannot be bound to a previous management instance and original device binding"));
        }
        old.phase="retired".into();
        old.failure=Some(error("RECOVERY_PREVIOUS_RETIRED",format!("previous session retired by durable proof={proof}; original operation={:?} outcome remains unconfirmed; prior evidence={:?}",old.operation_id,old.failure)));
        self.save(&old)
    }
    pub async fn observe(
        &self,
        bridge: &crate::sidecar::Bridge,
    ) -> Result<Option<RecoveryRecord>, BridgeError> {
        let Some(mut record) = self.load()? else {
            return Ok(None);
        };
        if !["submitted", "unknown"].contains(&record.phase.as_str()) {
            return Ok(Some(record));
        }
        let reply = bridge.runtime_snapshot().await?;
        let runtime = &reply.result["runtime"];
        let context = bridge.device_context().await?;
        let binding = crate::protocol::device_context_state(&context.result)?.binding_revision;
        if reply.instance != record.instance
            || context.instance != record.instance
            || binding != record.binding_revision
            || runtime["network_revision"].as_u64() != Some(record.network_revision)
            || record.operation_id.is_none()
            || runtime["operation"]["id"].as_str() != record.operation_id.as_deref()
            || runtime["operation"]["kind"] != "start"
        {
            return Err(error("RECOVERY_RESULT_UNCONFIRMED",format!("recovery result cannot be bound to original attempt={} operation={:?}; original instance, binding, network and operation required; prior failure={:?}",record.attempt_id,record.operation_id,record.failure)));
        }
        match runtime["operation"]["state"].as_str() {
            Some("succeeded") if runtime["local"]=="running" && runtime["connection"]=="connected" && runtime["run_id"].is_string() || ["waiting","stopped"].contains(&runtime["local"].as_str().unwrap_or("")) && runtime["connection"]=="disconnected" && runtime["run_id"].is_null()=>{record.phase="succeeded".into();record.failure=None;self.save(&record)?;},
            Some("failed"|"cancelled")=>{record.phase="failed".into();record.failure=Some(error("RECOVERY_FAILED",format!("original recovery operation terminated: state={} error={}; no replay",runtime["operation"]["state"],runtime["operation"]["error"])));self.save(&record)?;},
            _=>return Err(error("RECOVERY_RESULT_UNCONFIRMED",format!("original recovery attempt={} operation={:?} state={}; continue querying this operation only",record.attempt_id,record.operation_id,runtime["operation"]["state"])))
        }
        Ok(Some(record))
    }
    pub fn save(&self, v: &RecoveryRecord) -> Result<(), BridgeError> {
        Self::validate(v)?;
        if let Some(old) = self.load()? {
            if old.attempt_id == v.attempt_id
                && (old.instance != v.instance
                    || old.binding_revision != v.binding_revision
                    || old.binding_identity != v.binding_identity
                    || old.network_revision != v.network_revision
                    || old.previous_run_id != v.previous_run_id
                    || old.account_revision != v.account_revision
                    || old.intent_running != v.intent_running
                    || old.trigger != v.trigger
                    || old.previous_attempt_id != v.previous_attempt_id
                    || old.operation_id.is_some() && old.operation_id != v.operation_id
                    || ["succeeded", "failed", "retired"].contains(&old.phase.as_str())
                        && (old.phase != v.phase
                            || serde_json::to_value(&old.failure).ok()
                                != serde_json::to_value(&v.failure).ok()))
            {
                return Err(error(
                    "RECOVERY_JOURNAL_CONFLICT",
                    "recovery journal update changed immutable context or terminal result",
                ));
            }
            if old.attempt_id != v.attempt_id
                && ["submitted", "unknown"].contains(&old.phase.as_str())
            {
                return Err(error(
                    "RECOVERY_RESULT_UNCONFIRMED",
                    "prior recovery submission remains unresolved; new attempt rejected",
                ));
            }
            if old.attempt_id != v.attempt_id {
                if v.previous_attempt_id.as_deref() != Some(&old.attempt_id) {
                    return Err(error(
                        "RECOVERY_JOURNAL_CONFLICT",
                        "new recovery attempt must retain its predecessor identity",
                    ));
                }
                let archive = self
                    .path
                    .with_file_name(format!("desktop-startup-recovery-{}.json", old.attempt_id));
                let bytes = serde_json::to_vec(&old).map_err(|e| {
                    error(
                        "RECOVERY_JOURNAL_INVALID",
                        format!("encode previous recovery result: {e}"),
                    )
                })?;
                match protected_read_bounded(&archive, 65536) {
                    Ok(existing) if existing == bytes => {}
                    Ok(_) => {
                        return Err(error(
                            "RECOVERY_JOURNAL_CONFLICT",
                            "previous recovery archive differs; original preserved",
                        ))
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        private_write(&archive, &bytes).map_err(|e| {
                            error(
                                "RECOVERY_JOURNAL_IO",
                                format!(
                                    "preserve previous recovery result: kind={:?} os_code={:?}",
                                    e.kind(),
                                    e.raw_os_error()
                                ),
                            )
                        })?
                    }
                    Err(e) => {
                        return Err(error(
                            "RECOVERY_JOURNAL_IO",
                            format!(
                                "read previous recovery result: kind={:?} os_code={:?}",
                                e.kind(),
                                e.raw_os_error()
                            ),
                        ))
                    }
                }
            }
        }
        let bytes = serde_json::to_vec(v).map_err(|e| {
            error(
                "RECOVERY_JOURNAL_INVALID",
                format!("encode recovery record: {e}"),
            )
        })?;
        private_write(&self.path,&bytes).map_err(|e|error("RECOVERY_JOURNAL_IO",format!("save recovery journal failed: kind={:?} os_code={:?}; no new restore permitted",e.kind(),e.raw_os_error())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record() -> RecoveryRecord {
        RecoveryRecord {
            version: 1,
            attempt_id: "a".repeat(32),
            instance: "b".repeat(32),
            binding_revision: 1,
            binding_identity: Some("a".repeat(64)),
            network_revision: 0,
            previous_run_id: None,
            account_revision: Some("c".repeat(64)),
            intent_running: true,
            trigger: "automatic".into(),
            previous_attempt_id: None,
            operation_id: None,
            phase: "submitted".into(),
            failure: None,
        }
    }
    #[test]
    fn journal_errors_identify_failed_checks_without_copying_untrusted_values() {
        let dir = tempfile::tempdir().unwrap();
        let journal = RecoveryJournal::beside(&dir.path().join("update.json"));
        let mut invalid = record();
        invalid.binding_identity = Some("SECRET-BINDING".into());
        let cause = RecoveryJournal::validate(&invalid).unwrap_err();
        assert!(cause.message.contains("binding_identity_valid=false"), "{}", cause.message);
        assert!(!cause.message.contains("SECRET-BINDING"));
        let mut value = serde_json::to_value(record()).unwrap();
        value.as_object_mut().unwrap().remove("phase");
        private_write(&journal.path, &serde_json::to_vec(&value).unwrap()).unwrap();
        let cause = journal.load().unwrap_err();
        assert!(cause.message.contains("missing field `phase`"), "{}", cause.message);
        value["phase"] = serde_json::json!("submitted");
        value["intent_running"] = serde_json::json!("SECRET-VALUE");
        private_write(&journal.path, &serde_json::to_vec(&value).unwrap()).unwrap();
        let cause = journal.load().unwrap_err();
        assert!(cause.message.contains("invalid type: string"), "{}", cause.message);
        assert!(cause.message.contains("expected a boolean"), "{}", cause.message);
        assert!(!cause.message.contains("SECRET-VALUE"));
        value["intent_running"] = serde_json::json!(true);
        value["unexpected`SECRET-KEY"] = serde_json::json!(true);
        private_write(&journal.path, &serde_json::to_vec(&value).unwrap()).unwrap();
        let cause = journal.load().unwrap_err();
        assert!(cause.message.contains("unknown field"));
        assert!(!cause.message.contains("SECRET-KEY"));
    }
    #[test]
    fn verified_retirement_preserves_unknown_outcome_and_allows_linked_new_attempt() {
        let dir=tempfile::tempdir().unwrap();
        let j=RecoveryJournal::beside(&dir.path().join("update.json"));
        let mut old=record();old.operation_id=Some("d".repeat(48));old.phase="unknown".into();
        old.failure=Some(error("BRIDGE_TRANSPORT","original response lost"));j.save(&old).unwrap();
        let inspected=inspection(&serde_json::json!({"recovery":{"state":"eligible","binding_revision":1,"previous_run_id":"e".repeat(32),"account_revision":"f".repeat(64),"intent_running":true,"failure":null,"retirement_id":"a".repeat(48),"binding_identity":"a".repeat(64)}})).unwrap();
        assert_eq!(j.retire_previous(&inspected,&old.instance).unwrap_err().code,"RECOVERY_CONTEXT_CHANGED");
        assert_eq!(j.load().unwrap().unwrap().phase,"unknown");
        j.retire_previous(&inspected,&"f".repeat(32)).unwrap();
        let retired=j.load().unwrap().unwrap();assert_eq!(retired.phase,"retired");assert_eq!(retired.operation_id,old.operation_id);
        let failure=retired.failure.unwrap();assert_eq!(failure.code,"RECOVERY_PREVIOUS_RETIRED");assert!(failure.message.contains("original response lost"));
        let mut next=record();next.attempt_id="e".repeat(32);next.previous_attempt_id=Some(old.attempt_id);next.instance="f".repeat(32);j.save(&next).unwrap();
        assert_eq!(j.load().unwrap().unwrap().attempt_id,next.attempt_id);
    }
    #[test]
    fn retirement_requires_durable_binding_even_when_process_revisions_match() {
        for binding in [None, Some("f".repeat(64))] {
            let dir=tempfile::tempdir().unwrap();
            let journal=RecoveryJournal::beside(&dir.path().join("update.json"));
            let mut old=record();old.phase="unknown".into();old.binding_identity=binding;
            journal.save(&old).unwrap();
            let inspected=inspection(&serde_json::json!({"recovery":{"state":"eligible","binding_revision":1,"previous_run_id":null,"account_revision":"f".repeat(64),"intent_running":true,"failure":null,"retirement_id":"a".repeat(48),"binding_identity":"a".repeat(64)}})).unwrap();
            assert_eq!(journal.retire_previous(&inspected,&"f".repeat(32)).unwrap_err().code,"RECOVERY_CONTEXT_CHANGED");
            assert_eq!(journal.load().unwrap().unwrap().phase,"unknown");
        }
        let mut forged=record();forged.phase="retired".into();
        assert!(RecoveryJournal::validate(&forged).is_err());
    }
    #[test]
    fn missing_retirement_proof_cannot_settle_unknown_submission() {
        let dir=tempfile::tempdir().unwrap();let j=RecoveryJournal::beside(&dir.path().join("update.json"));
        let mut old=record();old.phase="unknown".into();j.save(&old).unwrap();
        let inspected=inspection(&serde_json::json!({"recovery":{"state":"eligible","binding_revision":1,"previous_run_id":null,"account_revision":"f".repeat(64),"intent_running":true,"failure":null}})).unwrap();
        j.retire_previous(&inspected,&"f".repeat(32)).unwrap();assert_eq!(j.load().unwrap().unwrap().phase,"unknown");
    }
    #[test]
    fn unresolved_submission_and_terminal_records_cannot_be_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let j = RecoveryJournal::beside(&dir.path().join("update.json"));
        let mut r = record();
        j.save(&r).unwrap();
        let mut other = r.clone();
        other.attempt_id = "c".repeat(32);
        assert!(j.save(&other).is_err());
        r.phase = "succeeded".into();
        j.save(&r).unwrap();
        r.phase = "unknown".into();
        assert!(j.save(&r).is_err());
    }
    #[test]
    fn damaged_journal_is_preserved_and_blocks_submission() {
        let dir = tempfile::tempdir().unwrap();
        let j = RecoveryJournal::beside(&dir.path().join("update.json"));
        private_write(&j.path, b"broken").unwrap();
        assert!(j.save(&record()).is_err());
        assert_eq!(std::fs::read(&j.path).unwrap(), b"broken");
    }
    #[test]
    fn a_new_attempt_preserves_the_previous_terminal_result_and_scope() {
        let dir=tempfile::tempdir().unwrap();
        let j=RecoveryJournal::beside(&dir.path().join("update.json"));
        let mut old=record();old.phase="failed".into();old.failure=Some(error("RECOVERY_FAILED","original preparation rejected"));j.save(&old).unwrap();
        let mut next=record();next.attempt_id="d".repeat(32);
        assert!(j.save(&next).is_err());
        next.previous_attempt_id=Some(old.attempt_id.clone());next.trigger="manual".into();j.save(&next).unwrap();
        let raw=protected_read_bounded(&j.path.with_file_name(format!("desktop-startup-recovery-{}.json",old.attempt_id)),65536).unwrap();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&raw).unwrap(),serde_json::to_value(&old).unwrap());
        next.intent_running=false;assert!(j.save(&next).is_err());
    }
    #[test]
    fn inspection_rejects_forged_eligibility_and_progress_rejects_fake_counts() {
        assert!(inspection(&serde_json::json!({"recovery":{"state":"eligible","binding_revision":1,"previous_run_id":null,"failure":{"code":"X","message":"blocked"}}})).is_err());
        let mut p = RecoveryProgress::stage("preparing_accounts");
        p.total = Some(1);
        p.completed = Some(2);
        assert!(p.validate().is_err());
    }
    #[tokio::test]
    async fn original_operation_readback_settles_unknown_without_replay() {
        for (mode, expected) in [
            ("owned-exit", "succeeded"),
            ("owned-exit-restore-failure", "failed"),
        ] {
            let bridge = crate::sidecar::Bridge::start(crate::sidecar::tests::fixture(mode));
            bridge.inspect_recovery().await.unwrap();
            let _ = bridge.restore_when_ready().await;
            let snapshot = bridge.runtime_snapshot().await.unwrap();
            let dir = tempfile::tempdir().unwrap();
            let j = RecoveryJournal::beside(&dir.path().join("update.json"));
            let mut r = record();
            r.instance = snapshot.instance;
            r.operation_id = snapshot.result["runtime"]["operation"]["id"]
                .as_str()
                .map(str::to_owned);
            r.network_revision = snapshot.result["runtime"]["network_revision"]
                .as_u64()
                .unwrap();
            r.phase = "unknown".into();
            j.save(&r).unwrap();
            assert_eq!(j.observe(&bridge).await.unwrap().unwrap().phase, expected);
            assert_eq!(
                bridge.runtime_snapshot().await.unwrap().result["runtime"]["revision"],
                snapshot.result["runtime"]["revision"]
            );
            bridge.stop().await.unwrap();
        }
    }
    #[tokio::test]
    async fn another_management_instance_cannot_settle_or_replace_unknown_submission() {
        let bridge = crate::sidecar::Bridge::start(crate::sidecar::tests::fixture("owned-exit"));
        bridge.inspect_recovery().await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let j = RecoveryJournal::beside(&dir.path().join("update.json"));
        let mut r = record();
        r.operation_id = Some("d".repeat(48));
        j.save(&r).unwrap();
        let before = std::fs::read(&j.path).unwrap();
        assert_eq!(
            j.observe(&bridge).await.unwrap_err().code,
            "RECOVERY_RESULT_UNCONFIRMED"
        );
        assert_eq!(std::fs::read(&j.path).unwrap(), before);
        assert!(!bridge.0.restored.load(std::sync::atomic::Ordering::SeqCst));
        bridge.stop().await.unwrap();
    }
}
