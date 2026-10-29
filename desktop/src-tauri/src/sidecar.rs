use crate::build_source::BuildSource;
use crate::protocol::{
    self, AccountActionRequest, AccountDetectRequest, BridgeError, Envelope, FrameDecoder,
    SupplyPlatform,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::VecDeque,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, oneshot, watch, Mutex},
    time::{timeout, timeout_at, Instant},
};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BridgePhase {
    Starting,
    Ready,
    Failed,
    Stopped,
}

#[derive(Clone, Debug, Serialize)]
pub struct Metadata {
    pub bee_version: String,
    pub os: String,
    pub arch: String,
    pub instance: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct BridgeStatus {
    pub state: BridgePhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Metadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BridgeError>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BridgeReply {
    pub protocol: u32,
    pub id: String,
    pub instance: String,
    pub result: Value,
}

pub(crate) struct LaunchSpec {
    pub program: PathBuf,
    pub bundle: Option<PathBuf>,
    pub args: Vec<String>,
    pub source: BuildSource,
    pub timeout: Duration,
}

struct Request {
    exit_request: bool,
    method: &'static str,
    params: Value,
    deadline: Instant,
    // 0=queued, 1=sent/being sent, 2=canceled before sending. CAS owns the boundary.
    phase: Arc<AtomicU8>,
    reply: oneshot::Sender<Result<BridgeReply, BridgeError>>,
}

pub(crate) struct Inner {
    pub(crate) frozen: Arc<AtomicBool>,
    pub(crate) exit: Mutex<crate::runtime::OwnedExitTask>,
    pub(crate) restored: AtomicBool,
    status: watch::Receiver<BridgeStatus>,
    status_tx: watch::Sender<BridgeStatus>,
    stop: watch::Sender<bool>,
    requests: mpsc::Sender<Request>,
    timeout: Duration,
    task: Mutex<StopTask>,
}

#[derive(Default)]
struct StopTask {
    handle: Option<tauri::async_runtime::JoinHandle<Result<(), BridgeError>>>,
    result: Option<Result<(), BridgeError>>,
}

#[derive(Clone)]
pub struct Bridge(pub(crate) Arc<Inner>);

fn error(code: &str, message: impl Into<String>) -> BridgeError {
    BridgeError {
        code: code.into(),
        message: message.into(),
    }
}

fn with_cleanup(original: Option<BridgeError>, cleanup: BridgeError) -> BridgeError {
    match original {
        None => cleanup,
        Some(original) => error(
            &cleanup.code,
            format!(
                "{}: {}; cleanup {}: {}",
                original.code, original.message, cleanup.code, cleanup.message
            ),
        ),
    }
}

fn bundled_program(executable: &std::path::Path) -> Result<PathBuf, BridgeError> {
    let directory = executable.parent().ok_or_else(|| {
        error(
            "BUNDLE_PATH_INVALID",
            format!(
                "App executable has no parent directory: {}",
                executable.display()
            ),
        )
    })?;
    Ok(directory.join(format!("bee{}", std::env::consts::EXE_SUFFIX)))
}

fn status(
    state: BridgePhase,
    metadata: Option<Metadata>,
    error: Option<BridgeError>,
) -> BridgeStatus {
    BridgeStatus {
        state,
        metadata,
        error,
    }
}

impl Bridge {
    pub(crate) fn bundled() -> Self {
        let spec = (|| {
            let source = BuildSource::parse(
                include_bytes!(env!("BEE_SOURCE_FILE")),
                env!("BEE_TARGET"),
                env!("BEE_REVISION"),
                env!("BEE_TEE_REVISION"),
            )
            .map_err(|cause| error("BUILD_SOURCE_INVALID", cause))?;
            let executable = std::env::current_exe().map_err(|cause| {
                error(
                    "BUNDLE_PATH_INVALID",
                    format!("resolve current App executable: {cause}"),
                )
            })?;
            let bundle = executable
                .parent()
                .filter(|path| path.file_name() == Some(std::ffi::OsStr::new("MacOS")))
                .and_then(std::path::Path::parent)
                .filter(|path| path.file_name() == Some(std::ffi::OsStr::new("Contents")))
                .and_then(std::path::Path::parent)
                .filter(|path| path.extension() == Some(std::ffi::OsStr::new("app")))
                .map(std::path::Path::to_path_buf);
            Ok(LaunchSpec {
                program: bundled_program(&executable)?,
                bundle,
                args: vec!["desktop".into()],
                source,
                timeout: Duration::from_secs(5),
            })
        })();
        match spec {
            Ok(spec) => Self::start(spec),
            Err(cause) => {
                let (status_tx, state) =
                    watch::channel(status(BridgePhase::Failed, None, Some(cause)));
                let (stop, _) = watch::channel(false);
                let (requests, _) = mpsc::channel(1);
                Self(Arc::new(Inner {
                    frozen: Arc::new(AtomicBool::new(false)),
                    exit: Mutex::new(Default::default()),
                    restored: AtomicBool::new(false),
                    status: state,
                    status_tx,
                    stop,
                    requests,
                    timeout: Duration::from_secs(5),
                    task: Mutex::new(StopTask::default()),
                }))
            }
        }
    }

    pub(crate) fn subscribe(&self) -> watch::Receiver<BridgeStatus> {
        self.0.status.clone()
    }

    pub(crate) fn start(spec: LaunchSpec) -> Self {
        let (status_tx, status_rx) = watch::channel(status(BridgePhase::Starting, None, None));
        let (stop_tx, stop_rx) = watch::channel(false);
        let (requests_tx, requests_rx) = mpsc::channel(16);
        let duration = spec.timeout;
        let frozen = Arc::new(AtomicBool::new(false));
        let task = tauri::async_runtime::spawn(supervise(
            spec,
            status_tx.clone(),
            stop_rx,
            requests_rx,
            frozen.clone(),
        ));
        Self(Arc::new(Inner {
            frozen,
            exit: Mutex::new(Default::default()),
            restored: AtomicBool::new(false),
            status: status_rx,
            status_tx,
            stop: stop_tx,
            requests: requests_tx,
            timeout: duration,
            task: Mutex::new(StopTask {
                handle: Some(task),
                result: None,
            }),
        }))
    }

    pub fn status(&self) -> BridgeStatus {
        self.0.status.borrow().clone()
    }

    pub async fn ping(&self) -> Result<BridgeReply, BridgeError> {
        self.request("ping", serde_json::json!({}), self.0.timeout)
            .await
    }
    pub async fn account_defaults(&self) -> Result<BridgeReply, BridgeError> {
        self.request(
            "account_defaults",
            serde_json::json!({}),
            Duration::from_secs(15),
        )
        .await
    }
    pub async fn account_detect(
        &self,
        request: AccountDetectRequest,
    ) -> Result<BridgeReply, BridgeError> {
        request.validate()?;
        let platform = request.platform;
        let reply = self
            .request(
                "account_detect",
                serde_json::json!(request),
                Duration::from_secs(10 * 60),
            )
            .await?;
        crate::protocol::validate_account_operation(&reply.result, platform)?;
        Ok(reply)
    }
    pub async fn account_snapshot(
        &self,
        platform: SupplyPlatform,
        refresh: bool,
    ) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "account_snapshot",
                serde_json::json!({"platform":platform,"refresh":refresh}),
                Duration::from_secs(15),
            )
            .await?;
        crate::protocol::validate_account_operation(&reply.result, platform)?;
        Ok(reply)
    }
    pub async fn account_action(
        &self,
        request: AccountActionRequest,
    ) -> Result<BridgeReply, BridgeError> {
        request.validate()?;
        let platform = request.platform;
        let reply = self
            .request(
                "account_action",
                serde_json::json!(request),
                Duration::from_secs(15),
            )
            .await?;
        crate::protocol::validate_account_operation(&reply.result, platform)?;
        Ok(reply)
    }

