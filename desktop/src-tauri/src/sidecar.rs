use crate::build_source::BuildSource;
use crate::protocol::{
    self, AccountActionRequest, AccountDetectRequest, BridgeError, Envelope, FrameDecoder,
    SupplyPlatform,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    future::poll_fn,
    path::PathBuf,
    pin::Pin,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    task::Poll,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWrite, AsyncWriteExt},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{broadcast, mpsc, oneshot, watch, Mutex, Notify, OwnedSemaphorePermit, Semaphore},
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
    pub capabilities: Vec<String>,
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

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PendingRequest {
    pub id: String,
    pub method: String,
    pub platform: Option<SupplyPlatform>,
}
#[derive(Clone, Debug, Serialize)]
pub struct PendingRequests {
    pub instance: Option<String>,
    pub requests: Vec<PendingRequest>,
}
#[derive(Clone, Debug, Serialize)]
pub struct RequestSettled {
    pub instance: String,
    pub id: String,
    pub method: String,
    pub platform: Option<SupplyPlatform>,
}
struct RequestTracker {
    pending: StdMutex<HashMap<String, PendingRequest>>,
    settled: broadcast::Sender<RequestSettled>,
    diagnostics: broadcast::Sender<Value>,
}
impl Default for RequestTracker {
    fn default() -> Self {
        Self {
            pending: StdMutex::new(HashMap::new()),
            settled: broadcast::channel(32).0,
            diagnostics: broadcast::channel(64).0,
        }
    }
}

pub(crate) struct LaunchSpec {
    pub program: PathBuf,
    pub bundle: Option<PathBuf>,
    pub args: Vec<String>,
    pub source: BuildSource,
    pub timeout: Duration,
}

#[derive(Clone, Copy, PartialEq)]
enum RequestPhase {
    Queued,
    Sent,
    Canceled,
}
struct CancelUnsent(Arc<StdMutex<RequestPhase>>, Arc<Notify>);
impl Drop for CancelUnsent {
    fn drop(&mut self) {
        let mut phase = self.0.lock().unwrap();
        if *phase == RequestPhase::Queued {
            *phase = RequestPhase::Canceled;
        }
        self.1.notify_one();
    }
}

struct Outgoing {
    id: String,
    bytes: Vec<u8>,
    written: usize,
}

// poll_write is synchronous. Hold the same short lock used by the caller's
// deadline/drop guard across that poll and the first successful byte count.
// Pending emits no bytes, so cancellation can still preserve the live session.
async fn write_step<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame: &mut Outgoing,
    phase: &StdMutex<RequestPhase>,
    deadline: Instant,
    frozen: &AtomicBool,
    ordinary: bool,
) -> Result<bool, BridgeError> {
    poll_fn(|cx| {
        let mut state = phase.lock().unwrap();
        if *state != RequestPhase::Sent
            && (*state == RequestPhase::Canceled
                || Instant::now() >= deadline
                || ordinary && frozen.load(Ordering::SeqCst))
        {
            *state = RequestPhase::Canceled;
            return Poll::Ready(Ok(true));
        }
        if frame.written == frame.bytes.len() {
            return Pin::new(&mut *writer).poll_flush(cx).map(|r| {
                r.map(|_| true).map_err(|cause| {
                    error(
                        "PIPE_WRITE_FAILED",
                        format!("flush owned Bee request id={}: {cause}", frame.id),
                    )
                })
            });
        }
        match Pin::new(&mut *writer).poll_write(cx, &frame.bytes[frame.written..]) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Ok(0)) => Poll::Ready(Err(error(
                "PIPE_WRITE_FAILED",
                format!(
                    "write owned Bee request id={} returned zero bytes; remaining={}",
                    frame.id,
                    frame.bytes.len() - frame.written
                ),
            ))),
            Poll::Ready(Ok(count)) => {
                frame.written += count;
                *state = RequestPhase::Sent;
                Poll::Ready(Ok(false))
            }
            Poll::Ready(Err(cause)) => Poll::Ready(Err(error(
                "PIPE_WRITE_FAILED",
                format!(
                    "write owned Bee request id={} completed bytes={}: {cause}",
                    frame.id, frame.written
                ),
            ))),
        }
    })
    .await
}

