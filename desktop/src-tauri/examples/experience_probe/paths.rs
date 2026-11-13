use std::{
    ffi::OsStr,
    io,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn prepare_root(requested: Option<&OsStr>, cache: &Path) -> io::Result<PathBuf> {
    let root = requested.map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from("/private/tmp").join(format!(
            "bee-s2-experience-probe-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    });
    let private_tmp = root.parent() == Some(Path::new("/private/tmp"))
        && root.file_name().is_some_and(|name| {
            name.to_string_lossy()
                .starts_with("bee-s2-experience-probe-")
        });
    if !root.is_absolute()
        || root
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        || !(root.starts_with(cache) || private_tmp)
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,format!("probe state path rejected: absolute={} private_tmp={} inside_task_cache={}; required=dedicated private temporary directory or task probe cache, no traversal",root.is_absolute(),private_tmp,root.starts_with(cache))));
    }
    for path in root.ancestors() {
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "probe state path has symlink component; no files created",
                ))
            }
            Ok(meta) if !meta.is_dir() => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "probe state path has non-directory component; no files created",
                ))
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    std::fs::create_dir_all(&root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    fn base() -> PathBuf {
        std::env::temp_dir().canonicalize().unwrap().join(format!(
            "bee-s2-probe-path-tests-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn permits_only_explicit_probe_cache_and_private_tmp_roots() {
        let cache = base();
        let selected = cache.join("state");
        assert_eq!(
            prepare_root(Some(selected.as_os_str()), &cache).unwrap(),
            selected
        );
        let selected = Path::new("/private/tmp").join(format!(
            "bee-s2-experience-probe-path-test-{}",
            std::process::id()
        ));
        assert_eq!(
            prepare_root(Some(selected.as_os_str()), &cache).unwrap(),
            selected
        );
        std::fs::remove_dir_all(selected).unwrap();
        std::fs::remove_dir_all(cache).unwrap();
    }
    #[test]
    fn rejects_home_configuration_relative_roots_and_parent_traversal_before_creation() {
        let cache = base();
        for path in [
            PathBuf::from("relative"),
            PathBuf::from("/Users/probe/Library/Application Support/tokhive"),
            cache.join("state/../../outside"),
            PathBuf::from("/private/tmp"),
            PathBuf::from("/private/tmp/ordinary-directory"),
        ] {
            assert!(
                prepare_root(Some(path.as_os_str()), &cache).is_err(),
                "unsafe probe path accepted: {path:?}"
            );
        }
        assert!(!cache.exists());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_existing_symlink_components_without_writing_target() {
        let cache = base();
        let outside = base();
        std::fs::create_dir(&cache).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, cache.join("linked")).unwrap();
        assert!(prepare_root(Some(cache.join("linked/state").as_os_str()), &cache).is_err());
        assert!(!outside.join("state").exists());
        std::fs::remove_dir_all(cache).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }
}
