// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT
// Bee modifications: serialize election, bind synchronously, acknowledge delivery,
// and fail closed before application/sidecar setup. See BEE-PATCH.md.

use crate::SingleInstanceCallback;
#[cfg(feature = "semver")]
use crate::semver_compat::semver_compat_string;
use std::{
    io::{BufWriter, Error, ErrorKind, Read, Write},
    net::Shutdown,
    os::unix::net::UnixStream,
    path::PathBuf,
    time::Duration,
};
use tauri::{
    AppHandle, Config, Manager, Runtime,
    plugin::{self, TauriPlugin},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[path = "startup_lock.rs"]
mod startup_lock;
struct PrimarySocket {
    path: PathBuf,
    // Held until App state is dropped, including listener failure and child reap.
    _lease: std::fs::File,
}
const FORWARD_LIMIT: u64 = 64 * 1024;
const FORWARD_TIMEOUT: Duration = Duration::from_secs(2);
const ACK: u8 = 6;

pub fn init<R: Runtime>(cb: Box<SingleInstanceCallback<R>>) -> TauriPlugin<R> {
    plugin::Builder::new("single-instance")
        .setup(|app, _api| {
            let socket = socket_path(app.config(), app.package_info());
            // No competitor may remove/replace the socket between notification
            // and bind. The OS releases this gate even if the process crashes.
            let _registration =
                startup_lock::lock_registration(&socket.with_extension("startup.lock"))?;
            match notify_singleton(&socket) {
                Ok(()) => std::process::exit(0),
                Err(cause)
                    if matches!(
                        cause.kind(),
                        ErrorKind::NotFound | ErrorKind::ConnectionRefused
                    ) =>
                {
                    let lease =
                        startup_lock::lock_registration(&socket.with_extension("primary.lock"))?;
                    remove_stale_socket(&socket)?;
                    listen_for_other_instances(&socket, app.clone(), cb)?;
                    app.manage(PrimarySocket {
                        path: socket,
                        _lease: lease,
                    });
                }
                Err(cause) => {
                    return Err(format!(
                        "singleton notification failed before application setup: {cause}"
                    )
                    .into());
                }
            }
            Ok(())
        })
        .build()
}

pub fn destroy<R: Runtime, M: Manager<R>>(manager: &M) {
    if let Some(primary) = manager.try_state::<PrimarySocket>() {
        let _ = std::fs::remove_file(&primary.path);
    }
}

fn socket_path(config: &Config, _package_info: &tauri::PackageInfo) -> PathBuf {
    let identifier = config.identifier.replace(['.', '-'].as_ref(), "_");
    #[cfg(feature = "semver")]
    let identifier = format!(
        "{identifier}_{}",
        semver_compat_string(&_package_info.version)
    );
    let uid = unsafe { libc::geteuid() };
    PathBuf::from(format!("/tmp/{identifier}_{uid}_si.sock"))
}

fn remove_stale_socket(socket: &PathBuf) -> Result<(), Error> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    match std::fs::symlink_metadata(socket) {
        Err(cause) if cause.kind() == ErrorKind::NotFound => Ok(()),
        Err(cause) => Err(cause),
        Ok(meta) if meta.file_type().is_socket() && meta.uid() == unsafe { libc::geteuid() } => {
            std::fs::remove_file(socket)
        }
        Ok(meta) => Err(Error::new(
            ErrorKind::PermissionDenied,
            format!(
                "stale singleton endpoint rejected: socket={}, owner={}; required socket owned by current user",
                meta.file_type().is_socket(),
                meta.uid()
            ),
        )),
    }
}

