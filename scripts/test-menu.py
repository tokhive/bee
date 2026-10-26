#!/usr/bin/env python3
"""Exercise the real Bee binary through a controlling terminal."""
import errno
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent

class MenuTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory(prefix='bee-menu-build-')
        cls.binary = str(Path(cls.build.name) / 'bee')
        subprocess.run(['go', 'build', '-o', cls.binary, './cmd/bee'], cwd=ROOT, check=True)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bee-menu-home-')
        self.addCleanup(self.temp.cleanup)
        self.env = dict(os.environ, HOME=self.temp.name, XDG_CONFIG_HOME=self.temp.name + '/config',
                        CODEX_HOME=self.temp.name + '/codex', CLAUDE_CONFIG_DIR=self.temp.name + '/claude',
                        BEE_LANG='zh', TERM='xterm-256color')

    def terminal(self, answers, args=(), **env):
        child_env = dict(self.env, **env)
        pid, fd = pty.fork()
        if pid == 0:
            os.execve(self.binary, [self.binary, *args], child_env)
        output = bytearray()
        status = None
        eof = False
        deadline = time.monotonic() + 20
        try:
            while time.monotonic() < deadline:
                ready, _, _ = select.select([] if eof else [fd], [], [], .01)
                if ready:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError as exc:
                        if exc.errno == errno.EIO:
                            chunk = b''
                        else:
                            raise
                    if not chunk:
                        eof = True
                    output.extend(chunk)
                if answers and answers[0][0] in output.decode(errors='replace'):
                    _, reply = answers.pop(0)
                    os.write(fd, reply.encode())
                if status is None:
                    ended, child_status = os.waitpid(pid, os.WNOHANG)
                    if ended:
                        status = child_status
                if status is not None and eof:
                    break
            else:
                self.fail('menu timed out: ' + output.decode(errors='replace'))
        finally:
            os.close(fd)
            ended, current = os.waitpid(pid, os.WNOHANG) if status is None else (pid, status)
            if not ended:
                os.kill(pid, signal.SIGKILL)
                _, current = os.waitpid(pid, 0)
            status = current
        return os.waitstatus_to_exitcode(status), output.decode(errors='replace')

    def test_bare_bee_opens_chinese_management_menu(self):
        code, out = self.terminal([('请输入选项', '0\n')])
        self.assertEqual(code, 0, out)
        for label in ('查看运行状态', '配对 / 重新配对', '管理供给账号', '管理后台服务', '日志与诊断', 'Language'):
            self.assertIn(label, out)

    def test_language_choice_and_nested_return_keep_fast_input(self):
        code, out = self.terminal([('Choose language', '2\n3\n0\n\n0\n')], BEE_LANG='')
        self.assertEqual(code, 0, out)
        self.assertIn('Manage supplied accounts', out)
        self.assertIn('Confirm account change', out)

    def test_pairing_cancel_never_creates_device_configuration(self):
        code, out = self.terminal([('请输入选项', '2\nhttps://hive.example\n0\n\n0\n')])
        self.assertEqual(code, 0, out)
        self.assertIn('确认', out)
        self.assertFalse(list(Path(self.temp.name).rglob('bee.json')))

    def test_ctrl_c_and_eof_exit_menu(self):
        for answer in ('\x03', '\x04'):
            code, out = self.terminal([('请输入选项', answer)])
            self.assertEqual(code, 0, out)

    def test_dumb_terminal_uses_plain_text(self):
        code, out = self.terminal([('请输入选项', '0\n')], TERM='dumb')
        self.assertEqual(code, 0, out)
        self.assertNotIn('\x1b', out)
        self.assertNotIn('🐝', out)

    def test_no_color_and_explicit_help_in_terminal(self):
        code, out = self.terminal([('请输入选项', '0\n')], NO_COLOR='1')
        self.assertEqual(code, 0, out)
        self.assertNotIn('\x1b', out)
        self.assertIn('🐝', out)
        code, out = self.terminal([], args=['help'])
        self.assertEqual(code, 0, out)
        self.assertIn('bee start --hive URL', out)
        self.assertNotIn('请输入选项', out)

    def test_menu_requires_both_input_and_output_terminals(self):
        master, slave = pty.openpty()
        try:
            # One terminal stream is insufficient; these must never wait for input.
            for terminal_input in (False, True):
                result = subprocess.run([self.binary], env=self.env,
                                        stdin=slave if terminal_input else subprocess.DEVNULL,
                                        stdout=subprocess.PIPE if terminal_input else slave,
                                        stderr=subprocess.PIPE, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                if terminal_input:
                    self.assertIn(b'bee start --hive URL', result.stdout)
        finally:
            os.close(master)
            os.close(slave)

    def test_nonterminal_and_explicit_help_keep_help(self):
        for args in ([], ['help'], ['--help']):
            result = subprocess.run([self.binary] + args, env=self.env, input='', text=True, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('bee start --hive URL', result.stdout)

if __name__ == '__main__':
    unittest.main(verbosity=2)
