//! What the app knows about Bee, kept current from the control interface and
//! summarised for the tray.

use crate::service::ServiceState;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// The four tray icons.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrayState {
    /// Every account is sharing, or waiting for something that clears by itself.
    Good,
    /// An account or the link to TokHive needs the person.
    Attention,
    /// The person paused every account.
    Paused,
    /// Bee is not running, not linked, or not connected.
    Off,
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub service: ServiceState,
    /// GET /v1/overview, when Bee answered.
    pub overview: Option<Value>,
    /// GET /v1/platforms/{platform} for each account's platform.
    pub platforms: BTreeMap<String, Value>,
    pub tray: TrayState,
    pub summary: String,
}

impl Snapshot {
    pub fn new(service: ServiceState, overview: Option<Value>, platforms: BTreeMap<String, Value>) -> Self {
        let (tray, summary) = summarise(service, overview.as_ref(), &platforms);
        Self { service, overview, platforms, tray, summary }
    }
}

/// Decides the tray icon and the one line its menu shows.
pub fn summarise(service: ServiceState, overview: Option<&Value>, platforms: &BTreeMap<String, Value>) -> (TrayState, String) {
    match service {
        ServiceState::Starting => return (TrayState::Off, "正在启动后台服务…".into()),
        ServiceState::Stopped => return (TrayState::Off, "后台服务没有运行".into()),
        _ => {}
    }
    let Some(overview) = overview else {
        return (TrayState::Off, "后台服务没有运行".into());
    };
    match overview["binding"].as_str().unwrap_or("") {
        "paired" => {}
        "replaced" => return (TrayState::Attention, "这台电脑已不再绑定".into()),
        "invalid" => return (TrayState::Attention, "绑定已失效".into()),
        _ => return (TrayState::Off, "还没有绑定 TokHive 账号".into()),
    }
    if overview["connection"].as_str() != Some("connected") {
        return (TrayState::Off, "正在连接 TokHive…".into());
    }
    let states: Vec<&str> = platforms.values().map(|p| p["sharing"]["state"].as_str().unwrap_or("syncing")).collect();
    let accounts = overview["accounts"].as_array().map(|a| a.len()).unwrap_or(states.len());
    if accounts == 0 {
        return (TrayState::Good, "还没有添加 AI 账号".into());
    }
    let count = |want: &[&str]| states.iter().filter(|s| want.contains(s)).count();
    let attention = count(&["action", "restricted"]);
    if attention > 0 {
        return (TrayState::Attention, format!("{attention} 个账号需要你处理"));
    }
    if !states.is_empty() && count(&["paused"]) == states.len() {
        return (TrayState::Paused, "所有共享已暂停".into());
    }
    let sharing = count(&["sharing"]);
    if sharing == states.len() {
        return (TrayState::Good, format!("{sharing} 个账号共享中"));
    }
    let mut parts = Vec::new();
    for (label, want) in [("共享中", &["sharing"][..]), ("正在同步", &["syncing"][..]), ("暂时不能接单", &["waiting", "offline"][..]), ("已暂停", &["paused"][..])] {
        let n = count(want);
        if n > 0 {
            parts.push(format!("{n} 个{label}"));
        }
    }
    (TrayState::Good, parts.join("，"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn platforms(states: &[&str]) -> BTreeMap<String, Value> {
        states.iter().enumerate().map(|(i, s)| (format!("p{i}"), json!({"sharing": {"state": s}}))).collect()
    }

    fn paired(accounts: usize) -> Value {
        json!({"binding": "paired", "connection": "connected", "accounts": vec![json!({}); accounts]})
    }

    #[test]
    fn service_and_binding_come_first() {
        assert_eq!(summarise(ServiceState::Stopped, None, &platforms(&[])).0, TrayState::Off);
        assert_eq!(summarise(ServiceState::Running, Some(&json!({"binding": "unpaired"})), &platforms(&[])).0, TrayState::Off);
        assert_eq!(summarise(ServiceState::External, Some(&json!({"binding": "replaced"})), &platforms(&[])).0, TrayState::Attention);
        assert_eq!(summarise(ServiceState::Running, Some(&json!({"binding": "paired", "connection": "connecting"})), &platforms(&[])).0, TrayState::Off);
    }

    #[test]
    fn accounts_decide_once_connected() {
        let cases: [(&[&str], TrayState, &str); 5] = [
            (&["sharing", "sharing"], TrayState::Good, "2 个账号共享中"),
            (&["sharing", "action"], TrayState::Attention, "1 个账号需要你处理"),
            (&["paused", "paused"], TrayState::Paused, "所有共享已暂停"),
            (&["sharing", "waiting"], TrayState::Good, "1 个共享中，1 个暂时不能接单"),
            (&["restricted"], TrayState::Attention, "1 个账号需要你处理"),
        ];
        for (states, tray, summary) in cases {
            let got = summarise(ServiceState::Running, Some(&paired(states.len())), &platforms(states));
            assert_eq!(got, (tray, summary.to_string()), "{states:?}");
        }
        assert_eq!(summarise(ServiceState::Running, Some(&paired(0)), &platforms(&[])), (TrayState::Good, "还没有添加 AI 账号".to_string()));
    }
}
