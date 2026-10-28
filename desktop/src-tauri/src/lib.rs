pub mod authorize_protocol;
mod autostart;
pub mod build_source;
mod commands;
mod diagnostic_log;
mod diagnostics;
mod diagnostics_native;
mod diagnostics_protocol;
mod experience;
mod lifecycle;
mod navigation;
mod network;
mod network_native;
mod network_protocol;
mod notification_poll;
mod notifications;
mod preferences;
pub mod protocol;
pub mod runtime;
pub mod runtime_protocol;
pub mod sidecar;
use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .manage(lifecycle::LoginReceipt::default())
        .manage(experience::StartupGate::default())
        .manage(network::NetworkController::default())
        .manage(autostart::AutostartLock::default())
        .manage(notification_poll::NotificationPollState::default())
        // This must be the first plugin: its setup exits secondary instances
        // before the window and owned management Child can be created.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for argument in args.iter().skip(1) {
                lifecycle::deliver_callback(app, argument);
            }
            lifecycle::dispatch(app, lifecycle::WindowEvent::SecondLaunch);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().args(["--bee-background"]).build())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    lifecycle::dispatch(
                        window.app_handle(),
                        lifecycle::WindowEvent::CloseRequested,
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bridge_request,
            commands::bridge_status,
            commands::autostart_status,
            commands::autostart_set,
            commands::diagnostics_start,
            commands::diagnostics_snapshot,
            commands::diagnostics_cancel,
            commands::diagnostic_logs,
            commands::diagnostics_export,
            commands::notification_permission,
            commands::notification_enable,
            commands::notification_delivery_status,
            commands::notification_retry,
            commands::network_test,
            commands::network_snapshot,
            commands::network_apply_saved,
            commands::network_save_proxy,
            commands::hive_open,
            commands::preferences_read,
            commands::preferences_save,
            commands::device_status,
            commands::device_begin,
            commands::device_open,
            commands::supply_status,
            commands::supply_set_paused,
            commands::account_defaults,
            commands::account_detect,
            commands::account_snapshot,
            commands::account_action,
            commands::authorize_start,
            commands::authorize_status,
            commands::authorize_cancel,
            commands::runtime_snapshot,
            commands::runtime_start,
            commands::runtime_stop,
            lifecycle::login_return_received
        ])
        .setup(|app| {
            app.manage(preferences::PreferencesStore::new(app.path().config_dir()?.join("tokhive/desktop-preferences.json")));
            app.manage(diagnostics_native::NativeDiagnostics::new(app.path().app_log_dir()?.join("safe-diagnostics")));
            let notify_handle = app.handle().clone();
            let adapter = notifications::NativeNotificationAdapter::new(app.config().identifier.clone(), std::sync::Arc::new(move |page| {
                lifecycle::dispatch(&notify_handle,lifecycle::WindowEvent::Reopen);
                if let Err(cause)=notify_handle.emit_to("main","bee://notification-navigation",page){eprintln!("notification navigation delivery failed: {cause}");}
            }));
            app.manage(notifications::NotificationService::new(app.path().config_dir()?.join("tokhive/notification-delivery.json"),std::sync::Arc::new(adapter)));
            let config = app.config().app.windows.first().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Bee main window configuration missing: actual window count=0; required=1",
                )
            })?;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(|url| {
                    navigation::allowed(
                        url.scheme(),
                        url.host_str(),
                        url.port(),
                        cfg!(debug_assertions),
                    )
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_download(|webview, event| {
                    if let tauri::webview::DownloadEvent::Finished { url, success, .. } = event {
                        // macOS always reports path=None, including successful downloads.
                        // The opaque Blob URL correlates the receipt with this export only.
                        if let Err(cause) = webview.emit_to(
                            "main",
                            "bee://download-finished",
                            serde_json::json!({ "url": url.as_str(), "success": success }),
                        ) {
                            eprintln!("deliver report download result to main window: success={success}: {cause}");
                        }
                    }
                    true
                })
                .build()?;
            let tray_available = lifecycle::install_menu_and_tray(app)?;
            if lifecycle::background_should_hide(std::env::args().any(|a| a == "--bee-background"), tray_available) {
                lifecycle::dispatch(app.handle(), lifecycle::WindowEvent::Menu(lifecycle::WindowIntent::Hide));
            }
            for argument in std::env::args().skip(1) {
                lifecycle::deliver_callback(app.handle(), &argument);
            }
            let bridge = sidecar::Bridge::bundled();
            let mut statuses = bridge.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while statuses.changed().await.is_ok() {
                    let state = handle.state::<experience::StartupGate>().status(statuses.borrow_and_update().clone());
                    if let Err(cause) = handle.emit_to("main", "bee://bridge-status", state) {
                        eprintln!("deliver Bee bridge status to main window: {cause}");
                    }
                }
            });
            let restoring = bridge.clone();
            let owner=app.handle().clone();
            tauri::async_runtime::spawn(experience::startup(owner,restoring));
            tauri::async_runtime::spawn(notification_poll::run(app.handle().clone(),bridge.clone()));
            app.manage(bridge);
            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("Bee native runtime failed: {error:#}");
            std::process::exit(1);
        })
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                lifecycle::dispatch(app, lifecycle::WindowEvent::Reopen)
            }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                for url in urls {
                    lifecycle::deliver_callback(app, url.as_str());
                }
            }
            tauri::RunEvent::Exit => {
                if let Some(bridge) = app.try_state::<sidecar::Bridge>() {
                    if let Err(cause) =
                        tauri::async_runtime::block_on(lifecycle::shutdown_owned(&bridge, || {
                            tauri_plugin_single_instance::destroy(app)
                        }))
                    {
                        eprintln!(
                            "Bee owned exit not fully confirmed: {}: {}",
                            cause.code, cause.message
                        );
                    }
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod singleton_tests;
