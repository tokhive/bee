use crate::{
    protocol::{AccountActionRequest, AccountDetectRequest, BridgeError, SupplyPlatform},
    sidecar::{Bridge, BridgeReply, BridgeStatus},
};

fn check_method(method: &str) -> Result<(), BridgeError> {
    if method == "ping" {
        return Ok(());
    }
    Err(BridgeError {
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
) -> Result<BridgeReply, BridgeError> {
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
    platform: SupplyPlatform,
    paused: bool,
) -> Result<BridgeReply, BridgeError> {
    bridge.supply_set_paused(platform, paused).await
}

fn pairing_url(value: &serde_json::Value) -> Result<tauri::Url, BridgeError> {
    let rejected = || {
        BridgeError { code: "PAIRING_URL_REJECTED".into(), message: "device browser URL failed same-Hive /devices/pair and public-code validation; refresh device pairing".into() }
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
        Some("bound" | "expired" | "unbound") => Ok(None),
        _ => pairing_url(value).map(Some),
    }
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
        code: "BROWSER_OPEN_FAILED".into(),
        message: format!("start system browser launcher: {cause}"),
    })?;
    let status = match tokio::time::timeout(duration, child.wait()).await {
        Ok(result) => result.map_err(|cause| BridgeError {
            code: "BROWSER_OPEN_FAILED".into(),
            message: format!("wait for system browser launcher: {cause}"),
        })?,
        Err(_) => {
            child.kill().await.map_err(|cause| BridgeError {
                code: "BROWSER_OPEN_CLEANUP_FAILED".into(),
                message: format!(
                    "browser launcher exceeded {}ms; terminate and reap failed: {cause}",
                    duration.as_millis()
                ),
            })?;
            return Err(BridgeError { code: "BROWSER_OPEN_TIMEOUT".into(), message: format!("browser launcher exceeded {}ms and was reaped; opening result is unconfirmed; use the displayed pairing URL", duration.as_millis()) });
        }
    };
    if !status.success() {
        return Err(BridgeError { code: "BROWSER_OPEN_FAILED".into(), message: format!("system browser launcher exited with status={status}; use the displayed pairing URL") });
    }
    Ok(())
}

#[tauri::command]
pub async fn device_open(bridge: tauri::State<'_, Bridge>) -> Result<BridgeReply, BridgeError> {
    let reply = bridge.device_status().await?;
    if reply.result.get("error").is_some() {
        return Ok(reply);
    }
    let Some(url) = pairing_browser_action(&reply.result)? else {
        return Ok(reply);
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
        for state in ["bound", "expired", "unbound"] {
            assert!(
                pairing_browser_action(&serde_json::json!({"device":{"state":state}}))
                    .unwrap()
                    .is_none()
            );
        }
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
