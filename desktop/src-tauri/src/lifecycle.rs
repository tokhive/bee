//! Desktop window decisions; native adapters are deliberately kept outside the policy.
use crate::preferences::{Language, PreferencesSnapshot};
use crate::protocol::BridgeError;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeLocale {
    Zh,
    En,
}
impl NativeLocale {
    fn labels(self) -> (&'static str, &'static str) {
        match self {
            Self::Zh => ("打开 Bee", "退出 Bee（可能中断任务）"),
            Self::En => ("Open Bee", "Quit Bee (may interrupt tasks)"),
        }
    }
}

struct EditMenuLabels {
    title: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
}
impl EditMenuLabels {
    fn for_locale(locale: Option<NativeLocale>) -> Self {
        match locale {
            Some(NativeLocale::Zh) => Self {
                title: "编辑",
                undo: "撤销",
                redo: "重做",
                cut: "剪切",
                copy: "复制",
                paste: "粘贴",
                select_all: "全选",
            },
            Some(NativeLocale::En) => Self {
                title: "Edit",
                undo: "Undo",
                redo: "Redo",
                cut: "Cut",
                copy: "Copy",
                paste: "Paste",
                select_all: "Select All",
            },
            None => Self {
                title: "编辑 / Edit",
                undo: "撤销 / Undo",
                redo: "重做 / Redo",
                cut: "剪切 / Cut",
                copy: "复制 / Copy",
                paste: "粘贴 / Paste",
                select_all: "全选 / Select All",
            },
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocaleRequest {
    pub locale: NativeLocale,
    pub revision: u64,
    pub sequence: u64,
}
#[derive(Default)]
struct LocaleRecord {
    locale: Option<NativeLocale>,
    revision: u64,
    sequence: u64,
}
#[derive(Default)]
pub struct NativeLanguage(Mutex<LocaleRecord>);
impl NativeLanguage {
    pub fn initialize(preferences: &PreferencesSnapshot) -> Self {
        let locale = if preferences.error.is_some() {
            None
        } else {
            match preferences.preferences.language {
                Language::Zh => Some(NativeLocale::Zh),
                Language::En => Some(NativeLocale::En),
                Language::System => None,
            }
        };
        Self(Mutex::new(LocaleRecord {
            locale,
            revision: preferences.preferences.revision,
            sequence: 0,
        }))
    }
    pub fn current(&self) -> Option<NativeLocale> {
        self.0.lock().ok().and_then(|state| state.locale)
    }
    fn synchronize(
        &self,
        request: LocaleRequest,
        preferences: &PreferencesSnapshot,
        apply: impl FnOnce(NativeLocale) -> Result<(), BridgeError>,
    ) -> Result<(), BridgeError> {
        let mut state = self.0.lock().map_err(|_| {
            BridgeError::new(
                "NATIVE_LOCALE_LOCK",
                "native language mutex poisoned; current metadata not changed".into(),
            )
        })?;
        if let Some(cause) = &preferences.error {
            return Err(BridgeError::new(
                "NATIVE_LOCALE_PREFERENCES",
                format!(
                    "native language preferences read failed: {}: {}; revision={}",
                    cause.code, cause.message, preferences.preferences.revision
                ),
            ));
        }
        if request.revision != preferences.preferences.revision
            || request.revision < state.revision
            || request.sequence <= state.sequence
            || request.sequence > 9_007_199_254_740_991
        {
            return Err(BridgeError::new("NATIVE_LOCALE_STALE",format!("native language metadata rejected: revision={} sequence={}; required=saved revision {}, at least accepted revision {}, sequence>{}",request.revision,request.sequence,preferences.preferences.revision,state.revision,state.sequence)));
        }
        let expected = match preferences.preferences.language {
            Language::Zh => Some(NativeLocale::Zh),
            Language::En => Some(NativeLocale::En),
            Language::System => None,
        };
        if expected.is_some_and(|locale| locale != request.locale) {
            return Err(BridgeError::new(
                "NATIVE_LOCALE_MISMATCH",
                format!(
                    "native language actual={:?}; required=saved preference {:?} at revision={}",
                    request.locale, preferences.preferences.language, request.revision
                ),
            ));
        }
        // Reserve sequence even on menu failure: a delayed older System event must
        // never overwrite this newer request. An explicit retry has a new sequence.
        state.sequence = request.sequence;
        state.revision = request.revision;
        apply(request.locale)?;
        state.locale = Some(request.locale);
        Ok(())
    }
}
struct NativeMenu {
    open: tauri::menu::MenuItem<tauri::Wry>,
    quit: tauri::menu::MenuItem<tauri::Wry>,
    edit: tauri::menu::Submenu<tauri::Wry>,
    undo: tauri::menu::PredefinedMenuItem<tauri::Wry>,
    redo: tauri::menu::PredefinedMenuItem<tauri::Wry>,
    cut: tauri::menu::PredefinedMenuItem<tauri::Wry>,
    copy: tauri::menu::PredefinedMenuItem<tauri::Wry>,
    paste: tauri::menu::PredefinedMenuItem<tauri::Wry>,
    select_all: tauri::menu::PredefinedMenuItem<tauri::Wry>,
}
#[tauri::command]
pub fn native_locale_sync(
    app: tauri::AppHandle,
    request: LocaleRequest,
) -> Result<(), BridgeError> {
    let preferences = app.state::<crate::preferences::PreferencesStore>().read();
    app.state::<Arc<NativeLanguage>>()
        .synchronize(request, &preferences, |locale| {
            let menu = app.state::<NativeMenu>();
            let (open, quit) = locale.labels();
            for (id, item, text) in [
                ("bee-open", &menu.open, open),
                ("bee-quit", &menu.quit, quit),
            ] {
                item.set_text(text).map_err(|cause| {
                    BridgeError::new(
                        "NATIVE_LOCALE_MENU_FAILED",
                        format!("native menu set_text failed: item={id}; actual={cause}"),
                    )
                })?;
            }
            let labels = EditMenuLabels::for_locale(Some(locale));
            menu.edit.set_text(labels.title).map_err(|cause| {
                BridgeError::new(
                    "NATIVE_LOCALE_MENU_FAILED",
                    format!("native menu set_text failed: item=bee-edit; actual={cause}"),
                )
            })?;
            for (id, item, text) in [
                ("undo", &menu.undo, labels.undo),
                ("redo", &menu.redo, labels.redo),
                ("cut", &menu.cut, labels.cut),
                ("copy", &menu.copy, labels.copy),
                ("paste", &menu.paste, labels.paste),
                ("select-all", &menu.select_all, labels.select_all),
            ] {
                item.set_text(text).map_err(|cause| {
                    BridgeError::new(
                        "NATIVE_LOCALE_MENU_FAILED",
                        format!("native menu set_text failed: item={id}; actual={cause}"),
                    )
                })?;
            }
            Ok(())
        })
}

pub const CALLBACK_SCHEME: &str = "tokhive-bee-dev";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowIntent {
    Show,
    Hide,
    Quit,
}

#[derive(Clone, Copy, Debug)]
pub enum WindowEvent {
    CloseRequested,
    SecondLaunch,
    Reopen,
    Menu(WindowIntent),
}

pub fn intent_for(event: WindowEvent) -> WindowIntent {
    match event {
        WindowEvent::CloseRequested => WindowIntent::Hide,
        WindowEvent::SecondLaunch | WindowEvent::Reopen => WindowIntent::Show,
        WindowEvent::Menu(intent) => intent,
    }
}

#[derive(Default)]
pub struct LoginReceipt(AtomicBool);

impl LoginReceipt {
    pub fn receive(&self, url: &str) -> bool {
        let accepted = url.split_once(':').is_some_and(|(scheme, rest)| {
            scheme.eq_ignore_ascii_case(CALLBACK_SCHEME) && !rest.is_empty()
        });
        if accepted {
            self.0.store(true, Ordering::Release);
        }
        accepted
    }

    pub fn received(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;

use tauri::{Emitter, Manager};

#[tauri::command]
pub fn login_return_received(receipt: tauri::State<'_, LoginReceipt>) -> bool {
    receipt.received()
}

pub fn deliver_callback(app: &tauri::AppHandle, url: &str) {
    if app.state::<LoginReceipt>().receive(url) {
        if let Err(cause) = app.emit_to("main", "bee://login-return", true) {
            eprintln!("deliver Bee login-return boolean receipt to main window: {cause}");
        }
        dispatch(app, WindowEvent::Reopen);
    }
}

pub fn dispatch(app: &tauri::AppHandle, event: WindowEvent) {
    let intent = intent_for(event);
    if let Err(cause) = apply(app, intent) {
        eprintln!("apply Bee main window intent={intent:?}: {cause}");
    }
}

fn apply(app: &tauri::AppHandle, intent: WindowIntent) -> tauri::Result<()> {
    if intent == WindowIntent::Quit {
        // RunEvent::Exit performs the existing owned Child stop-and-reap path.
        app.exit(0);
        return Ok(());
    }
    // A second launch can arrive while setup is still creating the main window.
    // That window is initially visible; receipt state is already managed above setup.
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    match intent {
        WindowIntent::Show => {
            window.show()?;
            window.unminimize()?;
            window.set_focus()?;
        }
        WindowIntent::Hide => window.hide()?,
        WindowIntent::Quit => unreachable!(),
    }
    Ok(())
}

pub fn background_should_hide(background: bool, tray_available: bool) -> bool {
    background && tray_available
}

pub fn install_menu_and_tray(app: &mut tauri::App) -> tauri::Result<bool> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let locale = app.state::<Arc<NativeLanguage>>().current();
    let (open_text, quit_text) = locale
        .map(NativeLocale::labels)
        .unwrap_or(("打开 Bee / Open Bee", "退出 Bee（可能中断任务）/ Quit Bee (may interrupt tasks)"));
    let open = MenuItem::with_id(app, "bee-open", open_text, true, Some("CmdOrCtrl+O"))?;
    let quit = MenuItem::with_id(app, "bee-quit", quit_text, true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(app, "Bee", true, &[&open, &quit])?;
    let labels = EditMenuLabels::for_locale(locale);
    // macOS routes WebView editing shortcuts through native predefined menu items.
    let undo = PredefinedMenuItem::undo(app, Some(labels.undo))?;
    let redo = PredefinedMenuItem::redo(app, Some(labels.redo))?;
    let cut = PredefinedMenuItem::cut(app, Some(labels.cut))?;
    let copy = PredefinedMenuItem::copy(app, Some(labels.copy))?;
    let paste = PredefinedMenuItem::paste(app, Some(labels.paste))?;
    let select_all = PredefinedMenuItem::select_all(app, Some(labels.select_all))?;
    let edit = Submenu::with_id_and_items(
        app,
        "bee-edit",
        labels.title,
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &cut,
            &copy,
            &paste,
            &select_all,
        ],
    )?;
    app.set_menu(Menu::with_items(app, &[&app_menu, &edit])?)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "bee-open" => dispatch(app, WindowEvent::Menu(WindowIntent::Show)),
        "bee-quit" => dispatch(app, WindowEvent::Menu(WindowIntent::Quit)),
        _ => {}
    });
    let tray_menu = Menu::with_items(app, &[&open, &quit])?;
    app.manage(NativeMenu {
        open,
        quit,
        edit,
        undo,
        redo,
        cut,
        copy,
        paste,
        select_all,
    });
    let mut tray = tauri::tray::TrayIconBuilder::with_id("bee")
        .tooltip("Bee")
        .menu(&tray_menu)
        .show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    // A desktop can have no notification area. Single-instance relaunch and the
    // macOS dock reopen remain available, so tray absence must not abort startup.
    if let Err(cause) = tray.build(app) {
        eprintln!(
            "create Bee tray icon failed; recover the window by launching Bee again: {cause}"
        );
        return Ok(false);
    }
    Ok(true)
}

pub async fn shutdown_owned(
    bridge: &crate::sidecar::Bridge,
    logs: Option<&crate::diagnostic_log::DiagnosticLogStore>,
    release_instance: impl FnOnce(),
) -> Result<(), crate::protocol::BridgeError> {
    let started = record_exit(
        logs,
        "owned_exit_started",
        "stop_receipt",
        false,
        false,
        None,
    );
    let saved = bridge
        .prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
        .await;
    // Even when persistence fails, hold singleton ownership until child reaping.
    let cleanup = bridge.stop().await;
    let stage = if cleanup.is_err() {
        "child_reap"
    } else if saved.is_err() {
        "stop_receipt"
    } else {
        "completed"
    };
    let recorded = record_exit(
        logs,
        if saved.is_ok() && cleanup.is_ok() {
            "owned_exit_completed"
        } else {
            "owned_exit_unconfirmed"
        },
        stage,
        saved.is_ok(),
        cleanup.is_ok(),
        cleanup.as_ref().err().or_else(|| saved.as_ref().err()),
    );
    // The next instance can write this same log directory. Finish our final
    // diagnostic replacement before releasing its single-writer ownership.
    if cleanup.is_ok() {
        release_instance();
    }
    let mut failures = Vec::new();
    for (stage, result) in [
        ("stop_receipt", saved.map(|_| ())),
        ("child_reap", cleanup),
        ("diagnostic_start", started),
        ("diagnostic_result", recorded),
    ] {
        if let Err(cause) = result {
            failures.push(format!("{stage}: {}: {}", cause.code, cause.message));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(BridgeError::new(
            "OWNED_EXIT_UNCONFIRMED",
            failures.join("; "),
        ))
    }
}

fn record_exit(
    logs: Option<&crate::diagnostic_log::DiagnosticLogStore>,
    code: &str,
    stage: &str,
    stop_confirmed: bool,
    child_reaped: bool,
    cause: Option<&BridgeError>,
) -> Result<(), BridgeError> {
    let Some(logs) = logs else {
        return Ok(());
    };
    let observed = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|cause| {
            BridgeError::new(
                "OWNED_EXIT_DIAGNOSTICS_UNCONFIRMED",
                format!("format owned exit observation timestamp: {cause}"),
            )
        })?;
    let mut evidence = serde_json::json!({"exit_reason":"app_exit","exit_stage":stage,"stop_confirmed":stop_confirmed.to_string(),"child_reaped":child_reaped.to_string()});
    if let Some(cause) = cause {
        evidence["exit_error_code"] =
            serde_json::json!(if crate::diagnostic_log::is_exit_error_code(&cause.code) {
                cause.code.as_str()
            } else {
                "unknown_failure"
            });
    }
    logs.record(serde_json::json!({"time":observed,"level":if code == "owned_exit_unconfirmed" { "error" } else { "info" },"module":"lifecycle","platform":null,"code":code,"evidence":evidence}))?;
    Ok(())
}
