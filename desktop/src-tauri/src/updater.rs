//! Fixed-source updates. No installer, URL, or executable is supplied by the WebView.
use crate::protocol::BridgeError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterBuilder, UpdaterExt};

pub const MAX_UPDATE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
const MAX_STATE_BYTES: u64 = 16 * 1024;
pub(crate) fn error(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError { details: None,
        code: code.into(),
        message: message.into(),
    }
}
pub(crate) fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}
pub fn init_tls() -> Result<(), BridgeError> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _already_installed = rustls::crypto::ring::default_provider().install_default();
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            return Err(error(
                "UPDATE_TLS_UNAVAILABLE",
                "rustls process crypto provider missing after ring initialization",
            ));
        }
    }
    Ok(())
}
fn timestamp(seconds: i64) -> Result<String, BridgeError> {
    let date = time::OffsetDateTime::from_unix_timestamp(seconds).map_err(|e| {
        error(
            "UPDATE_TIME_INVALID",
            format!("update timestamp seconds={seconds}: {e}"),
        )
    })?;
    date.format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| {
            error(
                "UPDATE_TIME_INVALID",
                format!("format update timestamp seconds={seconds}: {e}"),
            )
        })
}

#[derive(Clone, Debug)]
pub struct ReleasePolicy {
    pub version: String,
    pub channel: String,
    pub endpoint: tauri::Url,
    pub public_key: String,
    pub target: String,
    pub platform: String,
    repository: String,
    suffix: &'static str,
}
impl ReleasePolicy {
    pub fn new(
        version: &str,
        channel: &str,
        endpoint: &str,
        key: &str,
        target: &str,
    ) -> Result<Self, BridgeError> {
        semver::Version::parse(version).map_err(|e| {
            error(
                "UPDATE_VERSION_INVALID",
                format!("App version={version}; required=SemVer: {e}"),
            )
        })?;
        if channel.is_empty()
            || channel.len() > 32
            || !channel
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(error("UPDATE_CHANNEL_INVALID",format!("release channel bytes={}; required=1..32 lowercase ASCII letters/digits/hyphen",channel.len())));
        }
        if key.is_empty() {
            return Err(error(
                "UPDATE_NOT_CONFIGURED",
                "updater public key missing from build; required=BEE_UPDATER_PUBLIC_KEY",
            ));
        }
        let url = tauri::Url::parse(endpoint).map_err(|e| {
            error(
                "UPDATE_ENDPOINT_INVALID",
                format!("update endpoint URL parse failed: {e}"),
            )
        })?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(error("UPDATE_ENDPOINT_INVALID",format!("update endpoint transport/authority rejected: scheme={} host={:?} port={:?} credentials={} query={} fragment={}; required=HTTPS default port without credentials/query/fragment",url.scheme(),url.host_str(),url.port(),!url.username().is_empty()||url.password().is_some(),url.query().is_some(),url.fragment().is_some())));
        }
        let parts: Vec<_> = url.path().trim_start_matches('/').split('/').collect();
        let path_ok = parts.len() >= 5
            && parts[0..2].iter().all(|s| {
                !s.is_empty()
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            })
            && parts.last() == Some(&format!("{channel}.json").as_str());
        let source_ok = match url.host_str() {
            Some("github.com") => {
                parts.len() >= 6
                    && parts[2] == "releases"
                    && (parts[3] == "download" || (parts[3] == "latest" && parts[4] == "download"))
            }
            Some("raw.githubusercontent.com") => parts.len() >= 5,
            _ => false,
        };
        if !path_ok || !source_ok {
            return Err(error("UPDATE_ENDPOINT_INVALID",format!("update endpoint host={:?} path={}; required=pinned GitHub repository release/raw channel JSON",url.host_str(),url.path())));
        }
        let (platform, suffix) = match target {
            "aarch64-apple-darwin" => ("darwin-aarch64", ".app.tar.gz"),
            "x86_64-apple-darwin" => ("darwin-x86_64", ".app.tar.gz"),
            "x86_64-pc-windows-msvc" => ("windows-x86_64", ".exe"),
            "x86_64-unknown-linux-gnu" => ("linux-x86_64", ".AppImage"),
            "aarch64-unknown-linux-gnu" => ("linux-aarch64", ".AppImage"),
            _ => {
                return Err(error(
                    "UPDATE_TARGET_INVALID",
                    format!("update target={target}; required=approved native target"),
                ))
            }
        };
        Ok(Self {
            version: version.into(),
            channel: channel.into(),
            repository: format!("/{}/{}/releases/", parts[0], parts[1]),
            endpoint: url,
            public_key: key.into(),
            target: target.into(),
            platform: platform.into(),
            suffix,
        })
    }
    pub fn compiled() -> Result<Self, BridgeError> {
        Self::new(
            env!("CARGO_PKG_VERSION"),
            option_env!("BEE_RELEASE_CHANNEL").unwrap_or(""),
            option_env!("BEE_UPDATE_ENDPOINT").unwrap_or(""),
            option_env!("BEE_UPDATER_PUBLIC_KEY").unwrap_or(""),
            env!("BEE_TARGET"),
        )
    }
    pub fn allows_redirect(&self, url: &tauri::Url) -> bool {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && match url.host_str() {
                Some("github.com") => url.path().starts_with(&self.repository),
                Some("release-assets.githubusercontent.com") => true,
                Some("raw.githubusercontent.com") => {
                    url.origin() == self.endpoint.origin() && url.path() == self.endpoint.path()
                }
                _ => false,
            }
    }
    pub fn validate_manifest(&self, raw: &serde_json::Value) -> Result<AssetIdentity, BridgeError> {
        let version = raw["version"].as_str().ok_or_else(|| {
            error(
                "UPDATE_MANIFEST_INVALID",
                "manifest version missing; required=SemVer",
            )
        })?;
        let v = semver::Version::parse(version).map_err(|e| {
            error(
                "UPDATE_MANIFEST_INVALID",
                format!("manifest version={version}: {e}"),
            )
        })?;
        let current = semver::Version::parse(&self.version)
            .map_err(|e| error("UPDATE_VERSION_INVALID", e.to_string()))?;
        if v <= current {
            return Err(error(
                "UPDATE_VERSION_INVALID",
                format!(
                    "manifest version={version}; required=newer than {}",
                    self.version
                ),
            ));
        }
        let entry = &raw["platforms"][&self.platform];
        let identity: AssetIdentity =
            serde_json::from_value(entry["bee"].clone()).map_err(|e| {
                error(
                    "UPDATE_MANIFEST_INVALID",
                    format!(
                        "manifest identity for platform={} failed: {e}",
                        self.platform
                    ),
                )
            })?;
        for (field, actual, expected) in [
            ("channel", identity.channel.as_str(), self.channel.as_str()),
            ("target", identity.target.as_str(), self.target.as_str()),
            ("version", identity.version.as_str(), version),
        ] {
            if actual != expected {
                return Err(error(
                    "UPDATE_TARGET_MISMATCH",
                    format!("manifest {field}={actual}; required={expected}"),
                ));
            }
        }
        if identity.size == 0
            || identity.size > MAX_UPDATE_BYTES
            || identity.sha256.len() != 64
            || !identity
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(error("UPDATE_MANIFEST_INVALID",format!("asset size={} digest bytes={}; required=size 1..{MAX_UPDATE_BYTES}, SHA256 lowercase hex",identity.size,identity.sha256.len())));
        }
        let url = entry["url"]
            .as_str()
            .and_then(|s| tauri::Url::parse(s).ok())
            .ok_or_else(|| {
                error(
                    "UPDATE_ASSET_INVALID",
                    format!("asset URL missing/invalid for platform={}", self.platform),
                )
            })?;
        let prefix = format!("{}download/v{version}/", self.repository);
        if url.host_str() != Some("github.com")
            || !self.allows_redirect(&url)
            || !url.path().starts_with(&prefix)
            || url.path()[prefix.len()..].contains('/')
            || !url.path().ends_with(self.suffix)
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(error(
                "UPDATE_ASSET_INVALID",
                format!(
                    "asset URL host={:?} path={}; required=https://github.com{prefix}<asset>{}",
                    url.host_str(),
                    url.path(),
                    self.suffix
                ),
            ));
        }
        if entry["signature"]
            .as_str()
            .is_none_or(|s| s.is_empty() || s.len() > 8192)
        {
            return Err(error(
                "UPDATE_SIGNATURE_MISSING",
                format!(
                    "asset signature missing/oversized for platform={}",
                    self.platform
                ),
            ));
        }
        if raw["notes"].as_str().is_some_and(|s| s.len() > 32 * 1024) {
            return Err(error(
                "UPDATE_MANIFEST_INVALID",
                "release notes exceed 32768 bytes",
            ));
        }
        Ok(identity)
    }
    pub(crate) fn builder<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> Result<UpdaterBuilder, BridgeError> {
        init_tls()?;
        if app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|v| v.get("requireSignedVersion"))
            .and_then(|v| v.as_bool())
            != Some(true)
        {
            return Err(error(
                "UPDATE_CONFIGURATION_FAILED",
                "updater requireSignedVersion is not true in bundled configuration",
            ));
        }
        let policy = self.clone();
        app.updater_builder()
            .pubkey(self.public_key.clone())
            .target(self.platform.clone())
            .timeout(Duration::from_secs(60))
            .on_before_exit(|| {})
            .restart_after_install(false)
            .configure_client(move |builder| policy.http_client(builder))
            .endpoints(vec![self.endpoint.clone()])
            .map_err(|e| error("UPDATE_CONFIGURATION_FAILED", e.to_string()))
    }
    fn http_client(&self, builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
        let policy = self.clone();
        // Updater 2.14.0 does not carry Builder.timeout into Update.timeout.
        // configure_client is used for both manifest and asset requests.
        builder.timeout(Duration::from_secs(60)).read_timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::custom(move|attempt|{
                if attempt.previous().len()>=5 {return attempt.error("update redirect limit=5 exceeded");}
                if policy.allows_redirect(attempt.url()){attempt.follow()}else{let message=format!("update redirect rejected: host={:?} scheme={}; required=pinned GitHub release transport",attempt.url().host_str(),attempt.url().scheme());attempt.error(message)}
            }))
    }
    pub(crate) async fn fetch_manifest(
        &self,
        builder: reqwest::ClientBuilder,
    ) -> Result<Option<serde_json::Value>, BridgeError> {
        init_tls()?;
        let client = self.http_client(builder).build().map_err(|cause| {
            error(
                "UPDATE_CONFIGURATION_FAILED",
                format!("build controlled manifest client: {cause:?}"),
            )
        })?;
        let mut response = client
            .get(self.endpoint.clone())
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|cause| {
                error(
                    "UPDATE_CHECK_FAILED",
                    format!(
                        "manifest request host={:?} failed: {cause:?}",
                        self.endpoint.host_str()
                    ),
                )
            })?;
        let status = response.status();
        if status == reqwest::StatusCode::NO_CONTENT {
            return Ok(None);
        }
        let limit = if status.is_success() {
            1024 * 1024
        } else {
            8192
        };
        let mut bytes = Vec::new();
        let mut truncated = false;
        while let Some(chunk) = response.chunk().await.map_err(|cause| {
            error(
                "UPDATE_CHECK_FAILED",
                format!(
                    "manifest response HTTP {status}, bytes={} read failed: {cause:?}",
                    bytes.len()
                ),
            )
        })? {
            let remaining = limit - bytes.len();
            bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if chunk.len() > remaining {
                truncated = true;
                break;
            }
        }
        if !status.is_success() {
            return Err(manifest_http_error(status, &bytes, truncated));
        }
        if truncated {
            return Err(error(
                "UPDATE_MANIFEST_INVALID",
                format!(
                    "manifest body exceeds {limit} bytes; required=bounded static release JSON"
                ),
            ));
        }
        serde_json::from_slice(&bytes).map(Some).map_err(|cause|error("UPDATE_MANIFEST_INVALID",format!("manifest JSON rejected: HTTP {status}, bytes={}, line={} column={} category={:?}",bytes.len(),cause.line(),cause.column(),cause.classify())))
    }
}

