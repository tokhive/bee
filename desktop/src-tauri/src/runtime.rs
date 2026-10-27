#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
use crate::{
    protocol::BridgeError,
    runtime_protocol::{validate_runtime_reply, RuntimeReplyKind},
    sidecar::{Bridge, BridgePhase, BridgeReply},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tokio::time::{sleep, timeout, Duration};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnedExitReason {
    AppExit,
    Update,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct OwnedExitReceipt {
    pub intent_saved: bool,
    pub session_clean: bool,
    pub child_reaped: bool,
    pub config_lock_released: bool,
}

type ExitResult = Result<OwnedExitReceipt, BridgeError>;
#[derive(Default)]
pub(crate) struct OwnedExitTask {
    handle: Option<tokio::task::JoinHandle<ExitResult>>,
    result: Option<ExitResult>,
}
fn failure(message: impl Into<String>) -> BridgeError {
    BridgeError {
        code: "OWNED_EXIT_UNCONFIRMED".into(),
        message: message.into(),
    }
}
fn checked(reply: BridgeReply, kind: RuntimeReplyKind) -> Result<BridgeReply, BridgeError> {
    validate_runtime_reply(&reply.result, kind)?;
    if let Some(error) = reply.result.get("error") {
        return Err(serde_json::from_value(error.clone())
            .map_err(|_| failure("runtime error decoding failed after validation"))?);
    }
    Ok(reply)
}

impl Bridge {
    // Called once at App startup, after handshake. A failed child is never restarted.
    pub(crate) async fn restore_when_ready(&self) -> Result<(), BridgeError> {
        if self.0.restored.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let mut statuses = self.subscribe();
        loop {
            let state = statuses.borrow_and_update().state.clone();
            match state {
                BridgePhase::Ready => break,
                BridgePhase::Starting => {
                    statuses
                        .changed()
                        .await
                        .map_err(|_| failure("startup bridge status channel closed"))?;
                }
                _ => {
                    return Err(failure(format!(
                        "automatic restore skipped: bridge={state:?}"
                    )))
                }
            }
        }
        checked(
            self.request("runtime_restore", json!({}), Duration::from_secs(15))
                .await?,
            RuntimeReplyKind::Operation,
        )?;
        Ok(())
    }

    pub async fn prepare_owned_exit(&self, reason: OwnedExitReason) -> ExitResult {
        self.0.frozen.store(true, Ordering::SeqCst);
        let mut exit = self.0.exit.lock().await;
        if let Some(result) = &exit.result {
            return result.clone();
        }
        if exit.handle.is_none() {
            let bridge = self.clone();
            // Dropping the caller never abandons persistence or child cleanup.
            exit.handle = Some(tokio::spawn(async move {
                let graceful = timeout(Duration::from_secs(12), bridge.persist_owned_exit(reason)).await
                    .unwrap_or_else(|_| Err(failure("runtime stop receipt deadline elapsed: limit=12000ms; child cleanup still required")));
                let cleanup = bridge.stop().await;
                match (graceful, cleanup) {
                    (Ok(()), Ok(())) => Ok(OwnedExitReceipt {
                        intent_saved: true,
                        session_clean: true,
                        child_reaped: true,
                        config_lock_released: true,
                    }),
                    (Err(error), Ok(())) => Err(error),
                    (saved, Err(error)) => Err(failure(format!(
                        "owned child cleanup failed: {}; stop persistence confirmed={}",
                        error.message,
                        saved.is_ok()
                    ))),
                }
            }));
        }
        let result = exit
            .handle
            .as_mut()
            .unwrap()
            .await
            .map_err(|error| failure(format!("owned exit task join failed: {error}")))
            .and_then(|result| result);
        exit.handle.take();
        exit.result = Some(result.clone());
        result
    }

    async fn exit_snapshot(&self) -> Result<BridgeReply, BridgeError> {
        checked(
            self.exit_request("runtime_snapshot", json!({})).await?,
            RuntimeReplyKind::Snapshot,
        )
    }

    async fn persist_owned_exit(&self, reason: OwnedExitReason) -> Result<(), BridgeError> {
        let mut initial = self.exit_snapshot().await?;
        let mut admitted = None;
        for _ in 0..4 {
            let snapshot = &initial.result["runtime"];
            if snapshot["local"] == "stopping" {
                admitted = Some(snapshot["operation"].clone());
                break;
            }
            let result = checked(
                self.exit_request(
                    "runtime_stop",
                    json!({"expected_revision":snapshot["revision"],"reason":reason}),
                )
                .await?,
                RuntimeReplyKind::Operation,
            );
            match result {
                Ok(reply) => {
                    if reply.instance != initial.instance {
                        return Err(failure("runtime stop instance differs from snapshot"));
                    }
                    admitted = Some(reply.result["operation"].clone());
                    break;
                }
                // Only a definite rejection permits a new admission; never replay an unknown write.
                Err(error)
                    if error.code == "RUNTIME_OPERATION_FAILED"
                        && error.message.starts_with("runtime revision changed:") =>
                {
                    initial = self.exit_snapshot().await?;
                }
                Err(error) => return Err(error),
            }
        }
        let operation = admitted.ok_or_else(|| {
            failure("runtime stop admission revision changed on four consecutive attempts")
        })?;
        if operation["kind"] != "stop" || !operation["id"].is_string() {
            return Err(failure(
                "runtime stop admission has no bound stop operation",
            ));
        }
        let mut revision = operation["revision"]
            .as_u64()
            .ok_or_else(|| failure("runtime stop revision missing"))?;
        loop {
            let reply = self.exit_snapshot().await?;
            let snapshot = &reply.result["runtime"];
            let current = &snapshot["operation"];
            let observed = snapshot["revision"].as_u64().unwrap();
            if reply.instance != initial.instance
                || snapshot["run_id"] != initial.result["runtime"]["run_id"]
                || current["id"] != operation["id"]
                || current["kind"] != "stop"
                || observed < revision
            {
                return Err(failure("runtime stop receipt binding failed: instance, run, operation or revision changed"));
            }
            revision = observed;
            match current["state"].as_str() {
                Some("succeeded") => {
                    let receipt = &snapshot["stop_receipt"];
                    if snapshot["local"] != "stopped"
                        || snapshot["connection"] != "disconnected"
                        || ["workers_stopped", "intent_saved", "session_clean"]
                            .iter()
                            .any(|key| receipt[*key] != Value::Bool(true))
                    {
                        return Err(failure("runtime stop did not prove stopped workers, saved intent and clean session"));
                    }
                    return Ok(());
                }
                Some("failed" | "cancelled") => {
                    return Err(failure(format!(
                        "runtime stop failed: {}",
                        current["error"]
                    )))
                }
                _ => sleep(Duration::from_millis(25)).await,
            }
        }
    }
}
