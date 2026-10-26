#!/usr/bin/env python3
"""Exercise the real Bee binary through a controlling terminal."""
import errno
import json
import http.server
import sys
import threading
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
                        BEE_LANG='zh', TERM='xterm-256color', NO_COLOR='')

    def terminal(self, answers, args=(), after_fork=None, **env):
        child_env = dict(self.env, **env)
        pid, fd = pty.fork()
        if pid == 0:
            os.execve(self.binary, [self.binary, *args], child_env)
        if after_fork:
            after_fork()
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
        code, out = self.terminal([('请选择 [', '0\n')])
        self.assertEqual(code, 0, out)
        for label in ('运行状态', '设备配对', '供给账号', '后台服务', '日志与诊断', '切换语言'):
            self.assertIn(label, out)

    def test_language_choice_and_nested_return_keep_fast_input(self):
        code, out = self.terminal([('Choose language', '2\n3\n0\n0\n')], BEE_LANG='')
        self.assertEqual(code, 0, out)
        self.assertIn('Supplied accounts', out)
        self.assertNotIn('Press Enter', out)
        self.assertNotIn('Back / Exit', out)
        self.assertIn('Confirm account change', out)

    def test_switch_language_updates_next_page_without_pause(self):
        code, out = self.terminal([('请选择 [', '6\n2\n1\n\n0\n')])
        self.assertEqual(code, 0, out)
        english = out.split('Bee management', 1)[1]
        self.assertIn('Device pairing', english)
        self.assertIn('Bee › Status', english)
        self.assertIn('BEE-DEVICE-NOT-PAIRED', english)
        self.assertNotIn('设备配对', english)
        self.assertEqual(english.count('Press Enter'), 1)

    def test_replaced_pairing_keeps_http_evidence_and_localized_recovery(self):
        requests = []
        class Hive(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"error":{"code":"device_replaced"}}')
            def log_message(self, *args):
                pass
        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Hive) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            try:
                config_root = Path(self.temp.name) / ('Library/Application Support' if sys.platform == 'darwin' else 'config')
                config = config_root / 'tokhive/bee.json'
                config.parent.mkdir(parents=True)
                config.write_text(json.dumps({'hive': f'http://127.0.0.1:{server.server_port}',
                                              'credential': 'bee_' + 'a' * 43, 'name': 'synthetic'}))
                config.chmod(0o600)
                code, out = self.terminal([('请选择 [', '1\n\n0\n')], after_fork=worker.start)
                self.assertEqual(code, 0, out)
                for label in ('凭证已撤销', '重新配对', 'HTTP 401', 'device_replaced'):
                    self.assertIn(label, out)
                self.assertNotIn('old device credential', out)
                self.assertEqual(requests, ['/api/bee/identity'])
                if sys.platform == 'darwin':
                    self.assertIn('macOS 暂不支持', out)
                    self.assertNotIn('managed system service unavailable', out)
                self.assertIn('\x1b[1;36m', out)
                self.assertIn('\x1b[31m', out)
            finally:
                server.shutdown()
                worker.join()

    def test_pairing_cancel_never_creates_device_configuration(self):
        code, out = self.terminal([('请选择 [', '2\nhttps://hive.example\n0\n0\n')])
        self.assertEqual(code, 0, out)
        self.assertIn('确认', out)
        self.assertFalse(list(Path(self.temp.name).rglob('bee.json')))

    def test_ctrl_c_and_eof_exit_menu(self):
        for answer in ('\x03', '\x04'):
            code, out = self.terminal([('请选择 [', answer)])
            self.assertEqual(code, 0, out)

    def test_dumb_terminal_uses_plain_text(self):
        code, out = self.terminal([('请选择 [', '0\n')], TERM='dumb')
        self.assertEqual(code, 0, out)
        self.assertNotIn('\x1b', out)
        self.assertNotIn('🐝', out)

    def test_no_color_and_explicit_help_in_terminal(self):
        code, out = self.terminal([('请选择 [', '0\n')], NO_COLOR='1')
        self.assertEqual(code, 0, out)
        self.assertNotIn('\x1b', out)
        self.assertIn('🐝', out)
        code, out = self.terminal([], args=['help'])
        self.assertEqual(code, 0, out)
        self.assertIn('bee start --hive URL', out)
        self.assertNotIn('请选择 [', out)

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
