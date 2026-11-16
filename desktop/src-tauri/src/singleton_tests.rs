#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use tauri::test::{mock_builder, mock_context, noop_assets};

#[cfg(target_os = "macos")]
#[test]
fn singleton_registration_failure_aborts_before_sidecar_setup() {
    let mut context = mock_context(noop_assets());
    let id = format!(
        "dev.tokhive.bee.registration-failure.{}",
        std::process::id()
    );
    context.config_mut().identifier = id.clone();
    let socket = std::path::PathBuf::from(format!(
        "/tmp/{}_{}_si.sock",
        id.replace(['.', '-'], "_"),
        unsafe { libc::geteuid() }
    ));
    std::fs::create_dir(&socket).unwrap();
    let sidecar_setup = Arc::new(AtomicBool::new(false));
    let setup_flag = sidecar_setup.clone();
    let result = mock_builder()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .setup(move |_| {
            setup_flag.store(true, Ordering::SeqCst);
            Ok(())
        })
        .build(context);
    std::fs::remove_dir(&socket).unwrap();
    assert!(
        result.is_err(),
        "failed singleton registration must abort; sidecar setup ran={}",
        sidecar_setup.load(Ordering::SeqCst)
    );
    assert!(
        !sidecar_setup.load(Ordering::SeqCst),
        "sidecar setup must not run after failed registration"
    );
}

#[cfg(unix)]
#[path = "../vendor/tauri-plugin-single-instance/src/platform_impl/startup_lock.rs"]
mod registration_lock;

#[path = "../vendor/tauri-plugin-single-instance/src/platform_impl/windows_registration.rs"]
mod windows_registration;

// Compile the real Linux adapter with the mock runtime on macOS as well. The
// transport still uses zbus; subprocesses keep its session environment isolated.
#[cfg(target_os = "macos")]
#[path = "../vendor/tauri-plugin-single-instance/src/platform_impl/linux.rs"]
#[allow(unexpected_cfgs, dead_code)]
mod linux_adapter;

