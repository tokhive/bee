use crate::{
    protocol::{AccountActionRequest, AccountDetectRequest, BridgeError, SupplyPlatform},
    sidecar::{Bridge, BridgeReply, BridgeStatus},
};
use tauri::Manager;

#[tauri::command]
pub fn preferences_read(
    store: tauri::State<'_, crate::preferences::PreferencesStore>,
) -> crate::preferences::PreferencesSnapshot {
    store.read()
}

#[tauri::command]
pub fn preferences_save(
    store: tauri::State<'_, crate::preferences::PreferencesStore>,
    request: crate::preferences::SavePreferencesRequest,
) -> crate::preferences::PreferencesSnapshot {
    store.save(request.expected_revision, request.preferences)
}

fn notification_join_failure(code: &str, operation: &str, error: tauri::Error) -> BridgeError {
    let evidence = match &error {
        tauri::Error::JoinError(join) => format!(
            "panicked={} cancelled={}",
            join.is_panic(),
            join.is_cancelled()
        ),
        other => other.to_string(),
    };
    BridgeError {
        details: None,
        code: code.into(),
        message: format!("{operation} worker failed to join: {evidence}"),
    }
}

fn check_method(method: &str) -> Result<(), BridgeError> {
    if method == "ping" {
        return Ok(());
    }
    Err(BridgeError {
        details: None,
        code: "METHOD_NOT_ALLOWED".into(),
        message: format!(
            "frontend method rejected: actual bytes={}; required=ping",
            method.len()
        ),
    })
}

#[tauri::command]
pub async fn bridge_request(
    bridge: tauri::State<'_, Bridge>,
    method: String,
) -> Result<BridgeReply, BridgeError> {
    check_method(&method)?;
    bridge.ping().await
}

#[tauri::command]
pub fn bridge_status(bridge: tauri::State<'_, Bridge>) -> BridgeStatus {
    bridge.status()
}

#[tauri::command]
pub async fn account_defaults(
    bridge: tauri::State<'_, Bridge>,
) -> Result<BridgeReply, BridgeError> {
    bridge.account_defaults().await
}
#[tauri::command]
pub async fn account_detect(
    bridge: tauri::State<'_, Bridge>,
    request: AccountDetectRequest,
) -> Result<BridgeReply, BridgeError> {
    bridge.account_detect(request).await
}
#[tauri::command]
pub async fn account_snapshot(
    bridge: tauri::State<'_, Bridge>,
    platform: SupplyPlatform,
    refresh: bool,
) -> Result<BridgeReply, BridgeError> {
    bridge.account_snapshot(platform, refresh).await
}
#[tauri::command]
pub async fn account_action(
    bridge: tauri::State<'_, Bridge>,
    request: AccountActionRequest,
    gate: tauri::State<'_, crate::experience::StartupGate>,
) -> Result<BridgeReply, BridgeError> {
    gate.check()?;
    bridge.account_action(request).await
}

#[tauri::command]
pub async fn device_status(bridge: tauri::State<'_, Bridge>) -> Result<BridgeReply, BridgeError> {
    bridge.device_status().await
}

#[tauri::command]
pub async fn device_begin(
    bridge: tauri::State<'_, Bridge>,
    hive: String,
    name: String,
) -> Result<BridgeReply, BridgeError> {
    bridge.device_begin(hive, name).await
}

#[tauri::command]
pub async fn supply_status(
    bridge: tauri::State<'_, Bridge>,
    platform: SupplyPlatform,
) -> Result<BridgeReply, BridgeError> {
    bridge.supply_status(platform).await
}

#[tauri::command]
pub async fn supply_set_paused(
    bridge: tauri::State<'_, Bridge>,
    gate: tauri::State<'_, crate::experience::StartupGate>,
    platform: SupplyPlatform,
    paused: bool,
) -> Result<BridgeReply, BridgeError> {
    if !paused {
        gate.check()?;
    }
    bridge.supply_set_paused(platform, paused).await
}

