//! Private Hive storage and fixed process ownership. Paths never cross IPC.

use crate::{
    preferences::{private_write, protected_read_bounded},
    protocol::BridgeError,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

const LIMIT: u64 = 1_048_576;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
fn error(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError::new(code, message.into())
}
fn io_error(stage: &str, cause: std::io::Error) -> BridgeError {
    error(
        "PROFILE_IO",
        format!(
            "{stage}: {cause}; kind={:?} os_code={:?}",
            cause.kind(),
            cause.raw_os_error()
        ),
    )
}
fn hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn identifier() -> String {
    hex(format!(
        "{}:{}:{}",
        std::process::id(),
        time::OffsetDateTime::now_utc().unix_timestamp_nanos(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
    .as_bytes())[..32]
        .into()
}
fn valid_id(id: &str) -> bool {
    crate::startup_recovery::digest(id, 32)
}
fn normalize(origin: &str) -> Result<String, BridgeError> {
    crate::preferences::normalize_hive_origin(origin)
}
fn private_dir(path: &Path) -> Result<(), BridgeError> {
    if !path.exists() {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(path)
            .map_err(|e| io_error("create private profile directory", e))?;
    }
    let meta =
        fs::symlink_metadata(path).map_err(|e| io_error("inspect private profile directory", e))?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(error(
            "PROFILE_DIRECTORY",
            "profile directory regular_directory=false; required=directory without symbolic links",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.mode() & 0o777 != 0o700 || meta.uid() != unsafe { libc::geteuid() } {
            return Err(error("PROFILE_DIRECTORY",format!("profile directory mode={:o} owner_matches_current_user={}; required=0700 and current user",meta.mode()&0o777,meta.uid()==unsafe{libc::geteuid()})));
        }
    }
    Ok(())
}
fn sync_dir(path: &Path) -> Result<(), BridgeError> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| io_error("sync profile directory", e))?;
    Ok(())
}
fn write(path: &Path, raw: &[u8]) -> Result<(), BridgeError> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err(error("PROFILE_FILE", "profile destination regular_file=false; required=private regular file without symbolic links"));
            }
            protected_read_bounded(path, LIMIT)
                .map_err(|e| io_error("validate existing protected profile destination", e))?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(io_error("inspect profile write destination", e)),
    }
    private_write(path, raw)
        .map_err(|e| io_error("atomically replace protected profile file", e))?;
    let readback = protected_read_bounded(path, LIMIT)
        .map_err(|e| io_error("read back protected profile file", e))?;
    if readback != raw {
        return Err(error("PROFILE_WRITE_UNCONFIRMED",format!("profile write readback_matches=false bytes={}; reread persisted state before another action",raw.len())));
    }
    Ok(())
}
fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, BridgeError> {
    let raw = match protected_read_bounded(path, LIMIT) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_error("read protected profile metadata", e)),
    };
    serde_json::from_slice(&raw).map(Some).map_err(|e|error("PROFILE_SCHEMA",format!("profile metadata JSON rejected: category={:?} line={} column={}; original preserved",e.classify(),e.line(),e.column())))
}
fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), BridgeError> {
    let raw = serde_json::to_vec(value).map_err(|e| {
        error(
            "PROFILE_SCHEMA",
            format!("profile metadata encoding failed: {e}"),
        )
    })?;
    if raw.len() > LIMIT as usize {
        return Err(error(
            "PROFILE_CAPACITY",
            format!(
                "profile metadata bytes={} limit={LIMIT}; original preserved",
                raw.len()
            ),
        ));
    }
    write(path, &raw)
}

/// File handle ownership is retained for the whole App lifetime; lock files are never removed.
pub(crate) struct OwnershipLock {
    _file: File,
}
impl OwnershipLock {
    pub(crate) fn acquire(path: &Path) -> Result<Self, BridgeError> {
        #[cfg(not(windows))]
        let file = {
            let mut options = OpenOptions::new();
            options.read(true).write(true).create(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options
                    .mode(0o600)
                    .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
            }
            options
                .open(path)
                .map_err(|e| io_error("open exclusive profile ownership lock", e))?
        };
        #[cfg(windows)]
        let file = match crate::private_file_windows::create_private(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                crate::private_file_windows::protected_open_writable(path)
                    .map_err(|e| io_error("open protected ownership lock", e))?
            }
            Err(e) => return Err(io_error("create protected ownership lock", e)),
        };
        let meta = file
            .metadata()
            .map_err(|e| io_error("inspect ownership lock", e))?;
        if !meta.is_file() {
            return Err(error(
                "PROFILE_LOCK",
                "ownership lock regular_file=false; required=private regular file",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if meta.mode() & 0o777 != 0o600
                || meta.uid() != unsafe { libc::geteuid() }
                || meta.nlink() != 1
            {
                return Err(error("PROFILE_LOCK", format!("ownership lock mode={:o} owner_matches_current_user={} links={}; required=0600, current user and one link",meta.mode()&0o777,meta.uid()==unsafe{libc::geteuid()},meta.nlink())));
            }
        }
        file.try_lock().map_err(|e|error("PROFILE_OWNER_BUSY",format!("exclusive profile ownership unavailable: {e}; existing owner must exit before continuing")))?;
        Ok(Self { _file: file })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProfileEntry {
    pub id: String,
    pub origin: String,
    pub raw_origin: String,
    pub binding_revision: u64,
    pub binding_digest: Option<String>,
    pub blockers: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HistoricalConflict {
    pub origin: String,
    pub canonical_origin: String,
    pub source: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProfileIndex {
    pub version: u32,
    pub revision: u64,
    pub profiles: Vec<ProfileEntry>,
    pub current_profile: Option<String>,
    pub committed_operation: Option<String>,
    pub migration_id: Option<String>,
    pub migration_blockers: Vec<String>,
    pub historical_conflicts: Vec<HistoricalConflict>,
}
impl Default for ProfileIndex {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            profiles: vec![],
            current_profile: None,
            committed_operation: None,
            migration_id: None,
            migration_blockers: vec![],
            historical_conflicts: vec![],
        }
    }
}
/// Created only from an enrolled ID. A process retains this value through reconnect.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProfileContext {
    pub id: String,
    pub origin: String,
    directory: PathBuf,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProfileMode {
    Current,
    Prepare,
    Activate,
}
impl ProfileMode {
    pub(crate) fn argument(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::Prepare => "prepare",
            Self::Activate => "activate",
        }
    }
}
impl ProfileContext {
    pub(crate) fn directory(&self) -> &Path {
        &self.directory
    }
    pub(crate) fn proxy_for<'a>(
        &self,
        preferences: &'a crate::preferences::DesktopPreferences,
        scope: Option<&str>,
    ) -> Result<&'a str, BridgeError> {
        let matches: Vec<_> = preferences
            .proxies
            .iter()
            .filter(|p| {
                normalize(&p.origin).is_ok_and(|origin| origin == self.origin)
                    && p.device_scope.as_deref() == scope
            })
            .collect();
        if matches.len() > 1 {
            return Err(error("PROFILE_PROXY_CONFLICT",format!("profile proxy records={} origin={}; required=one original origin/device-scoped proxy, conflicting history preserved",matches.len(),self.origin)));
        }
        Ok(matches
            .first()
            .map(|p| p.connect_proxy.as_str())
            .unwrap_or(""))
    }
    pub(crate) fn device_path(&self) -> PathBuf {
        self.directory.join("bee-desktop.json")
    }
    pub(crate) fn startup_journal(&self) -> crate::startup_recovery::RecoveryJournal {
        crate::startup_recovery::RecoveryJournal::beside(&self.device_path())
    }
}