    pub async fn authorize_start(
        &self,
        request: crate::authorize_protocol::AuthorizeRequest,
    ) -> Result<BridgeReply, BridgeError> {
        request.validate()?;
        let platform = request.platform;
        let reply = self
            .request(
                "authorize_start",
                serde_json::json!(request),
                Duration::from_secs(15),
            )
            .await?;
        crate::authorize_protocol::validate_authorize_reply(&reply.result, Some(platform), None)?;
        Ok(reply)
    }
    pub async fn authorize_status(&self, operation_id: String) -> Result<BridgeReply, BridgeError> {
        self.authorize_operation("authorize_status", operation_id)
            .await
    }
    pub async fn authorize_cancel(&self, operation_id: String) -> Result<BridgeReply, BridgeError> {
        self.authorize_operation("authorize_cancel", operation_id)
            .await
    }
    async fn authorize_operation(
        &self,
        method: &'static str,
        operation_id: String,
    ) -> Result<BridgeReply, BridgeError> {
        crate::authorize_protocol::validate_operation_id(&operation_id)?;
        let reply = self
            .request(
                method,
                serde_json::json!({"operation_id":operation_id}),
                Duration::from_secs(15),
            )
            .await?;
        crate::authorize_protocol::validate_authorize_reply(
            &reply.result,
            None,
            Some(&operation_id),
        )?;
        Ok(reply)
    }
    pub async fn runtime_snapshot(&self) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "runtime_snapshot",
                serde_json::json!({}),
                Duration::from_secs(15),
            )
            .await?;
        crate::runtime_protocol::validate_runtime_reply(
            &reply.result,
            crate::runtime_protocol::RuntimeReplyKind::Snapshot,
        )?;
        Ok(reply)
    }
    pub async fn runtime_start(
        &self,
        request: crate::runtime_protocol::RuntimeStartRequest,
    ) -> Result<BridgeReply, BridgeError> {
        request.validate()?;
        let reply = self
            .request(
                "runtime_start",
                serde_json::json!(request),
                Duration::from_secs(15),
            )
            .await?;
        crate::runtime_protocol::validate_runtime_reply(
            &reply.result,
            crate::runtime_protocol::RuntimeReplyKind::Operation,
        )?;
        Ok(reply)
    }
    pub(crate) async fn runtime_stop(
        &self,
        expected_revision: u64,
        reason: crate::runtime_protocol::RuntimeStopReason,
    ) -> Result<BridgeReply, BridgeError> {
        crate::runtime_protocol::RuntimeStartRequest {
            expected_revision,
            resume_platforms: vec![],
        }
        .validate()?;
        let reply = self
            .request(
                "runtime_stop",
                serde_json::json!({"expected_revision":expected_revision,"reason":reason}),
                Duration::from_secs(15),
            )
            .await?;
        crate::runtime_protocol::validate_runtime_reply(
            &reply.result,
            crate::runtime_protocol::RuntimeReplyKind::Operation,
        )?;
        Ok(reply)
    }
    // Internal lifecycle/settings entry only; intentionally absent from Tauri commands.
    #[allow(dead_code)] // Consumed by S2 after the S1 network contract is delivered.
    pub(crate) async fn runtime_configure_network(
        &self,
        request: crate::runtime_protocol::RuntimeNetworkConfig,
    ) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "runtime_configure_network",
                serde_json::json!(request),
                Duration::from_secs(15),
            )
            .await?;
        crate::runtime_protocol::validate_runtime_reply(
            &reply.result,
            crate::runtime_protocol::RuntimeReplyKind::Configured,
        )?;
        Ok(reply)
    }

    pub async fn device_status(&self) -> Result<BridgeReply, BridgeError> {
        self.request(
            "device_status",
            serde_json::json!({}),
            Duration::from_secs(15),
        )
        .await
    }

    pub async fn device_begin(
        &self,
        hive: String,
        name: String,
    ) -> Result<BridgeReply, BridgeError> {
        self.request(
            "device_begin",
            serde_json::json!({"hive":hive,"name":name}),
            Duration::from_secs(15),
        )
        .await
    }

    pub async fn supply_status(
        &self,
        platform: SupplyPlatform,
    ) -> Result<BridgeReply, BridgeError> {
        self.request(
            "supply_status",
            serde_json::json!({"platform":platform}),
            Duration::from_secs(15),
        )
        .await
    }

    pub async fn supply_set_paused(
        &self,
        platform: SupplyPlatform,
        paused: bool,
    ) -> Result<BridgeReply, BridgeError> {
        self.request(
            "supply_set_paused",
            serde_json::json!({"platform":platform,"paused":paused}),
            Duration::from_secs(15),
        )
        .await
    }

    pub(crate) async fn request(
        &self,
        method: &'static str,
        params: Value,
        duration: Duration,
    ) -> Result<BridgeReply, BridgeError> {
        self.request_inner(method, params, duration, false).await
    }

    pub(crate) async fn exit_request(
        &self,
        method: &'static str,
        params: Value,
    ) -> Result<BridgeReply, BridgeError> {
        self.request_inner(method, params, Duration::from_secs(5), true)
            .await
    }

    async fn request_inner(
        &self,
        method: &'static str,
        params: Value,
        duration: Duration,
        exit_request: bool,
    ) -> Result<BridgeReply, BridgeError> {
        if self.0.frozen.load(Ordering::SeqCst) && !exit_request {
            return Err(error(
                "OWNED_EXIT_PENDING",
                "request rejected: owned exit has frozen new operations",
            ));
        }
        let current = self.status();
        if current.state != BridgePhase::Ready || *self.0.stop.borrow() {
            return Err(current.error.unwrap_or_else(|| {
                error(
                    "BRIDGE_NOT_READY",
                    format!(
                        "ping rejected: bridge state={:?}, stopping={}; required=ready",
                        current.state,
                        *self.0.stop.borrow()
                    ),
                )
            }));
        }
        let deadline = Instant::now() + duration;
        let (reply, receive) = oneshot::channel();
        let phase = Arc::new(AtomicU8::new(0));
        self.0
            .requests
            .try_send(Request {
                exit_request,
                method,
                params,
                deadline,
                phase: phase.clone(),
                reply,
            })
            .map_err(|cause| {
                error(
                    "REQUEST_NOT_QUEUED",
                    format!("ping queue rejected request: {cause}; capacity=16"),
                )
            })?;
        let response = timeout_at(deadline, receive).await.map_err(|_| {
            if phase.compare_exchange(0, 2, Ordering::SeqCst, Ordering::SeqCst).is_err() {
                { let cause=error("RESPONSE_TIMEOUT", format!("owned Bee {method} reply deadline elapsed; required=reply within {} ms including queue time; write result unconfirmed",duration.as_millis())); self.0.status_tx.send_if_modified(|current|{if current.state!=BridgePhase::Ready { return false; } *current=status(BridgePhase::Failed,None,Some(cause.clone()));true});cause }
            } else {
                error("REQUEST_QUEUE_TIMEOUT",format!("{method} expired in the request queue before any bytes were sent; bridge session preserved"))
            }
        })?;
        response.map_err(|cause| {
            self.status().error.unwrap_or_else(|| {
                error(
                    "BRIDGE_STOPPED",
                    format!("ping reply channel closed before response: {cause}"),
                )
            })
        })?
    }

    pub async fn stop(&self) -> Result<(), BridgeError> {
        self.0.stop.send_replace(true);
        // Hold this lock while joining so every concurrent stop waits for reaping.
        let mut task = self.0.task.lock().await;
        if let Some(handle) = task.handle.as_mut() {
            let result = handle
                .await
                .map_err(|cause| {
                    error(
                        "SUPERVISOR_JOIN_FAILED",
                        format!("owned Bee supervisor join failed: {cause}"),
                    )
                })
                .and_then(|result| result);
            task.handle.take();
            task.result = Some(result);
        }
        task.result.clone().unwrap_or(Ok(()))
    }
}