fn pairing_url(value: &serde_json::Value) -> Result<tauri::Url, BridgeError> {
    let rejected = || {
        BridgeError { details: None, code: "PAIRING_URL_REJECTED".into(), message: "device browser URL failed same-Hive /devices/pair and public-code validation; refresh device pairing".into() }
    };
    let device = value.get("device").ok_or_else(rejected)?;
    let hive = tauri::Url::parse(
        device
            .get("hive")
            .and_then(|v| v.as_str())
            .ok_or_else(rejected)?,
    )
    .map_err(|_| rejected())?;
    let url = tauri::Url::parse(
        device
            .get("verification_url")
            .and_then(|v| v.as_str())
            .ok_or_else(rejected)?,
    )
    .map_err(|_| rejected())?;
    let local = url.host_str() == Some("localhost")
        || url.host_str().is_some_and(|host| {
            host.trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
        });
    let query: Vec<_> = url.query_pairs().collect();
    let code_ok = query.len() == 1
        && query[0].0 == "code"
        && query[0].1.len() == 9
        && query[0].1.bytes().enumerate().all(|(i, b)| {
            if i == 4 {
                b == b'-'
            } else {
                b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b)
            }
        });
    if url.origin() != hive.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path() != "/devices/pair"
        || !code_ok
        || !(url.scheme() == "https" || url.scheme() == "http" && local)
    {
        return Err(rejected());
    }
    Ok(url)
}

fn pairing_browser_action(value: &serde_json::Value) -> Result<Option<tauri::Url>, BridgeError> {
    match value
        .pointer("/device/state")
        .and_then(|state| state.as_str())
    {
        Some("bound" | "expired" | "unbound" | "pairing") => Ok(None),
        _ => pairing_url(value).map(Some),
    }
}

fn recovery_browser_action(
    value: &serde_json::Value,
    context: &serde_json::Value,
) -> Result<tauri::Url, BridgeError> {
    let recovery = crate::protocol::device_recovery(value)?;
    crate::protocol::device_context(context)?;
    if !matches!(recovery["phase"].as_str(), Some("pending" | "draining")) {
        return Err(BridgeError::new("DEVICE_RECOVERY_OPEN_PHASE", format!(
            "recovery browser open rejected: phase={}; required=pending or draining; refresh the original transaction",
            recovery["phase"].as_str().unwrap_or("unknown"),
        )));
    }
    pairing_url(&serde_json::json!({"device":{
        "hive":context["context"]["hive"],
        "verification_url":recovery["pairing"]["verification_url"],
    }}))
}

async fn wait_opener(
    mut command: tokio::process::Command,
    duration: std::time::Duration,
) -> Result<(), BridgeError> {
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|cause| BridgeError {
        details: None,
        code: "BROWSER_OPEN_FAILED".into(),
        message: format!("start system browser launcher: {cause}"),
    })?;
    let status = match tokio::time::timeout(duration, child.wait()).await {
        Ok(result) => result.map_err(|cause| BridgeError {
            details: None,
            code: "BROWSER_OPEN_FAILED".into(),
            message: format!("wait for system browser launcher: {cause}"),
        })?,
        Err(_) => {
            child.kill().await.map_err(|cause| BridgeError {
                details: None,
                code: "BROWSER_OPEN_CLEANUP_FAILED".into(),
                message: format!(
                    "browser launcher exceeded {}ms; terminate and reap failed: {cause}",
                    duration.as_millis()
                ),
            })?;
            return Err(BridgeError { details: None, code: "BROWSER_OPEN_TIMEOUT".into(), message: format!("browser launcher exceeded {}ms and was reaped; opening result is unconfirmed; use the displayed pairing URL", duration.as_millis()) });
        }
    };
    if !status.success() {
        return Err(BridgeError { details: None, code: "BROWSER_OPEN_FAILED".into(), message: format!("system browser launcher exited with status={status}; use the displayed pairing URL") });
    }
    Ok(())
}

