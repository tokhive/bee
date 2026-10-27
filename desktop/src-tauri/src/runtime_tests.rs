use super::*;
use crate::sidecar::{Bridge, BridgePhase};
use tokio::time::{timeout, Duration};

async fn ready(mode: &str) -> Bridge {
    let bridge = Bridge::start(crate::sidecar::tests::fixture(mode));
    timeout(Duration::from_secs(5), async {
        while bridge.status().state == BridgePhase::Starting {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(bridge.status().state, BridgePhase::Ready);
    bridge
}

#[tokio::test]
async fn exit_freezes_queued_actions_and_survives_cancelled_caller() {
    let bridge = ready("owned-exit-slow").await;
    let b = bridge.clone();
    let reading = tokio::spawn(async move { b.device_status().await });
    sleep(Duration::from_millis(30)).await;
    assert!(!reading.is_finished());
    let b = bridge.clone();
    let writing = tokio::spawn(async move {
        b.supply_set_paused(crate::protocol::SupplyPlatform::Openai, false)
            .await
    });
    sleep(Duration::from_millis(10)).await;
    let b = bridge.clone();
    let exiting = tokio::spawn(async move { b.prepare_owned_exit(OwnedExitReason::Update).await });
    while !bridge.0.frozen.load(Ordering::SeqCst) {
        tokio::task::yield_now().await;
    }
    exiting.abort();
    assert_eq!(
        writing.await.unwrap().unwrap_err().code,
        "OWNED_EXIT_PENDING"
    );
    reading.await.unwrap().unwrap();
    assert!(
        bridge
            .prepare_owned_exit(OwnedExitReason::AppExit)
            .await
            .unwrap()
            .child_reaped
    );
}

#[tokio::test]
async fn startup_restore_is_once_per_child_and_exit_failure_still_reaps() {
    let bridge = ready("owned-exit").await;
    bridge.restore_when_ready().await.unwrap();
    bridge.restore_when_ready().await.unwrap();
    bridge
        .prepare_owned_exit(OwnedExitReason::AppExit)
        .await
        .unwrap();
    let bridge = ready("owned-exit-save-failure").await;
    let released = std::cell::Cell::new(false);
    assert!(crate::lifecycle::shutdown_owned(&bridge, || {
        released.set(true);
        assert_ne!(bridge.status().state, BridgePhase::Ready);
    })
    .await
    .is_err());
    assert!(released.get());
}

#[tokio::test]
async fn owned_exit_requires_persisted_stop_and_reaps_before_receipt() {
    for mode in [
        "owned-exit",
        "owned-exit-save-failure",
        "owned-exit-wrong-operation",
    ] {
        let bridge = Bridge::start(crate::sidecar::tests::fixture(mode));
        timeout(Duration::from_secs(5), async {
            while bridge.status().state == BridgePhase::Starting {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let result = bridge.prepare_owned_exit(OwnedExitReason::Update).await;
        if mode == "owned-exit" {
            let receipt = result.unwrap();
            assert!(
                receipt.intent_saved
                    && receipt.session_clean
                    && receipt.child_reaped
                    && receipt.config_lock_released
            );
            assert!(bridge.ping().await.is_err());
            assert_eq!(
                bridge
                    .prepare_owned_exit(OwnedExitReason::AppExit)
                    .await
                    .unwrap(),
                receipt
            );
        } else {
            assert!(result.is_err(), "unproved receipt accepted: {mode}");
        }
        bridge.stop().await.unwrap();
        assert_ne!(bridge.status().state, BridgePhase::Ready);
    }
}
