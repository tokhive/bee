#!/usr/bin/env python3
"""Run the synthetic desktop/Hive retirement acceptance against an isolated DB."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hive", type=Path, required=True, help="integrated Hive checkout")
    parser.add_argument("--logs", type=Path, help="output directory (default: Bee .cache)")
    args = parser.parse_args()
    bee = Path(__file__).resolve().parents[1]
    hive = args.hive.resolve()
    dsn = os.environ.get("TEST_DATABASE_URL", "")
    if urlparse(dsn).hostname not in ("127.0.0.1", "localhost", "::1"):
        parser.error("TEST_DATABASE_URL must point to a dedicated loopback test PostgreSQL")
    if not (hive / "hive/internal/integration/runtime_recovery_native_test.go").is_file():
        parser.error("--hive does not contain the integrated native retirement harness")
    logs = (args.logs or bee / ".cache/runtime-retirement-integration").resolve()
    logs.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.setdefault("RUSTUP_TOOLCHAIN", "1.94")

    def run(command, cwd, name):
        path = logs / name
        print(f"Running {' '.join(map(str, command))}; log: {path}", flush=True)
        with path.open("w") as output:
            result = subprocess.run(command, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            raise SystemExit(f"Command failed with exit={result.returncode}; evidence: {path}")
        return path

    go_binary = logs / "bee-agent.test"
    run(["go", "test", "-c", "-race", "-o", str(go_binary), "./agent"], bee, "go-build.log")
    rust_log = run(["cargo", "test", "--lib", "native_retirement_tests", "--no-run", "--message-format=json"],
                   bee / "desktop/src-tauri", "rust-build.jsonl")
    executables = []
    for line in rust_log.read_text().splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue  # Cargo also emits human-readable status lines on stderr.
        if value.get("reason") == "compiler-artifact" and value.get("executable"):
            if value.get("profile", {}).get("test"):
                executables.append(value["executable"])
    if len(executables) != 1:
        raise SystemExit(f"Expected one Rust test executable; found={len(executables)}; evidence: {rust_log}")
    env["BEE_NATIVE_BRIDGE_TEST_BINARY"] = str(go_binary)
    env["BEE_RETIREMENT_RUST_TEST_BINARY"] = executables[0]
    run(["go", "test", "-race", "./hive/internal/integration", "-run", "^TestRuntimeRecovery", "-v", "-count=1"],
        hive, "hive-native.log")
    print(f"Retirement acceptance passed; evidence: {logs / 'hive-native.log'}")


if __name__ == "__main__":
    main()
