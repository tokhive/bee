use crate::updater::*;
use serde_json::json;
use sha2::Digest;

fn store() -> (tempfile::TempDir, UpdateStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = UpdateStore::new(dir.path().join("desktop-update-state.json"));
    (dir, store)
}

fn policy() -> ReleasePolicy {
    ReleasePolicy::new(
        "0.1.0",
        "stable",
        "https://github.com/example/bee/releases/latest/download/stable.json",
        "test-public-key",
        "aarch64-apple-darwin",
    )
    .unwrap()
}

fn manifest() -> serde_json::Value {
    json!({"version":"0.2.0","notes":"<script>untrusted</script>","platforms":{"darwin-aarch64":{
        "url":"https://github.com/example/bee/releases/download/v0.2.0/Bee.app.tar.gz", "signature":"test-signature",
        "bee":{"channel":"stable","target":"aarch64-apple-darwin","version":"0.2.0","sha256":"a".repeat(64),"size":100}
    }}})
}

#[test]
fn updater_rejects_uncontrolled_endpoints_and_asset_redirects() {
    for endpoint in [
        "http://github.com/example/bee/stable.json",
        "https://evil.test/stable.json",
        "https://user@github.com/example/bee/releases/latest/download/stable.json",
        "https://github.com/example/bee/releases/latest/download/stable.json?token=secret",
    ] {
        assert!(
            ReleasePolicy::new("0.1.0", "stable", endpoint, "key", "aarch64-apple-darwin").is_err(),
            "accepted {endpoint}"
        );
    }
    let p = policy();
    assert!(p.allows_redirect(
        &tauri::Url::parse("https://release-assets.githubusercontent.com/asset?id=public").unwrap()
    ));
    for url in [
        "https://evil.test/asset",
        "http://release-assets.githubusercontent.com/asset",
        "https://github.com/other/bee/releases/download/v0.2.0/Bee.app.tar.gz",
    ] {
        assert!(!p.allows_redirect(&tauri::Url::parse(url).unwrap()));
    }
}

#[test]
fn updater_manifest_requires_exact_channel_target_version_size_and_package() {
    let p = policy();
    assert_eq!(p.validate_manifest(&manifest()).unwrap().size, 100);
    for (field, value) in [
        ("channel", json!("beta")),
        ("target", json!("x86_64-apple-darwin")),
        ("version", json!("0.3.0")),
        ("sha256", json!("not-a-digest")),
        ("size", json!(0)),
        ("size", json!(MAX_UPDATE_BYTES + 1)),
    ] {
        let mut bad = manifest();
        bad["platforms"]["darwin-aarch64"]["bee"][field] = value;
        assert!(p.validate_manifest(&bad).is_err(), "accepted {field}");
    }
    for url in [
        "https://github.com/example/bee/releases/download/v0.1.0/Bee.app.tar.gz",
        "https://github.com/example/bee/releases/download/v0.2.0/Bee.exe",
        "https://evil.test/Bee.app.tar.gz",
    ] {
        let mut bad = manifest();
        bad["platforms"]["darwin-aarch64"]["url"] = json!(url);
        assert!(p.validate_manifest(&bad).is_err(), "accepted {url}");
    }
}

#[test]
fn updater_rejects_duplicate_operations_and_late_progress() {
    let (_directory, store) = store();
    let manager = UpdateManager::new("0.1.0", store).unwrap();
    let first = manager.begin_check(false, 100).unwrap().unwrap();
    assert!(manager.begin_check(true, 101).is_err());
    manager
        .complete_check(
            &first.operation_id.clone().unwrap(),
            Some(policy().validate_manifest(&manifest()).unwrap()),
            "0.2.0".into(),
            Some("<script>plain text</script>".into()),
        )
        .unwrap();
    let download = manager.begin_download().unwrap();
    assert!(manager.begin_download().is_err());
    let id = download.operation_id.unwrap();
    manager.progress(&id, 10, None).unwrap();
    assert_eq!(manager.snapshot().unwrap().total_bytes, None);
    assert!(manager.progress("stale-operation", 1, None).is_err());
    assert!(manager.progress(&id, MAX_UPDATE_BYTES + 1, None).is_err());
    assert_eq!(manager.snapshot().unwrap().downloaded_bytes, 10);
}

