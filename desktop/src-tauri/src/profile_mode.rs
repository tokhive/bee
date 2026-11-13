//! Fixed profile process modes and their advertised method boundary.

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

pub(crate) fn allowed(mode: ProfileMode, method: &str) -> bool {
    if mode == ProfileMode::Current {
        return true;
    }
    matches!(
        method,
        "hello"
            | "ping"
            | "shutdown"
            | "device_context"
            | "device_status"
            | "device_begin"
            | "device_recovery_prepare"
            | "device_recovery_confirm"
            | "device_recovery_status"
            | "runtime_inspect_recovery"
            | "runtime_verify"
            | "desktop_switch"
    ) || mode == ProfileMode::Activate
        && matches!(method, "runtime_configure_network" | "network_status")
}
