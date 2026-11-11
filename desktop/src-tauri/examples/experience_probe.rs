//! Isolated native acceptance UI. It never constructs the Bee bridge or runtime.
use bee_desktop_lib::authorize_protocol;
mod lifecycle {
    pub use bee_desktop_lib::{NativeLanguage, NativeLocale};
}
#[path = "../src/autostart.rs"]
#[allow(dead_code)]
mod autostart;
#[path = "../src/diagnostic_log.rs"]
#[allow(dead_code)]
mod diagnostic_log;
#[path = "../src/diagnostics_protocol.rs"]
#[allow(dead_code)]
mod diagnostics_protocol;
#[path = "../src/notifications.rs"]
#[allow(dead_code)]
mod notifications;
#[path = "experience_probe/paths.rs"]
mod paths;
#[path = "../src/preferences.rs"]
#[allow(dead_code)]
mod preferences;
#[path = "../src/protocol.rs"]
#[allow(dead_code)]
mod protocol;
#[path = "../src/runtime_protocol.rs"]
#[allow(dead_code)]
mod runtime_protocol;

use notifications::{
    NativeNotificationAdapter, Notice, NotificationEvent, NotificationPlatform,
    NotificationProblem, NotificationService,
};
use preferences::{PreferencesSnapshot, PreferencesStore};
use protocol::BridgeError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

const IDENTIFIER: &str = "dev.tokhive.bee.s2-probe";
const FIXED_IDENTITY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

