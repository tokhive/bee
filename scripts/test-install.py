#!/usr/bin/env python3
"""Exercise the real installer without downloads, root writes, or service changes."""

import hashlib
import io
import json
import os
from pathlib import Path
import fcntl
import pty
import select
import shutil
import shlex
import subprocess
import sys
import tarfile
import tempfile
import termios
import time
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
            "BEE_LANG": "en",
            "TERM": "xterm-256color",
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
    if os.environ.get('INSTALL_TEST_SUDO_VALIDATE_FAIL'):
        print('sudo: a password is required', file=sys.stderr)
        sys.exit(1)
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
if args and args[0] == 'show':
    state = root / 'service-state'
    print(state.read_text() if state.exists() else os.environ.get('INSTALL_TEST_SERVICE_STATE', 'inactive'))
if args and args[0] in ('start', 'restart'):
    (root / 'service-state').write_text(os.environ.get('INSTALL_TEST_STARTED_STATE', 'active'))
""")
        self.archive("linux")

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + body)
        path.chmod(0o755)

    def archive(self, platform):
        binary = (f'#!{sys.executable}\n' + """
import json, os, pathlib, sys
args = sys.argv[1:]
if args == ['version']:
    print('bee version test')
elif args and args[0] in ('login', 'setup'):
    root = pathlib.Path(os.environ['INSTALL_TEST_ROOT'])
    with (root / 'commands.jsonl').open('a') as log:
        log.write(json.dumps(['bee'] + args) + '\\n')
        log.write(json.dumps(['bee-stdin', args[0], str(os.isatty(0))]) + '\\n')
        log.write(json.dumps(['bee-env', args[0], os.environ.get('BEE_LANG'), os.environ.get('BEE_INSTALL_UI')]) + '\\n')
    if args[0] == os.environ.get('INSTALL_TEST_BEE_FAIL'):
        print('bee: injected ' + args[0] + ' failure', file=sys.stderr)
        sys.exit(7)
    config = pathlib.Path(args[args.index('--config') + 1])
    if args[0] == 'setup':
        print('Supply this account? [Y/n] ', end='', flush=True)
        if sys.stdin.readline().strip().lower() in ('n', 'no'):
            print('bee: no accounts selected', file=sys.stderr)
            sys.exit(1)
        config = pathlib.Path(args[args.index('--egress-config') + 1])
    if args[0] != os.environ.get('INSTALL_TEST_BEE_NO_CONFIG'):
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text('{}')
        config.chmod(0o600)
else:
    print('\\n'.join(args))