struct Request {
    exit_request: bool,
    method: &'static str,
    params: Value,
    deadline: Instant,
    queued_at: Instant,
    started_at: Option<Instant>,
    duration: Duration,
    timed_out: bool,
    // Shared lock makes first-byte emission atomic with caller cancellation/deadline.
    phase: Arc<StdMutex<RequestPhase>>,
    _permit: OwnedSemaphorePermit,
    reply: Option<oneshot::Sender<Result<BridgeReply, BridgeError>>>,
}

impl Request {
    fn respond(&mut self, result: Result<BridgeReply, BridgeError>) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(result);
        }
    }
    fn expires_at(&self) -> Instant {
        if self.exit_request {
            self.deadline
        } else {
            self.started_at
                .map_or(self.deadline, |at| at + self.duration)
        }
    }
    fn pending(&self, id: &str) -> PendingRequest {
        PendingRequest {
            id: id.into(),
            method: self.method.into(),
            platform: request_platform(self),
        }
    }
}
fn request_platform(request: &Request) -> Option<SupplyPlatform> {
    match request.params["platform"].as_str() {
        Some("openai") => Some(SupplyPlatform::Openai),
        Some("claude") => Some(SupplyPlatform::Claude),
        _ => None,
    }
}
fn timeout_error(request: &Request, id: &str, fully_sent: bool, now: Instant) -> BridgeError {
    let sent = request.started_at.is_some();
    let phase = if !sent {
        "queue"
    } else if fully_sent {
        "response"
    } else {
        "write"
    };
    let queue_ms = request
        .started_at
        .unwrap_or(now)
        .duration_since(request.queued_at)
        .as_millis();
    let execution_ms = request
        .started_at
        .map_or(0, |at| now.duration_since(at).as_millis());
    let platform = match request_platform(request) {
        Some(SupplyPlatform::Openai) => "openai",
        Some(SupplyPlatform::Claude) => "claude",
        None => "none",
    };
    let evidence = [
        ("request_id", id.to_string()),
        ("method", request.method.to_string()),
        ("platform", platform.to_string()),
        ("phase", phase.to_string()),
        ("queue_ms", queue_ms.to_string()),
        ("execution_ms", execution_ms.to_string()),
        ("fully_sent", fully_sent.to_string()),
        ("in_flight", sent.to_string()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    BridgeError {
        code: if sent { "RESPONSE_TIMEOUT" } else { "REQUEST_QUEUE_TIMEOUT" }.into(),
        message: format!("owned Bee {} deadline elapsed; request id={id}; phase={phase}; queue_ms={queue_ms}; execution_ms={execution_ms}; fully_sent={fully_sent}; in_flight={sent}; bridge session preserved", request.method),
        details: Some(protocol::FailureDetails { check: "bridge_request_deadline".into(),
            observed_at: time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).expect("UTC formatting"), evidence }),
    }
}

// Validate before delivery or settlement, even when the caller has vanished.
// The decoder already validated the envelope and structured error contract.
fn validate_method_result(
    request: &Request,
    result: &Value,
    instance: &str,
) -> Result<(), BridgeError> {
    if !result.is_object() {
        return Err(error(
            "INVALID_REPLY",
            format!(
                "{} result requires an object; actual type={}",
                request.method,
                if result.is_null() {
                    "null"
                } else {
                    "non-object"
                }
            ),
        ));
    }
    if result.get("error").is_some() {
        // Context observations intentionally carry a revision beside the error.
        // Its dedicated parser validates both the error kind and revision facts.
        if request.method == "device_context" && result.get("binding_revision").is_some() {
            return protocol::device_context_state(result).map(|_| ());
        }
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Failure {
            error: BridgeError,
        }
        let failure: Failure = serde_json::from_value(result.clone())
            .map_err(|cause| protocol::invalid_json("operation failure envelope", cause))?;
        // These decoders deliberately return the validated domain failure as Err.
        // Classify its closed wire variant before entering success-only decoding;
        // never infer this distinction by comparing a decoder's error code/text.
        match request.method {
            "device_recovery_prepare"
            | "device_recovery_confirm"
            | "device_recovery_status"
            | "network_status"
            | "network_test"
            | "device_context" => return Ok(()),
            "diagnostics_start"
            | "diagnostics_snapshot"
            | "diagnostics_cancel"
            | "notification_snapshot" => {
                let (required, invalid) = if request.method == "notification_snapshot" {
                    (
                        "NOTIFICATIONS_OPERATION_FAILED",
                        "NOTIFICATION_REPLY_INVALID",
                    )
                } else {
                    ("DIAGNOSTICS_OPERATION_FAILED", "DIAGNOSTICS_REPLY_INVALID")
                };
                if failure.error.code != required || failure.error.message.len() > 1024 {
                    return Err(error(invalid, format!("{} failure variant rejected; fixed_code_match={}; actual code bytes={}; message bytes={}; required code={required}, message maximum=1024", request.method,
                        failure.error.code == required, failure.error.code.len(), failure.error.message.len())));
                }
                return Ok(());
            }
            _ => {}
        }
    }
    match request.method {
        "account_detect" | "account_snapshot" | "account_action" => {
            let platform = request_platform(request).ok_or_else(|| {
                error(
                    "ACCOUNT_REPLY_INVALID",
                    "account request has no valid platform; required=openai|claude",
                )
            })?;
            protocol::validate_account_operation(result, platform)
        }
        "authorize_progress" | "authorize_open" => {
            crate::authorize_protocol::validate_login_reply(result, request.params["operation_id"].as_str().unwrap_or(""), request.method == "authorize_open")
        }
        "authorize_start" | "authorize_status" | "authorize_cancel" => {
            crate::authorize_protocol::validate_authorize_reply(
                result,
                if request.method == "authorize_start" {
                    request_platform(request)
                } else {
                    None
                },
                request.params["operation_id"].as_str(),
            )
        }
        "runtime_snapshot"
        | "runtime_start"
        | "runtime_stop"
        | "runtime_restore"
        | "runtime_configure_network" => {
            use crate::runtime_protocol::{validate_runtime_reply, RuntimeReplyKind};
            validate_runtime_reply(
                result,
                match request.method {
                    "runtime_snapshot" => RuntimeReplyKind::Snapshot,
                    "runtime_configure_network" => RuntimeReplyKind::Configured,
                    _ => RuntimeReplyKind::Operation,
                },
            )
        }
        "runtime_verify" | "runtime_enable_presence" => {
            if result.get("error").is_some() {
                return Ok(());
            }
            let required = if request.method == "runtime_verify" {
                serde_json::json!({"verified":true})
            } else {
                serde_json::json!({"enabled":true})
            };
            if *result != required {
                let field = if request.method == "runtime_verify" { "verified" } else { "enabled" };
                return Err(error(
                    if request.method == "runtime_verify" { "STARTUP_DATA_INVALID" } else { "RUNTIME_REPLY_INVALID" },
                    format!(
                        "{} confirmation differs from required success object; actual {field}={:?}; result fields={}; required={required}",
                        request.method, result[field].as_bool(), result.as_object().map_or(0, |object| object.len())
                    ),
                ));
            }
            Ok(())
        }
        "device_context" => protocol::device_context_state(result).map(|_| ()),
        "device_recovery_prepare" | "device_recovery_confirm" | "device_recovery_status" => {
            protocol::device_recovery(result).map(|_| ())
        }
        "device_status" | "device_begin" if result.get("error").is_none() => {
            protocol::validate_device_recovery(result)
        }
        "diagnostics_start" | "diagnostics_snapshot" | "diagnostics_cancel" => {
            crate::diagnostics_protocol::validate_report(result, instance).map(|_| ())
        }
        "network_status" => crate::network::decode_network_status(result).map(|_| ()),
        "network_test" => crate::network_protocol::validate_test(result).map(|_| ()),
        "notification_snapshot" => crate::notification_poll::validate(result),
        _ => Ok(()),
    }
}

fn read_platform(request: &Request) -> Option<&str> {
    if request.method == "authorize_progress" { return Some("openai"); }
    if !matches!(
        request.method,
        "account_detect" | "account_snapshot" | "supply_status"
    ) {
        return None;
    }
    request.params["platform"]
        .as_str()
        .filter(|p| matches!(*p, "openai" | "claude"))
}
fn unsent_rejection(request: &Request, frozen: &AtomicBool, now: Instant) -> Option<BridgeError> {
    if frozen.load(Ordering::SeqCst) && !request.exit_request {
        return Some(error(
            "OWNED_EXIT_PENDING",
            "queued operation rejected before send: owned exit is pending",
        ));
    }
    if now >= request.deadline {
        return Some(error(
            "REQUEST_QUEUE_TIMEOUT",
            format!(
                "{} expired before any bytes were sent; bridge session preserved",
                request.method
            ),
        ));
    }
    if request.reply.as_ref().is_none_or(|reply| reply.is_closed())
        || *request.phase.lock().unwrap() == RequestPhase::Canceled
    {
        return Some(error(
            "REQUEST_CANCELED",
            format!(
                "{} canceled before any bytes were sent; bridge session preserved",
                request.method
            ),
        ));
    }
    None
}

pub(crate) struct Inner {
    pub(crate) frozen: Arc<AtomicBool>,
    pub(crate) startup_verified: AtomicBool,
    pub(crate) exit: Mutex<crate::runtime::OwnedExitTask>,
    pub(crate) restored: AtomicBool,
    status: watch::Receiver<BridgeStatus>,
    status_tx: watch::Sender<BridgeStatus>,
    stop: watch::Sender<bool>,
    requests: mpsc::Sender<Request>,
    capacity: Arc<Semaphore>,
    wake: Arc<Notify>,
    timeout: Duration,
    tracker: Arc<RequestTracker>,
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
        details: None,
        code: code.into(),
        message: message.into(),
    }
}

