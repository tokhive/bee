//! Where the background service's log goes. A packaged app is started from the
//! desktop with nowhere for its output to show, so the app keeps Bee's output
//! in a file the person can open and send along with a diagnostic report.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// The log is rotated once at this size: the old one is kept as bee.log.1.
const ROTATE_AT: u64 = 5 * 1024 * 1024;

/// The folder for logs: ~/Library/Logs/ai.tokhive.bee on macOS, the user's
/// state (or local data) directory elsewhere. BEE_DESKTOP_DATA, which keeps a
/// development run out of the installed app's files, puts them under it.
pub fn dir() -> PathBuf {
    if let Some(data) = std::env::var_os("BEE_DESKTOP_DATA") {
        return PathBuf::from(data).join("logs");
    }
    if cfg!(target_os = "macos") {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join("Library").join("Logs").join("ai.tokhive.bee");
    }
    dirs::state_dir().or_else(dirs::data_local_dir).unwrap_or_else(|| PathBuf::from(".")).join("ai.tokhive.bee").join("logs")
}

/// Opens bee.log in dir for appending, creating the folder and rotating a
/// log that has grown large.
pub fn open(dir: &Path) -> io::Result<File> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join("bee.log");
    if std::fs::metadata(&path).map(|m| m.len() >= ROTATE_AT).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("bee.log.1"));
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bee-logs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn appends_and_creates_the_folder() {
        let dir = scratch("append").join("nested");
        writeln!(open(&dir).unwrap(), "first").unwrap();
        writeln!(open(&dir).unwrap(), "second").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("bee.log")).unwrap(), "first\nsecond\n");
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn rotates_a_large_log_once() {
        let dir = scratch("rotate");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bee.log"), vec![b'x'; ROTATE_AT as usize]).unwrap();
        writeln!(open(&dir).unwrap(), "fresh").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("bee.log")).unwrap(), "fresh\n");
        assert_eq!(std::fs::metadata(dir.join("bee.log.1")).unwrap().len(), ROTATE_AT);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_log_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("private");
        open(&dir).unwrap();
        assert_eq!(std::fs::metadata(dir.join("bee.log")).unwrap().permissions().mode() & 0o777, 0o600);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
