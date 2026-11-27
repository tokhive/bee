//! Updates of the app itself, through the Tauri updater. The app checks a
//! while after it starts and then every day; Settings checks on request.
//! Installing downloads the archive the release announced, which the updater
//! accepts only with a valid signature of the app's update key for that very
//! version, replaces the app with it and restarts the app.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

/// What the window shows under About.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UpdateState {
    /// Nothing checked yet.
    Idle,
    /// This build has no update key, as in development: nothing to check.
    Unconfigured,
    Checking,
    UpToDate,
    Available { version: String, notes: Option<String> },
    Downloading { version: String, downloaded: u64, total: Option<u64> },
    /// The new version is in place and the app is restarting into it.
    Restarting { version: String },
    /// `stage` is check, download or install; `version` is the update that
    /// failed to install, which can be tried again.
    Failed { stage: &'static str, message: String, version: Option<String> },
}

pub struct Updates {
    state: Mutex<UpdateState>,
    pending: Mutex<Option<Update>>,
    /// One check or install at a time.
    busy: tokio::sync::Mutex<()>,
}

/// The file that tells the app restarted by an update to show its window,
/// even when the app it replaced was started at login without one.
const SHOW_AFTER_UPDATE: &str = "show-after-update";

/// How long the app waits after starting before it checks, and between checks.
pub const FIRST_CHECK: Duration = Duration::from_secs(30);
pub const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

impl Updates {
    pub fn new() -> Self {
        Self { state: Mutex::new(UpdateState::Idle), pending: Mutex::new(None), busy: tokio::sync::Mutex::new(()) }
    }

    pub fn state(&self) -> UpdateState {
        self.state.lock().unwrap().clone()
    }

    fn set(&self, app: &AppHandle, state: UpdateState) {
        *self.state.lock().unwrap() = state.clone();
        let _ = app.emit("bee://update", &state);
    }

    /// Asks the update endpoint whether there is a newer version. A check the
    /// person asked for reports a failure; a background check only logs it
    /// and leaves what the window shows alone.
    pub async fn check(&self, app: &AppHandle, asked: bool) -> UpdateState {
        let Ok(_busy) = self.busy.try_lock() else { return self.state() };
        if !configured(app) {
            self.set(app, UpdateState::Unconfigured);
            return self.state();
        }
        if asked {
            self.set(app, UpdateState::Checking);
        }
        let result = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(err) => Err(err),
        };
        match result {
            Ok(Some(update)) => {
                eprintln!("[bee-desktop] update {} available", update.version);
                let state = UpdateState::Available { version: update.version.clone(), notes: update.body.clone().filter(|n| !n.trim().is_empty()) };
                *self.pending.lock().unwrap() = Some(update);
                self.set(app, state);
            }
            Ok(None) => {
                *self.pending.lock().unwrap() = None;
                self.set(app, UpdateState::UpToDate);
            }
            Err(err) => {
                eprintln!("[bee-desktop] update check failed: {err}");
                if asked {
                    self.set(app, UpdateState::Failed { stage: "check", message: err.to_string(), version: None });
                }
            }
        }
        self.state()
    }

    /// Downloads and installs the update found by the last check. Ok means
    /// the new version is in place and the app should restart.
    pub async fn install(&self, app: &AppHandle) -> Result<String, String> {
        let Ok(_busy) = self.busy.try_lock() else { return Err("an update check or install is already running".into()) };
        let Some(update) = self.pending.lock().unwrap().clone() else { return Err("no update to install; check again".into()) };
        let version = update.version.clone();
        self.set(app, UpdateState::Downloading { version: version.clone(), downloaded: 0, total: None });
        let mut downloaded = 0u64;
        let mut shown = Instant::now();
        let progress = |chunk: usize, total: Option<u64>| {
            downloaded += chunk as u64;
            // A few updates a second are enough for a progress bar.
            if shown.elapsed() >= Duration::from_millis(150) || total == Some(downloaded) {
                shown = Instant::now();
                self.set(app, UpdateState::Downloading { version: version.clone(), downloaded, total });
            }
        };
        let bytes = match update.download(progress, || {}).await {
            Ok(bytes) => bytes,
            Err(err) => {
                eprintln!("[bee-desktop] update download failed: {err}");
                self.set(app, UpdateState::Failed { stage: "download", message: err.to_string(), version: Some(version.clone()) });
                return Err(err.to_string());
            }
        };
        if let Err(err) = update.install(bytes) {
            eprintln!("[bee-desktop] update install failed: {err}");
            self.set(app, UpdateState::Failed { stage: "install", message: err.to_string(), version: Some(version.clone()) });
            return Err(err.to_string());
        }
        eprintln!("[bee-desktop] update {version} installed, restarting");
        self.set(app, UpdateState::Restarting { version: version.clone() });
        Ok(version)
    }
}

/// Whether this build carries an update key. Development builds do not.
fn configured(app: &AppHandle) -> bool {
    app.config().plugins.0.get("updater").and_then(|updater| updater.get("pubkey")).and_then(|key| key.as_str()).is_some_and(|key| !key.trim().is_empty())
}

pub fn mark_show_after_update(dir: &Path) {
    if let Err(err) = std::fs::write(dir.join(SHOW_AFTER_UPDATE), b"") {
        eprintln!("[bee-desktop] cannot note the restart after the update: {err}");
    }
}

/// True once after an update restarted the app; the note is removed.
pub fn take_show_after_update(dir: &Path) -> bool {
    let path: PathBuf = dir.join(SHOW_AFTER_UPDATE);
    std::fs::remove_file(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_after_update_is_taken_once() {
        let dir = std::env::temp_dir().join(format!("bee-updates-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!take_show_after_update(&dir));
        mark_show_after_update(&dir);
        assert!(take_show_after_update(&dir));
        assert!(!take_show_after_update(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn states_serialise_with_a_tag() {
        let state = UpdateState::Downloading { version: "1.2.3".into(), downloaded: 5, total: Some(10) };
        assert_eq!(serde_json::to_value(&state).unwrap(), serde_json::json!({ "state": "downloading", "version": "1.2.3", "downloaded": 5, "total": 10 }));
        assert_eq!(serde_json::to_value(UpdateState::UpToDate).unwrap(), serde_json::json!({ "state": "up_to_date" }));
    }
}
