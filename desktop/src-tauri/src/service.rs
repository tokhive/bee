//! Keeps a Bee background service running for the app.
//!
//! If a Bee already serves the control socket (one started from the command
//! line or by a system service), the app uses it and never stops it. Otherwise
//! the app starts its bundled `bee run --desktop`, restarts it with backoff
//! when it exits, and stops it gracefully when the app quits: it asks first
//! (SIGTERM) so Bee can tell Hive and finish its requests, and only kills it
//! when that takes too long.

use crate::control::Control;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::process::{Child, Command};
use tokio::sync::Notify;

/// How the background service is running, as the app reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceState {
    /// Waiting for Bee to answer.
    Starting,
    /// The app's own Bee answers.
    Running,
    /// A Bee the app did not start answers; quitting the app leaves it.
    External,
    /// No Bee answers and the app's own one could not be started.
    Stopped,
}

pub struct Service {
    pub config: PathBuf,
    pub control: Control,
    bee: PathBuf,
    /// Never start the bundled Bee; only use one that is already running.
    attach_only: bool,
    /// Where Bee's output goes; inherited when None.
    log_dir: Option<PathBuf>,
    child: Mutex<Option<u32>>,
    quitting: AtomicBool,
    stopped: Notify,
    state: Mutex<ServiceState>,
    changed: Notify,
    /// Cuts a restart's backoff short when the person asks to try again.
    retry: Notify,
}

/// How long a stopping Bee may take before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(15);

impl Service {
    pub fn new(config: PathBuf, bee: PathBuf, attach_only: bool) -> Self {
        let socket = config.parent().unwrap_or(Path::new(".")).join("control").join("bee.sock");
        Self {
            config,
            control: Control::new(socket),
            bee,
            attach_only,
            log_dir: None,
            child: Mutex::new(None),
            quitting: AtomicBool::new(false),
            stopped: Notify::new(),
            state: Mutex::new(ServiceState::Starting),
            changed: Notify::new(),
            retry: Notify::new(),
        }
    }

    /// Keeps the output of the Bee this service starts in dir.
    pub fn with_log_dir(mut self, dir: PathBuf) -> Self {
        self.log_dir = Some(dir);
        self
    }

    pub fn state(&self) -> ServiceState {
        *self.state.lock().unwrap()
    }

    /// Resolves when the service state may have changed.
    pub async fn changed(&self) {
        self.changed.notified().await
    }

    fn set_state(&self, state: ServiceState) {
        let mut current = self.state.lock().unwrap();
        if *current != state {
            eprintln!("[bee-desktop] service {:?} -> {:?}", *current, state);
            *current = state;
            drop(current);
            self.changed.notify_waiters();
        }
    }

    /// Tries again now instead of after the backoff.
    pub fn retry(&self) {
        self.retry.notify_one();
    }

    /// Waits for the backoff to pass, or for a retry; a retry starts the
    /// backoff over.
    async fn back_off(&self, delay: &mut Duration) {
        tokio::select! {
            _ = tokio::time::sleep(*delay) => *delay = (*delay * 2).min(Duration::from_secs(30)),
            _ = self.retry.notified() => *delay = Duration::from_secs(1),
        }
    }

    async fn answers(&self) -> bool {
        self.control.get("/v1/overview").await.is_ok()
    }

    /// Runs until the app quits.
    pub async fn run(&self) {
        let mut delay = Duration::from_secs(1);
        while !self.quitting.load(Ordering::SeqCst) {
            if self.answers().await {
                // Someone else's Bee; watch it until it goes away.
                self.set_state(ServiceState::External);
                while !self.quitting.load(Ordering::SeqCst) && self.answers().await {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
                continue;
            }
            if self.attach_only {
                self.set_state(ServiceState::Stopped);
                let mut wait = Duration::from_secs(1);
                self.back_off(&mut wait).await;
                continue;
            }
            self.set_state(ServiceState::Starting);
            let mut child = match self.spawn() {
                Ok(child) => child,
                Err(err) => {
                    eprintln!("[bee-desktop] cannot start bee: {err}");
                    self.set_state(ServiceState::Stopped);
                    self.back_off(&mut delay).await;
                    continue;
                }
            };
            let started = Instant::now();
            let ready = self.wait_ready(&mut child).await;
            if ready {
                self.set_state(ServiceState::Running);
            }
            let status = child.wait().await;
            *self.child.lock().unwrap() = None;
            if self.quitting.load(Ordering::SeqCst) {
                break;
            }
            eprintln!("[bee-desktop] bee exited: {status:?}");
            self.set_state(ServiceState::Stopped);
            if started.elapsed() > Duration::from_secs(60) {
                delay = Duration::from_secs(1);
            }
            self.back_off(&mut delay).await;
        }
        self.stopped.notify_waiters();
    }

    fn spawn(&self) -> std::io::Result<Child> {
        // Bee gets a pipe on its standard input that this app holds open for as
        // long as the child lives (it stays in `Child`). When the app goes
        // away, however it ends, even by being killed, the system closes the
        // pipe and Bee stops itself rather than running on with no app.
        let mut command = Command::new(&self.bee);
        command.args(["run", "--desktop", "--stop-with-parent", "--config"]).arg(&self.config).stdin(Stdio::piped());
        if let Some(dir) = &self.log_dir {
            match crate::logs::open(dir).and_then(|file| Ok((file.try_clone()?, file))) {
                Ok((out, err)) => {
                    command.stdout(Stdio::from(out)).stderr(Stdio::from(err));
                }
                Err(err) => eprintln!("[bee-desktop] cannot keep bee's log in {}: {err}", dir.display()),
            }
        }
        let child = command
            .kill_on_drop(false)
            .spawn()?;
        *self.child.lock().unwrap() = child.id();
        eprintln!("[bee-desktop] started bee pid={:?}", child.id());
        Ok(child)
    }

    /// Waits for the new Bee's socket to answer, or for it to exit.
    async fn wait_ready(&self, child: &mut Child) -> bool {
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return false;
            }
            if self.answers().await {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        false
    }

    /// True when quitting the app would stop sharing.
    pub fn owns_bee(&self) -> bool {
        self.child.lock().unwrap().is_some()
    }

    /// Stops the app's own Bee, if any, and returns once it has exited.
    pub async fn stop(&self) {
        self.quitting.store(true, Ordering::SeqCst);
        let pid = *self.child.lock().unwrap();
        let Some(pid) = pid else { return };
        let stopped = self.stopped.notified();
        terminate(pid);
        if tokio::time::timeout(STOP_GRACE, stopped).await.is_err() {
            eprintln!("[bee-desktop] bee did not stop within {STOP_GRACE:?}; killing it");
            kill(pid);
        }
    }
}

#[cfg(unix)]
fn terminate(pid: u32) {
    use nix::sys::signal::{kill as send, Signal};
    use nix::unistd::Pid;
    let _ = send(Pid::from_raw(pid as i32), Signal::SIGTERM);
}

#[cfg(unix)]
fn kill(pid: u32) {
    use nix::sys::signal::{kill as send, Signal};
    use nix::unistd::Pid;
    let _ = send(Pid::from_raw(pid as i32), Signal::SIGKILL);
}

#[cfg(not(unix))]
fn terminate(_pid: u32) {}

#[cfg(not(unix))]
fn kill(_pid: u32) {}