#[tauri::command]
pub async fn device_open(
    app: tauri::AppHandle,
    bridge: tauri::State<'_, Bridge>,
) -> Result<BridgeReply, BridgeError> {
    let reply = bridge.device_status().await?;
    let (reply, url) = if let Some(cause) = reply.result.get("error") {
        if !matches!(
            cause["code"].as_str(),
            Some("device_replaced" | "invalid_device_credential")
        ) {
            return Ok(reply);
        }
        let before = bridge.device_context().await?;
        crate::protocol::device_context(&before.result)?;
        let recovery = crate::experience::recover_device(&app, &bridge, None, false).await?;
        let current = bridge.device_context().await?;
        crate::protocol::device_context(&current.result)?;
        if before.instance != current.instance || before.result != current.result {
            return Err(BridgeError::new("DEVICE_RECOVERY_OPEN_CONTEXT", "recovery browser context changed during transaction lookup; refresh the original recovery before opening its page".into()));
        }
        let url = recovery_browser_action(&recovery.result, &current.result)?;
        (recovery, url)
    } else {
        let Some(url) = pairing_browser_action(&reply.result)? else {
            return Ok(reply);
        };
        (reply, url)
    };
    // No shell interpolation or executable/path supplied by the frontend.
    #[cfg(target_os = "macos")]
    let command = {
        let mut c = tokio::process::Command::new("/usr/bin/open");
        c.arg(url.as_str());
        c
    };
    #[cfg(target_os = "linux")]
    let command = {
        let mut c = tokio::process::Command::new("xdg-open");
        c.arg(url.as_str());
        c
    };
    #[cfg(target_os = "windows")]
    let command = {
        let mut c = tokio::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler").arg(url.as_str());
        c.creation_flags(0x08000000);
        c
    };
    wait_opener(command, std::time::Duration::from_secs(5)).await?;
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_can_only_send_ping_without_paths_or_arguments() {
        check_method("ping").unwrap();
        for method in [
            "hello",
            "shutdown",
            "start",
            "bee desktop",
            "/bin/sh",
            "ping --help",
            "supply_status",
            "supply_set_paused",
            "device_recovery_prepare",
            "device_recovery_confirm",
            "device_recovery_status",
            "",
        ] {
            let error = check_method(method).unwrap_err();
            assert_eq!(error.code, "METHOD_NOT_ALLOWED");
            assert!(error.message.contains("required=ping"));
            assert!(
                !error.message.contains(method) || method.is_empty() || method == "ping --help"
            );
        }
    }
}

#[cfg(test)]
mod device_tests {
    use super::*;
    #[test]
    fn browser_url_is_limited_to_saved_pairing() {
        let valid = serde_json::json!({"device":{"hive":"https://hive.example","verification_url":"https://hive.example/devices/pair?code=ABCD-EFGH"}});
        assert!(pairing_url(&valid).is_ok());
        for url in [
            "https://other.example/devices/pair?code=ABCD-EFGH",
            "https://hive.example/other?code=ABCD-EFGH",
            "https://hive.example/devices/pair?code=ABCD-EFGH&extra=1",
            "https://user@hive.example/devices/pair?code=ABCD-EFGH",
            "http://hive.example/devices/pair?code=ABCD-EFGH",
        ] {
            let value = serde_json::json!({"device":{"hive":"https://hive.example","verification_url":url}});
            assert!(pairing_url(&value).is_err(), "accepted {url}");
        }
    }
}

