use tokio::io::{AsyncRead, AsyncReadExt};

#[derive(Default)]
pub(crate) struct Diagnostics {
    pub bytes: u64,
    pub tail: Vec<u8>,
}

#[cfg(test)]
pub(crate) async fn drain<R: AsyncRead + Unpin>(input: &mut R) -> std::io::Result<Diagnostics> {
    drain_inner(input, None).await
}

pub(crate) async fn drain_with_events<R: AsyncRead + Unpin>(
    input: &mut R,
    events: tokio::sync::broadcast::Sender<serde_json::Value>,
) -> std::io::Result<Diagnostics> {
    drain_inner(input, Some(events)).await
}

// Serde's named fields reject duplicates before projection; the nested map
// needs the same check because a plain Value/BTreeMap silently keeps the last.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct HttpEvent {
    time: String,
    level: String,
    module: String,
    platform: Option<String>,
    code: String,
    #[serde(deserialize_with = "unique_evidence")]
    evidence: std::collections::BTreeMap<String, String>,
}
fn unique_evidence<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<std::collections::BTreeMap<String, String>, D::Error> {
    struct Unique;
    impl<'de> serde::de::Visitor<'de> for Unique {
        type Value = std::collections::BTreeMap<String, String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("unique safe evidence fields")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> Result<Self::Value, M::Error> {
            let mut result = std::collections::BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, String>()? {
                if result.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("duplicate diagnostic evidence"));
                }
            }
            Ok(result)
        }
    }
    d.deserialize_map(Unique)
}

fn http_event(line: &[u8]) -> Option<serde_json::Value> {
    let raw = line.strip_prefix(b"BEE_DESKTOP_EVENT ")?;
    let _: HttpEvent = serde_json::from_slice(raw).ok()?;
    let event: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let object = event.as_object()?;
    if object.len() != 6
        || !["time", "level", "module", "platform", "code", "evidence"]
            .iter()
            .all(|k| object.contains_key(*k))
    {
        return None;
    }
    if object.len() != 6
        || event["module"] != "bridge"
        || !crate::runtime_protocol::timestamp(event["time"].as_str()?)
    {
        return None;
    }
    if !event["platform"].is_null()
        && event["platform"] != "openai"
        && event["platform"] != "claude"
    {
        return None;
    }
    let (phase, level) = match event["code"].as_str()? {
        "request_http_started" => ("http_start", "info"),
        "request_http_finished" => ("http_end", "info"),
        "request_http_failed" => ("http_error", "warning"),
        _ => return None,
    };
    let evidence: std::collections::BTreeMap<String, String> =
        serde_json::from_value(event["evidence"].clone()).ok()?;
    if evidence.len() > 7
        || !["request_id", "method", "phase", "path", "elapsed_ms"]
            .iter()
            .all(|k| evidence.contains_key(*k))
        || evidence.keys().any(|k| {
            ![
                "request_id",
                "method",
                "phase",
                "path",
                "elapsed_ms",
                "http_status",
                "failure_kind",
            ]
            .contains(&k.as_str())
        })
        || (phase == "http_error") != evidence.contains_key("failure_kind")
        || evidence["phase"] != phase
        || event["level"] != level
        || !["GET", "POST", "PUT"].contains(&evidence["method"].as_str())
        || crate::diagnostic_log::sanitize_evidence(&evidence) != evidence
    {
        return None;
    }
    Some(event)
}

async fn drain_inner<R: AsyncRead + Unpin>(
    input: &mut R,
    events: Option<tokio::sync::broadcast::Sender<serde_json::Value>>,
) -> std::io::Result<Diagnostics> {
    let mut diagnostics = Diagnostics::default();
    let mut buffer = [0u8; 2048];
    let mut line = Vec::new();
    let mut oversized = false;
    loop {
        let count = input.read(&mut buffer).await.map_err(|cause| {
            std::io::Error::new(
                cause.kind(),
                format!(
                    "read management stderr after bytes={}: {cause}",
                    diagnostics.bytes
                ),
            )
        })?;
        if count == 0 {
            return Ok(diagnostics);
        }
        diagnostics.bytes = diagnostics.bytes.saturating_add(count as u64);
        if let Some(events) = &events {
            for &byte in &buffer[..count] {
                if byte == b'\n' {
                    if !oversized {
                        if let Some(event) = http_event(&line) {
                            let _ = events.send(event);
                        }
                    }
                    line.clear();
                    oversized = false;
                } else if !oversized {
                    if line.len() == 8192 {
                        line.clear();
                        oversized = true;
                    } else {
                        line.push(byte);
                    }
                }
            }
        }
        diagnostics.tail.extend_from_slice(&buffer[..count]);
        if diagnostics.tail.len() > 4096 {
            diagnostics.tail.drain(..diagnostics.tail.len() - 4096);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn large_stderr_is_fully_drained_with_only_a_bounded_tail_retained() {
        let mut bytes = vec![b'x'; 1 << 20];
        bytes.extend_from_slice(b"management initialization failed: E42\n");
        let expected = bytes.len() as u64;
        let result = drain(&mut bytes.as_slice()).await.unwrap();
        assert_eq!(result.bytes, expected);
        assert_eq!(result.tail.len(), 4096);
        assert!(result.tail.ends_with(b"E42\n"));
    }
    #[tokio::test]
    async fn only_bounded_structured_http_events_leave_stderr() {
        let (tx, mut rx) = tokio::sync::broadcast::channel(8);
        let event = serde_json::json!({"time":"2026-11-03T07:00:00Z","level":"info","module":"bridge","platform":null,"code":"request_http_started","evidence":{"request_id":"shell-7","method":"GET","phase":"http_start","path":"/api/bee/identity","elapsed_ms":"0"}});
        let mut bytes = b"arbitrary token=SECRET\n".to_vec();
        bytes.extend_from_slice(format!("BEE_DESKTOP_EVENT {}\n", event).as_bytes());
        let mut unsafe_event = event.clone();
        unsafe_event["evidence"]["token"] = "SECRET".into();
        bytes.extend_from_slice(format!("BEE_DESKTOP_EVENT {}\n", unsafe_event).as_bytes());
        bytes.extend_from_slice(&vec![b'x'; 10000]);
        bytes.extend_from_slice(format!("BEE_DESKTOP_EVENT {}\n", event).as_bytes());
        let total = bytes.len();
        let result = drain_with_events(&mut bytes.as_slice(), tx).await.unwrap();
        assert_eq!(result.bytes, total as u64);
        assert_eq!(result.tail.len(), 4096);
        assert_eq!(rx.try_recv().unwrap(), event);
        assert!(rx.try_recv().is_err());
    }
    #[test]
    fn duplicate_http_event_fields_are_rejected_before_projection() {
        let raw = r#"BEE_DESKTOP_EVENT {"time":"2026-11-03T07:00:00Z","level":"info","module":"bridge","platform":null,"code":"request_http_started","evidence":{"request_id":"shell-7","method":"GET","phase":"http_start","path":"/api/bee/identity","elapsed_ms":"0"}}"#;
        assert!(http_event(raw.as_bytes()).is_some());
        for duplicate in [
            raw.replace(
                r#""module":"bridge""#,
                r#""module":"device","module":"bridge""#,
            ),
            raw.replace(
                r#""elapsed_ms":"0""#,
                r#""elapsed_ms":"1","elapsed_ms":"0""#,
            ),
        ] {
            assert!(http_event(duplicate.as_bytes()).is_none());
        }
    }
}