struct Evidence {
    root: PathBuf,
    events: Mutex<Vec<Value>>,
    changed_autostart: AtomicBool,
    original_autostart: Mutex<Option<bool>>,
    smoke_requested: bool,
    notification_smoke_requested: bool,
    downloads: Mutex<Downloads>,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum DownloadMode {
    Save,
    Cancel,
    WriteFailure,
}
struct DownloadPlan {
    mode: DownloadMode,
    expected: Vec<u8>,
    destination: PathBuf,
}
#[derive(Default)]
struct Downloads {
    next: Option<DownloadPlan>,
    inflight: BTreeMap<String, DownloadPlan>,
}
impl Evidence {
    fn record(
        &self,
        action: &str,
        result: &Result<Value, BridgeError>,
    ) -> Result<Value, BridgeError> {
        let mut events = self.events.lock().map_err(|_| {
            error(
                "PROBE_EVIDENCE_LOCK",
                "probe evidence mutex poisoned; this action receipt cannot be saved",
            )
        })?;
        if events.len() >= 256 {
            return Err(error("PROBE_EVIDENCE_LIMIT","probe evidence events=256 limit=256; restart with a fresh dedicated state directory"));
        }
        let receipt = json!({"sequence":events.len()+1,"unix_millis":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().to_string(),"pid":std::process::id(),"action":action,"result":result.as_ref().ok(),"error":result.as_ref().err()});
        events.push(receipt.clone());
        let raw = serde_json::to_vec_pretty(&*events).map_err(|e| {
            error(
                "PROBE_EVIDENCE_JSON",
                format!(
                    "probe evidence serialization failed: category={:?}",
                    e.classify()
                ),
            )
        })?;
        preferences::private_write(&self.root.join("evidence.json"), &raw)
            .map_err(|e| io_error("save probe evidence", e))?;
        println!("{receipt}");
        Ok(receipt)
    }
}
fn error(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError {
        code: code.into(),
        message: message.into(),
        details: None,
    }
}
fn io_error(stage: &str, cause: std::io::Error) -> BridgeError {
    error(
        "PROBE_IO",
        format!(
            "{stage} failed: kind={:?} os_code={:?}; cause={cause}",
            cause.kind(),
            cause.raw_os_error()
        ),
    )
}
fn active() -> NotificationEvent {
    NotificationEvent::Problem {
        notice: Notice {
            identity: FIXED_IDENTITY.into(),
            platform: NotificationPlatform::Openai,
            problem: NotificationProblem::AuthorizationRejected,
        },
        eligible: true,
    }
}
fn save_preferences(
    app: &tauri::AppHandle,
    change: impl FnOnce(&mut preferences::DesktopPreferences),
) -> Result<PreferencesSnapshot, BridgeError> {
    let store = app.state::<PreferencesStore>();
    let mut saved = store.read();
    if let Some(error) = saved.error {
        return Err(error);
    }
    change(&mut saved.preferences);
    let saved = store.save(saved.preferences.revision, saved.preferences);
    if let Some(error) = saved.error {
        return Err(error);
    }
    Ok(saved)
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Action {
    Info,
    QueryPermission,
    EnableNotifications,
    DisableNotifications,
    SubmitNotice,
    RepeatNotice,
    RecoverAndResubmit,
    QueryAutostart,
    EnableAutostart,
    DisableAutostart,
    VerifySafeLogs,
    VerifyPreferences,
    RestoreAutostart,
    SmokeComplete,
    PrepareReportSave,
    PrepareReportCancel,
    PrepareReportWriteFailure,
}
fn action_name(action: Action) -> &'static str {
    match action {
        Action::Info => "info",
        Action::QueryPermission => "query_permission",
        Action::EnableNotifications => "enable_notifications",
        Action::DisableNotifications => "disable_notifications",
        Action::SubmitNotice => "submit_notice",
        Action::RepeatNotice => "repeat_notice",
        Action::RecoverAndResubmit => "recover_and_resubmit",
        Action::QueryAutostart => "query_autostart",
        Action::EnableAutostart => "enable_autostart",
        Action::DisableAutostart => "disable_autostart",
        Action::VerifySafeLogs => "verify_safe_logs",
        Action::VerifyPreferences => "verify_preferences",
        Action::RestoreAutostart => "restore_autostart",
        Action::SmokeComplete => "smoke_complete",
        Action::PrepareReportSave => "prepare_report_save",
        Action::PrepareReportCancel => "prepare_report_cancel",
        Action::PrepareReportWriteFailure => "prepare_report_write_failure",
    }
}
fn perform(app: &tauri::AppHandle, action: Action) -> Result<Value, BridgeError> {
    if app.config().identifier != IDENTIFIER {
        return Err(error(
            "PROBE_IDENTITY",
            format!("probe identifier mismatch: expected={IDENTIFIER}; no system action executed"),
        ));
    }
    let service = app.state::<NotificationService>();
    match action {
        Action::Info => Ok(
            json!({"identifier":IDENTIFIER,"state_directory":app.state::<Evidence>().root,"preferences":app.state::<PreferencesStore>().read(),"fixed_notice_identity":FIXED_IDENTITY,"real_os":true,"bridge_started":false,"autostart_registration":IDENTIFIER,"smoke_requested":app.state::<Evidence>().smoke_requested,"notification_smoke_requested":app.state::<Evidence>().notification_smoke_requested}),
        ),
        Action::QueryPermission => Ok(json!({"permission":service.permission()?})),
        Action::EnableNotifications => {
            // The notification smoke never calls the permission-requesting API,
            // including if OS permission changes between the JS guard and this action.
            let permission = if app.state::<Evidence>().notification_smoke_requested {
                let permission = service.permission()?;
                if permission != notifications::Permission::Granted {
                    return Err(error("PROBE_PERMISSION_NOT_GRANTED",format!("notification smoke stopped: actual_permission={permission:?} required=Granted; requestAuthorization was not called")));
                }
                permission
            } else {
                // Only this explicitly clicked non-smoke UI action can request permission.
                service.enable()?
            };
            let saved = save_preferences(app, |prefs| prefs.notifications_enabled = true)?;
            Ok(json!({"permission":permission,"preferences":saved}))
        }
        Action::DisableNotifications => Ok(
            json!({"preferences":save_preferences(app,|prefs|prefs.notifications_enabled=false)?}),
        ),
        Action::SubmitNotice | Action::RepeatNotice | Action::RecoverAndResubmit => {
            let saved = app.state::<PreferencesStore>().read();
            if let Some(error) = saved.error {
                return Err(error);
            }
            let recovery = if matches!(action, Action::RecoverAndResubmit) {
                service.reconcile(
                    false,
                    &[NotificationEvent::Recovered {
                        identity: FIXED_IDENTITY.into(),
                    }],
                )?
            } else {
                vec![]
            };
            let outcomes =
                service.reconcile(saved.preferences.notifications_enabled, &[active()])?;
            Ok(
                json!({"notifications_enabled":saved.preferences.notifications_enabled,"recovery_outcomes":recovery,"submission_outcomes":outcomes,"receipt_semantics":"accepted means OS API accepted submission; display/read requires separate visual evidence"}),
            )
        }
        Action::QueryAutostart => {
            let saved = app.state::<PreferencesStore>().read();
            if let Some(error) = saved.error {
                return Err(error);
            }
            Ok(
                json!({"autostart":autostart::status(saved.preferences.autostart_desired,&autostart::NativeRegistrar(app))}),
            )
        }
        Action::EnableAutostart | Action::DisableAutostart => {
            let enabled = matches!(action, Action::EnableAutostart);
            {
                let evidence = app.state::<Evidence>();
                let mut original = evidence.original_autostart.lock().map_err(|_| {
                    error(
                        "PROBE_AUTOSTART_GUARD",
                        "probe original-autostart mutex poisoned; registration not changed",
                    )
                })?;
                if original.is_none() {
                    *original = Some(autostart::Registrar::registered(
                        &autostart::NativeRegistrar(app),
                    )?);
                }
            }
            let saved = save_preferences(app, |prefs| prefs.autostart_desired = enabled)?;
            // This name belongs exclusively to the probe, never to Bee Dev.
            app.state::<Evidence>()
                .changed_autostart
                .store(true, Ordering::Release);
            Ok(
                json!({"autostart":autostart::apply(saved.preferences.autostart_desired,&autostart::NativeRegistrar(app))}),
            )
        }
        Action::RestoreAutostart => restore_autostart(app),
        Action::VerifyPreferences => {
            let original = app.state::<PreferencesStore>().read();
            if let Some(error) = original.error {
                return Err(error);
            }
            let saved = save_preferences(app, |prefs| {
                prefs.language = preferences::Language::Zh;
                prefs.theme = preferences::Theme::Dark;
            })?;
            let fresh = PreferencesStore::new(
                app.state::<Evidence>()
                    .root
                    .join("desktop-preferences.json"),
            )
            .read();
            if let Some(error) = fresh.error {
                return Err(error);
            }
            if fresh.preferences != saved.preferences {
                return Err(error("PROBE_PREFERENCES_READBACK",format!("fresh preferences readback mismatch: saved_revision={} observed_revision={}",saved.preferences.revision,fresh.preferences.revision)));
            }
            let restored = save_preferences(app, |prefs| {
                prefs.language = original.preferences.language;
                prefs.theme = original.preferences.theme;
            })?;
            Ok(
                json!({"saved":saved,"fresh_store_readback":fresh,"restored":restored,"fresh_readback_matches":true}),
            )
        }
        Action::SmokeComplete => {
            let evidence = app.state::<Evidence>();
            let events = evidence.events.lock().map_err(|_| {
                error(
                    "PROBE_EVIDENCE_LOCK",
                    "probe evidence mutex poisoned; smoke cannot be verified",
                )
            })?;
            for required in [
                "verify_preferences",
                "verify_safe_logs",
                "query_permission",
                "query_autostart",
                "enable_autostart",
                "disable_autostart",
                "restore_autostart",
            ] {
                if !events
                    .iter()
                    .any(|event| event["action"] == required && event["error"].is_null())
                {
                    return Err(error(
                        "PROBE_SMOKE_INCOMPLETE",
                        format!("smoke receipt absent or failed: action={required}"),
                    ));
                }
            }
            if !events.iter().any(|event| {
                event["action"] == "download_cancelled"
                    && event["result"]["destination_exists"] == false
                    && event["result"]["source"] == "actual_webview_requested_return_false"
            }) {
                return Err(error(
                    "PROBE_SMOKE_INCOMPLETE",
                    "actual WebView Requested cancellation receipt missing or destination exists",
                ));
            }
            for (mode, success) in [("save", true), ("write_failure", false)] {
                if !events.iter().any(|event| {
                    event["action"] == "download_finished"
                        && event["result"]["mode"] == mode
                        && event["result"]["success"] == success
                        && (mode != "save"
                            || event["result"]["saved_file_verification"]["bytes_match_expected"]
                                == true)
                }) {
                    return Err(error("PROBE_SMOKE_INCOMPLETE",format!("actual WebView Finished receipt missing: mode={mode} required_success={success}")));
                }
            }
            Ok(
                json!({"passed":true,"notification_permission_requested":false,"notification_submitted":false,"autostart_restored":!evidence.changed_autostart.load(Ordering::Acquire),"real_webview_download_modes":["save","cancel","write_failure"]}),
            )
        }
        Action::VerifySafeLogs => {
            let logs = app.state::<diagnostic_log::DiagnosticLogStore>();
            let mut stored = vec![];
            for _ in 0..3 {
                stored.push(logs.record(json!({"time":"2026-10-28T00:00:00Z","level":"info","module":"runtime","platform":null,"code":"runtime_stopped","evidence":{"local":"stopped","connection":"disconnected","authorization":"PROBE_SYNTHETIC_REDACTION_MARKER"},"unrecognized":"PROBE_SYNTHETIC_REDACTION_MARKER"}))?);
            }
            let first = logs.page(diagnostic_log::LogQuery {
                cursor: None,
                limit: 2,
                module: Some("runtime".into()),
                platform: None,
                level: Some("info".into()),
            })?;
            let cursor=first.next_cursor.clone().ok_or_else(||error("PROBE_LOG_CURSOR","log pagination returned no continuation after three inserted records with page limit=2"))?;
            let second = logs.page(diagnostic_log::LogQuery {
                cursor: Some(cursor),
                limit: 2,
                module: Some("runtime".into()),
                platform: None,
                level: Some("info".into()),
            })?;
            Ok(
                json!({"stored_safe_events":stored,"first_page":first,"second_page":second,"directory":app.state::<Evidence>().root.join("diagnostic-logs"),"synthetic_input_only":true}),
            )
        }
        Action::PrepareReportSave
        | Action::PrepareReportCancel
        | Action::PrepareReportWriteFailure => {
            let mode = match action {
                Action::PrepareReportCancel => DownloadMode::Cancel,
                Action::PrepareReportWriteFailure => DownloadMode::WriteFailure,
                _ => DownloadMode::Save,
            };
            let report = diagnostics_protocol::DiagnosticReport {
                id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into(),
                instance: "cccccccccccccccccccccccccccccccc".into(),
                run_id: None,
                network_revision: 0,
                binding_revision: 0,
                started_at: "2026-10-28T00:00:00Z".into(),
                finished_at: Some("2026-10-28T00:00:01Z".into()),
                state: "completed".into(),
                checks: vec![],
            };
            let export = diagnostic_log::assemble_export(
                diagnostic_log::ExportMetadata {
                    app_version: "0.1.0".into(),
                    bee_version: "dev".into(),
                    os: std::env::consts::OS.into(),
                    arch: std::env::consts::ARCH.into(),
                },
                report,
                app.state::<diagnostic_log::DiagnosticLogStore>()
                    .export_entries()?,
            )?;
            let text = serde_json::to_string_pretty(&export).map_err(|e| {
                error(
                    "PROBE_REPORT_JSON",
                    format!("synthetic whitelist report serialization failed: {e}"),
                )
            })?;
            let evidence = app.state::<Evidence>();
            let destination = if matches!(mode, DownloadMode::WriteFailure) {
                let target = evidence.root.join("download-readonly-target");
                std::fs::create_dir_all(&target)
                    .map_err(|e| io_error("prepare download directory failure target", e))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o500))
                        .map_err(|e| io_error("make probe download directory read-only", e))?;
                }
                target.join("must-not-be-written.json")
            } else {
                evidence.root.join(format!(
                    "report-{}.json",
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_nanos()
                ))
            };
            let mut downloads = evidence.downloads.lock().map_err(|_| {
                error(
                    "PROBE_DOWNLOAD_LOCK",
                    "probe download mutex poisoned; download was not armed",
                )
            })?;
            if downloads.next.is_some() {
                return Err(error("PROBE_DOWNLOAD_PENDING","another download is armed but Requested has not arrived; retry after existing receipt"));
            }
            downloads.next = Some(DownloadPlan {
                mode,
                expected: text.as_bytes().to_vec(),
                destination: destination.clone(),
            });
            Ok(
                json!({"mode":mode,"report_json":text,"destination":destination,"synthetic_input_only":true,"prepared_only":true}),
            )
        }
    }
}
#[tauri::command]
async fn probe_action(app: tauri::AppHandle, action: Action) -> Result<Value, BridgeError> {
    tokio::task::spawn_blocking(move || {
        let gate = app.state::<autostart::AutostartLock>();
        let _guard = gate.0.lock().map_err(|_| {
            error(
                "PROBE_ACTION_LOCK",
                "probe action gate poisoned; no further system actions allowed",
            )
        })?;
        let result = perform(&app, action);
        let receipt = app
            .state::<Evidence>()
            .record(action_name(action), &result)?;
        app.emit_to("probe", "probe://receipt", &receipt)
            .map_err(|e| {
                error(
                    "PROBE_RECEIPT_EVENT",
                    format!("probe action receipt saved but WebView event failed: {e}"),
                )
            })?;
        result
    })
    .await
    .map_err(|e| {
        error(
            "PROBE_WORKER",
            format!(
                "probe action worker join failed: cancelled={} panicked={}",
                e.is_cancelled(),
                e.is_panic()
            ),
        )
    })?
}
#[tauri::command]
fn probe_quit(app: tauri::AppHandle) {
    app.exit(0);
}
#[tauri::command]
fn probe_smoke_failed(app: tauri::AppHandle, detail: String) -> Result<Value, BridgeError> {
    let detail: String = detail.chars().take(4096).collect();
    app.state::<Evidence>()
        .record("smoke_failed", &Err(error("PROBE_SMOKE_FAILED", detail)))
}

