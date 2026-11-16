pub fn allowed(scheme: &str, host: Option<&str>, port: Option<u16>, development: bool) -> bool {
    matches!(
        (scheme, host, port),
        ("tauri", Some("localhost"), None) | ("http", Some("tauri.localhost"), None)
    ) || (development && scheme == "http" && host == Some("127.0.0.1") && port == Some(1420))
}

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn permits_only_the_bundled_app_in_release() {
        assert!(allowed("tauri", Some("localhost"), None, false));
        assert!(allowed("http", Some("tauri.localhost"), None, false));
        assert!(!allowed("https", Some("example.com"), None, false));
        assert!(!allowed("http", Some("127.0.0.1"), Some(1420), false));
        assert!(!allowed("file", None, None, false));
    }

    #[test]
    fn development_permits_only_the_declared_vite_origin() {
        assert!(allowed("http", Some("127.0.0.1"), Some(1420), true));
        assert!(!allowed("http", Some("127.0.0.1"), Some(1421), true));
        assert!(!allowed(
            "http",
            Some("127.0.0.1.evil.example"),
            Some(1420),
            true
        ));
        assert!(!allowed("https", Some("example.com"), None, true));
        assert!(!allowed("http", Some("tauri.localhost"), Some(9999), true));
    }
}
