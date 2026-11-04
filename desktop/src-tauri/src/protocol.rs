use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_FRAME_BYTES: usize = 1 << 20;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(try_from = "String", rename_all = "lowercase")]
pub enum SupplyPlatform {
    Openai,
    Claude,
}

impl TryFrom<String> for SupplyPlatform {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "openai" => Ok(Self::Openai),
            "claude" => Ok(Self::Claude),
            _ => Err(format!("supply platform is outside the allowed enum: actual bytes={}; required=openai,claude", value.len())),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AccountDetectRequest {
    pub platform: SupplyPlatform,
    #[serde(deserialize_with = "account_directory")]
    pub directory: Option<String>,
    pub store: String,
    pub mode: String,
}
fn account_directory<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
impl AccountDetectRequest {
    pub fn validate(&self) -> Result<(), BridgeError> {
        let rejected = |message: String| BridgeError::new("ACCOUNT_REQUEST_REJECTED", message);
        if let Some(path) = &self.directory {
            if path.is_empty()
                || path.len() > 4096
                || !std::path::Path::new(path).is_absolute()
                || path.chars().any(char::is_control)
            {
                return Err(rejected(format!("account directory rejected: bytes={} absolute={} control_present={}; required=nonempty absolute path <=4096 UTF-8 bytes without controls",path.len(),std::path::Path::new(path).is_absolute(),path.chars().any(char::is_control))));
            }
        }
        let valid = match self.platform {
            SupplyPlatform::Openai => ["auto", "file", "keyring"].contains(&self.store.as_str()),
            SupplyPlatform::Claude => ["file", "keychain"].contains(&self.store.as_str()),
        };
        if !valid {
            return Err(rejected(format!(
                "account store rejected for platform: bytes={}; required=platform store whitelist",
                self.store.len()
            )));
        }
        if !["local", "official"].contains(&self.mode.as_str()) {
            return Err(rejected(format!(
                "account mode rejected: bytes={}; required=local,official",
                self.mode.len()
            )));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AccountActionRequest {
    pub platform: SupplyPlatform,
    pub revision: u64,
    pub candidate_ref: String,
    pub action: String,
    pub confirmed: bool,
}
impl AccountActionRequest {
    pub fn validate(&self) -> Result<(), BridgeError> {
        if self.revision > 9007199254740991 {
            return Err(BridgeError::new(
                "ACCOUNT_REQUEST_REJECTED",
                format!(
                    "account revision rejected: actual={}; required=safe nonnegative integer",
                    self.revision
                ),
            ));
        }
        if !(self.action == "clear_selection" && self.candidate_ref.is_empty())
            && (self.candidate_ref.len() != 48
                || !self
                    .candidate_ref
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
        {
            return Err(BridgeError::new("ACCOUNT_REQUEST_REJECTED",format!("account candidate_ref rejected: bytes={}; required=48 lowercase hex characters",self.candidate_ref.len())));
        }
        if !["select", "confirm_change", "remove", "clear_selection"]
            .contains(&self.action.as_str())
        {
            return Err(BridgeError::new(
                "ACCOUNT_REQUEST_REJECTED",
                format!(
                    "account action rejected: bytes={}; required=fixed action whitelist",
                    self.action.len()
                ),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct FailureDetails {
    pub check: String,
    pub observed_at: String,
    pub evidence: std::collections::BTreeMap<String, String>,
}
fn public_identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
pub(crate) fn safe_failure_text(value: &str) -> bool {
    if value
        .chars()
        .any(|c| c.is_control() && !"\n\r\t".contains(c))
    {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    for prefix in [
        "bearer ",
        "authorization",
        "credential",
        "token",
        "secret",
        "password",
        "api_key",
        "api-key",
    ] {
        let mut rest = lower.as_str();
        while let Some((before, tail)) = rest.split_once(prefix) {
            let boundary = before
                .chars()
                .last()
                .is_none_or(|c| !c.is_ascii_alphanumeric() && c != '_');
            let tail = tail.trim_start_matches(['\"', '\'']).trim_start();
            let assigned = if prefix == "bearer " {
                Some(tail)
            } else {
                tail.strip_prefix(':').or_else(|| tail.strip_prefix('='))
            };
            if boundary
                && assigned.is_some_and(|v| {
                    !v.trim_start()
                        .trim_start_matches(['\"', '\''])
                        .starts_with("[redacted]")
                })
            {
                return false;
            }
            if tail.is_empty() {
                break;
            }
            rest = tail;
        }
    }
    for prefix in ["bee_", "beep_", "sk-"] {
        if lower.split(prefix).skip(1).any(|tail| {
            tail.bytes()
                .take_while(|b| b.is_ascii_alphanumeric() || b"_-".contains(b))
                .count()
                >= 8
        }) {
            return false;
        }
    }
    for word in value.split(|c: char| c.is_whitespace() || "<>\"'".contains(c)) {
        if [
            "http://",
            "https://",
            "ws://",
            "wss://",
            "socks5://",
            "socks5h://",
        ]
        .iter()
        .any(|s| word.to_ascii_lowercase().starts_with(s))
        {
            if word.contains('?')
                || word.contains('#')
                || tauri::Url::parse(word)
                    .is_ok_and(|u| !u.username().is_empty() || u.password().is_some())
            {
                return false;
            }
        }
    }
    true
}
pub(crate) fn failure_origin(value: &str) -> bool {
    let authority = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"));
    let shape = authority.is_some_and(|a| {
        !a.is_empty() && !a.chars().any(|c| c.is_whitespace() || "/?#@\\".contains(c))
    });
    let host = authority
        .map(|a| {
            if a.starts_with('[') {
                a.split_once(']').map_or(a, |(h, _)| &h[1..])
            } else {
                a.split_once(':').map_or(a, |(h, _)| h)
            }
        })
        .unwrap_or("");
    let local=host=="localhost"||host.parse::<std::net::IpAddr>().is_ok_and(|ip|ip.is_loopback()||matches!(ip,std::net::IpAddr::V6(v) if v.to_ipv4_mapped().is_some_and(|v|v.is_loopback())));
    shape
        && tauri::Url::parse(value).is_ok_and(|u| {
            u.username().is_empty()
                && u.password().is_none()
                && u.query().is_none()
                && u.fragment().is_none()
                && (u.scheme() == "https" || u.scheme() == "http" && local)
        })
}
/// Shared strict contract for request/HTTP lifecycle evidence and log projection.
pub(crate) fn retry_evidence(key: &str, value: &str) -> Option<bool> {
    let integer = |maximum: u64| {
        !value.is_empty()
            && value.len() <= 16
            && (value == "0" || !value.starts_with('0'))
            && value.bytes().all(|b| b.is_ascii_digit())
            && value.parse::<u64>().is_ok_and(|n| n <= maximum)
    };
    Some(match key {
        "request_id" => value.strip_prefix("shell-").is_some_and(|suffix| {
            !suffix.is_empty()
                && !suffix.starts_with('0')
                && suffix.bytes().all(|b| b.is_ascii_digit())
                && suffix.parse::<u64>().is_ok()
        }),
        "method" => [
            "GET",
            "POST",
            "PUT",
            "hello",
            "ping",
            "shutdown",
            "device_status",
            "device_begin",
            "device_context",
            "device_recovery_prepare",
            "device_recovery_confirm",
            "device_recovery_status",
            "account_defaults",
            "account_detect",
            "account_snapshot",
            "account_action",
            "supply_status",
            "supply_set_paused",
            "authorize_start",
            "authorize_status",
            "authorize_cancel",
            "diagnostics_start",
            "diagnostics_snapshot",
            "diagnostics_cancel",
            "runtime_snapshot",
            "runtime_start",
            "runtime_stop",
            "runtime_restore",
            "runtime_configure_network",
            "runtime_enable_presence",
            "runtime_verify",
            "network_status",
            "network_test",
            "notification_snapshot",
        ]
        .contains(&value),
        "platform" => ["none", "openai", "claude"].contains(&value),
        "phase" => [
            "queue",
            "write",
            "response",
            "http_start",
            "http_end",
            "http_error",
        ]
        .contains(&value),
        "queue_ms" | "execution_ms" | "elapsed_ms" => integer(9_007_199_254_740_991),
        "failure_kind" => [
            "timeout",
            "dns_temporary",
            "dns_failed",
            "tls_failed",
            "connection_refused",
            "connection_closed",
            "http_rejected",
            "unknown_failure",
        ]
        .contains(&value),
        "retry_after_seconds" => integer(2_147_483_647),
        "fully_sent" | "in_flight" => ["true", "false"].contains(&value),
        _ => return None,
    })
}
impl FailureDetails {
    pub fn validate(&self) -> Result<(), String> {
        let observed = time::OffsetDateTime::parse(
            &self.observed_at,
            &time::format_description::well_known::Rfc3339,
        );
        if !public_identifier(&self.check, 80)
            || !crate::runtime_protocol::timestamp(&self.observed_at)
            || observed.is_err()
            || observed
                .is_ok_and(|v| v > time::OffsetDateTime::now_utc() + time::Duration::seconds(5))
        {
            return Err("failure details require bounded check and valid UTC observation no later than now+5s".into());
        }
        for (key, value) in &self.evidence {
            if value.len() > 32768 || !safe_failure_text(value) {
                return Err(format!("failure evidence rejected: key={key} bytes={}; required=safe text at most 32768 bytes",value.len()));
            }
            let valid = match key.as_str() {
                "target_origin" => failure_origin(value),
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
                "remote_code" => public_identifier(value, 128),
                "source_type" => public_identifier(value, 80),
                "response_body" | "actual" | "required" => true,
                _ => retry_evidence(key, value).unwrap_or(false),
            };
            if !valid {
                return Err(format!("failure evidence key/value rejected: key={key}; required=fixed safe public field"));
            }
        }
        Ok(())
    }
}
impl<'de> Deserialize<'de> for FailureDetails {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            check: String,
            observed_at: String,
            #[serde(deserialize_with = "failure_evidence")]
            evidence: std::collections::BTreeMap<String, String>,
        }
        let v = Wire::deserialize(d)?;
        let result = Self {
            check: v.check,
            observed_at: v.observed_at,
            evidence: v.evidence,
        };
        result.validate().map_err(serde::de::Error::custom)?;
        Ok(result)
    }
}
fn failure_evidence<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<std::collections::BTreeMap<String, String>, D::Error> {
    struct Fields;
    impl<'de> serde::de::Visitor<'de> for Fields {
        type Value = std::collections::BTreeMap<String, String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("unique safe evidence fields")
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut map: A,
        ) -> Result<Self::Value, A::Error> {
            let mut fields = std::collections::BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, String>()? {
                if fields.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom(
                        "failure evidence duplicate field rejected",
                    ));
                }
            }
            Ok(fields)
        }
    }
    d.deserialize_map(Fields)
}
fn failure_details<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<FailureDetails>, D::Error> {
    FailureDetails::deserialize(d).map(Some)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct BridgeError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<FailureDetails>,
}

impl<'de> Deserialize<'de> for BridgeError {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            code: String,
            message: String,
            #[serde(default, deserialize_with = "failure_details")]
            details: Option<FailureDetails>,
        }
        let value = Wire::deserialize(d)?;
        if value.code.is_empty()
            || value.code.len() > 128
            || !value.code.as_bytes()[0].is_ascii_alphabetic()
            || !value
                .code
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
            || value.message.is_empty()
            || value.message.len() > 32768
            || value
                .message
                .chars()
                .any(|c| c.is_control() && !"\n\r\t".contains(c))
        {
            return Err(serde::de::Error::custom("failure code/message rejected; required=public code 1..128 and safe message 1..32768 bytes"));
        }
        match value.details {
            Some(details) => Self::with_details(&value.code, value.message, details)
                .map_err(|e| serde::de::Error::custom(e.message)),
            None => Ok(Self::new(&value.code, value.message)),
        }
    }
}

impl BridgeError {
    pub fn with_details(
        code: &str,
        message: String,
        details: FailureDetails,
    ) -> Result<Self, Self> {
        details
            .validate()
            .map_err(|reason| Self::new("FAILURE_DETAILS_INVALID", reason))?;
        Ok(Self {
            code: code.into(),
            message,
            details: Some(details),
        })
    }
    pub(crate) fn new(code: &str, message: String) -> Self {
        Self {
            code: code.into(),
            message,
            details: None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub protocol: u32,
    pub id: String,
    pub instance: String,
    #[serde(default, deserialize_with = "present")]
    pub result: Option<Value>,
    #[serde(default, deserialize_with = "present")]
    pub error: Option<BridgeError>,
}

// Preserve explicit null instead of treating it as an absent result field.
fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Hello {
    pub bee_version: String,
    pub os: String,
    pub arch: String,
    pub capabilities: Vec<String>,
}

#[derive(Default)]
pub struct FrameDecoder {
    partial: Vec<u8>,
    failure: Option<BridgeError>,
}

impl FrameDecoder {
    // The caller reads bounded chunks from the child. A protocol failure poisons
    // this decoder; it cannot later turn the same session back into ready.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Envelope>, BridgeError> {
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        let result = self.decode(bytes);
        if let Err(error) = &result {
            self.failure = Some(error.clone());
        }
        result
    }

    fn decode(&mut self, bytes: &[u8]) -> Result<Vec<Envelope>, BridgeError> {
        let mut frames = Vec::new();
        for part in bytes.split_inclusive(|byte| *byte == b'\n') {
            let terminated = part.last() == Some(&b'\n');
            let body = if terminated {
                &part[..part.len() - 1]
            } else {
                part
            };
            let length = self.partial.len().saturating_add(body.len());
            if length > MAX_FRAME_BYTES {
                return Err(BridgeError::new(
                    "FRAME_TOO_LARGE",
                    format!("reply bytes>={length}; maximum={MAX_FRAME_BYTES} before newline"),
                ));
            }
            self.partial.extend_from_slice(body);
            if terminated {
                let frame = decode_envelope(&self.partial)?;
                self.partial.clear();
                frames.push(frame);
            }
        }
        Ok(frames)
    }

    pub fn finish(&self) -> Result<(), BridgeError> {
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        if !self.partial.is_empty() {
            return Err(BridgeError::new(
                "INCOMPLETE_FRAME",
                format!(
                    "child stdout EOF after bytes={} without required newline",
                    self.partial.len()
                ),
            ));
        }
        Ok(())
    }
}

fn decode_envelope(bytes: &[u8]) -> Result<Envelope, BridgeError> {
    if let Err(error) = std::str::from_utf8(bytes) {
        return Err(BridgeError::new(
            "INVALID_UTF8",
            format!(
                "reply UTF-8 validation failed at byte={}; frame bytes={}",
                error.valid_up_to(),
                bytes.len()
            ),
        ));
    }
    let frame: Envelope =
        serde_json::from_slice(bytes).map_err(|error| invalid_json("reply envelope", error))?;
    if frame.protocol != 1 {
        return Err(BridgeError::new(
            "VERSION_MISMATCH",
            format!("reply protocol={}; required=1", frame.protocol),
        ));
    }
    if frame.instance.is_empty() {
        return Err(BridgeError::new(
            "INVALID_REPLY",
            "reply instance is empty; required=nonempty instance identifier".into(),
        ));
    }
    if frame.result.is_some() == frame.error.is_some() {
        return Err(BridgeError::new(
            "INVALID_REPLY",
            format!(
                "reply result present={}, error present={}; required=exactly one",
                frame.result.is_some(),
                frame.error.is_some()
            ),
        ));
    }
    if frame.id.is_empty() && frame.error.is_none() {
        return Err(BridgeError::new(
            "INVALID_REPLY",
            "successful reply id is empty; required=request ID".into(),
        ));
    }
    if let Some(error) = &frame.error {
        if error.code.is_empty() || error.message.is_empty() {
            return Err(BridgeError::new("INVALID_REPLY", format!("reply error code bytes={}, message bytes={}; required=nonempty code and message", error.code.len(), error.message.len())));
        }
    }
    Ok(frame)
}

pub(crate) fn invalid_json(stage: &str, error: serde_json::Error) -> BridgeError {
    // serde errors can quote an unknown key or value. Expose the failed
    // check, location and category without copying the child's raw payload.
    BridgeError::new(
        "INVALID_REPLY",
        format!(
            "{stage} JSON validation failed at line={}, column={}, category={:?}",
            error.line(),
            error.column(),
            error.classify()
        ),
    )
}

impl Envelope {
    pub fn success(self, id: &str, instance: Option<&str>) -> Result<Value, BridgeError> {
        if self.id != id {
            return Err(BridgeError::new(
                "RESPONSE_ID_MISMATCH",
                format!(
                    "reply id differs from pending request; actual bytes={}, required ID bytes={}",
                    self.id.len(),
                    id.len()
                ),
            ));
        }
        if let Some(instance) = instance {
            if self.instance != instance {
                return Err(BridgeError::new("INSTANCE_MISMATCH", format!("reply instance differs from owned child; actual bytes={}, required instance bytes={}", self.instance.len(), instance.len())));
            }
        }
        if let Some(error) = self.error {
            return Err(error);
        }
        self.result.ok_or_else(|| {
            BridgeError::new(
                "INVALID_REPLY",
                "reply result is absent; required=successful result".into(),
            )
        })
    }
}

pub fn hello(value: Value, version: &str, os: &str, arch: &str) -> Result<Hello, BridgeError> {
    let metadata: Hello =
        serde_json::from_value(value).map_err(|error| invalid_json("hello result", error))?;
    for (field, actual, expected) in [
        ("bee_version", metadata.bee_version.as_str(), version),
        ("os", metadata.os.as_str(), os),
        ("arch", metadata.arch.as_str(), arch),
    ] {
        if actual != expected {
            return Err(BridgeError::new("BUILD_MISMATCH", format!("hello {field} differs from bundled build; actual bytes={}, required={expected}; comparison=different", actual.len())));
        }
    }
    let basic = vec!["ping".to_string(), "shutdown".to_string()];
    let devices = vec![
        "ping".to_string(),
        "shutdown".to_string(),
        "device_status".to_string(),
        "device_begin".to_string(),
    ];
    let mut supplies = devices.clone();
    supplies.extend(["supply_status".to_string(), "supply_set_paused".to_string()]);
    let mut accounts = supplies.clone();
    accounts.extend(
        [
            "account_defaults",
            "account_detect",
            "account_snapshot",
            "account_action",
        ]
        .map(str::to_string),
    );
    let mut runtime = accounts.clone();
    runtime.extend(
        [
            "runtime_snapshot",
            "runtime_start",
            "runtime_stop",
            "runtime_configure_network",
        ]
        .map(str::to_string),
    );
    let mut authorize = runtime.clone();
    authorize
        .extend(["authorize_start", "authorize_status", "authorize_cancel"].map(str::to_string));
    let mut recovery = runtime.clone();
    recovery.push("runtime_restore".into());
    let mut recovery_authorize = recovery.clone();
    recovery_authorize
        .extend(["authorize_start", "authorize_status", "authorize_cancel"].map(str::to_string));
    let mut candidates = Vec::new();
    for prefix in [
        &basic,
        &devices,
        &supplies,
        &accounts,
        &runtime,
        &authorize,
        &recovery,
        &recovery_authorize,
    ] {
        candidates.push(prefix.clone());
        let mut network = prefix.clone();
        network.extend(["network_status", "network_test"].map(str::to_string));
        candidates.push(network);
        if prefix.len() >= runtime.len() {
            let mut diagnostics = prefix.clone();
            diagnostics.extend(
                [
                    "diagnostics_start",
                    "diagnostics_snapshot",
                    "diagnostics_cancel",
                ]
                .map(str::to_string),
            );
            candidates.push(diagnostics.clone());
            diagnostics.extend(["network_status", "network_test"].map(str::to_string));
            candidates.push(diagnostics);
        }
    }
    let notification_candidates: Vec<_> = candidates
        .iter()
        .filter(|group| {
            group.iter().any(|m| m == "account_snapshot")
                && group
                    .iter()
                    .any(|m| m == "network_test" || m == "diagnostics_start")
        })
        .map(|group| {
            let mut group = group.clone();
            group.push("notification_snapshot".into());
            group
        })
        .collect();
    candidates.extend(notification_candidates);
    let local_candidates: Vec<_> = candidates
        .clone()
        .into_iter()
        .flat_map(|group| {
            let mut variants = Vec::new();
            if group.iter().any(|m| m == "device_status") {
                let mut context = group.clone();
                context.push("device_context".into());
                variants.push(context.clone());
                if group.iter().any(|m| m == "runtime_restore") {
                    context.push("runtime_verify".into());
                    variants.push(context);
                }
            }
            variants
        })
        .collect();
    candidates.extend(local_candidates);
    let recovery_candidates: Vec<_> = candidates
        .clone()
        .into_iter()
        .filter(|v| v.iter().any(|m| m == "device_status"))
        .map(|mut v| {
            v.extend(
                [
                    "device_recovery_prepare",
                    "device_recovery_confirm",
                    "device_recovery_status",
                ]
                .map(str::to_string),
            );
            v
        })
        .collect();
    candidates.extend(recovery_candidates);
    let presence_candidates: Vec<_> = candidates
        .iter()
        .filter_map(|group| {
            let index = group.iter().position(|m| m == "runtime_restore")?;
            let mut group = group.clone();
            group.insert(index + 1, "runtime_enable_presence".into());
            Some(group)
        })
        .collect();
    candidates.extend(presence_candidates);
    if !candidates.contains(&metadata.capabilities) {
        let expected = candidates
            .iter()
            .filter(|v| v.len() == metadata.capabilities.len())
            .max_by_key(|v| {
                v.iter()
                    .zip(&metadata.capabilities)
                    .take_while(|(a, b)| a == b)
                    .count()
            });
        if let Some(expected) = expected {
            let (index, (actual, required)) = metadata
                .capabilities
                .iter()
                .zip(expected)
                .enumerate()
                .find(|(_, (a, b))| a != b)
                .unwrap();
            let observed = if candidates.iter().any(|v| v.contains(actual)) {
                actual.clone()
            } else {
                format!("unknown member bytes={}", actual.len())
            };
            return Err(BridgeError::new("CAPABILITY_MISMATCH",format!("hello capability order rejected at index={index} (zero-based); expected={required}; actual={observed}")));
        }
        return Err(BridgeError::new("CAPABILITY_MISMATCH", format!("hello capability count rejected; actual count={}; required counts=2,4,6,10,14,17 with complete optional diagnostics/network groups", metadata.capabilities.len())));
    }
    Ok(metadata)
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountOperationError {
    code: String,
    check: String,
    platform: String,
    message: String,
    evidence: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountOperation {
    id: String,
    kind: String,
    #[serde(deserialize_with = "present_operation_platform")]
    platform: Option<SupplyPlatform>,
    state: String,
    revision: u64,
    #[serde(deserialize_with = "present_operation_error")]
    error: Option<AccountOperationError>,
}
fn present_operation_platform<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<SupplyPlatform>, D::Error> {
    Option::<SupplyPlatform>::deserialize(d)
}
fn present_operation_error<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<AccountOperationError>, D::Error> {
    Option::<AccountOperationError>::deserialize(d)
}

pub fn validate_account_operation(
    result: &Value,
    platform: SupplyPlatform,
) -> Result<(), BridgeError> {
    // Account operation failures use the existing domain-error envelope.
    if result.get("error").is_some() {
        return Ok(());
    }
    let invalid = |message: &str| BridgeError::new("ACCOUNT_REPLY_INVALID", message.into());
    let account = result
        .get("account")
        .ok_or_else(|| invalid("account result missing"))?;
    if account.get("platform") != Some(&serde_json::json!(platform)) {
        return Err(invalid("account result platform differs from request"));
    }
    let raw = account
        .get("operation")
        .ok_or_else(|| invalid("account.operation missing; required=explicit null or operation"))?;
    if raw.is_null() {
        return Ok(());
    }
    validate_operation(
        raw,
        Some(platform),
        &["select", "clear_selection", "confirm_change", "authorize"],
    )
}

pub(crate) fn validate_operation(
    raw: &Value,
    platform: Option<SupplyPlatform>,
    kinds: &[&str],
) -> Result<(), BridgeError> {
    let invalid = |message: &str| BridgeError::new("ACCOUNT_REPLY_INVALID", message.into());
    let op: AccountOperation =
        serde_json::from_value(raw.clone()).map_err(|e| invalid_json("account.operation", e))?;
    if op.id.len() != 48
        || !op
            .id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid("operation ID rejected; required=48 lowercase hex"));
    }
    if op.platform != platform {
        return Err(invalid("operation platform differs from account request"));
    }
    if !kinds.contains(&op.kind.as_str()) {
        return Err(invalid("operation kind outside account actions"));
    }
    if ![
        "pending",
        "running",
        "reconciling",
        "succeeded",
        "failed",
        "cancelled",
    ]
    .contains(&op.state.as_str())
    {
        return Err(invalid("operation state outside known lifecycle"));
    }
    if op.revision > 9007199254740991 {
        return Err(invalid("operation revision exceeds JS safe integer"));
    }
    if let Some(error) = op.error {
        let identifier = |v: &str| {
            !v.is_empty()
                && v.len() <= 80
                && v.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        };
        if !identifier(&error.code)
            || !identifier(&error.check)
            || !["openai", "claude", "unknown"].contains(&error.platform.as_str())
            || error.message.len() > 32768
        {
            return Err(invalid(
                "operation error fields rejected; required=public identifiers and bounded message",
            ));
        }
        let allowed = [
            "not_found",
            "permission_denied",
            "os_error",
            "cause",
            "parsed",
            "profile_scope",
            "inference_scope",
            "expires_at",
            "source_revision_match",
            "http_status",
            "path",
            "transport_failed",
            "confirmed",
            "observed_at",
            "retry_after_seconds",
            "method",
            "phase",
            "elapsed_ms",
        ];
        if error.evidence.iter().any(|(k, v)| {
            !allowed.contains(&k.as_str())
                || v.len() > 32768
                || k == "observed_at"
                    && (!crate::runtime_protocol::timestamp(v)
                        || !time::OffsetDateTime::parse(
                            v,
                            &time::format_description::well_known::Rfc3339,
                        )
                        .is_ok_and(|at| at <= time::OffsetDateTime::now_utc() + time::Duration::seconds(5)))
                || retry_evidence(k, v).is_some_and(|valid| !valid)
        }) {
            return Err(invalid(
                "operation evidence contains unsupported fields or oversized value",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod desktop_failure_tests {
    use super::*;
    #[test]
    fn structured_errors_retain_details_and_reject_invalid_evidence() {
        let good = serde_json::json!({"code":"http_rejected","message":"HTTP 503","details":{"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"target_origin":"https://hive.test","http_status":"503"}}});
        let parsed: BridgeError =
            serde_json::from_value(good.clone()).expect("valid failure details");
        assert_eq!(serde_json::to_value(parsed).unwrap(), good);
        for detail in [
            serde_json::json!(null),
            serde_json::json!({"check":"device_identity","observed_at":"2026-02-30T00:00:00Z","evidence":{}}),
            serde_json::json!({"check":"device_identity","observed_at":"2099-01-01T00:00:00Z","evidence":{}}),
            serde_json::json!({"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"token":"secret"}}),
            serde_json::json!({"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"actual":"Bearer SECRET"}}),
        ] {
            let mut bad = good.clone();
            bad["details"] = detail;
            assert!(serde_json::from_value::<BridgeError>(bad).is_err());
        }
        assert!(serde_json::from_value::<BridgeError>(
            serde_json::json!({"code":"OLD","message":"legacy"})
        )
        .is_ok());
    }
}

#[cfg(test)]
mod failure_safety_contract_tests {
    use super::*;
    #[test]
    fn details_use_go_origin_contract_and_safe_response_fields() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../desktopbridge/testdata/connection-origin-contract.json"
        ))
        .unwrap();
        let details = |origin: Value| serde_json::json!({"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"target_origin":origin}});
        for item in fixture["accepted"].as_array().unwrap() {
            assert!(
                serde_json::from_value::<FailureDetails>(details(item["hive"].clone())).is_ok(),
                "{}",
                item["hive"]
            );
        }
        for origin in fixture["rejected"].as_array().unwrap() {
            assert!(
                serde_json::from_value::<FailureDetails>(details(origin.clone())).is_err(),
                "{origin}"
            );
        }
        for body in [
            r#"{"token":"SECRET"}"#,
            r#"{"secret":"SECRET"}"#,
            "https://hive.test/path?token=SECRET",
        ] {
            assert!(serde_json::from_value::<FailureDetails>(serde_json::json!({"check":"device_identity","observed_at":"2026-10-30T12:00:00Z","evidence":{"response_body":body}})).is_err(),"unsafe response accepted");
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeviceContext {
    pub hive: String,
    pub name: String,
    #[serde(deserialize_with = "present_context_id")]
    pub device_id: Option<String>,
    #[serde(deserialize_with = "present_context_id")]
    pub owner_id: Option<String>,
    pub binding_revision: u64,
}
fn present_context_id<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
pub(crate) fn result_error(value: &Value) -> Result<(), BridgeError> {
    if let Some(error) = value.get("error") {
        if value.as_object().is_none_or(|v| v.len() != 1) {
            return Err(BridgeError::new(
                "INVALID_REPLY",
                "error result requires exactly one error".into(),
            ));
        }
        return Err(serde_json::from_value(error.clone())
            .map_err(|e| invalid_json("operation error", e))?);
    }
    Ok(())
}
pub(crate) struct DeviceContextState {
    pub binding_revision: u64,
    pub failure: Option<BridgeError>,
}
pub(crate) fn device_context_state(value: &Value) -> Result<DeviceContextState, BridgeError> {
    if value.get("error").is_some() {
        if value.get("binding_revision").is_none() {
            result_error(value)?;
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct FailedContext {
            error: BridgeError,
            binding_revision: u64,
        }
        let failed: FailedContext = serde_json::from_value(value.clone())
            .map_err(|e| invalid_json("device context state", e))?;
        if failed.binding_revision == 0
            || failed.binding_revision > 9_007_199_254_740_991
            || !matches!(
                failed.error.code.as_str(),
                "DEVICE_CONTEXT_INVALID" | "DEVICE_CONTEXT_UNCONFIGURED"
            )
        {
            return Err(BridgeError::new("DEVICE_CONTEXT_INVALID",format!("context failure observation rejected: binding_revision={} local_failure={}; required=positive safe session revision and local configuration failure",failed.binding_revision,matches!(failed.error.code.as_str(), "DEVICE_CONTEXT_INVALID" | "DEVICE_CONTEXT_UNCONFIGURED"))));
        }
        return Ok(DeviceContextState {
            binding_revision: failed.binding_revision,
            failure: Some(failed.error),
        });
    }
    let context = device_context(value)?;
    Ok(DeviceContextState {
        binding_revision: context.binding_revision,
        failure: None,
    })
}
pub(crate) fn device_context(value: &Value) -> Result<DeviceContext, BridgeError> {
    if value.get("error").is_some() && value.get("binding_revision").is_some() {
        return Err(device_context_state(value)?
            .failure
            .expect("validated context failure"));
    }
    result_error(value)?;
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Envelope {
        context: DeviceContext,
    }
    let context = serde_json::from_value::<Envelope>(value.clone())
        .map_err(|e| invalid_json("device context", e))?
        .context;
    if !failure_origin(&context.hive) {
        return Err(BridgeError::new("DEVICE_CONTEXT_INVALID","saved Hive rejected; required=secure origin without credentials, path, query or fragment".into()));
    }
    let valid_id = |s: &String| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    };
    if context.name.trim().is_empty()
        || context.name.chars().count() > 80
        || context.name.chars().any(char::is_control)
        || context.binding_revision == 0
        || context.binding_revision > 9_007_199_254_740_991
        || context.device_id.is_some() != context.owner_id.is_some()
        || context.device_id.as_ref().is_some_and(|s| !valid_id(s))
        || context.owner_id.as_ref().is_some_and(|s| !valid_id(s))
    {
        return Err(BridgeError::new("DEVICE_CONTEXT_INVALID","saved context rejected; required=safe name,paired public IDs and positive safe binding revision".into()));
    }
    Ok(context)
}

#[cfg(test)]
mod device_context_tests {
    use super::*;
    #[test]
    fn context_keeps_go_origins_and_rejects_incomplete_or_secret_fields() {
        let base = serde_json::json!({"hive":"https://hive.example","name":"Saved Mac","device_id":"device","owner_id":"owner","binding_revision":1});
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../desktopbridge/testdata/connection-origin-contract.json"
        ))
        .unwrap();
        for item in fixture["accepted"].as_array().unwrap() {
            let mut c = base.clone();
            c["hive"] = item["hive"].clone();
            assert!(
                device_context(&serde_json::json!({"context":c})).is_ok(),
                "{}",
                item["hive"]
            );
        }
        for origin in fixture["rejected"].as_array().unwrap() {
            let mut c = base.clone();
            c["hive"] = origin.clone();
            assert!(
                device_context(&serde_json::json!({"context":c})).is_err(),
                "{origin}"
            );
        }
        for field in ["hive", "name", "device_id", "owner_id", "binding_revision"] {
            let mut c = base.clone();
            c.as_object_mut().unwrap().remove(field);
            assert!(
                device_context(&serde_json::json!({"context":c})).is_err(),
                "missing {field}"
            );
        }
        for change in [
            serde_json::json!({"credential":"SECRET"}),
            serde_json::json!({"device_id":null}),
            serde_json::json!({"binding_revision":0}),
            serde_json::json!({"binding_revision":9_007_199_254_740_992_u64}),
            serde_json::json!({"name":"bad\nname"}),
        ] {
            let mut c = base.clone();
            c.as_object_mut()
                .unwrap()
                .extend(change.as_object().unwrap().clone());
            assert!(device_context(&serde_json::json!({"context":c})).is_err());
        }
        assert_eq!(device_context(&serde_json::json!({"error":{"code":"DEVICE_CONTEXT_INVALID","message":"saved JSON invalid"}})).unwrap_err().code,"DEVICE_CONTEXT_INVALID");
    }
}

#[cfg(test)]
mod device_context_state_tests {
    use super::*;
    #[test]
    fn observed_binding_failure_is_strict_and_retains_revision() {
        let failure = serde_json::json!({"error":{"code":"DEVICE_CONTEXT_INVALID","message":"saved JSON rejected"},"binding_revision":7});
        assert_eq!(device_context_state(&serde_json::json!({"error":{"code":"DEVICE_CONTEXT_FAILED","message":"configuration ownership unavailable"}})).err().unwrap().code,"DEVICE_CONTEXT_FAILED");
        let state = device_context_state(&failure).unwrap();
        assert_eq!(state.binding_revision, 7);
        assert_eq!(state.failure.unwrap().code, "DEVICE_CONTEXT_INVALID");

        for value in [
            serde_json::json!({"error":{"code":"DEVICE_CONTEXT_INVALID","message":"bad"},"binding_revision":0}),
            serde_json::json!({"error":{"code":"DEVICE_CONTEXT_INVALID","message":"bad"},"binding_revision":1,"context":{}}),
            serde_json::json!({"error":{"code":"DEVICE_CONTEXT_FAILED","message":"bad"},"binding_revision":1}),
        ] {
            assert!(device_context(&value).is_err());
        }
        assert_eq!(
            device_context(&failure).unwrap_err().code,
            "DEVICE_CONTEXT_INVALID"
        );
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeviceRecoveryConfirm {
    pub operation_id: String,
    pub expected_revision: u64,
    pub decision: String,
}
impl DeviceRecoveryConfirm {
    pub fn validate(&self) -> Result<(), BridgeError> {
        if self.operation_id.len() != 48
            || !self
                .operation_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || self.expected_revision == 0
            || self.expected_revision >= 9_007_199_254_740_991
            || !["begin_pairing", "adopt_owner", "renew_expired"].contains(&self.decision.as_str())
        {
            return Err(BridgeError::new("DEVICE_RECOVERY_REQUEST_INVALID","recovery confirmation requires operation ID, positive safe revision and fixed decision".into()));
        }
        Ok(())
    }
}
fn recovery_fields(value: &Value, fields: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|v| v.len() == fields.len() && fields.iter().all(|k| v.contains_key(*k)))
}
fn recovery_identity(value: &Value) -> bool {
    if value.is_null() {
        return true;
    }
    recovery_fields(value, &["id", "name", "owner_id", "owner_email"])
        && ["id", "name", "owner_id", "owner_email"].iter().all(|k| {
            value[*k]
                .as_str()
                .is_some_and(|s| !s.is_empty() && !s.chars().any(char::is_control))
        })
        && ["id", "owner_id"].iter().all(|k| {
            value[*k].as_str().is_some_and(|s| {
                s.len() <= 128
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            })
        })
        && value["name"]
            .as_str()
            .is_some_and(|s| s.chars().count() <= 80)
        && value["owner_email"]
            .as_str()
            .is_some_and(|s| s.len() <= 320)
}
pub(crate) fn device_recovery(value: &Value) -> Result<&Value, BridgeError> {
    result_error(value)?;
    let rejected = || {
        BridgeError::new("DEVICE_RECOVERY_INVALID","public recovery fields or phase facts rejected; required=bounded operation identity, safe public identities/pairing and structured failure".into())
    };
    if !recovery_fields(value, &["recovery"]) {
        return Err(rejected());
    }
    let r = &value["recovery"];
    if !recovery_fields(
        r,
        &[
            "operation_id",
            "revision",
            "phase",
            "old_identity",
            "new_identity",
            "pairing",
            "failure",
        ],
    ) {
        return Err(rejected());
    }
    if !r["operation_id"].as_str().is_some_and(|s| {
        s.len() == 48
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }) || !r["revision"]
        .as_u64()
        .is_some_and(|v| v > 0 && v < 9_007_199_254_740_991)
        || ![
            "awaiting_confirmation",
            "creating",
            "creation_unknown",
            "pending",
            "draining",
            "redeeming",
            "redemption_unknown",
            "awaiting_owner_confirmation",
            "saving",
            "completed",
            "expired",
            "blocked",
        ]
        .contains(&r["phase"].as_str().unwrap_or(""))
        || !recovery_identity(&r["old_identity"])
        || !recovery_identity(&r["new_identity"])
    {
        return Err(rejected());
    }
    let p = &r["pairing"];
    if !p.is_null() {
        if !recovery_fields(p, &["code", "verification_url", "expires_at"]) {
            return Err(rejected());
        }
        let code = p["code"].as_str().ok_or_else(rejected)?;
        if code.len() != 9
            || !code.bytes().enumerate().all(|(i, b)| {
                if i == 4 {
                    b == b'-'
                } else {
                    b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b)
                }
            })
            || !p["expires_at"].as_str().is_some_and(|s| {
                time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339)
                    .is_ok()
            })
        {
            return Err(rejected());
        }
        let url = tauri::Url::parse(p["verification_url"].as_str().ok_or_else(rejected)?)
            .map_err(|_| rejected())?;
        let origin = url.origin().ascii_serialization();
        let query: Vec<_> = url.query_pairs().collect();
        if !failure_origin(&origin)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || url.path() != "/devices/pair"
            || query.len() != 1
            || query[0].0 != "code"
            || query[0].1 != code
        {
            return Err(rejected());
        }
    }
    let phase = r["phase"].as_str().unwrap_or("");
    if ["pending", "draining", "redeeming", "redemption_unknown"].contains(&phase) && p.is_null()
        || ["saving", "completed", "awaiting_owner_confirmation"].contains(&phase)
            && r["new_identity"].is_null()
    {
        return Err(rejected());
    }
    if !r["failure"].is_null() {
        let _: BridgeError = serde_json::from_value(r["failure"].clone())
            .map_err(|e| invalid_json("device recovery failure", e))?;
    }
    Ok(r)
}
pub(crate) fn validate_device_recovery(value: &Value) -> Result<(), BridgeError> {
    result_error(value)?;
    let rejected = || {
        BridgeError::new(
            "DEVICE_REPLY_INVALID",
            "initial pairing state conflicts with its public recovery transaction".into(),
        )
    };
    let device = value.get("device").ok_or_else(rejected)?;
    let fields = [
        "state",
        "hive",
        "name",
        "verification_url",
        "user_code",
        "expires_at",
        "poll_interval_seconds",
        "identity",
        "recovery",
    ];
    if !recovery_fields(value, &["device"])
        || !device
            .as_object()
            .is_some_and(|v| v.keys().all(|k| fields.contains(&k.as_str())))
    {
        return Err(rejected());
    }
    let state = device["state"].as_str().ok_or_else(rejected)?;
    if ![
        "unbound", "pending", "draining", "expired", "bound", "pairing",
    ]
    .contains(&state)
    {
        return Err(rejected());
    }
    if state == "bound" {
        if device.get("identity").is_none()
            || device["identity"].is_null()
            || !recovery_identity(&device["identity"])
        {
            return Err(rejected());
        }
    } else if device.get("identity").is_some() {
        return Err(rejected());
    }
    if let Some(recovery) = device.get("recovery") {
        let envelope = serde_json::json!({"recovery":recovery});
        let r = device_recovery(&envelope)?;
        if !r["old_identity"].is_null() {
            return Err(rejected());
        }
        let expected = match r["phase"].as_str().unwrap_or("") {
            "completed" => "bound",
            "pending" => "pending",
            "draining" => "draining",
            "expired" => "expired",
            _ => "pairing",
        };
        if device["state"] != expected
            || expected == "bound" && device["identity"] != r["new_identity"]
        {
            return Err(rejected());
        }
        if expected == "pending" || expected == "draining" {
            if device["user_code"] != r["pairing"]["code"]
                || device["verification_url"] != r["pairing"]["verification_url"]
                || device["expires_at"] != r["pairing"]["expires_at"]
            {
                return Err(rejected());
            }
        }
        if let Some(url) = r["pairing"]["verification_url"].as_str() {
            let link = tauri::Url::parse(url).map_err(|_| rejected())?;
            let hive = tauri::Url::parse(device["hive"].as_str().ok_or_else(rejected)?)
                .map_err(|_| rejected())?;
            if link.origin() != hive.origin() {
                return Err(rejected());
            }
        }
    } else if device["state"] == "pairing" {
        return Err(rejected());
    }
    Ok(())
}
