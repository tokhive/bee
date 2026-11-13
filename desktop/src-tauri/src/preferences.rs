use crate::protocol::BridgeError;
#[cfg(windows)]
#[path = "private_file_windows.rs"]
mod private_file_windows;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
const MAX_FILE: u64 = 65536;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    System,
    Zh,
    En,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProxyPreference {
    pub origin: String,
    #[serde(deserialize_with = "required_nullable_scope")]
    pub device_scope: Option<String>,
    pub connect_proxy: String,
}
fn required_nullable_scope<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenaiSourcePreference {
    #[serde(deserialize_with = "required_nullable_scope")]
    pub directory: Option<String>,
    pub store: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesktopPreferences {
    pub version: u32,
    pub revision: u64,
    pub language: Language,
    pub theme: Theme,
    pub notifications_enabled: bool,
    pub autostart_desired: bool,
    pub proxies: Vec<ProxyPreference>,
    #[serde(default, deserialize_with = "optional_openai_source", skip_serializing_if = "Option::is_none")]
    pub openai_source: Option<OpenaiSourcePreference>,
}
fn optional_openai_source<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<OpenaiSourcePreference>, D::Error> {
    OpenaiSourcePreference::deserialize(deserializer).map(Some)
}
impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            language: Language::System,
            theme: Theme::System,
            notifications_enabled: false,
            autostart_desired: false,
            proxies: vec![],
            openai_source: None,
        }
    }
}
impl DesktopPreferences {
    pub fn proxy_for(&self, origin: &str, scope: Option<&str>) -> &str {
        self.proxies
            .iter()
            .find(|p| p.origin == origin && p.device_scope.as_deref() == scope)
            .map(|p| p.connect_proxy.as_str())
            .unwrap_or("")
    }
    fn validate(&self) -> Result<(), BridgeError> {
        if self.version != 1 {
            return Err(failure(
                "PREFERENCES_VERSION",
                format!(
                    "preferences version actual={} supported=1; original preserved",
                    self.version
                ),
            ));
        }
        if self.revision > MAX_REVISION || self.proxies.len() > 128 {
            return Err(failure("PREFERENCES_SCHEMA",format!("preferences limits exceeded: revision={} proxies={}; required=safe revision, <=128 proxies",self.revision,self.proxies.len())));
        }
        if let Some(source) = &self.openai_source {
            if !["auto", "file", "keyring"].contains(&source.store.as_str()) {
                return Err(failure("PREFERENCES_SOURCE", "OpenAI source store is unsupported; required=auto/file/keyring"));
            }
            if let Some(directory) = &source.directory {
                if !Path::new(directory).is_absolute() || directory.len() > 4096 || directory.chars().any(char::is_control) {
                    return Err(failure("PREFERENCES_SOURCE", format!("OpenAI source directory rejected: absolute={} bytes={} contains_control={}; required=absolute directory of 1..4096 UTF-8 bytes without control characters", Path::new(directory).is_absolute(), directory.len(), directory.chars().any(char::is_control))));
                }
            }
        }
        let mut scopes = std::collections::HashSet::new();
        for proxy in &self.proxies {
            validate_origin(&proxy.origin)?;
            validate_proxy(&proxy.connect_proxy)?;
            if proxy.device_scope.as_ref().is_some_and(|s| {
                s.is_empty()
                    || s.len() > 256
                    || !s
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
            }) {
                return Err(failure(
                    "PREFERENCES_SCOPE",
                    "proxy device scope must be a bounded public identity or scope digest",
                ));
            }
            if !scopes.insert((&proxy.origin, &proxy.device_scope)) {
                return Err(failure(
                    "PREFERENCES_SCOPE",
                    "duplicate origin/device proxy scope; required=one setting per scope",
                ));
            }
        }
        Ok(())
    }
}
pub fn normalize_hive_origin(origin: &str) -> Result<String, BridgeError> {
    crate::hive_origin::normalize_hive_origin(origin)
}

