//! A Bee that holds the device configuration but cannot be reached.
//!
//! Every Bee takes an exclusive lock on `<configuration>.lock`. When no Bee
//! answers the control socket and that lock is held anyway, the holder is one
//! that serves no control interface, an older command-line Bee, and the app's
//! own Bee cannot start until it is stopped.

use serde::Serialize;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Occupied {
    /// The process holding the lock, when it could be found.
    pub pid: Option<u32>,
}

/// Whether another process holds the lock beside the device configuration.
#[cfg(unix)]
pub fn holder(config: &Path) -> Option<Occupied> {
    use nix::fcntl::{Flock, FlockArg};
    let mut lock = config.as_os_str().to_owned();
    lock.push(".lock");
    // Only look: a missing lock file means no Bee has run here, and nothing
    // is created.
    let file = std::fs::OpenOptions::new().read(true).write(true).open(&lock).ok()?;
    match Flock::lock(file, FlockArg::LockExclusiveNonblock) {
        Ok(_free) => None,
        Err(_) => Some(Occupied { pid: process_holding(Path::new(&lock)) }),
    }
}

#[cfg(not(unix))]
pub fn holder(_config: &Path) -> Option<Occupied> {
    None
}

/// The process that has the file open, from lsof, which macOS and most Linux
/// desktops have. This app's own process is never the answer.
#[cfg(unix)]
fn process_holding(path: &Path) -> Option<u32> {
    let out = std::process::Command::new("lsof").arg("-t").arg("--").arg(path).output().ok()?;
    let me = std::process::id();
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.trim().parse::<u32>().ok()).find(|pid| *pid != me)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use nix::fcntl::{Flock, FlockArg};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("bee-occupied-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn no_lock_file_is_nobody_and_creates_nothing() {
        let dir = scratch("none");
        assert_eq!(holder(&dir.join("bee.json")), None);
        assert!(!dir.join("bee.json.lock").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_free_lock_is_nobody_and_a_held_one_is_somebody() {
        let dir = scratch("held");
        let lock = dir.join("bee.json.lock");
        std::fs::write(&lock, b"").unwrap();
        assert_eq!(holder(&dir.join("bee.json")), None);

        let file = std::fs::OpenOptions::new().read(true).write(true).open(&lock).unwrap();
        let held = Flock::lock(file, FlockArg::LockExclusiveNonblock).map_err(|e| e.1).unwrap();
        // This test process holds it, and the answer never names the app's
        // own process.
        assert_eq!(holder(&dir.join("bee.json")), Some(Occupied { pid: None }));
        drop(held);
        assert_eq!(holder(&dir.join("bee.json")), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
