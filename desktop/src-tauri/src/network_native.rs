use crate::{
    network::{decode_network_status, NetworkRuntime, RuntimeObservation},
    protocol::BridgeError,
    runtime_protocol::{
        validate_runtime_reply, RuntimeNetworkConfig, RuntimeReplyKind, RuntimeStopReason,
        StopReceipt,
    },
    sidecar::{Bridge, BridgeReply},
};
use serde::Deserialize;
use serde_json::Value;
use std::future::Future;
use tokio::time::{sleep, timeout, Duration};

const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) struct BridgeNetworkRuntime<'a>(pub &'a Bridge);

// This seam substitutes transport replies in tests. The production implementation
// exposes only S1's fixed lifecycle methods, with no Start or resume list.
trait NetworkBridge: Send + Sync {
    fn snapshot(&self) -> impl Future<Output = Result<BridgeReply, BridgeError>> + Send;
    fn network_status(&self) -> impl Future<Output = Result<BridgeReply, BridgeError>> + Send;
    fn stop(
        &self,
        expected_revision: u64,
        reason: RuntimeStopReason,
    ) -> impl Future<Output = Result<BridgeReply, BridgeError>> + Send;
    fn configure(
        &self,
        config: RuntimeNetworkConfig,
    ) -> impl Future<Output = Result<BridgeReply, BridgeError>> + Send;
    fn restore(&self) -> impl Future<Output = Result<BridgeReply, BridgeError>> + Send;
}
impl NetworkBridge for Bridge {
    async fn snapshot(&self) -> Result<BridgeReply, BridgeError> {
        self.runtime_snapshot().await
    }
    async fn network_status(&self) -> Result<BridgeReply, BridgeError> {
        Bridge::network_status(self).await
    }
    async fn stop(
        &self,
        revision: u64,
        reason: RuntimeStopReason,
    ) -> Result<BridgeReply, BridgeError> {
        self.runtime_stop(revision, reason).await
    }
    async fn configure(&self, config: RuntimeNetworkConfig) -> Result<BridgeReply, BridgeError> {
        self.runtime_configure_network(config).await
    }
    async fn restore(&self) -> Result<BridgeReply, BridgeError> {
        self.runtime_restore().await
    }
}
impl NetworkRuntime for BridgeNetworkRuntime<'_> {
    async fn observe(&self) -> Result<RuntimeObservation, BridgeError> {
        Ok(observe_bridge(self.0).await?.0)
    }
    async fn stop_for_network(&self, revision: u64) -> Result<RuntimeObservation, BridgeError> {
        stop_bridge(self.0, revision, OPERATION_TIMEOUT).await
    }
    async fn configure_network(&self, config: RuntimeNetworkConfig) -> Result<(), BridgeError> {
        checked(
            self.0.configure(config).await?,
            RuntimeReplyKind::Configured,
        )?;
        Ok(())
    }
    async fn restore(&self) -> Result<RuntimeObservation, BridgeError> {
        restore_bridge(self.0, OPERATION_TIMEOUT).await
    }
}

fn failure(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError { details: None,
        code: code.into(),
        message: message.into(),
    }
}
fn checked(reply: BridgeReply, kind: RuntimeReplyKind) -> Result<BridgeReply, BridgeError> {
    validate_runtime_reply(&reply.result, kind)?;
    if let Some(error) = reply.result.get("error") {
        return Err(serde_json::from_value(error.clone())
            .map_err(|error| crate::protocol::invalid_json("network runtime error", error))?);
    }
    Ok(reply)
}

#[derive(Debug, Deserialize)]
struct NativeSnapshot {
    revision: u64,
    network_revision: u64,
    local: String,
    connection: String,
    operation: Option<Value>,
    stop_receipt: Option<StopReceipt>,
}
fn decode_snapshot(reply: BridgeReply) -> Result<(String, NativeSnapshot), BridgeError> {
    let reply = checked(reply, RuntimeReplyKind::Snapshot)?;
    let value = reply.result.get("runtime").ok_or_else(|| {
        failure(
            "NETWORK_RUNTIME_UNCONFIRMED",
            "validated runtime reply had no snapshot; required=runtime object",
        )
    })?;
    let snapshot = serde_json::from_value(value.clone())
        .map_err(|error| crate::protocol::invalid_json("network runtime snapshot", error))?;
    Ok((reply.instance, snapshot))
}

async fn observe_bridge(
    bridge: &impl NetworkBridge,
) -> Result<(RuntimeObservation, NativeSnapshot), BridgeError> {
    let (before_instance, before) = decode_snapshot(bridge.snapshot().await?)?;
    let status = bridge.network_status().await?;
    let network = decode_network_status(&status.result)?;
    let (instance, after) = decode_snapshot(bridge.snapshot().await?)?;
    if instance != before_instance
        || instance != status.instance
        || before.revision != after.revision
        || before.network_revision != after.network_revision
        || after.network_revision != network.effective_revision
    {
        return Err(failure("NETWORK_RUNTIME_UNCONFIRMED",format!("network observation binding failed: runtime_instance_match={} status_instance_match={} initial_runtime_revision={} final_runtime_revision={} initial_network_revision={} final_network_revision={} official_network_revision={}; required=same owned instance and unchanged revisions",instance==before_instance,instance==status.instance,before.revision,after.revision,before.network_revision,after.network_revision,network.effective_revision)));
    }
    let observation = RuntimeObservation {
        instance,
        revision: after.revision,
        network_revision: after.network_revision,
        local: after.local.clone(),
        stop_receipt: after.stop_receipt.clone(),
        network,
    };
    observation.validate()?;
    Ok((observation, after))
}