#[cfg(test)]
mod browser_action_tests {
    use super::*;
    #[test]
    fn completed_or_expired_pairing_returns_without_opening_a_stale_url() {
        for state in ["bound", "expired", "unbound", "pairing"] {
            assert!(
                pairing_browser_action(&serde_json::json!({"device":{"state":state}}))
                    .unwrap()
                    .is_none()
            );
        }
    }
    #[test]
    fn recovery_browser_uses_only_current_same_origin_pending_transaction() {
        let context = serde_json::json!({"context":{"hive":"https://hive.example","name":"Mac","device_id":"old","owner_id":"owner","binding_revision":1}});
        let value = serde_json::json!({"recovery":{"operation_id":"a".repeat(48),"revision":1,"phase":"pending","old_identity":null,"new_identity":null,"pairing":{"code":"ABCD-EFGH","verification_url":"https://hive.example/devices/pair?code=ABCD-EFGH","expires_at":"2030-01-01T00:00:00Z"},"failure":null}});
        assert!(recovery_browser_action(&value, &context).is_ok());
        let mut changed = value.clone();
        changed["recovery"]["phase"] = serde_json::json!("creation_unknown");
        assert_eq!(
            recovery_browser_action(&changed, &context)
                .unwrap_err()
                .code,
            "DEVICE_RECOVERY_OPEN_PHASE"
        );
        changed = value.clone();
        changed["recovery"]["pairing"]["verification_url"] =
            serde_json::json!("https://other.example/devices/pair?code=ABCD-EFGH");
        assert_eq!(
            recovery_browser_action(&changed, &context)
                .unwrap_err()
                .code,
            "PAIRING_URL_REJECTED"
        );
        let mut bad_context = context.clone();
        bad_context["context"]["hive"] = serde_json::json!("https://user@hive.example");
        assert!(recovery_browser_action(&value, &bad_context).is_err());
    }

    #[tokio::test]
    async fn browser_launcher_wait_is_bounded() {
        let mut command = tokio::process::Command::new("node");
        command.args(["-e", "setInterval(()=>{},1000)"]);
        let failure = wait_opener(command, std::time::Duration::from_millis(80))
            .await
            .unwrap_err();
        assert_eq!(failure.code, "BROWSER_OPEN_TIMEOUT");
    }
}

#[tauri::command]
pub async fn runtime_snapshot(
    bridge: tauri::State<'_, Bridge>,
    diagnostics: tauri::State<'_, crate::diagnostics_native::NativeDiagnostics>,
) -> Result<BridgeReply, BridgeError> {
    let reply = bridge.runtime_snapshot().await?;
    diagnostics.capture_runtime(&reply)?;
    Ok(reply)
}
#[tauri::command]
pub async fn runtime_start(
    bridge: tauri::State<'_, Bridge>,
    mut request: crate::runtime_protocol::RuntimeStartRequest,
    gate: tauri::State<'_, crate::experience::StartupGate>,
    store: tauri::State<'_, crate::preferences::PreferencesStore>,
    controller: tauri::State<'_, crate::network::NetworkController>,
) -> Result<BridgeReply, BridgeError> {
    gate.check()?;
    request.validate()?;
    let device = bridge.device_status().await?;
    let scope=controller.bind_verified_device(&store,&device.result)?.ok_or_else(||BridgeError{ details: None,code:"NETWORK_SCOPE_REQUIRED".into(),message:"runtime start requires a freshly verified bound device; actual=no trusted device scope".into()})?;
    request.expected_revision = controller
        .prepare_start(
            &store,
            &crate::network_native::BridgeNetworkRuntime(&bridge),
            &scope,
            request.expected_revision,
        )
        .await?;
    bridge.runtime_start(request).await
}
#[tauri::command]
pub async fn runtime_stop(
    bridge: tauri::State<'_, Bridge>,
    expected_revision: u64,
) -> Result<BridgeReply, BridgeError> {
    bridge
        .runtime_stop(
            expected_revision,
            crate::runtime_protocol::RuntimeStopReason::UserStop,
        )
        .await
}

#[tauri::command]
pub async fn authorize_start(
    bridge: tauri::State<'_, Bridge>,
    request: crate::authorize_protocol::AuthorizeRequest,
) -> Result<BridgeReply, BridgeError> {
    bridge.authorize_start(request).await
}
#[tauri::command]
pub async fn authorize_status(
    bridge: tauri::State<'_, Bridge>,
    operation_id: String,
) -> Result<BridgeReply, BridgeError> {
    bridge.authorize_status(operation_id).await
}
#[tauri::command]
pub async fn authorize_cancel(
    bridge: tauri::State<'_, Bridge>,
    operation_id: String,
) -> Result<BridgeReply, BridgeError> {
    bridge.authorize_cancel(operation_id).await
}