fn notify_singleton(socket: &PathBuf) -> Result<(), Error> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    let meta = std::fs::symlink_metadata(socket)?;
    let current_uid = unsafe { libc::geteuid() };
    if !meta.file_type().is_socket() || meta.uid() != current_uid || meta.mode() & 0o077 != 0 {
        return Err(Error::new(
            ErrorKind::PermissionDenied,
            format!(
                "singleton endpoint rejected before forwarding: socket={}, owner={}, current_uid={current_uid}, mode={:o}; required current-user private socket",
                meta.file_type().is_socket(),
                meta.uid(),
                meta.mode() & 0o777
            ),
        ));
    }
    let mut stream = UnixStream::connect(socket)?;
    stream.set_read_timeout(Some(FORWARD_TIMEOUT))?;
    stream.set_write_timeout(Some(FORWARD_TIMEOUT))?;
    let cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let args_joined = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("\0");
    let size = cwd.len() + 2 + args_joined.len();
    if size as u64 > FORWARD_LIMIT {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            format!("singleton forwarding payload size={size}; limit={FORWARD_LIMIT} bytes"),
        ));
    }
    {
        let mut writer = BufWriter::new(&stream);
        writer.write_all(cwd.as_bytes())?;
        writer.write_all(b"\0\0")?;
        writer.write_all(args_joined.as_bytes())?;
        writer.flush()?;
    }
    stream.shutdown(Shutdown::Write)?;
    let mut ack = [0];
    stream.read_exact(&mut ack)?;
    if ack[0] != ACK {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!(
                "singleton delivery acknowledgement={}; required={ACK}",
                ack[0]
            ),
        ));
    }
    Ok(())
}

fn listen_for_other_instances<A: Runtime>(
    socket: &PathBuf,
    app: AppHandle<A>,
    mut cb: Box<SingleInstanceCallback<A>>,
) -> Result<(), Error> {
    use std::os::unix::fs::PermissionsExt;
    // Complete the actual bind before releasing the registration gate.
    let listener = tauri::async_runtime::block_on(async { tokio::net::UnixListener::bind(socket) })
        .map_err(|cause| {
            Error::new(
                cause.kind(),
                format!(
                    "bind singleton endpoint {} before application setup: {cause}",
                    socket.display()
                ),
            )
        })?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
    tauri::async_runtime::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((mut stream, _)) => {
                    let mut payload = String::new();
                    let result = tokio::time::timeout(
                        FORWARD_TIMEOUT,
                        (&mut stream)
                            .take(FORWARD_LIMIT + 1)
                            .read_to_string(&mut payload),
                    )
                    .await;
                    match result {
                        Err(cause) => {
                            tracing::warn!(
                                "singleton forwarding read exceeded 2000ms: {cause}; complete bytes={}",
                                payload.len()
                            );
                            continue;
                        }
                        Ok(Err(cause)) => {
                            tracing::warn!(
                                "singleton forwarding UTF-8/read failed: {cause}; complete UTF-8 bytes={}",
                                payload.len()
                            );
                            continue;
                        }
                        Ok(Ok(size)) if size as u64 > FORWARD_LIMIT => {
                            tracing::warn!(
                                "singleton forwarding size={size}; limit={FORWARD_LIMIT} bytes"
                            );
                            continue;
                        }
                        Ok(Ok(_)) => {}
                    }
                    let Some((cwd, args)) = payload.split_once("\0\0") else {
                        continue;
                    };
                    cb(
                        app.app_handle(),
                        args.split('\0').map(String::from).collect(),
                        cwd.to_string(),
                    );
                    match tokio::time::timeout(FORWARD_TIMEOUT, stream.write_all(&[ACK])).await {
                        Ok(Ok(())) => {}
                        Ok(Err(cause)) => tracing::warn!(
                            "singleton delivery acknowledged locally but ACK write failed: {cause}"
                        ),
                        Err(cause) => tracing::warn!(
                            "singleton delivery acknowledged locally but ACK write exceeded 2000ms: {cause}"
                        ),
                    }
                }
                Err(cause) => {
                    tracing::error!("singleton endpoint accept failed: {cause}");
                    break;
                }
            }
        }
    });
    Ok(())
}