fn restore_autostart(app: &tauri::AppHandle) -> Result<Value, BridgeError> {
    let evidence = app.state::<Evidence>();
    let original = *evidence.original_autostart.lock().map_err(|_| {
        error(
            "PROBE_AUTOSTART_GUARD",
            "probe original-autostart mutex poisoned; original state cannot be recovered",
        )
    })?;
    let Some(original) = original else {
        return Ok(json!({"changed":false,"reason":"probe never changed registration"}));
    };
    let snapshot = autostart::apply(original, &autostart::NativeRegistrar(app));
    if snapshot.error.is_none() && snapshot.registered == Some(original) {
        save_preferences(app, |prefs| prefs.autostart_desired = original)?;
        evidence.changed_autostart.store(false, Ordering::Release);
    }
    Ok(
        json!({"autostart":snapshot,"original_registered":original,"restored":!evidence.changed_autostart.load(Ordering::Acquire)}),
    )
}
struct AutostartRestoreGuard(tauri::AppHandle);
impl Drop for AutostartRestoreGuard {
    fn drop(&mut self) {
        if self
            .0
            .state::<Evidence>()
            .changed_autostart
            .load(Ordering::Acquire)
        {
            let result = restore_autostart(&self.0);
            let _ = self
                .0
                .state::<Evidence>()
                .record("autostart_guard_cleanup", &result);
        }
    }
}