#[tauri::command]
pub fn autostart_status(
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::preferences::PreferencesStore>,
) -> crate::autostart::AutostartSnapshot {
    let saved = store.read();
    let mut snapshot = crate::autostart::status(
        saved.preferences.autostart_desired,
        &crate::autostart::NativeRegistrar(&app),
    );
    if saved.error.is_some() {
        snapshot.error = saved.error;
    }
    snapshot
}
#[tauri::command]
pub fn autostart_set(
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::preferences::PreferencesStore>,
    lock: tauri::State<'_, crate::autostart::AutostartLock>,
    enabled: bool,
) -> Result<crate::autostart::AutostartSnapshot, BridgeError> {
    let _guard = lock.0.lock().map_err(|_| BridgeError {
        details: None,
        code: "AUTOSTART_LOCK_FAILED".into(),
        message: "autostart operation mutex poisoned; registration not changed".into(),
    })?;
    let saved = store.read();
    if let Some(error) = saved.error {
        return Err(error);
    }
    let mut desired = saved.preferences;
    let revision = desired.revision;
    desired.autostart_desired = enabled;
    let saved = store.save(revision, desired);
    if let Some(error) = saved.error {
        return Err(error);
    }
    Ok(crate::autostart::apply(
        enabled,
        &crate::autostart::NativeRegistrar(&app),
    ))
}

#[tauri::command]
pub async fn diagnostics_start(
    bridge: tauri::State<'_, Bridge>,
    diagnostics: tauri::State<'_, crate::diagnostics_native::NativeDiagnostics>,
) -> Result<BridgeReply, BridgeError> {
    let reply = bridge.diagnostics_action("diagnostics_start", None).await?;
    diagnostics.capture(&reply)?;
    Ok(reply)
}
#[tauri::command]
pub async fn diagnostics_snapshot(
    bridge: tauri::State<'_, Bridge>,
    diagnostics: tauri::State<'_, crate::diagnostics_native::NativeDiagnostics>,
    id: String,
) -> Result<BridgeReply, BridgeError> {
    let reply = bridge
        .diagnostics_action("diagnostics_snapshot", Some(id))
        .await?;
    diagnostics.capture(&reply)?;
    Ok(reply)
}
#[tauri::command]
pub async fn diagnostics_cancel(
    bridge: tauri::State<'_, Bridge>,
    diagnostics: tauri::State<'_, crate::diagnostics_native::NativeDiagnostics>,
    id: String,
) -> Result<BridgeReply, BridgeError> {
    let reply = bridge
        .diagnostics_action("diagnostics_cancel", Some(id))
        .await?;
    diagnostics.capture(&reply)?;
    Ok(reply)
}
#[tauri::command]
pub fn diagnostic_logs(
    diagnostics: tauri::State<'_, crate::diagnostics_native::NativeDiagnostics>,
    query: crate::diagnostic_log::LogQuery,
) -> Result<crate::diagnostic_log::LogPage, BridgeError> {
    diagnostics.page(query)
}
#[tauri::command]
pub async fn diagnostics_export(
    bridge: tauri::State<'_, Bridge>,
    diagnostics: tauri::State<'_, crate::diagnostics_native::NativeDiagnostics>,
    report_id: String,
    include_logs: bool,
) -> Result<crate::diagnostic_log::DiagnosticExport, BridgeError> {
    let reply = bridge
        .diagnostics_action("diagnostics_snapshot", Some(report_id))
        .await?;
    let metadata = bridge.status().metadata.ok_or_else(|| BridgeError {
        details: None,
        code: "DIAGNOSTICS_METADATA_UNAVAILABLE".into(),
        message: "diagnostic export requires current bundled build metadata".into(),
    })?;
    diagnostics.export(&reply, include_logs, metadata)
}
#[tauri::command]
pub async fn notification_permission(
    app: tauri::AppHandle,
) -> Result<crate::notifications::Permission, BridgeError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<crate::notifications::NotificationService>()
            .permission()
    })
    .await
    .map_err(|error| {
        notification_join_failure(
            "NOTIFICATION_PERMISSION_JOIN",
            "notification permission",
            error,
        )
    })?
}
#[tauri::command]
pub fn notification_delivery_status(
    state: tauri::State<'_, crate::notification_poll::NotificationPollState>,
) -> serde_json::Value {
    serde_json::json!({"error":state.error()})
}
#[tauri::command]
pub async fn notification_retry(app: tauri::AppHandle) -> Result<(), BridgeError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<crate::notifications::NotificationService>()
            .allow_failed_retry()
    })
    .await
    .map_err(|error| {
        notification_join_failure("NOTIFICATION_RETRY_JOIN", "notification retry", error)
    })?
}
#[tauri::command]
pub async fn notification_enable(
    app: tauri::AppHandle,
) -> Result<crate::notifications::Permission, BridgeError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<crate::notifications::NotificationService>()
            .enable()
    })
    .await
    .map_err(|error| {
        notification_join_failure("NOTIFICATION_PERMISSION_JOIN", "notification enable", error)
    })?
}
#[tauri::command]
pub async fn network_test(
    bridge: tauri::State<'_, Bridge>,
    proxy: String,
) -> Result<BridgeReply, BridgeError> {
    bridge.network_test(proxy).await
}