#[test]
fn updater_auto_check_limit_survives_restart_manual_check_can_retry() {
    let (_directory, store) = store();
    let path = store.path().to_path_buf();
    let manager = UpdateManager::new("0.1.0", store).unwrap();
    manager.begin_check(false, 100000).unwrap().unwrap();
    drop(manager);
    let manager = UpdateManager::new("0.1.0", UpdateStore::new(path)).unwrap();
    assert!(manager.begin_check(false, 100001).unwrap().is_none());
    assert!(manager.begin_check(true, 100001).unwrap().is_some());
}

#[test]
fn updater_corrupt_or_future_state_never_overwrites_original() {
    let (_directory, store) = store();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(store.path())
            .unwrap();
    }
    std::fs::write(store.path(), b"{\"version\":99}").unwrap();
    assert!(UpdateManager::new("0.1.0", store.clone()).is_err());
    assert_eq!(std::fs::read(store.path()).unwrap(), b"{\"version\":99}");
}

#[test]
fn updater_persistent_pending_identity_is_validated_before_recovery() {
    for field in ["to_version", "channel", "stage", "target_digest"] {
        let (_dir, store) = store();
        let mut raw = json!({"version":1,"last_auto_check":null,"pending_update":{"from_version":"0.1.0","to_version":"0.2.0","channel":"stable","stage":"installing","target_digest":"a".repeat(64)}});
        raw["pending_update"][field] = json!("invalid value");
        let file = std::fs::File::create(store.path()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .unwrap();
        }
        let original = serde_json::to_vec(&raw).unwrap();
        std::fs::write(store.path(), &original).unwrap();
        assert!(
            UpdateManager::new("0.2.0", store.clone()).is_err(),
            "accepted invalid {field}"
        );
        assert_eq!(std::fs::read(store.path()).unwrap(), original);
    }
}

#[test]
fn updater_state_requires_explicit_nullable_recovery_and_throttle_fields() {
    for raw in [
        r#"{"version":1}"#,
        r#"{"version":1,"last_auto_check":null}"#,
        r#"{"version":1,"pending_update":null}"#,
    ] {
        let (_dir, store) = store();
        let file = std::fs::File::create(store.path()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .unwrap();
        }
        std::fs::write(store.path(), raw).unwrap();
        assert!(
            UpdateManager::new("0.1.0", store.clone()).is_err(),
            "accepted incomplete persisted state"
        );
        assert_eq!(std::fs::read_to_string(store.path()).unwrap(), raw);
    }
}

#[tokio::test]
async fn updater_real_download_stalled_response_has_a_bounded_read_timeout() {
    use std::io::Read;
    init_tls().unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        socket.read(&mut request).unwrap();
        std::thread::sleep(std::time::Duration::from_secs(33));
    });
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert("updater".into(),json!({"pubkey":"test-public-key","requireSignedVersion":true,"dangerousInsecureTransportProtocol":true}));
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let updater = policy()
        .builder(app.handle())
        .unwrap()
        .no_proxy()
        .executable_path(std::env::temp_dir().join("isolated-bee-timeout"))
        .endpoints(vec![format!("http://{address}/manifest.json")
            .parse()
            .unwrap()])
        .unwrap()
        .build()
        .unwrap();
    let mut raw = manifest();
    raw["platforms"]["darwin-aarch64"]["url"] = json!(format!("http://{address}/stalled"));
    let update = updater.restore_update(raw).unwrap().unwrap();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(32),
        update.download(|_, _| {}, || {}),
    )
    .await;
    assert!(
        result.is_ok(),
        "native download remained pending beyond 32s; required=read deadline <=30s"
    );
    assert!(
        matches!(result.unwrap(),Err(tauri_plugin_updater::Error::Reqwest(cause)) if cause.is_timeout())
    );
    server.join().unwrap();
}

#[tokio::test]
async fn updater_manifest_http_errors_preserve_status_and_bounded_response_evidence() {
    use std::io::{Read, Write};
    for (status, body, expected) in [
        ("503 Service Unavailable", "maintenance E503", "503"),
        ("403 Forbidden", "access denied E403", "403"),
        ("200 OK", "{broken", "line=1"),
    ] {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).unwrap();
            write!(
                socket,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        let mut p = policy();
        p.endpoint = format!("http://{address}/manifest.json").parse().unwrap();
        let cause = p
            .fetch_manifest(reqwest::Client::builder().no_proxy())
            .await
            .unwrap_err();
        assert!(
            cause.message.contains(expected),
            "missing actual status/schema location: {}",
            cause.message
        );
        if status != "200 OK" {
            assert!(
                cause.message.contains(body),
                "missing response body: {}",
                cause.message
            );
        }
        server.join().unwrap();
    }
}