/// This request emitted no bytes. Retain the terminal cause without inheriting
/// another request's uncertain submission, and keep the public error bounded.
fn request_not_sent(method: &str, cause: &BridgeError) -> BridgeError {
    let original = if protocol::safe_failure_text(&cause.message) {
        cause.message.clone()
    } else {
        format!(
            "unsafe cause text omitted; original bytes={}",
            cause.message.len()
        )
    };
    let mut message = format!(
        "{method} rejected before any bytes were sent; cause={}: {original}",
        cause.code
    );
    let details = match &cause.details {
        Some(value) => match value.validate() {
            Ok(()) => Some(value.clone()),
            Err(reason) => {
                message.push_str(&format!("; cause details rejected: {reason}"));
                None
            }
        },
        None => None,
    };
    if message.len() > 32768 {
        let suffix = format!(
            "; cause text truncated; actual bytes={}; maximum=32768",
            message.len()
        );
        let mut end = 32768 - suffix.len();
        while !message.is_char_boundary(end) {
            end -= 1;
        }
        message.truncate(end);
        message.push_str(&suffix);
    }
    BridgeError {
        code: "REQUEST_NOT_SENT".into(),
        message,
        details,
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
                    startup_verified: AtomicBool::new(true),
                    exit: Mutex::new(Default::default()),
                    restored: AtomicBool::new(false),
                    status: state,
                    status_tx,
                    stop,
                    requests,
                    capacity: Arc::new(Semaphore::new(16)),
                    wake: Arc::new(Notify::new()),
                    timeout: Duration::from_secs(5),
                    tracker: Arc::new(RequestTracker::default()),
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
        let wake = Arc::new(Notify::new());
        let tracker = Arc::new(RequestTracker::default());
        let task = tauri::async_runtime::spawn(supervise(
            spec,
            status_tx.clone(),
            stop_rx,
            requests_rx,
            frozen.clone(),
            wake.clone(),
            tracker.clone(),
        ));
        Self(Arc::new(Inner {
            frozen,
            startup_verified: AtomicBool::new(true),
            exit: Mutex::new(Default::default()),
            restored: AtomicBool::new(false),
            status: status_rx,
            status_tx,
            stop: stop_tx,
            requests: requests_tx,
            capacity: Arc::new(Semaphore::new(16)),
            wake,
            timeout: duration,
            tracker,
            task: Mutex::new(StopTask {
                handle: Some(task),
                result: None,
            }),
        }))
    }

    pub fn pending_requests(&self) -> PendingRequests {
        let instance = self.status().metadata.map(|metadata| metadata.instance);
        let mut requests: Vec<_> = self
            .0
            .tracker
            .pending
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect();
        requests.sort_by(|a, b| a.id.cmp(&b.id));
        PendingRequests { instance, requests }
    }
    pub(crate) fn subscribe_settled(&self) -> broadcast::Receiver<RequestSettled> {
        self.0.tracker.settled.subscribe()
    }
    pub(crate) fn subscribe_diagnostics(&self) -> broadcast::Receiver<Value> {
        self.0.tracker.diagnostics.subscribe()
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
    pub async fn authorize_progress(&self, operation_id: String) -> Result<BridgeReply, BridgeError> {
        self.authorize_extension("authorize_progress", operation_id).await
    }
    pub async fn authorize_open(&self, operation_id: String) -> Result<BridgeReply, BridgeError> {
        self.authorize_extension("authorize_open", operation_id).await
    }
    async fn authorize_extension(&self, method: &'static str, operation_id: String) -> Result<BridgeReply, BridgeError> {
        crate::authorize_protocol::validate_operation_id(&operation_id)?;
        let reply = self.request(method, serde_json::json!({"operation_id":operation_id}), Duration::from_secs(15)).await?;
        crate::authorize_protocol::validate_login_reply(&reply.result, &operation_id, method == "authorize_open")?;
        Ok(reply)
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
    pub(crate) async fn diagnostics_action(
        &self,
        method: &'static str,
        id: Option<String>,
    ) -> Result<BridgeReply, BridgeError> {
        let params = if method == "diagnostics_start" {
            serde_json::json!({})
        } else {
            let id = id.ok_or_else(|| BridgeError {
                details: None,
                code: "DIAGNOSTICS_REQUEST_INVALID".into(),
                message: "diagnostics report identifier missing".into(),
            })?;
            crate::authorize_protocol::validate_operation_id(&id)?;
            serde_json::json!({"id":id})
        };
        if ![
            "diagnostics_start",
            "diagnostics_snapshot",
            "diagnostics_cancel",
        ]
        .contains(&method)
        {
            return Err(BridgeError {
                details: None,
                code: "DIAGNOSTICS_REQUEST_INVALID".into(),
                message: "diagnostics method outside fixed allowlist".into(),
            });
        }
        let reply = self
            .request(method, params, Duration::from_secs(15))
            .await?;
        crate::diagnostics_protocol::validate_report(&reply.result, &reply.instance)?;
        Ok(reply)
    }
    pub(crate) async fn network_status(&self) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "network_status",
                serde_json::json!({}),
                Duration::from_secs(15),
            )
            .await?;
        crate::network::decode_network_status(&reply.result)?;
        Ok(reply)
    }
    pub(crate) async fn notification_snapshot(&self) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "notification_snapshot",
                serde_json::json!({}),
                Duration::from_secs(15),
            )
            .await?;
        crate::notification_poll::validate(&reply.result)?;
        Ok(reply)
    }
    pub(crate) async fn network_test(&self, proxy: String) -> Result<BridgeReply, BridgeError> {
        crate::preferences::validate_proxy(&proxy)?;
        let reply = self
            .request(
                "network_test",
                serde_json::json!({"proxy":proxy}),
                Duration::from_secs(15),
            )
            .await?;
        crate::network_protocol::validate_test(&reply.result)?;
        Ok(reply)
    }
    pub(crate) async fn runtime_restore(&self) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "runtime_restore",
                serde_json::json!({}),
                Duration::from_secs(15),
            )
            .await?;
        crate::runtime_protocol::validate_runtime_reply(
            &reply.result,
            crate::runtime_protocol::RuntimeReplyKind::Operation,
        )?;
        if let Some(error) = reply.result.get("error") {
            return Err(serde_json::from_value(error.clone())
                .map_err(|e| crate::protocol::invalid_json("runtime restore error", e))?);
        }
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
    // Native lifecycle only: no corresponding frontend command exists.
    pub(crate) async fn runtime_enable_presence(
        &self,
        binding: u64,
        network: u64,
    ) -> Result<(), BridgeError> {
        let reply = self
            .request(
                "runtime_enable_presence",
                serde_json::json!({"binding_revision":binding,"network_revision":network}),
                Duration::from_secs(15),
            )
            .await?;
        crate::protocol::result_error(&reply.result)?;
        if reply.result != serde_json::json!({"enabled":true}) {
            return Err(error(
                "RUNTIME_REPLY_INVALID",
                "presence admission requires exactly enabled=true",
            ));
        }
        Ok(())
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

    pub(crate) async fn device_context(&self) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "device_context",
                serde_json::json!({}),
                Duration::from_secs(15),
            )
            .await?;
        crate::protocol::device_context_state(&reply.result)?;
        Ok(reply)
    }
    pub(crate) async fn verify_local_startup(&self) -> Result<(), BridgeError> {
        let reply = self
            .request(
                "runtime_verify",
                serde_json::json!({}),
                Duration::from_secs(15),
            )
            .await?;
        crate::protocol::result_error(&reply.result)?;
        if reply.result != serde_json::json!({"verified":true}) {
            return Err(BridgeError::new(
                "STARTUP_DATA_INVALID",
                "runtime verification requires exactly verified=true".into(),
            ));
        }
        Ok(())
    }
    pub(crate) async fn device_recovery_prepare(&self) -> Result<BridgeReply, BridgeError> {
        self.device_recovery_request("device_recovery_prepare", serde_json::json!({}))
            .await
    }
    pub(crate) async fn device_recovery_status(&self) -> Result<BridgeReply, BridgeError> {
        self.device_recovery_request("device_recovery_status", serde_json::json!({}))
            .await
    }
    pub(crate) async fn device_recovery_confirm(
        &self,
        request: crate::protocol::DeviceRecoveryConfirm,
    ) -> Result<BridgeReply, BridgeError> {
        request.validate()?;
        self.device_recovery_request("device_recovery_confirm", serde_json::json!(request))
            .await
    }
    async fn device_recovery_request(
        &self,
        method: &'static str,
        params: Value,
    ) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(method, params, Duration::from_secs(15))
            .await?;
        crate::protocol::device_recovery(&reply.result)?;
        Ok(reply)
    }
    pub async fn device_status(&self) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "device_status",
                serde_json::json!({}),
                Duration::from_secs(15),
            )
            .await?;
        if reply.result.get("error").is_none() {
            crate::protocol::validate_device_recovery(&reply.result)?;
        }
        Ok(reply)
    }
    pub async fn device_begin(
        &self,
        hive: String,
        name: String,
    ) -> Result<BridgeReply, BridgeError> {
        let reply = self
            .request(
                "device_begin",
                serde_json::json!({"hive":hive,"name":name}),
                Duration::from_secs(15),
            )
            .await?;
        if reply.result.get("error").is_none() {
            crate::protocol::validate_device_recovery(&reply.result)?;
        }
        Ok(reply)
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

    pub(crate) fn freeze_for_exit(&self) {
        self.0.frozen.store(true, Ordering::SeqCst);
        self.0.wake.notify_one();
    }

    async fn request_inner(
        &self,
        method: &'static str,
        params: Value,
        duration: Duration,
        exit_request: bool,
    ) -> Result<BridgeReply, BridgeError> {
        // S2 must read the owned device/runtime and apply its saved network before
        // S3 can ask S1 to restore. The configure method has no WebView command.
        // Keep the ordinary frozen/queued-exit checks for every one of these calls.
        let startup_network = matches!(
            method,
            "device_status"
                | "device_context"
                | "device_recovery_prepare"
                | "device_recovery_confirm"
                | "device_recovery_status"
                | "runtime_verify"
                | "runtime_snapshot"
                | "runtime_restore"
                | "network_status"
                | "runtime_configure_network"
        ) || (method == "runtime_stop"
            && params["reason"] == "network_change");
        if !self.0.startup_verified.load(Ordering::SeqCst) && !exit_request && !startup_network {
            return Err(error("STARTUP_VERIFICATION_PENDING", "request rejected: startup package/data/runtime verification has not succeeded; contribution remains blocked"));
        }
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
        let queued_at = Instant::now();
        let deadline = queued_at + duration.min(Duration::from_secs(15));
        let (reply, receive) = oneshot::channel();
        let phase = Arc::new(StdMutex::new(RequestPhase::Queued));
        let _guard = CancelUnsent(phase.clone(), self.0.wake.clone());
        let permit = if exit_request {
            // Frozen ordinary waiters still own permits until the supervisor
            // rejects them. Await that reclamation within this request's
            // existing deadline instead of bypassing or growing the budget.
            self.0.wake.notify_one();
            timeout_at(deadline, self.0.capacity.clone().acquire_owned())
                .await
                .map_err(|_| error("REQUEST_QUEUE_TIMEOUT", format!("{method} expired awaiting outstanding request capacity; no bytes sent; maximum=16")))?
                .map_err(|_| error("REQUEST_NOT_QUEUED", format!("{method} rejected: outstanding request admission is closed")))?
        } else {
            self.0.capacity.clone().try_acquire_owned().map_err(|_| error("REQUEST_NOT_QUEUED",format!("{method} rejected: outstanding request budget exhausted; maximum=16 including queued and in-flight requests")))?
        };
        self.0
            .requests
            .try_send(Request {
                exit_request,
                method,
                params,
                deadline,
                queued_at,
                started_at: None,
                duration,
                timed_out: false,
                phase: phase.clone(),
                _permit: permit,
                reply: Some(reply),
            })
            .map_err(|cause| {
                error(
                    "REQUEST_NOT_QUEUED",
                    format!("ping queue rejected request: {cause}; capacity=16"),
                )
            })?;
        // The session owns both clocks and the sender. Dropping this future only
        // cancels a request which has not emitted its first byte.
        let response = receive.await;
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
    wake: &Notify,
    tracker: &RequestTracker,
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
            capabilities: hello.capabilities,
        }),
        None,
    ));
    let mut counter = 1u64;
    let mut waiting = VecDeque::<Request>::new();
    let mut active = HashMap::<String, Request>::new();
    let mut writing: Option<Outgoing> = None;
    let result = async {
        loop {
            if let Some(cause) = statuses.borrow().error.clone() {
                return Err(cause);
            }
            let now = Instant::now();
            let mut retained = VecDeque::new();
            while let Some(mut request) = waiting.pop_front() {
                if let Some(cause) = unsent_rejection(&request, frozen, now) {
                    request.respond(Err(cause));
                } else {
                    retained.push_back(request);
                }
            }
            waiting = retained;
            let mut expired = Vec::new();
            for (id, request) in &mut active {
                let phase = *request.phase.lock().unwrap();
                if phase != RequestPhase::Sent {
                    if let Some(cause) = unsent_rejection(request, frozen, now) {
                        expired.push((id.clone(), cause));
                    }
                } else if !request.timed_out && now >= request.expires_at() {
                    let fully_sent = !writing.as_ref().is_some_and(|frame| frame.id == *id);
                    let cause = timeout_error(request, id, fully_sent, now);
                    request.timed_out = true;
                    if let Some(details) = &cause.details {
                        let _ = tracker.diagnostics.send(serde_json::json!({"time":details.observed_at,
                            "level":"warning", "module":"bridge", "platform":request_platform(request),
                            "code":"request_timed_out", "evidence":details.evidence}));
                    }
                    tracker.pending.lock().unwrap().insert(id.clone(), request.pending(id));
                    request.respond(Err(cause));
                }
            }
            for (id, cause) in expired {
                if writing.as_ref().is_some_and(|w| w.id == id) {
                    writing = None;
                }
                if let Some(mut request) = active.remove(&id) {
                    request.respond(Err(cause));
                }
            }
            if writing.is_none() {
                let mut selected = None;
                for (index, request) in waiting.iter().enumerate() {
                    let lane = read_platform(request);
                    if lane.is_none() {
                        if index == 0 && active.is_empty() {
                            selected = Some(index);
                        }
                        break;
                    }
                    if active.values().all(|current| {
                        read_platform(current).is_some() && read_platform(current) != lane
                    }) {
                        selected = Some(index);
                        break;
                    }
                }
                if let Some(index) = selected {
                    let request = waiting.remove(index).unwrap();
                    counter = counter.checked_add(1).ok_or_else(|| {
                        error(
                            "REQUEST_ID_EXHAUSTED",
                            "shell request counter reached u64 maximum",
                        )
                    })?;
                    let id = format!("shell-{counter}");
                    let mut bytes = serde_json::to_vec(&serde_json::json!({
                        "protocol": 1, "id": id, "method": request.method, "params": request.params
                    })).map_err(|cause| error(
                        "REQUEST_ENCODING_FAILED",
                        format!("encode {} request: {cause}", request.method),
                    ))?;
                    bytes.push(b'\n');
                    writing = Some(Outgoing {
                        id: id.clone(),
                        bytes,
                        written: 0,
                    });
                    active.insert(id, request);
                }
            }
            let deadline = waiting
                .iter()
                .chain(active.values())
                .filter(|r| !r.timed_out)
                .map(Request::expires_at)
                .min();
            tokio::select! {
                biased;
                _ = stopped(stop) => return Ok(()),
                _ = wake.notified() => {},
                result = child.wait() => return Err(error("CHILD_EXITED", match result {
                    Ok(exit) => format!("owned Bee exited while bridge was ready: status={exit}"),
                    Err(cause) => format!("wait for owned Bee failed: {cause}"),
                })),
                _ = async {
                    if let Some(at) = deadline {
                        tokio::time::sleep_until(at).await
                    } else {
                        std::future::pending::<()>().await
                    }
                } => {},
                result = async {
                    let frame = writing.as_mut().unwrap();
                    let request = active.get(&frame.id).unwrap();
                    write_step(stdin, frame, &request.phase, request.deadline, frozen, !request.exit_request).await
                }, if writing.is_some() => {
                    let complete = result?;
                    let frame = writing.as_ref().unwrap();
                    if frame.written > 0 {
                        active.get_mut(&frame.id).unwrap().started_at.get_or_insert_with(Instant::now);
                    }
                    if complete { writing = None; }
                },
                result = replies.next() => {
                    let frame = result?;
                    let request = active.get(&frame.id).ok_or_else(|| error(
                        "UNEXPECTED_REPLY",
                        format!("owned Bee reply has no unfinished request; id bytes={}; active requests={}", frame.id.len(), active.len()),
                    ))?;
                    if *request.phase.lock().unwrap() != RequestPhase::Sent || writing.as_ref().is_some_and(|w| w.id == frame.id) {
                        return Err(error("UNEXPECTED_REPLY","owned Bee replied before its complete request frame was written"));
                    }
                    let id = frame.id.clone();
                    // Instance integrity is mandatory even for valid business failures.
                    if frame.instance != instance {
                        return Err(error("INSTANCE_MISMATCH", format!("reply instance differs from owned child; actual bytes={}; required instance bytes={}; comparison=different", frame.instance.len(), instance.len())));
                    }
                    let result = frame.success(&id, Some(&instance));
                    if request.method == "ping" && result.as_ref().is_ok_and(|v| *v != serde_json::json!({"alive":true})) {
                        return Err(error("INVALID_PING", "ping result differs from required alive=true object"));
                    }
                    if let Ok(value) = &result { validate_method_result(request, value, &instance)?; }
                    if let Some(cause) = statuses.borrow().error.clone() { return Err(cause); }
                    let mut request = active.remove(&id).unwrap();
                    request.respond(result.map(|result| BridgeReply { protocol: 1, id: id.clone(), instance: instance.clone(), result }));
                    if request.timed_out {
                        tracker.pending.lock().unwrap().remove(&id);
                        let mut details = timeout_error(&request, &id, true, Instant::now()).details.expect("request evidence");
                        details.evidence.insert("in_flight".into(), "false".into());
                        let _ = tracker.diagnostics.send(serde_json::json!({"time":details.observed_at,
                            "level":"info", "module":"bridge", "platform":request_platform(&request),
                            "code":"request_settled", "evidence":details.evidence}));
                        let _ = tracker.settled.send(RequestSettled { instance: instance.clone(), id,
                            method: request.method.into(), platform: request_platform(&request) });
                    }
                },
                request = requests.recv() => {
                    match request {
                        Some(request) => waiting.push_back(request),
                        None => return Ok(()),
                    }
                },
            }
        }
    }.await;
    let cause = result.as_ref().err().cloned().unwrap_or_else(|| {
        error(
            "BRIDGE_STOPPED",
            "owned Bee session stopped; sent request result is unconfirmed",
        )
    });
    tracker.pending.lock().unwrap().clear();
    for mut request in waiting.into_iter().chain(active.into_values()) {
        let sent = *request.phase.lock().unwrap() == RequestPhase::Sent;
        let failure = if sent {
            cause.clone()
        } else {
            request_not_sent(request.method, &cause)
        };
        request.respond(Err(failure));
    }
    result
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
    wake: Arc<Notify>,
    tracker: Arc<RequestTracker>,
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
        let diagnostic_events = tracker.diagnostics.clone();
        let mut diagnostics = tokio::spawn(async move {
            crate::diagnostics::drain_with_events(&mut stderr, diagnostic_events).await
        });
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
            &wake,
            &tracker,
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
                    "; management stderr bytes={}, retained={}, truncated={}",
                    diagnostic.bytes,
                    diagnostic.tail.len(),
                    diagnostic.bytes > diagnostic.tail.len() as u64
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
    while let Some(mut request) = requests.recv().await {
        let cause = run
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| error("BRIDGE_STOPPED", "owned Bee stopped"));
        request.respond(Err(request_not_sent(request.method, &cause)));
    }
    // A protocol failure is reported through status; stop reports cleanup/join
    // errors independently instead of treating a failed handshake as failed quit.
    cleanup_failure.map_or(Ok(()), Err)
}

#[cfg(test)]
#[path = "sidecar_tests.rs"]
pub(crate) mod tests;
