use crate::{
    protocol::BridgeError,
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