struct Replies {
    stdout: ChildStdout,
    decoder: FrameDecoder,
    queued: VecDeque<Envelope>,
}

impl Replies {
    async fn next(&mut self) -> Result<Envelope, BridgeError> {
        loop {
            if let Some(frame) = self.queued.pop_front() {
                return Ok(frame);
            }
            let mut bytes = [0u8; 8192];
            let count = self.stdout.read(&mut bytes).await.map_err(|cause| {
                error(
                    "PIPE_READ_FAILED",
                    format!("owned Bee stdout read failed: {cause}"),
                )
            })?;
            if count == 0 {
                self.decoder.finish()?;
                return Err(error(
                    "CHILD_STDOUT_CLOSED",
                    "owned Bee stdout reached EOF while a response or live pipe was required",
                ));
            }
            self.queued.extend(self.decoder.push(&bytes[..count])?);
        }
    }
}

async fn exchange(
    stdin: &mut ChildStdin,
    replies: &mut Replies,
    method: &str,
    id: &str,
    params: &Value,
    deadline: Instant,
) -> Result<Envelope, BridgeError> {
    timeout_at(deadline, async {
        let mut bytes = serde_json::to_vec(&serde_json::json!({"protocol":1,"id":id,"method":method,"params":params})).map_err(|cause| error("REQUEST_ENCODING_FAILED", format!("encode {method} request: {cause}")))?;
        bytes.push(b'\n');
        stdin.write_all(&bytes).await.map_err(|cause| error("PIPE_WRITE_FAILED", format!("write owned Bee {method} request bytes={}: {cause}", bytes.len())))?;
        stdin.flush().await.map_err(|cause| error("PIPE_WRITE_FAILED", format!("flush owned Bee {method} request: {cause}")))?;
        replies.next().await
    }).await.map_err(|_| error("RESPONSE_TIMEOUT", format!("owned Bee {method} response deadline elapsed; request id={id}; writes and complete frame must finish within request deadline")))?
}

