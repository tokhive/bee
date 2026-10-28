//! Current-user registration. Desired preference and observed OS state are distinct.
use crate::protocol::BridgeError;
use serde::Serialize;
#[derive(Clone, Debug, Serialize)]
pub struct AutostartSnapshot {
    pub desired: bool,
    pub registered: Option<bool>,
    pub error: Option<BridgeError>,
}
pub trait Registrar {
    fn set(&self, enabled: bool) -> Result<(), BridgeError>;
    fn registered(&self) -> Result<bool, BridgeError>;
}
fn problem(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError {
        code: code.into(),
        message: message.into(),
    }
}
pub fn status(desired: bool, registrar: &impl Registrar) -> AutostartSnapshot {
    match registrar.registered() {
        Ok(registered) => AutostartSnapshot {
            desired,
            registered: Some(registered),
            error: None,
        },
        Err(error) => AutostartSnapshot {
            desired,
            registered: None,
            error: Some(error),
        },
    }
}
pub fn apply(desired: bool, registrar: &impl Registrar) -> AutostartSnapshot {
    let write_error = registrar.set(desired).err();
    let mut snapshot = status(desired, registrar);
    if let Some(error) = write_error {
        snapshot.error = Some(error);
    } else if snapshot.error.is_none() && snapshot.registered != Some(desired) {
        snapshot.error = Some(problem(
            "AUTOSTART_UNCONFIRMED",
            format!(
                "autostart readback differs: desired={desired} registered={:?}",
                snapshot.registered
            ),
        ));
    }
    snapshot
}
pub struct NativeRegistrar<'a>(pub &'a tauri::AppHandle);
fn os_error(
    stage: &str,
    enabled: Option<bool>,
    error: tauri_plugin_autostart::Error,
) -> BridgeError {
    let evidence = match error {
        tauri_plugin_autostart::Error::Io(e) => {
            format!("kind={:?} os_code={:?}", e.kind(), e.raw_os_error())
        }
        tauri_plugin_autostart::Error::Anyhow(e) => {
            let lower = e.to_lowercase();
            let class = if lower.contains("permission") || lower.contains("denied") {
                "permission_denied"
            } else if lower.contains("not found") || lower.contains("no such") {
                "not_found"
            } else {
                "platform_error"
            };
            format!("class={class}")
        }
    };
    problem(
        if stage == "query" {
            "AUTOSTART_QUERY_FAILED"
        } else {
            "AUTOSTART_REGISTER_FAILED"
        },
        format!("autostart {stage} failed: desired={enabled:?}; {evidence}"),
    )
}
impl Registrar for NativeRegistrar<'_> {
    fn set(&self, enabled: bool) -> Result<(), BridgeError> {
        use tauri_plugin_autostart::ManagerExt;
        let manager = self.0.autolaunch();
        (if enabled {
            manager.enable()
        } else {
            manager.disable()
        })
        .map_err(|e| os_error("register", Some(enabled), e))
    }
    fn registered(&self) -> Result<bool, BridgeError> {
        use tauri_plugin_autostart::ManagerExt;
        self.0
            .autolaunch()
            .is_enabled()
            .map_err(|e| os_error("query", None, e))
    }
}
#[derive(Default)]
pub struct AutostartLock(pub std::sync::Mutex<()>);
#[cfg(test)]
#[path = "autostart_tests.rs"]
mod tests;