#[derive(Debug, Deserialize)]
struct NativeOperation {
    id: String,
    kind: String,
    state: String,
    revision: u64,
    error: Option<Value>,
}
fn decode_operation(raw: &Value) -> Result<NativeOperation, BridgeError> {
    crate::protocol::validate_operation(raw, None, &["start", "stop"])?;
    serde_json::from_value(raw.clone())
        .map_err(|error| crate::protocol::invalid_json("network runtime operation", error))
}
fn operation_failed(operation: &NativeOperation) -> BridgeError {
    failure(
        "NETWORK_RUNTIME_OPERATION_FAILED",
        format!(
            "owned runtime operation failed: kind={} state={} revision={} evidence={}",
            operation.kind,
            operation.state,
            operation.revision,
            operation
                .error
                .as_ref()
                .map(Value::to_string)
                .unwrap_or_else(|| "null".into())
        ),
    )
}
async fn wait_operation(
    bridge: &impl NetworkBridge,
    admission: BridgeReply,
    expected_kind: &str,
    minimum_revision: u64,
) -> Result<RuntimeObservation, BridgeError> {
    let admission = checked(admission, RuntimeReplyKind::Operation)?;
    let operation = decode_operation(&admission.result["operation"])?;
    if operation.kind != expected_kind || operation.revision < minimum_revision {
        return Err(failure("NETWORK_RUNTIME_UNCONFIRMED",format!("runtime admission binding failed: actual_kind={} required_kind={expected_kind} actual_revision={} minimum_revision={minimum_revision}",operation.kind,operation.revision)));
    }
    if ["failed", "cancelled"].contains(&operation.state.as_str()) {
        return Err(operation_failed(&operation));
    }
    let mut snapshot_revision = operation.revision;
    let mut operation_revision = operation.revision;
    loop {
        let (observed, snapshot) = observe_bridge(bridge).await?;
        let current=decode_operation(snapshot.operation.as_ref().ok_or_else(||failure("NETWORK_RUNTIME_UNCONFIRMED","runtime operation disappeared while awaiting completion; required=admitted operation"))?)?;
        if observed.instance != admission.instance
            || current.id != operation.id
            || current.kind != operation.kind
            || observed.revision < snapshot_revision
            || current.revision < operation_revision
            || current.revision > observed.revision
        {
            return Err(failure("NETWORK_RUNTIME_UNCONFIRMED",format!("runtime operation readback binding failed: instance_match={} operation_match={} kind_match={} snapshot_revision={} minimum_snapshot_revision={snapshot_revision} operation_revision={} minimum_operation_revision={operation_revision}; required=owned admitted operation with monotonic revisions",observed.instance==admission.instance,current.id==operation.id,current.kind==operation.kind,observed.revision,current.revision)));
        }
        snapshot_revision = observed.revision;
        operation_revision = current.revision;
        match current.state.as_str() {
            "succeeded" => {
                if expected_kind == "stop" {
                    let receipt = observed.stop_receipt.as_ref();
                    if observed.local != "stopped"
                        || snapshot.connection != "disconnected"
                        || receipt.is_none_or(|receipt| {
                            !receipt.workers_stopped
                                || !receipt.intent_saved
                                || !receipt.session_clean
                        })
                    {
                        return Err(failure("NETWORK_STOP_UNCONFIRMED",format!("successful stop operation lacks required receipt: local_stopped={} disconnected={} receipt_present={} workers_stopped={} intent_saved={} session_clean={}; required=all proofs true",observed.local=="stopped",snapshot.connection=="disconnected",receipt.is_some(),receipt.is_some_and(|r|r.workers_stopped),receipt.is_some_and(|r|r.intent_saved),receipt.is_some_and(|r|r.session_clean))));
                    }
                }
                return Ok(observed);
            }
            "failed" | "cancelled" => return Err(operation_failed(&current)),
            _ => sleep(Duration::from_millis(25)).await,
        }
    }
}
async fn stop_bridge(
    bridge: &impl NetworkBridge,
    expected_revision: u64,
    budget: Duration,
) -> Result<RuntimeObservation, BridgeError> {
    let minimum = expected_revision.checked_add(1).ok_or_else(|| {
        failure(
            "NETWORK_RUNTIME_UNCONFIRMED",
            format!("stop expected revision cannot advance: actual={expected_revision}"),
        )
    })?;
    timeout(budget,async {
        let admission=bridge.stop(expected_revision,RuntimeStopReason::NetworkChange).await?;
        wait_operation(bridge,admission,"stop",minimum).await
    }).await.map_err(|_|failure("NETWORK_RUNTIME_TIMEOUT",format!("network stop operation deadline elapsed: limit_ms={}; stop outcome remains unconfirmed and configuration was not dispatched",budget.as_millis())))?
}
async fn restore_bridge(
    bridge: &impl NetworkBridge,
    budget: Duration,
) -> Result<RuntimeObservation, BridgeError> {
    timeout(budget,async {
        let admission=bridge.restore().await?;
        // S1 Restore owns saved intent and returns a start operation, including
        // successful stopped completion when the saved intent is stopped.
        wait_operation(bridge,admission,"start",0).await
    }).await.map_err(|_|failure("NETWORK_RUNTIME_TIMEOUT",format!("saved-intent restore deadline elapsed: limit_ms={}; runtime outcome remains unconfirmed",budget.as_millis())))?
}

#[cfg(test)]
#[path = "network_native_tests.rs"]
mod tests;
