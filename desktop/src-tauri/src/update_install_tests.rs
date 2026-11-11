use crate::{update_install::*, updater::*};
use std::sync::{Arc, Mutex};

fn ready() -> (tempfile::TempDir, UpdateManager, UpdateInstallRequest) {
    let dir = tempfile::tempdir().unwrap();
    let manager = UpdateManager::new(
        "0.1.0",
        UpdateStore::new(dir.path().join("desktop-update-state.json")),
    )
    .unwrap();
    let mut inner = manager.lock().unwrap();
    inner.snapshot.state = UpdateState::Verified;
    inner.snapshot.operation_id = Some("signed-operation".into());
    inner.snapshot.target_version = Some("0.2.0".into());
    inner.snapshot.revision = 42;
    inner.asset = Some(AssetIdentity {
        channel: "stable".into(),
        target: "aarch64-apple-darwin".into(),
        version: "0.2.0".into(),
        sha256: "a".repeat(64),
        size: 3,
    });
    inner.bytes = Some(Arc::new(b"abc".to_vec()));
    drop(inner);
    (
        dir,
        manager,
        UpdateInstallRequest {
            operation_id: "signed-operation".into(),
            expected_revision: 42,
            confirmed: true,
        },
    )
}
fn recovery() -> RecoveryEvidence {
    RecoveryEvidence {
        package_source_verified: true,
        protocol_verified: true,
        account_state_verified: true,
        preferences_verified: true,
        pending_actions_verified: true,
        runtime_intent_restored: true,
    }
}
fn receipt() -> UpdateExitReceipt {
    UpdateExitReceipt {
        intent_saved: true,
        session_clean: true,
        child_reaped: true,
        config_lock_released: true,
    }
}

#[test]
fn update_install_requires_confirmation_exact_revision_and_operation_before_any_write() {
    for bad in [
        UpdateInstallRequest {
            confirmed: false,
            ..ready().2
        },
        UpdateInstallRequest {
            expected_revision: 41,
            ..ready().2
        },
        UpdateInstallRequest {
            operation_id: "old-operation".into(),
            ..ready().2
        },
    ] {
        let (_d, manager, _) = ready();
        assert!(prepare_install(&manager, &bad).is_err());
        assert!(!manager.store.path().exists());
        assert_eq!(manager.snapshot().unwrap().state, UpdateState::Verified);
    }
}

#[tokio::test]
async fn update_install_every_exit_receipt_failure_blocks_installer_and_retains_marker() {
    for field in 0..4 {
        let (_d, manager, request) = ready();
        let ticket = prepare_install(&manager, &request).unwrap();
        let mut r = receipt();
        match field {
            0 => r.intent_saved = false,
            1 => r.session_clean = false,
            2 => r.child_reaped = false,
            _ => r.config_lock_released = false,
        };
        let called = Arc::new(Mutex::new(false));
        let observed = called.clone();
        assert!(coordinate_install(
            &manager,
            ticket,
            || async { Ok(r) },
            move || {
                *observed.lock().unwrap() = true;
                Ok(())
            }
        )
        .await
        .is_err());
        assert!(!*called.lock().unwrap());
        assert_eq!(manager.snapshot().unwrap().state, UpdateState::Failed);
        assert!(manager.lock().unwrap().persistent.pending_update.is_some());
    }
}

async fn install_bridge(mode: &str) -> crate::sidecar::Bridge {
    install_bridge_spec(crate::sidecar::tests::fixture(mode)).await
}
async fn install_bridge_spec(spec: crate::sidecar::LaunchSpec) -> crate::sidecar::Bridge {
    use crate::sidecar::{Bridge, BridgePhase};
    let bridge = Bridge::start(spec);
    let mut statuses = bridge.subscribe();
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while statuses.borrow_and_update().state == BridgePhase::Starting {
            statuses.changed().await.unwrap();
        }
    })
    .await
    .expect("install fixture did not finish preparation within 30000ms");
    assert_eq!(bridge.status().state, BridgePhase::Ready);
    bridge
}