fn manifest_http_error(
    status: reqwest::StatusCode,
    bytes: &[u8],
    mut truncated: bool,
) -> BridgeError {
    const MAX_MESSAGE_BYTES: usize = 32768;
    const REQUIRED: &str = "; required=successful static release response";
    let prefix = format!("manifest response HTTP {status}; body=\"");
    // Reserve the longer `false` marker before adding escaped evidence. Bound
    // the final UTF-8 message, since one raw control byte may expand to six.
    let budget = MAX_MESSAGE_BYTES - prefix.len() - "\"; truncated=false".len() - REQUIRED.len();
    let mut preview = String::new();
    for character in String::from_utf8_lossy(bytes).chars() {
        let escaped = character.escape_debug().to_string();
        if preview.len() + escaped.len() > budget {
            truncated = true;
            break;
        }
        preview.push_str(&escaped);
    }
    error(
        "UPDATE_CHECK_HTTP_FAILED",
        format!("{prefix}{preview}\"; truncated={truncated}{REQUIRED}"),
    )
}

pub fn check_staging_space(available: u64, required: u64) -> Result<(), BridgeError> {
    if available < required {
        Err(error("UPDATE_SPACE_INSUFFICIENT",format!("update staging space available={available} required={required} bytes; download not started")))
    } else {
        Ok(())
    }
}

