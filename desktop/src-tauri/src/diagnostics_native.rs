use crate::{
    diagnostic_log::{
        assemble_export, DiagnosticExport, DiagnosticLogStore, ExportMetadata, LogPage, LogQuery,
    },
    diagnostics_protocol::{validate_report, DiagnosticReport},
    protocol::BridgeError,
    runtime_protocol::{validate_runtime_reply, RuntimeReplyKind},
    sidecar::{BridgeReply, Metadata},
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    sync::Mutex,
};
pub(crate) struct NativeDiagnostics {
    pub logs: DiagnosticLogStore,
    seen: Mutex<VecDeque<String>>,
    runtime_seen: Mutex<BTreeMap<String, String>>,
}
impl NativeDiagnostics {
    pub fn new(path: PathBuf) -> Self {
        Self {
            logs: DiagnosticLogStore::new(path),
            seen: Mutex::new(VecDeque::new()),
            runtime_seen: Mutex::new(BTreeMap::new()),
        }
    }
    pub fn capture(&self, reply: &BridgeReply) -> Result<DiagnosticReport, BridgeError> {
        let report = validate_report(&reply.result, &reply.instance)?;
        let mut seen = self.seen.lock().map_err(|_| BridgeError { details: None,
            code: "DIAGNOSTICS_LOG_LOCK".into(),
            message: "diagnostic projection mutex poisoned".into(),
        })?;
        for check in &report.checks {
            if check.code == "pending" {
                continue;
            }
            let event = serde_json::json!({"time":check.observed_at,"level":match check.status.as_str(){"fail"=>"error","warning"=>"warning",_=>"info"},"module":"diagnostics","platform":check.platform,"code":check.code,"evidence":check.evidence});
            let hash = format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&event).map_err(|_| BridgeError { details: None,
                    code: "DIAGNOSTICS_LOG_ENCODING".into(),
                    message: "safe diagnostic event serialization failed".into()
                })?)
            );
            if seen.contains(&hash) {
                continue;
            }
            self.logs.record(event)?;
            seen.push_back(hash);
            if seen.len() > 512 {
                seen.pop_front();
            }
        }
        Ok(report)
    }
    pub fn page(&self, query: LogQuery) -> Result<LogPage, BridgeError> {
        self.logs.page(query)
    }
    pub fn capture_runtime(&self, reply: &BridgeReply) -> Result<(), BridgeError> {
        validate_runtime_reply(&reply.result, RuntimeReplyKind::Snapshot)?;
        // A public operation error has no trustworthy observation time. It is
        // returned to the caller, never projected from its arbitrary message.
        let Some(runtime) = reply.result.get("runtime") else {
            return Ok(());
        };
        let local = runtime["local"].as_str().expect("validated local state");
        let connection = runtime["connection"]
            .as_str()
            .expect("validated connection state");
        let (code, level) = match (local, connection) {
            ("failed", _) => ("runtime_failed", "error"),
            (_, "occupied" | "rejected") => ("runtime_ownership_conflict", "warning"),
            ("stopped", _) => ("runtime_stopped", "info"),
            ("running", "connected") => ("owned_runtime_connected", "info"),
            (_, "disconnected") => ("connection_disconnected", "warning"),
            _ => ("runtime_unknown", "info"),
        };
        let mut events = vec![
            (
                "runtime".to_owned(),
                serde_json::json!({"time":runtime["observed_at"],"level":level,"module":"runtime","platform":null,"code":code,"evidence":{"local":local,"connection":connection}}),
            ),
            (
                "network".to_owned(),
                serde_json::json!({"time":runtime["observed_at"],"level":"info","module":"network","platform":null,"code":"network_policy_observed","evidence":{"network_revision":runtime["network_revision"].to_string()}}),
            ),
        ];
        for platform in ["openai", "claude"] {
            if let Some(supply) = runtime["platforms"][platform]["supply"].as_object() {
                let ready = supply["ready"]
                    .as_bool()
                    .expect("validated supply readiness");
                events.push((format!("supply:{platform}"), serde_json::json!({"time":runtime["observed_at"],"level":if ready{"info"}else{"warning"},"module":"runtime","platform":platform,"code":if ready{"taking_new_work"}else{"supply_blocked"},"evidence":{"ready":ready.to_string(),"paused":supply["paused"].to_string(),"reasons_count":supply["reasons"].as_array().expect("validated supply reasons").len().to_string()}})));
            }
        }
        let mut previous = self.runtime_seen.lock().map_err(|_| BridgeError { details: None,
            code: "DIAGNOSTICS_LOG_LOCK".into(),
            message:
                "runtime observation projection mutex poisoned; safe event persistence stopped"
                    .into(),
        })?;
        for (slot, event) in events {
            let mut signature = event.clone();
            signature
                .as_object_mut()
                .expect("structured safe event")
                .remove("time");
            // Instance/run context distinguishes a new owner without persisting
            // either identity. Only the immediately previous fact is compared,
            // so returning to an earlier state remains observable.
            let key = serde_json::json!([reply.instance, runtime["run_id"], signature]);
            let hash = format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&key).map_err(|_| BridgeError { details: None,
                    code: "DIAGNOSTICS_LOG_ENCODING".into(),
                    message: "runtime safe event projection serialization failed".into(),
                })?)
            );
            if previous.get(&slot) == Some(&hash) {
                continue;
            }
            self.logs.record(event)?;
            previous.insert(slot, hash);
        }
        Ok(())
    }
    pub fn export(
        &self,
        reply: &BridgeReply,
        include_logs: bool,
        metadata: Metadata,
    ) -> Result<DiagnosticExport, BridgeError> {
        let report = self.capture(reply)?;
        let logs = if include_logs {
            self.logs.export_entries()?
        } else {
            vec![]
        };
        assemble_export(
            ExportMetadata {
                app_version: env!("CARGO_PKG_VERSION").into(),
                bee_version: metadata.bee_version,
                os: metadata.os,
                arch: metadata.arch,
            },
            report,
            logs,
        )
    }
}

#[cfg(test)]
#[path = "diagnostics_native_tests.rs"]
mod tests;
