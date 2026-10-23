use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuildSource {
    pub revision: String,
    pub tee_revision: String,
    pub target: String,
    pub goos: String,
    pub goarch: String,
    pub go: String,
    pub bee_version: String,
    pub binary_sha256: String,
}

impl BuildSource {
    pub fn verify_runtime_binary(&self, path: &Path, bundle: Option<&Path>) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        if let Some(bundle) = bundle {
            let expected = bundle.join("Contents/MacOS/bee");
            if path != expected || bundle.extension() != Some(std::ffi::OsStr::new("app")) {
                return Err(format!(
                    "signed bundle Bee path mismatch: actual={}; required={}",
                    path.display(),
                    expected.display()
                ));
            }
            // The signed App seals the final sidecar bytes. Signing changes
            // Mach-O bytes, so the pre-sign SHA256 remains build evidence.
            let output = std::process::Command::new("/usr/bin/codesign")
                .args(["--verify", "--deep", "--strict", "--verbose=2"])
                .arg(bundle)
                .output()
                .map_err(|cause| {
                    format!(
                        "run macOS bundle signature verification for {}: {cause}",
                        bundle.display()
                    )
                })?;
            if !output.status.success() {
                return Err(format!("macOS bundle signature verification failed for {}: status={}; stderr={}; stdout={}", bundle.display(), output.status, String::from_utf8_lossy(&output.stderr).trim(), String::from_utf8_lossy(&output.stdout).trim()));
            }
            return Ok(());
        }
        #[cfg(not(target_os = "macos"))]
        if let Some(bundle) = bundle {
            return Err(format!(
                "signed App bundle verification requested on OS={}; bundle={}; required=macos",
                std::env::consts::OS,
                bundle.display()
            ));
        }
        self.verify_binary(path)
    }
    pub fn parse(bytes: &[u8], target: &str, revision: &str, tee: &str) -> Result<Self, String> {
        let source: Self = serde_json::from_slice(bytes).map_err(|error| {
            format!(
                "build source JSON schema failed at line={}, column={}, category={:?}",
                error.line(),
                error.column(),
                error.classify()
            )
        })?;
        let (goos, goarch) = match target {
            "aarch64-apple-darwin" => ("darwin", "arm64"),
            "x86_64-apple-darwin" => ("darwin", "amd64"),
            "x86_64-pc-windows-msvc" => ("windows", "amd64"),
            "x86_64-unknown-linux-gnu" => ("linux", "amd64"),
            "aarch64-unknown-linux-gnu" => ("linux", "arm64"),
            _ => {
                return Err(format!(
                    "Rust target={target}; required=approved Bee desktop target"
                ))
            }
        };
        let go = format!("go version go1.27.3 {goos}/{goarch}");
        for (field, actual, expected) in [
            ("target", source.target.as_str(), target),
            ("revision", source.revision.as_str(), revision),
            ("teeRevision", source.tee_revision.as_str(), tee),
            ("goos", source.goos.as_str(), goos),
            ("goarch", source.goarch.as_str(), goarch),
            ("go", source.go.as_str(), go.as_str()),
        ] {
            if actual != expected {
                return Err(format!(
                    "build source {field} mismatch: actual={actual}; required={expected}"
                ));
            }
        }
        if source.bee_version.is_empty() || source.bee_version.chars().any(char::is_whitespace) {
            return Err(format!("build source beeVersion has bytes={}; required=nonempty version without whitespace", source.bee_version.len()));
        }
        if source.binary_sha256.len() != 64
            || !source
                .binary_sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(format!("build source binarySha256 is malformed; bytes={}; required=64 lowercase hex digits", source.binary_sha256.len()));
        }
        Ok(source)
    }

    pub fn verify_binary(&self, path: &Path) -> Result<(), String> {
        let mut file = std::fs::File::open(path)
            .map_err(|error| format!("open bundled Bee {}: {error}", path.display()))?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer).map_err(|error| {
                format!("read bundled Bee {} for SHA256: {error}", path.display())
            })?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        let actual = format!("{:x}", hash.finalize());
        if actual != self.binary_sha256 {
            return Err(format!(
                "bundled Bee SHA256 mismatch at {}: actual={actual}; required={}",
                path.display(),
                self.binary_sha256
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn metadata() -> serde_json::Value {
        json!({"revision":"a".repeat(40),"teeRevision":"b".repeat(40),"target":"aarch64-apple-darwin","goos":"darwin","goarch":"arm64","go":"go version go1.27.3 darwin/arm64","beeVersion":"dev+fixture","binarySha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"})
    }

    fn parse(value: serde_json::Value) -> Result<BuildSource, String> {
        BuildSource::parse(
            &serde_json::to_vec(&value).unwrap(),
            "aarch64-apple-darwin",
            &"a".repeat(40),
            &"b".repeat(40),
        )
    }

    #[test]
    fn source_must_match_target_commit_tee_and_toolchain() {
        assert_eq!(parse(metadata()).unwrap().bee_version, "dev+fixture");
        for (field, value) in [
            ("revision", "c".repeat(40)),
            ("teeRevision", "c".repeat(40)),
            ("target", "x86_64-apple-darwin".into()),
            ("goos", "windows".into()),
            ("goarch", "amd64".into()),
            ("go", "go version go1.26.0 darwin/arm64".into()),
            ("beeVersion", "".into()),
            ("binarySha256", "invalid".into()),
        ] {
            let mut invalid = metadata();
            invalid[field] = json!(value);
            assert!(
                parse(invalid).unwrap_err().contains(field),
                "missing field evidence for {field}"
            );
        }
    }

    #[test]
    fn actual_bundled_bytes_must_match_recorded_sha256() {
        let source = parse(metadata()).unwrap();
        let directory = std::env::temp_dir().join(format!(
            "bee-build-source-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(directory.clone());
        let binary = directory.join("bee");
        std::fs::write(&binary, b"abc").unwrap();
        source.verify_binary(&binary).unwrap();
        std::fs::write(&binary, b"changed").unwrap();
        let error = source.verify_binary(&binary).unwrap_err();
        assert!(
            error.contains("SHA256")
                && error.contains("actual=")
                && error.contains(&source.binary_sha256)
        );
        assert_eq!(std::fs::read(binary).unwrap(), b"changed");
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires a freshly built and ad-hoc signed Bee Dev.app; run explicitly after tauri build"]
    fn macos_signed_bundle_seal_accepts_signing_changes_and_rejects_tampering() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let bundle = root.join("target/debug/bundle/macos/Bee Dev.app");
        let binary = bundle.join("Contents/MacOS/bee");
        let bytes = include_bytes!(env!("BEE_SOURCE_FILE"));
        let source = BuildSource::parse(
            bytes,
            env!("BEE_TARGET"),
            env!("BEE_REVISION"),
            env!("BEE_TEE_REVISION"),
        )
        .unwrap();
        source
            .verify_runtime_binary(&binary, Some(&bundle))
            .unwrap();
        let directory =
            std::env::temp_dir().join(format!("bee-signed-bundle-test-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(directory.clone());
        let copy = directory.join("Bee Dev.app");
        assert!(std::process::Command::new("/usr/bin/ditto")
            .arg(&bundle)
            .arg(&copy)
            .status()
            .unwrap()
            .success());
        let changed = copy.join("Contents/MacOS/bee");
        std::fs::write(&changed, b"tampered Bee").unwrap();
        let cause = source
            .verify_runtime_binary(&changed, Some(&copy))
            .unwrap_err();
        assert!(
            cause.contains("signature") && cause.contains("status="),
            "{cause}"
        );
        assert_eq!(std::fs::read(changed).unwrap(), b"tampered Bee");
    }
}
