use crate::{
    diagnostics_protocol::DiagnosticReport,
    preferences::{private_write, protected_read_bounded},
    protocol::BridgeError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

pub(crate) const LOG_FILE_BYTES: usize = 5 * 1024 * 1024;
pub(crate) const LOG_FILES: usize = 3;
pub(crate) const REPORT_BYTES: usize = 5 * 1024 * 1024;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
const MAX_ENTRY_BYTES: usize = 16 * 1024;
static STORE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
fn error(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError { details: None,
        code: code.into(),
        message: message.into(),
    }
}
fn io_error(stage: &str, cause: std::io::Error) -> BridgeError {
    // io::Error Display may quote personal paths. Preserve only the operation,
    // OS category and raw OS code at this public boundary.
    error(
        "DIAGNOSTIC_LOG_IO",
        format!(
            "{stage} failed: kind={:?} os_code={:?}",
            cause.kind(),
            cause.raw_os_error()
        ),
    )
}
pub(crate) fn is_public_code(code: &str) -> bool {
    [
        "pending",
        "not_checked",
        "cancelled",
        "timeout",
        "unknown",
        "unknown_failure",
        "dns_failed",
        "tls_failed",
        "connection_failed",
        "invalid_origin",
        "http_rejected",
        "rate_limited",
        "device_replaced",
        "invalid_response",
        "response_too_large",
        "local_read_failed",
        "device_not_paired",
        "identity_unconfirmed",
        "identity_mismatch",
        "device_binding_valid",
        "runtime_stopped",
        "runtime_unknown",
        "runtime_failed",
        "connection_disconnected",
        "runtime_ownership_conflict",
        "owned_runtime_connected",
        "network_policy_observed",
        "hive_identity_verified",
        "selection_read_failed",
        "source_not_selected",
        "selection_unconfirmed",
        "source_changed",
        "selected_source_read",
        "authorization_expired",
        "network_changed",
        "expired",
        "unconfirmed",
        "official_result_unconfirmed",
        "quota_unconfirmed",
        "official_authorization_observed",
        "quota_available",
        "quota_exhausted",
        "account_result_unconfirmed",
        "account_binding_unconfirmed",
        "account_changed",
        "account_binding_verified",
        "capabilities_unconfirmed",
        "capabilities_synchronized",
        "supply_result_unconfirmed",
        "supply_blocked",
        "taking_new_work",
        "hive_check_failed",
        "source_missing",
        "source_unavailable",
        "permission_denied",
        "unsupported_store",
        "invalid_directory",
        "invalid_credentials",
        "deadline",
        "bridge_started",
        "bridge_stopped",
        "bridge_failed",
        "export_prepared",
        "export_completed",
        "export_cancelled",
        "export_failed",
    ]
    .contains(&code)
}
fn enum_value(value: &str, allowed: &[&str]) -> bool {
    allowed.contains(&value)
}
fn integer(value: &str, max: u64) -> bool {
    !value.is_empty()
        && value.len() <= 16
        && value.bytes().all(|b| b.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
        && value.parse::<u64>().is_ok_and(|n| n <= max)
}
fn safe_path(value: &str) -> bool {
    [
        "/api/bee/identity",
        "/api/bee/platforms/openai/account",
        "/api/bee/platforms/claude/account",
        "/api/bee/platforms/openai/capabilities",
        "/api/bee/platforms/claude/capabilities",
        "/api/bee/platforms/openai",
        "/api/bee/platforms/claude",
        "/backend-api/codex/models",
        "/backend-api/wham/usage",
        "/api/oauth/profile",
        "/api/oauth/usage",
        "/v1/models",
    ]
    .contains(&value)
}
fn public_reason(value: &str) -> bool {
    [
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
    ]
    .contains(&value)
}
pub(crate) fn sanitize_evidence(input: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    input
        .iter()
        .filter(|(key, value)| match key.as_str() {
            "identity_valid"
            | "identity_present"
            | "credential_valid"
            | "selected"
            | "pending_operation"
            | "source_revision_match"
            | "valid_beyond_safety_window"
            | "identity_match"
            | "generation_match"
            | "binding_stable"
            | "ready"
            | "paused"
            | "platform_match"
            | "not_found"
            | "permission_denied"
            | "parsed" => enum_value(value, &["true", "false"]),
            "network_revision" | "checked_revision" | "current_revision" => {
                integer(value, MAX_SEQUENCE)
            }
            "http_status" => integer(value, 599) && value.parse::<u16>().is_ok_and(|n| n >= 100),
            "windows" => integer(value, 5),
            "max_used_percent" => integer(value, 10000),
            "reasons_count" => integer(value, 64),
            "response_limit" => value.as_str() == "65536",
            "safety_seconds" => value.as_str() == "30",
            "method" => value.as_str() == "GET",
            "path" => safe_path(value),
            "reason" => public_reason(value),
            "source_type" => enum_value(
                value,
                &["desktop_device", "file", "keyring", "keychain", "auto"],
            ),
            "stage" => enum_value(
                value,
                &[
                    "session",
                    "device_configuration",
                    "selected_source",
                    "persisted_selection",
                    "account_readback",
                ],
            ),
            "local" => enum_value(
                value,
                &[
                    "stopped", "starting", "running", "stopping", "failed", "unknown",
                ],
            ),
            "connection" => enum_value(
                value,
                &[
                    "connected",
                    "disconnected",
                    "connecting",
                    "reconnecting",
                    "occupied",
                    "rejected",
                    "unknown",
                ],
            ),
            "status" => enum_value(
                value,
                &[
                    "ready",
                    "not_configured",
                    "confirmation_required",
                    "authorization_rejected",
                    "expired",
                    "unknown",
                ],
            ),
            "bee_upstream_path"
            | "official_query_path"
            | "openai_query_path"
            | "claude_query_path"
            | "hive_path" => enum_value(
                value,
                &[
                    "direct",
                    "local_connect",
                    "local_proxy",
                    "environment_proxy",
                    "environment_with_no_proxy",
                    "process_environment",
                    "unknown",
                ],
            ),
            "server_code" => enum_value(
                value,
                &[
                    "pending",
                    "draining",
                    "approved",
                    "redeemed",
                    "device_exists",
                    "device_draining",
                    "replacement_pending",
                    "pairing_expired",
                    "pairing_redeemed",
                    "invalid_device_credential",
                    "device_replaced",
                    "rate_limited",
                    "invalid_pairing",
                    "invalid_pairing_token",
                    "unavailable",
                    "device_changed",
                    "pairing_pending",
                    "unrecognized_code",
                ],
            ),
            _ => false,
        })
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}
fn timestamp(value: &str) -> bool {
    crate::runtime_protocol::timestamp(value)
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SafeDiagnosticEvent {
    pub time: String,
    pub level: String,
    pub module: String,
    pub platform: Option<String>,
    pub code: String,
    pub evidence: BTreeMap<String, String>,
}
fn sanitize_event(input: Value) -> Result<SafeDiagnosticEvent, BridgeError> {
    let object=input.as_object().ok_or_else(||error("DIAGNOSTIC_EVENT_REJECTED","diagnostic event requires a structured object; raw stderr and arbitrary error strings are forbidden"))?;
    let field = |name: &str| {
        object.get(name).and_then(Value::as_str).ok_or_else(|| {
            error(
                "DIAGNOSTIC_EVENT_REJECTED",
                format!("diagnostic field={name} missing or has non-string type"),
            )
        })
    };
    let time = field("time")?;
    if !timestamp(time) {
        return Err(error(
            "DIAGNOSTIC_EVENT_REJECTED",
            format!(
                "diagnostic time rejected: bytes={}; required=valid observation timestamp",
                time.len()
            ),
        ));
    }
    let level = field("level")?;
    if !enum_value(level, &["info", "warning", "error"]) {
        return Err(error(
            "DIAGNOSTIC_EVENT_REJECTED",
            "diagnostic level outside info,warning,error",
        ));
    }
    let module = field("module")?;
    if !enum_value(
        module,
        &[
            "diagnostics",
            "runtime",
            "network",
            "accounts",
            "device",
            "bridge",
            "lifecycle",
            "export",
        ],
    ) {
        return Err(error(
            "DIAGNOSTIC_EVENT_REJECTED",
            "diagnostic module outside fixed module set",
        ));
    }
    let platform = match object.get("platform") {
        None | Some(Value::Null) => None,
        Some(Value::String(p)) if enum_value(p, &["openai", "claude"]) => Some(p.clone()),
        _ => {
            return Err(error(
                "DIAGNOSTIC_EVENT_REJECTED",
                "diagnostic platform requires null,openai,claude",
            ))
        }
    };
    let code = field("code")?;
    let code = if is_public_code(code) {
        code
    } else {
        "unknown_failure"
    };
    let evidence = object
        .get("evidence")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(SafeDiagnosticEvent {
        time: time.into(),
        level: level.into(),
        module: module.into(),
        platform,
        code: code.into(),
        evidence: sanitize_evidence(&evidence),
    })
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LogQuery {
    pub cursor: Option<String>,
    pub limit: u16,
    pub module: Option<String>,
    pub platform: Option<String>,
    pub level: Option<String>,
}
#[derive(Debug, Serialize)]
pub(crate) struct LogPage {
    pub entries: Vec<SafeDiagnosticEvent>,
    pub next_cursor: Option<String>,
    pub truncated: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredRecord {
    sequence: u64,
    event: SafeDiagnosticEvent,
}
struct LogState {
    epoch: u128,
}
pub(crate) struct DiagnosticLogStore {
    directory: PathBuf,
    state: Mutex<LogState>,
    file_limit: usize,
}
impl DiagnosticLogStore {
    pub fn new(directory: PathBuf) -> Self {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        Self {
            directory,
            state: Mutex::new(LogState {
                epoch: time.wrapping_add(STORE_SEQUENCE.fetch_add(1, Ordering::Relaxed) as u128),
            }),
            file_limit: LOG_FILE_BYTES,
        }
    }
    fn file(&self, index: usize) -> PathBuf {
        self.directory.join(format!("diagnostic-{index}.jsonl"))
    }
    fn read_files(&self) -> Result<[Vec<u8>; LOG_FILES], BridgeError> {
        let mut files: [Vec<u8>; LOG_FILES] = std::array::from_fn(|_| Vec::new());
        for (index, bytes) in files.iter_mut().enumerate() {
            match protected_read_bounded(&self.file(index), self.file_limit as u64) {
                Ok(raw) => *bytes = raw,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(io_error("read protected diagnostic log", e)),
            }
        }
        Ok(files)
    }
    fn records(
        files: &[Vec<u8>; LOG_FILES],
    ) -> Result<BTreeMap<u64, SafeDiagnosticEvent>, BridgeError> {
        let mut records = BTreeMap::new();
        for file in files {
            if !file.is_empty() && !file.ends_with(b"\n") {
                return Err(error(
                    "DIAGNOSTIC_LOG_SCHEMA",
                    "diagnostic log last record is incomplete; required=newline-terminated records",
                ));
            }
            for (line, raw) in file
                .split(|b| *b == b'\n')
                .filter(|row| !row.is_empty())
                .enumerate()
            {
                if raw.len() > MAX_ENTRY_BYTES {
                    return Err(error(
                        "DIAGNOSTIC_LOG_SCHEMA",
                        format!(
                            "diagnostic record bytes={} limit={MAX_ENTRY_BYTES}",
                            raw.len()
                        ),
                    ));
                }
                let record: StoredRecord = serde_json::from_slice(raw).map_err(|_| {
                    error(
                        "DIAGNOSTIC_LOG_SCHEMA",
                        format!(
                            "diagnostic record schema rejected at line={}; raw contents excluded",
                            line + 1
                        ),
                    )
                })?;
                if record.sequence == 0 || record.sequence > MAX_SEQUENCE {
                    return Err(error(
                        "DIAGNOSTIC_LOG_SCHEMA",
                        "diagnostic record sequence outside safe positive integer range",
                    ));
                }
                let sanitized =
                    sanitize_event(serde_json::to_value(&record.event).map_err(|_| {
                        error(
                            "DIAGNOSTIC_LOG_SCHEMA",
                            "diagnostic record re-encoding failed",
                        )
                    })?)?;
                if sanitized != record.event {
                    return Err(error("DIAGNOSTIC_LOG_SCHEMA",format!("diagnostic record contains fields outside public evidence contract at line={}",line+1)));
                }
                if let Some(previous) = records.insert(record.sequence, record.event.clone()) {
                    if previous != record.event {
                        return Err(error(
                            "DIAGNOSTIC_LOG_SCHEMA",
                            "diagnostic record sequence has conflicting public events",
                        ));
                    }
                }
            }
        }
        Ok(records)
    }
    pub fn record(&self, input: Value) -> Result<SafeDiagnosticEvent, BridgeError> {
        let safe = sanitize_event(input)?;
        let _state = self.state.lock().map_err(|_| {
            error(
                "DIAGNOSTIC_LOG_LOCK",
                "diagnostic log lock poisoned; record not persisted",
            )
        })?;
        let files = self.read_files()?;
        let records = Self::records(&files)?;
        let sequence = records
            .last_key_value()
            .map(|(id, _)| *id)
            .unwrap_or_default()
            .checked_add(1)
            .filter(|n| *n <= MAX_SEQUENCE)
            .ok_or_else(|| {
                error(
                    "DIAGNOSTIC_LOG_LIMIT",
                    "diagnostic sequence exhausted; record not persisted",
                )
            })?;
        let mut encoded = serde_json::to_vec(&StoredRecord {
            sequence,
            event: safe.clone(),
        })
        .map_err(|_| error("DIAGNOSTIC_LOG_SCHEMA", "safe event encoding failed"))?;
        encoded.push(b'\n');
        if encoded.len() > self.file_limit || encoded.len() > MAX_ENTRY_BYTES {
            return Err(error(
                "DIAGNOSTIC_LOG_LIMIT",
                format!(
                    "safe diagnostic record bytes={} file_limit={} entry_limit={MAX_ENTRY_BYTES}",
                    encoded.len(),
                    self.file_limit
                ),
            ));
        }
        if files[0].len() + encoded.len() > self.file_limit {
            for index in (1..LOG_FILES).rev() {
                if !files[index - 1].is_empty() {
                    private_write(&self.file(index), &files[index - 1])
                        .map_err(|e| io_error("rotate protected diagnostic log", e))?
                }
            }
            private_write(&self.file(0), &encoded)
                .map_err(|e| io_error("publish rotated diagnostic log", e))?;
        } else {
            let mut current = files[0].clone();
            current.extend(encoded);
            private_write(&self.file(0), &current)
                .map_err(|e| io_error("publish protected diagnostic log", e))?;
        }
        Ok(safe)
    }
    pub fn page(&self, query: LogQuery) -> Result<LogPage, BridgeError> {
        if !(1..=200).contains(&query.limit) {
            return Err(error(
                "DIAGNOSTIC_QUERY_REJECTED",
                format!("diagnostic log limit={} required=1..200", query.limit),
            ));
        }
        for (field, value, allowed) in [
            (
                "module",
                query.module.as_deref(),
                &[
                    "diagnostics",
                    "runtime",
                    "network",
                    "accounts",
                    "device",
                    "bridge",
                    "lifecycle",
                    "export",
                ][..],
            ),
            (
                "platform",
                query.platform.as_deref(),
                &["openai", "claude"][..],
            ),
            (
                "level",
                query.level.as_deref(),
                &["info", "warning", "error"][..],
            ),
        ] {
            if value.is_some_and(|v| !allowed.contains(&v)) {
                return Err(error(
                    "DIAGNOSTIC_QUERY_REJECTED",
                    format!("diagnostic log filter={field} outside fixed enum"),
                ));
            }
        }
        let state = self.state.lock().map_err(|_| {
            error(
                "DIAGNOSTIC_LOG_LOCK",
                "diagnostic log lock poisoned; page unavailable",
            )
        })?;
        let files = self.read_files()?;
        let records = Self::records(&files)?;
        let maximum = records
            .last_key_value()
            .map(|(id, _)| *id)
            .unwrap_or_default();
        let fingerprint = filter_hash(&query);
        let mut watermark = maximum;
        let mut before = maximum + 1;
        if let Some(cursor) = query.cursor.as_deref() {
            if cursor.len() > 120 {
                return Err(error(
                    "DIAGNOSTIC_CURSOR_REJECTED",
                    "diagnostic cursor exceeds encoded limit",
                ));
            }
            let parts: Vec<_> = cursor.split(':').collect();
            if parts.len() != 5
                || parts[0] != "v1"
                || u128::from_str_radix(parts[1], 16).ok() != Some(state.epoch)
                || parts[4] != fingerprint
            {
                return Err(error("DIAGNOSTIC_CURSOR_REJECTED","diagnostic cursor is invalid, belongs to another filter or expired management session"));
            }
            watermark = parts[2].parse().map_err(|_| {
                error(
                    "DIAGNOSTIC_CURSOR_REJECTED",
                    "diagnostic cursor watermark is not an unsigned integer",
                )
            })?;
            before = parts[3].parse().map_err(|_| {
                error(
                    "DIAGNOSTIC_CURSOR_REJECTED",
                    "diagnostic cursor position is not an unsigned integer",
                )
            })?;
            if watermark > maximum || before == 0 || before > watermark + 1 {
                return Err(error(
                    "DIAGNOSTIC_CURSOR_REJECTED",
                    "diagnostic cursor position exceeds retained sequence bounds",
                ));
            }
        }
        let matches = |event: &&SafeDiagnosticEvent| {
            query.module.as_ref().is_none_or(|v| v == &event.module)
                && query
                    .platform
                    .as_ref()
                    .is_none_or(|v| event.platform.as_ref() == Some(v))
                && query.level.as_ref().is_none_or(|v| v == &event.level)
        };
        let mut available = records
            .iter()
            .rev()
            .filter(|(id, event)| **id <= watermark && **id < before && matches(event));
        let mut entries = vec![];
        let mut last = before;
        for (id, event) in available.by_ref().take(query.limit as usize) {
            last = *id;
            entries.push(event.clone());
        }
        let next_cursor = available
            .next()
            .map(|_| format!("v1:{:032x}:{watermark}:{last}:{fingerprint}", state.epoch));
        let truncated = records.first_key_value().is_some_and(|(id, _)| *id > 1);
        Ok(LogPage {
            entries,
            next_cursor,
            truncated,
        })
    }
    pub fn export_entries(&self) -> Result<Vec<SafeDiagnosticEvent>, BridgeError> {
        let _state = self.state.lock().map_err(|_| {
            error(
                "DIAGNOSTIC_LOG_LOCK",
                "diagnostic log lock poisoned; export snapshot unavailable",
            )
        })?;
        let files = self.read_files()?;
        Ok(Self::records(&files)?
            .into_iter()
            .rev()
            .map(|(_, event)| event)
            .collect())
    }
}
fn filter_hash(query: &LogQuery) -> String {
    let raw =
        serde_json::to_vec(&(&query.module, &query.platform, &query.level)).unwrap_or_default();
    let digest = Sha256::digest(raw);
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct ExportMetadata {
    pub app_version: String,
    pub bee_version: String,
    pub os: String,
    pub arch: String,
}
#[derive(Debug, Serialize)]
pub(crate) struct DiagnosticExport {
    pub product: &'static str,
    pub app_version: String,
    pub bee_version: String,
    pub os: String,
    pub arch: String,
    pub report: DiagnosticReport,
    pub logs: Vec<SafeDiagnosticEvent>,
    pub truncated: bool,
    pub truncated_sections: Vec<String>,
}
fn safe_version(version: &str) -> bool {
    if version == "dev" || version == "unknown" {
        return true;
    }
    if let Some(revision) = version.strip_prefix("dev+") {
        let revision = revision.strip_suffix("-dirty").unwrap_or(revision);
        return revision.len() == 12
            && revision
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    }
    let version = version.strip_prefix('v').unwrap_or(version);
    if version.len() > 64 {
        return false;
    }
    let main = version.split(['-', '+']).next().unwrap_or_default();
    let parts: Vec<_> = main.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|n| integer(n, 999999))
        && version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-+".contains(&b))
}
pub(crate) fn assemble_export(
    metadata: ExportMetadata,
    report: DiagnosticReport,
    logs: Vec<SafeDiagnosticEvent>,
) -> Result<DiagnosticExport, BridgeError> {
    if !safe_version(&metadata.app_version)
        || !safe_version(&metadata.bee_version)
        || !enum_value(&metadata.os, &["darwin", "macos", "windows", "linux"])
        || !enum_value(
            &metadata.arch,
            &["arm64", "aarch64", "amd64", "x86_64", "x86", "arm"],
        )
    {
        return Err(error(
            "DIAGNOSTIC_EXPORT_REJECTED",
            "diagnostic export metadata requires bounded versions and known OS/architecture",
        ));
    }
    let report = crate::diagnostics_protocol::validate_report(
        &serde_json::json!({"report":report}),
        &report.instance,
    )?;
    let mut safe_logs = Vec::with_capacity(logs.len());
    for event in logs {
        safe_logs.push(sanitize_event(serde_json::to_value(event).map_err(
            |_| {
                error(
                    "DIAGNOSTIC_EXPORT_REJECTED",
                    "diagnostic event encoding failed",
                )
            },
        )?)?);
    }
    let mut export = DiagnosticExport {
        product: "Bee",
        app_version: metadata.app_version,
        bee_version: metadata.bee_version,
        os: metadata.os,
        arch: metadata.arch,
        report,
        logs: safe_logs,
        truncated: false,
        truncated_sections: vec![],
    };
    let encoded_len = |value: &DiagnosticExport| {
        serde_json::to_vec(value)
            .map(|bytes| bytes.len())
            .map_err(|_| {
                error(
                    "DIAGNOSTIC_EXPORT_REJECTED",
                    "safe diagnostic export encoding failed",
                )
            })
    };
    if encoded_len(&export)? <= REPORT_BYTES {
        return Ok(export);
    }
    export.truncated = true;
    export.truncated_sections.push("logs".into());
    let mut low = 0;
    let mut high = export.logs.len();
    let all_logs = std::mem::take(&mut export.logs);
    while low < high {
        let count = low + (high - low).div_ceil(2);
        export.logs = all_logs[..count].to_vec();
        if encoded_len(&export)? <= REPORT_BYTES {
            low = count
        } else {
            high = count - 1
        }
    }
    export.logs = all_logs[..low].to_vec();
    while encoded_len(&export)? > REPORT_BYTES && !export.report.checks.is_empty() {
        if !export.truncated_sections.iter().any(|s| s == "checks") {
            export.truncated_sections.push("checks".into())
        }
        export.report.checks.pop();
    }
    if encoded_len(&export)? > REPORT_BYTES {
        return Err(error(
            "DIAGNOSTIC_EXPORT_LIMIT",
            format!("diagnostic export metadata exceeds byte_limit={REPORT_BYTES}"),
        ));
    }
    Ok(export)
}

#[cfg(test)]
#[path = "diagnostic_log_tests.rs"]
mod tests;
