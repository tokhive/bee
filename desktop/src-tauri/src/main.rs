// The Bee desktop app's shell: it keeps a Bee background service running,
// mirrors its state in the tray and serves it to the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod control;
mod service;
mod state;

use hyper::Method;
use serde_json::Value;
use service::{Service, ServiceState};
use state::{Snapshot, TrayState};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tokio::sync::Notify;

struct Shared {
    service: Arc<Service>,
    snapshot: Mutex<Snapshot>,
    refresh: Notify,
    status_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

/// The device configuration the app's Bee uses: Bee's own default, unless
/// BEE_DESKTOP_CONFIG names another (for development against the mock).
fn config_path() -> PathBuf {
    if let Some(path) = std::env::var_os("BEE_DESKTOP_CONFIG") {
        return PathBuf::from(path);
    }
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("tokhive").join("bee.json")
}

/// The bundled bee, which Tauri places next to the app's executable.
fn bee_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().map(|dir| dir.join("bee")).unwrap_or_else(|| PathBuf::from("bee"))
}

fn tray_icon(state: TrayState) -> Image<'static> {
    let raw: &[u8] = match state {
        TrayState::Good => include_bytes!("../icons/tray-good.png"),
        TrayState::Attention => include_bytes!("../icons/tray-attention.png"),
        TrayState::Paused => include_bytes!("../icons/tray-paused.png"),
        TrayState::Off => include_bytes!("../icons/tray-off.png"),
    };
    Image::from_bytes(raw).expect("tray icon")
}

/// Reads Bee's overview and each account's platform, and publishes the result.
async fn refresh(app: &AppHandle, shared: &Shared) {
    let service = shared.service.state();
    let mut overview = None;
    let mut platforms = BTreeMap::new();
    if matches!(service, ServiceState::Running | ServiceState::External) {
        if let Ok(value) = shared.service.control.get("/v1/overview").await {
            let paired = value["binding"] == "paired" && value["connection"] == "connected";
            let names: Vec<String> = value["sources"].as_array().into_iter().flatten().filter_map(|s| s["platform"].as_str().map(String::from)).collect();
            if paired {
                for name in names {
                    if let Ok(platform) = shared.service.control.get(&format!("/v1/platforms/{name}")).await {
                        platforms.insert(name, platform);
                    }
                }
            }
            overview = Some(value);
        }
    }
    let snapshot = Snapshot::new(service, overview, platforms);
    let changed = {
        let mut current = shared.snapshot.lock().unwrap();
        let changed = current.tray != snapshot.tray || current.summary != snapshot.summary;
        *current = snapshot.clone();
        changed
    };
    if changed {
        eprintln!("[bee-desktop] tray {:?}: {}", snapshot.tray, snapshot.summary);
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_icon(Some(tray_icon(snapshot.tray)));
            let _ = tray.set_icon_as_template(true);
            let _ = tray.set_tooltip(Some(format!("Bee · {}", snapshot.summary)));
        }
        if let Some(item) = shared.status_item.lock().unwrap().as_ref() {
            let _ = item.set_text(&snapshot.summary);
        }
    }
    let _ = app.emit("bee://state", &snapshot);
}

/// Refreshes when Bee pushes a change, when the service state changes, and
/// every minute regardless, so quota and slow changes stay current.
fn watch(app: AppHandle, shared: Arc<Shared>) {
    let follower = shared.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let notify = &follower.refresh;
            let _ = follower.service.control.follow_events(|_| notify.notify_one()).await;
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
    let services = shared.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            services.service.changed().await;
            services.refresh.notify_one();
        }
    });
    tauri::async_runtime::spawn(async move {
        loop {
            refresh(&app, &shared).await;
            let _ = tokio::time::timeout(Duration::from_secs(60), shared.refresh.notified()).await;
            // Let a burst of events settle into one read.
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    });
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Quits the app, stopping its own Bee first. A Bee the app did not start
/// keeps running.
fn quit(app: &AppHandle) {
    let shared = app.state::<Arc<Shared>>().inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        shared.service.stop().await;
        app.exit(0);
    });
}

#[tauri::command]
fn get_state(shared: tauri::State<'_, Arc<Shared>>) -> Snapshot {
    shared.snapshot.lock().unwrap().clone()
}

/// Passes a request from the window to Bee's control interface.
#[tauri::command]
async fn bee_request(shared: tauri::State<'_, Arc<Shared>>, method: String, path: String, body: Option<Value>) -> Result<Value, control::ControlError> {
    if !path.starts_with("/v1/") {
        return Err(control::ControlError { status: 400, code: "invalid_path".into(), message: "only /v1/ paths".into() });
    }
    let method = Method::from_bytes(method.as_bytes()).map_err(|_| control::ControlError { status: 400, code: "invalid_method".into(), message: method.clone() })?;
    let result = shared.service.control.request(method, &path, body.as_ref()).await;
    shared.refresh.notify_one();
    result
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    quit(&app);
}

fn main() {
    let attach_only = std::env::var_os("BEE_DESKTOP_ATTACH_ONLY").is_some();
    let service = Arc::new(Service::new(config_path(), bee_path(), attach_only));
    eprintln!("[bee-desktop] config {} socket {}", service.config.display(), service.control.socket().display());
    let shared = Arc::new(Shared {
        snapshot: Mutex::new(Snapshot::new(ServiceState::Starting, None, BTreeMap::new())),
        service,
        refresh: Notify::new(),
        status_item: Mutex::new(None),
    });

    let app = tauri::Builder::default()
        // Opening the app again shows the window of the one already running.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![get_state, bee_request, quit_app])
        .on_window_event(|window, event| {
            // Closing the window keeps Bee sharing from the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            let status = MenuItem::with_id(app, "status", "正在启动后台服务…", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "打开 Bee", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &open, &exit])?;
            *shared.status_item.lock().unwrap() = Some(status);
            TrayIconBuilder::with_id("main")
                .icon(tray_icon(TrayState::Off))
                .icon_as_template(true)
                .tooltip("Bee")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => quit(app),
                    _ => {}
                })
                .build(app)?;
            let service = shared.service.clone();
            tauri::async_runtime::spawn(async move { service.run().await });
            watch(app.handle().clone(), shared.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build the Bee app");

    // Development hook: quit through the normal path after N seconds.
    #[cfg(debug_assertions)]
    if let Some(seconds) = std::env::var("BEE_DESKTOP_EXIT_AFTER").ok().and_then(|v| v.parse::<u64>().ok()) {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            eprintln!("[bee-desktop] test hook: quitting");
            quit(&handle);
        });
    }

    app.run(|app, event| match event {
        // Quitting from the Dock or the app menu stops the app's own Bee
        // first, as the tray's Quit does; quit() then exits with a code.
        RunEvent::ExitRequested { api, code: None, .. } => {
            if app.state::<Arc<Shared>>().service.owns_bee() {
                api.prevent_exit();
                quit(app);
            }
        }
        // macOS: clicking the Dock icon with no window shown reopens it.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows: false, .. } => show_main(app),
        _ => {}
    });
}