pub(crate) fn native_installation_directory<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, BridgeError> {
    // Like the official updater, use Tauri's managed AppImage path on Linux.
    // current_exe there points inside the read-only mounted image instead.
    let executable = tauri::process::current_binary(&app.env()).map_err(|cause| {
        error(
            "UPDATE_SPACE_CHECK_FAILED",
            format!("resolve native update installation executable: {cause}"),
        )
    })?;
    executable.parent().map(Path::to_path_buf).ok_or_else(|| {
        error(
            "UPDATE_SPACE_CHECK_FAILED",
            format!(
                "native update installation executable parent missing: {}",
                executable.display()
            ),
        )
    })
}

/// The plugin stages in the system temporary directory and installs/replaces on
/// the native binary's volume. Check both mounts, including again at confirmation.
pub fn check_native_space<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    required: u64,
) -> Result<(), BridgeError> {
    for location in [std::env::temp_dir(), native_installation_directory(app)?] {
        let available = staging_space(&location)?;
        check_staging_space(available, required).map_err(|cause| {
            error(
                &cause.code,
                format!("{}; volume={}", cause.message, location.display()),
            )
        })?;
    }
    Ok(())
}

fn staging_space(path: &Path) -> Result<u64, BridgeError> {
    let existing = path.ancestors().find(|p| p.is_dir()).ok_or_else(|| {
        error(
            "UPDATE_SPACE_CHECK_FAILED",
            format!("no existing update staging parent for {}", path.display()),
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let name = std::ffi::CString::new(existing.as_os_str().as_bytes()).map_err(|e| {
            error(
                "UPDATE_SPACE_CHECK_FAILED",
                format!("staging path contains NUL: {e}"),
            )
        })?;
        let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        if unsafe { libc::statvfs(name.as_ptr(), stats.as_mut_ptr()) } != 0 {
            return Err(error(
                "UPDATE_SPACE_CHECK_FAILED",
                format!(
                    "statvfs update staging {}: {}",
                    existing.display(),
                    std::io::Error::last_os_error()
                ),
            ));
        }
        let stats = unsafe { stats.assume_init() };
        Ok((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetDiskFreeSpaceExW(
                directory: *const u16,
                available: *mut u64,
                total: *mut u64,
                free: *mut u64,
            ) -> i32;
        }
        let wide: Vec<u16> = existing.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut available = 0;
        if unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(error(
                "UPDATE_SPACE_CHECK_FAILED",
                format!(
                    "GetDiskFreeSpaceExW staging {}: {}",
                    existing.display(),
                    std::io::Error::last_os_error()
                ),
            ));
        }
        Ok(available)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AssetIdentity {
    pub channel: String,
    pub target: String,
    pub version: String,
    pub sha256: String,
    pub size: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateState {
    Idle,
    Checking,
    Current,
    Available,
    Downloading,
    Verified,
    Stopping,
    Installing,
    Failed,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct UpdateSnapshot {
    pub operation_id: Option<String>,
    pub revision: u64,
    pub state: UpdateState,
    pub current_version: String,
    pub target_version: Option<String>,
    pub checked_at: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub release_notes: Option<String>,
    pub error: Option<BridgeError>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingUpdate {
    pub from_version: String,
    pub to_version: String,
    pub channel: String,
    pub stage: String,
    pub target_digest: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersistedUpdateState {
    pub version: u8,
    #[serde(deserialize_with = "required_nullable")]
    pub last_auto_check: Option<i64>,
    #[serde(deserialize_with = "required_nullable")]
    pub pending_update: Option<PendingUpdate>,
}
fn required_nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}
impl Default for PersistedUpdateState {
    fn default() -> Self {
        Self {
            version: 1,
            last_auto_check: None,
            pending_update: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct UpdateStore {
    path: PathBuf,
}
impl UpdateStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    fn read(&self) -> Result<PersistedUpdateState, BridgeError> {
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        #[cfg(windows)]
        let opened = crate::private_file_windows::protected_open(&self.path);
        #[cfg(not(windows))]
        let opened = options.open(&self.path);
        let file = match opened {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Default::default()),
            Err(e) => {
                return Err(error(
                    "UPDATE_STATE_READ_FAILED",
                    format!("open update state {}: {e}", self.path.display()),
                ))
            }
        };
        let metadata = file.metadata().map_err(|e| {
            error(
                "UPDATE_STATE_READ_FAILED",
                format!("stat update state: {e}"),
            )
        })?;
        if !metadata.is_file() || metadata.len() > MAX_STATE_BYTES {
            return Err(error(
                "UPDATE_STATE_INVALID",
                format!(
                    "update state regular={} bytes={}; required=regular file <= {MAX_STATE_BYTES}",
                    metadata.is_file(),
                    metadata.len()
                ),
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.mode() & 0o077 != 0 || metadata.uid() != unsafe { libc::geteuid() } {
                return Err(error(
                    "UPDATE_STATE_PROTECTION_FAILED",
                    format!(
                        "update state mode={:o} uid={}; required=0600 current user",
                        metadata.mode() & 0o777,
                        metadata.uid()
                    ),
                ));
            }
        }
        let mut bytes = Vec::new();
        file.take(MAX_STATE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| {
                error(
                    "UPDATE_STATE_READ_FAILED",
                    format!("read update state: {e}"),
                )
            })?;
        let state: PersistedUpdateState = serde_json::from_slice(&bytes).map_err(|e| {
            error(
                "UPDATE_STATE_INVALID",
                format!(
                    "update state schema failed: line={} column={} category={:?}",
                    e.line(),
                    e.column(),
                    e.classify()
                ),
            )
        })?;
        if state.version != 1 {
            return Err(error(
                "UPDATE_STATE_VERSION_UNSUPPORTED",
                format!(
                    "update state version={}; required=1; original preserved",
                    state.version
                ),
            ));
        }
        if let Some(pending) = &state.pending_update {
            for (field, value) in [
                ("from_version", &pending.from_version),
                ("to_version", &pending.to_version),
            ] {
                if semver::Version::parse(value).is_err() || value.len() > 128 {
                    return Err(error("UPDATE_STATE_INVALID",format!("pending {field} is not a supported SemVer: bytes={}; original preserved",value.len())));
                }
            }
            if pending.channel.is_empty()
                || pending.channel.len() > 32
                || !pending.channel.bytes().enumerate().all(|(i, b)| {
                    b.is_ascii_lowercase() || i > 0 && (b.is_ascii_digit() || b == b'-')
                })
            {
                return Err(error("UPDATE_STATE_INVALID",format!("pending channel rejected: bytes={}; required=lowercase release channel; original preserved",pending.channel.len())));
            }
            if !["stopping", "stopped", "installing"].contains(&pending.stage.as_str()) {
                return Err(error("UPDATE_STATE_INVALID",format!("pending stage rejected: bytes={}; required=stopping/stopped/installing; original preserved",pending.stage.len())));
            }
            if pending.target_digest.len() != 64
                || !pending
                    .target_digest
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(error("UPDATE_STATE_INVALID",format!("pending target digest rejected: bytes={}; required=64 lowercase hex; original preserved",pending.target_digest.len())));
            }
        }
        Ok(state)
    }
    pub(crate) fn write(&self, state: &PersistedUpdateState) -> Result<(), BridgeError> {
        // Reading first refuses a corrupt/future file before replacing anything.
        self.read()?;
        let parent = self
            .path
            .parent()
            .ok_or_else(|| error("UPDATE_STATE_WRITE_FAILED", "update state parent missing"))?;
        std::fs::create_dir_all(parent).map_err(|e| {
            error(
                "UPDATE_STATE_WRITE_FAILED",
                format!("create update state parent {}: {e}", parent.display()),
            )
        })?;
        #[cfg(windows)]
        let temporary = tempfile::Builder::new()
            .prefix(".desktop-update-")
            .make_in(parent, crate::private_file_windows::create_private);
        #[cfg(not(windows))]
        let temporary = tempfile::NamedTempFile::new_in(parent);
        let mut file = temporary.map_err(|e| {
            error(
                "UPDATE_STATE_WRITE_FAILED",
                format!("create protected update state temporary file: {e}"),
            )
        })?;
        let bytes = serde_json::to_vec(state).map_err(|e| {
            error(
                "UPDATE_STATE_WRITE_FAILED",
                format!("encode update state: {e}"),
            )
        })?;
        file.write_all(&bytes)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|e| {
                error(
                    "UPDATE_STATE_WRITE_FAILED",
                    format!("flush update state before atomic replace: {e}"),
                )
            })?;
        #[cfg(windows)]
        crate::private_file_windows::replace(file.path(), &self.path).map_err(|e| {
            error(
                "UPDATE_STATE_WRITE_FAILED",
                format!("atomic protected Windows update state replacement: {e}"),
            )
        })?;
        #[cfg(not(windows))]
        file.persist(&self.path).map_err(|e| {
            error(
                "UPDATE_STATE_WRITE_FAILED",
                format!(
                    "atomic replace update state {}: {}",
                    self.path.display(),
                    e.error
                ),
            )
        })?;
        #[cfg(unix)] std::fs::File::open(parent).and_then(|dir|dir.sync_all()).map_err(|e|error("UPDATE_STATE_WRITE_UNCERTAIN",format!("update state renamed but directory sync failed: {e}; preserved file requires recovery verification")))?;
        Ok(())
    }
}

pub(crate) struct Inner {
    pub snapshot: UpdateSnapshot,
    pub persistent: PersistedUpdateState,
    pub asset: Option<AssetIdentity>,
    pub native: Option<Update>,
    pub bytes: Option<Arc<Vec<u8>>>,
}
#[derive(Clone)]
pub struct UpdateManager {
    pub(crate) inner: Arc<Mutex<Inner>>,
    pub(crate) store: UpdateStore,
}
impl UpdateManager {
    pub fn new(version: &str, store: UpdateStore) -> Result<Self, BridgeError> {
        let persistent = store.read()?;
        let recovery=persistent.pending_update.as_ref().map(|p|error("UPDATE_RECOVERY_PENDING",format!("pending update from={} to={} stage={}; current={version}; required=package, S1 data/runtime and S2 preferences verification before completion",p.from_version,p.to_version,p.stage)));
        Ok(Self {
            store,
            inner: Arc::new(Mutex::new(Inner {
                snapshot: UpdateSnapshot {
                    operation_id: None,
                    revision: 0,
                    state: if recovery.is_some() {
                        UpdateState::Failed
                    } else {
                        UpdateState::Idle
                    },
                    current_version: version.into(),
                    target_version: None,
                    checked_at: None,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    release_notes: None,
                    error: recovery,
                },
                persistent,
                asset: None,
                native: None,
                bytes: None,
            })),
        })
    }
    pub(crate) fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, BridgeError> {
        self.inner.lock().map_err(|e| {
            error(
                "UPDATE_STATE_POISONED",
                format!("update state mutex poisoned: {e}"),
            )
        })
    }
    pub(crate) fn has_pending(&self) -> Result<bool, BridgeError> {
        Ok(self.lock()?.persistent.pending_update.is_some())
    }
    pub fn snapshot(&self) -> Result<UpdateSnapshot, BridgeError> {
        Ok(self.lock()?.snapshot.clone())
    }
    pub(crate) fn advance(inner: &mut Inner) -> Result<(), BridgeError> {
        if inner.snapshot.revision >= MAX_SAFE {
            return Err(error(
                "UPDATE_REVISION_EXHAUSTED",
                format!(
                    "update revision={}; required<={MAX_SAFE}",
                    inner.snapshot.revision
                ),
            ));
        }
        inner.snapshot.revision += 1;
        Ok(())
    }
    pub fn begin_check(
        &self,
        manual: bool,
        seconds: i64,
    ) -> Result<Option<UpdateSnapshot>, BridgeError> {
        let mut inner = self.lock()?;
        if [
            UpdateState::Checking,
            UpdateState::Downloading,
            UpdateState::Stopping,
            UpdateState::Installing,
        ]
        .contains(&inner.snapshot.state)
        {
            return Err(error("UPDATE_BUSY",format!("update check rejected: state={:?}; required=idle/current/available/verified/failed",inner.snapshot.state)));
        }
        if inner.persistent.pending_update.is_some() {
            return Err(error(
                "UPDATE_RECOVERY_PENDING",
                "pending installation must be verified before another update check",
            ));
        }
        if !manual
            && inner
                .persistent
                .last_auto_check
                .is_some_and(|last| seconds.saturating_sub(last) < 86400)
        {
            return Ok(None);
        }
        if !manual {
            let mut next = inner.persistent.clone();
            next.last_auto_check = Some(seconds);
            self.store.write(&next)?;
            inner.persistent = next;
        }
        static NEXT: AtomicU64 = AtomicU64::new(1);
        inner.snapshot.operation_id = Some(format!(
            "update-{}-{seconds}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        inner.snapshot.state = UpdateState::Checking;
        inner.snapshot.error = None;
        inner.snapshot.target_version = None;
        inner.snapshot.downloaded_bytes = 0;
        inner.snapshot.total_bytes = None;
        inner.snapshot.release_notes = None;
        inner.snapshot.checked_at = Some(timestamp(seconds)?);
        inner.asset = None;
        inner.native = None;
        inner.bytes = None;
        Self::advance(&mut inner)?;
        Ok(Some(inner.snapshot.clone()))
    }
    pub fn complete_check(
        &self,
        id: &str,
        asset: Option<AssetIdentity>,
        version: String,
        notes: Option<String>,
    ) -> Result<UpdateSnapshot, BridgeError> {
        let mut inner = self.lock()?;
        Self::require(&inner, id, UpdateState::Checking)?;
        inner.snapshot.state = if asset.is_some() {
            UpdateState::Available
        } else {
            UpdateState::Current
        };
        inner.snapshot.target_version = asset.as_ref().map(|_| version);
        inner.snapshot.release_notes = notes;
        inner.asset = asset;
        Self::advance(&mut inner)?;
        Ok(inner.snapshot.clone())
    }
    pub fn begin_download(&self) -> Result<UpdateSnapshot, BridgeError> {
        let mut inner = self.lock()?;
        if inner.snapshot.state != UpdateState::Available || inner.asset.is_none() {
            return Err(error(
                "UPDATE_NOT_AVAILABLE",
                format!(
                    "download rejected: state={:?} identity={}; required=available validated asset",
                    inner.snapshot.state,
                    inner.asset.is_some()
                ),
            ));
        }
        inner.snapshot.state = UpdateState::Downloading;
        inner.snapshot.error = None;
        Self::advance(&mut inner)?;
        Ok(inner.snapshot.clone())
    }
    pub(crate) fn require(inner: &Inner, id: &str, state: UpdateState) -> Result<(), BridgeError> {
        if inner.snapshot.operation_id.as_deref() != Some(id) || inner.snapshot.state != state {
            return Err(error("UPDATE_STALE_OPERATION",format!("update operation/state rejected: operation_matches={} state={:?}; required={state:?}",inner.snapshot.operation_id.as_deref()==Some(id),inner.snapshot.state)));
        }
        Ok(())
    }
    pub fn progress(&self, id: &str, chunk: u64, total: Option<u64>) -> Result<(), BridgeError> {
        let mut inner = self.lock()?;
        Self::require(&inner, id, UpdateState::Downloading)?;
        let bytes = inner
            .snapshot
            .downloaded_bytes
            .checked_add(chunk)
            .ok_or_else(|| error("UPDATE_SIZE_INVALID", "download byte count overflow"))?;
        let expected = inner.asset.as_ref().map(|a| a.size).unwrap_or(0);
        if bytes > expected
            || total.is_some_and(|size| size != expected)
            || bytes > MAX_UPDATE_BYTES
        {
            return Err(error("UPDATE_SIZE_MISMATCH",format!("downloaded bytes={bytes} Content-Length={total:?}; required=manifest bytes {expected} <= {MAX_UPDATE_BYTES}")));
        }
        if inner.snapshot.total_bytes.is_some() && total != inner.snapshot.total_bytes {
            return Err(error(
                "UPDATE_SIZE_MISMATCH",
                format!(
                    "download Content-Length changed: actual={total:?}; previous={:?}",
                    inner.snapshot.total_bytes
                ),
            ));
        }
        inner.snapshot.downloaded_bytes = bytes;
        inner.snapshot.total_bytes = total;
        Self::advance(&mut inner)
    }
    pub(crate) fn fail(&self, id: &str, cause: BridgeError) -> Result<UpdateSnapshot, BridgeError> {
        let mut inner = self.lock()?;
        if inner.snapshot.operation_id.as_deref() != Some(id) {
            return Err(error(
                "UPDATE_STALE_OPERATION",
                "failure receipt operation differs from current update",
            ));
        }
        inner.snapshot.state = UpdateState::Failed;
        inner.snapshot.error = Some(cause);
        inner.bytes = None;
        Self::advance(&mut inner)?;
        Ok(inner.snapshot.clone())
    }
}

pub fn setup(app: &tauri::AppHandle) -> Result<UpdateManager, BridgeError> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| {
            error(
                "UPDATE_STATE_PATH_FAILED",
                format!("resolve current user update directory: {e}"),
            )
        })?
        .join("desktop-update-state.json");
    let manager = UpdateManager::new(env!("CARGO_PKG_VERSION"), UpdateStore::new(path))?;
    app.manage(manager.clone());
    Ok(manager)
}
pub fn start_background(app: &tauri::AppHandle, manager: &UpdateManager) {
    let manager = manager.clone();
    if let Ok(policy) = ReleasePolicy::compiled() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if let Err(cause) = start_check(&app, &manager, policy.clone(), false) {
                    eprintln!("{}: {}", cause.code, cause.message);
                }
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
        });
    }
}
fn start_check(
    app: &tauri::AppHandle,
    manager: &UpdateManager,
    policy: ReleasePolicy,
    manual: bool,
) -> Result<UpdateSnapshot, BridgeError> {
    let Some(snapshot) = manager.begin_check(manual, now())? else {
        return manager.snapshot();
    };
    let id = snapshot.operation_id.clone().ok_or_else(|| {
        error(
            "UPDATE_OPERATION_MISSING",
            "checking snapshot has no operation ID",
        )
    })?;
    let manager = manager.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            let updater = policy.builder(&app)?.build().map_err(|cause| {
                error(
                    "UPDATE_CONFIGURATION_FAILED",
                    format!("build native updater: {cause}"),
                )
            })?;
            // check() in 2.14.0 discards non-2xx status/body. Fetch once with
            // bounded evidence, then retain the plugin's schema/version selection.
            let update = match policy.fetch_manifest(reqwest::Client::builder()).await? {
                Some(raw) => updater.restore_update(raw).map_err(|cause| {
                    error(
                        "UPDATE_CHECK_FAILED",
                        format!("native release schema/version selection failed: {cause}"),
                    )
                })?,
                None => None,
            };
            if let Some(update) = update {
                let identity = policy.validate_manifest(&update.raw_json)?;
                let version = update.version.clone();
                let notes = update.body.clone();
                let mut inner = manager.lock()?;
                UpdateManager::require(&inner, &id, UpdateState::Checking)?;
                inner.native = Some(update);
                drop(inner);
                manager.complete_check(&id, Some(identity), version, notes)?;
            } else {
                manager.complete_check(&id, None, policy.version.clone(), None)?;
            }
            Ok::<_, BridgeError>(())
        }
        .await;
        if let Err(cause) = result {
            let _ = manager.fail(&id, cause);
        }
    });
    Ok(snapshot)
}
#[tauri::command]
pub fn update_snapshot(
    manager: tauri::State<'_, UpdateManager>,
) -> Result<UpdateSnapshot, BridgeError> {
    manager.snapshot()
}
#[tauri::command]
pub fn update_check(
    app: tauri::AppHandle,
    manager: tauri::State<'_, UpdateManager>,
) -> Result<UpdateSnapshot, BridgeError> {
    start_check(&app, &manager, ReleasePolicy::compiled()?, true)
}
#[tauri::command]
pub fn update_download<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    manager: tauri::State<'_, UpdateManager>,
) -> Result<UpdateSnapshot, BridgeError> {
    let size = manager
        .lock()?
        .asset
        .as_ref()
        .map(|a| a.size)
        .ok_or_else(|| {
            error(
                "UPDATE_IDENTITY_MISSING",
                "no validated update asset before download",
            )
        })?;
    check_native_space(&app, size.saturating_mul(3))?;
    let snapshot = manager.begin_download()?;
    let id = snapshot.operation_id.clone().ok_or_else(|| {
        error(
            "UPDATE_OPERATION_MISSING",
            "download snapshot has no operation ID",
        )
    })?;
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn(async move {
        let result=async {
            let (native,identity)={let inner=manager.lock()?;(inner.native.clone().ok_or_else(||error("UPDATE_NATIVE_HANDLE_MISSING","validated updater handle missing; check again"))?,inner.asset.clone().ok_or_else(||error("UPDATE_IDENTITY_MISSING","validated asset identity missing"))?)};
            let cancellation=tokio::sync::Notify::new();let failure=Mutex::new(None);let mut download=Box::pin(native.download(|chunk,total|{if let Err(cause)=manager.progress(&id,chunk as u64,total){*failure.lock().unwrap()=Some(cause);cancellation.notify_one();}},||{}));
            let bytes=tokio::select!{biased;_=cancellation.notified()=>return Err(failure.lock().unwrap().take().unwrap_or_else(||error("UPDATE_DOWNLOAD_CANCELLED","download failed size/progress validation"))), result=&mut download=>result.map_err(|e|error("UPDATE_DOWNLOAD_FAILED",format!("native download/signature validation failed: {e}")))?};
            if let Some(cause)=failure.lock().unwrap().take(){return Err(cause);}
            let hash=format!("{:x}",Sha256::digest(&bytes));if bytes.len() as u64!=identity.size||hash!=identity.sha256{return Err(error("UPDATE_DIGEST_MISMATCH",format!("verified asset bytes={} SHA256={hash}; required=bytes {} SHA256={}",bytes.len(),identity.size,identity.sha256)));}
            let mut inner=manager.lock()?;UpdateManager::require(&inner,&id,UpdateState::Downloading)?;inner.bytes=Some(Arc::new(bytes));inner.snapshot.state=UpdateState::Verified;UpdateManager::advance(&mut inner)?;Ok::<_,BridgeError>(())
        }.await;
        if let Err(cause) = result {
            let _ = manager.fail(&id, cause);
        }
    });
    Ok(snapshot)
}
