use std::{
    fs::{File, OpenOptions},
    io,
    path::Path,
};

pub(crate) fn lock_registration(path: &Path) -> io::Result<File> {
    use std::{
        os::unix::fs::{MetadataExt, OpenOptionsExt},
        time::{Duration, Instant},
    };
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|cause| {
            io::Error::new(
                cause.kind(),
                format!(
                    "open singleton registration gate {}: {cause}",
                    path.display()
                ),
            )
        })?;
    let meta = file.metadata()?;
    let uid = unsafe { libc::geteuid() };
    if !meta.is_file() || meta.nlink() != 1 || meta.uid() != uid || meta.mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "singleton registration gate rejected: regular={}, links={}, owner={}, current_uid={uid}, mode={:o}; required regular private single-link file owned by current user",
                meta.is_file(),
                meta.nlink(),
                meta.uid(),
                meta.mode() & 0o777
            ),
        ));
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "singleton registration gate remained locked for 10000ms; application setup refused",
                ));
            }
            Err(std::fs::TryLockError::Error(cause)) => {
                return Err(io::Error::new(
                    cause.kind(),
                    format!(
                        "lock singleton registration gate {}: {cause}",
                        path.display()
                    ),
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn location(case: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "bee-registration-{case}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn registration_gate_holds_an_exclusive_os_lock_until_registration_finishes() {
        let path = location("held");
        let owner = lock_registration(&path).unwrap();
        let competitor = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        assert!(
            competitor.try_lock().is_err(),
            "another startup entered the registration critical section"
        );
        drop(owner);
        competitor
            .try_lock()
            .expect("startup gate must release even after a registration error");
        drop(competitor);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn registration_gate_refuses_symlink_and_public_lock_file() {
        let target = location("target");
        let path = location("symlink");
        std::fs::write(&target, b"unchanged").unwrap();
        symlink(&target, &path).unwrap();
        assert!(
            lock_registration(&path).is_err(),
            "registration gate followed a symlink"
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, b"").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(
            lock_registration(&path).is_err(),
            "registration gate accepted a public lock file"
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"unchanged");
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(target).unwrap();
    }
}