#[test]
fn updater_insufficient_staging_space_fails_with_actual_available_and_required_bytes() {
    let cause = check_staging_space(99, 100).unwrap_err();
    assert!(cause.message.contains("available=99") && cause.message.contains("required=100"));
    check_staging_space(100, 100).unwrap();
}

#[tokio::test]
async fn updater_manifest_http_error_escape_expansion_stays_within_public_message_limit() {
    use std::io::{Read, Write};
    for body in [
        vec![0x1f; 8192],
        vec![0x01; 9000],
        "更新\u{1f}".repeat(2048).into_bytes(),
    ] {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).unwrap();
            write!(socket, "HTTP/1.1 503 Service Unavailable\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            socket.write_all(&body).unwrap();
        });
        let mut p = policy();
        p.endpoint = format!("http://{address}/manifest.json").parse().unwrap();
        let cause = p
            .fetch_manifest(reqwest::Client::builder().no_proxy())
            .await
            .unwrap_err();
        server.join().unwrap();
        assert_eq!(cause.code, "UPDATE_CHECK_HTTP_FAILED");
        assert!(
            cause.message.len() <= 32768,
            "formatted public message bytes={}; required=at most 32768 UTF-8 bytes",
            cause.message.len()
        );
        assert!(cause.message.contains("HTTP 503 Service Unavailable"));
        assert!(cause.message.contains("truncated=true"));
        assert!(cause
            .message
            .contains("required=successful static release response"));
        assert!(!cause
            .message
            .chars()
            .any(|character| character.is_control()));
    }
}

#[test]
fn updater_native_install_space_probe_reports_real_volume_before_any_installation() {
    let app = tauri::test::mock_app();
    let cause = check_native_space(app.handle(), u64::MAX).unwrap_err();
    assert_eq!(cause.code, "UPDATE_SPACE_INSUFFICIENT");
    assert!(
        cause.message.contains("available=")
            && cause.message.contains("required=18446744073709551615")
            && cause.message.contains("volume=")
    );
    check_native_space(app.handle(), 0).unwrap();
}

#[test]
fn updater_installation_directory_uses_native_binary_when_appimage_is_absent() {
    let native_env = tauri::Env::default();
    #[cfg(target_os = "linux")]
    let native_env = {
        let mut native_env = native_env;
        native_env.appimage = None;
        native_env.appdir = None;
        native_env
    };
    let app = tauri::test::mock_builder()
        .manage(native_env)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    assert_eq!(
        native_installation_directory(app.handle()).unwrap(),
        std::env::current_exe().unwrap().parent().unwrap()
    );
}

#[cfg(target_os = "linux")]
#[test]
fn updater_installation_directory_uses_managed_appimage_outside_readonly_mount() {
    use tauri::Manager;
    let directory = tempfile::tempdir().unwrap();
    let external = directory.path().join("applications/Bee.AppImage");
    let mounted = directory.path().join(".mount_Bee123/usr/bin/bee-desktop");
    let mut native_env = tauri::Env::default();
    native_env.appimage = Some(external.clone().into_os_string());
    native_env.appdir = Some(directory.path().join(".mount_Bee123").into_os_string());
    let app = tauri::test::mock_builder()
        .manage(native_env)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    assert_eq!(app.env().appimage, Some(external.clone().into_os_string()));
    assert_eq!(
        native_installation_directory(app.handle()).unwrap(),
        external.parent().unwrap()
    );
    assert_ne!(
        native_installation_directory(app.handle()).unwrap(),
        mounted.parent().unwrap()
    );
    check_native_space(app.handle(), 0).unwrap();
}

