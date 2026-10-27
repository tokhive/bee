#!/usr/bin/env python3
"""Exercise the real Bee binary through a controlling terminal."""
import errno
import base64
import hashlib
import struct
from datetime import datetime, timedelta, timezone
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
                        CLAUDE_SECURESTORAGE_CONFIG_DIR=self.temp.name + '/claude',
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
        for label in ('启动 Bee', '运行状态', '设备配对', '供给账号', '后台服务', '日志与诊断', '高级选项', '帮助与版本', '切换语言'):
            self.assertIn(label, out)

    def test_language_choice_and_nested_return_keep_fast_input(self):
        code, out = self.terminal([('Choose language', '2\n4\n0\n0\n')], BEE_LANG='')
        self.assertEqual(code, 0, out)
        self.assertIn('Supplied accounts', out)
        self.assertNotIn('Press Enter', out)
        self.assertNotIn('Back / Exit', out)
        self.assertIn('Confirm account change', out)

    def test_switch_language_updates_next_page_without_pause(self):
        code, out = self.terminal([('请选择 [', '9\n2\n2\n\n0\n')])
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
                config.parent.mkdir(parents=True, exist_ok=True)
                config.write_text(json.dumps({'hive': f'http://127.0.0.1:{server.server_port}',
                                              'credential': 'bee_' + 'a' * 43, 'name': 'synthetic'}))
                config.chmod(0o600)
                code, out = self.terminal([('请选择 [', '2\n\n0\n')], after_fork=worker.start)
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
        code, out = self.terminal([('请选择 [', '3\nhttps://hive.example\n\n0\n0\n')])
        self.assertEqual(code, 0, out)
        self.assertIn('确认', out)
        self.assertFalse(list(Path(self.temp.name).rglob('bee.json')))

    def test_foreground_connects_and_ctrl_c_exits_entire_menu(self):
        self.foreground_scenario(guided=False)

    def test_guided_start_pairs_selects_and_connects(self):
        self.foreground_scenario(guided=True)

    def test_start_asks_only_about_configuration_in_both_languages(self):
        for lang, question in [('zh', '启动前是否需要引导配置？'),
                               ('en', 'Would you like guidance before starting?')]:
            prompt = '请选择 [' if lang == 'zh' else 'Select ['
            code, out = self.terminal([(prompt, '1\n0\n0\n')], BEE_LANG=lang)
            self.assertEqual(code, 0, out)
            self.assertIn(question, out)
            self.assertNotIn('按回车返回', out)
            self.assertNotIn('Press Enter to return', out)
            self.assertFalse(list(Path(self.temp.name).rglob('bee.json')))

    def test_advanced_foreground_remains_available(self):
        self.foreground_scenario(guided=False, advanced=True)

    def test_foreground_status_language_and_terminal_style(self):
        for lang, term, no_color in [('en', 'xterm-256color', ''),
                                     ('zh', 'xterm-256color', '1'),
                                     ('zh', 'dumb', '')]:
            with self.subTest(lang=lang, term=term, no_color=no_color):
                self.foreground_scenario(False, lang=lang, term=term, no_color=no_color)

    def foreground_scenario(self, guided, advanced=False, lang='zh', term='xterm-256color', no_color=''):
        running = 'Bee 持续运行中…（已连接 Hive）' if lang == 'zh' else 'Bee is running… (connected to Hive)'
        starting = '正在启动 Bee…' if lang == 'zh' else 'Starting Bee…'
        prompt = '请选择 [' if lang == 'zh' else 'Select ['
        requests = []
        identity = {'id': 'synthetic-device', 'name': 'PTY worker', 'owner_email': 'synthetic@example.test'}
        class Hive(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def handle(self):
                try:
                    super().handle()
                except (ConnectionResetError, BrokenPipeError):
                    # Ctrl+C intentionally closes the Bee process and its sockets.
                    pass
            def reply(self, status, body):
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            def do_POST(self):
                requests.append(('POST', self.path))
                self.rfile.read(int(self.headers.get('Content-Length', '0')))
                if self.path == '/api/bee/pairings':
                    self.reply(200, {'pairing_token': 'synthetic-pairing', 'user_code': 'TEST-CODE',
                                     'verification_uri': f'http://127.0.0.1:{self.server.server_port}/pair',
                                     'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
                                     'status': 'pending'})
                elif self.path == '/api/bee/pairings/redeem':
                    self.reply(200, identity)
                else:
                    self.reply(503, {'error': {'code': 'synthetic_maintenance_unavailable'}})
            def do_GET(self):
                requests.append(('GET', self.path))
                if self.path == '/api/bee/identity':
                    self.reply(401, {'error': {'code': 'unpaired'}})
                elif self.path == '/api/bee/pairings':
                    self.reply(200, {'status': 'approved'})
                elif self.path in ('/api/bee/connect', '/api/bee/agent'):
                    key = self.headers['Sec-WebSocket-Key']
                    accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
                    self.send_response(101)
                    self.send_header('Upgrade', 'websocket')
                    self.send_header('Connection', 'Upgrade')
                    self.send_header('Sec-WebSocket-Accept', accept)
                    self.send_header('X-Bee-Lease', 'synthetic-lease')
                    self.end_headers()
                    self.wfile.flush()
                    self.close_connection = True
                    # Read masked client frames; complete the close handshake.
                    while True:
                        header = self.rfile.read(2)
                        if len(header) != 2:
                            break
                        size = header[1] & 127
                        if size == 126:
                            size = struct.unpack('!H', self.rfile.read(2))[0]
                        elif size == 127:
                            size = struct.unpack('!Q', self.rfile.read(8))[0]
                        mask = self.rfile.read(4) if header[1] & 128 else b''
                        payload = self.rfile.read(size)
                        if mask:
                            payload = bytes(value ^ mask[i % 4] for i, value in enumerate(payload))
                        if header[0] & 15 == 8:
                            self.wfile.write(b'\x88\x02\x03\xe8')
                            self.wfile.flush()
                            break
                        if header[0] & 15 == 9:
                            self.wfile.write(bytes([0x8a, len(payload)]) + payload)
                            self.wfile.flush()
                elif self.path == '/api/bee/platforms/openai/account':
                    self.reply(200, {'platform': 'openai', 'status': 'not_configured'})
                else:
                    self.reply(503, {'error': {'code': 'synthetic_endpoint_unavailable'}})
            def log_message(self, *args):
                pass
        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Hive) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            config_root = Path(self.temp.name) / ('Library/Application Support' if sys.platform == 'darwin' else 'config')
            config = config_root / 'tokhive/bee.json'
            url = f'http://127.0.0.1:{server.server_port}'
            if guided:
                codex = Path(self.env['CODEX_HOME'])
                codex.mkdir()
                def encoded(value):
                    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
                token = encoded({'alg': 'HS256'}) + '.' + encoded({'exp': int(time.time()) + 3600,
                    'https://api.openai.com/auth': {'chatgpt_account_id': 'synthetic-account',
                    'chatgpt_user_id': 'synthetic-user', 'chatgpt_plan_type': 'pro'}}) + '.c3ludGhldGlj'
                (codex / 'auth.json').write_text(json.dumps({'tokens': {'access_token': token,
                    'id_token': token, 'account_id': 'synthetic-account', 'refresh_token': 'synthetic-refresh'}}))
                # Account options: restrict detection to Codex, then choose all.
                answers = [('请选择 [', f'1\n1\n{url}\nPTY worker\n1\n'),
                           ('逐个选择账号', '3\n1\n1\n0\n2\n1\n'),
                           (running, '\x03')]
            else:
                config.parent.mkdir(parents=True, exist_ok=True)
                config.write_text(json.dumps({'hive': url, 'credential': 'bee_' + 'a' * 43,
                                               'name': 'PTY worker', 'identity': identity}))
                config.chmod(0o600)
                answers = [(prompt, '7\n4\n1\n' if advanced else '1\n2\n'), (running, '\x03')]
            try:
                code, out = self.terminal(answers, after_fork=worker.start, BEE_LANG=lang, TERM=term, NO_COLOR=no_color)
                self.assertEqual(code, 0, out)
                self.assertIn('Ctrl+C', out)
                self.assertIn('运行日志（原文）' if lang == 'zh' else 'Runtime logs (original)', out)
                self.assertLess(out.index(starting), out.index('Bee connected to Hive'))
                self.assertLess(out.index('Bee connected to Hive'), out.index(running))
                if term != 'dumb':
                    self.assertIn('✅ ' + running, out)
                else:
                    self.assertNotIn('✅', out)
                if no_color or term == 'dumb':
                    self.assertNotIn('\x1b', out)
                else:
                    self.assertIn('\x1b[1;32m✅ ' + running, out)
                self.assertNotIn('按回车返回', out)
                self.assertEqual(out.count('Bee 管理' if lang == 'zh' else 'Bee management'), 1, out)
                if not advanced:
                    self.assertNotIn('现在启动前台 Bee？', out)
                    self.assertNotIn('选择运行方式', out)
                    self.assertEqual(out.count('启动前是否需要引导配置？' if lang == 'zh' else 'Would you like guidance before starting?'), 1, out)
                self.assertIn(('GET', '/api/bee/agent' if guided else '/api/bee/connect'), requests)
                if guided:
                    self.assertIn(('POST', '/api/bee/pairings/redeem'), requests)
                    self.assertEqual(json.loads(config.read_text())['name'], 'PTY worker')
                    self.assertTrue(config.with_name('egress.json').exists())
                    self.assertNotIn('synthetic-refresh', out)
                else:
                    self.assertIn('仅保持在线' if lang == 'zh' else 'stays online without supplying accounts', out)
                    self.assertFalse(config.with_name('egress.json').exists())
            finally:
                server.shutdown()
                worker.join()

    def test_help_and_version_without_pairing(self):
        code, out = self.terminal([('请选择 [', '8\n1\n\n3\n\n0\n0\n')])
        self.assertEqual(code, 0, out)
        self.assertIn('Ctrl+C', out)
        self.assertIn('程序版本', out)
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
