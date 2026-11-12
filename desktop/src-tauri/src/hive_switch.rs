//! App-owned durable handoff between fixed Hive profile processes.
use crate::{
    preferences::{private_write, protected_read_bounded},
    protocol::BridgeError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
fn id() -> String {
    format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{}:{}:{}",
                std::process::id(),
                time::OffsetDateTime::now_utc().unix_timestamp_nanos(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            )
            .as_bytes()
        )
    )[..48]
        .into()
}
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
fn error(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError::new(code, message.into())
}
fn io_error(stage: &str, e: std::io::Error) -> BridgeError {
    error(
        "HIVE_SWITCH_JOURNAL_IO",
        format!(
            "{stage}: {e}; kind={:?} os_code={:?}; original evidence retained",
            e.kind(),
            e.raw_os_error()
        ),
    )
}
// `current` is a fresh server observation; the terminal action and receipt are
// immutable even when an ordinary connection changes the lease/work afterwards.
fn same_released_proof(a: &Value, b: &Value) -> bool {
    a["state"] == "released"
        && b["state"] == "released"
        && [
            "version",
            "device_id",
            "owner_id",
            "operation_id",
            "request",
            "seal",
            "release",
            "receipt",
        ]
        .iter()
        .all(|key| a[*key] == b[*key])
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SwitchLeg {
    pub profile: String,
    #[serde(deserialize_with = "present")]
    pub binding_revision: Option<u64>,
    #[serde(deserialize_with = "present")]
    pub binding_digest: Option<String>,
    #[serde(deserialize_with = "present")]
    pub instance: Option<String>,
    #[serde(deserialize_with = "present")]
    pub process_binding_revision: Option<u64>,
    pub network_revision: u64,
    #[serde(deserialize_with = "present")]
    pub operation: Option<Value>,
    #[serde(deserialize_with = "present")]
    pub seal: Option<Value>,
    #[serde(deserialize_with = "present")]
    pub release: Option<Value>,
    #[serde(deserialize_with = "present")]
    pub status: Option<Value>,
    #[serde(deserialize_with = "present")]
    pub pending: Option<String>,
    pub workers_stopped: bool,
    pub child_reaped: bool,
    pub ipc_empty: bool,
    pub verified: bool,
}
impl SwitchLeg {
    fn resolves(&self, action: &str, status: &Value) -> bool {
        match action {
            "drain_begin" => matches!(
                status["state"].as_str(),
                Some("draining" | "ready" | "sealing" | "sealed" | "released")
            ),
            "drain_seal" => {
                status["receipt"].is_object() && Some(&status["seal"]) == self.seal.as_ref()
            }
            "drain_release" => {
                status["state"] == "released" && Some(&status["release"]) == self.release.as_ref()
            }
            _ => false,
        }
    }
    fn new(profile: String) -> Self {
        Self {
            profile,
            binding_revision: None,
            binding_digest: None,
            instance: None,
            process_binding_revision: None,
            network_revision: 0,
            operation: None,
            seal: None,
            release: None,
            status: None,
            pending: None,
            workers_stopped: false,
            child_reaped: false,
            ipc_empty: false,
            verified: false,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SwitchRecord {
    pub version: u32,
    pub id: String,
    pub source: SwitchLeg,
    pub target: SwitchLeg,
    pub phase: String,
    #[serde(deserialize_with = "present")]
    pub source_index_operation: Option<String>,
    #[serde(deserialize_with = "present")]
    pub commit_revision: Option<u64>,
    pub committed: bool,
    pub cancel_requested: bool,
    pub quit_requested: bool,
    pub observation_round: u64,
    #[serde(deserialize_with = "present")]
    pub observation_started: Option<String>,
    pub query_failures: u32,
    #[serde(deserialize_with = "present")]
    pub failure: Option<BridgeError>,
}
impl SwitchRecord {
    pub(crate) fn new(source: String, target: String) -> Self {
        Self {
            version: 1,
            id: id(),
            source: SwitchLeg::new(source),
            target: SwitchLeg::new(target),
            phase: "preparing_target".into(),
            source_index_operation: None,
            commit_revision: None,
            committed: false,
            cancel_requested: false,
            quit_requested: false,
            observation_round: 0,
            observation_started: None,
            query_failures: 0,
            failure: None,
        }
    }
    pub(crate) fn terminal(&self) -> bool {
        matches!(self.phase.as_str(), "succeeded" | "failed" | "cancelled")
    }
}
/// The only persisted switch writer, serialized by HiveSwitch. Every remote write
/// is recorded as pending before IPC; pending survives transport and App failure.
pub(crate) struct SwitchJournal {
    pub(crate) path: PathBuf,
}
impl SwitchJournal {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub(crate) fn load(&self) -> Result<Option<SwitchRecord>, BridgeError> {
        let raw = match protected_read_bounded(&self.path, 1_048_576) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(io_error("read protected switch journal", e)),
        };
        let value = crate::profiles::unique_value(&raw).map_err(|e| {
            error(
                "HIVE_SWITCH_JOURNAL_INVALID",
                format!(
                    "switch journal unique JSON rejected: category={:?} line={} column={}",
                    e.classify(),
                    e.line(),
                    e.column()
                ),
            )
        })?;
        let record:SwitchRecord=serde_json::from_value(value).map_err(|e|error("HIVE_SWITCH_JOURNAL_INVALID",format!("switch journal JSON rejected: category={:?} line={} column={}; original preserved",e.classify(),e.line(),e.column())))?;
        Self::validate(&record)?;
        Ok(Some(record))
    }
    fn validate(r: &SwitchRecord) -> Result<(), BridgeError> {
        if r.version != 1
            || !crate::startup_recovery::digest(&r.id, 48)
            || r.source_index_operation
                .as_ref()
                .is_some_and(|v| !crate::startup_recovery::digest(v, 48))
            || r.source.profile == r.target.profile
            || [&r.source, &r.target]
                .iter()
                .any(|l| !crate::startup_recovery::digest(&l.profile, 32))
        {
            return Err(error("HIVE_SWITCH_JOURNAL_INVALID",format!("switch context rejected: version={} distinct_profiles={}; required=version 1 and distinct registered IDs",r.version,r.source.profile!=r.target.profile)));
        }
        if ![
            "preparing_target",
            "draining_source",
            "stopping_source",
            "connecting_target",
            "committing_current",
            "releasing_target",
            "restoring_source",
            "succeeded",
            "failed",
            "cancelled",
        ]
        .contains(&r.phase.as_str())
            || r.committed && !["releasing_target", "succeeded"].contains(&r.phase.as_str())
            || r.phase == "succeeded"
                && (!r.committed
                    || !r.target.verified
                    || !r.source.child_reaped
                    || r.target
                        .status
                        .as_ref()
                        .is_none_or(|s| s["state"] != "released"))
        {
            return Err(error("HIVE_SWITCH_JOURNAL_INVALID",format!("switch phase evidence rejected: phase={} committed={} target_verified={} source_reaped={}",r.phase,r.committed,r.target.verified,r.source.child_reaped)));
        }
        for l in [&r.source, &r.target] {
            if l.binding_revision.is_some() != l.binding_digest.is_some()
                || l.binding_digest
                    .as_ref()
                    .is_some_and(|v| !crate::startup_recovery::digest(v, 64))
                || l.binding_revision
                    .is_some_and(|n| n == 0 || n > 9_007_199_254_740_991)
                || l.instance
                    .as_ref()
                    .is_some_and(|v| !crate::startup_recovery::digest(v, 32))
                || l.process_binding_revision
                    .is_some_and(|n| n == 0 || n > 9_007_199_254_740_991)
                || l.pending.is_some() && l.operation.is_none()
            {
                return Err(error("HIVE_SWITCH_JOURNAL_INVALID",format!("switch leg={} binding/process/action evidence shape rejected; original retained",l.profile)));
            }
            if let Some(op) = &l.operation {
                crate::switch_protocol::request(op)?;
            }
            if let Some(seal) = &l.seal {
                crate::switch_protocol::seal(
                    seal,
                    l.operation.as_ref().ok_or_else(|| {
                        error(
                            "HIVE_SWITCH_JOURNAL_INVALID",
                            "seal original operation missing",
                        )
                    })?,
                )?;
            }
            if let Some(release) = &l.release {
                crate::switch_protocol::release(
                    release,
                    l.operation.as_ref().ok_or_else(|| {
                        error(
                            "HIVE_SWITCH_JOURNAL_INVALID",
                            "release original operation missing",
                        )
                    })?,
                )?;
            }
            if let Some(status) = &l.status {
                crate::switch_protocol::drain(
                    status,
                    l.operation.as_ref().ok_or_else(|| {
                        error(
                            "HIVE_SWITCH_JOURNAL_INVALID",
                            "status original operation missing",
                        )
                    })?,
                )?;
            }
            if l.child_reaped && (!l.workers_stopped || !l.ipc_empty)
                || l.pending.as_ref().is_some_and(|p| {
                    !matches!(p.as_str(), "drain_begin" | "drain_seal" | "drain_release")
                })
            {
                return Err(error("HIVE_SWITCH_JOURNAL_INVALID",format!("switch leg proof rejected: reaped={} workers_stopped={} ipc_empty={} pending={:?}",l.child_reaped,l.workers_stopped,l.ipc_empty,l.pending)));
            }
        }
        Ok(())
    }
    pub(crate) fn save(&self, r: &SwitchRecord) -> Result<(), BridgeError> {
        Self::validate(r)?;
        if let Some(old) = self.load()? {
            if old.id != r.id {
                if !old.terminal() {
                    return Err(error(
                        "HIVE_SWITCH_BUSY",
                        format!(
                            "switch operation={} phase={} unresolved; second operation rejected",
                            old.id, old.phase
                        ),
                    ));
                }
                let archive = Self::new(
                    self.path
                        .with_file_name(format!("desktop-hive-switch-{}.json", old.id)),
                );
                match archive.load()? {
                    Some(existing)
                        if serde_json::to_value(&existing).ok()
                            != serde_json::to_value(&old).ok() =>
                    {
                        return Err(error(
                            "HIVE_SWITCH_JOURNAL_CONFLICT",
                            "prior terminal switch archive differs; preserved without overwrite",
                        ))
                    }
                    Some(_) => {}
                    None => archive.write(&old)?,
                }
            } else {
                if old.source_index_operation != r.source_index_operation {
                    return Err(error("HIVE_SWITCH_JOURNAL_CONFLICT","source index predecessor changed within the original switch; evidence preserved"));
                }
                for (a, b) in [(&old.source, &r.source), (&old.target, &r.target)] {
                    if let Some(action) = a.pending.as_deref() {
                        if b.pending.as_deref() != Some(action)
                            && (b.pending.is_some()
                                || b.status.as_ref().is_none_or(|s| !b.resolves(action, s)))
                        {
                            return Err(error("HIVE_SWITCH_JOURNAL_CONFLICT",format!("original pending action={action} lacks its matching completion evidence; replacement rejected")));
                        }
                    }
                    if a.profile != b.profile
                        || a.binding_revision.is_some() && a.binding_revision != b.binding_revision
                        || a.binding_digest.is_some() && a.binding_digest != b.binding_digest
                        || a.operation.is_some() && a.operation != b.operation
                        || a.seal.is_some() && a.seal != b.seal
                        || a.release.is_some() && a.release != b.release
                    {
                        return Err(error("HIVE_SWITCH_JOURNAL_CONFLICT","switch immutable profile, binding or original remote action changed; original evidence preserved"));
                    }
                }
                if old.committed && !r.committed
                    || old.terminal()
                        && serde_json::to_value(&old).ok() != serde_json::to_value(r).ok()
                {
                    return Err(error(
                        "HIVE_SWITCH_JOURNAL_CONFLICT",
                        "switch committed/terminal result cannot be reversed",
                    ));
                }
            }
        }
        self.write(r)
    }
    fn write(&self, r: &SwitchRecord) -> Result<(), BridgeError> {
        // Validate destination security before rename; private_write protects temp
        // creation but cannot itself reject replacing a symbolic link.
        match protected_read_bounded(&self.path, 1_048_576) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io_error("validate protected switch destination", e)),
        }
        let raw = serde_json::to_vec(r).map_err(|e| {
            error(
                "HIVE_SWITCH_JOURNAL_INVALID",
                format!("encode switch journal: {e}"),
            )
        })?;
        private_write(&self.path, &raw)
            .map_err(|e| io_error("persist switch journal before action", e))?;
        let actual = protected_read_bounded(&self.path, 1_048_576)
            .map_err(|e| io_error("read back switch journal", e))?;
        if actual != raw {
            return Err(error(
                "HIVE_SWITCH_WRITE_UNCONFIRMED",
                "switch journal readback_matches=false; no action authorized",
            ));
        }
        Ok(())
    }
}

use crate::{
    preferences::PreferencesSnapshot,
    profiles::{ProfileContext, ProfileIndex, ProfileMode, ProfileStore},
    sidecar::{Bridge, BridgePhase, LaunchSpec},
};
use serde_json::json;
use std::{
    path::Path,
    sync::{Arc, RwLock},
};
use tokio::sync::{watch, Mutex};

#[derive(Clone)]
pub(crate) struct CurrentBridge {
    value: Arc<RwLock<Option<(Option<ProfileContext>, Bridge)>>>,
    changed: watch::Sender<u64>,
}
impl Default for CurrentBridge {
    fn default() -> Self {
        Self {
            value: Default::default(),
            changed: watch::channel(0).0,
        }
    }
}
impl CurrentBridge {
    pub(crate) fn get(&self) -> Result<Bridge, BridgeError> {
        self.value
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|(_, b)| b.clone())
            .ok_or_else(|| {
                error(
                    "HIVE_PROFILE_REQUIRED",
                    "current Hive is not configured; select a Hive address to bind this device",
                )
            })
    }
    pub(crate) fn context(&self) -> Option<ProfileContext> {
        self.value
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .and_then(|(c, _)| c.clone())
    }
    pub(crate) fn replace(&self, context: Option<ProfileContext>, bridge: Bridge) {
        *self.value.write().unwrap_or_else(|e| e.into_inner()) = Some((context, bridge));
        self.changed.send_modify(|n| *n += 1);
    }
    pub(crate) fn subscribe(&self) -> watch::Receiver<u64> {
        self.changed.subscribe()
    }
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct SwitchSnapshot {
    pub profiles: ProfileIndex,
    pub operation: Option<SwitchRecord>,
}
/// Holds the App ownership lock from migration until final shutdown. A target
/// preparation child never becomes the current route before the index commit.
pub(crate) struct HiveSwitch {
    pub(crate) profiles: Arc<ProfileStore>,
    pub(crate) current: CurrentBridge,
    pub(crate) journal: SwitchJournal,
    pub(crate) serial: Mutex<()>,
    target: Mutex<Option<(ProfileContext, ProfileMode, Bridge)>>,
    launch: LaunchSpec,
}
impl HiveSwitch {
    pub(crate) fn open(root: PathBuf, startup: &Path) -> Result<Self, BridgeError> {
        let profiles = Arc::new(ProfileStore::open(root)?);
        profiles.migrate_legacy(startup)?;
        let launch = Bridge::bundled_spec()?;
        Self::from_store(profiles, launch)
    }
    pub(crate) fn from_store(
        profiles: Arc<ProfileStore>,
        launch: LaunchSpec,
    ) -> Result<Self, BridgeError> {
        let current = CurrentBridge::default();
        let journal = SwitchJournal::new(profiles.root().join("desktop-hive-switch.json"));
        // Load before spawning any process. Damaged/unresolved switch evidence
        // must never fall through to ordinary runtime retirement and restore.
        let record = journal.load()?;
        let index = profiles.snapshot()?;
        let reaped_source = record.as_ref().is_some_and(|r| {
            !r.terminal()
                && r.source.child_reaped
                && index.current_profile.as_deref() == Some(&r.source.profile)
        });
        if let Some(id) = index.current_profile.as_ref().filter(|_| !reaped_source) {
            let context = profiles.context(id)?;
            let mode = if record
                .as_ref()
                .is_some_and(|r| !r.terminal() && r.target.profile == *id)
            {
                ProfileMode::Activate
            } else {
                ProfileMode::Current
            };
            let bridge = Bridge::start(launch.clone().for_profile(&context, mode)?);
            crate::update_install::hold_startup(&bridge);
            current.replace(Some(context), bridge);
        }
        Ok(Self {
            profiles,
            current,
            journal,
            serial: Mutex::new(()),
            target: Mutex::new(None),
            launch,
        })
    }
    pub(crate) fn snapshot(&self) -> Result<SwitchSnapshot, BridgeError> {
        Ok(SwitchSnapshot {
            profiles: self.profiles.snapshot()?,
            operation: self.journal.load()?,
        })
    }
    pub(crate) fn pending(&self) -> Result<bool, BridgeError> {
        Ok(self.journal.load()?.is_some_and(|r| !r.terminal()))
    }
    /// A released Go proof deliberately starts frozen. Only the native owner can
    /// bind that proof to the actual current index before ordinary startup.
    pub(crate) async fn restore_current_admission(&self) -> Result<(), BridgeError> {
        let _serial = self.serial.lock().await;
        self.restore_current_admission_inner().await
    }
    async fn restore_current_admission_inner(&self) -> Result<(), BridgeError> {
        let Some(record) = self.journal.load()? else {
            return Ok(());
        };
        if !record.terminal() {
            return Err(error(
                "HIVE_SWITCH_BUSY",
                format!(
                    "startup admission requires a terminal switch; operation={} phase={}",
                    record.id, record.phase
                ),
            ));
        }
        let index = self.profiles.snapshot()?;
        let current = index.current_profile.as_deref();
        let mut leg = if record.committed
            && current == Some(&record.target.profile)
            && index.committed_operation.as_deref() == Some(&record.id)
        {
            record.target.clone()
        } else if !record.committed
            && current == Some(&record.source.profile)
            && index.committed_operation == record.source_index_operation
        {
            if record
                .source
                .status
                .as_ref()
                .is_some_and(|s| s["receipt"].is_object())
            {
                record.source.clone()
            } else {
                let Some(previous) = &index.committed_operation else {
                    return Ok(());
                };
                let Some(archived) = SwitchJournal::new(
                    self.journal
                        .path
                        .with_file_name(format!("desktop-hive-switch-{previous}.json")),
                )
                .load()?
                else {
                    return Ok(());
                };
                if !archived.committed
                    || archived.id != *previous
                    || current != Some(&archived.target.profile)
                {
                    return Err(error("HIVE_SWITCH_COMMIT_CONFLICT",format!("archived startup authority differs from current index: archive={} committed={} target_matches={}",archived.id,archived.committed,current==Some(&archived.target.profile))));
                }
                archived.target
            }
        } else {
            return Err(error("HIVE_SWITCH_COMMIT_CONFLICT",format!("terminal startup index does not match original ownership: operation={} committed={} current={:?} index_operation={:?}",record.id,record.committed,index.current_profile,index.committed_operation)));
        };
        let bridge = self.current.get()?;
        self.binding(&mut leg, false)?;
        let local = self.inspect(&mut leg, &bridge).await?;
        let expected = leg.status.clone().ok_or_else(|| {
            error(
                "HIVE_SWITCH_ADMISSION_PROOF",
                "completed switch has no persisted status for startup admission",
            )
        })?;
        if leg.pending.is_some()
            || expected["state"] != "released"
            || expected["receipt"].is_null()
            || Some(&expected["request"]) != leg.operation.as_ref()
            || Some(&expected["seal"]) != leg.seal.as_ref()
            || Some(&expected["release"]) != leg.release.as_ref()
            || !same_released_proof(&local["drain"], &expected)
        {
            return Err(error("HIVE_SWITCH_ADMISSION_PROOF",format!("completed switch admission proof differs: profile={} pending={:?} state={} local_proof_matches={}; require original released request, seal, receipt and release",leg.profile,leg.pending,expected["state"],local["drain"]==expected)));
        }
        if local["maintenance_allowed"] == true {
            return Ok(());
        }
        let remote = self.control(&mut leg, &bridge, "drain_status").await?;
        if !same_released_proof(&remote["drain"], &expected) {
            return Err(error("HIVE_SWITCH_ADMISSION_PROOF",format!("startup original drain status differs: profile={} state={} original_status_matches=false; admission retained",leg.profile,remote["drain"]["state"])));
        }
        let actual = self.profiles.snapshot()?;
        if actual.current_profile != index.current_profile
            || actual.committed_operation != index.committed_operation
        {
            return Err(error(
                "HIVE_SWITCH_COMMIT_CONFLICT",
                "current index ownership changed during startup admission verification",
            ));
        }
        self.control(&mut leg, &bridge, "commit").await?;
        Ok(())
    }
    pub(crate) async fn startup_current<R: tauri::Runtime>(&self, app: tauri::AppHandle<R>) {
        let _serial = self.serial.lock().await;
        if self.pending().unwrap_or(true) {
            return;
        }
        let Ok(bridge) = self.current.get() else {
            return;
        };
        match self.restore_current_admission_inner().await {
            Ok(()) => crate::experience::startup(app, bridge).await,
            Err(cause) => crate::experience::block_startup(&app, &bridge, cause),
        }
    }
    async fn ready(bridge: &Bridge) -> Result<(), BridgeError> {
        let mut statuses = bridge.subscribe();
        loop {
            let status = statuses.borrow_and_update().clone();
            match status.state {
                BridgePhase::Ready => return Ok(()),
                BridgePhase::Starting => statuses.changed().await.map_err(|e| {
                    error(
                        "HIVE_SWITCH_CHILD",
                        format!("fixed profile child closed before hello: {e}"),
                    )
                })?,
                _ => {
                    return Err(status.error.unwrap_or_else(|| {
                        error(
                            "HIVE_SWITCH_CHILD",
                            format!(
                                "fixed profile child state={:?}; required=ready",
                                status.state
                            ),
                        )
                    }))
                }
            }
        }
    }
    async fn target_child(&self, profile: &str, mode: ProfileMode) -> Result<Bridge, BridgeError> {
        if self.current.context().is_some_and(|c| c.id == profile) {
            return self.current.get();
        }
        let mut target = self.target.lock().await;
        if let Some((context, old_mode, child)) = &*target {
            if context.id != profile || *old_mode != mode {
                if !child.pending_requests().requests.is_empty() {
                    return Err(error(
                        "HIVE_SWITCH_IPC_PENDING",
                        "target IPC requests remain unresolved; child handoff blocked",
                    ));
                }
                child.stop().await?;
                *target = None;
            }
        }
        if target.is_none() {
            let context = self.profiles.context(profile)?;
            let child = Bridge::start(self.launch.clone().for_profile(&context, mode)?);
            if mode != ProfileMode::Prepare {
                crate::update_install::hold_startup(&child);
            }
            *target = Some((context, mode, child));
        }
        let child = target.as_ref().unwrap().2.clone();
        drop(target);
        Self::ready(&child).await?;
        Ok(child)
    }
    /// First-time binding shares the same fixed profile ownership rules, without
    /// inventing a remote switch when there is no prior Hive to drain.
    pub(crate) async fn initial_begin(
        &self,
        origin: String,
        name: String,
    ) -> Result<crate::sidecar::BridgeReply, BridgeError> {
        let _serial = self.serial.lock().await;
        if self.pending()? {
            return Err(error(
                "HIVE_SWITCH_BUSY",
                "an existing Hive switch owns device preparation",
            ));
        }
        let canonical = crate::hive_origin::normalize_hive_origin(&origin)?;
        if let Some(context) = self.current.context() {
            if context.origin != canonical {
                return Err(error(
                    "HIVE_SWITCH_REQUIRED",
                    format!(
                        "requested Hive differs from current={}; use the Hive switch operation",
                        context.origin
                    ),
                ));
            }
        } else {
            let context = self.profiles.register(&origin)?;
            let index = self.profiles.snapshot()?;
            self.profiles
                .commit_current(index.revision, &context.id, &id())?;
            let child = Bridge::start(
                self.launch
                    .clone()
                    .for_profile(&context, ProfileMode::Current)?,
            );
            crate::update_install::hold_startup(&child);
            self.current.replace(Some(context), child);
        }
        let bridge = self.current.get()?;
        Self::ready(&bridge).await?;
        bridge.device_begin(origin, name).await
    }
    pub(crate) async fn start(
        &self,
        origin: String,
        _name: String,
        prefs: PreferencesSnapshot,
    ) -> Result<SwitchSnapshot, BridgeError> {
        let _serial = self.serial.lock().await;
        let target = self.profiles.register(&origin)?;
        if let Some(old) = self.journal.load()? {
            if !old.terminal() {
                if old.target.profile != target.id {
                    return Err(error(
                        "HIVE_SWITCH_BUSY",
                        format!(
                            "switch operation={} target={} remains unresolved",
                            old.id, old.target.profile
                        ),
                    ));
                }
                return self.snapshot();
            }
        }
        let index = self.profiles.snapshot()?;
        let source = index.current_profile.ok_or_else(|| {
            error(
                "HIVE_PROFILE_REQUIRED",
                "source Hive is not configured; bind the first Hive before switching",
            )
        })?;
        if source == target.id {
            return Err(error(
                "HIVE_SWITCH_SAME_PROFILE",
                "target Hive already owns the current profile",
            ));
        }
        let mut r = SwitchRecord::new(source, target.id);
        r.source_index_operation = index.committed_operation;
        self.journal.save(&r)?;
        self.advance(r, prefs).await
    }
    pub(crate) async fn observe(
        &self,
        prefs: PreferencesSnapshot,
    ) -> Result<SwitchSnapshot, BridgeError> {
        let _serial = self.serial.lock().await;
        let Some(r) = self.journal.load()? else {
            return self.snapshot();
        };
        if r.terminal() {
            return self.snapshot();
        }
        if r.cancel_requested || r.quit_requested {
            return Err(error("HIVE_SWITCH_CANCEL_PENDING",format!("switch operation={} has persisted cancellation/exit intent; forward switching is blocked",r.id)));
        }
        self.advance(r, prefs).await
    }
    pub(crate) async fn target_status(&self) -> Result<crate::sidecar::BridgeReply, BridgeError> {
        let _serial = self.serial.lock().await;
        let r = self.journal.load()?.ok_or_else(|| {
            error(
                "HIVE_SWITCH_MISSING",
                "target pairing requires an existing switch",
            )
        })?;
        if r.phase != "preparing_target" {
            return Err(error(
                "HIVE_SWITCH_PHASE",
                format!(
                    "target pairing phase={}; required=preparing_target",
                    r.phase
                ),
            ));
        }
        self.target_child(&r.target.profile, ProfileMode::Prepare)
            .await?
            .device_status()
            .await
    }
    pub(crate) async fn target_begin(
        &self,
        name: String,
    ) -> Result<crate::sidecar::BridgeReply, BridgeError> {
        let _serial = self.serial.lock().await;
        let r = self.journal.load()?.ok_or_else(|| {
            error(
                "HIVE_SWITCH_MISSING",
                "target pairing requires an existing switch",
            )
        })?;
        if r.phase != "preparing_target" {
            return Err(error(
                "HIVE_SWITCH_PHASE",
                format!(
                    "target pairing phase={}; required=preparing_target",
                    r.phase
                ),
            ));
        }
        let context = self.profiles.context(&r.target.profile)?;
        self.target_child(&r.target.profile, ProfileMode::Prepare)
            .await?
            .device_begin(context.origin, name)
            .await
    }
    pub(crate) async fn target_open(&self) -> Result<crate::sidecar::BridgeReply, BridgeError> {
        let _serial = self.serial.lock().await;
        let r = self.journal.load()?.ok_or_else(|| {
            error(
                "HIVE_SWITCH_MISSING",
                "target browser open requires an existing switch",
            )
        })?;
        if r.phase != "preparing_target" {
            return Err(error(
                "HIVE_SWITCH_PHASE",
                format!(
                    "target browser open phase={}; required=preparing_target",
                    r.phase
                ),
            ));
        }
        let child = self
            .target_child(&r.target.profile, ProfileMode::Prepare)
            .await?;
        let reply = child.device_status().await?;
        let (reply, url) = if let Some(cause) = reply.result.get("error") {
            if !matches!(
                cause["code"].as_str(),
                Some("device_replaced" | "invalid_device_credential")
            ) {
                return Ok(reply);
            }
            let before = child.device_context().await?;
            let recovery = child.device_recovery_status().await?;
            let after = child.device_context().await?;
            if before.instance != after.instance || before.result != after.result {
                return Err(error(
                    "HIVE_SWITCH_CONTEXT",
                    "target recovery browser binding changed during original transaction lookup",
                ));
            }
            let url = crate::commands::recovery_browser_action(&recovery.result, &after.result)?;
            (recovery, url)
        } else {
            let Some(url) = crate::commands::pairing_browser_action(&reply.result)? else {
                return Ok(reply);
            };
            (reply, url)
        };
        crate::commands::open_pairing_url(url).await?;
        Ok(reply)
    }
    pub(crate) async fn target_recovery(
        &self,
        request: Option<crate::protocol::DeviceRecoveryConfirm>,
        prepare: bool,
    ) -> Result<crate::sidecar::BridgeReply, BridgeError> {
        let _serial = self.serial.lock().await;
        let r = self.journal.load()?.ok_or_else(|| {
            error(
                "HIVE_SWITCH_MISSING",
                "target credential recovery requires an existing switch",
            )
        })?;
        if r.phase != "preparing_target"
            || r.source.operation.is_some()
            || r.target.operation.is_some()
        {
            return Err(error("HIVE_SWITCH_PHASE",format!("target credential recovery phase={} source_drain={} target_drain={}; required=preparation before drain ownership",r.phase,r.source.operation.is_some(),r.target.operation.is_some())));
        }
        let child = self
            .target_child(&r.target.profile, ProfileMode::Prepare)
            .await?;
        if let Some(request) = request {
            request.validate()?;
            child.device_recovery_confirm(request).await
        } else if prepare {
            child.device_recovery_prepare().await
        } else {
            child.device_recovery_status().await
        }
    }
    fn binding(&self, leg: &mut SwitchLeg, may_initialize: bool) -> Result<(), BridgeError> {
        let index = self.profiles.snapshot()?;
        let fresh = self
            .profiles
            .refresh_binding(index.revision, &leg.profile)?;
        let entry = fresh.profiles.iter().find(|p| p.id == leg.profile).unwrap();
        if !entry.blockers.is_empty() {
            return Err(error(
                "HIVE_SWITCH_BINDING_BLOCKED",
                format!("profile={} blockers={:?}", leg.profile, entry.blockers),
            ));
        }
        if let Some(old) = &leg.binding_digest {
            if Some(old) != entry.binding_digest.as_ref()
                || leg.binding_revision != Some(entry.binding_revision)
            {
                return Err(error("HIVE_SWITCH_BINDING_CHANGED",format!("profile={} durable binding revision actual={} expected={:?}; original switch retained",leg.profile,entry.binding_revision,leg.binding_revision)));
            }
        } else if may_initialize {
            leg.binding_digest = entry.binding_digest.clone();
            leg.binding_revision = Some(entry.binding_revision);
        } else {
            return Err(error(
                "HIVE_SWITCH_BINDING_MISSING",
                "durable switch binding was not captured before handoff",
            ));
        }
        Ok(())
    }
    async fn inspect(&self, leg: &mut SwitchLeg, bridge: &Bridge) -> Result<Value, BridgeError> {
        Self::ready(bridge).await?;
        let reply = bridge.device_context().await?;
        let context = crate::protocol::device_context(&reply.result)?;
        let profile = self.profiles.context(&leg.profile)?;
        if crate::hive_origin::normalize_hive_origin(&context.hive)? != profile.origin
            || context.device_id.is_none()
        {
            return Err(error(
                "HIVE_SWITCH_BINDING_UNVERIFIED",
                format!(
                    "profile={} device_bound={} origin_matches={}; prepare the original binding",
                    leg.profile,
                    context.device_id.is_some(),
                    crate::hive_origin::normalize_hive_origin(&context.hive)? == profile.origin
                ),
            ));
        }
        leg.instance = Some(reply.instance);
        leg.process_binding_revision = Some(context.binding_revision);
        if bridge.profile_mode() != ProfileMode::Prepare {
            leg.network_revision =
                crate::network::decode_network_status(&bridge.network_status().await?.result)?
                    .effective_revision;
        }
        let view = self.control(leg, bridge, "inspect").await?;
        Ok(view)
    }
    async fn control(
        &self,
        leg: &mut SwitchLeg,
        bridge: &Bridge,
        action: &str,
    ) -> Result<Value, BridgeError> {
        let instance = bridge
            .status()
            .metadata
            .ok_or_else(|| {
                error(
                    "HIVE_SWITCH_CONTEXT",
                    "child metadata missing before switch action",
                )
            })?
            .instance;
        if leg.instance.as_deref() != Some(&instance) {
            return Err(error(
                "HIVE_SWITCH_CONTEXT",
                format!("switch action={action} process instance differs from captured context"),
            ));
        }
        let params = json!({"action":action,"binding_revision":leg.process_binding_revision,"network_revision":leg.network_revision,"operation":if matches!(action,"inspect"|"capabilities"|"freeze"){None}else{leg.operation.as_ref()},"seal":leg.seal,"release":leg.release});
        let reply = bridge.switch_control(params).await?;
        if reply.instance != instance {
            return Err(error(
                "HIVE_SWITCH_CONTEXT",
                format!("switch action={action} reply instance differs from owned child"),
            ));
        }
        crate::protocol::result_error(&reply.result)?;
        Ok(reply.result["switch"].clone())
    }
    async fn network(
        &self,
        leg: &mut SwitchLeg,
        bridge: &Bridge,
        prefs: &PreferencesSnapshot,
    ) -> Result<(), BridgeError> {
        if let Some(cause) = &prefs.error {
            return Err(cause.clone());
        }
        let status = bridge.device_status().await?;
        crate::protocol::result_error(&status.result)?;

        // The exact device scope is derived by the existing native verifier.
        let scope =
            crate::network::trusted_scope(&status.result)?.map(|v| v.device_scope().to_owned());
        let context = self.profiles.context(&leg.profile)?;
        let proxy = context
            .proxy_for(&prefs.preferences, scope.as_deref())?
            .to_owned();
        let revision = prefs.preferences.revision;
        let reply = bridge
            .runtime_configure_network(crate::runtime_protocol::RuntimeNetworkConfig {
                revision,
                connect_proxy: proxy,
            })
            .await?;
        crate::protocol::result_error(&reply.result)?;
        leg.network_revision = revision;
        Ok(())
    }
    async fn original(
        &self,
        record: &mut SwitchRecord,
        target: bool,
        bridge: &Bridge,
        action: &str,
    ) -> Result<Value, BridgeError> {
        let leg = if target {
            &mut record.target
        } else {
            &mut record.source
        };
        if leg.pending.is_some() {
            let view = self.control(leg, bridge, "drain_status").await?;
            let status = &view["drain"];
            // A single absent read is never permission to replay an uncertain write.
            let resolved = leg.resolves(leg.pending.as_deref().unwrap(), status);
            if !resolved {
                return Err(error(
                    "HIVE_SWITCH_RESULT_UNCONFIRMED",
                    format!(
                        "original action={:?} operation={} state={}; continue querying the same ID",
                        leg.pending,
                        leg.operation.as_ref().unwrap()["id"],
                        status["state"]
                    ),
                ));
            }
            leg.status = Some(status.clone());
            leg.pending = None;
            self.journal.save(record)?;
            return Ok(view);
        }
        if matches!(action, "drain_begin" | "drain_seal" | "drain_release") {
            leg.pending = Some(action.into());
            self.journal.save(record)?;
        }
        let leg = if target {
            &mut record.target
        } else {
            &mut record.source
        };
        let view = self.control(leg, bridge, action).await?;
        if !view["drain"].is_null() {
            leg.status = Some(view["drain"].clone());
        }
        leg.pending = None;
        self.journal.save(record)?;
        Ok(view)
    }
    async fn prepare_barrier(
        &self,
        r: &mut SwitchRecord,
        target: bool,
        bridge: &Bridge,
    ) -> Result<bool, BridgeError> {
        let leg = if target { &mut r.target } else { &mut r.source };
        let view = self.inspect(leg, bridge).await?;
        self.binding(leg, true)?;
        if leg.operation.is_none() {
            // Prefer the historical barrier when leaving this Hive previously.
            if view["seal_persisted"] == true && view["drain"]["state"] == "sealed" {
                leg.operation = Some(view["drain"]["request"].clone());
                leg.seal = Some(view["drain"]["seal"].clone());
                leg.status = Some(view["drain"].clone());
            } else {
                let context = bridge.device_context().await?;
                let c = crate::protocol::device_context(&context.result)?;
                leg.operation = Some(
                    json!({"id":id(),"device_id":c.device_id,"owner_id":c.owner_id,"origin":c.hive,"expected_epoch":view["epoch"],"expected_lease":view["lease"]}),
                );
            }
            self.journal.save(r)?;
        }
        let needs_begin = if target {
            r.target.status.is_none()
        } else {
            r.source.status.is_none()
        };
        let view = self
            .original(
                r,
                target,
                bridge,
                if needs_begin {
                    "drain_begin"
                } else {
                    "drain_status"
                },
            )
            .await?;
        let state = view["drain"]["state"].as_str().unwrap_or("");
        if state == "sealed" {
            return Ok(true);
        }
        if state != "ready" {
            return Ok(false);
        }
        let leg = if target { &mut r.target } else { &mut r.source };
        if leg.seal.is_none() {
            leg.seal = Some(json!({"id":id(),"request":leg.operation}));
            self.journal.save(r)?;
        }
        let view = self.original(r, target, bridge, "drain_seal").await?;
        Ok(view["drain"]["state"] == "sealed" && view["seal_persisted"] == true)
    }
    async fn advance(
        &self,
        mut r: SwitchRecord,
        prefs: PreferencesSnapshot,
    ) -> Result<SwitchSnapshot, BridgeError> {
        let result = self.advance_inner(&mut r, &prefs).await;
        if let Err(cause) = result {
            let definite = cause
                .details
                .as_ref()
                .and_then(|d| d.evidence.get("http_status"))
                .and_then(|v| v.parse::<u16>().ok())
                .is_some_and(|status| matches!(status, 400 | 401 | 403 | 404 | 410 | 422));
            let restore = !r.committed
                && r.phase == "connecting_target"
                && definite
                && r.source.pending.is_none()
                && r.target.pending.is_none();
            r.failure = Some(cause);
            if restore {
                r.phase = "restoring_source".into();
            }
            self.journal.save(&r)?;
            if restore {
                if let Err(cause) = self.restore_source(&mut r, &prefs).await {
                    let original = r.failure.take().unwrap();
                    r.failure=Some(error("HIVE_SWITCH_SOURCE_RESTORE_UNCONFIRMED",format!("source profile retained; restore failed: {}: {}; original target failure: {}: {}",cause.code,cause.message,original.code,original.message)));
                    self.journal.save(&r)?;
                }
            }
        }
        self.snapshot()
    }
    async fn advance_inner(
        &self,
        r: &mut SwitchRecord,
        prefs: &PreferencesSnapshot,
    ) -> Result<(), BridgeError> {
        let index = self.profiles.snapshot()?;
        // Index is the authority after an uncertain atomic replacement.
        if index.committed_operation.as_deref() == Some(&r.id)
            && index.current_profile.as_deref() == Some(&r.target.profile)
        {
            r.committed = true;
            r.phase = "releasing_target".into();
            self.journal.save(r)?;
        } else if r.committed {
            return Err(error("HIVE_SWITCH_COMMIT_CONFLICT",format!("committed switch={} current={:?} index_operation={:?}; preserve original ownership",r.id,index.current_profile,index.committed_operation)));
        }
        if r.phase == "restoring_source" {
            return self.restore_source(r, prefs).await;
        }
        r.failure = None;
        if r.phase == "preparing_target" {
            let target = self
                .target_child(&r.target.profile, ProfileMode::Prepare)
                .await?;
            let status = target.device_status().await?;
            crate::protocol::result_error(&status.result)?;
            if status.result["device"]["state"] != "bound" {
                return Ok(());
            }
            self.inspect(&mut r.target, &target).await?;
            target.verify_local_startup().await?;
            let capability = self.control(&mut r.target, &target, "capabilities").await?;
            if capability["capabilities"]["device_drain"] != 1 {
                return Err(error(
                    "HIVE_SWITCH_CAPABILITY",
                    "target Hive device-drain capability is unavailable; source remains current",
                ));
            }
            // Check source capability before making any source-side writes.
            let source = self.current.get()?;
            let source_view = self.inspect(&mut r.source, &source).await?;
            self.binding(&mut r.source, true)?;
            if let Err(cause) = self.control(&mut r.source, &source, "capabilities").await {
                let offline = r.source.child_reaped
                    && r.source.workers_stopped
                    && r.source.ipc_empty
                    && r.source.pending.is_none()
                    && source.pending_requests().requests.is_empty()
                    && source_view["workers_stopped"] == true
                    && source_view["seal_persisted"] == true
                    && r.source
                        .status
                        .as_ref()
                        .is_some_and(|s| s["receipt"] == source_view["drain"]["receipt"]);
                if !offline {
                    return Err(error("HIVE_SWITCH_SOURCE_UNVERIFIED",format!("source capability query failed: {}: {}; complete matching offline seal/worker/IPC/reap evidence is absent",cause.code,cause.message)));
                }
            }
            if !self.prepare_barrier(r, true, &target).await? {
                return Ok(());
            }
            r.phase = "draining_source".into();
            self.journal.save(r)?;
        }
        if r.phase == "draining_source" {
            self.binding(&mut r.target, false)?;
            let source = self.current.get()?;
            self.inspect(&mut r.source, &source).await?;
            self.binding(&mut r.source, false)?;
            self.control(&mut r.source, &source, "freeze").await?;
            if !self.prepare_barrier(r, false, &source).await? {
                return Ok(());
            }
            r.phase = "stopping_source".into();
            self.journal.save(r)?;
        }
        if r.phase == "stopping_source" {
            let source = self.current.get()?;
            self.inspect(&mut r.source, &source).await?;
            self.binding(&mut r.source, false)?;
            let stopped = self.control(&mut r.source, &source, "stop").await?;
            if stopped["workers_stopped"] != true || stopped["seal_persisted"] != true {
                return Err(error(
                    "HIVE_SWITCH_STOP_UNCONFIRMED",
                    "source stop lacks matching durable seal and joined worker proof",
                ));
            }
            r.source.workers_stopped = true;
            if !source.pending_requests().requests.is_empty() {
                return Err(error(
                    "HIVE_SWITCH_IPC_PENDING",
                    "source IPC requests remain unresolved after worker join",
                ));
            }
            r.source.ipc_empty = true;
            self.journal.save(r)?;
            source.stop().await?;
            if !source.pending_requests().requests.is_empty() {
                return Err(error(
                    "HIVE_SWITCH_IPC_PENDING",
                    "source IPC became unresolved during normal child shutdown",
                ));
            }
            r.source.child_reaped = true;
            r.phase = "connecting_target".into();
            self.journal.save(r)?;
        }
        if r.phase == "connecting_target" {
            self.binding(&mut r.target, false)?;
            let target = self
                .target_child(&r.target.profile, ProfileMode::Activate)
                .await?;
            self.inspect(&mut r.target, &target).await?;
            self.network(&mut r.target, &target, prefs).await?;
            self.journal.save(r)?;
            let view = self.control(&mut r.target, &target, "connect").await?;
            if view["connection"] != "connected"
                || view["epoch"] != r.target.status.as_ref().unwrap()["receipt"]["epoch"]
            {
                return Err(error(
                    "HIVE_SWITCH_TARGET_UNVERIFIED",
                    "target connection lacks the original sealed epoch and verified socket",
                ));
            }
            r.target.verified = true;
            r.phase = "committing_current".into();
            r.commit_revision = Some(self.profiles.snapshot()?.revision);
            self.journal.save(r)?;
        }
        if r.phase == "committing_current" {
            self.binding(&mut r.target, false)?;
            self.binding(&mut r.source, false)?;
            let expected = r.commit_revision.ok_or_else(|| {
                error(
                    "HIVE_SWITCH_COMMIT_EVIDENCE",
                    "prepared index revision missing",
                )
            })?;
            let commit = self
                .profiles
                .commit_current(expected, &r.target.profile, &r.id);
            let actual = self.profiles.snapshot()?;
            if actual.committed_operation.as_deref() != Some(&r.id)
                || actual.current_profile.as_deref() != Some(&r.target.profile)
            {
                return Err(commit.err().unwrap_or_else(|| {
                    error(
                        "HIVE_SWITCH_COMMIT_UNCONFIRMED",
                        "atomic current profile readback does not match prepared operation",
                    )
                }));
            }
            r.committed = true;
            r.phase = "releasing_target".into();
            self.journal.save(r)?;
        }
        if r.phase == "releasing_target" {
            let target = self
                .target_child(&r.target.profile, ProfileMode::Activate)
                .await?;
            self.inspect(&mut r.target, &target).await?;
            self.network(&mut r.target, &target, prefs).await?;
            let status = self.original(r, true, &target, "drain_status").await?;
            if status["drain"]["state"] != "released" {
                self.control(&mut r.target, &target, "connect").await?;
            }
            self.control(&mut r.target, &target, "commit").await?;
            self.current.replace(
                Some(self.profiles.context(&r.target.profile)?),
                target.clone(),
            );
            self.target.lock().await.take();
            if status["drain"]["state"] != "released" {
                let view = self.control(&mut r.target, &target, "inspect").await?;
                if r.target.release.is_none() {
                    r.target.release = Some(
                        json!({"id":id(),"request":r.target.operation,"mode":"activate","expected_epoch":view["epoch"],"expected_lease":view["lease"]}),
                    );
                    self.journal.save(r)?;
                }
                let released = self.original(r, true, &target, "drain_release").await?;
                if released["drain"]["state"] != "released" {
                    return Err(error(
                        "HIVE_SWITCH_RELEASE_UNCONFIRMED",
                        "committed target barrier release is not confirmed; target remains current",
                    ));
                }
            }
            // Release permits normal maintenance, but only this native commit
            // records that the durable current owner completed its admission.
            self.control(&mut r.target, &target, "commit").await?;
            r.phase = "succeeded".into();
            r.failure = None;
            self.journal.save(r)?;
            // Local startup is now allowed. Account readiness is handled inside B.
        }
        Ok(())
    }
    /// Used for definite pre-commit failure; ticket 07 also uses this boundary
    /// after cancellation has resolved every uncertain source/target write.
    pub(crate) async fn restore_source(
        &self,
        r: &mut SwitchRecord,
        prefs: &PreferencesSnapshot,
    ) -> Result<(), BridgeError> {
        let index = self.profiles.snapshot()?;
        if r.committed
            || index.current_profile.as_deref() != Some(&r.source.profile)
            || index.committed_operation != r.source_index_operation
        {
            return Err(error("HIVE_SWITCH_ALREADY_COMMITTED","source restore rejected: durable current index no longer owns the original source predecessor"));
        }
        if r.target.pending.is_some() {
            return Err(error(
                "HIVE_SWITCH_RESULT_UNCONFIRMED",
                format!(
                    "target original action={:?} remains unresolved; source restore blocked",
                    r.target.pending
                ),
            ));
        }
        self.shutdown_target().await?;
        self.target.lock().await.take();
        self.binding(&mut r.source, false)?;
        let source = match self.current.get() {
            Ok(child) if child.status().state == BridgePhase::Ready => child,
            old => {
                if let Ok(old) = old {
                    if !old.pending_requests().requests.is_empty() {
                        return Err(error(
                            "HIVE_SWITCH_IPC_PENDING",
                            "source restore waits for original management requests",
                        ));
                    }
                    old.stop().await?;
                }
                let context = self.profiles.context(&r.source.profile)?;
                let child = Bridge::start(
                    self.launch
                        .clone()
                        .for_profile(&context, ProfileMode::Current)?,
                );
                crate::update_install::hold_startup(&child);
                self.current.replace(Some(context), child.clone());
                child
            }
        };
        self.inspect(&mut r.source, &source).await?;
        self.network(&mut r.source, &source, prefs).await?;
        let status = self.original(r, false, &source, "drain_status").await?;
        if status["drain"]["state"] != "released" {
            r.source.child_reaped = false;
            r.source.workers_stopped = false;
            r.source.ipc_empty = false;
            self.journal.save(r)?;
            let view = if status["drain"]["state"] == "sealed" {
                self.control(&mut r.source, &source, "connect").await?
            } else {
                self.control(&mut r.source, &source, "inspect").await?
            };
            r.source.verified = view["connection"] == "connected";
            if r.source.release.is_none() {
                r.source.release = Some(
                    json!({"id":id(),"request":r.source.operation,"mode":"cancel","expected_epoch":view["epoch"],"expected_lease":view["lease"]}),
                );
                self.journal.save(r)?;
            }
            let release = self.original(r, false, &source, "drain_release").await?;
            if release["drain"]["state"] != "released" {
                return Err(error(
                    "HIVE_SWITCH_RESULT_UNCONFIRMED",
                    "source barrier cancellation is not confirmed; source index retained",
                ));
            }
        }
        if r.source
            .status
            .as_ref()
            .is_some_and(|s| s["receipt"].is_object())
        {
            self.control(&mut r.source, &source, "commit").await?;
        }
        // Ordinary startup restores the original Running/paused selection. A
        // failure there is reported within A and cannot send the user to B.
        r.phase = "failed".into();
        self.journal.save(r)?;
        Ok(())
    }
    pub(crate) async fn shutdown_target(&self) -> Result<(), BridgeError> {
        let target = self.target.lock().await;
        if let Some((_, _, child)) = &*target {
            if self
                .current
                .get()
                .is_ok_and(|current| Arc::ptr_eq(&current.0, &child.0))
            {
                return Ok(());
            }
            child.stop().await?;
        }
        Ok(())
    }
}

/// Rebinds App event subscriptions when committed current ownership changes.
/// Pending/diagnostic events retain their original management instance.
pub(crate) async fn observe_current(app: tauri::AppHandle, route: CurrentBridge) {
    use tauri::{Emitter, Manager};
    let mut changed = route.subscribe();
    loop {
        let Ok(bridge) = route.get() else {
            if changed.changed().await.is_err() {
                return;
            }
            continue;
        };
        let mut statuses = bridge.subscribe();
        let mut settled = bridge.subscribe_settled();
        let mut diagnostics = bridge.subscribe_diagnostics();
        loop {
            tokio::select! {
                update=changed.changed()=>{if update.is_err(){return;}break;},
                update=statuses.changed()=>{if update.is_err(){break;}let state=statuses.borrow_and_update().clone();if let Err(cause)=app.emit_to("main","bee://bridge-status",state){eprintln!("deliver current bridge status: {cause}");}},
                event=settled.recv()=>{match event {Ok(event)=>{if let Err(cause)=app.emit_to("main","bee://request-settled",event){eprintln!("deliver current request settlement: {cause}");}},Err(tokio::sync::broadcast::error::RecvError::Lagged(count))=>eprintln!("current request events lagged: count={count}"),Err(_)=>break}},
                event=diagnostics.recv()=>{match event {Ok(event)=>{if let Err(cause)=app.state::<crate::diagnostics_native::NativeDiagnostics>().logs.record(event){eprintln!("persist current diagnostic: {}: {}",cause.code,cause.message);}},Err(tokio::sync::broadcast::error::RecvError::Lagged(count))=>eprintln!("current diagnostic events lagged: count={count}"),Err(_)=>break}},
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn ordinary_requests_follow_current_route_and_old_child_keeps_its_owner() {
        let first = crate::sidecar::Bridge::start(crate::sidecar::tests::fixture("echo"));
        let second = crate::sidecar::Bridge::start(crate::sidecar::tests::fixture("echo"));
        HiveSwitch::ready(&first).await.unwrap();
        HiveSwitch::ready(&second).await.unwrap();
        let route = CurrentBridge::default();
        route.replace(None, first.clone());
        let before = route.get().unwrap().ping().await.unwrap();
        route.replace(None, second.clone());
        let after = route.get().unwrap().ping().await.unwrap();
        first.stop().await.unwrap();
        assert!(first.ping().await.is_err());
        assert!(route.get().unwrap().ping().await.is_ok());
        assert_eq!(before.instance, after.instance);
        first.stop().await.unwrap();
        second.stop().await.unwrap();
    }

    struct Server(std::process::Child, String);
    impl Server {
        fn start() -> Self {
            use std::io::BufRead;
            let mut child = std::process::Command::new("node")
                .arg(
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../tests/fixtures/hive-switch-server.mjs"),
                )
                .stdout(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            let mut origin = String::new();
            std::io::BufReader::new(child.stdout.take().unwrap())
                .read_line(&mut origin)
                .unwrap();
            Self(child, origin.trim().into())
        }
    }
    impl Drop for Server {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    async fn configure(server: &Server, value: Value) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!("{}/__configure", server.1))
            .body(serde_json::to_vec(&value).unwrap())
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();
    }
    fn real_launch() -> LaunchSpec {
        let source_path = PathBuf::from(env!("BEE_SOURCE_FILE"));
        let source = crate::build_source::BuildSource::parse(
            &std::fs::read(&source_path).unwrap(),
            env!("BEE_TARGET"),
            env!("BEE_REVISION"),
            env!("BEE_TEE_REVISION"),
        )
        .unwrap();
        LaunchSpec {
            program: PathBuf::from(
                source_path
                    .to_str()
                    .unwrap()
                    .strip_suffix(".source.json")
                    .unwrap(),
            ),
            bundle: None,
            args: vec!["desktop".into()],
            source,
            timeout: std::time::Duration::from_secs(5),
        }
    }
    fn bind(context: &ProfileContext) {
        crate::preferences::private_write(&context.device_path(),&serde_json::to_vec(&json!({"hive":context.origin,"name":"Synthetic Mac","credential":format!("bee_{}","b".repeat(43)),"identity":{"id":"synthetic-device","name":"Synthetic Mac","owner_id":"synthetic-owner","owner_email":"synthetic@example.com"}})).unwrap()).unwrap();
    }
    #[tokio::test]
    async fn real_go_children_handoff_with_index_commit_before_target_release() {
        let a_server = Server::start();
        let b_server = Server::start();
        let tmp = tempfile::tempdir().unwrap();
        let canonical = tmp.path().canonicalize().unwrap();
        let profiles = Arc::new(ProfileStore::open(canonical.join("tokhive")).unwrap());
        let a = profiles.register(&a_server.1).unwrap();
        let b = profiles.register(&b_server.1).unwrap();
        bind(&a);
        bind(&b);
        profiles
            .commit_current(profiles.snapshot().unwrap().revision, &a.id, &id())
            .unwrap();
        let coordinator = HiveSwitch::from_store(profiles.clone(), real_launch()).unwrap();
        let prefs =
            crate::preferences::PreferencesStore::new(canonical.join("preferences.json")).read();
        configure(&b_server,json!({"expect":{"index_path":profiles.root().join("hive-profiles.json"),"target":b.id}})).await;
        let result = coordinator
            .start(b.origin.clone(), "Synthetic Mac".into(), prefs.clone())
            .await
            .unwrap();
        assert_eq!(
            result.operation.as_ref().unwrap().phase,
            "succeeded",
            "{:?}",
            result.operation
        );
        assert_eq!(result.profiles.current_profile, Some(b.id.clone()));
        assert_eq!(coordinator.current.context().unwrap().id, b.id);
        let record = coordinator.journal.load().unwrap().unwrap();
        assert!(
            record.source.child_reaped && record.source.workers_stopped && record.source.ipc_empty
        );
        assert!(record.committed && record.target.verified);
        assert_eq!(record.target.status.as_ref().unwrap()["state"], "released");
        coordinator.current.get().unwrap().stop().await.unwrap();
        drop(coordinator);
        // Old 05 proofs have no completion field. They still require the native
        // current-index/original-release admission after upgrading/restarting.
        let proof_path = b
            .device_path()
            .parent()
            .unwrap()
            .join("desktop-switch-seal.json");
        let mut proof: Value =
            serde_json::from_slice(&protected_read_bounded(&proof_path, 1_048_576).unwrap())
                .unwrap();
        proof.as_object_mut().unwrap().remove("admission_completed");
        private_write(&proof_path, &serde_json::to_vec(&proof).unwrap()).unwrap();
        let coordinator = HiveSwitch::from_store(profiles.clone(), real_launch()).unwrap();
        profiles
            .commit_current(profiles.snapshot().unwrap().revision, &b.id, &id())
            .unwrap();
        assert_eq!(
            coordinator
                .restore_current_admission()
                .await
                .unwrap_err()
                .code,
            "HIVE_SWITCH_COMMIT_CONFLICT"
        );
        profiles
            .commit_current(profiles.snapshot().unwrap().revision, &b.id, &record.id)
            .unwrap();
        coordinator.restore_current_admission().await.unwrap();
        coordinator
            .current
            .get()
            .unwrap()
            .restore_when_ready()
            .await
            .unwrap();
        let back = coordinator
            .start(a.origin.clone(), "Synthetic Mac".into(), prefs)
            .await
            .unwrap();
        assert_eq!(
            back.operation.as_ref().unwrap().phase,
            "succeeded",
            "{:?}",
            back.operation
        );
        assert_eq!(back.profiles.current_profile, Some(a.id));
        coordinator.current.get().unwrap().stop().await.unwrap();
        coordinator.shutdown_target().await.unwrap();
    }

    async fn audit(server: &Server) -> Value {
        let response = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("{}/__audit", server.1))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        serde_json::from_slice(&response).unwrap()
    }
    #[tokio::test]
    async fn lost_target_write_responses_restart_by_querying_original_ids_without_replay() {
        for action in ["begin", "seal", "release"] {
            let a_server = Server::start();
            let b_server = Server::start();
            let tmp = tempfile::tempdir().unwrap();
            let canonical = tmp.path().canonicalize().unwrap();
            let profiles = Arc::new(ProfileStore::open(canonical.join("tokhive")).unwrap());
            let a = profiles.register(&a_server.1).unwrap();
            let b = profiles.register(&b_server.1).unwrap();
            bind(&a);
            bind(&b);
            profiles
                .commit_current(profiles.snapshot().unwrap().revision, &a.id, &id())
                .unwrap();
            configure(&b_server,json!({"faults":{action:1},"expect":{"index_path":profiles.root().join("hive-profiles.json"),"target":b.id}})).await;
            let coordinator = HiveSwitch::from_store(profiles.clone(), real_launch()).unwrap();
            let prefs =
                crate::preferences::PreferencesStore::new(canonical.join("preferences.json"))
                    .read();
            let lost = coordinator
                .start(b.origin.clone(), "Synthetic Mac".into(), prefs.clone())
                .await
                .unwrap();
            let record = lost.operation.unwrap();
            assert_eq!(
                record.target.pending,
                Some(format!("drain_{action}")),
                "{record:?}"
            );
            assert!(!record.terminal());
            assert_eq!(record.committed, action == "release");
            let original = record.target.operation.clone();
            coordinator.current.get().unwrap().stop().await.unwrap();
            coordinator.shutdown_target().await.unwrap();
            drop(coordinator);
            let resumed = HiveSwitch::from_store(profiles.clone(), real_launch()).unwrap();
            let done = resumed.observe(prefs).await.unwrap();
            assert_eq!(
                done.operation.as_ref().unwrap().phase,
                "succeeded",
                "action={action} {:?}",
                done.operation
            );
            assert_eq!(done.operation.as_ref().unwrap().target.operation, original);
            let events = audit(&b_server).await;
            assert_eq!(
                events
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|e| e["method"] == "POST"
                        && e["path"]
                            .as_str()
                            .is_some_and(|p| p.ends_with(&format!("/{action}"))))
                    .count(),
                1,
                "{events}"
            );
            resumed.current.get().unwrap().stop().await.unwrap();
            resumed.shutdown_target().await.unwrap();
        }
    }

    #[tokio::test]
    async fn definite_target_rejection_before_commit_reconnects_source_under_original_barrier() {
        let a_server = Server::start();
        let b_server = Server::start();
        let tmp = tempfile::tempdir().unwrap();
        let canonical = tmp.path().canonicalize().unwrap();
        let profiles = Arc::new(ProfileStore::open(canonical.join("tokhive")).unwrap());
        let a = profiles.register(&a_server.1).unwrap();
        let b = profiles.register(&b_server.1).unwrap();
        bind(&a);
        bind(&b);
        profiles
            .commit_current(profiles.snapshot().unwrap().revision, &a.id, &id())
            .unwrap();
        configure(&b_server, json!({"faults":{"identity_after_seal":1}})).await;
        let coordinator = HiveSwitch::from_store(profiles.clone(), real_launch()).unwrap();
        let prefs =
            crate::preferences::PreferencesStore::new(canonical.join("preferences.json")).read();
        let result = coordinator
            .start(b.origin, "Synthetic Mac".into(), prefs)
            .await
            .unwrap();
        let record = result.operation.unwrap();
        assert_eq!(record.phase, "failed", "{record:?}");
        assert!(!record.committed);
        assert_eq!(result.profiles.current_profile, Some(a.id.clone()));
        assert_eq!(coordinator.current.context().unwrap().id, a.id);
        assert_eq!(record.source.status.as_ref().unwrap()["state"], "released");
        assert_eq!(record.source.release.as_ref().unwrap()["mode"], "cancel");
        assert!(coordinator
            .current
            .get()
            .unwrap()
            .device_context()
            .await
            .is_ok());
        coordinator.current.get().unwrap().stop().await.unwrap();
        coordinator.shutdown_target().await.unwrap();
        drop(coordinator);
        let resumed = HiveSwitch::from_store(profiles.clone(), real_launch()).unwrap();
        resumed.restore_current_admission().await.unwrap();
        resumed
            .current
            .get()
            .unwrap()
            .restore_when_ready()
            .await
            .unwrap();
        resumed.current.get().unwrap().stop().await.unwrap();
    }
    #[tokio::test]
    async fn reaped_source_stays_offline_and_committed_index_wins_the_journal_window() {
        for commit_window in [false, true] {
            let a_server = Server::start();
            let b_server = Server::start();
            let tmp = tempfile::tempdir().unwrap();
            let canonical = tmp.path().canonicalize().unwrap();
            let profiles = Arc::new(ProfileStore::open(canonical.join("tokhive")).unwrap());
            let a = profiles.register(&a_server.1).unwrap();
            let b = profiles.register(&b_server.1).unwrap();
            bind(&a);
            bind(&b);
            profiles
                .commit_current(profiles.snapshot().unwrap().revision, &a.id, &id())
                .unwrap();
            configure(&b_server, json!({"faults":{"identity_after_seal":503}})).await;
            let coordinator = HiveSwitch::from_store(profiles.clone(), real_launch()).unwrap();
            let prefs =
                crate::preferences::PreferencesStore::new(canonical.join("preferences.json"))
                    .read();
            let paused = coordinator
                .start(b.origin.clone(), "Synthetic Mac".into(), prefs.clone())
                .await
                .unwrap();
            let mut r = paused.operation.unwrap();
            assert_eq!(r.phase, "connecting_target", "{r:?}");
            assert!(r.source.child_reaped);
            configure(&b_server, json!({"faults":{"identity_after_seal":0}})).await;
            if commit_window {
                // Explicitly stage the crash boundary after the real verified
                // socket/index write and before the next App journal write.
                let child = coordinator
                    .target_child(&b.id, ProfileMode::Activate)
                    .await
                    .unwrap();
                coordinator.inspect(&mut r.target, &child).await.unwrap();
                coordinator
                    .network(&mut r.target, &child, &prefs)
                    .await
                    .unwrap();
                let view = coordinator
                    .control(&mut r.target, &child, "connect")
                    .await
                    .unwrap();
                assert_eq!(view["connection"], "connected");
                r.target.verified = true;
                r.phase = "committing_current".into();
                r.commit_revision = Some(profiles.snapshot().unwrap().revision);
                coordinator.journal.save(&r).unwrap();
                profiles
                    .commit_current(r.commit_revision.unwrap(), &b.id, &r.id)
                    .unwrap();
            }
            coordinator.shutdown_target().await.unwrap();
            drop(coordinator);
            drop(a_server);
            let resumed = HiveSwitch::from_store(profiles.clone(), real_launch()).unwrap();
            if !commit_window {
                assert!(
                    resumed.current.get().is_err(),
                    "reaped source must not be spawned again before target ownership is committed"
                );
            }
            let done = resumed.observe(prefs).await.unwrap();
            assert_eq!(
                done.operation.as_ref().unwrap().phase,
                "succeeded",
                "{done:?}"
            );
            assert_eq!(done.profiles.current_profile, Some(b.id));
            resumed.current.get().unwrap().stop().await.unwrap();
            resumed.shutdown_target().await.unwrap();
        }
    }
    #[test]
    fn unresolved_remote_action_preserves_original_parameters_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let journal = SwitchJournal::new(dir.path().join("switch.json"));
        let mut record = SwitchRecord::new("a".repeat(32), "b".repeat(32));
        record.target.operation = Some(
            serde_json::json!({"id":"1".repeat(48),"device_id":"device","owner_id":"owner","origin":"https://b.example","expected_epoch":"","expected_lease":""}),
        );
        record.target.pending = Some("drain_begin".into());
        journal.save(&record).unwrap();
        let reopened = SwitchJournal::new(dir.path().join("switch.json"));
        assert_eq!(
            reopened.load().unwrap().unwrap().target.operation,
            record.target.operation
        );
        let mut discarded = record.clone();
        discarded.target.pending = None;
        assert_eq!(
            reopened.save(&discarded).unwrap_err().code,
            "HIVE_SWITCH_JOURNAL_CONFLICT"
        );
        record.target.operation.as_mut().unwrap()["id"] = serde_json::json!("2".repeat(48));
        assert_eq!(
            reopened.save(&record).unwrap_err().code,
            "HIVE_SWITCH_JOURNAL_CONFLICT"
        );
        assert_eq!(
            reopened.load().unwrap().unwrap().target.pending.as_deref(),
            Some("drain_begin")
        );
    }
    #[test]
    fn damaged_or_incomplete_journal_cannot_authorize_a_handoff() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("switch.json");
        let r = SwitchRecord::new("a".repeat(32), "b".repeat(32));
        let mut value = serde_json::to_value(&r).unwrap();
        value.as_object_mut().unwrap().remove("commit_revision");
        private_write(&path, &serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(SwitchJournal::new(path.clone()).load().is_err());
        let mut forged = r.clone();
        forged.phase = "succeeded".into();
        assert!(SwitchJournal::new(dir.path().join("forged.json"))
            .save(&forged)
            .is_err());
        let duplicate = serde_json::to_string(&r).unwrap().replacen(
            "\"operation\":null",
            "\"operation\":null,\"operation\":null",
            1,
        );
        private_write(&path, duplicate.as_bytes()).unwrap();
        assert!(SwitchJournal::new(path).load().is_err());
    }
}