pub fn validate_origin(origin: &str) -> Result<(), BridgeError> {
    let rejected = || {
        failure("PREFERENCES_ORIGIN","proxy origin must be a canonical HTTP(S) origin without path, query, fragment or credentials")
    };
    let url = tauri::Url::parse(origin).map_err(|_| rejected())?;
    let local = url.host_str() == Some("localhost")
        || url.host_str().is_some_and(|h| {
            h.trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
        });
    if !(url.scheme() == "https" || url.scheme() == "http" && local)
        || url.origin().ascii_serialization() != origin
        || url.host_str().is_none()
    {
        return Err(rejected());
    }
    Ok(())
}
pub fn validate_proxy(proxy: &str) -> Result<(), BridgeError> {
    if proxy.is_empty() {
        return Ok(());
    }
    let rejected = || {
        failure("PREFERENCES_PROXY","proxy rejected; required=unauthenticated http://explicit-loopback-IP:port (1..65535), no path, query or fragment")
    };
    let authority = proxy
        .strip_prefix("http://")
        .ok_or_else(rejected)?
        .strip_suffix('/')
        .unwrap_or(proxy.strip_prefix("http://").unwrap());
    let (host, port) = authority.rsplit_once(':').ok_or_else(rejected)?;
    let ip = host
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(host)
        .parse::<std::net::IpAddr>()
        .map_err(|_| rejected())?;
    if !ip.is_loopback()
        || port.is_empty()
        || !port.bytes().all(|b| b.is_ascii_digit())
        || port.parse::<u16>().ok().filter(|p| *p > 0).is_none()
    {
        return Err(rejected());
    }
    let url = tauri::Url::parse(proxy).map_err(|_| rejected())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(rejected());
    }
    Ok(())
}
fn failure(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError { details: None,
        code: code.into(),
        message: message.into(),
    }
}
fn io_failure(stage: &str, cause: &std::io::Error) -> BridgeError {
    failure(
        "PREFERENCES_IO",
        format!(
            "{stage} failed: {cause}; kind={:?} os_code={:?}",
            cause.kind(),
            cause.raw_os_error()
        ),
    )
}
#[derive(Clone, Debug, Serialize)]
pub struct PreferencesSnapshot {
    pub preferences: DesktopPreferences,
    pub error: Option<crate::protocol::BridgeError>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavePreferencesRequest {
    pub expected_revision: u64,
    pub preferences: DesktopPreferences,
}
pub struct PreferencesStore {
    path: PathBuf,
    last: Mutex<DesktopPreferences>,
}
impl PreferencesStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            last: Mutex::new(DesktopPreferences::default()),
        }
    }
    fn load(&self) -> Result<DesktopPreferences, BridgeError> {
        let raw = match protected_read(&self.path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(DesktopPreferences::default())
            }
            Err(e) => return Err(io_failure("read protected preferences", &e)),
        };
        let prefs:DesktopPreferences=serde_json::from_slice(&raw).map_err(|e|failure("PREFERENCES_SCHEMA",format!("preferences JSON schema rejected at line={} column={}; required=version 1 fields with no duplicates or unknown fields",e.line(),e.column())))?;
        prefs.validate()?;
        Ok(prefs)
    }
    pub fn read(&self) -> PreferencesSnapshot {
        let mut last = self.last.lock().unwrap_or_else(|p| p.into_inner());
        match self.load() {
            Ok(prefs) => {
                *last = prefs.clone();
                PreferencesSnapshot {
                    preferences: prefs,
                    error: None,
                }
            }
            Err(e) => PreferencesSnapshot {
                preferences: last.clone(),
                error: Some(e),
            },
        }
    }
    pub fn save(&self, expected: u64, mut preferences: DesktopPreferences) -> PreferencesSnapshot {
        let mut last = self.last.lock().unwrap_or_else(|p| p.into_inner());
        let result = (|| {
            let current = self.load()?;
            *last = current.clone();
            if current.revision != expected {
                return Err(failure(
                    "PREFERENCES_REVISION_CONFLICT",
                    format!(
                        "preferences revision actual={} required={expected}; refresh before saving",
                        current.revision
                    ),
                ));
            }
            preferences.validate()?;
            if preferences.revision != expected || expected >= MAX_REVISION {
                return Err(failure("PREFERENCES_REVISION_CONFLICT",format!("save revision actual={} expected={expected}; required=current revision below safe integer limit",preferences.revision)));
            }
            preferences.revision = expected + 1;
            let raw = serde_json::to_vec(&preferences)
                .map_err(|_| failure("PREFERENCES_SCHEMA", "preferences encoding failed"))?;
            if raw.len() > MAX_FILE as usize {
                return Err(failure(
                    "PREFERENCES_SCHEMA",
                    format!("preferences bytes={} limit={MAX_FILE}", raw.len()),
                ));
            }
            let original = match protected_read(&self.path) {
                Ok(raw) => Some(raw),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(e) => return Err(io_failure("read preferences before replace", &e)),
            };
            if let Some(original) = original.as_ref() {
                let backup = self.path.with_extension("json.v1.bak");
                match protected_read(&backup) {
                    Ok(_) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        private_write(&backup, original)
                            .map_err(|e| io_failure("backup preferences before replace", &e))?
                    }
                    Err(e) => return Err(io_failure("validate preferences backup", &e)),
                }
            }
            let committed = (|| {
                private_write(&self.path, &raw)
                    .map_err(|e| io_failure("atomic replace preferences", &e))?;
                let readback = self.load()?;
                if readback != preferences {
                    return Err(failure(
                        "PREFERENCES_UNCONFIRMED",
                        "preferences readback differs from requested revision; save unconfirmed",
                    ));
                }
                Ok(readback)
            })();
            if let Err(mut error) = committed {
                let unchanged = match (&original, protected_read(&self.path)) {
                    (Some(old), Ok(now)) => *old == now,
                    (None, Err(e)) => e.kind() == std::io::ErrorKind::NotFound,
                    _ => false,
                };
                if !unchanged {
                    let restored = match original.as_ref() {
                        Some(old) => private_write(&self.path, old),
                        None => fs::remove_file(&self.path),
                    };
                    match restored {
                        Ok(()) => error.message.push_str("; previous bytes restored; save failed"),
                        Err(e) => error.message.push_str(&format!(
                            "; rollback unconfirmed: kind={:?} os_code={:?}; reread to confirm persisted state",
                            e.kind(), e.raw_os_error()
                        )),
                    }
                } else {
                    error.message.push_str("; previous bytes preserved");
                }
                return Err(error);
            }
            Ok(preferences.clone())
        })();
        match result {
            Ok(prefs) => {
                *last = prefs.clone();
                PreferencesSnapshot {
                    preferences: prefs,
                    error: None,
                }
            }
            Err(e) => PreferencesSnapshot {
                preferences: last.clone(),
                error: Some(e),
            },
        }
    }
    // Called only after a trusted device_status has verified the new pairing.
    pub fn bind_draft(&self, expected: u64, origin: &str, scope: &str) -> PreferencesSnapshot {
        let snapshot = self.read();
        if snapshot.error.is_some() {
            return snapshot;
        }
        let mut prefs = snapshot.preferences;
        if let Some(draft) = prefs
            .proxies
            .iter()
            .position(|p| p.origin == origin && p.device_scope.is_none())
        {
            if prefs
                .proxies
                .iter()
                .any(|p| p.origin == origin && p.device_scope.as_deref() == Some(scope))
            {
                prefs.proxies.remove(draft);
            } else {
                prefs.proxies[draft].device_scope = Some(scope.into());
            }
            self.save(expected, prefs)
        } else {
            PreferencesSnapshot {
                preferences: prefs,
                error: None,
            }
        }
    }
}
fn protected_read(path: &Path) -> std::io::Result<Vec<u8>> {
    protected_read_bounded(path, MAX_FILE)
}
pub(crate) fn protected_read_bounded(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(not(windows))]
    let file = options.open(path)?;
    #[cfg(windows)]
    let file = private_file_windows::protected_open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "preferences must be a bounded regular file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o777 != 0o600
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.nlink() != 1
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "preferences must have current-user ownership, one link and mode 0600",
            ));
        }
    }
    let mut raw = Vec::new();
    file.take(limit + 1).read_to_end(&mut raw)?;
    if raw.len() > limit as usize {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("protected file bytes={} limit={limit}", raw.len()),
        ));
    }
    Ok(raw)
}
pub(crate) fn private_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "preferences parent missing",
        )
    })?;
    if !parent.exists() {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(parent)?;
    }
    // Acquire and validate the directory before any rename can commit bytes.
    #[cfg(unix)]
    let directory = fs::File::open(parent)?;
    #[cfg(unix)]
    directory.sync_all()?;
    let temp = parent.join(format!(
        ".desktop-preferences-{}-{}.tmp",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        #[cfg(not(windows))]
        let mut file = options.open(&temp)?;
        #[cfg(windows)]
        let mut file = private_file_windows::create_private(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        #[cfg(not(windows))]
        fs::rename(&temp, path)?;
        #[cfg(windows)]
        private_file_windows::replace(&temp, path)?;
        #[cfg(unix)]
        directory.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
#[cfg(test)]
#[path = "preferences_tests.rs"]
mod tests;

#[cfg(test)]
mod openai_source_tests {
    use super::*;
    #[test]
    fn source_preferences_migrate_and_survive_protected_readback() {
        let dir = tempfile::tempdir().unwrap();
        let store = PreferencesStore::new(dir.path().join("preferences.json"));
        let before = store.read();
        assert!(before.error.is_none()); assert!(before.preferences.openai_source.is_none());
        let mut prefs = before.preferences;
        prefs.openai_source = Some(OpenaiSourcePreference {directory: Some(dir.path().join("controlled-codex").to_string_lossy().into_owned()), store:"file".into()});
        let saved = store.save(0, prefs.clone()); assert!(saved.error.is_none());
        let reopened = PreferencesStore::new(dir.path().join("preferences.json")).read();
        assert!(reopened.error.is_none()); assert_eq!(reopened.preferences.openai_source, prefs.openai_source);
        let mut bad = reopened.preferences.clone(); bad.openai_source.as_mut().unwrap().store="secret".into();
        assert!(store.save(1, bad).error.is_some()); assert_eq!(store.read().preferences, reopened.preferences);
        let mut bad = reopened.preferences.clone(); bad.openai_source.as_mut().unwrap().directory=Some("relative-directory".into());
        assert!(store.save(1, bad).error.is_some()); assert_eq!(store.read().preferences, reopened.preferences);
        let mut raw=serde_json::to_value(DesktopPreferences::default()).unwrap(); raw["openai_source"]=serde_json::Value::Null;
        assert!(serde_json::from_value::<DesktopPreferences>(raw).is_err());
    }
}