#[tokio::test]
async fn update_install_admission_freezes_ordinary_actions_before_returning() {
    use crate::runtime_protocol::{RuntimeNetworkConfig, RuntimeStartRequest};
    let (_dir, manager, request) = ready();
    let bridge = install_bridge("owned-exit").await;
    let mut rejected = request.clone();
    rejected.confirmed = false;
    assert!(prepare_owned_install(&manager, &rejected, &bridge).is_err());
    assert!(
        bridge.ping().await.is_ok(),
        "rejected install froze the current App"
    );
    let ticket = prepare_owned_install(&manager, &request, &bridge).unwrap();
    let admitted = manager.snapshot().unwrap();
    assert_eq!(admitted.state, UpdateState::Stopping);
    assert!(prepare_owned_install(&manager, &request, &bridge).is_err());
    assert_eq!(manager.snapshot().unwrap(), admitted);
    assert_eq!(bridge.ping().await.unwrap_err().code, "OWNED_EXIT_PENDING");
    assert_eq!(
        bridge
            .runtime_start(RuntimeStartRequest {
                expected_revision: 0,
                resume_platforms: vec![]
            })
            .await
            .unwrap_err()
            .code,
        "OWNED_EXIT_PENDING"
    );
    assert_eq!(
        bridge
            .runtime_configure_network(RuntimeNetworkConfig {
                revision: 1,
                connect_proxy: String::new()
            })
            .await
            .unwrap_err()
            .code,
        "OWNED_EXIT_PENDING"
    );
    assert_eq!(
        bridge.restore_when_ready().await.unwrap_err().code,
        "OWNED_EXIT_PENDING"
    );
    let called = std::cell::Cell::new(false);
    coordinate_install(
        &manager,
        ticket,
        || bridge.prepare_owned_exit(crate::runtime::OwnedExitReason::Update),
        || {
            called.set(true);
            Ok(())
        },
    )
    .await
    .unwrap();
    assert!(called.get());
    let installing = manager.snapshot().unwrap();
    assert_eq!(installing.state, UpdateState::Installing);
    assert!(prepare_owned_install(&manager, &request, &bridge).is_err());
    assert_eq!(manager.snapshot().unwrap(), installing);
}