pub(crate) struct ProfileStore {
    root: PathBuf,
    _owner: OwnershipLock,
    serial: Mutex<()>,
}
impl ProfileStore {
    pub(crate) fn open(root: PathBuf) -> Result<Self, BridgeError> {
        if !root.is_absolute() {
            return Err(error(
                "PROFILE_DIRECTORY",
                "profile root absolute=false; required=trusted absolute App directory",
            ));
        }
        private_dir(&root)?;
        let root = fs::canonicalize(root).map_err(|e| io_error("resolve fixed profile root", e))?;
        let owner = OwnershipLock::acquire(&root.join("desktop-app.lock"))?;
        private_dir(&root.join("profiles"))?;
        let store = Self {
            root,
            _owner: owner,
            serial: Mutex::new(()),
        };
        store.snapshot()?;
        Ok(store)
    }
    pub(crate) fn root(&self) -> &Path {
        &self.root
    }
    pub(crate) fn snapshot(&self) -> Result<ProfileIndex, BridgeError> {
        let mut index: ProfileIndex =
            read_json(&self.root.join("hive-profiles.json"))?.unwrap_or_default();
        if index.version != 1 || index.revision > MAX_REVISION {
            return Err(error(
                "PROFILE_INDEX",
                format!(
                    "profile index version={} revision={}; required=version 1 and safe revision",
                    index.version, index.revision
                ),
            ));
        }
        let mut ids = HashSet::new();
        let mut origins = HashSet::new();
        for entry in &index.profiles {
            if !valid_id(&entry.id)
                || !ids.insert(&entry.id)
                || normalize(&entry.origin)? != entry.origin
                || !origins.insert(&entry.origin)
                || normalize(&entry.raw_origin)? != entry.origin
                || entry.binding_revision > MAX_REVISION
                || entry
                    .binding_digest
                    .as_ref()
                    .is_some_and(|id| !crate::startup_recovery::digest(id, 64))
            {
                return Err(error("PROFILE_INDEX",format!("profile index entry rejected: id_valid={} binding_revision={}; required=unique internal ID/canonical origin and bounded binding metadata",valid_id(&entry.id),entry.binding_revision)));
            }
        }
        if index
            .current_profile
            .as_ref()
            .is_some_and(|id| !ids.contains(id))
            || index
                .committed_operation
                .as_ref()
                .is_some_and(|id| !crate::startup_recovery::digest(id, 48))
            || index.migration_id.as_ref().is_some_and(|id| !valid_id(id))
        {
            return Err(error("PROFILE_INDEX", "profile current/operation/migration reference rejected; required=enrolled current ID and valid operation identities"));
        }
        if !index.historical_conflicts.is_empty() {
            // The migrated device binding was independently attributed. Keep
            // that profile usable while blocking ambiguous historical targets,
            // including entries enrolled by an earlier client version.
            let migration: Option<MigrationRecord> = read_json(&self.root.join("profile-migration.json"))?;
            let original = migration.as_ref()
                .filter(|r| index.migration_id.as_deref() == Some(&r.id))
                .and_then(|r| r.profile.as_ref());
            for entry in &mut index.profiles {
                if original.is_some_and(|p| p.id == entry.id) { continue; }
                if index.historical_conflicts.iter().any(|c| c.canonical_origin == entry.origin) {
                    let blocker = format!("historical_origin_conflict:{}", entry.origin);
                    if !entry.blockers.contains(&blocker) { entry.blockers.push(blocker); }
                }
            }
        }
        Ok(index)
    }
    fn save(&self, index: &ProfileIndex) -> Result<(), BridgeError> {
        save_json(&self.root.join("hive-profiles.json"), index)
    }
    pub(crate) fn context(&self, id: &str) -> Result<ProfileContext, BridgeError> {
        let index = self.snapshot()?;
        let entry = index.profiles.iter().find(|p| p.id == id).ok_or_else(|| {
            error(
                "PROFILE_UNKNOWN",
                format!(
                    "profile enrolled=false id_valid={}; required=registered internal profile ID",
                    valid_id(id)
                ),
            )
        })?;
        let directory = self.root.join("profiles").join(&entry.id);
        if !directory.exists() {
            return Err(error("PROFILE_DIRECTORY_MISSING","registered profile directory exists=false; original context must be recovered before launch"));
        }
        private_dir(&directory)?;
        Ok(ProfileContext {
            id: entry.id.clone(),
            origin: entry.origin.clone(),
            directory,
        })
    }
    fn require_migrated(&self, index: &ProfileIndex) -> Result<(), BridgeError> {
        if let Some(record) =
            read_json::<MigrationRecord>(&self.root.join("profile-migration.json"))?
        {
            if record.phase != MigrationPhase::Committed
                || index.migration_id.as_deref() != Some(&record.id)
            {
                return Err(error("PROFILE_MIGRATION_PENDING",format!("profile migration phase={:?} committed_index_matches={}; continue original migration before profile changes",record.phase,index.migration_id.as_deref()==Some(&record.id))));
            }
        } else if index.migration_id.is_none() {
            for entry in fs::read_dir(&self.root)
                .map_err(|e| io_error("check legacy profile ownership before enrollment", e))?
            {
                let entry = entry
                    .map_err(|e| io_error("read legacy profile entry before enrollment", e))?;
                if entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| legacy_name(name, false))
                {
                    return Err(error("PROFILE_MIGRATION_PENDING","legacy profile evidence present=true; migrate original records before enrolling a Hive"));
                }
            }
        }
        Ok(())
    }
    pub(crate) fn register(&self, origin: &str) -> Result<ProfileContext, BridgeError> {
        let _serial = self.serial.lock().unwrap_or_else(|e| e.into_inner());
        let canonical = normalize(origin)?;
        let mut index = self.snapshot()?;
        self.require_migrated(&index)?;
        if let Some(entry) = index.profiles.iter().find(|p| p.origin == canonical) {
            return self.context(&entry.id);
        }
        if index.revision >= MAX_REVISION {
            return Err(error(
                "PROFILE_CAPACITY",
                "profile revision exhausted; original preserved",
            ));
        }
        let id = identifier();
        private_dir(&self.root.join("profiles").join(&id))?;
        sync_dir(&self.root.join("profiles"))?;
        let blockers = if index.historical_conflicts.iter().any(|c| c.canonical_origin == canonical) {
            vec![format!("historical_origin_conflict:{canonical}")]
        } else { vec![] };
        index.profiles.push(ProfileEntry {
            id: id.clone(),
            origin: canonical,
            raw_origin: origin.into(),
            binding_revision: 0,
            binding_digest: None,
            blockers,
        });
        index.revision += 1;
        self.save(&index)?;
        self.context(&id)
    }
    /// Captures a durable local binding version. Remote identity is checked by the
    /// coordinator separately; a file digest never claims the binding is accepted.
    pub(crate) fn refresh_binding(
        &self,
        expected: u64,
        id: &str,
    ) -> Result<ProfileIndex, BridgeError> {
        let _serial = self.serial.lock().unwrap_or_else(|e| e.into_inner());
        let mut index = self.snapshot()?;
        if index.revision != expected || expected >= MAX_REVISION {
            return Err(error("PROFILE_REVISION_CONFLICT",format!("profile binding snapshot revision actual={} expected={expected}; refresh before recording binding",index.revision)));
        }
        let context = self.context(id)?;
        let raw = protected_read_bounded(&context.device_path(), 65536)
            .map_err(|e| io_error("read original profile binding version", e))?;
        let value=unique_value(&raw).map_err(|e|error("PROFILE_BINDING_INVALID",format!("profile binding JSON rejected: category={:?} line={} column={}; original preserved",e.classify(),e.line(),e.column())))?;
        let origin = value["hive"].as_str().ok_or_else(|| {
            error(
                "PROFILE_BINDING_INVALID",
                "profile binding origin_present=false; required=original Hive origin",
            )
        })?;
        if normalize(origin)? != context.origin {
            return Err(error(
                "PROFILE_BINDING_INVALID",
                format!(
                    "profile binding origin_matches=false profile={}; original preserved",
                    context.id
                ),
            ));
        }
        let digest = local_binding_digest(&value)?;
        let entry = index.profiles.iter_mut().find(|p| p.id == id).unwrap();
        if entry.binding_digest.as_deref() == Some(&digest) {
            return Ok(index);
        }
        if entry.binding_revision >= MAX_REVISION {
            return Err(error(
                "PROFILE_CAPACITY",
                "profile binding revision exhausted; original preserved",
            ));
        }
        entry.binding_revision += 1;
        entry.binding_digest = Some(digest);
        entry.raw_origin = origin.into();
        index.revision += 1;
        self.save(&index)?;
        Ok(index)
    }
    /// Called only after the coordinator durably records its prepared commit evidence.
    /// An uncertain write is reread by the caller; it must never be rolled back blindly.
    pub(crate) fn commit_current(
        &self,
        expected: u64,
        id: &str,
        operation: &str,
    ) -> Result<ProfileIndex, BridgeError> {
        let _serial = self.serial.lock().unwrap_or_else(|e| e.into_inner());
        let mut index = self.snapshot()?;
        self.require_migrated(&index)?;
        if !index.migration_blockers.is_empty() {
            return Err(error("PROFILE_MIGRATION_BLOCKED",format!("unattributed migration blockers={:?}; original evidence must be reconciled before activating a profile",index.migration_blockers)));
        }
        if index.committed_operation.as_deref() == Some(operation) {
            if index.current_profile.as_deref() == Some(id) {
                return Ok(index);
            }
            return Err(error("PROFILE_OPERATION_CONFLICT",format!("profile commit operation already belongs to current={:?} requested={id}; original committed result preserved",index.current_profile)));
        }
        if index.revision != expected || expected >= MAX_REVISION {
            return Err(error("PROFILE_REVISION_CONFLICT",format!("profile revision actual={} expected={expected}; reread persisted current profile",index.revision)));
        }
        if !crate::startup_recovery::digest(operation, 48) {
            return Err(error(
                "PROFILE_OPERATION",
                "profile commit operation_valid=false; required=48 lowercase hex characters",
            ));
        }
        let entry = index.profiles.iter().find(|p| p.id == id).ok_or_else(|| {
            error(
                "PROFILE_UNKNOWN",
                "profile commit target enrolled=false; required=registered ID",
            )
        })?;
        if !entry.blockers.is_empty() {
            return Err(error(
                "PROFILE_BLOCKED",
                format!(
                    "profile commit blockers={:?}; resolve original evidence first",
                    entry.blockers
                ),
            ));
        }
        index.current_profile = Some(id.into());
        index.committed_operation = Some(operation.into());
        index.revision += 1;
        self.save(&index)?;
        Ok(index)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MigrationPhase {
    Prepared,
    Copied,
    Fenced,
    Committed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MigrationFile {
    source: String,
    name: String,
    bytes: u64,
    sha256: String,
    active_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MigrationRecord {
    version: u32,
    id: String,
    startup_directory: PathBuf,
    phase: MigrationPhase,
    profile: Option<ProfileEntry>,
    files: Vec<MigrationFile>,
    blockers: Vec<String>,
    conflicts: Vec<HistoricalConflict>,
}
fn legacy_name(name: &str, startup: bool) -> bool {
    if startup {
        return name == "desktop-startup-recovery.json"
            || name.starts_with("desktop-startup-recovery-") && name.ends_with(".json");
    }
    [
        "bee-desktop.json",
        "ai-accounts.json",
        "login-maintenance.json",
        "runtime-session",
        "bee-desktop-recovery.json",
        "desktop-session-retirement.json",
        "capability-cooldown.json",
    ]
    .contains(&name)
        || name.starts_with("ai-accounts.json.v") && name.ends_with(".bak")
        || name.starts_with("bee-desktop.json.v") && name.ends_with(".bak")
        || name.starts_with("desktop-session-retirement-") && name.ends_with(".json")
        || name.starts_with("login-operation-") && name.ends_with(".lock")
}
// Value's usual decoder accepts duplicate keys. Migration must never repair a
// corrupt old transaction merely by reserializing it while filtering scopes.
struct UniqueValue(serde_json::Value);
impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueValue;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON without duplicate object fields")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<UniqueValue, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<UniqueValue, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<UniqueValue, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<UniqueValue, E> {
                Ok(UniqueValue(serde_json::Value::Number(
                    serde_json::Number::from_f64(v)
                        .ok_or_else(|| E::custom("non-finite JSON number"))?,
                )))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<UniqueValue, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<UniqueValue, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<UniqueValue, E> {
                Ok(UniqueValue(serde_json::Value::Null))
            }
            fn visit_none<E: serde::de::Error>(self) -> Result<UniqueValue, E> {
                self.visit_unit()
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<UniqueValue, A::Error> {
                let mut values = vec![];
                while let Some(value) = seq.next_element::<UniqueValue>()? {
                    values.push(value.0);
                }
                Ok(UniqueValue(values.into()))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<UniqueValue, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some(name) = map.next_key::<String>()? {
                    if values.contains_key(&name) {
                        return Err(serde::de::Error::custom(
                            "duplicate JSON field; original preserved",
                        ));
                    }
                    values.insert(name, map.next_value::<UniqueValue>()?.0);
                }
                Ok(UniqueValue(values.into()))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}
// This digest is local version evidence, deliberately distinct from Go's
// recovery/retirement proofs. The migration manifest separately retains raw SHA256.
fn local_binding_digest(value: &serde_json::Value) -> Result<String, BridgeError> {
    let identity = serde_json::json!([
        value["hive"],
        value["name"],
        value["credential"],
        value["identity"]
    ]);
    serde_json::to_vec(&identity)
        .map(|bytes| hex(&bytes))
        .map_err(|e| {
            error(
                "PROFILE_BINDING_INVALID",
                format!("encode local binding version: {e}"),
            )
        })
}
pub(crate) fn unique_value(raw: &[u8]) -> Result<serde_json::Value, serde_json::Error> {
    serde_json::from_slice::<UniqueValue>(raw).map(|value| value.0)
}
// A copy of a multi-scope store is not a second set of credentials. Only exact
// original origin/user/device matches become active; all original bytes stay in backup.
fn active_path(directory: &Path, file: &MigrationFile) -> PathBuf {
    if file.name.ends_with(".bak") {
        directory.join("legacy-backups").join(&file.name)
    } else {
        directory.join(&file.name)
    }
}
fn matches_original_binding(item: &serde_json::Value, device: &serde_json::Value) -> bool {
    let fields = [
        (item["hive"].as_str(), device["hive"].as_str()),
        (
            item["owner_id"].as_str(),
            device["identity"]["owner_id"].as_str(),
        ),
        (
            item["device_id"].as_str(),
            device["identity"]["id"].as_str(),
        ),
    ];
    fields.iter().all(|(actual, expected)| {
        actual.is_some_and(|value| !value.is_empty()) && actual == expected
    })
}
fn active_bytes(
    name: &str,
    raw: &[u8],
    device: Option<&serde_json::Value>,
) -> Result<Vec<u8>, BridgeError> {
    let (field, version) = match name {
        "ai-accounts.json" => ("scopes", 3),
        "login-maintenance.json" => ("records", 1),
        _ => return Ok(raw.to_vec()),
    };
    let Some(device) = device else {
        return Ok(raw.to_vec());
    };
    let Ok(mut value) = unique_value(raw) else {
        return Ok(raw.to_vec());
    };
    if value["version"] != version && !(name == "ai-accounts.json" && value["version"] == 2) {
        return Ok(raw.to_vec());
    }
    if let Some(records) = value[field].as_object_mut() {
        let before = records.len();
        records.retain(|_, item| matches_original_binding(item, device));
        if before != records.len() {
            return serde_json::to_vec(&value).map_err(|e| {
                error(
                    "PROFILE_MIGRATION_INVALID",
                    format!("encode attributed active scope: {e}"),
                )
            });
        }
    }
    Ok(raw.to_vec())
}
fn source_directory<'a>(
    record: &'a MigrationRecord,
    root: &'a Path,
    file: &MigrationFile,
) -> Result<&'a Path, BridgeError> {
    match file.source.as_str() {
        "root" => Ok(root),
        "startup" => Ok(&record.startup_directory),
        _ => Err(error(
            "PROFILE_MIGRATION_INVALID",
            "migration file source rejected; required=root/startup",
        )),
    }
}
fn verify_file(path: &Path, file: &MigrationFile) -> Result<Vec<u8>, BridgeError> {
    let raw = protected_read_bounded(path, LIMIT)
        .map_err(|e| io_error("read original migration evidence", e))?;
    let actual = hex(&raw);
    if raw.len() as u64 != file.bytes || actual != file.sha256 {
        return Err(error("PROFILE_MIGRATION_CONFLICT",format!("migration evidence differs: source={} name={} bytes={} expected_bytes={} sha256={} expected_sha256={}; preserve original operation",file.source,file.name,raw.len(),file.bytes,actual,file.sha256)));
    }
    Ok(raw)
}
impl ProfileStore {
    pub(crate) fn migrate_legacy(
        &self,
        startup_directory: &Path,
    ) -> Result<ProfileIndex, BridgeError> {
        self.migrate_legacy_observed(startup_directory, |_| Ok(()))
    }
    /// Observer runs only after each named stage has been fsynced. Used for crash-boundary testing.
    pub(crate) fn migrate_legacy_observed(
        &self,
        startup_directory: &Path,
        mut observer: impl FnMut(MigrationPhase) -> Result<(), BridgeError>,
    ) -> Result<ProfileIndex, BridgeError> {
        let _serial = self.serial.lock().unwrap_or_else(|e| e.into_inner());
        let startup_directory = if startup_directory.exists() {
            let metadata = fs::symlink_metadata(startup_directory)
                .map_err(|e| io_error("inspect original startup journal directory", e))?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(error("PROFILE_MIGRATION_CONTEXT","legacy startup directory private_directory=false; required=original directory without symbolic links"));
            }
            fs::canonicalize(startup_directory)
                .map_err(|e| io_error("resolve legacy startup journal directory", e))?
        } else {
            startup_directory.to_path_buf()
        };
        if !startup_directory.is_absolute() {
            return Err(error(
                "PROFILE_MIGRATION_CONTEXT",
                "legacy startup directory absolute=false; required=fixed absolute directory",
            ));
        }
        let _device = OwnershipLock::acquire(&self.root.join("bee-desktop.json.lock"))?;
        let _accounts = OwnershipLock::acquire(&self.root.join("ai-accounts.json.lock"))?;
        let journal_path = self.root.join("profile-migration.json");
        let mut record = match read_json::<MigrationRecord>(&journal_path)? {
            Some(record) => record,
            None => {
                let mut files = vec![];
                let mut raws = std::collections::HashMap::new();
                for (source, directory) in [
                    ("root", self.root.as_path()),
                    ("startup", startup_directory.as_path()),
                ] {
                    if !directory.exists() {
                        continue;
                    }
                    for entry in fs::read_dir(directory)
                        .map_err(|e| io_error("enumerate legacy profile records", e))?
                    {
                        let entry = entry
                            .map_err(|e| io_error("read legacy profile directory entry", e))?;
                        let name = entry.file_name().into_string().map_err(|_| {
                            error(
                                "PROFILE_MIGRATION_INVALID",
                                "legacy filename UTF8=false; required=known ASCII record names",
                            )
                        })?;
                        if !legacy_name(&name, source == "startup") {
                            continue;
                        }
                        let raw = protected_read_bounded(&entry.path(), LIMIT).map_err(|e| {
                            io_error("read protected legacy evidence before migration", e)
                        })?;
                        files.push(MigrationFile {
                            source: source.into(),
                            name: name.clone(),
                            bytes: raw.len() as u64,
                            sha256: hex(&raw),
                            active_sha256: String::new(),
                        });
                        raws.insert((source.to_owned(), name), raw);
                    }
                }
                let existing = self.snapshot()?;
                if !existing.profiles.is_empty() {
                    return Err(error("PROFILE_MIGRATION_CONFLICT",format!("legacy migration has profiles={} without original migration journal; required=unpublished profile index",existing.profiles.len())));
                }
                files.sort_by(|a, b| (&a.source, &a.name).cmp(&(&b.source, &b.name)));
                let mut blockers = vec![];
                let device = raws.get(&("root".into(), "bee-desktop.json".into()));
                let device_value = device.and_then(|raw| unique_value(raw).ok());
                let raw_origin = device_value
                    .as_ref()
                    .and_then(|v| v["hive"].as_str())
                    .filter(|v| !v.is_empty());
                let mut profile = match raw_origin {
                    Some(origin) => match normalize(origin) {
                        Ok(canonical) => Some(ProfileEntry {
                            id: identifier(),
                            origin: canonical,
                            raw_origin: origin.into(),
                            binding_revision: 1,
                            binding_digest: device_value
                                .as_ref()
                                .map(local_binding_digest)
                                .transpose()?,
                            blockers: vec![],
                        }),
                        Err(_) => {
                            blockers.push("legacy_device_origin_invalid".into());
                            None
                        }
                    },
                    None => {
                        if !files.is_empty() {
                            blockers.push("legacy_device_binding_unattributed".into());
                        }
                        None
                    }
                };
                let mut origins = std::collections::HashMap::<String, HashSet<String>>::new();
                if let Some(p) = &profile {
                    origins
                        .entry(p.origin.clone())
                        .or_default()
                        .insert(p.raw_origin.clone());
                }
                for ((source, name), raw) in &raws {
                    if name.ends_with(".lock")
                        || name == "runtime-session"
                        || name.ends_with(".bak")
                    {
                        continue;
                    }
                    let value = match unique_value(raw) {
                        Ok(v) => v,
                        Err(_) => {
                            let reason = format!("legacy_record_invalid:{source}/{name}");
                            if let Some(p) = &mut profile {
                                p.blockers.push(reason);
                            } else {
                                blockers.push(reason);
                            }
                            continue;
                        }
                    };
                    let records = if name == "ai-accounts.json" {
                        value["scopes"].as_object()
                    } else if name == "login-maintenance.json" {
                        value["records"].as_object()
                    } else {
                        None
                    };
                    if let Some(records) = records {
                        for item in records.values() {
                            let origin = item["hive"].as_str();
                            match origin
                                .and_then(|o| normalize(o).ok().map(|canonical| (o, canonical)))
                            {
                                Some((raw, canonical)) => {
                                    origins.entry(canonical).or_default().insert(raw.into());
                                }
                                None => {
                                    if let Some(p) = &mut profile {
                                        p.blockers
                                            .push(format!("legacy_scope_unattributed:{name}"));
                                    }
                                }
                            }
                            // Never give unresolved foreign transactions to a newly paired Hive.
                            let current = device_value.as_ref();
                            let matches =
                                current.is_some_and(|d| matches_original_binding(item, d));
                            let pending = item["pending_operations"]
                                .as_object()
                                .is_some_and(|v| !v.is_empty())
                                || name == "login-maintenance.json"
                                    && item["maintenance"]["phase"] != "restored";
                            if !matches && pending {
                                if let Some(p) = &mut profile {
                                    p.blockers.push(format!(
                                        "legacy_foreign_operation_unresolved:{name}"
                                    ));
                                } else {
                                    blockers.push(format!(
                                        "legacy_foreign_operation_unresolved:{name}"
                                    ));
                                }
                            }
                        }
                    }
                }
                let mut conflicts = vec![];
                for (canonical, raws) in origins {
                    if raws.len() > 1 {
                        for origin in raws {
                            conflicts.push(HistoricalConflict {
                                origin,
                                canonical_origin: canonical.clone(),
                                source: "legacy_scope".into(),
                            });
                        }
                    }
                }
                conflicts.sort_by(|a, b| {
                    (&a.canonical_origin, &a.origin).cmp(&(&b.canonical_origin, &b.origin))
                });
                let mut record = MigrationRecord {
                    version: 1,
                    id: identifier(),
                    startup_directory: startup_directory.clone(),
                    phase: MigrationPhase::Prepared,
                    profile,
                    files,
                    blockers,
                    conflicts,
                };
                for file in &mut record.files {
                    let raw = &raws[&(file.source.clone(), file.name.clone())];
                    file.active_sha256 =
                        hex(&active_bytes(&file.name, raw, device_value.as_ref())?);
                }
                save_json(&journal_path, &record)?;
                observer(MigrationPhase::Prepared)?;
                record
            }
        };
        let mut file_keys = HashSet::new();
        let profile_invalid = record.profile.as_ref().is_some_and(|p| {
            !valid_id(&p.id)
                || normalize(&p.origin).is_err()
                || normalize(&p.raw_origin).is_err()
                || normalize(&p.origin).ok().as_ref() != Some(&p.origin)
                || normalize(&p.raw_origin).ok().as_ref() != Some(&p.origin)
                || p.binding_revision > MAX_REVISION
                || p.binding_digest
                    .as_ref()
                    .is_some_and(|d| !crate::startup_recovery::digest(d, 64))
        });
        if record.version != 1
            || !valid_id(&record.id)
            || profile_invalid
            || record.files.len() > 4096
            || record.startup_directory != startup_directory
            || record.files.iter().any(|f| {
                !file_keys.insert((&f.source, &f.name))
                    || !["root", "startup"].contains(&f.source.as_str())
                    || !legacy_name(&f.name, f.source == "startup")
                    || f.name.contains(['/', '\\'])
                    || !crate::startup_recovery::digest(&f.sha256, 64)
                    || !crate::startup_recovery::digest(&f.active_sha256, 64)
                    || f.bytes > LIMIT
            })
        {
            return Err(error("PROFILE_MIGRATION_INVALID",format!("migration context rejected: version={} id_valid={} startup_directory_matches={} files={}; required=original bounded manifest",record.version,valid_id(&record.id),record.startup_directory==startup_directory,record.files.len())));
        }
        // Login guardians retain these original locks until every owned descendant has exited.
        let mut _login_locks = vec![];
        for file in &record.files {
            if file.name.starts_with("login-operation-") && file.name.ends_with(".lock") {
                _login_locks.push(OwnershipLock::acquire(
                    &source_directory(&record, &self.root, file)?.join(&file.name),
                )?);
            }
        }
        let backup_parent = self.root.join("profile-migration-backups");
        private_dir(&backup_parent)?;
        let backup = backup_parent.join(&record.id);
        private_dir(&backup)?;
        for source in ["root", "startup"] {
            private_dir(&backup.join(source))?;
        }
        let staging = self
            .root
            .join("profiles")
            .join(format!(".migration-{}", record.id));
        let destination = record
            .profile
            .as_ref()
            .map(|p| self.root.join("profiles").join(&p.id));
        if record.phase == MigrationPhase::Prepared {
            if destination.as_ref().is_none_or(|p| !p.exists()) {
                private_dir(&staging)?;
            }
            if let Some(file) = record
                .files
                .iter()
                .find(|f| f.source == "root" && f.name == "bee-desktop.json")
            {
                let saved = backup.join("root/bee-desktop.json");
                if !saved.exists() {
                    let raw = verify_file(&self.root.join(&file.name), file)?;
                    write(&saved, &raw)?;
                } else {
                    verify_file(&saved, file)?;
                }
            }
            for file in &record.files {
                let saved = backup.join(&file.source).join(&file.name);
                let raw = if saved.exists() {
                    verify_file(&saved, file)?
                } else {
                    let raw = verify_file(
                        &source_directory(&record, &self.root, file)?.join(&file.name),
                        file,
                    )?;
                    write(&saved, &raw)?;
                    raw
                };
                if destination.as_ref().is_none_or(|p| !p.exists()) {
                    let device = record
                        .files
                        .iter()
                        .find(|f| f.source == "root" && f.name == "bee-desktop.json")
                        .and_then(|f| {
                            protected_read_bounded(&backup.join("root").join(&f.name), LIMIT).ok()
                        })
                        .and_then(|raw| unique_value(&raw).ok());
                    let active = active_bytes(&file.name, &raw, device.as_ref())?;
                    if hex(&active) != file.active_sha256 {
                        return Err(error("PROFILE_MIGRATION_CONFLICT",format!("active migration evidence digest mismatch: source={} name={}; required=original selected scope",file.source,file.name)));
                    }
                    let active_destination = active_path(&staging, file);
                    if file.name.ends_with(".bak") {
                        private_dir(&staging.join("legacy-backups"))?;
                    }
                    write(&active_destination, &active)?;
                }
            }
            if let Some(destination) = &destination {
                if !destination.exists() {
                    sync_dir(&staging)?;
                    fs::rename(&staging, destination)
                        .map_err(|e| io_error("publish verified profile directory", e))?;
                    sync_dir(&self.root.join("profiles"))?;
                }
                for file in &record.files {
                    let raw = protected_read_bounded(&active_path(destination, file), LIMIT)
                        .map_err(|e| io_error("validate prepared profile file", e))?;
                    if hex(&raw) != file.active_sha256 {
                        return Err(error("PROFILE_MIGRATION_CONFLICT",format!("prepared profile digest mismatch: source={} name={}; original backups preserved",file.source,file.name)));
                    }
                }
            }
            record.phase = MigrationPhase::Copied;
            save_json(&journal_path, &record)?;
            observer(MigrationPhase::Copied)?;
        }
        // A crash can occur after publishing the directory but before fencing
        // the old path. Revalidate all prepared bytes before publishing an index.
        if [MigrationPhase::Copied, MigrationPhase::Fenced].contains(&record.phase)
            && self.snapshot()?.migration_id.as_deref() != Some(&record.id)
        {
            if let Some(destination) = &destination {
                private_dir(destination)?;
                for file in &record.files {
                    let raw = protected_read_bounded(&active_path(destination, file), LIMIT)
                        .map_err(|e| {
                            io_error("revalidate prepared profile after interruption", e)
                        })?;
                    if hex(&raw) != file.active_sha256 {
                        return Err(error("PROFILE_MIGRATION_CONFLICT",format!("prepared profile changed after interruption: source={} name={}; old entry and backups preserved",file.source,file.name)));
                    }
                }
            }
        }
        if record.phase == MigrationPhase::Copied {
            // The old decoder uses DisallowUnknownFields. A missing file would permit a fresh pairing.
            let refusal =
                serde_json::json!({"profile_migration_required":1,"migration_id":record.id});
            save_json(&self.root.join("bee-desktop.json"), &refusal)?;
            record.phase = MigrationPhase::Fenced;
            save_json(&journal_path, &record)?;
            observer(MigrationPhase::Fenced)?;
        }
        if record.phase == MigrationPhase::Fenced || record.phase == MigrationPhase::Committed {
            let refusal:serde_json::Value=read_json(&self.root.join("bee-desktop.json"))?.ok_or_else(||error("PROFILE_MIGRATION_FENCE","old desktop entry missing; required=durable refusal marker before index publication"))?;
            if refusal["profile_migration_required"] != 1 || refusal["migration_id"] != record.id {
                return Err(error("PROFILE_MIGRATION_FENCE","old desktop refusal marker context_matches=false; original migration must be reconciled"));
            }
            // Do not touch active profile bytes after it is published: the core may have advanced them.
            for file in &record.files {
                verify_file(&backup.join(&file.source).join(&file.name), file)?;
            }
            let mut index = self.snapshot()?;
            if record.phase == MigrationPhase::Committed
                && index.migration_id.as_deref() != Some(&record.id)
            {
                return Err(error("PROFILE_INDEX_MISSING","completed migration index_matches=false; current Hive cannot be reconstructed from an old migration; recover the protected index"));
            }
            if index.migration_id.as_deref() != Some(&record.id) {
                if !index.profiles.is_empty() || index.migration_id.is_some() {
                    return Err(error(
                        "PROFILE_MIGRATION_CONFLICT",
                        "profile index changed before migration commit; preserve both records",
                    ));
                }
                if let Some(profile) = &record.profile {
                    index.profiles.push(profile.clone());
                    index.current_profile = Some(profile.id.clone());
                }
                index.migration_id = Some(record.id.clone());
                index.migration_blockers = record.blockers.clone();
                index.historical_conflicts = record.conflicts.clone();
                index.revision += 1;
                self.save(&index)?;
            }
            // Backups have been verified before removing old independently usable evidence copies.
            for file in &record.files {
                if file.source == "root" && file.name == "bee-desktop.json"
                    || file.name.ends_with(".lock")
                {
                    continue;
                }
                let old = source_directory(&record, &self.root, file)?.join(&file.name);
                if old.exists() {
                    verify_file(&old, file)?;
                    fs::remove_file(&old).map_err(|e| {
                        io_error("archive legacy entry after verified migration", e)
                    })?;
                    sync_dir(old.parent().unwrap())?;
                }
            }
            if record.phase != MigrationPhase::Committed {
                record.phase = MigrationPhase::Committed;
                save_json(&journal_path, &record)?;
                observer(MigrationPhase::Committed)?;
            }
            return Ok(index);
        }
        Err(error(
            "PROFILE_MIGRATION_INVALID",
            "migration stopped in an unhandled phase; no profile activated",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_completed_migration_never_rebuilds_a_lost_index_with_the_old_current_hive() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let store = ProfileStore::open(root.clone()).unwrap();
        write(
            &root.join("bee-desktop.json"),
            br#"{"hive":"https://a.example","name":"A","credential":"synthetic"}"#,
        )
        .unwrap();
        let startup = tmp.path().join("app");
        store.migrate_legacy(&startup).unwrap();
        let b = store.register("https://b.example").unwrap();
        let before = store.snapshot().unwrap();
        store
            .commit_current(before.revision, &b.id, &"a".repeat(48))
            .unwrap();
        fs::remove_file(root.join("hive-profiles.json")).unwrap();
        assert!(store.migrate_legacy(&startup).is_err());
        assert!(!root.join("hive-profiles.json").exists());
    }
    #[test]
    fn v2_scopes_are_attributed_without_occupying_the_next_core_upgrade_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let store = ProfileStore::open(root.clone()).unwrap();
        write(&root.join("bee-desktop.json"),br#"{"hive":"https://a.example","name":"A","credential":"synthetic","identity":{"id":"device","owner_id":"owner"}}"#).unwrap();
        let original = serde_json::json!({"version":2,"revision":1,"entries":{},"scopes":{
            "original-a":{"hive":"https://a.example","owner_id":"owner","device_id":"device","pending_operations":{}},
            "original-b":{"hive":"https://b.example","owner_id":"other","device_id":"other","pending_operations":{}}
        }});
        write(
            &root.join("ai-accounts.json"),
            &serde_json::to_vec(&original).unwrap(),
        )
        .unwrap();
        write(
            &root.join("ai-accounts.json.v1.bak"),
            b"original v1 archive",
        )
        .unwrap();
        let index = store.migrate_legacy(&tmp.path().join("app")).unwrap();
        let current = store
            .context(index.current_profile.as_ref().unwrap())
            .unwrap();
        let active: serde_json::Value = read_json(&current.directory().join("ai-accounts.json"))
            .unwrap()
            .unwrap();
        assert_eq!(active["scopes"].as_object().unwrap().len(), 1);
        assert_eq!(
            active["scopes"]["original-a"],
            original["scopes"]["original-a"]
        );
        assert_eq!(
            protected_read_bounded(
                &current
                    .directory()
                    .join("legacy-backups/ai-accounts.json.v1.bak"),
                LIMIT
            )
            .unwrap(),
            b"original v1 archive"
        );
        assert!(!current.directory().join("ai-accounts.json.v1.bak").exists());
    }
    #[test]
    fn startup_recovery_uses_the_selected_profile_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ProfileStore::open(tmp.path().join("tokhive")).unwrap();
        let a = store.register("https://a.example").unwrap();
        let b = store.register("https://b.example").unwrap();
        write(
            &b.directory().join("desktop-startup-recovery.json"),
            b"corrupt original B evidence",
        )
        .unwrap();
        assert!(a.startup_journal().load().unwrap().is_none());
        assert_eq!(
            b.startup_journal().load().unwrap_err().code,
            "RECOVERY_JOURNAL_INVALID"
        );
    }
    #[test]
    fn fresh_profile_initialization_also_fences_the_legacy_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let store = ProfileStore::open(root.clone()).unwrap();
        let index = store.migrate_legacy(&tmp.path().join("app")).unwrap();
        assert!(index.current_profile.is_none());
        assert!(index.migration_blockers.is_empty());
        let marker: serde_json::Value = read_json(&root.join("bee-desktop.json")).unwrap().unwrap();
        assert_eq!(marker["profile_migration_required"], 1);
        assert_eq!(marker["migration_id"], index.migration_id.unwrap());
    }
    #[test]
    fn copied_profile_is_reverified_before_fencing_the_old_entry_on_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let store = ProfileStore::open(root.clone()).unwrap();
        let original = br#"{"hive":"https://a.example","name":"A","credential":"synthetic"}"#;
        write(&root.join("bee-desktop.json"), original).unwrap();
        let startup = tmp.path().join("app");
        assert!(store
            .migrate_legacy_observed(&startup, |phase| if phase == MigrationPhase::Copied {
                Err(error("INJECTED", "simulated process exit"))
            } else {
                Ok(())
            })
            .is_err());
        let record: MigrationRecord = read_json(&root.join("profile-migration.json"))
            .unwrap()
            .unwrap();
        let directory = root.join("profiles").join(record.profile.unwrap().id);
        write(
            &directory.join("bee-desktop.json"),
            b"corrupted-after-crash",
        )
        .unwrap();
        assert!(store.migrate_legacy(&startup).is_err());
        assert_eq!(
            protected_read_bounded(&root.join("bee-desktop.json"), LIMIT).unwrap(),
            original
        );
        assert!(store.snapshot().unwrap().current_profile.is_none());
    }
    #[test]
    fn altered_migration_profile_paths_are_rejected_before_any_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let store = ProfileStore::open(root.clone()).unwrap();
        write(
            &root.join("bee-desktop.json"),
            br#"{"hive":"https://a.example","name":"A","credential":"synthetic"}"#,
        )
        .unwrap();
        let startup = tmp.path().join("app");
        assert!(store
            .migrate_legacy_observed(&startup, |phase| if phase == MigrationPhase::Prepared {
                Err(error("INJECTED", "simulated process loss"))
            } else {
                Ok(())
            })
            .is_err());
        let mut journal: MigrationRecord = read_json(&root.join("profile-migration.json"))
            .unwrap()
            .unwrap();
        journal.profile.as_mut().unwrap().id = "../escape".into();
        save_json(&root.join("profile-migration.json"), &journal).unwrap();
        assert!(store.migrate_legacy(&startup).is_err());
        assert!(!root.join("escape").exists());
        assert!(!root.join("profile-migration-backups").exists());
    }
    #[test]
    fn runtime_epoch_changes_do_not_change_the_persistent_binding_version() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ProfileStore::open(tmp.path().join("tokhive")).unwrap();
        let a = store.register("https://a.example").unwrap();
        let mut binding = serde_json::json!({"hive":"https://a.example","name":"A","credential":"synthetic","identity":{"id":"device","owner_id":"owner"}});
        write(&a.device_path(), &serde_json::to_vec(&binding).unwrap()).unwrap();
        let before = store
            .refresh_binding(store.snapshot().unwrap().revision, &a.id)
            .unwrap();
        binding["runtime_epoch"] = serde_json::json!("a".repeat(48));
        write(&a.device_path(), &serde_json::to_vec(&binding).unwrap()).unwrap();
        assert_eq!(
            store.refresh_binding(before.revision, &a.id).unwrap(),
            before
        );
    }
    #[test]
    fn unfinished_migration_cannot_be_bypassed_by_registering_a_new_hive() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let store = ProfileStore::open(root.clone()).unwrap();
        write(
            &root.join("bee-desktop.json"),
            br#"{"hive":"https://a.example","name":"A","credential":"synthetic"}"#,
        )
        .unwrap();
        assert!(store.register("https://b.example").is_err());
        assert!(store
            .migrate_legacy_observed(&tmp.path().join("app"), |phase| {
                if phase == MigrationPhase::Prepared {
                    Err(error("INJECTED", "simulated process exit"))
                } else {
                    Ok(())
                }
            })
            .is_err());
        assert!(store.register("https://b.example").is_err());
        assert!(store.snapshot().unwrap().profiles.is_empty());
        store.migrate_legacy(&tmp.path().join("app")).unwrap();
        assert!(store.register("https://b.example").is_ok());
    }
    #[test]
    fn verified_binding_versions_and_proxy_choice_stay_in_their_profile() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ProfileStore::open(tmp.path().join("tokhive")).unwrap();
        let a = store.register("https://a.example").unwrap();
        let b = store.register("https://b.example").unwrap();
        write(
            &a.device_path(),
            br#"{"hive":"https://a.example","credential":"synthetic"}"#,
        )
        .unwrap();
        let before = store.snapshot().unwrap();
        let index = store.refresh_binding(before.revision, &a.id).unwrap();
        assert_eq!(index.profiles[0].binding_revision, 1);
        assert_eq!(index.profiles[1].binding_revision, 0);
        assert_eq!(store.refresh_binding(index.revision, &a.id).unwrap(), index);
        assert!(store.refresh_binding(before.revision, &a.id).is_err());
        let mut prefs = crate::preferences::DesktopPreferences::default();
        prefs.proxies = vec![
            crate::preferences::ProxyPreference {
                origin: a.origin.clone(),
                device_scope: Some("a".repeat(64)),
                connect_proxy: "http://127.0.0.1:9001".into(),
            },
            crate::preferences::ProxyPreference {
                origin: b.origin.clone(),
                device_scope: Some("a".repeat(64)),
                connect_proxy: "http://127.0.0.1:9002".into(),
            },
        ];
        assert_eq!(
            a.proxy_for(&prefs, Some(&"a".repeat(64))).unwrap(),
            "http://127.0.0.1:9001"
        );
        assert_eq!(
            b.proxy_for(&prefs, Some(&"a".repeat(64))).unwrap(),
            "http://127.0.0.1:9002"
        );
        assert_eq!(a.proxy_for(&prefs, Some(&"b".repeat(64))).unwrap(), "");
        prefs.proxies.push(crate::preferences::ProxyPreference {
            origin: a.origin.clone(),
            device_scope: Some("a".repeat(64)),
            connect_proxy: "http://127.0.0.1:9003".into(),
        });
        assert_eq!(
            a.proxy_for(&prefs, Some(&"a".repeat(64))).unwrap_err().code,
            "PROFILE_PROXY_CONFLICT"
        );
        assert!(b.proxy_for(&prefs, Some(&"a".repeat(64))).is_ok());
    }
    #[test]
    fn every_durable_migration_stage_resumes_the_same_profile_and_backup() {
        for interrupted in [
            MigrationPhase::Prepared,
            MigrationPhase::Copied,
            MigrationPhase::Fenced,
            MigrationPhase::Committed,
        ] {
            let tmp = tempfile::tempdir().unwrap();
            let root = tmp.path().join("tokhive");
            private_dir(&root).unwrap();
            let original = br#"{"hive":"https://a.example","name":"A","credential":"synthetic"}"#;
            write(&root.join("bee-desktop.json"), original).unwrap();
            write(&root.join("runtime-session"), b"original-dirty-guard\n").unwrap();
            let store = ProfileStore::open(root.clone()).unwrap();
            let startup = tmp.path().join("app");
            assert!(store
                .migrate_legacy_observed(&startup, |phase| if phase == interrupted {
                    Err(error(
                        "INJECTED",
                        "simulated process exit after durable boundary",
                    ))
                } else {
                    Ok(())
                })
                .is_err());
            let record: MigrationRecord = read_json(&root.join("profile-migration.json"))
                .unwrap()
                .unwrap();
            drop(store);
            let reopened = ProfileStore::open(root.clone()).unwrap();
            let index = reopened.migrate_legacy(&startup).unwrap();
            assert_eq!(index.migration_id.as_deref(), Some(record.id.as_str()));
            assert_eq!(
                index.current_profile.as_deref(),
                record.profile.as_ref().map(|p| p.id.as_str())
            );
            let context = reopened
                .context(index.current_profile.as_ref().unwrap())
                .unwrap();
            assert_eq!(
                protected_read_bounded(&context.device_path(), LIMIT).unwrap(),
                original
            );
            let backup = root
                .join("profile-migration-backups")
                .join(record.id)
                .join("root/bee-desktop.json");
            assert_eq!(protected_read_bounded(&backup, LIMIT).unwrap(), original);
            write(&context.device_path(), b"advanced-by-owned-core").unwrap();
            assert_eq!(reopened.migrate_legacy(&startup).unwrap(), index);
            assert_eq!(
                protected_read_bounded(&context.device_path(), LIMIT).unwrap(),
                b"advanced-by-owned-core"
            );
        }
    }
    #[test]
    fn app_old_manager_and_login_guardian_ownership_block_migration() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let store = ProfileStore::open(root.clone()).unwrap();
        assert_eq!(
            ProfileStore::open(root.clone()).err().unwrap().code,
            "PROFILE_OWNER_BUSY"
        );
        write(
            &root.join("bee-desktop.json"),
            br#"{"hive":"https://a.example","name":"A","credential":"synthetic"}"#,
        )
        .unwrap();
        let old = OwnershipLock::acquire(&root.join("bee-desktop.json.lock")).unwrap();
        assert_eq!(
            store
                .migrate_legacy(&tmp.path().join("app"))
                .unwrap_err()
                .code,
            "PROFILE_OWNER_BUSY"
        );
        assert!(!root.join("profile-migration.json").exists());
        drop(old);
        let guardian = OwnershipLock::acquire(&root.join("login-operation-original.lock")).unwrap();
        assert_eq!(
            store
                .migrate_legacy(&tmp.path().join("app"))
                .unwrap_err()
                .code,
            "PROFILE_OWNER_BUSY"
        );
        assert!(!root.join("profile-migration-backups").exists());
        drop(guardian);
        assert!(store.migrate_legacy(&tmp.path().join("app")).is_ok());
    }
    #[cfg(unix)]
    #[test]
    fn linked_or_unprotected_legacy_evidence_cannot_be_migrated() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let store = ProfileStore::open(root.clone()).unwrap();
        let outside = tmp.path().join("outside");
        write(&outside, b"private outside evidence").unwrap();
        symlink(&outside, root.join("bee-desktop.json")).unwrap();
        assert!(store.migrate_legacy(&tmp.path().join("app")).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"private outside evidence");
        fs::remove_file(root.join("bee-desktop.json")).unwrap();
        fs::write(root.join("bee-desktop.json"), b"unprotected").unwrap();
        fs::set_permissions(
            root.join("bee-desktop.json"),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        assert!(store.migrate_legacy(&tmp.path().join("app")).is_err());
        assert!(!root.join("profile-migration.json").exists());
        assert_eq!(
            fs::read(root.join("bee-desktop.json")).unwrap(),
            b"unprotected"
        );
    }
    #[test]
    fn corrupt_duplicate_scope_data_is_retained_and_blocks_recovery() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        private_dir(&root).unwrap();
        write(&root.join("bee-desktop.json"),br#"{"hive":"https://a.example","name":"A","credential":"synthetic","identity":{"id":"device","owner_id":"owner"}}"#).unwrap();
        let original=br#"{"version":3,"revision":7,"revision":8,"entries":{},"scopes":{"old":{"hive":"https://other.example","owner_id":"other","device_id":"other","pending_operations":{}}}}"#;
        write(&root.join("ai-accounts.json"), original).unwrap();
        let store = ProfileStore::open(root).unwrap();
        let index = store.migrate_legacy(&tmp.path().join("app")).unwrap();
        let current = store
            .context(index.current_profile.as_ref().unwrap())
            .unwrap();
        assert_eq!(
            protected_read_bounded(&current.directory().join("ai-accounts.json"), LIMIT).unwrap(),
            original
        );
        assert!(index.profiles[0]
            .blockers
            .iter()
            .any(|b| b == "legacy_record_invalid:root/ai-accounts.json"));
    }
    #[test]
    fn missing_registered_directory_is_not_recreated_as_an_unbound_hive() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ProfileStore::open(tmp.path().join("tokhive")).unwrap();
        let context = store.register("https://a.example").unwrap();
        fs::remove_dir(context.directory()).unwrap();
        assert!(store.context(&context.id).is_err());
        assert!(!context.directory().exists());
    }
    #[test]
    fn foreign_history_is_archived_and_never_becomes_current_activity() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        private_dir(&root).unwrap();
        write(&root.join("bee-desktop.json"),br#"{"hive":"https://hive.example","name":"A","credential":"synthetic","identity":{"id":"device","owner_id":"owner"}}"#).unwrap();
        let accounts = serde_json::json!({"version":3,"revision":7,"entries":{},"scopes":{
            "original-digest-a":{"hive":"https://hive.example","owner_id":"owner","device_id":"device","pending_operations":{},"selections":{"openai":{"source":{"directory":"/official/source","store":"file"}}}},
            "original-digest-b":{"hive":"https://HIVE.example:443/","owner_id":"older","device_id":"older","pending_operations":{},"selections":{}},
            "original-digest-c":{"hive":"https://other.example","owner_id":"other","device_id":"other","pending_operations":{},"selections":{}},
            "original-digest-d":{"hive":"https://OTHER.example:443/","owner_id":"older-other","device_id":"older-other","pending_operations":{},"selections":{}}
        }});
        write(
            &root.join("ai-accounts.json"),
            &serde_json::to_vec(&accounts).unwrap(),
        )
        .unwrap();
        let store = ProfileStore::open(root.clone()).unwrap();
        let index = store.migrate_legacy(&tmp.path().join("app")).unwrap();
        assert_eq!(index.profiles.len(), 1);
        assert_eq!(index.historical_conflicts.len(), 4);
        let context = store
            .context(index.current_profile.as_ref().unwrap())
            .unwrap();
        let active: serde_json::Value = read_json(&context.directory().join("ai-accounts.json"))
            .unwrap()
            .unwrap();
        assert_eq!(active["scopes"].as_object().unwrap().len(), 1);
        assert_eq!(
            active["scopes"]["original-digest-a"],
            accounts["scopes"]["original-digest-a"]
        );
        assert!(index.profiles[0].blockers.is_empty());
        let target = store.register("https://other.example/").unwrap();
        let blocked = store.snapshot().unwrap();
        assert_eq!(blocked.current_profile, index.current_profile);
        assert_eq!(blocked.profiles.len(), 2, "history alone must not create connectable profiles");
        let target_entry = blocked.profiles.iter().find(|p| p.id == target.id).unwrap();
        assert_eq!(target_entry.blockers, vec!["historical_origin_conflict:https://other.example"]);
        assert_eq!(store.commit_current(blocked.revision, &target.id, &"a".repeat(48)).unwrap_err().code, "PROFILE_BLOCKED");
        // An index published by the earlier client may already contain this
        // target with empty blockers. Its next public projection must be safe.
        let mut old_index = blocked;
        old_index.profiles.iter_mut().find(|p| p.id == target.id).unwrap().blockers.clear();
        store.save(&old_index).unwrap();
        assert!(!store.snapshot().unwrap().profiles.iter().find(|p| p.id == target.id).unwrap().blockers.is_empty());
        assert_eq!(store.register("https://HIVE.example:443/").unwrap(), context);
        let backup = root
            .join("profile-migration-backups")
            .join(index.migration_id.unwrap())
            .join("root/ai-accounts.json");
        assert_eq!(
            read_json::<serde_json::Value>(&backup).unwrap().unwrap(),
            accounts
        );
    }
    #[test]
    fn legacy_evidence_survives_restart_after_old_entry_is_fenced() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tokhive");
        let startup = tmp.path().join("app");
        private_dir(&root).unwrap();
        private_dir(&startup).unwrap();
        let originals=[
            ("bee-desktop.json",br#"{"hive":"https://A.example:443/","name":"original","credential":"synthetic-private","identity":{"id":"dev-a","owner_id":"owner-a"}}"#.to_vec()),
            ("runtime-session",b"dirty-original-run\n".to_vec()),
            ("bee-desktop-recovery.json",b"{corrupt-original-pairing".to_vec()),
            ("ai-accounts.json.v2.bak",b"old-account-backup".to_vec()),
            ("desktop-session-retirement-old.json",b"original-proof-bytes".to_vec()),
        ];
        for (name, raw) in &originals {
            write(&root.join(name), raw).unwrap();
        }
        write(
            &startup.join("desktop-startup-recovery.json"),
            b"original-startup-evidence",
        )
        .unwrap();
        let store = ProfileStore::open(root.clone()).unwrap();
        assert!(store
            .migrate_legacy_observed(&startup, |phase| if phase == MigrationPhase::Fenced {
                Err(error(
                    "INJECTED",
                    "simulated process loss after durable old-entry fencing",
                ))
            } else {
                Ok(())
            })
            .is_err());
        assert!(store.snapshot().unwrap().current_profile.is_none());
        let fenced = protected_read_bounded(&root.join("bee-desktop.json"), LIMIT).unwrap();
        assert!(!String::from_utf8_lossy(&fenced).contains("synthetic-private"));
        assert!(String::from_utf8_lossy(&fenced).contains("profile_migration_required"));
        drop(store);
        let reopened = ProfileStore::open(root.clone()).unwrap();
        let index = reopened.migrate_legacy(&startup).unwrap();
        let context = reopened
            .context(index.current_profile.as_ref().unwrap())
            .unwrap();
        assert_eq!(context.origin, "https://a.example");
        for (name, raw) in originals {
            assert_eq!(
                protected_read_bounded(
                    &context
                        .directory()
                        .join(if name == "ai-accounts.json.v2.bak" {
                            "legacy-backups/ai-accounts.json.v2.bak"
                        } else {
                            name
                        }),
                    LIMIT
                )
                .unwrap(),
                raw
            );
        }
        assert_eq!(
            protected_read_bounded(
                &context.directory().join("desktop-startup-recovery.json"),
                LIMIT
            )
            .unwrap(),
            b"original-startup-evidence"
        );
        assert_eq!(reopened.migrate_legacy(&startup).unwrap(), index);
        assert!(!root.join("ai-accounts.json.v2.bak").exists());
    }
    #[test]
    fn each_hive_keeps_its_directory_and_commit_is_revision_checked() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ProfileStore::open(tmp.path().join("tokhive")).unwrap();
        let a = store.register("https://a.example").unwrap();
        let b = store.register("https://b.example").unwrap();
        assert_ne!(a.directory(), b.directory());
        assert_eq!(store.register("https://a.example").unwrap(), a);
        let before = store.snapshot().unwrap();
        let after = store
            .commit_current(before.revision, &b.id, &"a".repeat(48))
            .unwrap();
        assert_eq!(after.current_profile.as_deref(), Some(b.id.as_str()));
        assert_eq!(
            after.committed_operation.as_deref(),
            Some("a".repeat(48).as_str())
        );
        assert!(store
            .commit_current(after.revision, &a.id, &"a".repeat(48))
            .is_err());
        assert!(store
            .commit_current(before.revision, &a.id, &"b".repeat(48))
            .is_err());
        drop(store);
        let reopened = ProfileStore::open(tmp.path().join("tokhive")).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), after);
        assert_eq!(reopened.context(&a.id).unwrap(), a);
    }
}