#[cfg(target_os = "macos")]
type SingleInstanceCallback<R> =
    dyn FnMut(&tauri::AppHandle<R>, Vec<String>, String) + Send + Sync + 'static;

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn invalid_dbus_session_never_reaches_sidecar_setup() {
    const CHILD: &str = "BEE_TEST_INVALID_DBUS_CHILD";
    if std::env::var_os(CHILD).is_some() {
        let sidecar_setup = Arc::new(AtomicBool::new(false));
        let setup_flag = sidecar_setup.clone();
        #[cfg(target_os = "macos")]
        let plugin = linux_adapter::init(Box::new(|_, _, _| {}), None);
        #[cfg(target_os = "linux")]
        let plugin = tauri_plugin_single_instance::init(|_, _, _| {});
        let mut context = mock_context(noop_assets());
        context.config_mut().identifier = "dev.tokhive.bee.InvalidDbusTest".into();
        let result = mock_builder()
            .plugin(plugin)
            .setup(move |_| {
                setup_flag.store(true, Ordering::SeqCst);
                panic!("invalid D-Bus session allowed app.setup; sidecar setup ran=true");
            })
            .build(context);
        let failure = match result {
            Ok(app) => {
                app.run_return(|_, _| {});
                panic!(
                    "invalid D-Bus session allowed app.setup; sidecar setup ran={}",
                    sidecar_setup.load(Ordering::SeqCst)
                );
            }
            Err(error) => error.to_string(),
        };
        assert!(!sidecar_setup.load(Ordering::SeqCst));
        let expected_stage =
            if std::env::var("DBUS_SESSION_BUS_ADDRESS").unwrap() == "invalid-address" {
                "create single-instance D-Bus session builder failed"
            } else {
                "register single-instance D-Bus service failed"
            };
        assert!(
            failure.contains(expected_stage),
            "missing failed D-Bus stage={expected_stage}; actual={failure}"
        );
        return;
    }
    let mut failures = Vec::new();
    for address in [
        "invalid-address",
        "unix:path=/bee-desktop-nonexistent-session-bus/socket",
    ] {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "singleton_tests::invalid_dbus_session_never_reaches_sidecar_setup",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .env("DBUS_SESSION_BUS_ADDRESS", address)
            .output()
            .unwrap();
        if !output.status.success() {
            failures.push(format!(
                "D-Bus boundary child failed for address={address}; stdout={}; stderr={}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[cfg(target_os = "macos")]
mod macos_ipc {
    use super::{mock_builder, mock_context, noop_assets};
    use std::{
        fs::{self, OpenOptions},
        io::Write,
        os::unix::fs::FileTypeExt,
        path::{Path, PathBuf},
        process::{Child, Command, Output, Stdio},
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use tauri::Manager;

    const TEST: &str =
        "singleton_tests::macos_ipc::primary_accepts_forwarding_and_reacquires_after_exit";
    const ROLE: &str = "BEE_TEST_MAC_IPC_ROLE";
    const ROOT: &str = "BEE_TEST_MAC_IPC_ROOT";
    const ID: &str = "BEE_TEST_MAC_IPC_ID";
    const GENERATION: &str = "BEE_TEST_MAC_IPC_GENERATION";
    const LIMIT: Duration = Duration::from_secs(10);

    struct Fixture {
        root: PathBuf,
        id: String,
        endpoint: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let id = format!("test.bee.ipc.p{}.n{nonce}", std::process::id());
            let root = std::env::temp_dir().join(&id);
            fs::create_dir(&root).unwrap();
            let root = fs::canonicalize(root).unwrap();
            fs::create_dir(root.join("secondary-cwd")).unwrap();
            let endpoint = PathBuf::from(format!(
                "/tmp/{}_{}_si.sock",
                id.replace(['.', '-'], "_"),
                unsafe { libc::geteuid() }
            ));
            Self { root, id, endpoint }
        }

        fn marker(&self, generation: &str, name: &str) -> PathBuf {
            self.root.join(format!("{generation}-{name}"))
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // Child guards were created after Fixture and are dropped first.
            for path in [
                self.endpoint.clone(),
                self.endpoint.with_extension("startup.lock"),
                self.endpoint.with_extension("primary.lock"),
            ] {
                let _ = fs::remove_file(path);
            }
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    struct TestProcess {
        child: Option<Child>,
        label: String,
    }

    impl TestProcess {
        fn spawn(fixture: &Fixture, generation: &str, role: &str) -> Self {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    TEST,
                    "--nocapture",
                    "--test-threads=1",
                    "--skip",
                    "ordinary text|fixture",
                ])
                .env(ROLE, role)
                .env(ROOT, &fixture.root)
                .env(ID, &fixture.id)
                .env(GENERATION, generation)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if role == "secondary" {
                command.current_dir(fixture.root.join("secondary-cwd"));
            }
            Self {
                child: Some(
                    command
                        .spawn()
                        .expect("spawn isolated single-instance fixture"),
                ),
                label: format!("{generation}/{role}"),
            }
        }

        fn fail(&mut self, stage: &str) -> ! {
            let mut child = self.child.take().unwrap();
            // Only this guard's owned child is involved; kill is also safe if
            // try_wait already recorded its exit. Always attempt cleanup first.
            let _ = child.kill();
            let output = child.wait_with_output().unwrap();
            panic!(
                "fixture {} failed at {stage}; status={}; stdout={}; stderr={}",
                self.label,
                output.status,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn ready(&mut self, marker: &Path) {
            let deadline = Instant::now() + LIMIT;
            while !marker.is_file() {
                if self.child.as_mut().unwrap().try_wait().unwrap().is_some() {
                    self.fail("primary exited before ready");
                }
                if Instant::now() >= deadline {
                    self.fail("ready marker missing after 10000ms");
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }

        fn wait_success(&mut self) -> Output {
            let deadline = Instant::now() + LIMIT;
            while self.child.as_mut().unwrap().try_wait().unwrap().is_none() {
                if Instant::now() >= deadline {
                    self.fail("process did not exit within 10000ms");
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let output = self.child.take().unwrap().wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "fixture {} exited unsuccessfully: status={}; stdout={}; stderr={}",
                self.label,
                output.status,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            output
        }
    }

    impl Drop for TestProcess {
        fn drop(&mut self) {
            if let Some(child) = self.child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn fixture_process(role: &str) {
        let root = PathBuf::from(std::env::var_os(ROOT).unwrap());
        let generation = std::env::var(GENERATION).unwrap();
        let id = std::env::var(ID).unwrap();
        assert!(
            id.starts_with("test.bee.ipc."),
            "fixture must use its isolated identifier"
        );
        let marker = |name: &str| root.join(format!("{generation}-{name}"));
        let receipt = marker("receipts.jsonl");
        let setup_marker = marker(&format!("{role}-setup"));
        let is_primary = role == "primary";
        let mut context = mock_context(noop_assets());
        context.config_mut().identifier = id;
        context.config_mut().app.windows.clear();
        let app = mock_builder()
            .plugin(tauri_plugin_single_instance::init(move |_, args, cwd| {
                assert!(is_primary, "secondary cannot accept an incoming handoff");
                let mut file = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&receipt)
                    .unwrap();
                serde_json::to_writer(&mut file, &serde_json::json!({"args":args,"cwd":cwd}))
                    .unwrap();
                file.write_all(b"\n").unwrap();
                file.flush().unwrap();
            }))
            .setup(move |app| {
                assert!(is_primary, "secondary reached application/sidecar setup");
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&setup_marker)
                    .unwrap();
                // This is a MockRuntime window only; no native GUI is created.
                tauri::WebviewWindowBuilder::new(
                    app,
                    "ipc-fixture",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .build()?;
                Ok(())
            })
            .build(context)
            .unwrap_or_else(|cause| panic!("isolated singleton plugin build failed: {cause}"));
        if !is_primary {
            fs::write(marker("secondary-after-build"), b"unexpected").unwrap();
            panic!("secondary plugin returned from build instead of exiting after ACK");
        }
        let ready = marker("ready");
        let stop = marker("stop");
        app.run_return(move |handle, event| match event {
            tauri::RunEvent::Ready => fs::write(&ready, b"ready").unwrap(),
            tauri::RunEvent::MainEventsCleared if stop.is_file() => {
                handle
                    .get_webview_window("ipc-fixture")
                    .unwrap()
                    .destroy()
                    .unwrap();
            }
            tauri::RunEvent::Exit => tauri_plugin_single_instance::destroy(handle),
            _ => {}
        });
    }

    #[test]
    fn primary_accepts_forwarding_and_reacquires_after_exit() {
        if let Ok(role) = std::env::var(ROLE) {
            fixture_process(&role);
            return;
        }
        let fixture = Fixture::new();
        for generation in ["first", "replacement"] {
            let mut primary = TestProcess::spawn(&fixture, generation, "primary");
            primary.ready(&fixture.marker(generation, "ready"));
            assert!(fixture.marker(generation, "primary-setup").is_file());
            assert!(fs::symlink_metadata(&fixture.endpoint)
                .unwrap()
                .file_type()
                .is_socket());
            let mut secondary = TestProcess::spawn(&fixture, generation, "secondary");
            secondary.wait_success();
            assert!(
                !fixture.marker(generation, "secondary-after-build").exists(),
                "second plugin process returned from build"
            );
            assert!(
                !fixture.marker(generation, "secondary-setup").exists(),
                "second process created another sidecar setup"
            );
            assert!(
                primary
                    .child
                    .as_mut()
                    .unwrap()
                    .try_wait()
                    .unwrap()
                    .is_none(),
                "handoff stopped the primary process"
            );
            let receipts =
                fs::read_to_string(fixture.marker(generation, "receipts.jsonl")).unwrap();
            let entries: Vec<serde_json::Value> = receipts
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            assert_eq!(
                entries.len(),
                1,
                "a secondary must cause exactly one primary callback"
            );
            let expected_args = [
                std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                "--exact".into(),
                TEST.into(),
                "--nocapture".into(),
                "--test-threads=1".into(),
                "--skip".into(),
                "ordinary text|fixture".into(),
            ];
            assert_eq!(entries[0]["args"], serde_json::json!(expected_args));
            assert_eq!(
                entries[0]["cwd"],
                fixture
                    .root
                    .join("secondary-cwd")
                    .to_string_lossy()
                    .as_ref()
            );
            fs::write(fixture.marker(generation, "stop"), b"stop").unwrap();
            primary.wait_success();
            assert!(
                !fixture.endpoint.exists(),
                "primary exit left its Unix endpoint behind"
            );
            // Preserve lock files across generations: the next real plugin must
            // reacquire their existing inodes, rather than pass via deletion.
            assert!(fixture.endpoint.with_extension("startup.lock").is_file());
            assert!(fixture.endpoint.with_extension("primary.lock").is_file());
        }
    }
}
