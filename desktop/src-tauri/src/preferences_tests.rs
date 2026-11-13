use super::*;
use std::fs;

fn store() -> (std::path::PathBuf, PreferencesStore) {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "bee-preferences-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    fs::create_dir(&path).unwrap();
    let store = PreferencesStore::new(path.join("desktop-preferences.json"));
    (path, store)
}

#[test]
fn preferences_first_launch_defaults_and_revisioned_restart() {
    let (dir, store) = store();
    let initial = store.read();
    assert!(initial.error.is_none());
    assert_eq!(initial.preferences.language, Language::System);
    assert_eq!(initial.preferences.theme, Theme::System);
    assert!(!initial.preferences.autostart_desired);
    assert!(!initial.preferences.notifications_enabled);
    let mut next = initial.preferences;
    next.language = Language::En;
    let saved = store.save(0, next.clone());
    assert!(saved.error.is_none(), "{:?}", saved.error);
    assert_eq!(saved.preferences.revision, 1);
    let restarted = PreferencesStore::new(dir.join("desktop-preferences.json"));
    assert_eq!(restarted.read().preferences, saved.preferences);
    let conflict = store.save(0, next);
    assert_eq!(
        conflict.error.unwrap().code,
        "PREFERENCES_REVISION_CONFLICT"
    );
    assert_eq!(store.read().preferences, saved.preferences);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn preferences_reject_corruption_unknown_versions_duplicate_keys_and_secrets_preserving_file() {
    let (dir, store) = store();
    for raw in ["{", r#"{"version":9}"#, r#"{"version":1,"version":1}"#] {
        private_write(&store.path, raw.as_bytes()).unwrap();
        assert!(store.read().error.is_some());
        assert!(store.save(0, DesktopPreferences::default()).error.is_some());
        assert_eq!(fs::read(&store.path).unwrap(), raw.as_bytes());
    }
    for field in [
        "token",
        "confirmation_id",
        "device_credential",
        "owner",
        "Authorization",
    ] {
        let mut value = serde_json::to_value(DesktopPreferences::default()).unwrap();
        value[field] = "SECRET_MARKER".into();
        let raw = serde_json::to_vec(&value).unwrap();
        private_write(&store.path, &raw).unwrap();
        let failed = store.read();
        assert!(failed.error.is_some());
        assert!(!serde_json::to_string(&failed)
            .unwrap()
            .contains("SECRET_MARKER"));
        assert_eq!(fs::read(&store.path).unwrap(), raw);
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn preferences_proxy_scope_isolation_and_verified_draft_binding() {
    let (dir, store) = store();
    let mut prefs = DesktopPreferences::default();
    prefs.proxies = vec![ProxyPreference {
        origin: "https://hive.example".into(),
        device_scope: None,
        connect_proxy: "http://127.0.0.1:7890".into(),
    }];
    let saved = store.save(0, prefs);
    assert!(saved.error.is_none());
    assert_eq!(
        saved
            .preferences
            .proxy_for("https://other.example", Some("device-a")),
        ""
    );
    assert_eq!(
        saved
            .preferences
            .proxy_for("https://hive.example", Some("device-a")),
        ""
    );
    let bound = store.bind_draft(1, "https://hive.example", "device-a");
    assert!(bound.error.is_none());
    assert_eq!(
        bound
            .preferences
            .proxy_for("https://hive.example", Some("device-a")),
        "http://127.0.0.1:7890"
    );
    assert_eq!(
        bound
            .preferences
            .proxy_for("https://hive.example", Some("device-b")),
        ""
    );
    assert_eq!(
        bound.preferences.proxy_for("https://hive.example", None),
        ""
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn preferences_invalid_proxy_never_changes_saved_revision() {
    let (dir, store) = store();
    let saved = store.save(0, DesktopPreferences::default());
    for proxy in [
        "socks5://127.0.0.1:7890",
        "http://localhost:7890",
        "http://example.com:7890",
        "http://u:p@127.0.0.1:7890",
        "http://127.0.0.1:0",
        "http://127.0.0.1:65536",
        "http://127.0.0.1:7890/path",
        "http://127.0.0.1:7890?q=1",
    ] {
        let mut prefs = saved.preferences.clone();
        prefs.proxies.push(ProxyPreference {
            origin: "https://hive.example".into(),
            device_scope: None,
            connect_proxy: proxy.into(),
        });
        assert!(store.save(1, prefs).error.is_some(), "accepted {proxy}");
        assert_eq!(store.read().preferences, saved.preferences);
    }
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn preferences_reject_links_and_insecure_permissions() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let (dir, store) = store();
    assert!(store.save(0, DesktopPreferences::default()).error.is_none());
    assert_eq!(
        fs::metadata(&store.path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    fs::set_permissions(&store.path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(store.read().error.is_some());
    fs::rename(&store.path, dir.join("original")).unwrap();
    symlink(dir.join("original"), &store.path).unwrap();
    assert!(store.read().error.is_some());
    assert!(store.save(0, DesktopPreferences::default()).error.is_some());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn preferences_failed_replace_keeps_original_and_protected_backup() {
    let (dir, store) = store();
    let first = store.save(0, DesktopPreferences::default());
    let original = fs::read(&store.path).unwrap();
    fs::create_dir(store.path.with_extension("json.v1.bak")).unwrap();
    let mut next = first.preferences.clone();
    next.language = Language::Zh;
    let failed = store.save(1, next);
    assert!(failed.error.is_some());
    assert_eq!(failed.preferences, first.preferences);
    assert_eq!(fs::read(&store.path).unwrap(), original);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn preferences_reject_userinfo_and_missing_nullable_scope_without_losing_last_saved_value() {
    let (dir, store) = store();
    let saved = store.save(0, DesktopPreferences::default());
    for origin in [
        "http://remote.example",
        "https://user@hive.example",
        "https://u:p@hive.example",
        "https://hive.example/?x=secret",
    ] {
        assert!(validate_origin(origin).is_err());
    }
    let mut raw = serde_json::to_value(&saved.preferences).unwrap();
    raw["proxies"] = serde_json::json!([{"origin":"https://hive.example","connect_proxy":""}]);
    private_write(&store.path, &serde_json::to_vec(&raw).unwrap()).unwrap();
    let failed = store.read();
    assert!(
        failed.error.is_some(),
        "missing device_scope must be rejected"
    );
    assert_eq!(failed.preferences, saved.preferences);
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn preferences_fifo_is_rejected_without_blocking_the_store() {
    use std::os::unix::{ffi::OsStrExt, fs::OpenOptionsExt};
    let (dir, store) = store();
    let path = store.path.clone();
    let cpath = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(cpath.as_ptr(), 0o600) }, 0);
    let (tx, rx) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        tx.send(store.read()).unwrap();
    });
    let result = rx.recv_timeout(std::time::Duration::from_millis(200));
    // Unblock an old implementation before reporting its failure.
    let writer = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(&path)
        .unwrap();
    thread.join().unwrap();
    drop(writer);
    assert!(result
        .expect("preferences FIFO open blocked before regular-file validation")
        .error
        .is_some());
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn preferences_unreadable_directory_fails_before_replacing_original() {
    use std::os::unix::fs::PermissionsExt;
    let (dir, store) = store();
    let first = store.save(0, DesktopPreferences::default());
    let saved = store.save(1, first.preferences);
    let original = fs::read(&store.path).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o300)).unwrap();
    let mut next = saved.preferences.clone();
    next.language = Language::En;
    let result = store.save(2, next);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.error.is_some());
    assert_eq!(
        fs::read(&store.path).unwrap(),
        original,
        "failure must preserve prior bytes"
    );
    fs::remove_dir_all(dir).unwrap();
}
