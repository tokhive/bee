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
async fn owned_exit_rejects_late_startup_restore_before_request_admission() {
    let bridge = ready("owned-exit-slow").await;
    let b = bridge.clone();
    let reading = tokio::spawn(async move { b.device_status().await });
    sleep(Duration::from_millis(30)).await;
    let b = bridge.clone();
    let exiting = tokio::spawn(async move { b.prepare_owned_exit(OwnedExitReason::AppExit).await });
    while !bridge.0.frozen.load(Ordering::SeqCst) {
        tokio::task::yield_now().await;
    }
    let result = bridge.restore_when_ready().await;
    reading.await.unwrap().unwrap();
    let _ = exiting.await.unwrap();
    assert_eq!(result.unwrap_err().code, "OWNED_EXIT_PENDING");
}

#[tokio::test]
async fn owned_exit_rejects_queued_startup_restore_before_first_byte() {
    let bridge = ready("owned-exit-slow").await;
    let b = bridge.clone();
    let reading = tokio::spawn(async move { b.device_status().await });
    sleep(Duration::from_millis(30)).await;
    let b = bridge.clone();
    let restoring = tokio::spawn(async move { b.restore_when_ready().await });
    sleep(Duration::from_millis(30)).await;
    assert!(!restoring.is_finished());
    let b = bridge.clone();
    let exiting = tokio::spawn(async move { b.prepare_owned_exit(OwnedExitReason::AppExit).await });
    while !bridge.0.frozen.load(Ordering::SeqCst) {
        tokio::task::yield_now().await;
    }
    let result = restoring.await.unwrap();
    reading.await.unwrap().unwrap();
    let _ = exiting.await.unwrap();
    assert_eq!(result.unwrap_err().code, "OWNED_EXIT_PENDING");
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
    assert!(crate::lifecycle::shutdown_owned(&bridge, None, || {
        released.set(true);
        assert_ne!(bridge.status().state, BridgePhase::Ready);
    })
    .await
    .is_err());
    assert!(released.get());
}

#[tokio::test]
async fn owned_exit_failure_is_available_in_diagnostics_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let logs = crate::diagnostic_log::DiagnosticLogStore::new(dir.path().into());
    let bridge = ready("owned-exit-save-failure").await;
    let released = std::cell::Cell::new(false);
    let result =
        crate::lifecycle::shutdown_owned(&bridge, Some(&logs), || released.set(true)).await;
    assert!(result.is_err());
    assert!(released.get());
    drop(logs);
    let reopened = crate::diagnostic_log::DiagnosticLogStore::new(dir.path().into());
    let page = reopened
        .page(crate::diagnostic_log::LogQuery {
            cursor: None,
            limit: 20,
            module: Some("lifecycle".into()),
            platform: None,
            level: None,
        })
        .unwrap();
    let event = page
        .entries
        .iter()
        .find(|event| event.code == "owned_exit_unconfirmed")
        .expect("exit failure must survive the App and management child");
    assert_eq!(
        event.evidence.get("exit_stage").map(String::as_str),
        Some("stop_receipt")
    );
    assert_eq!(
        event.evidence.get("stop_confirmed").map(String::as_str),
        Some("false")
    );
    assert_eq!(
        event.evidence.get("child_reaped").map(String::as_str),
        Some("true")
    );
}

#[tokio::test]
async fn owned_exit_success_persists_confirmed_receipt_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let logs = crate::diagnostic_log::DiagnosticLogStore::new(dir.path().into());
    let bridge = ready("owned-exit").await;
    let released = std::cell::Cell::new(false);
    crate::lifecycle::shutdown_owned(&bridge, Some(&logs), || {
        let next_instance = crate::diagnostic_log::DiagnosticLogStore::new(dir.path().into());
        let page = next_instance
            .page(crate::diagnostic_log::LogQuery {
                cursor: None,
                limit: 20,
                module: Some("lifecycle".into()),
                platform: None,
                level: None,
            })
            .unwrap();
        assert!(
            page.entries.iter().any(|event| event.code == "owned_exit_completed"),
            "singleton release preceded durable exit result; a new App could race the log writer"
        );
        released.set(true);
    })
        .await
        .unwrap();
    assert!(released.get());
    drop(logs);
    let reopened = crate::diagnostic_log::DiagnosticLogStore::new(dir.path().into());
    let page = reopened
        .page(crate::diagnostic_log::LogQuery {
            cursor: None,
            limit: 20,
            module: Some("lifecycle".into()),
            platform: None,
            level: None,
        })
        .unwrap();
    assert_eq!(page.entries.len(), 2);
    let event = page
        .entries
        .iter()
        .find(|event| event.code == "owned_exit_completed")
        .expect("a successful exit must preserve its confirmed receipt");
    assert_eq!(
        event.evidence.get("exit_stage").map(String::as_str),
        Some("completed")
    );
    assert_eq!(
        event.evidence.get("stop_confirmed").map(String::as_str),
        Some("true")
    );
    assert_eq!(
        event.evidence.get("child_reaped").map(String::as_str),
        Some("true")
    );
    assert!(!event.evidence.contains_key("exit_error_code"));
}

#[tokio::test]
async fn owned_exit_log_failure_still_reaps_and_reports_both_log_stages() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("blocked-log-root");
    std::fs::write(&root, b"not a directory").unwrap();
    let logs = crate::diagnostic_log::DiagnosticLogStore::new(root);
    let bridge = ready("owned-exit").await;
    let released = std::cell::Cell::new(false);
    let error = crate::lifecycle::shutdown_owned(&bridge, Some(&logs), || released.set(true))
        .await
        .unwrap_err();
    assert_eq!(error.code, "OWNED_EXIT_UNCONFIRMED");
    assert!(
        error
            .message
            .contains("diagnostic_start: DIAGNOSTIC_LOG_IO"),
        "{}",
        error.message
    );
    assert!(
        error
            .message
            .contains("diagnostic_result: DIAGNOSTIC_LOG_IO"),
        "{}",
        error.message
    );
    assert!(released.get());
    assert_ne!(bridge.status().state, BridgePhase::Ready);
    assert!(bridge.ping().await.is_err());
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
