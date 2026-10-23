use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_FRAME_BYTES: usize = 1 << 20;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BridgeError {
    pub code: String,
    pub message: String,
}

impl BridgeError {
    fn new(code: &str, message: String) -> Self {
        Self {
            code: code.into(),
            message,
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

fn invalid_json(stage: &str, error: serde_json::Error) -> BridgeError {
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
    if metadata.capabilities.len() != 2
        || !metadata.capabilities.iter().any(|c| c == "ping")
        || !metadata.capabilities.iter().any(|c| c == "shutdown")
    {
        return Err(BridgeError::new(
            "CAPABILITY_MISMATCH",
            format!(
                "hello capability set differs from P0; actual entries={}; required=ping,shutdown",
                metadata.capabilities.len()
            ),
        ));
    }
    Ok(metadata)
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