#[tokio::test]
async fn update_install_late_startup_cannot_stop_again_or_overwrite_install_admission() {
    use crate::preferences::PreferencesStore;
    let (dir, manager, request) = ready();
    let bridge = install_bridge("owned-exit").await;
    let before = bridge.runtime_snapshot().await.unwrap();
    let ticket = prepare_owned_install(&manager, &request, &bridge).unwrap();
    let admitted = manager.snapshot().unwrap();
    let failure = verify_startup(
        &manager,
        &bridge,
        PreferencesStore::new(dir.path().join("preferences.json")).read(),
        "stable",
    )
    .await
    .unwrap_err();
    assert_eq!(failure.code, "OWNED_EXIT_PENDING");
    assert_eq!(
        manager.snapshot().unwrap(),
        admitted,
        "late startup replaced the admitted install result"
    );
    let after = bridge
        .exit_request("runtime_snapshot", serde_json::json!({}))
        .await
        .unwrap();
    assert_eq!(
        after.result["runtime"]["revision"], before.result["runtime"]["revision"],
        "late startup replayed a stop owned by the install coordinator"
    );
    coordinate_install(
        &manager,
        ticket,
        || bridge.prepare_owned_exit(crate::runtime::OwnedExitReason::Update),
        || Ok(()),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn update_install_inflight_startup_failure_cannot_replay_its_owned_stop() {
    use crate::preferences::PreferencesStore;
    let (dir, manager, request) = ready();
    let control = dir.path().join("inspection");
    let mut spec = crate::sidecar::tests::fixture("owned-exit-slow");
    spec.args.extend([String::new(), control.to_string_lossy().into_owned()]);
    let bridge = install_bridge_spec(spec).await;
    let before = bridge.runtime_snapshot().await.unwrap();
    let startup_bridge = bridge.clone();
    let startup_manager = manager.clone();
    let preferences = PreferencesStore::new(dir.path().join("preferences.json")).read();
    let startup = tokio::spawn(async move {
        verify_startup(&startup_manager, &startup_bridge, preferences, "stable").await
    });
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while !control.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("startup inspection was not in flight within 1s");
    let ticket = prepare_owned_install(&manager, &request, &bridge).unwrap();
    std::fs::write(control.with_extension("release"), b"release").unwrap();
    let admitted = manager.snapshot().unwrap();
    let failure = startup.await.unwrap().unwrap_err();
    assert_eq!(failure.code, "OWNED_EXIT_PENDING");
    assert_eq!(manager.snapshot().unwrap(), admitted);
    let after = bridge
        .exit_request("runtime_snapshot", serde_json::json!({}))
        .await
        .unwrap();
    assert_eq!(
        after.result["runtime"]["revision"],
        before.result["runtime"]["revision"]
    );
    coordinate_install(
        &manager,
        ticket,
        || bridge.prepare_owned_exit(crate::runtime::OwnedExitReason::Update),
        || Ok(()),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn update_install_persists_before_exit_and_does_not_release_app_singleton() {
    let (_d, manager, request) = ready();
    let ticket = prepare_install(&manager, &request).unwrap();
    assert!(prepare_install(&manager, &request).is_err());
    let order = Arc::new(Mutex::new(vec![]));
    let before = order.clone();
    let after = order.clone();
    let observed = manager.clone();
    let installing = manager.clone();
    coordinate_install(
        &manager,
        ticket,
        move || async move {
            assert!(observed.store.path().exists());
            assert_eq!(observed.snapshot().unwrap().state, UpdateState::Stopping);
            before.lock().unwrap().push("owned-exit");
            Ok(receipt())
        },
        move || {
            assert_eq!(
                installing.snapshot().unwrap().state,
                UpdateState::Installing
            );
            assert_eq!(
                installing
                    .lock()
                    .unwrap()
                    .persistent
                    .pending_update
                    .as_ref()
                    .unwrap()
                    .stage,
                "installing"
            );
            after.lock().unwrap().push("native-installer");
            Ok(())
        },
    )
    .await
    .unwrap();
    assert_eq!(
        *order.lock().unwrap(),
        vec!["owned-exit", "native-installer"]
    );
    assert_eq!(manager.snapshot().unwrap().state, UpdateState::Installing);
    // The coordinator has no singleton release capability. Actual App exit owns it.
}

#[tokio::test]
async fn update_install_real_owned_exit_reaps_before_installer_and_blocks_on_failed_save() {
    use crate::{
        runtime::OwnedExitReason,
        sidecar::{Bridge, BridgePhase},
    };
    for mode in [
        "owned-exit",
        "owned-exit-save-failure",
        "owned-exit-wrong-operation",
    ] {
        let bridge = Bridge::start(crate::sidecar::tests::fixture(mode));
        let started = std::time::Instant::now();
        let mut statuses = bridge.subscribe();
        // Node24's 117 MiB fixture is fully hashed before the protocol deadline
        // starts. Match the existing runtime fixture's preparation wait; the
        // production handshake and owned-exit budgets remain unchanged.
        tokio::time::timeout(std::time::Duration::from_secs(30), async {
            while statuses.borrow_and_update().state == BridgePhase::Starting {
                statuses.changed().await.expect("owned-exit fixture status channel closed");
            }
        })
        .await
        .unwrap_or_else(|cause| panic!("owned-exit fixture preparation failed: mode={mode} elapsed_ms={} status={:?} required=ready within 30000ms; cause={cause}", started.elapsed().as_millis(), bridge.status()));
        assert_eq!(
            bridge.status().state,
            BridgePhase::Ready,
            "owned-exit fixture preparation rejected: mode={mode} status={:?}",
            bridge.status()
        );
        let (_dir, manager, request) = ready();
        let ticket = prepare_install(&manager, &request).unwrap();
        let called = Arc::new(Mutex::new(false));
        let observed = called.clone();
        let stopped = bridge.clone();
        let result = coordinate_install(
            &manager,
            ticket,
            || async {
                bridge
                    .prepare_owned_exit(OwnedExitReason::Update)
                    .await
                    .map(|r| UpdateExitReceipt {
                        intent_saved: r.intent_saved,
                        session_clean: r.session_clean,
                        child_reaped: r.child_reaped,
                        config_lock_released: r.config_lock_released,
                    })
            },
            move || {
                assert_ne!(stopped.status().state, BridgePhase::Ready);
                *observed.lock().unwrap() = true;
                Ok(())
            },
        )
        .await;
        assert_eq!(result.is_ok(), mode == "owned-exit");
        assert_eq!(*called.lock().unwrap(), mode == "owned-exit");
        assert_ne!(bridge.status().state, BridgePhase::Ready);
        assert!(bridge.ping().await.is_err());
    }
}

#[tokio::test]
async fn update_install_startup_reads_real_preferences_and_waits_for_s1_success_before_clearing_marker(
) {
    use crate::{
        preferences::PreferencesStore,
        sidecar::{Bridge, BridgePhase},
    };
    for mode in [
        "owned-exit",
        "owned-exit-restore-failure",
        "owned-exit-restore-wrong-operation",
    ] {
        let (dir, manager, request) = ready();
        prepare_install(&manager, &request).unwrap();
        let manager = UpdateManager::new("0.2.0", manager.store.clone()).unwrap();
        let bridge = Bridge::start(crate::sidecar::tests::fixture(mode));
        hold_startup(&bridge);
        let preferences = PreferencesStore::new(dir.path().join("preferences.json")).read();
        let result = verify_startup(&manager, &bridge, preferences, "stable").await;
        assert_eq!(result.is_ok(), mode == "owned-exit");
        assert_eq!(manager.has_pending().unwrap(), mode != "owned-exit");
        if result.is_ok() {
            assert!(bridge.ping().await.is_ok());
        } else {
            assert!(
                bridge.ping().await.is_ok(),
                "management readback must remain usable after a safely stopped restore failure"
            );
            assert_eq!(
                bridge.runtime_snapshot().await.unwrap().result["runtime"]["local"],
                "stopped"
            );
        }
        bridge.stop().await.unwrap();
        assert_ne!(bridge.status().state, BridgePhase::Ready);
    }
}

#[tokio::test]
async fn update_install_startup_preferences_error_or_old_package_prevents_restore_and_keeps_originals(
) {
    use crate::{preferences::PreferencesStore, sidecar::Bridge};
    for bad_preferences in [true, false] {
        let (dir, manager, request) = ready();
        prepare_install(&manager, &request).unwrap();
        let manager = UpdateManager::new(
            if bad_preferences { "0.2.0" } else { "0.0.1" },
            manager.store.clone(),
        )
        .unwrap();
        let path = dir.path().join("preferences.json");
        if bad_preferences {
            let file = std::fs::File::create(&path).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(std::fs::Permissions::from_mode(0o600))
                    .unwrap();
            }
            std::fs::write(&path, b"{\"version\":99}").unwrap();
        }
        let bridge = Bridge::start(crate::sidecar::tests::fixture("owned-exit"));
        hold_startup(&bridge);
        let cause = verify_startup(
            &manager,
            &bridge,
            PreferencesStore::new(path.clone()).read(),
            "stable",
        )
        .await
        .unwrap_err();
        assert_eq!(
            cause.code,
            if bad_preferences {
                "UPDATE_PREFERENCES_UNVERIFIED"
            } else {
                "UPDATE_RECOVERY_IDENTITY_MISMATCH"
            }
        );
        assert!(!bridge.0.restored.load(std::sync::atomic::Ordering::SeqCst));
        assert!(manager.has_pending().unwrap());
        if bad_preferences {
            assert_eq!(std::fs::read(&path).unwrap(), b"{\"version\":99}");
        }
        assert_eq!(
            bridge.ping().await.unwrap_err().code,
            "STARTUP_VERIFICATION_PENDING"
        );
        bridge.stop().await.unwrap();
    }
}

#[tokio::test]
async fn update_install_recovery_marker_write_failure_stops_live_runtime_before_reporting_failure()
{
    use crate::{preferences::PreferencesStore, sidecar::Bridge};
    let (dir, manager, request) = ready();
    prepare_install(&manager, &request).unwrap();
    let manager = UpdateManager::new("0.2.0", manager.store.clone()).unwrap();
    // Fault after the protected state was loaded: the clear must reject this
    // changed original, after the child's real restore reply reports running.
    std::fs::write(manager.store.path(), b"{broken").unwrap();
    let bridge = Bridge::start(crate::sidecar::tests::fixture("owned-exit"));
    hold_startup(&bridge);
    assert!(verify_startup(
        &manager,
        &bridge,
        PreferencesStore::new(dir.path().join("prefs.json")).read(),
        "stable"
    )
    .await
    .is_err());
    let snapshot = bridge
        .exit_request("runtime_snapshot", serde_json::json!({}))
        .await
        .unwrap();
    assert_eq!(
        snapshot.result["runtime"]["local"], "stopped",
        "failed marker clear left restored contribution running"
    );
    assert!(manager.has_pending().unwrap());
    assert_eq!(std::fs::read(manager.store.path()).unwrap(), b"{broken");
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn update_install_trusted_previous_version_can_recover_and_retry_without_claiming_update_success(
) {
    use crate::{preferences::PreferencesStore, sidecar::Bridge};
    let (dir, manager, request) = ready();
    prepare_install(&manager, &request).unwrap();
    let manager = UpdateManager::new("0.1.0", manager.store.clone()).unwrap();
    let bridge = Bridge::start(crate::sidecar::tests::fixture("owned-exit"));
    hold_startup(&bridge);
    verify_startup(
        &manager,
        &bridge,
        PreferencesStore::new(dir.path().join("prefs.json")).read(),
        "stable",
    )
    .await
    .unwrap();
    assert!(!manager.has_pending().unwrap());
    let snapshot = manager.snapshot().unwrap();
    assert_eq!(snapshot.state, UpdateState::Failed);
    assert_eq!(
        snapshot.error.unwrap().code,
        "UPDATE_PREVIOUS_NOT_INSTALLED"
    );
    assert!(manager.begin_check(true, 100).unwrap().is_some());
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn update_install_failed_recovery_with_unproven_stop_reaps_only_owned_child_and_keeps_gate() {
    use crate::{
        preferences::PreferencesStore,
        sidecar::{Bridge, BridgePhase},
    };
    let (dir, manager, request) = ready();
    prepare_install(&manager, &request).unwrap();
    let manager = UpdateManager::new("0.2.0", manager.store.clone()).unwrap();
    let bridge = Bridge::start(crate::sidecar::tests::fixture(
        "owned-exit-restore-failure-stop-failure",
    ));
    hold_startup(&bridge);
    let cause = verify_startup(
        &manager,
        &bridge,
        PreferencesStore::new(dir.path().join("prefs.json")).read(),
        "stable",
    )
    .await
    .unwrap_err();
    assert!(cause.message.contains("fixture account schema rejected"));
    assert!(cause.message.contains("owned child cleanup=reaped"));
    assert!(cause.message.contains("startup remains blocked"));
    assert_ne!(bridge.status().state, BridgePhase::Ready);
    assert_eq!(
        bridge.ping().await.unwrap_err().code,
        "STARTUP_VERIFICATION_PENDING"
    );
    assert!(manager.has_pending().unwrap());
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn update_install_disk_failure_prevents_exit_and_actual_installer_failure_retains_stopped_state(
) {
    let (dir, manager, request) = ready();
    std::fs::create_dir(manager.store.path()).unwrap();
    assert!(prepare_install(&manager, &request).is_err());
    assert_eq!(manager.snapshot().unwrap().state, UpdateState::Verified);
    drop(dir);
    let (_d, manager, request) = ready();
    let ticket = prepare_install(&manager, &request).unwrap();
    let failure = error(
        "INSTALLER_DENIED",
        "native installer permission denied; code=13",
    );
    assert!(coordinate_install(
        &manager,
        ticket,
        || async { Ok(receipt()) },
        || Err(failure.clone())
    )
    .await
    .is_err());
    let snapshot = manager.snapshot().unwrap();
    assert_eq!(snapshot.state, UpdateState::Failed);
    assert!(snapshot.error.unwrap().message.contains("stopped"));
    assert_eq!(
        manager
            .lock()
            .unwrap()
            .persistent
            .pending_update
            .as_ref()
            .unwrap()
            .stage,
        "stopped"
    );
}

#[test]
fn update_install_recovery_requires_new_package_and_all_dependency_proofs_before_clearing() {
    let (_d, manager, request) = ready();
    prepare_install(&manager, &request).unwrap();
    assert!(complete_recovery(&manager, "0.1.0", &recovery()).is_err());
    for field in 0..6 {
        let mut proof = recovery();
        match field {
            0 => proof.package_source_verified = false,
            1 => proof.protocol_verified = false,
            2 => proof.account_state_verified = false,
            3 => proof.preferences_verified = false,
            4 => proof.pending_actions_verified = false,
            _ => proof.runtime_intent_restored = false,
        };
        assert!(complete_recovery(&manager, "0.2.0", &proof).is_err());
        assert!(manager.lock().unwrap().persistent.pending_update.is_some());
    }
    complete_recovery(&manager, "0.2.0", &recovery()).unwrap();
    assert!(manager.lock().unwrap().persistent.pending_update.is_none());
}

#[tokio::test]
async fn update_install_pending_recovery_bootstraps_s2_network_while_user_actions_remain_blocked() {
    use crate::{
        network::NetworkController,
        network_native::BridgeNetworkRuntime,
        preferences::PreferencesStore,
        sidecar::{Bridge, BridgePhase},
    };
    let (dir, old, request) = ready();
    prepare_install(&old, &request).unwrap();
    let manager = UpdateManager::new("0.2.0", old.store.clone()).unwrap();
    let store = PreferencesStore::new(dir.path().join("preferences.json"));
    let bridge = Bridge::start(crate::sidecar::tests::fixture("owned-exit-bootstrap"));
    let mut statuses = bridge.subscribe();
    while statuses.borrow_and_update().state != BridgePhase::Ready {
        statuses.changed().await.unwrap();
    }
    hold_startup(&bridge);
    let controller = NetworkController::default();
    let device = bridge
        .device_status()
        .await
        .expect("pending update must permit S2 startup device read before S1 recovery");
    let scope = controller
        .bind_verified_device(&store, &device.result)
        .unwrap()
        .unwrap();
    let mut prefs = store.read().preferences;
    prefs.proxies.push(crate::preferences::ProxyPreference {
        origin: scope.origin().into(),
        device_scope: Some(scope.device_scope().into()),
        connect_proxy: "http://127.0.0.1:7890".into(),
    });
    let saved = store.save(prefs.revision, prefs);
    assert!(saved.error.is_none());
    let network = controller
        .bootstrap_saved(&store, &BridgeNetworkRuntime(&bridge), &scope)
        .await;
    assert!(
        network.error.is_none(),
        "S2 bootstrap rejected during update recovery: {:?}",
        network.error
    );
    assert_eq!(network.effective_proxy, "http://127.0.0.1:7890");
    assert!(manager.has_pending().unwrap());
    assert!(!bridge.0.restored.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        bridge.ping().await.unwrap_err().code,
        "STARTUP_VERIFICATION_PENDING"
    );
    assert_eq!(
        bridge
            .runtime_start(crate::runtime_protocol::RuntimeStartRequest {
                expected_revision: 1,
                resume_platforms: vec![]
            })
            .await
            .unwrap_err()
            .code,
        "STARTUP_VERIFICATION_PENDING"
    );
    // Even these startup reads/configuration must respect a concurrent owned exit.
    bridge
        .0
        .frozen
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        bridge.device_status().await.unwrap_err().code,
        "OWNED_EXIT_PENDING"
    );
    assert_eq!(
        bridge
            .runtime_configure_network(crate::runtime_protocol::RuntimeNetworkConfig {
                revision: 99,
                connect_proxy: String::new()
            })
            .await
            .unwrap_err()
            .code,
        "OWNED_EXIT_PENDING"
    );
    bridge
        .0
        .frozen
        .store(false, std::sync::atomic::Ordering::SeqCst);
    verify_startup(&manager, &bridge, store.read(), "stable")
        .await
        .unwrap();
    assert!(!manager.has_pending().unwrap());
    assert_eq!(manager.snapshot().unwrap().state, UpdateState::Current);
    let runtime = bridge.runtime_snapshot().await.unwrap();
    assert_eq!(
        runtime.result["runtime"]["network_revision"],
        network.effective_revision
    );
    assert_eq!(runtime.result["runtime"]["local"], "running");
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn business_recheck_never_fabricates_pending_update_runtime_evidence() {
    let (dir, manager, request) = ready();
    prepare_install(&manager, &request).unwrap();
    let bridge = crate::sidecar::Bridge::start(crate::sidecar::tests::fixture("owned-exit"));
    hold_startup(&bridge);
    let error = verify_recheck(
        &manager,
        &bridge,
        crate::preferences::PreferencesStore::new(dir.path().join("preferences.json")).read(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "UPDATE_RECOVERY_PENDING");
    assert!(manager.has_pending().unwrap());
    assert!(!bridge.0.restored.load(std::sync::atomic::Ordering::SeqCst));
    assert!(!bridge
        .0
        .startup_verified
        .load(std::sync::atomic::Ordering::SeqCst));
    bridge.stop().await.unwrap();
}

#[tokio::test]
async fn business_recheck_after_restore_failure_and_clean_stop_preserves_pending_evidence() {
    for pending in [false, true] {
        let (dir, manager, request) = ready();
        if pending {
            prepare_install(&manager, &request).unwrap();
        }
        let bridge = crate::sidecar::Bridge::start(crate::sidecar::tests::fixture(
            "owned-exit-restore-failure",
        ));
        hold_startup(&bridge);
        let preferences =
            crate::preferences::PreferencesStore::new(dir.path().join("preferences.json"));
        let failure = verify_startup(&manager, &bridge, preferences.read(), "stable")
            .await
            .unwrap_err();
        assert!(failure
            .message
            .contains("recovery stopped with saved intent and clean session"));
        assert_eq!(
            bridge.runtime_snapshot().await.unwrap().result["runtime"]["local"],
            "stopped"
        );
        let result = verify_recheck(&manager, &bridge, preferences.read()).await;
        if pending {
            assert_eq!(result.unwrap_err().code, "UPDATE_RECOVERY_PENDING");
            assert!(manager.has_pending().unwrap());
        } else {
            result.unwrap();
        }
        assert_eq!(
            bridge.runtime_snapshot().await.unwrap().result["runtime"]["local"],
            "stopped"
        );
        bridge.stop().await.unwrap();
    }
}