fn download_event(webview: tauri::Webview, event: tauri::webview::DownloadEvent<'_>) -> bool {
    let evidence = webview.state::<Evidence>();
    match event {
        tauri::webview::DownloadEvent::Requested { url, destination } => {
            let plan = match evidence.downloads.lock() {
                Ok(mut downloads) => downloads.next.take(),
                Err(_) => None,
            };
            let Some(plan) = plan else {
                let result=Err(error("PROBE_DOWNLOAD_UNARMED","actual WebView download arrived without an explicitly armed probe action; destination not used"));
                let _ = evidence.record("download_requested", &result);
                return false;
            };
            *destination = plan.destination.clone();
            let cancel = matches!(plan.mode, DownloadMode::Cancel);
            let result = Ok(
                json!({"url":url.as_str(),"mode":plan.mode,"destination":destination,"allowed":!cancel,"source":"actual_webview_download_requested","probe_destination_override":true}),
            );
            if let Err(error) = evidence.record("download_requested", &result) {
                eprintln!(
                    "probe download denied because receipt could not be saved: code={} message={}",
                    error.code, error.message
                );
                return false;
            }
            if cancel {
                let result = Ok(
                    json!({"url":url.as_str(),"mode":"cancel","destination_exists":plan.destination.exists(),"source":"actual_webview_requested_return_false","finished_expected":false}),
                );
                if let Ok(receipt) = evidence.record("download_cancelled", &result) {
                    let _ = webview.emit_to("probe", "probe://receipt", receipt);
                }
                let _=webview.emit_to("probe","probe://download-cancelled",json!({"url":url.as_str(),"success":false,"source":"actual_webview_requested_return_false"}));
                return false;
            }
            let Ok(mut downloads) = evidence.downloads.lock() else {
                return false;
            };
            downloads.inflight.insert(url.to_string(), plan);
            true
        }
        tauri::webview::DownloadEvent::Finished { url, path, success } => {
            let plan = evidence
                .downloads
                .lock()
                .ok()
                .and_then(|mut downloads| downloads.inflight.remove(url.as_str()));
            let saved = plan
                .as_ref()
                .map(|plan| inspect_download(&plan.destination, &plan.expected));
            let result = Ok(
                json!({"url":url.as_str(),"success":success,"native_path":path,"mode":plan.as_ref().map(|p|p.mode),"probe_destination":plan.as_ref().map(|p|&p.destination),"saved_file_verification":saved,"source":"actual_webview_download_finished"}),
            );
            match evidence.record("download_finished", &result) {
                Ok(receipt) => {
                    let _ = webview.emit_to("probe", "probe://receipt", receipt);
                }
                Err(error) => eprintln!(
                    "probe download result receipt failed: code={} message={}",
                    error.code, error.message
                ),
            }
            if let Err(error) = webview.emit_to(
                "probe",
                "probe://download-finished",
                json!({"url":url.as_str(),"success":success}),
            ) {
                eprintln!("probe download WebView event failed: success={success} cause={error}");
            }
            true
        }
        _ => false,
    }
}