async fn stopped(stop: &mut watch::Receiver<bool>) {
    if *stop.borrow() {
        return;
    }
    let _ = stop.changed().await;
}

async fn session(
    spec: &LaunchSpec,
    child: &mut Child,
    stdin: &mut ChildStdin,
    replies: &mut Replies,
    statuses: &watch::Sender<BridgeStatus>,
    stop: &mut watch::Receiver<bool>,
    requests: &mut mpsc::Receiver<Request>,
    frozen: &AtomicBool,
) -> Result<(), BridgeError> {
    let hello_params = serde_json::json!({});
    let handshake = exchange(
        stdin,
        replies,
        "hello",
        "shell-1",
        &hello_params,
        Instant::now() + spec.timeout,
    );
    let frame = tokio::select! {
        biased;
        _ = stopped(stop) => return Ok(()),
        result = handshake => result?,
    };
    let instance = frame.instance.clone();
    let hello = protocol::hello(
        frame.success("shell-1", None)?,
        &spec.source.bee_version,
        &spec.source.goos,
        &spec.source.goarch,
    )?;
    statuses.send_replace(status(
        BridgePhase::Ready,
        Some(Metadata {
            bee_version: hello.bee_version,
            os: hello.os,
            arch: hello.arch,
            instance: instance.clone(),
        }),
        None,
    ));
    let mut counter = 1u64;
    loop {
        if let Some(cause) = statuses.borrow().error.clone() {
            return Err(cause);
        }
        tokio::select! {
            biased;
            _ = stopped(stop) => return Ok(()),
            result = child.wait() => return Err(error("CHILD_EXITED", match result { Ok(exit) => format!("owned Bee exited while bridge was ready: status={exit}"), Err(cause) => format!("wait for owned Bee failed: {cause}") })),
            result = replies.next() => return Err(match result { Ok(frame) => error("UNEXPECTED_REPLY", format!("owned Bee sent a response with no pending request; id bytes={}", frame.id.len())), Err(cause) => cause }),
            request = requests.recv() => {
                let Some(request) = request else { return Ok(()); };
                if request.reply.is_closed() { continue; }
                if frozen.load(Ordering::SeqCst) && !request.exit_request {
                    let _ = request.reply.send(Err(error("OWNED_EXIT_PENDING", "queued operation rejected before send: owned exit is pending")));
                    continue;
                }
                if Instant::now() >= request.deadline {
                    // No bytes were sent: only this queued request failed.
                    let _ = request.reply.send(Err(error("REQUEST_QUEUE_TIMEOUT", format!("{} expired in the request queue before any bytes were sent; bridge session preserved", request.method))));
                    continue;
                }
                counter = counter.checked_add(1).ok_or_else(|| error("REQUEST_ID_EXHAUSTED", "shell request counter reached u64 maximum"))?;
                let id = format!("shell-{counter}");
                if request.phase.compare_exchange(0,1,Ordering::SeqCst,Ordering::SeqCst).is_err() { continue; }
                let response = tokio::select! {
                    biased;
                    _ = stopped(stop) => { let _ = request.reply.send(Err(error("BRIDGE_STOPPED", "ping cancelled because owned Bee is stopping"))); return Ok(()); },
                    result = exchange(stdin, replies, request.method, &id, &request.params, request.deadline) => result,
                }.and_then(|frame| frame.success(&id, Some(&instance)))
                    .and_then(|result| {
                        if request.method == "ping" && result != serde_json::json!({"alive":true}) { return Err(error("INVALID_PING", "ping result differs from required alive=true object")); }
                        Ok(BridgeReply { protocol: 1, id, instance: instance.clone(), result })
                    });
                // A caller deadline can revoke the session before exchange gets polled
                // again. Never accept its late success or send another queued write.
                let response=if let Some(cause)=statuses.borrow().error.clone() { Err(cause) } else { response };
                let failure = response.as_ref().err().cloned();
                if let Some(cause) = &failure {
                    statuses.send_replace(status(BridgePhase::Failed, None, Some(cause.clone())));
                }
                let _ = request.reply.send(response);
                if let Some(failure) = failure { return Err(failure); }
            }
        }
    }
}