#[tokio::test]
async fn updater_real_ephemeral_signature_download_accepts_original_rejects_tampering_and_wrong_version(
) {
    init_tls().unwrap();
    use std::{
        io::{Read, Write},
        process::Command,
    };
    let directory = tempfile::tempdir().unwrap();
    let key = directory.path().join("test.key");
    let payload = directory.path().join("Bee.app.tar.gz");
    let cli = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../node_modules/.bin/tauri");
    let generated = Command::new(&cli)
        .args(["signer", "generate", "--ci", "-p", "", "-w"])
        .arg(&key)
        .output()
        .unwrap();
    assert!(
        generated.status.success(),
        "temporary key generation failed: status={}; stderr={}",
        generated.status,
        String::from_utf8_lossy(&generated.stderr)
    );
    std::fs::write(&payload, b"isolated test update asset").unwrap();
    let signed = Command::new(&cli)
        .args(["signer", "sign", "-f"])
        .arg(&key)
        .args(["-p", "", "--app-version", "2.0.0"])
        .arg(&payload)
        .output()
        .unwrap();
    assert!(
        signed.status.success(),
        "temporary asset signing failed: status={}; stderr={}",
        signed.status,
        String::from_utf8_lossy(&signed.stderr)
    );
    let public = std::fs::read_to_string(key.with_extension("key.pub")).unwrap();
    let signature = std::fs::read_to_string(payload.with_extension("gz.sig")).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        for _ in 0..2 {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        socket.read(&mut request).unwrap();
        let bytes = b"isolated test update asset";
        socket
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    bytes.len()
                )
                .as_bytes(),
            )
            .unwrap();
        socket.write_all(bytes).unwrap();
        }
    });
    use tauri_plugin_updater::UpdaterExt;
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert("updater".into(),json!({"pubkey":public.trim(),"requireSignedVersion":true,"dangerousInsecureTransportProtocol":true,"endpoints":[format!("http://{address}/manifest.json")]}));
    let manager = UpdateManager::new("0.1.0",UpdateStore::new(directory.path().join("state.json"))).unwrap();
    let app = tauri::test::mock_builder()
        .manage(manager.clone())
        .invoke_handler(tauri::generate_handler![update_snapshot,update_download])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let builder = app
        .updater_builder()
        .target("test-target")
        .executable_path(directory.path().join("bee"))
        .no_proxy();
    let updater = builder.build().unwrap();
    let raw = json!({"version":"2.0.0","platforms":{"test-target":{"url":format!("http://{address}/asset"),"signature":signature.trim()}}});
    let update = updater.restore_update(raw.clone()).unwrap().unwrap();
    let mut received = 0;
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk;
                assert_eq!(total, Some(26));
            },
            || {},
        )
        .await
        .unwrap();
    assert_eq!(received, 26);
    assert_eq!(&bytes, b"isolated test update asset");
    update.verify(&bytes).unwrap();
    assert!(update.verify(b"modified test update asset").is_err());
    let mut forged = raw;
    forged["version"] = json!("9.0.0");
    let wrong = updater.restore_update(forged).unwrap().unwrap();
    assert!(wrong.verify(&bytes).is_err());

    // Exercise the real fixed Tauri commands and asynchronous download worker.
    // Only the native window host is a test runtime; signing, HTTP bytes,
    // signature/digest verification and snapshot serialization are real.
    let checking=manager.begin_check(true,now()).unwrap().unwrap();
    let id=checking.operation_id.unwrap();
    let identity=AssetIdentity{channel:"test".into(),target:"aarch64-apple-darwin".into(),version:"2.0.0".into(),sha256:format!("{:x}",sha2::Sha256::digest(&bytes)),size:bytes.len() as u64};
    manager.complete_check(&id,Some(identity),"2.0.0".into(),Some("Signed IPC fixture".into())).unwrap();
    manager.lock().unwrap().native=Some(update);
    let view=tauri::WebviewWindowBuilder::new(&app,"main",Default::default()).build().unwrap();
    let invoke=|cmd:&str| -> serde_json::Value {
        tauri::test::get_ipc_response(&view,tauri::webview::InvokeRequest{
            cmd:cmd.into(),callback:tauri::ipc::CallbackFn(0),error:tauri::ipc::CallbackFn(1),
            url:"tauri://localhost".parse().unwrap(),body:tauri::ipc::InvokeBody::Json(json!({})),
            headers:Default::default(),invoke_key:tauri::test::INVOKE_KEY.into(),
        }).unwrap().deserialize().unwrap()
    };
    assert_eq!(invoke("update_snapshot")["state"],"available");
    assert_eq!(invoke("update_download")["state"],"downloading");
    tokio::time::timeout(std::time::Duration::from_secs(5),async {
        loop {
            let snapshot=invoke("update_snapshot");
            assert_ne!(snapshot["state"],"failed","native download failed: {snapshot}");
            if snapshot["state"]=="verified" {
                assert_eq!(snapshot["downloaded_bytes"],26);
                assert_eq!(snapshot["total_bytes"],26);
                assert_eq!(snapshot["operation_id"],id);
                assert_eq!(snapshot["target_version"],"2.0.0");
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("signed native IPC download did not reach verified within 5s");
    server.join().unwrap();

}