""").encode()
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

    def run_terminal_install(self, answers=(), controlling_terminal=True, **environment):
        """Use a real controlling tty while sh reads the installer from a pipe."""
        master, slave = pty.openpty()

        def terminal_session():
            os.setsid()
            if controlling_terminal:
                fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

        process = subprocess.Popen(
            ['/bin/sh'], stdin=subprocess.PIPE, stdout=slave, stderr=slave,
            cwd=self.root, env=self.env | environment, preexec_fn=terminal_session,
        )
        os.close(slave)
        output = bytearray()
        pending = iter(answers)
        answer = next(pending, None)
        answered_through = 0
        deadline = time.monotonic() + 15
        try:
            process.stdin.write(INSTALLER.read_bytes())
            process.stdin.close()
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    output.extend(chunk)
                    if answer is not None and answer[0].encode() in output[answered_through:]:
                        os.write(master, answer[1].encode())
                        answered_through = len(output)
                        answer = next(pending, None)
                elif process.poll() is not None:
                    break
            if process.poll() is None:
                process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            self.fail('installer did not finish terminal interaction:\n' + output.decode(errors='replace'))
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            os.close(master)
        return subprocess.CompletedProcess(process.args, process.returncode, output.decode(errors='replace'), '')

    def existing_configuration(self, egress=True):
        directory = self.home / '.config/tokhive'
        directory.mkdir(parents=True)
        (directory / 'bee.json').write_text('{}')
        if egress:
            (directory / 'egress.json').write_text('{}')

    def test_terminal_install_pairs_sets_up_and_starts_service(self):
        result = self.run_terminal_install([
            ('Set up and start Bee now?', '\n'),
            ('Hive address:', 'https://hive.example.com\n'),
            ('Supply this account?', '\n'),
        ])
        self.assert_success(result)
        commands = self.commands()
        self.assertTrue(any(command[:2] == ['bee', 'login'] for command in commands), result.stdout)
        self.assertTrue(any(command[:2] == ['bee', 'setup'] for command in commands), result.stdout)
        self.assertIn(['bee-stdin', 'setup', 'True'], commands)
        self.assertIn(['systemctl', 'start', 'tokhive-bee'], commands)
        self.assertIn('Bee service is active', result.stdout)
        for step in ('[1/3]', '[2/3]', '[3/3]'):
            self.assertIn(step, result.stdout)

    def test_chinese_first_install_passes_language_to_both_commands(self):
        result = self.run_terminal_install([
            ('现在配置并启动 Bee？', '\n'),
            ('请输入 Hive 地址：', 'https://hive.example.com\n'),
            ('Supply this account?', '\n'),
        ], BEE_LANG='zh')
        self.assert_success(result)
        for operation in ('login', 'setup'):
            self.assertIn(['bee-env', operation, 'zh', '1'], self.commands())
        for text in ('[1/3]', '[2/3]', '[3/3]', 'Bee 已在后台运行'):
            self.assertIn(text, result.stdout)
        self.assertNotIn('BEE_LANG', self.unit.read_text())
        self.assertNotIn('BEE_INSTALL_UI', self.unit.read_text())

    def test_existing_configuration_shows_all_three_steps(self):
        self.existing_configuration()
        result = self.run_terminal_install([('Set up and start Bee now?', '\n')])
        self.assert_success(result)
        for step in ('[1/3]', '[2/3]', '[3/3]'):
            self.assertIn(step, result.stdout)
        positions = [result.stdout.index(step) for step in ('[1/3]', '[2/3]', '[3/3]')]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('Bee is running in the background', result.stdout)
        self.assertNotIn('Pair or validate:', result.stdout)
        self.assertIn(['bee-env', 'login', 'en', '1'], self.commands())

    def test_chinese_language_menu_and_complete_existing_configuration(self):
        self.existing_configuration()
        result = self.run_terminal_install([
            ('Select [1-2]:', '1\n'), ('现在配置并启动 Bee？', '\n'),
        ], BEE_LANG='')
        self.assert_success(result)
        for text in ('程序已安装', '[1/3]', '[2/3]', '[3/3]', '使用已有供给配置', 'Bee 已在后台运行'):
            self.assertIn(text, result.stdout)
        self.assertIn(['bee-env', 'login', 'zh', '1'], self.commands())

    def test_english_language_menu_reprompts_and_declines_setup(self):
        result = self.run_terminal_install([
            ('Select [1-2]:', '3\n'), ('Select [1-2]:', '2\n'),
            ('Set up and start Bee now?', 'n\n'),
        ], BEE_LANG='')
        self.assert_success(result)
        self.assertIn('Select 1 or 2', result.stdout)
        self.assertIn('Bee was not started', result.stdout)
        self.assertNotIn('[3/3]', result.stdout)

    def test_language_menu_eof_skips_further_interaction(self):
        result = self.run_terminal_install([('Select [1-2]:', '\x04')], BEE_LANG='')
        self.assert_success(result)
        self.assertTrue(self.unit.exists())
        self.assertNotIn('Set up and start Bee now?', result.stdout)
        self.assertFalse(any(c[0] == 'bee' for c in self.commands()))

    def test_noninteractive_chinese_output_is_plain(self):
        result = self.run_install(BEE_LANG='zh')
        self.assert_success(result)
        self.assertIn('程序已安装', result.stdout)
        self.assertIn('手动配置并启动', result.stdout)
        self.assertNotIn('Select [1-2]:', result.stdout)
        for decoration in ('\x1b', '🐝', '✅', '━', '─'):
            self.assertNotIn(decoration, result.stdout)

    def test_locale_precedence_selects_language_without_a_menu(self):
        for environment, expected in (
            ({'LC_ALL': 'zh_CN.UTF-8', 'LANG': 'en_US.UTF-8'}, '程序已安装'),
            ({'LC_ALL': '', 'LC_MESSAGES': 'zh_TW.UTF-8'}, '程序已安装'),
            ({'LC_ALL': 'C', 'LANG': 'zh_CN.UTF-8'}, 'Installed'),
        ):
            with self.subTest(environment=environment):
                result = self.run_install(BEE_LANG='', **environment)
                self.assert_success(result)
                self.assertIn(expected, result.stdout)

    def test_invalid_language_fails_before_installation(self):
        result = self.run_install(BEE_LANG='fr')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('BEE_LANG=fr', result.stderr)
        self.assertFalse((self.home / '.local/bin/bee').exists())

    def test_terminal_style_respects_no_color_and_dumb_terminal(self):
        result = self.run_terminal_install([('Set up and start Bee now?', 'n\n')], NO_COLOR='1')
        self.assert_success(result)
        self.assertIn('🐝', result.stdout)
        self.assertIn('━━━━━━━━', result.stdout)
        self.assertNotIn('\x1b', result.stdout)
        result = self.run_terminal_install([('Set up and start Bee now?', 'n\n')], TERM='dumb')
        self.assert_success(result)
        for decoration in ('\x1b', '🐝', '✅', '━', '─'):
            self.assertNotIn(decoration, result.stdout)

    def test_chinese_start_failure_keeps_diagnostics_without_success(self):
        self.existing_configuration()
        result = self.run_terminal_install([('现在配置并启动 Bee？', '\n')],
                                           BEE_LANG='zh', INSTALL_TEST_SYSTEMCTL_FAIL='start')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('Select [1-2]:', result.stdout)
        self.assertIn('[3/3]', result.stdout)
        self.assertIn('systemctl: injected start failure', result.stdout)
        self.assertIn('退出码 1', result.stdout)
        self.assertIn('已保留安装的程序和已有配置', result.stdout)
        self.assertNotIn('Bee 已在后台运行', result.stdout)

    def test_chinese_active_service_declines_restart_without_setup_steps(self):
        result = self.run_terminal_install([('现在重启 Bee？', '\n')],
                                           BEE_LANG='zh', INSTALL_TEST_SERVICE_STATE='active')
        self.assert_success(result)
        self.assertIn('当前 Bee 继续运行', result.stdout)
        self.assertNotIn('[1/3]', result.stdout)
        self.assertNotIn(['systemctl', 'restart', 'tokhive-bee'], self.commands())

    def test_existing_identity_is_validated_without_reselecting_accounts(self):
        self.existing_configuration()
        result = self.run_terminal_install([('Set up and start Bee now?', 'yes\n')])
        self.assert_success(result)
        self.assertIn(['bee', 'login', '--config', str(self.home / '.config/tokhive/bee.json')], self.commands())
        self.assertFalse(any(command[:2] == ['bee', 'setup'] for command in self.commands()))
        self.assertIn(['systemctl', 'start', 'tokhive-bee'], self.commands())

    def test_incomplete_pairing_uses_login_and_missing_egress_uses_setup(self):
        self.existing_configuration(egress=False)
        result = self.run_terminal_install([
            ('Set up and start Bee now?', '\n'), ('Supply this account?', '\n'),
        ])
        self.assert_success(result)
        self.assertNotIn('Hive address:', result.stdout)
        commands = self.commands()
        self.assertLess(next(i for i, c in enumerate(commands) if c[:2] == ['bee', 'login']),
                        next(i for i, c in enumerate(commands) if c[:2] == ['bee', 'setup']))
        self.assertFalse(any('--yes' in c for c in commands))

    def test_failed_service_can_be_started_after_identity_validation(self):
        self.existing_configuration()
        result = self.run_terminal_install([('Set up and start Bee now?', '\n')], INSTALL_TEST_SERVICE_STATE='failed')
        self.assert_success(result)
        self.assertIn(['systemctl', 'start', 'tokhive-bee'], self.commands())

    def test_eof_at_hive_prompt_preserves_installation_without_login(self):
        result = self.run_terminal_install([
            ('Set up and start Bee now?', '\n'), ('Hive address:', '\x04'),
        ])
        self.assert_success(result)
        self.assertFalse(any(c[0] == 'bee' for c in self.commands()))
        self.assertTrue(self.unit.exists())

    def test_decline_or_eof_preserves_installation_without_starting(self):
        for answer in ('n\n', '\x04'):
            with self.subTest(answer=answer):
                result = self.run_terminal_install([('Set up and start Bee now?', answer)])
                self.assert_success(result)
                self.assertTrue(self.unit.exists())
                self.assertFalse(any(c[0] == 'bee' or c[:2] == ['systemctl', 'start'] for c in self.commands()))

    def test_invalid_answer_reprompts_and_empty_hive_is_not_accepted(self):
        result = self.run_terminal_install([
            ('Set up and start Bee now?', 'maybe\n'),
            ('Set up and start Bee now?', 'y\n'),
            ('Hive address:', '\n'), ('Hive address:', 'https://hive.example.com\n'),
            ('Supply this account?', '\n'),
        ])
        self.assert_success(result)
        self.assertIn('Please answer yes or no', result.stdout)
        self.assertIn('Hive address must not be empty', result.stdout)

    def test_active_service_defaults_to_no_restart(self):
        result = self.run_terminal_install([('Restart Bee now?', '\n')], INSTALL_TEST_SERVICE_STATE='active')
        self.assert_success(result)
        self.assertFalse(any(c[0] == 'bee' or c[:2] == ['systemctl', 'restart'] for c in self.commands()))

    def test_active_service_restarts_only_after_confirmation(self):
        result = self.run_terminal_install([('Restart Bee now?', 'y\n')], INSTALL_TEST_SERVICE_STATE='active')
        self.assert_success(result)
        self.assertIn(['systemctl', 'restart', 'tokhive-bee'], self.commands())
        self.assertFalse(any(c[0] == 'bee' for c in self.commands()))
        self.assertIn('Bee service is active', result.stdout)

    def test_transitional_service_is_preserved(self):
        for state in ('activating', 'reloading', 'deactivating'):
            with self.subTest(state=state):
                result = self.run_terminal_install(INSTALL_TEST_SERVICE_STATE=state)
                self.assert_success(result)
                self.assertIn(state, result.stdout)
                self.assertFalse(any(c[0] == 'bee' or c[1] in ('start', 'restart') for c in self.commands()))

    def test_unrecognized_service_state_fails_with_actual_state(self):
        result = self.run_terminal_install(INSTALL_TEST_SERVICE_STATE='unexpected-state')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unexpected-state', result.stdout)
        self.assertNotIn('Bee service is active', result.stdout)

    def test_interactive_disabled_or_no_controlling_tty_skips_wizard(self):
        for environment in ({'BEE_INSTALL_INTERACTIVE': '0'}, {'controlling_terminal': False}):
            with self.subTest(environment=environment):
                result = self.run_terminal_install(**environment)
                self.assert_success(result)
                self.assertNotIn('Set up and start Bee now?', result.stdout)
                self.assertFalse(any(c[0] == 'bee' for c in self.commands()))

    def test_invalid_interactive_flag_is_rejected_before_installing(self):
        result = self.run_install(BEE_INSTALL_INTERACTIVE='yes')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('BEE_INSTALL_INTERACTIVE=yes', result.stderr)
        self.assertFalse((self.home / '.local/bin/bee').exists())

    def test_command_failures_stop_and_preserve_original_diagnostics(self):
        self.existing_configuration(egress=False)
        for operation in ('show', 'login', 'setup', 'start', 'restart'):
            with self.subTest(operation=operation):
                self.log.unlink(missing_ok=True)
                (self.root / 'service-state').unlink(missing_ok=True)
                (self.home / '.config/tokhive/egress.json').unlink(missing_ok=True)
                answers = [('Set up and start Bee now?', 'y\n'), ('Supply this account?', '\n')]
                environment = {'INSTALL_TEST_SYSTEMCTL_FAIL': operation}
                if operation in ('login', 'setup'):
                    environment = {'INSTALL_TEST_BEE_FAIL': operation}
                if operation == 'restart':
                    answers = [('Restart Bee now?', 'y\n')]
                    environment['INSTALL_TEST_SERVICE_STATE'] = 'active'
                result = self.run_terminal_install(answers, **environment)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('injected ' + operation + ' failure', result.stdout)
                self.assertNotIn('Bee service is active', result.stdout)
                if operation in ('show', 'login', 'setup'):
                    self.assertNotIn(['systemctl', 'start', 'tokhive-bee'], self.commands())
                if operation in ('login', 'setup'):
                    self.assertEqual(result.returncode, 7)
                    self.assertIn('exit 7', result.stdout)
                if operation in ('start', 'restart'):
                    self.assertIn('systemctl ' + operation + ' tokhive-bee failed (exit 1)', result.stdout)
                self.assertTrue((self.home / '.local/bin/bee').exists())

    def test_successful_start_must_be_followed_by_active_state(self):
        self.existing_configuration()
        result = self.run_terminal_install([('Set up and start Bee now?', '\n')], INSTALL_TEST_STARTED_STATE='inactive')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('inactive', result.stdout)
        self.assertNotIn('Bee service is active', result.stdout)

    def test_successful_cli_without_required_config_does_not_start(self):
        for operation, filename in (('login', 'bee.json'), ('setup', 'egress.json')):
            with self.subTest(operation=operation):
                self.log.unlink(missing_ok=True)
                result = self.run_terminal_install([
                    ('Set up and start Bee now?', '\n'), ('Hive address:', 'https://hive.example.com\n'),
                    ('Supply this account?', '\n'),
                ], INSTALL_TEST_BEE_NO_CONFIG=operation)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(filename, result.stdout)
                self.assertNotIn(['systemctl', 'start', 'tokhive-bee'], self.commands())

    def test_terminal_custom_paths_and_hive_are_literal_arguments(self):
        special = self.home / "special ' $ % \\ space"
        hive = 'https://hive.example.com/$(touch unexpected)'
        result = self.run_terminal_install([
            ('Set up and start Bee now?', '\n'), ('Hive address:', hive + '\n'),
            ('Supply this account?', '\n'),
        ], BEE_INSTALL_DIR=str(special / 'bin'), XDG_CONFIG_HOME=str(special / 'config'))
        self.assert_success(result)
        self.assertIn(['bee', 'login', '--config', str(special / 'config/tokhive/bee.json'), '--hive', hive], self.commands())
        self.assertTrue((special / 'config/tokhive/egress.json').exists())
        self.assertFalse((self.root / 'unexpected').exists())
        lines = result.stdout.splitlines()
        status_command = lines[lines.index('View connection and accounts:') + 1]
        self.assertEqual(shlex.split(status_command),
                         [str(special / 'bin/bee'), 'status', '--config', str(special / 'config/tokhive/bee.json')])

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

    def test_passwordless_commands_work_when_sudo_validate_requires_password(self):
        result = self.run_install(INSTALL_TEST_SUDO_VALIDATE_FAIL="1")
        self.assert_success(result)
        self.assertTrue(self.unit.exists())
        self.assertIn(['systemctl', 'enable', 'tokhive-bee'], self.commands())
        self.assertNotIn(['sudo', '-v'], self.commands())

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
