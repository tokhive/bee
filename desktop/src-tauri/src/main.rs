// The Bee desktop app's shell: it keeps a Bee background service running,
// mirrors its state in the tray and serves it to the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod alerts;
mod control;
mod logs;
mod occupied;
mod service;
mod settings;
mod state;

use hyper::Method;
use serde_json::Value;
use service::{Service, ServiceState};
use state::{Snapshot, TrayState};
use std::collections::BTreeMap;
use std::path::PathBuf;
use settings::{Settings, SettingsChange, Store};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Notify;

/// The argument the login item starts the app with: no window, tray only.
const BACKGROUND_ARG: &str = "--background";

struct Shared {
    service: Arc<Service>,
    snapshot: Mutex<Snapshot>,
    refresh: Notify,
    status_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    /// The tray menu's fixed items, whose words follow the language setting.
    menu_items: Mutex<Option<(MenuItem<tauri::Wry>, MenuItem<tauri::Wry>)>>,
    settings: Mutex<Settings>,
    store: Mutex<Option<Store>>,
    history: Mutex<Option<alerts::History>>,
    /// Bee's explanations of reason codes, by code, once read.
    explanations: Mutex<BTreeMap<String, Value>>,
    stopped_since: Mutex<Option<Instant>>,
    /// False on a Linux desktop that shows no tray icons.
    tray_available: bool,
}

/// Whether this desktop shows tray icons. GNOME shows none unless an
/// extension provides a StatusNotifierWatcher on the session bus.
fn tray_available() -> bool {
    if !cfg!(target_os = "linux") {
        return true;
    }
    let output = std::process::Command::new("dbus-send")
        .args(["--session", "--print-reply", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", "string:org.kde.StatusNotifierWatcher"])
        .output();
    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).contains("boolean true"),
        // Without dbus-send there is no telling; assume the common case.
        _ => true,
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(err) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[bee-desktop] notification failed: {err}");
    }
}