#[tauri::command]
pub async fn network_snapshot(
    bridge: tauri::State<'_, Bridge>,
    store: tauri::State<'_, crate::preferences::PreferencesStore>,
    controller: tauri::State<'_, crate::network::NetworkController>,
) -> Result<crate::network::NetworkSnapshot, BridgeError> {
    let device = bridge.device_status().await?;
    let scope = controller.bind_verified_device(&store, &device.result)?;
    Ok(controller
        .snapshot(
            &store,
            &crate::network_native::BridgeNetworkRuntime(&bridge),
            scope.as_ref(),
        )
        .await)
}
#[tauri::command]
pub async fn network_apply_saved(
    bridge: tauri::State<'_, Bridge>,
    store: tauri::State<'_, crate::preferences::PreferencesStore>,
    controller: tauri::State<'_, crate::network::NetworkController>,
    gate: tauri::State<'_, crate::experience::StartupGate>,
    manager: tauri::State<'_, crate::updater::UpdateManager>,
    confirmed: bool,
) -> Result<crate::network::NetworkSnapshot, BridgeError> {
    crate::experience::apply_saved_network(&bridge, &store, &controller, &gate, &manager, confirmed)
        .await
}
#[tauri::command]
pub async fn network_save_proxy(
    bridge: tauri::State<'_, Bridge>,
    store: tauri::State<'_, crate::preferences::PreferencesStore>,
    proxy: String,
    origin: Option<String>,
    expected_revision: u64,
) -> Result<crate::preferences::PreferencesSnapshot, BridgeError> {
    crate::preferences::validate_proxy(&proxy)?;
    let saved = store.read();
    if let Some(error) = saved.error {
        return Err(error);
    }
    if saved.preferences.revision != expected_revision {
        return Err(BridgeError {
            details: None,
            code: "PREFERENCES_REVISION_CONFLICT".into(),
            message: format!(
                "proxy save rejected: expected_revision={expected_revision} current_revision={}",
                saved.preferences.revision
            ),
        });
    }
    let device = bridge.device_status().await?;
    let scope = crate::network::trusted_scope(&device.result)?;
    let (origin, device_scope) = if let Some(scope) = scope {
        (
            scope.origin().to_owned(),
            Some(scope.device_scope().to_owned()),
        )
    } else {
        let origin = origin.ok_or_else(|| BridgeError {
            details: None,
            code: "PREFERENCES_ORIGIN".into(),
            message: "an unpaired proxy draft requires the chosen canonical Hive origin".into(),
        })?;
        crate::preferences::validate_origin(&origin)?;
        (origin, None)
    };
    let mut next = saved.preferences;
    if let Some(existing) = next
        .proxies
        .iter_mut()
        .find(|p| p.origin == origin && p.device_scope == device_scope)
    {
        existing.connect_proxy = proxy;
    } else {
        next.proxies.push(crate::preferences::ProxyPreference {
            origin,
            device_scope,
            connect_proxy: proxy,
        });
    }
    Ok(store.save(expected_revision, next))
}
fn hive_root(value: &serde_json::Value) -> Result<tauri::Url, BridgeError> {
    let origin = value
        .pointer("/device/hive")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| BridgeError {
            details: None,
            code: "HIVE_ORIGIN_UNAVAILABLE".into(),
            message: "saved Hive origin is absent; configure or pair this device first".into(),
        })?;
    if !crate::protocol::failure_origin(origin) {
        return Err(BridgeError::new("HIVE_ORIGIN_INVALID","saved Hive origin rejected; required=secure root origin without credentials, path, query or fragment".into()));
    }
    tauri::Url::parse(&format!("{origin}/")).map_err(|_| BridgeError {
        details: None,
        code: "HIVE_ORIGIN_INVALID".into(),
        message: "saved canonical Hive root URL parsing failed".into(),
    })
}
#[tauri::command]
pub async fn hive_open(bridge: tauri::State<'_, Bridge>) -> Result<(), BridgeError> {
    let context = bridge.device_context().await?;
    let value = serde_json::json!({"device":{"hive":crate::protocol::device_context(&context.result)?.hive}});
    let url = hive_root(&value)?;
    #[cfg(target_os = "macos")]
    let mut command = tokio::process::Command::new("/usr/bin/open");
    #[cfg(target_os = "linux")]
    let mut command = tokio::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = tokio::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler");
        c.creation_flags(0x08000000);
        c
    };
    command.arg(url.as_str());
    wait_opener(command, std::time::Duration::from_secs(5)).await
}
#[cfg(test)]
mod hive_root_tests {
    use super::*;
    #[test]
    fn hive_root_uses_only_saved_canonical_origin() {
        let v = serde_json::json!({"device":{"hive":"https://hive.example","credential":"SECRET"}});
        assert_eq!(hive_root(&v).unwrap().as_str(), "https://hive.example/");
        for hive in [
            "https://u:p@hive.example",
            "https://hive.example/path?token=SECRET",
            "https://hive.example#secret",
            "http://remote.example",
        ] {
            assert!(hive_root(&serde_json::json!({"device":{"hive":hive}})).is_err());
        }
    }
}

