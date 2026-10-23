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
    println!("cargo:rustc-env=BEE_SOURCE_FILE={}", source.display());
    println!("cargo:rustc-env=BEE_TARGET={target}");
    println!("cargo:rustc-env=BEE_REVISION={revision}");
    println!("cargo:rustc-env=BEE_TEE_REVISION={tee}");
    tauri_build::build();
}
