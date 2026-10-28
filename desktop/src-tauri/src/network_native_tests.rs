use super::*;
use serde_json::{json, Value};
use std::{collections::VecDeque, sync::Mutex};

struct FakeBridge {
    snapshots: Mutex<VecDeque<BridgeReply>>,
    statuses: Mutex<VecDeque<BridgeReply>>,
    admission: Mutex<Option<BridgeReply>>,
    events: Mutex<Vec<String>>,
}
fn reply(result: Value) -> BridgeReply {
    BridgeReply {
        protocol: 1,
        id: "1".into(),
        instance: "a".repeat(32),
        result,
    }
}
fn operation(kind: &str, state: &str, revision: u64) -> Value {
    json!({"id":"c".repeat(48),"kind":kind,"platform":null,"state":state,"revision":revision,"error":null})
}
fn snapshot(kind: &str, state: &str, local: &str, revision: u64) -> BridgeReply {
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../desktopbridge/testdata/runtime-contract.json"
    ))
    .unwrap();
    let runtime = &mut value["snapshot"];
    runtime["local"] = json!(local);
    runtime["revision"] = json!(revision);
    runtime["operation"] = operation(kind, state, revision);
    if local == "stopped" && kind == "stop" {
        runtime["stop_receipt"] =
            json!({"workers_stopped":true,"intent_saved":true,"session_clean":true});
    }
    reply(json!({"runtime":runtime}))
}
fn status() -> BridgeReply {
    reply(
        json!({"network":{"effective_revision":0,"effective_proxy":"","paths":{"relay":"direct","official":"openai=direct;claude=direct","hive":"process_environment","official_login":"official_client"}}}),
    )
}
impl FakeBridge {
    fn new(snapshot: BridgeReply, admission: Value) -> Self {
        Self {
            snapshots: Mutex::new(VecDeque::from([snapshot])),
            statuses: Mutex::new(VecDeque::from([status()])),
            admission: Mutex::new(Some(reply(json!({"operation":admission})))),
            events: Mutex::new(vec![]),
        }
    }
    fn next(queue: &Mutex<VecDeque<BridgeReply>>) -> BridgeReply {
        let mut queue = queue.lock().unwrap();
        if queue.len() > 1 {
            queue.pop_front().unwrap()
        } else {
            queue.front().unwrap().clone()
        }
    }
}
impl NetworkBridge for FakeBridge {
    async fn snapshot(&self) -> Result<BridgeReply, BridgeError> {
        self.events.lock().unwrap().push("snapshot".into());
        Ok(Self::next(&self.snapshots))
    }
    async fn network_status(&self) -> Result<BridgeReply, BridgeError> {
        self.events.lock().unwrap().push("network_status".into());
        Ok(Self::next(&self.statuses))
    }
    async fn stop(
        &self,
        expected_revision: u64,
        reason: RuntimeStopReason,
    ) -> Result<BridgeReply, BridgeError> {
        self.events.lock().unwrap().push(format!(
            "stop:{expected_revision}:{}",
            serde_json::to_value(reason).unwrap().as_str().unwrap()
        ));
        Ok(self.admission.lock().unwrap().take().unwrap())
    }
    async fn configure(&self, _config: RuntimeNetworkConfig) -> Result<BridgeReply, BridgeError> {
        self.events.lock().unwrap().push("configure".into());
        Ok(reply(json!({"configured":true})))
    }
    async fn restore(&self) -> Result<BridgeReply, BridgeError> {
        self.events.lock().unwrap().push("restore".into());
        Ok(self.admission.lock().unwrap().take().unwrap())
    }
}

#[tokio::test]
async fn network_native_observation_binds_both_runtime_reads_and_network_revision() {
    let base = snapshot("stop", "succeeded", "stopped", 7);
    let bridge = FakeBridge::new(base.clone(), operation("stop", "pending", 6));
    let (observed, _) = observe_bridge(&bridge).await.unwrap();
    assert_eq!(observed.revision, 7);
    assert_eq!(
        *bridge.events.lock().unwrap(),
        ["snapshot", "network_status", "snapshot"]
    );
    for phase in ["instance", "runtime_revision", "network_revision"] {
        let bridge = FakeBridge::new(base.clone(), operation("stop", "pending", 6));
        match phase {
            "instance" => bridge.statuses.lock().unwrap()[0].instance = "b".repeat(32),
            "runtime_revision" => {
                let mut next = base.clone();
                next.result["runtime"]["revision"] = json!(8);
                bridge.snapshots.lock().unwrap().push_back(next);
            }
            _ => {
                bridge.statuses.lock().unwrap()[0].result["network"]["effective_revision"] =
                    json!(1)
            }
        }
        let error = observe_bridge(&bridge).await.unwrap_err();
        assert_eq!(error.code, "NETWORK_RUNTIME_UNCONFIRMED", "{phase}");
    }
}