fn inspect_download(path: &std::path::Path, expected: &[u8]) -> Value {
    use std::io::Read;
    let read = || -> std::io::Result<Vec<u8>> {
        let metadata = std::fs::symlink_metadata(path)?;
        if !metadata.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "download target is not a regular file: type={:?}",
                    metadata.file_type()
                ),
            ));
        }
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        let mut bytes = vec![];
        options
            .open(path)?
            .take(5 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > 5 * 1024 * 1024 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::FileTooLarge,
                format!("download bytes={} limit=5242880", bytes.len()),
            ));
        }
        Ok(bytes)
    };
    match read() {
        Ok(bytes) => json!({"byte_count":bytes.len(),"bytes_match_expected":bytes==expected}),
        Err(error) => {
            json!({"read_error_kind":format!("{:?}",error.kind()),"read_error_os_code":error.raw_os_error(),"cause":error.to_string()})
        }
    }
}

fn main() {
    let smoke_requested = std::env::args().any(|arg| arg == "--smoke");
    let notification_smoke_requested = std::env::args().any(|arg| arg == "--notification-smoke");
    let cache = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("probe manifest repository parent")
        .join(".cache/s2-experience-probe");
    let root = paths::prepare_root(std::env::var_os("BEE_S2_PROBE_DIR").as_deref(), &cache)
        .unwrap_or_else(|e| panic!("probe isolation path check failed: {e}"));
    let journal = root.join("evidence.json");
    let events = match preferences::protected_read_bounded(&journal, 1_048_576) {
        Ok(raw) => serde_json::from_slice::<Vec<Value>>(&raw)
            .expect("probe evidence JSON must remain valid; preserve original before restart"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
        Err(e) => panic!(
            "read probe evidence failed: kind={:?} os_code={:?}",
            e.kind(),
            e.raw_os_error()
        ),
    };
    let app=tauri::Builder::default()
        .manage(Evidence{root:root.clone(),events:Mutex::new(events),changed_autostart:AtomicBool::new(false),original_autostart:Mutex::new(None),smoke_requested,notification_smoke_requested,downloads:Mutex::new(Downloads::default())})
        .manage(diagnostic_log::DiagnosticLogStore::new(root.join("diagnostic-logs")))
        .manage(PreferencesStore::new(root.join("desktop-preferences.json")))
        .manage(autostart::AutostartLock::default())
        .plugin(tauri_plugin_autostart::Builder::new().app_name(IDENTIFIER).args(["--bee-s2-probe-background"]).build())
        .invoke_handler(tauri::generate_handler![probe_action,probe_quit,probe_smoke_failed])
        .setup(move|app| {
            let handle=app.handle().clone();
            let adapter=NativeNotificationAdapter::new(IDENTIFIER.into(),Arc::new(move|page| {
                let result=Ok(json!({"page":page,"source":"actual_os_notification_callback"}));
                if let Ok(receipt)=handle.state::<Evidence>().record("notification_navigation",&result) {
                    let _=handle.emit_to("probe","probe://receipt",receipt);
                }
                if let Some(window)=handle.get_webview_window("probe") {let _=window.show();let _=window.unminimize();let _=window.set_focus();}
            }),Arc::new(lifecycle::NativeLanguage::default()));
            app.manage(NotificationService::new(root.join("notification-delivery.json"),Arc::new(adapter)));
            let config=app.config().app.windows.first().expect("dedicated probe window config");
            tauri::WebviewWindowBuilder::from_config(app,config)?
                .data_directory(root.join("webview"))
                .on_navigation(|url| matches!(url.scheme(),"tauri"|"http"|"https") && matches!(url.host_str(),Some("localhost"|"tauri.localhost")))
                .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
                .on_download(download_event)
                .build()?;
            app.state::<Evidence>().record("started",&Ok(json!({"identifier":IDENTIFIER,"state_directory":root,"permission_requested":false,"notice_submitted":false,"autostart_changed":false,"bridge_started":false}))).map_err(|e|std::io::Error::other(format!("{}: {}",e.code,e.message)))?;
            Ok(())
        })
        .build(tauri::generate_context!("../tests/fixtures/experience-probe/tauri.conf.json"))
        .expect("build dedicated native experience probe");
    let _restore_guard = AutostartRestoreGuard(app.handle().clone());
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit)
            && app
                .state::<Evidence>()
                .changed_autostart
                .load(Ordering::Acquire)
        {
            let gate = app.state::<autostart::AutostartLock>();
            let _guard = gate.0.lock().unwrap_or_else(|p| p.into_inner());
            let result = restore_autostart(app);
            if let Err(error) = app.state::<Evidence>().record("autostart_cleanup", &result) {
                eprintln!(
                    "probe cleanup receipt failed: code={} message={}",
                    error.code, error.message
                );
            }
        }
    });
}
