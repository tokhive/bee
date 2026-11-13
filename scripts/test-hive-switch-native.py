#!/usr/bin/env python3
"""Exercise the production HiveSwitch with managed Go children and real Hive/PG."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hive", type=Path, required=True)
    parser.add_argument("--logs", type=Path)
    parser.add_argument("--cargo-target", type=Path, required=True)
    args = parser.parse_args()
    bee = Path(__file__).resolve().parents[1]
    hive = args.hive.resolve()
    if urlparse(os.environ.get("TEST_DATABASE_URL", "")).hostname not in (
        "127.0.0.1", "localhost", "::1"
    ):
        parser.error("TEST_DATABASE_URL must name a dedicated loopback test PostgreSQL")
    if not (hive / "hive/internal/integration/hive_switch_native_test.go").is_file():
        parser.error("--hive must contain the native Hive switch fixture")
    logs = (args.logs or bee / ".cache/hive-switch-native").resolve()
    logs.mkdir(mode=0o700, parents=True, exist_ok=True)
    env = os.environ.copy()
    env["CARGO_INCREMENTAL"] = "0"
    env.setdefault("RUSTUP_TOOLCHAIN", "1.94")

    def run(command, cwd, name):
        path = logs / name
        print(f"Running {shlex.join(map(str, command))}; evidence: {path}", flush=True)
        with path.open("w") as output:
            result = subprocess.run(command, cwd=cwd, env=env, stdout=output,
                                    stderr=subprocess.STDOUT)
        if result.returncode:
            raise SystemExit(f"Command failed: exit={result.returncode}; evidence: {path}")
        return path

    run(["node", "desktop/scripts/build-bee.mjs"], bee, "sidecar-build.log")
    agent = logs / "bee-switch-native.test"
    run(["go", "test", "-c", "-p", "1", "-race", "-ldflags=-w", "-o", str(agent),
         "./agent"], bee, "agent-build.log")
    rust_log = run(["cargo", "test", "--locked", "--lib", "native_hive_switch_tests",
                    "--no-run", "--message-format=json", "--target-dir",
                    str(args.cargo_target.resolve())], bee / "desktop/src-tauri",
                   "rust-build.jsonl")
    executables = []
    for line in rust_log.read_text().splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (value.get("reason") == "compiler-artifact" and value.get("executable")
                and value.get("profile", {}).get("test")):
            executables.append(value["executable"])
    if len(executables) != 1:
        raise SystemExit(f"Rust test executable count={len(executables)}; required=1; evidence: {rust_log}")
    wrapper = logs / "bee-switch-native-wrapper"
    wrapper.write_text("#!/bin/sh\nset -eu\n"
                       '[ "$#" -eq 5 ] && [ "$1" = desktop ] && '
                       '[ "$2" = --profile-dir ] && [ "$4" = --mode ] || exit 64\n'
                       f"exec {shlex.quote(str(agent))} '-test.run=^TestDesktopNativeBridgeProcess$' "
                       '"-bee-native-fixture-audit=$3/native-audit.json" '
                       '"-bee-native-switch-profile=$3" "-bee-native-switch-mode=$5" '
                       '"-bee-native-switch-fixture=$BEE_SWITCH_FIXTURE"\n')
    wrapper.chmod(0o700)
    env["BEE_SWITCH_RUST_TEST_BINARY"] = executables[0]
    env["BEE_SWITCH_NATIVE_WRAPPER"] = str(wrapper)
    fixture = logs / "hive-switch-native.test"
    run(["go", "test", "-c", "-p", "1", "-race", "-ldflags=-w", "-o", str(fixture),
         "./hive/internal/integration"], hive, "hive-build.log")
    run([str(fixture), "-test.run=^TestHiveSwitchNativeDesktop$", "-test.v",
         "-test.timeout=280s"], hive, "native.log")
    versions = {}
    for label, directory in [("bee", bee), ("hive", hive)]:
        versions[label] = subprocess.check_output(["git", "rev-parse", "HEAD"],
                                                  cwd=directory, text=True).strip()
    versions["binaries"] = {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                            for path in [agent, fixture, Path(executables[0])]}
    (logs / "manifest.json").write_text(json.dumps(versions, indent=2) + "\n")
    print(f"Managed Hive switch acceptance passed; evidence: {logs / 'native.log'}")


if __name__ == "__main__":
    main()