async fn reap(child: &mut Child) -> Result<std::process::ExitStatus, BridgeError> {
    match timeout(Duration::from_secs(2), child.wait()).await {
        Ok(result) => result.map_err(|cause| {
            error(
                "CHILD_REAP_FAILED",
                format!("wait after closing owned Bee stdin failed: {cause}"),
            )
        }),
        Err(_) => {
            child.kill().await.map_err(|cause| error("CHILD_REAP_FAILED", format!("owned Bee did not exit within 2000ms after stdin closed; kill and wait failed: {cause}")))?;
            child.wait().await.map_err(|cause| {
                error(
                    "CHILD_REAP_FAILED",
                    format!("read owned Bee exit status after kill and wait: {cause}"),
                )
            })
        }
    }
}

async fn supervise(
    spec: LaunchSpec,
    statuses: watch::Sender<BridgeStatus>,
    mut stop: watch::Receiver<bool>,
    mut requests: mpsc::Receiver<Request>,
    frozen: Arc<AtomicBool>,
) -> Result<(), BridgeError> {
    let mut cleanup_failure = None;
    let run = async {
        let source = spec.source.clone();
        let program = spec.program.clone();
        let bundle = spec.bundle.clone();
        tokio::task::spawn_blocking(move || {
            source.verify_runtime_binary(&program, bundle.as_deref())
        })
        .await
        .map_err(|cause| {
            error(
                "BINARY_CHECK_JOIN_FAILED",
                format!("bundled Bee SHA256 worker join failed: {cause}"),
            )
        })?
        .map_err(|cause| error("BUNDLED_BEE_INVALID", cause))?;
        if *stop.borrow() {
            return Ok(());
        }
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(target_os = "windows")]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; owned pipes only.
        let mut child = command.spawn().map_err(|cause| {
            error(
                "CHILD_SPAWN_FAILED",
                format!("spawn bundled Bee {}: {cause}", spec.program.display()),
            )
        })?;
        // Piped handles are guaranteed by Command. Keep Child as the sole owner
        // of process termination; never resolve a PID by executable name.
        let mut stdin = child.stdin.take().ok_or_else(|| {
            error(
                "PIPE_MISSING",
                "spawned owned Bee has no stdin despite Stdio::piped",
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            error(
                "PIPE_MISSING",
                "spawned owned Bee has no stdout despite Stdio::piped",
            )
        })?;
        let mut stderr = child.stderr.take().ok_or_else(|| {
            error(
                "PIPE_MISSING",
                "spawned owned Bee has no stderr despite Stdio::piped",
            )
        })?;
        // Device credentials stay in Go and are never logged by this entry point.
        // Drain continuously and retain only its bounded diagnostic tail.
        let mut diagnostics =
            tokio::spawn(async move { crate::diagnostics::drain(&mut stderr).await });
        let mut replies = Replies {
            stdout,
            decoder: FrameDecoder::default(),
            queued: VecDeque::new(),
        };
        let result = session(
            &spec,
            &mut child,
            &mut stdin,
            &mut replies,
            &statuses,
            &mut stop,
            &mut requests,
            &frozen,
        )
        .await;
        if let Err(cause) = &result {
            statuses.send_replace(status(BridgePhase::Failed, None, Some(cause.clone())));
        }
        drop(stdin); // EOF also cancels a Go management process waiting for input.
        let cleanup = reap(&mut child).await;
        let (diagnostic, drain) = match timeout(Duration::from_secs(2), &mut diagnostics).await {
            Ok(Ok(Ok(diagnostic))) => (Some(diagnostic), Ok(())),
            Ok(Ok(Err(cause))) => (
                None,
                Err(error(
                    "STDERR_READ_FAILED",
                    format!("owned Bee stderr drain failed: {cause}"),
                )),
            ),
            Ok(Err(cause)) => (
                None,
                Err(error(
                    "STDERR_JOIN_FAILED",
                    format!("owned Bee stderr reader join failed: {cause}"),
                )),
            ),
            Err(_) => {
                diagnostics.abort();
                let _ = diagnostics.await;
                (
                    None,
                    Err(error(
                        "STDERR_CLOSE_TIMEOUT",
                        "owned Bee stderr remained open 2000ms after child reaping",
                    )),
                )
            }
        };
        let mut failure = result.as_ref().err().cloned();
        if let Some(cause) = &mut failure {
            if let Ok(exit) = &cleanup {
                cause
                    .message
                    .push_str(&format!("; owned child status={exit}"));
            }
            if let Some(diagnostic) = diagnostic {
                cause.message.push_str(&format!(
                    "; management stderr bytes={}, retained={}, truncated={}, tail={:?}",
                    diagnostic.bytes,
                    diagnostic.tail.len(),
                    diagnostic.bytes > diagnostic.tail.len() as u64,
                    String::from_utf8_lossy(&diagnostic.tail)
                ));
            }
        }
        for cause in cleanup.err().into_iter().chain(drain.err()) {
            failure = Some(with_cleanup(failure, cause));
            cleanup_failure = failure.clone();
        }
        if let Some(cause) = cleanup_failure.clone() {
            return Err(cause);
        }
        failure.map_or(Ok(()), Err)
    }
    .await;
    let terminal = match &run {
        Err(cause) => status(BridgePhase::Failed, None, Some(cause.clone())),
        Ok(()) => status(BridgePhase::Stopped, None, None),
    };
    statuses.send_replace(terminal);
    requests.close();
    while let Some(request) = requests.recv().await {
        let cause = run.as_ref().err().cloned().unwrap_or_else(|| {
            error(
                "BRIDGE_STOPPED",
                "queued ping cancelled after owned Bee stopped",
            )
        });
        let _ = request.reply.send(Err(cause));
    }
    // A protocol failure is reported through status; stop reports cleanup/join
    // errors independently instead of treating a failed handshake as failed quit.
    cleanup_failure.map_or(Ok(()), Err)
}

#[cfg(test)]
#[path = "sidecar_tests.rs"]
pub(crate) mod tests;
