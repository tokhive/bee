#[path = "src/build_source.rs"]
#[allow(dead_code)] // Runtime verification is shared with the App.
mod build_source;

fn git(root: &std::path::Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap_or_else(|cause| panic!("read Bee build revision using git {args:?}: {cause}"));
    assert!(
        output.status.success(),
        "git {args:?} failed: status={}; stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git revision output must be UTF-8")
        .trim()
        .into()
}

fn main() {
    let manifest = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory missing"),
    );
    let root = manifest
        .parent()
        .and_then(std::path::Path::parent)
        .expect("desktop manifest must be inside Bee repository");
    let target = std::env::var("TARGET").expect("Cargo TARGET missing");
    let suffix = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let binary = manifest.join(format!("binaries/bee-{target}{suffix}"));
    let source = manifest.join(format!("binaries/bee-{target}{suffix}.source.json"));
    let revision = git(root, &["rev-parse", "HEAD"]);
    let tee_file = root.join("TEE_REVISION");
    let tee = std::fs::read_to_string(&tee_file)
        .expect("read fixed Bee TEE_REVISION")
        .trim()
        .to_string();
    for path in [&source, &binary, &tee_file] {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    let reference = git(root, &["rev-parse", "--symbolic-full-name", "HEAD"]);
    for reference in ["HEAD", reference.as_str()] {
        if !reference.is_empty() {
            println!(
                "cargo:rerun-if-changed={}",
                git(root, &["rev-parse", "--git-path", reference])
            );
        }
    }
    let bytes = std::fs::read(&source).unwrap_or_else(|cause| panic!("read build source {}: {cause}; run node desktop/scripts/build-bee.mjs --target {target} before Cargo", source.display()));
    let metadata = build_source::BuildSource::parse(&bytes, &target, &revision, &tee)
        .unwrap_or_else(|cause| panic!("{cause}; rebuild the native Bee before Cargo"));
    metadata
        .verify_binary(&binary)
        .unwrap_or_else(|cause| panic!("{cause}"));
    let release_mode = std::env::var("BEE_RELEASE_MODE").unwrap_or_else(|_| "development".into());
    assert!(["development", "candidate", "production"].contains(&release_mode.as_str()), "Bee release mode invalid: actual={release_mode}; required=development|candidate|production");
    let mut release = std::collections::BTreeMap::new();
    for name in [
        "BEE_RELEASE_VERSION",
        "BEE_RELEASE_CHANNEL",
        "BEE_UPDATE_ENDPOINT",
        "BEE_UPDATER_PUBLIC_KEY",
        "BEE_RELEASE_ASSET_BASE_URL",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
        let value = std::env::var(name).unwrap_or_default();
        assert!(
            !value.contains(['\r', '\n']),
            "Bee release input has line break: field={name}; required=single line"
        );
        if release_mode == "production" {
            assert!(!value.is_empty(), "Bee production release input missing: actual={name} empty; required=controlled production input");
        }
        release.insert(name, value);
    }
    println!("cargo:rerun-if-env-changed=BEE_RELEASE_MODE");
    println!("cargo:rustc-env=BEE_RELEASE_MODE={release_mode}");
    let release_version = &release["BEE_RELEASE_VERSION"];
    if !release_version.is_empty() {
        let cargo_version =
            std::env::var("CARGO_PKG_VERSION").expect("Cargo package version missing");
        assert_eq!(
            release_version, &cargo_version,
            "Bee App release version mismatch: required=Cargo package version"
        );
        metadata
            .verify_release_version(release_version)
            .unwrap_or_else(|cause| panic!("{cause}"));
        for (path, name) in [
            (root.join("desktop/package.json"), "package.json"),
            (manifest.join("tauri.conf.json"), "tauri.conf.json"),
        ] {
            println!("cargo:rerun-if-changed={}", path.display());
            let json: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).unwrap_or_else(|cause| {
                    panic!("read release {name} at {}: {cause}", path.display())
                }))
                .unwrap_or_else(|cause| panic!("parse release {name}: {cause}"));
            assert_eq!(
                json["version"].as_str(),
                Some(release_version.as_str()),
                "Bee release {name} version mismatch: required={release_version}"
            );
        }
    }
    if release_mode == "production" {
        let endpoint = &release["BEE_UPDATE_ENDPOINT"];
        assert!(endpoint.starts_with("https://") && !endpoint.contains('@') && !endpoint.contains(['?', '#']), "Bee production endpoint invalid: actual={endpoint}; required=credential-free static HTTPS manifest");
        let channel = &release["BEE_RELEASE_CHANNEL"];
        assert!(
            channel
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'),
            "Bee production channel invalid: actual={channel}; required=lowercase channel"
        );
    }
    for (name, value) in release {
        println!("cargo:rustc-env={name}={value}");
    }
    println!("cargo:rustc-env=BEE_SOURCE_FILE={}", source.display());
    println!("cargo:rustc-env=BEE_TARGET={target}");
    println!("cargo:rustc-env=BEE_REVISION={revision}");
    println!("cargo:rustc-env=BEE_TEE_REVISION={tee}");
    tauri_build::build();
}