#[tauri::command]
pub async fn device_context(bridge: tauri::State<'_, Bridge>) -> Result<BridgeReply, BridgeError> {
    bridge.device_context().await
}
#[tauri::command]
pub fn startup_status(
    gate: tauri::State<'_, crate::experience::StartupGate>,
) -> crate::experience::StartupStatus {
    gate.snapshot()
}
#[tauri::command]
pub async fn startup_recheck(
    app: tauri::AppHandle,
    bridge: tauri::State<'_, Bridge>,
) -> Result<crate::experience::StartupStatus, BridgeError> {
    Ok(crate::experience::recheck(&app, &bridge).await)
}

#[tauri::command]
pub async fn device_recovery_prepare(
    app: tauri::AppHandle,
    bridge: tauri::State<'_, Bridge>,
) -> Result<BridgeReply, BridgeError> {
    crate::experience::recover_device(&app, &bridge, None, true).await
}
#[tauri::command]
pub async fn device_recovery_status(
    app: tauri::AppHandle,
    bridge: tauri::State<'_, Bridge>,
) -> Result<BridgeReply, BridgeError> {
    crate::experience::recover_device(&app, &bridge, None, false).await
}
#[tauri::command]
pub async fn device_recovery_confirm(
    app: tauri::AppHandle,
    bridge: tauri::State<'_, Bridge>,
    operation_id: String,
    expected_revision: u64,
    decision: String,
) -> Result<BridgeReply, BridgeError> {
    let request = crate::protocol::DeviceRecoveryConfirm {
        operation_id,
        expected_revision,
        decision,
    };
    request.validate()?;
    crate::experience::recover_device(&app, &bridge, Some(request), false).await
}
