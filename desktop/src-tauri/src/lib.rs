pub mod build_source;
mod commands;
mod diagnostics;
mod lifecycle;
mod navigation;
pub mod protocol;
pub mod sidecar;
use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .manage(lifecycle::LoginReceipt::default())
        // This must be the first plugin: its setup exits secondary instances
        // before the window and owned management Child can be created.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for argument in args.iter().skip(1) {
                lifecycle::deliver_callback(app, argument);
            }
            lifecycle::dispatch(app, lifecycle::WindowEvent::SecondLaunch);
        }))
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
            lifecycle::login_return_received
        ])
        .setup(|app| {
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
                .build()?;
            lifecycle::install_menu_and_tray(app)?;
            for argument in std::env::args().skip(1) {
                lifecycle::deliver_callback(app.handle(), &argument);
            }
            let bridge = sidecar::Bridge::bundled();
            let mut statuses = bridge.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while statuses.changed().await.is_ok() {
                    let state = statuses.borrow_and_update().clone();
                    if let Err(cause) = handle.emit_to("main", "bee://bridge-status", state) {
                        eprintln!("deliver Bee bridge status to main window: {cause}");
                    }
                }
            });
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
                            "Bee exit failed to reap owned management process: {}: {}",
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
