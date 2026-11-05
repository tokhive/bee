use super::*;
use crate::sidecar::{Bridge, BridgePhase};
use tokio::time::{sleep, timeout, Duration};

async fn ready(mode: &str) -> Bridge {
    let bridge = Bridge::start(crate::sidecar::tests::fixture(mode));
    timeout(Duration::from_secs(30), async {
        while bridge.status().state == BridgePhase::Starting {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!("owned-exit fixture stayed in Starting for 30s: mode={mode}")
    });
    assert_eq!(
        bridge.status().state,
        BridgePhase::Ready,
        "owned-exit fixture left Starting without becoming Ready: mode={mode} error={:?}",
        bridge.status().error
    );
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
async fn startup_restore_requires_bound_terminal_success_not_operation_admission() {
    for mode in [
        "owned-exit-restore-failure",
        "owned-exit-restore-wrong-operation",
    ] {
        let bridge = ready(mode).await;
        let result = bridge.restore_when_ready().await;
        assert!(
            result.is_err(),
            "accepted unproven restore completion: {mode}"
        );
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn startup_restore_allows_s1_saved_user_stop_to_complete_with_no_run() {
    let bridge = ready("owned-exit-restore-idle").await;
    bridge.restore_when_ready().await.unwrap();
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn startup_restore_accepts_confirmed_zero_account_waiting_without_a_run() {
    let bridge = ready("owned-exit-restore-waiting").await;
    let result = bridge.restore_when_ready().await;
    bridge.stop().await.unwrap();
    result.unwrap();
}

#[tokio::test]
async fn owned_exit_requires_persisted_stop_and_reaps_before_receipt() {
    for mode in [
        "owned-exit",
        "owned-exit-save-failure",
        "owned-exit-wrong-operation",
    ] {
        let bridge = Bridge::start(crate::sidecar::tests::fixture(mode));
        timeout(Duration::from_secs(30), async {
            while bridge.status().state == BridgePhase::Starting {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!("owned-exit fixture stayed in Starting for 30s: mode={mode}")
        });
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
