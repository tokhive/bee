use super::*;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread;

// This proxy never connects upstream. Every accepted connection is either held
// at CONNECT or answered with a controlled failure before TLS can begin.
struct ControlledProxy {
    address: String,
    entered: std::sync::mpsc::Receiver<String>,
    released: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
    task: Option<thread::JoinHandle<std::io::Result<()>>>,
}

impl ControlledProxy {
    fn start(slow: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let (events, entered) = std::sync::mpsc::channel();
        let released = Arc::new(AtomicBool::new(false));
        let stopped = Arc::new(AtomicBool::new(false));
        let release = released.clone();
        let stop = stopped.clone();
        let task = thread::spawn(move || {
            let mut connections = Vec::new();
            let mut result = Ok(());
            while !stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        if connections.len() == 16 {
                            result = Err(std::io::Error::other(
                                "local CONNECT fixture exceeded 16 connections",
                            ));
                            break;
                        }
                        let release = release.clone();
                        let stop = stop.clone();
                        let events = events.clone();
                        connections.push(thread::spawn(move || -> std::io::Result<()> {
                            stream.set_read_timeout(Some(Duration::from_secs(2)))?;
                            stream.set_write_timeout(Some(Duration::from_secs(2)))?;
                            let mut reader = BufReader::new(stream.try_clone()?);
                            let mut line = String::new();
                            reader.read_line(&mut line)?;
                            let platform = match line.as_str() {
                                "CONNECT chatgpt.com:443 HTTP/1.1\r\n" => "openai",
                                "CONNECT api.anthropic.com:443 HTTP/1.1\r\n" => "claude",
                                _ => return Err(std::io::Error::other(format!("unexpected local proxy request: {line:?}"))),
                            };
                            events.send(platform.to_owned()).map_err(std::io::Error::other)?;
                            while platform == slow && !release.load(Ordering::SeqCst) && !stop.load(Ordering::SeqCst) {
                                thread::sleep(Duration::from_millis(5));
                            }
                            stream.write_all(b"HTTP/1.1 502 Controlled Failure\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        }));
                    }
                    Err(cause) if cause.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(cause) => {
                        result = Err(cause);
                        break;
                    }
                }
            }
            stop.store(true, Ordering::SeqCst);
            for connection in connections {
                let joined = connection
                    .join()
                    .map_err(|_| std::io::Error::other("local CONNECT worker panicked"))
                    .and_then(|result| result);
                if result.is_ok() {
                    result = joined;
                }
            }
            result
        });
        Self {
            address,
            entered,
            released,
            stopped,
            task: Some(task),
        }
    }

    fn finish(&mut self) -> std::io::Result<()> {
        self.released.store(true, Ordering::SeqCst);
        self.stopped.store(true, Ordering::SeqCst);
        self.task
            .take()
            .unwrap()
            .join()
            .map_err(|_| std::io::Error::other("local CONNECT listener panicked"))?
    }
}

impl Drop for ControlledProxy {
    fn drop(&mut self) {
        if self.task.is_some() {
            let _ = self.finish();
        }
    }
}

fn synthetic_sources(root: &std::path::Path) {
    let jwt = concat!(
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.",
        "eyJleHAiOjQxMDI0NDQ4MDAsImh0dHBzOi8vYXBpLm9wZW5haS5jb20vYXV0aCI6eyJjaGF0Z3B0X2FjY291bnRfaWQiOiJzeW50aGV0aWMtYWNjb3VudCIsImNoYXRncHRfdXNlcl9pZCI6InN5bnRoZXRpYy11c2VyIiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJwbHVzIn19.",
        "c3ludGhldGlj"
    );
    for (platform, filename, value) in [
        (
            "openai",
            "auth.json",
            serde_json::json!({"auth_mode":"chatgpt","tokens":{"id_token":jwt,"access_token":jwt,"refresh_token":"synthetic-refresh","account_id":"synthetic-account"}}),
        ),
        (
            "claude",
            ".credentials.json",
            serde_json::json!({"claudeAiOauth":{"accessToken":"synthetic-claude-access","refreshToken":"synthetic-claude-refresh","expiresAt":4102444800000u64,"scopes":["user:inference","user:profile","user:sessions:claude_code"],"subscriptionType":"pro","rateLimitTier":"default_claude_pro","clientId":"synthetic-client"}}),
        ),
    ] {
        let directory = root.join(platform);
        std::fs::create_dir(&directory).unwrap();
        let file = directory.join(filename);
        std::fs::write(&file, serde_json::to_vec(&value).unwrap()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
    }
}

fn detect_params(root: &std::path::Path, platform: &str) -> Value {
    serde_json::json!({"platform":platform,"directory":root.join(platform),"store":"file","mode":"official"})
}

async fn exercise_native_reads() {
    for (slow, fast) in [("openai", "claude"), ("claude", "openai")] {
        let sources = tempfile::tempdir().unwrap();
        synthetic_sources(sources.path());
        let mut proxy = ControlledProxy::start(slow);
        let bridge = Bridge::start(native_spec());
        wait(&bridge, BridgePhase::Ready).await;
        let instance = bridge.status().metadata.unwrap().instance;
        let mut slow_request = None;
        let result = async {
            let configured = bridge
                .request(
                    "runtime_configure_network",
                    serde_json::json!({"revision":1,"connect_proxy":proxy.address}),
                    Duration::from_secs(3),
                )
                .await
                .map_err(|e| format!("configure local proxy: {e:?}"))?;
            if configured.result != serde_json::json!({"configured":true}) {
                return Err(format!(
                    "proxy configuration rejected: {:?}",
                    configured.result
                ));
            }
            let b = bridge.clone();
            let params = detect_params(sources.path(), slow);
            let preparing = Instant::now();
            slow_request = Some(tokio::spawn(async move {
                b.request("account_detect", params, Duration::from_secs(10))
                    .await
            }));
            timeout(Duration::from_secs(3), async {
                loop {
                    if let Ok(platform) = proxy.entered.try_recv() {
                        return Ok(platform);
                    }
                    if slow_request.as_ref().unwrap().is_finished() {
                        let reply = slow_request.take().unwrap().await;
                        return Err(format!("platform={slow} returned before CONNECT; elapsed_ms={}; bridge={:?}; response={reply:?}", preparing.elapsed().as_millis(), bridge.status().state));
                    }
                    sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .map_err(|_| format!("platform={slow} did not reach local CONNECT; elapsed_ms={}; bridge={:?}; request_finished={}", preparing.elapsed().as_millis(), bridge.status().state, slow_request.as_ref().is_some_and(|request| request.is_finished())))?
            .and_then(|p| {
                if p == slow {
                    Ok(())
                } else {
                    Err(format!("unexpected first platform: {p}"))
                }
            })?;
            let prepared_ms = preparing.elapsed().as_millis();
            let waiting_for_fast = Instant::now();
            let second = timeout(
                Duration::from_secs(3),
                bridge.request(
                    "account_detect",
                    detect_params(sources.path(), fast),
                    Duration::from_secs(10),
                ),
            )
            .await;
            let fast_reply_ms = waiting_for_fast.elapsed().as_millis();
            // Release and collect the held read even when the concurrency assertion fails.
            proxy.released.store(true, Ordering::SeqCst);
            let first = slow_request.take().unwrap()
                .await
                .map_err(|e| format!("slow task join: {e}"))?
                .map_err(|e| format!("slow response: {e:?}"))?;
            let second = second
                .map_err(|_| format!("{fast} response waited for held {slow} CONNECT"))?
                .map_err(|e| format!("fast response: {e:?}"))?;
            if first.id == second.id || first.instance != instance || second.instance != instance {
                return Err("native response correlation failed".into());
            }
            for (reply, platform) in [(first, slow), (second, fast)] {
                let account = &reply.result["account"];
                let capability = &account["capabilities"][0];
                if account["platform"] != platform
                    || capability["status"] == "ready"
                    || capability["error"]["code"] != "official_check_failed"
                    || capability["error"]["evidence"]["transport_failed"] != "true"
                {
                    return Err(format!(
                        "{platform} controlled CONNECT failure was misclassified: {}",
                        reply.result
                    ));
                }
            }
            eprintln!("native CONNECT slow={slow} fast={fast} prepared_ms={prepared_ms} fast_reply_ms={fast_reply_ms}; fast reply observed before release; instance and failure evidence verified");
            Ok::<_, String>(())
        }
        .await;
        proxy.released.store(true, Ordering::SeqCst);
        let stopped = bridge.stop().await;
        if let Some(request) = slow_request.take() {
            let _ = request
                .await
                .expect("native held request task must join after bridge stop");
        }
        let proxy_result = proxy.finish();
        result.unwrap();
        stopped.unwrap();
        proxy_result.unwrap();
        assert_eq!(bridge.status().state, BridgePhase::Stopped);
    }
}

#[test]
fn native_bee_platform_reads_cross_local_connect_independently() {
    const CHILD: &str = "BEE_TEST_NATIVE_READ_CONCURRENCY_CHILD";
    if std::env::var_os(CHILD).is_some() {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(exercise_native_reads());
        return;
    }
    // Only this subprocess loses inherited proxy settings and executable lookup.
    // Version probes use the product's existing fallback, without launching an
    // installed official CLI (whose own 3s timeout precedes the CONNECT gate).
    // Parallel tests, the user's environment, HOME and CODEX_HOME are untouched.
    let executable_path = tempfile::tempdir().unwrap();
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command.args(["--exact", "sidecar::tests::native_concurrency::native_bee_platform_reads_cross_local_connect_independently", "--nocapture"])
        .env(CHILD, "1").env("PATH", executable_path.path()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
        "NO_PROXY",
        "no_proxy",
    ] {
        command.env_remove(key);
    }
    let mut child = command.spawn().unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(45);
    while child.try_wait().unwrap().is_none() && std::time::Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    if child.try_wait().unwrap().is_none() {
        child.kill().unwrap();
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "native local CONNECT subprocess failed: status={}\n{}\n{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    eprint!("{}", String::from_utf8_lossy(&output.stderr));
}
