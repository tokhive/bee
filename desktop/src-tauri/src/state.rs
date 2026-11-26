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
    /// Set while no Bee answers but another process holds the device
    /// configuration, which keeps the app's own Bee from starting.
    pub occupied: Option<crate::occupied::Occupied>,
}

impl Snapshot {
    /// A snapshot with the tray's words in Chinese.
    pub fn new(service: ServiceState, overview: Option<Value>, platforms: BTreeMap<String, Value>) -> Self {
        Self::in_language(service, overview, platforms, "zh")
    }

    /// A snapshot with the tray's words in language, "zh" or "en".
    pub fn in_language(service: ServiceState, overview: Option<Value>, platforms: BTreeMap<String, Value>, language: &str) -> Self {
        let (tray, summary) = summarise(service, overview.as_ref(), &platforms, language);
        Self { service, overview, platforms, tray, summary, occupied: None }
    }
}

/// The tray's words: the Chinese or the English of one message.
fn say(language: &str, zh: &str, en: &str) -> String {
    if language == "en" { en } else { zh }.to_string()
}

/// Decides the tray icon and the one line its menu shows.
pub fn summarise(service: ServiceState, overview: Option<&Value>, platforms: &BTreeMap<String, Value>, language: &str) -> (TrayState, String) {
    match service {
        ServiceState::Starting => return (TrayState::Off, say(language, "正在启动后台服务…", "Starting the background service…")),
        ServiceState::Stopped => return (TrayState::Off, say(language, "后台服务没有运行", "The background service is not running")),
        _ => {}
    }
    let Some(overview) = overview else {
        return (TrayState::Off, say(language, "后台服务没有运行", "The background service is not running"));
    };
    match overview["binding"].as_str().unwrap_or("") {
        "paired" => {}
        "replaced" => return (TrayState::Attention, say(language, "这台电脑已不再绑定", "This computer is no longer linked")),
        "invalid" => return (TrayState::Attention, say(language, "绑定已失效", "The link is no longer valid")),
        _ => return (TrayState::Off, say(language, "还没有绑定 TokHive 账号", "Not linked to a TokHive account yet")),
    }
    if overview["connection"].as_str() != Some("connected") {
        return (TrayState::Off, say(language, "正在连接 TokHive…", "Connecting to TokHive…"));
    }
    let states: Vec<&str> = platforms.values().map(|p| p["sharing"]["state"].as_str().unwrap_or("syncing")).collect();
    let accounts = overview["accounts"].as_array().map(|a| a.len()).unwrap_or(states.len());
    if accounts == 0 {
        return (TrayState::Good, say(language, "还没有添加 AI 账号", "No AI accounts yet"));
    }
    let count = |want: &[&str]| states.iter().filter(|s| want.contains(s)).count();
    let attention = count(&["action", "restricted"]);
    if attention > 0 {
        return (TrayState::Attention, if language == "en" { if attention == 1 { "1 account needs your attention".into() } else { format!("{attention} accounts need your attention") } } else { format!("{attention} 个账号需要你处理") });
    }
    if !states.is_empty() && count(&["paused"]) == states.len() {
        return (TrayState::Paused, say(language, "所有共享已暂停", "All sharing is paused"));
    }
    let sharing = count(&["sharing"]);
    if sharing == states.len() {
        return (TrayState::Good, if language == "en" { format!("{sharing} sharing") } else { format!("{sharing} 个账号共享中") });
    }
    let mut parts = Vec::new();
    for (zh, en, want) in [
        ("共享中", "sharing", &["sharing"][..]),
        ("正在同步", "syncing", &["syncing"][..]),
        ("暂时不能接单", "temporarily unavailable", &["waiting", "offline"][..]),
        ("已暂停", "paused", &["paused"][..]),
    ] {
        let n = count(want);
        if n > 0 {
            parts.push(if language == "en" { format!("{n} {en}") } else { format!("{n} 个{zh}") });
        }
    }
    (TrayState::Good, parts.join(if language == "en" { ", " } else { "，" }))
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
        assert_eq!(summarise(ServiceState::Stopped, None, &platforms(&[]), "zh").0, TrayState::Off);
        assert_eq!(summarise(ServiceState::Running, Some(&json!({"binding": "unpaired"})), &platforms(&[]), "zh").0, TrayState::Off);
        assert_eq!(summarise(ServiceState::External, Some(&json!({"binding": "replaced"})), &platforms(&[]), "zh").0, TrayState::Attention);
        assert_eq!(summarise(ServiceState::Running, Some(&json!({"binding": "paired", "connection": "connecting"})), &platforms(&[]), "zh").0, TrayState::Off);
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
            let got = summarise(ServiceState::Running, Some(&paired(states.len())), &platforms(states), "zh");
            assert_eq!(got, (tray, summary.to_string()), "{states:?}");
        }
        assert_eq!(summarise(ServiceState::Running, Some(&paired(0)), &platforms(&[]), "zh"), (TrayState::Good, "还没有添加 AI 账号".to_string()));
    }
}

#[cfg(test)]
mod english {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_tray_speaks_the_chosen_language() {
        let platforms = |states: &[&str]| -> BTreeMap<String, Value> {
            states.iter().enumerate().map(|(i, s)| (format!("p{i}"), json!({"sharing": {"state": s}}))).collect()
        };
        let paired = |n: usize| json!({"binding": "paired", "connection": "connected", "accounts": vec![json!({}); n]});
        let cases: [(&[&str], &str); 5] = [
            (&["sharing", "sharing"], "2 sharing"),
            (&["sharing", "action"], "1 account needs your attention"),
            (&["action", "restricted"], "2 accounts need your attention"),
            (&["paused", "paused"], "All sharing is paused"),
            (&["sharing", "waiting"], "1 sharing, 1 temporarily unavailable"),
        ];
        for (states, want) in cases {
            let got = summarise(ServiceState::Running, Some(&paired(states.len())), &platforms(states), "en");
            assert_eq!(got.1, want, "{states:?}");
        }
        assert_eq!(summarise(ServiceState::Stopped, None, &platforms(&[]), "en").1, "The background service is not running");
        assert_eq!(summarise(ServiceState::Running, Some(&json!({"binding": "unpaired"})), &platforms(&[]), "en").1, "Not linked to a TokHive account yet");
        assert_eq!(summarise(ServiceState::Running, Some(&paired(0)), &platforms(&[]), "en").1, "No AI accounts yet");
        // Anything but English reads in Chinese.
        assert_eq!(summarise(ServiceState::Stopped, None, &platforms(&[]), "zh").1, "后台服务没有运行");
    }
}
