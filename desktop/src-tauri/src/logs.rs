//! Where the background service's log goes. A packaged app is started from the
//! desktop with nowhere for its output to show, so the app keeps Bee's output
//! in a file the person can open and send along with a diagnostic report.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom};
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

/// How much of a log file the window's log page reads from its end.
const TAIL_BYTES: u64 = 1024 * 1024;

/// The last lines of a file, oldest first. A line cut by where reading began
/// is left out; a missing file has no lines.
fn file_tail(path: &Path, max: usize) -> Vec<String> {
    let Ok(mut file) = File::open(path) else { return Vec::new() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(TAIL_BYTES);
    let mut raw = Vec::new();
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_to_end(&mut raw).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&raw);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    let from = lines.len().saturating_sub(max);
    lines[from..].iter().map(|line| line.to_string()).collect()
}

/// The last `max` lines of bee.log in dir, reaching back into the rotated
/// bee.log.1 when the current log is shorter.
pub fn tail(dir: &Path, max: usize) -> Vec<String> {
    let mut lines = file_tail(&dir.join("bee.log"), max);
    if lines.len() < max {
        let mut older = file_tail(&dir.join("bee.log.1"), max - lines.len());
        older.append(&mut lines);
        lines = older;
    }
    lines
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

    #[test]
    fn tail_reads_the_last_lines_and_reaches_into_the_rotated_log() {
        let dir = scratch("tail");
        assert!(tail(&dir, 5).is_empty());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bee.log.1"), "old 1\nold 2\nold 3\n").unwrap();
        std::fs::write(dir.join("bee.log"), "new 1\nnew 2\n").unwrap();
        assert_eq!(tail(&dir, 1), vec!["new 2"]);
        assert_eq!(tail(&dir, 4), vec!["old 2", "old 3", "new 1", "new 2"]);
        assert_eq!(tail(&dir, 10).len(), 5);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn tail_of_a_large_log_drops_the_cut_line() {
        let dir = scratch("tail-large");
        std::fs::create_dir_all(&dir).unwrap();
        let line = "x".repeat(99);
        let body: String = (0..20_000).map(|i| format!("{i:05} {line}\n")).collect();
        std::fs::write(dir.join("bee.log"), &body).unwrap();
        let lines = tail(&dir, 100_000);
        assert!(lines.len() < 20_000 && lines.iter().all(|l| l.len() == 105));
        assert_eq!(lines.last().unwrap(), &format!("19999 {line}"));
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
