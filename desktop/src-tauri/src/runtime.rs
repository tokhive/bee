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
        let admitted = checked(
            self.exit_request("runtime_restore", json!({})).await?,
            RuntimeReplyKind::Operation,
        )?;
        let operation = &admitted.result["operation"];
        if operation["kind"] != "start" {
            return Err(failure(format!(
                "startup restore admission kind={}; required=start",
                operation["kind"]
            )));
        }
        timeout(Duration::from_secs(90), async {
            let mut revision=operation["revision"].as_u64().unwrap();
            let mut run_id=None;
            loop {
                let reply=self.exit_snapshot().await?;
                let snapshot=&reply.result["runtime"];
                let current=&snapshot["operation"];
                let observed=snapshot["revision"].as_u64().unwrap();
                let idle=current["state"] == "succeeded" && snapshot["local"] == "stopped" && snapshot["run_id"].is_null() && snapshot["connection"] == "disconnected";
                if reply.instance != admitted.instance || current["id"] != operation["id"] || current["kind"] != "start" || observed < revision || !idle && run_id.as_ref().is_some_and(|run|run != &snapshot["run_id"]) {
                    return Err(failure(format!("startup restore receipt binding failed: instance_matches={} operation_matches={} kind={} revision={observed} previous={revision}; required=same instance/run/start operation and monotonic revision",reply.instance == admitted.instance,current["id"] == operation["id"],current["kind"])));
                }
                revision=observed;
                // An idle saved intent can complete by clearing run_id; only bind a
                // concrete run while pending, then verify its successful terminal state.
                match current["state"].as_str() {
                    Some("succeeded") => {
                        if !(snapshot["local"] == "running" && snapshot["connection"] == "connected" && snapshot["run_id"].is_string() || idle) {
                            return Err(failure(format!("startup restore succeeded with local={} connection={} run_present={}; required=connected running or idle stopped",snapshot["local"],snapshot["connection"],!snapshot["run_id"].is_null())));
                        }
                        return Ok(());
                    }
                    Some("failed"|"cancelled") => return Err(failure(format!("startup restore terminal state={}; error={}; saved intent not proven restored",current["state"],current["error"]))),
                    _ => {
                        if !snapshot["run_id"].is_null(){run_id=Some(snapshot["run_id"].clone());}
                        sleep(Duration::from_millis(25)).await;
                    }
                }
            }
        }).await.map_err(|_|failure("startup restore completion deadline elapsed: limit=90000ms; update recovery remains unconfirmed"))??;
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

    /// A failed startup recovery must stop contribution, while keeping the
    /// management process available for pending-account readback when proven safe.
    pub(crate) async fn stop_failed_restore(&self) -> Result<(), BridgeError> {
        let stopped = timeout(
            Duration::from_secs(12),
            self.persist_owned_exit(OwnedExitReason::AppExit),
        )
        .await
        .unwrap_or_else(|_| {
            Err(failure(
                "failed restore stop deadline elapsed: limit=12000ms",
            ))
        });
        match stopped {
            Ok(()) => Ok(()),
            Err(cause) => {
                // Cancelling restore polling does not cancel the Go worker. If its
                // stop receipt cannot be proven, reap our child to prevent late work.
                let cleanup = self.stop().await;
                Err(failure(format!(
                    "failed restore stop unproven: {}: {}; owned child cleanup={}",
                    cause.code,
                    cause.message,
                    match cleanup {
                        Ok(()) => "reaped; management unavailable until restart".into(),
                        Err(error) => format!("{}: {}", error.code, error.message),
                    }
                )))
            }
        }
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
