pub mod authorize_protocol;
mod autostart;
pub mod build_source;
pub mod hive_origin;
mod commands;
mod diagnostic_log;
mod diagnostics;
mod diagnostics_native;
mod diagnostics_protocol;
mod experience;
mod startup_recovery;
pub(crate) mod profiles;
pub(crate) mod hive_switch;
pub(crate) mod switch_protocol;
mod lifecycle;
// Native acceptance probes share the production notification locale policy.
pub use lifecycle::{NativeLanguage, NativeLocale};
mod navigation;
mod network;
mod network_native;
mod network_protocol;
#[cfg(test)]
mod native_integration_tests;
#[cfg(all(test, unix))]
mod native_retirement_tests;
mod notification_poll;
mod notifications;
mod preferences;
#[cfg(windows)]
pub(crate) mod private_file_windows;
pub mod protocol;
pub mod runtime;
pub mod runtime_protocol;
pub mod sidecar;
pub mod update_install;
#[cfg(test)]
mod update_install_tests;
pub mod updater;
#[cfg(test)]
mod updater_tests;
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            commands::hive_switch_snapshot,
            commands::hive_switch_start,
            commands::hive_switch_observe,
            commands::hive_switch_target_status,
            commands::hive_switch_target_begin,
            commands::hive_switch_target_open,
            commands::hive_switch_target_recovery_prepare,
            commands::hive_switch_target_recovery_confirm,
            commands::hive_switch_target_recovery_status,
            commands::bridge_request,
            commands::bridge_status,
            commands::bridge_pending_requests,
 commands::startup_status,
 commands::startup_recheck,
 commands::startup_retry,
 commands::startup_query,
 commands::device_context,
commands::device_recovery_prepare,
commands::device_recovery_confirm,
commands::device_recovery_status,
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
            commands::authorize_progress,
            commands::authorize_open,
            commands::runtime_snapshot,
            commands::runtime_start,
            commands::runtime_stop,
            updater::update_snapshot,
            updater::update_check,
            updater::update_download,
            update_install::update_install,
            lifecycle::login_return_received
            ,lifecycle::native_locale_sync
        ])
        .setup(|app| {
            app.manage(preferences::PreferencesStore::new(app.path().config_dir()?.join("tokhive/desktop-preferences.json")));
            let native_language=std::sync::Arc::new(lifecycle::NativeLanguage::initialize(&app.state::<preferences::PreferencesStore>().read()));
            app.manage(native_language.clone());
            app.manage(diagnostics_native::NativeDiagnostics::new(app.path().app_log_dir()?.join("safe-diagnostics")));
            let notify_handle = app.handle().clone();
            let adapter = notifications::NativeNotificationAdapter::new(app.config().identifier.clone(), std::sync::Arc::new(move |page| {
                lifecycle::dispatch(&notify_handle,lifecycle::WindowEvent::Reopen);
                if let Err(cause)=notify_handle.emit_to("main","bee://notification-navigation",page){eprintln!("notification navigation delivery failed: {cause}");}
            }),native_language);
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
            let updates=updater::setup(app.handle()).map_err(|cause|std::io::Error::other(format!("{}: {}",cause.code,cause.message)))?;
            let coordinator=hive_switch::HiveSwitch::open(app.path().config_dir()?.join("tokhive"),&app.path().app_config_dir()?).map_err(|cause|std::io::Error::other(format!("{}: {}",cause.code,cause.message)))?;
            let route=coordinator.current.clone();
            app.manage(route.clone());
            app.manage(coordinator);
            tauri::async_runtime::spawn(hive_switch::observe_current(app.handle().clone(),route.clone()));
            let startup_app=app.handle().clone();
            let startup_updates=updates.clone();
            tauri::async_runtime::spawn(async move {
                let coordinator=startup_app.state::<hive_switch::HiveSwitch>();
                match coordinator.pending() {
                    Ok(true)=>{if let Err(cause)=coordinator.observe(startup_app.state::<preferences::PreferencesStore>().read()).await {eprintln!("switch startup reconciliation: {}: {}",cause.code,cause.message);}},
                    Ok(false)=>{},
                    Err(cause)=>eprintln!("switch startup journal blocked: {}: {}",cause.code,cause.message),
                }
                coordinator.startup_current(startup_app.clone()).await;
                updater::start_background(&startup_app,&startup_updates);
            });
            tauri::async_runtime::spawn(notification_poll::run(app.handle().clone(),route));
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
                if let Some(route) = app.try_state::<hive_switch::CurrentBridge>() {
                    if let Ok(bridge)=route.get() {
                    if let Err(cause) =
                        tauri::async_runtime::block_on(lifecycle::shutdown_owned(&bridge, app.try_state::<diagnostics_native::NativeDiagnostics>().as_deref().map(|diagnostics| &diagnostics.logs), || {
                            tauri_plugin_single_instance::destroy(app)
                        }))
                    {
                        eprintln!(
                            "Bee owned exit not fully confirmed: {}: {}",
                            cause.code, cause.message
                        );
                    }
                    }
                    if let Some(coordinator)=app.try_state::<hive_switch::HiveSwitch>() {if let Err(cause)=tauri::async_runtime::block_on(coordinator.shutdown_target()){eprintln!("target shutdown: {}: {}",cause.code,cause.message);}}
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod singleton_tests;
