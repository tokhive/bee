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
            Self::Zh => ("打开 Bee", "退出 Bee"),
            Self::En => ("Open Bee", "Quit Bee"),
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
    use tauri::menu::{Menu, MenuItem, Submenu};
    let (open_text, quit_text) = app
        .state::<Arc<NativeLanguage>>()
        .current()
        .map(NativeLocale::labels)
        .unwrap_or(("打开 Bee / Open Bee", "退出 Bee / Quit Bee"));
    let open = MenuItem::with_id(app, "bee-open", open_text, true, Some("CmdOrCtrl+O"))?;
    let quit = MenuItem::with_id(app, "bee-quit", quit_text, true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(app, "Bee", true, &[&open, &quit])?;
    app.set_menu(Menu::with_items(app, &[&app_menu])?)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "bee-open" => dispatch(app, WindowEvent::Menu(WindowIntent::Show)),
        "bee-quit" => dispatch(app, WindowEvent::Menu(WindowIntent::Quit)),
        _ => {}
    });
    let tray_menu = Menu::with_items(app, &[&open, &quit])?;
    app.manage(NativeMenu { open, quit });
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
    release_instance: impl FnOnce(),
) -> Result<(), crate::protocol::BridgeError> {
    let saved = bridge
        .prepare_owned_exit(crate::runtime::OwnedExitReason::AppExit)
        .await;
    // Even when persistence fails, hold singleton ownership until child reaping.
    bridge.stop().await?;
    release_instance();
    saved.map(|_| ())
}