/// Raises a notification for each new problem that needs the person.
fn raise_alerts(app: &AppHandle, shared: &Shared, snapshot: &Snapshot) {
    let stopped_for = {
        let mut since = shared.stopped_since.lock().unwrap();
        if snapshot.service == ServiceState::Stopped {
            Some(since.get_or_insert_with(Instant::now).elapsed())
        } else {
            *since = None;
            None
        }
    };
    let settings = shared.settings.lock().unwrap().clone();
    if !settings.notify {
        return;
    }
    let found = alerts::alerts(snapshot, stopped_for);
    if found.is_empty() {
        return;
    }
    let language = settings.resolved_language();
    let explanations = shared.explanations.lock().unwrap().clone();
    let mut history = shared.history.lock().unwrap();
    let Some(history) = history.as_mut() else { return };
    for alert in found {
        if history.admit(&alert) {
            let (title, body) = alerts::message(&alert, &explanations, language);
            eprintln!("[bee-desktop] notify {}: {title}", alert.key);
            notify(app, &title, &body);
        }
    }
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
    if overview.is_some() && shared.explanations.lock().unwrap().is_empty() {
        if let Ok(catalog) = shared.service.control.get("/v1/explanations").await {
            let entries = catalog["explanations"].as_array().cloned().unwrap_or_default();
            let mut explanations = shared.explanations.lock().unwrap();
            for entry in entries {
                if let Some(code) = entry["code"].as_str() {
                    explanations.insert(code.to_string(), entry.clone());
                }
            }
        }
    }
    let language = shared.settings.lock().unwrap().resolved_language();
    let mut snapshot = Snapshot::in_language(service, overview, platforms, language);
    // No Bee answers, yet something holds the device configuration: an older
    // Bee that serves no control interface. The app's own Bee cannot start.
    if service == ServiceState::Stopped {
        snapshot.occupied = occupied::holder(&shared.service.config);
        if snapshot.occupied.is_some() {
            snapshot.summary = if language == "en" { "An older Bee is using the configuration".into() } else { "旧版 Bee 占用了配置".into() };
        }
    }
    raise_alerts(app, shared, &snapshot);
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

/// The tray's Quit. Quitting stops the app's own Bee and with it sharing, so
/// the window asks first; a Bee the app did not start keeps running, so the
/// app just quits.
fn request_quit(app: &AppHandle) {
    if app.state::<Arc<Shared>>().service.owns_bee() {
        show_main(app);
        let _ = app.emit("bee://quit-requested", ());
    } else {
        quit(app);
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

/// Starts the background service again now rather than after its backoff.
#[tauri::command]
fn retry_service(shared: tauri::State<'_, Arc<Shared>>) {
    shared.service.retry();
    shared.refresh.notify_one();
}

/// Restarts the Bee the app started, for a setting that applies at start (the
/// network proxy). False when the Bee is not the app's own.
#[tauri::command]
fn restart_service(shared: tauri::State<'_, Arc<Shared>>) -> bool {
    let restarted = shared.service.restart();
    shared.refresh.notify_one();
    restarted
}

#[derive(serde::Serialize)]
struct AppInfo {
    version: String,
    /// The device configuration, shown under technical information.
    config: String,
    /// Where Bee's log is kept, shown under technical information.
    logs: String,
}

#[tauri::command]
fn app_info(app: AppHandle, shared: tauri::State<'_, Arc<Shared>>) -> AppInfo {
    AppInfo { version: app.package_info().version.to_string(), config: shared.service.config.display().to_string(), logs: logs::dir().display().to_string() }
}

/// Shows the folder that holds Bee's log in the system's file manager.
#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), control::ControlError> {
    let dir = logs::dir();
    let failed = |err: String| control::ControlError { status: 500, code: "open_failed".into(), message: err };
    std::fs::create_dir_all(&dir).map_err(|err| failed(err.to_string()))?;
    app.opener().open_path(dir.display().to_string(), None::<&str>).map_err(|err| failed(err.to_string()))
}

/// Asks where to save Bee's diagnostic report and saves it there; None when
/// the person cancels. When Bee cannot be reached, the report says so and
/// carries what the app knows, so there is still something to send.
#[tauri::command]
async fn export_diagnostics(app: AppHandle, shared: tauri::State<'_, Arc<Shared>>) -> Result<Option<String>, control::ControlError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name("bee-diagnostics.json")
        .add_filter("JSON", &["json"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let Some(path) = rx.await.ok().flatten().and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let report = match shared.service.control.get("/v1/diagnostics").await {
        Ok(report) => report,
        Err(err) => serde_json::json!({
            "app_version": app.package_info().version.to_string(),
            "service": shared.service.state(),
            "config": shared.service.config.display().to_string(),
            "logs": logs::dir().display().to_string(),
            "error": { "code": err.code, "message": err.message },
        }),
    };
    let raw = serde_json::to_vec_pretty(&report).unwrap_or_default();
    std::fs::write(&path, raw).map_err(|err| control::ControlError { status: 500, code: "save_failed".into(), message: err.to_string() })?;
    Ok(Some(path.display().to_string()))
}

#[derive(serde::Serialize)]
struct SettingsView {
    #[serde(flatten)]
    settings: Settings,
    /// The language the window should show.
    resolved_language: &'static str,
    /// False when closing the window cannot keep Bee in a tray.
    tray_available: bool,
}

fn settings_view(shared: &Shared) -> SettingsView {
    let settings = shared.settings.lock().unwrap().clone();
    SettingsView { resolved_language: settings.resolved_language(), settings, tray_available: shared.tray_available }
}

fn save_settings(shared: &Shared, settings: &Settings) {
    if let Some(store) = shared.store.lock().unwrap().as_ref() {
        if let Err(err) = store.save(settings) {
            eprintln!("[bee-desktop] settings not saved: {err}");
        }
    }
}

#[tauri::command]
fn get_settings(shared: tauri::State<'_, Arc<Shared>>) -> SettingsView {
    settings_view(&shared)
}

/// Changes settings from the window and applies what they control.
#[tauri::command]
fn set_settings(app: AppHandle, shared: tauri::State<'_, Arc<Shared>>, change: SettingsChange) -> Result<SettingsView, String> {
    let updated = {
        let mut settings = shared.settings.lock().unwrap();
        settings.apply(&change)?;
        settings.clone()
    };
    if let Some(enabled) = change.autostart {
        let launcher = app.autolaunch();
        let result = if enabled { launcher.enable() } else { launcher.disable() };
        result.map_err(|err| format!("autostart: {err}"))?;
    }
    save_settings(&shared, &updated);
    if change.language.is_some() {
        // The tray's words follow the language: the fixed items now, the
        // summary with the next read, which this asks for.
        if let Some((open, quit)) = shared.menu_items.lock().unwrap().as_ref() {
            let words = menu_words(updated.resolved_language());
            let _ = open.set_text(words.open);
            let _ = quit.set_text(words.quit);
        }
        shared.refresh.notify_one();
    }
    Ok(settings_view(&shared))
}

struct MenuWords {
    starting: &'static str,
    open: &'static str,
    quit: &'static str,
}

fn menu_words(language: &str) -> MenuWords {
    if language == "en" {
        MenuWords { starting: "Starting the background service…", open: "Open Bee", quit: "Quit" }
    } else {
        MenuWords { starting: "正在启动后台服务…", open: "打开 Bee", quit: "退出" }
    }
}

/// Closing the window: keep Bee in the tray, minimise where there is no tray,
/// or quit when the person chose not to keep it.
fn close_window(window: &tauri::Window) {
    let app = window.app_handle();
    let shared = app.state::<Arc<Shared>>().inner().clone();
    if !shared.tray_available {
        let _ = window.minimize();
        return;
    }
    let mut settings = shared.settings.lock().unwrap().clone();
    if !settings.keep_in_tray {
        quit(app);
        return;
    }
    let _ = window.hide();
    if !settings.close_hint_shown {
        settings.close_hint_shown = true;
        *shared.settings.lock().unwrap() = settings.clone();
        save_settings(&shared, &settings);
        let (title, body) = if settings.resolved_language() == "zh" {
            ("Bee 仍在后台共享", if cfg!(target_os = "macos") { "可以在菜单栏的 Bee 图标里退出。" } else { "可以在托盘的 Bee 图标里退出。" })
        } else {
            ("Bee is still sharing", if cfg!(target_os = "macos") { "Quit from the Bee icon in the menu bar." } else { "Quit from the Bee icon in the system tray." })
        };
        notify(app, title, body);
    }
}

fn main() {
    let attach_only = std::env::var_os("BEE_DESKTOP_ATTACH_ONLY").is_some();
    let service = Arc::new(Service::new(config_path(), bee_path(), attach_only).with_log_dir(logs::dir()));
    eprintln!("[bee-desktop] config {} socket {}", service.config.display(), service.control.socket().display());
    let shared = Arc::new(Shared {
        snapshot: Mutex::new(Snapshot::new(ServiceState::Starting, None, BTreeMap::new())),
        service,
        refresh: Notify::new(),
        status_item: Mutex::new(None),
        menu_items: Mutex::new(None),
        settings: Mutex::new(Settings::default()),
        store: Mutex::new(None),
        history: Mutex::new(None),
        explanations: Mutex::new(BTreeMap::new()),
        stopped_since: Mutex::new(None),
        tray_available: tray_available(),
    });
    let background = std::env::args().any(|arg| arg == BACKGROUND_ARG);

    let app = tauri::Builder::default()
        // Opening the app again shows the window of the one already running.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![BACKGROUND_ARG])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![get_state, bee_request, quit_app, get_settings, set_settings, retry_service, restart_service, app_info, open_logs, export_diagnostics])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                close_window(window);
            }
        })
        .setup(move |app| {
            // BEE_DESKTOP_DATA keeps a development run's settings out of the
            // installed app's.
            let dir = match std::env::var_os("BEE_DESKTOP_DATA") {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_config_dir()?,
            };
            let store = Store::new(&dir);
            let first_run = store.load().is_none();
            let settings = store.load().unwrap_or_default();
            if first_run {
                let _ = store.save(&settings);
                // A release turns on start at login the first time it runs.
                // Development builds leave the person's login items alone.
                if cfg!(not(debug_assertions)) && settings.autostart {
                    if let Err(err) = app.autolaunch().enable() {
                        eprintln!("[bee-desktop] autostart not enabled: {err}");
                    }
                }
            }
            eprintln!("[bee-desktop] settings {} (first run: {first_run}, tray: {})", dir.display(), shared.tray_available);
            *shared.settings.lock().unwrap() = settings;
            *shared.store.lock().unwrap() = Some(store);
            *shared.history.lock().unwrap() = Some(alerts::History::load(&dir));
            if background {
                eprintln!("[bee-desktop] started in the background");
            } else {
                show_main(app.handle());
            }
            let words = menu_words(shared.settings.lock().unwrap().resolved_language());
            let status = MenuItem::with_id(app, "status", words.starting, false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", words.open, true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "quit", words.quit, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &open, &exit])?;
            *shared.status_item.lock().unwrap() = Some(status);
            *shared.menu_items.lock().unwrap() = Some((open.clone(), exit.clone()));
            TrayIconBuilder::with_id("main")
                .icon(tray_icon(TrayState::Off))
                .icon_as_template(true)
                .tooltip("Bee")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => request_quit(app),
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
        // Whatever way the app ends, its own Bee goes with it. Quitting from
        // the app menu or the Dock reaches here without waiting for quit().
        RunEvent::Exit => app.state::<Arc<Shared>>().service.stop_blocking(),
        // macOS: clicking the Dock icon with no window shown reopens it.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows: false, .. } => show_main(app),
        _ => {}
    });
}
