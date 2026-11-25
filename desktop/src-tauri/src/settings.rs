//! The app's own preferences, kept in settings.json in the app's config
//! directory. They hold no credential; Bee keeps its own configuration.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Start Bee when the person logs in, without showing the window.
    pub autostart: bool,
    /// Closing the window keeps Bee in the tray; off, closing quits.
    pub keep_in_tray: bool,
    /// Tell the person when something needs them.
    pub notify: bool,
    /// "system", "zh" or "en".
    pub language: String,
    /// The one-time "still sharing from the tray" hint has been shown.
    pub close_hint_shown: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { autostart: true, keep_in_tray: true, notify: true, language: "system".into(), close_hint_shown: false }
    }
}

/// A change from the window; fields left out keep their value.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct SettingsChange {
    pub autostart: Option<bool>,
    pub keep_in_tray: Option<bool>,
    pub notify: Option<bool>,
    pub language: Option<String>,
}

impl Settings {
    pub fn apply(&mut self, change: &SettingsChange) -> Result<(), String> {
        if let Some(language) = &change.language {
            if !["system", "zh", "en"].contains(&language.as_str()) {
                return Err(format!("unknown language {language:?}"));
            }
            self.language = language.clone();
        }
        if let Some(v) = change.autostart {
            self.autostart = v;
        }
        if let Some(v) = change.keep_in_tray {
            self.keep_in_tray = v;
        }
        if let Some(v) = change.notify {
            self.notify = v;
        }
        Ok(())
    }

    /// The language to show: the chosen one, or the system's when it is
    /// Chinese, and English otherwise.
    pub fn resolved_language(&self) -> &'static str {
        match self.language.as_str() {
            "zh" => "zh",
            "en" => "en",
            _ => {
                let locale = sys_locale::get_locale().unwrap_or_default().to_lowercase();
                if locale.starts_with("zh") {
                    "zh"
                } else {
                    "en"
                }
            }
        }
    }
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(dir: &Path) -> Self {
        Self { path: dir.join("settings.json") }
    }

    /// Reads the settings, or None when there are none yet (a first run).
    /// A damaged file reads as the defaults rather than stopping the app.
    pub fn load(&self) -> Option<Settings> {
        let raw = std::fs::read(&self.path).ok()?;
        Some(serde_json::from_slice(&raw).unwrap_or_default())
    }

    pub fn save(&self, settings: &Settings) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(settings)?)?;
        std::fs::rename(tmp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_take_defaults_and_changes_apply() {
        let settings: Settings = serde_json::from_str(r#"{"notify": false}"#).unwrap();
        assert!(!settings.notify && settings.autostart && settings.keep_in_tray && settings.language == "system");
        let mut changed = settings.clone();
        changed.apply(&SettingsChange { language: Some("en".into()), keep_in_tray: Some(false), ..Default::default() }).unwrap();
        assert!(changed.language == "en" && !changed.keep_in_tray && !changed.notify);
        assert!(changed.apply(&SettingsChange { language: Some("fr".into()), ..Default::default() }).is_err());
        assert_eq!(changed.resolved_language(), "en");
    }

    #[test]
    fn store_round_trips_and_survives_damage() {
        let dir = std::env::temp_dir().join(format!("bee-settings-{}", std::process::id()));
        let store = Store::new(&dir);
        assert!(store.load().is_none());
        let settings = Settings { notify: false, ..Default::default() };
        store.save(&settings).unwrap();
        assert_eq!(store.load(), Some(settings));
        std::fs::write(dir.join("settings.json"), "not json").unwrap();
        assert_eq!(store.load(), Some(Settings::default()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
