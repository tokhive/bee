//! Decides when to tell the person something needs them. Only problems they
//! must act on raise a notification, never ones that clear by themselves, and
//! the same problem at most once a day.

use crate::service::ServiceState;
use crate::state::Snapshot;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// How long the same problem stays quiet after it was raised.
pub const QUIET: Duration = Duration::from_secs(24 * 60 * 60);

/// How long Bee may stay stopped before the person is told.
pub const STOPPED_GRACE: Duration = Duration::from_secs(60);

/// One problem: a stable key for de-duplication and the code that explains it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Alert {
    pub key: String,
    pub code: String,
    /// The platform it concerns, if any.
    pub platform: Option<String>,
}

/// The problems in a snapshot that need the person. `stopped_for` is how long
/// the service has been stopped, if it is.
pub fn alerts(snapshot: &Snapshot, stopped_for: Option<Duration>) -> Vec<Alert> {
    let mut found = Vec::new();
    if snapshot.service == ServiceState::Stopped && stopped_for.is_some_and(|d| d >= STOPPED_GRACE) {
        found.push(Alert { key: "service:stopped".into(), code: "service_stopped".into(), platform: None });
    }
    let Some(overview) = &snapshot.overview else { return found };
    match overview["binding"].as_str() {
        Some("replaced") => found.push(Alert { key: "binding:replaced".into(), code: "BEE-DEVICE-REPLACED".into(), platform: None }),
        Some("invalid") => found.push(Alert { key: "binding:invalid".into(), code: "BEE-HIVE-CREDENTIAL".into(), platform: None }),
        _ => {}
    }
    for (platform, state) in &snapshot.platforms {
        let sharing = &state["sharing"];
        if matches!(sharing["state"].as_str(), Some("action" | "restricted")) {
            let code = sharing["reason"].as_str().unwrap_or("unknown").to_string();
            found.push(Alert { key: format!("{platform}:{code}"), code, platform: Some(platform.clone()) });
        }
    }
    found
}

/// When each problem was last raised, kept across restarts so a relaunch does
/// not repeat today's notifications.
pub struct History {
    path: PathBuf,
    raised: BTreeMap<String, u64>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl History {
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("notifications.json");
        let raised = std::fs::read(&path).ok().and_then(|raw| serde_json::from_slice(&raw).ok()).unwrap_or_default();
        Self { path, raised }
    }

    /// Records the alert and reports whether it may be raised now.
    pub fn admit(&mut self, alert: &Alert) -> bool {
        self.admit_at(alert, now())
    }

    fn admit_at(&mut self, alert: &Alert, at: u64) -> bool {
        if let Some(last) = self.raised.get(&alert.key) {
            if at.saturating_sub(*last) < QUIET.as_secs() {
                return false;
            }
        }
        self.raised.insert(alert.key.clone(), at);
        self.raised.retain(|_, last| at.saturating_sub(*last) < QUIET.as_secs());
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&self.path, serde_json::to_vec(&self.raised).unwrap_or_default());
        true
    }
}

/// The notification's title and body for an alert, from Bee's explanation of
/// its code in the person's language, with words of our own when Bee has none.
pub fn message(alert: &Alert, explanations: &BTreeMap<String, Value>, language: &str) -> (String, String) {
    let platform = alert.platform.as_deref().map(|p| if p == "openai" { "ChatGPT" } else { "Claude" });
    if let Some(e) = explanations.get(&alert.code) {
        let title = e["title"][language].as_str().unwrap_or_default();
        let body = e["fix"][language].as_str().unwrap_or_default();
        if !title.is_empty() {
            let title = match platform {
                Some(p) => format!("{p} · {title}"),
                None => title.to_string(),
            };
            return (title, body.to_string());
        }
    }
    let zh = language == "zh";
    match alert.code.as_str() {
        "service_stopped" if zh => ("Bee 后台服务没有运行".into(), "暂时无法共享。打开 Bee 查看原因。".into()),
        "service_stopped" => ("Bee's background service is not running".into(), "Sharing has stopped. Open Bee to see why.".into()),
        _ if zh => (format!("{} 需要你处理", platform.unwrap_or("Bee")), "打开 Bee 查看原因和处理办法。".into()),
        _ => (format!("{} needs you", platform.unwrap_or("Bee")), "Open Bee to see what happened and what to do.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snapshot(service: ServiceState, overview: Value, platforms: &[(&str, &str, &str)]) -> Snapshot {
        let platforms = platforms.iter().map(|(p, s, r)| (p.to_string(), json!({"sharing": {"state": s, "reason": r}}))).collect();
        Snapshot::new(service, Some(overview), platforms)
    }

    #[test]
    fn only_what_the_person_must_handle() {
        let paired = json!({"binding": "paired", "connection": "connected", "accounts": [{}, {}]});
        let s = snapshot(ServiceState::Running, paired.clone(), &[("claude", "action", "claude_authorization_rejected"), ("openai", "waiting", "quota_exhausted")]);
        let found = alerts(&s, None);
        assert_eq!(found, vec![Alert { key: "claude:claude_authorization_rejected".into(), code: "claude_authorization_rejected".into(), platform: Some("claude".into()) }]);
        let s = snapshot(ServiceState::Running, json!({"binding": "replaced"}), &[]);
        assert_eq!(alerts(&s, None)[0].key, "binding:replaced");
        let stopped = Snapshot::new(ServiceState::Stopped, None, BTreeMap::new());
        assert!(alerts(&stopped, Some(Duration::from_secs(5))).is_empty(), "a short stop is a restart, not a problem");
        assert_eq!(alerts(&stopped, Some(STOPPED_GRACE))[0].key, "service:stopped");
    }

    #[test]
    fn once_a_day() {
        let dir = std::env::temp_dir().join(format!("bee-alerts-{}", std::process::id()));
        let alert = Alert { key: "claude:x".into(), code: "x".into(), platform: None };
        let mut history = History::load(&dir);
        assert!(history.admit_at(&alert, 1_000));
        assert!(!history.admit_at(&alert, 1_000 + 3_600));
        // A relaunch remembers.
        let mut history = History::load(&dir);
        assert!(!history.admit_at(&alert, 1_000 + 7_200));
        assert!(history.admit_at(&alert, 1_000 + QUIET.as_secs()));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn messages_use_bee_explanations() {
        let mut catalog = BTreeMap::new();
        catalog.insert("claude_authorization_rejected".to_string(), json!({"title": {"zh": "登录已失效", "en": "Sign-in expired"}, "fix": {"zh": "重新登录", "en": "Sign in again"}}));
        let alert = Alert { key: "k".into(), code: "claude_authorization_rejected".into(), platform: Some("claude".into()) };
        assert_eq!(message(&alert, &catalog, "zh"), ("Claude · 登录已失效".to_string(), "重新登录".to_string()));
        let unknown = Alert { key: "k".into(), code: "new_code".into(), platform: Some("openai".into()) };
        assert_eq!(message(&unknown, &catalog, "en").0, "ChatGPT needs you");
    }
}
