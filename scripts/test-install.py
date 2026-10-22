#!/usr/bin/env python3
"""Exercise the real installer without downloads, root writes, or service changes."""

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import tarfile
import tempfile
import unittest


INSTALLER = Path(__file__).resolve().parents[1] / "install.sh"
UNIT = "/etc/systemd/system/tokhive-bee.service"
MARKER = "# Managed by Bee install.sh."


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bee-install-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "tools"
        self.bin.mkdir()
        self.unit = self.root / "systemd" / "tokhive-bee.service"
        self.unit.parent.mkdir()
        self.log = self.root / "commands.jsonl"
        self.env = {
            "HOME": str(self.home),
            "PATH": f"{self.bin}:/usr/bin:/bin:/usr/sbin:/sbin",
            "INSTALL_TEST_ROOT": str(self.root),
            "INSTALL_TEST_OS": "Linux",
            "INSTALL_TEST_USER": "dayong",
            "INSTALL_TEST_UID": "1000",
            "INSTALL_TEST_INSTALL": shutil.which("install"),
        }
        self.executable("uname", """
import os, sys
print(os.environ['INSTALL_TEST_OS'] if sys.argv[1] == '-s' else 'x86_64')
""")
        self.executable("id", """
import os, sys
print(os.environ['INSTALL_TEST_UID' if sys.argv[1] == '-u' else 'INSTALL_TEST_USER'])
""")
        self.executable("curl", """
import os, pathlib, shutil, sys
root = pathlib.Path(os.environ['INSTALL_TEST_ROOT'])
output = pathlib.Path(sys.argv[sys.argv.index('-o') + 1])
name = 'checksums.txt' if sys.argv[-1].endswith('checksums.txt') else 'archive.tar.gz'
shutil.copyfile(root / name, output)
""")
        self.executable("sudo", f"""
import json, os, pathlib, subprocess, sys
root = pathlib.Path(os.environ['INSTALL_TEST_ROOT'])
args = sys.argv[1:]
with (root / 'commands.jsonl').open('a') as log:
    log.write(json.dumps(['sudo'] + args) + '\\n')
if os.environ.get('INSTALL_TEST_SUDO_FAIL'):
    print('sudo: dayong is not allowed to execute this command', file=sys.stderr)
    sys.exit(1)
if args == ['-v']:
    sys.exit(0)
args = [str(root / 'systemd' / 'tokhive-bee.service') if arg == {UNIT!r} else arg for arg in args]
if args[0] == 'install':
    args[0] = os.environ['INSTALL_TEST_INSTALL']
sys.exit(subprocess.run(args, check=False).returncode)
""")
        self.executable("systemctl", """
import json, os, pathlib, sys
root = pathlib.Path(os.environ['INSTALL_TEST_ROOT'])
args = sys.argv[1:]
with (root / 'commands.jsonl').open('a') as log:
    log.write(json.dumps(['systemctl'] + args) + '\\n')
if args and args[0] == '--user':
    sys.exit(0 if os.environ.get('INSTALL_TEST_USER_SERVICE') else 1)
if os.environ.get('INSTALL_TEST_SYSTEMD_FAIL'):
    print('Failed to connect to system scope bus: No such file or directory', file=sys.stderr)
    sys.exit(1)
if args and args[0] == os.environ.get('INSTALL_TEST_SYSTEMCTL_FAIL'):
    print('systemctl: injected ' + args[0] + ' failure', file=sys.stderr)
    sys.exit(1)
""")
        self.archive("linux")

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + body)
        path.chmod(0o755)

    def archive(self, platform):
        binary = b'#!/bin/sh\nif [ "$1" = version ]; then printf "bee version test\\n"; else printf "%s\\n" "$@"; fi\n'
        path = self.root / "archive.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            info = tarfile.TarInfo("bee")
            info.size = len(binary)
            info.mode = 0o755
            archive.addfile(info, io.BytesIO(binary))
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        (self.root / "checksums.txt").write_text(
            f"{checksum}  bee_{platform}_amd64.tar.gz\n"
        )

    def run_install(self, **environment):
        return subprocess.run(
            ["/bin/sh", str(INSTALLER)],
            env=self.env | environment,
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
        )

    def commands(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_linux_enables_a_system_service_as_the_installing_user(self):
        result = self.run_install()
        self.assert_success(result)
        self.assertTrue(self.unit.exists(), "Linux installation must create a system service")
        content = self.unit.read_text()
        self.assertIn("User=dayong\n", content)
        self.assertIn(f'Environment="HOME={self.home}"', content)
        self.assertIn('ExecStart=/bin/sh -c ', content)
        self.assertIn(f'"{self.home}/.local/bin/bee" run', content)
        self.assertIn("WantedBy=multi-user.target", content)
        self.assertIn("Restart=on-failure", content)
        self.assertIn(["systemctl", "daemon-reload"], self.commands())
        self.assertIn(["systemctl", "enable", "tokhive-bee"], self.commands())
        self.assertEqual(self.unit.stat().st_mode & 0o777, 0o644)
        self.assertIn("sudo systemctl start tokhive-bee", result.stdout)
        for command in self.commands():
            self.assertFalse(any(arg in ("--now", "start", "restart", "enable-linger") for arg in command))

    def test_unpaired_installation_is_not_started_by_systemd(self):
        self.assert_success(self.run_install())
        content = self.unit.read_text()
        self.assertIn(f'ExecCondition=/usr/bin/test -f "{self.home}/.config/tokhive/bee.json"', content)
        self.assertIn(f'ExecCondition=/usr/bin/test -f "{self.home}/.config/tokhive/egress.json"', content)

    def test_upgrade_updates_managed_service_without_restarting_work(self):
        self.assert_success(self.run_install())
        first = self.unit.read_text()
        self.assert_success(self.run_install())
        self.assertEqual(self.unit.read_text(), first)
        self.assertEqual(self.commands().count(["systemctl", "enable", "tokhive-bee"]), 2)

    def test_binary_only_installation_does_not_require_systemd_or_sudo(self):
        result = self.run_install(BEE_INSTALL_SERVICE="0", INSTALL_TEST_SYSTEMD_FAIL="1", INSTALL_TEST_SUDO_FAIL="1")
        self.assert_success(result)
        self.assertTrue((self.home / ".local/bin/bee").exists())
        self.assertFalse(self.unit.exists())
        self.assertEqual(self.commands(), [])

    def test_macos_keeps_binary_only_installation(self):
        self.archive("darwin")
        result = self.run_install(INSTALL_TEST_OS="Darwin", INSTALL_TEST_SUDO_FAIL="1")
        self.assert_success(result)
        self.assertFalse(self.unit.exists())
        self.assertEqual(self.commands(), [])

    def test_systemd_unavailable_fails_before_installation_with_original_evidence(self):
        result = self.run_install(INSTALL_TEST_SYSTEMD_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Failed to connect to system scope bus", result.stderr)
        self.assertIn("BEE_INSTALL_SERVICE=0", result.stderr)
        self.assertFalse((self.home / ".local/bin/bee").exists())
        self.assertFalse(self.unit.exists())

    def test_sudo_denial_stops_before_installing_binary(self):
        result = self.run_install(INSTALL_TEST_SUDO_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("dayong is not allowed", result.stderr)
        self.assertFalse((self.home / ".local/bin/bee").exists())

    def test_sudo_of_the_whole_installer_does_not_register_root_by_mistake(self):
        result = self.run_install(INSTALL_TEST_UID="0", INSTALL_TEST_USER="root", SUDO_USER="dayong")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("dayong", result.stderr)
        self.assertIn("without sudo", result.stderr)
        self.assertFalse(self.unit.exists())

    def test_custom_binary_and_config_paths_are_preserved(self):
        result = self.run_install(BEE_INSTALL_DIR="custom/bin", XDG_CONFIG_HOME=str(self.home / "configuration"))
        self.assert_success(result)
        self.assertIn(f'"{self.root}/custom/bin/bee" run', self.unit.read_text())
        self.assertIn(f'--config "{self.home}/configuration/tokhive/bee.json"', self.unit.read_text())

    def test_service_preserves_official_client_directory_environment(self):
        result = self.run_install(
            CODEX_HOME=str(self.home / "codex"),
            CLAUDE_CONFIG_DIR=str(self.home / "claude"),
            CLAUDE_SECURESTORAGE_CONFIG_DIR="",
        )
        self.assert_success(result)
        content = self.unit.read_text()
        self.assertIn(f'Environment="CODEX_HOME={self.home}/codex"', content)
        self.assertIn(f'Environment="CLAUDE_CONFIG_DIR={self.home}/claude"', content)
        self.assertIn('Environment="CLAUDE_SECURESTORAGE_CONFIG_DIR="', content)

    def test_service_arguments_escape_systemd_expansions(self):
        directory = self.home / 'bee with space $HOME%"'
        result = self.run_install(BEE_INSTALL_DIR=str(directory))
        self.assert_success(result)
        self.assertIn('bee with space $$HOME%%\\"/bee" run', self.unit.read_text())

    def test_service_launcher_executes_special_paths_without_shell_evaluation(self):
        for name in ("bee=v1", 'space $HOME%"', 'bee;touch NEVER_CREATE'):
            with self.subTest(path=name):
                self.assert_success(self.run_install(BEE_INSTALL_DIR=str(self.home / name)))
                line = next(line for line in self.unit.read_text().splitlines() if line.startswith("ExecStart="))
                # Decode the quoted arguments and literal $/% escapes emitted by
                # the installer, then exercise the actual launcher and binary.
                # Native systemd parsing is checked separately on Linux.
                command = [arg.replace("%%", "%").replace("$$", "$") for arg in shlex.split(line.removeprefix("ExecStart="))]
                result = subprocess.run(command, cwd=self.root, env=self.env, text=True, capture_output=True, check=False)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(result.stdout.splitlines(), [
                    "run", "--config", str(self.home / ".config/tokhive/bee.json"),
                    "--egress-config", str(self.home / ".config/tokhive/egress.json"),
                ])
                self.assertFalse((self.root / "NEVER_CREATE").exists())

    def test_multiline_service_paths_fail_before_installation(self):
        result = self.run_install(BEE_INSTALL_DIR=str(self.home / "bad\n[Service]"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BEE_INSTALL_DIR", result.stderr)
        self.assertFalse(self.unit.exists())

    def test_resolved_installation_path_cannot_add_service_settings(self):
        target = self.home / "bad\n[Service]"
        target.mkdir()
        link = self.home / "linked-bin"
        link.symlink_to(target, target_is_directory=True)
        result = self.run_install(BEE_INSTALL_DIR=str(link))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BEE_INSTALL_DIR contains a line break", result.stderr)
        self.assertFalse(self.unit.exists())

    def test_multiline_client_environment_cannot_add_service_settings(self):
        result = self.run_install(CLAUDE_CONFIG_DIR="/custom\nUser=root")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CLAUDE_CONFIG_DIR contains a line break", result.stderr)
        self.assertFalse((self.home / ".local/bin/bee").exists())

    def test_existing_user_service_requires_explicit_migration(self):
        result = self.run_install(INSTALL_TEST_USER_SERVICE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("systemctl --user disable --now tokhive-bee", result.stderr)
        self.assertFalse(self.unit.exists())
        self.assertFalse((self.home / ".local/bin/bee").exists())

    def test_linked_system_service_is_not_followed_or_overwritten(self):
        target = self.root / "custom.service"
        target.write_text("[Service]\nExecStart=/custom/bee run\n")
        self.unit.symlink_to(target)
        result = self.run_install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symbolic link", result.stderr)
        self.assertTrue(self.unit.is_symlink())
        self.assertEqual(target.read_text(), "[Service]\nExecStart=/custom/bee run\n")

    def test_existing_unmanaged_service_is_not_overwritten(self):
        original = "[Service]\nExecStart=/custom/bee run\n"
        self.unit.write_text(original)
        result = self.run_install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(UNIT, result.stderr)
        self.assertIn("not managed", result.stderr)
        self.assertEqual(self.unit.read_text(), original)
        self.assertFalse((self.home / ".local/bin/bee").exists())

    def test_checksum_failure_never_writes_or_enables_service(self):
        (self.root / "checksums.txt").write_text("0" * 64 + "  bee_linux_amd64.tar.gz\n")
        result = self.run_install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)
        self.assertFalse(self.unit.exists())
        self.assertNotIn(["systemctl", "enable", "tokhive-bee"], self.commands())

    def test_enable_failure_is_reported_without_success_message(self):
        result = self.run_install(INSTALL_TEST_SYSTEMCTL_FAIL="enable")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("injected enable failure", result.stderr)
        self.assertNotIn("Enabled", result.stdout)

    def test_reload_failure_does_not_enable_service(self):
        result = self.run_install(INSTALL_TEST_SYSTEMCTL_FAIL="daemon-reload")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("injected daemon-reload failure", result.stderr)
        self.assertNotIn(["systemctl", "enable", "tokhive-bee"], self.commands())

    def test_generated_service_passes_linux_systemd_verification(self):
        if sys.platform != "linux":
            self.skipTest("native systemd verification requires Linux")
        verifier = shutil.which("systemd-analyze")
        self.assertIsNotNone(verifier, "Linux installer checks require systemd-analyze")
        for suffix in ("plain", 'space $HOME%"'):
            with self.subTest(path=suffix):
                self.assert_success(self.run_install(BEE_INSTALL_DIR=str(self.home / suffix)))
                result = subprocess.run([verifier, "verify", str(self.unit)], text=True, capture_output=True, check=False)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_native_systemctl_wires_the_service_into_the_boot_target(self):
        if sys.platform != "linux":
            self.skipTest("native systemctl verification requires Linux")
        controller = shutil.which("systemctl")
        self.assertIsNotNone(controller, "Linux installer checks require systemctl")
        self.assert_success(self.run_install())
        offline_root = self.root / "boot-root"
        units = offline_root / "etc/systemd/system"
        units.mkdir(parents=True)
        shutil.copyfile(self.unit, units / self.unit.name)
        result = subprocess.run(
            [controller, f"--root={offline_root}", "enable", self.unit.name],
            text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        link = units / "multi-user.target.wants" / self.unit.name
        self.assertTrue(link.is_symlink(), "the service must be wanted by the boot target")
        self.assertEqual(os.readlink(link), UNIT)


if __name__ == "__main__":
    unittest.main(verbosity=2)