#[tokio::test]
async fn network_native_stop_uses_fixed_reason_and_awaits_owned_operation_receipt() {
    let pending = snapshot("stop", "running", "stopping", 6);
    let complete = snapshot("stop", "succeeded", "stopped", 7);
    let bridge = FakeBridge::new(pending.clone(), operation("stop", "pending", 6));
    *bridge.snapshots.lock().unwrap() = VecDeque::from([pending.clone(), pending, complete]);
    let result = stop_bridge(&bridge, 5, Duration::from_secs(1))
        .await
        .unwrap();
    assert_eq!(result.local, "stopped");
    assert!(result.stop_receipt.unwrap().session_clean);
    let events = bridge.events.lock().unwrap();
    assert_eq!(events[0], "stop:5:network_change");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.starts_with("stop:"))
            .count(),
        1
    );
    assert!(!events
        .iter()
        .any(|event| event == "configure" || event == "restore"));
}

#[tokio::test]
async fn network_native_stop_rejects_wrong_operation_stale_revision_and_untrusted_receipts() {
    for phase in [
        "operation",
        "instance",
        "stale_revision",
        "failed",
        "workers",
        "intent",
        "session",
    ] {
        let mut value = snapshot("stop", "succeeded", "stopped", 7);
        match phase {
            "operation" => value.result["runtime"]["operation"]["id"] = json!("d".repeat(48)),
            "instance" => value.instance = "b".repeat(32),
            "stale_revision" => value.result["runtime"]["revision"] = json!(4),
            "failed" => value.result["runtime"]["operation"]["state"] = json!("failed"),
            "workers" => value.result["runtime"]["stop_receipt"]["workers_stopped"] = json!(false),
            "intent" => value.result["runtime"]["stop_receipt"]["intent_saved"] = json!(false),
            _ => value.result["runtime"]["stop_receipt"]["session_clean"] = json!(false),
        }
        let bridge = FakeBridge::new(value, operation("stop", "pending", 6));
        assert!(
            stop_bridge(&bridge, 5, Duration::from_millis(30))
                .await
                .is_err(),
            "accepted {phase}"
        );
    }
}

#[tokio::test]
async fn network_native_pending_operation_times_out_without_replaying_stop() {
    let bridge = FakeBridge::new(
        snapshot("stop", "running", "stopping", 6),
        operation("stop", "pending", 6),
    );
    let error = stop_bridge(&bridge, 5, Duration::from_millis(10))
        .await
        .unwrap_err();
    assert_eq!(error.code, "NETWORK_RUNTIME_TIMEOUT");
    assert!(error.message.contains("10"));
    assert_eq!(
        bridge
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event.starts_with("stop:"))
            .count(),
        1
    );
}

#[tokio::test]
async fn network_native_restore_uses_saved_intent_and_accepts_s1_stopped_success() {
    // S1 Restore returns a start operation and succeeds stopped for saved stop.
    let bridge = FakeBridge::new(
        snapshot("start", "succeeded", "stopped", 9),
        operation("start", "pending", 8),
    );
    let observed = restore_bridge(&bridge, Duration::from_secs(1))
        .await
        .unwrap();
    assert_eq!(observed.local, "stopped");
    assert_eq!(bridge.events.lock().unwrap()[0], "restore");
    assert!(bridge
        .events
        .lock()
        .unwrap()
        .iter()
        .all(|event| !event.starts_with("stop:") && event != "configure"));
}

#[tokio::test]
async fn network_native_operation_failure_keeps_safe_s1_evidence() {
    let mut value = snapshot("start", "failed", "failed", 9);
    value.result["runtime"]["operation"]["error"] = json!({"code":"recovery_rejected","check":"clean_session","platform":"unknown","message":"previous session was not clean","evidence":{"confirmed":"false"}});
    let bridge = FakeBridge::new(value, operation("start", "pending", 8));
    let error = restore_bridge(&bridge, Duration::from_secs(1))
        .await
        .unwrap_err();
    assert!(error.message.contains("previous session was not clean"));
    assert!(error.message.contains("clean_session"));
}

#[tokio::test]
async fn network_native_wait_tracks_runtime_and_operation_revisions_independently() {
    let mut pending = snapshot("start", "running", "starting", 9);
    pending.result["runtime"]["operation"]["revision"] = json!(8);
    let done = snapshot("start", "succeeded", "running", 10);
    let bridge = FakeBridge::new(pending.clone(), operation("start", "pending", 8));
    *bridge.snapshots.lock().unwrap() = VecDeque::from([
        pending.clone(),
        pending.clone(),
        pending.clone(),
        pending,
        done,
    ]);
    // Runtime connection facts may advance while the current operation remains
    // pending. Its own revision must not be compared to the prior snapshot's.
    let observed = restore_bridge(&bridge, Duration::from_secs(1))
        .await
        .unwrap();
    assert_eq!(observed.revision, 10);
}
