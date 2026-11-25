//! A client for Bee's local control interface: HTTP/1.1 + JSON on a Unix
//! socket, with state changes pushed as server-sent events.

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{client::conn::http1, Method, Request};
use hyper_util::rt::TokioIo;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::net::UnixStream;

#[derive(Clone)]
pub struct Control {
    socket: PathBuf,
}

/// A failed control request: Bee unreachable, or an error Bee answered with.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ControlError {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for ControlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}: {}", self.status, self.code, self.message)
    }
}

fn unreachable(err: impl std::fmt::Display) -> ControlError {
    ControlError { status: 0, code: "unreachable".into(), message: err.to_string() }
}

impl Control {
    pub fn new(socket: PathBuf) -> Self {
        Self { socket }
    }

    pub fn socket(&self) -> &Path {
        &self.socket
    }

    async fn connect(&self) -> Result<http1::SendRequest<Full<Bytes>>, ControlError> {
        let stream = tokio::time::timeout(Duration::from_secs(2), UnixStream::connect(&self.socket))
            .await
            .map_err(unreachable)?
            .map_err(unreachable)?;
        let (sender, conn) = http1::handshake(TokioIo::new(stream)).await.map_err(unreachable)?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        Ok(sender)
    }

    /// Sends one request and decodes the JSON answer, or Bee's error.
    pub async fn request(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Value, ControlError> {
        let mut sender = self.connect().await?;
        let payload = body.map(|b| Bytes::from(b.to_string())).unwrap_or_default();
        let req = Request::builder()
            .method(method)
            .uri(path)
            .header("host", "bee")
            .header("content-type", "application/json")
            .body(Full::new(payload))
            .map_err(unreachable)?;
        let res = tokio::time::timeout(Duration::from_secs(150), sender.send_request(req))
            .await
            .map_err(unreachable)?
            .map_err(unreachable)?;
        let status = res.status().as_u16();
        let raw = res.into_body().collect().await.map_err(unreachable)?.to_bytes();
        let value: Value = serde_json::from_slice(&raw).unwrap_or(Value::Null);
        if (200..300).contains(&status) {
            return Ok(value);
        }
        Err(ControlError {
            status,
            code: value["error"]["code"].as_str().unwrap_or("error").to_string(),
            message: value["error"]["message"].as_str().unwrap_or_default().to_string(),
        })
    }

    pub async fn get(&self, path: &str) -> Result<Value, ControlError> {
        self.request(Method::GET, path, None).await
    }

    /// Follows the event stream, calling `on_event` with each event's name,
    /// until the stream ends or Bee cannot be reached.
    pub async fn follow_events(&self, mut on_event: impl FnMut(&str)) -> Result<(), ControlError> {
        let mut sender = self.connect().await?;
        let req = Request::builder()
            .uri("/v1/events")
            .header("host", "bee")
            .body(Full::new(Bytes::new()))
            .map_err(unreachable)?;
        let res = sender.send_request(req).await.map_err(unreachable)?;
        if !res.status().is_success() {
            return Err(ControlError { status: res.status().as_u16(), code: "events_unavailable".into(), message: String::new() });
        }
        let mut body = res.into_body();
        let mut pending = String::new();
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(unreachable)?;
            if let Some(data) = frame.data_ref() {
                pending.push_str(&String::from_utf8_lossy(data));
                while let Some(end) = pending.find('\n') {
                    let line: String = pending.drain(..=end).collect();
                    if let Some(name) = line.trim_end().strip_prefix("event: ") {
                        on_event(name);
                    }
                }
            }
        }
        Ok(())
    }
}
