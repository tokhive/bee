"""只读核对本轮来源、旧证据和资源，生成独立增量manifest；不改写旧记录。"""
import datetime
import hashlib
import json
import pathlib
import struct
import subprocess

B = pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
H = B.parent / 'hive-desktop-interaction'
E = B / 'docs/desktop/evidence/2026-10-30-interaction-clarity'
PRODUCT = 'dd554529e8803f2791f26ab99c9ee5178a9479fd'
PRODUCT_PATHS = [
    'desktop/src/presentation/problems.ts', 'desktop/src/i18n/en.ts',
    'desktop/tests/problems.test.ts', 'desktop/tests/preview-scenarios.spec.ts',
    'desktop/tests/t10-layout-fix.spec.ts',
]
FINAL_COMMANDS = ['problems-green', 's05-green', 'selector-final', 'typecheck', 'build', 'ego-capture-v3']
MANIFEST = E / 't10-fix2-source-manifest.json'
INTEGRITY = E / 't10-fix2-integrity-result.json'
assert not MANIFEST.exists() and not INTEGRITY.exists(), 'refusing to overwrite fix2 final records'

def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()

def record(path):
    data = path.read_bytes()
    return {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

initial = json.loads((E / 't10-fix2-initial-state.json').read_text())
assert git(B, 'rev-parse', 'HEAD') == PRODUCT
assert git(B, 'rev-parse', PRODUCT + '^') == initial['bee_head']
assert git(H, 'rev-parse', 'HEAD') == initial['hive_head']
assert git(H, 'rev-parse', 'HEAD:bee') == initial['hive_gitlink']
assert git(H, 'status', '--porcelain=v1', '--untracked-files=all') == initial['hive_status']
assert not git(B, 'diff', '--cached', '--name-only'), 'unexpected staged files before evidence commit'

for name, expected in initial['preexisting_dirty_and_untracked'].items():
    assert record(B / name) == {key: expected[key] for key in ['size', 'sha256']}, name
for name, expected in initial['historical_evidence'].items():
    assert record(B / name) == expected, name
assert sorted(git(B, 'diff-tree', '--no-commit-id', '--name-only', '-r', PRODUCT).splitlines()) == sorted(PRODUCT_PATHS)
for name in PRODUCT_PATHS:
    blob = subprocess.check_output(['git', 'show', PRODUCT + ':' + name], cwd=B)
    assert hashlib.sha256(blob).hexdigest() == record(B / name)['sha256'], name

reference = json.loads((E / 't10-fix2-s05-green.json').read_text())['source_sha256']
for command in FINAL_COMMANDS:
    metadata = json.loads((E / ('t10-fix2-' + command + '.json')).read_text())
    assert metadata['exit'] == 0, command
    assert metadata['source_sha256'] == reference, command
for name, expected in reference.items():
    path = H / name[2:] if name.startswith('H/') else B / name
    assert record(path)['sha256'] == expected, name
for name in [
    'desktop/tests/fixtures/native-accounts.mjs', 'desktop/tests/fixtures/bee-preview/fixture.mjs',
    'desktop/tests/fixtures/bee-preview/scenarios.mjs', 'desktop/tests/fixtures/bee-preview/viewer.mjs',
    'desktop/playwright.preview.config.ts', 'desktop/playwright.t10-layout.config.ts',
    'desktop/package.json', 'desktop/package-lock.json', 'desktop/tsconfig.json',
]:
    assert name in reference, 'missing required fixture/config/lock input: ' + name

ports = {}
for port in [1518, 1519]:
    result = subprocess.run(['lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN'], capture_output=True, text=True)
    assert result.returncode == 1 and not result.stdout.strip(), {'port': port, 'stdout': result.stdout, 'stderr': result.stderr}
    ports[str(port)] = {'lsof_exit': result.returncode, 'listeners': []}
finish = (E / 't10-fix2-ego-finish.log').read_text()
assert 'closedSpace: true' in finish and 'spaceId: 42' in finish and 'preservedUnmanagedCount: 0' in finish

screenshots = {}
for path in sorted(E.rglob('t10-fix2-*.png')):
    screenshots[str(path.relative_to(B))] = dict(zip(['width', 'height'], struct.unpack('>II', path.read_bytes()[16:24])))
for path in sorted((E / 't10-fix2-s05-green-output').rglob('*.png')):
    screenshots[str(path.relative_to(B))] = dict(zip(['width', 'height'], struct.unpack('>II', path.read_bytes()[16:24])))
for name, size in screenshots.items():
    assert size == {'width': 860, 'height': 600}, {'path': name, 'actual': size}

ego = json.loads((E / 't10-fix2-ego-v3-result.json').read_text())
assert len(ego['states']) == 4
for state in ego['states']:
    assert state['entry']['viewport'] == {'width': 860, 'height': 600}
    assert state['entry']['reducedMotion'] is True and state['expanded']['focused'] is True
    assert state['expanded']['detailsOpen'] is True

integrity = {
    'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'bee_base': initial['bee_head'], 'bee_product_commit': PRODUCT,
    'hive_head': initial['hive_head'], 'hive_gitlink': initial['hive_gitlink'],
    'preexisting_dirty_untracked_unchanged': len(initial['preexisting_dirty_and_untracked']),
    'historical_artifacts_unchanged': len(initial['historical_evidence']),
    'historical_artifact_records': initial['historical_evidence'],
    'all_final_command_sources_match': len(reference), 'final_commands': FINAL_COMMANDS,
    'product_commit_paths': PRODUCT_PATHS, 'product_commit_blobs_match': True,
    'hive_status_unchanged': True, 'task_ports': ports,
    'ego_space42_exactly_once_finish': {'closedSpace': True, 'keep': [], 'source': 't10-fix2-ego-finish.log'},
    'screenshot_actual_dimensions': screenshots,
    'manual_viewed_representatives': ['t10-fix2-ego-v3-protocol-zh-light-details.png', 't10-fix2-ego-v3-integrity-en-dark-details.png'],
    'exit': 0,
}
INTEGRITY.write_text(json.dumps(integrity, ensure_ascii=False, indent=2))

commands = []
for path in sorted(E.glob('t10-fix2-*.json')):
    metadata = json.loads(path.read_text())
    if 'argv' in metadata and 'source_sha256' in metadata:
        assert 'finished_at' in metadata and 'exit' in metadata, path.name
        commands.append({'metadata': str(path.relative_to(B)), 'log': str(path.with_suffix('.log').relative_to(B)),
                         **{key: metadata[key] for key in ['argv', 'cwd', 'started_at', 'finished_at', 'exit', 'node', 'rust', 'go']}})

artifacts = {}
for path in sorted(E.rglob('*')):
    if not path.is_file() or path == MANIFEST:
        continue
    name = str(path.relative_to(B))
    if name not in initial['historical_evidence']:
        assert path.relative_to(E).parts[0].startswith('t10-fix2-'), name
        artifacts[name] = record(path)

manifest = {
    'schema': 'T10 fix2 增量来源与产物清单', 'generated_at': integrity['observed_at'],
    'bee_base': initial['bee_head'], 'bee_product_commit': PRODUCT,
    'hive_head': initial['hive_head'], 'hive_gitlink': initial['hive_gitlink'],
    'scope': '仅预览直接消费者和S05两码TS/i18n；非全分支或原生整体验收',
    'source_sha256': reference,
    'changed_source_sha256': {name: record(B / name) for name in PRODUCT_PATHS},
    'validation_document': {'path': 'docs/desktop/interaction-clarity-validation.md', **record(B / 'docs/desktop/interaction-clarity-validation.md')},
    'commands': commands,
    'finalization': {'cwd': str(B), 'argv': ['python3', str(pathlib.Path(__file__).relative_to(B))], 'exit': 0},
    'final_command_sources_match': FINAL_COMMANDS,
    'artifacts': artifacts, 'artifact_count_excluding_manifest_itself': len(artifacts),
    'manifest_self_reference': '本manifest自身不递归记录自身SHA；其提交blob和SHA由提交后自检另行绑定。',
    'build_outputs': {str(path.relative_to(B)): record(path) for path in sorted((B / 'desktop/dist').rglob('*')) if path.is_file()},
    'preservation': {'initial_snapshot': 't10-fix2-initial-state.json', 'integrity_result': 't10-fix2-integrity-result.json',
                     'preexisting_dirty_untracked_unchanged': integrity['preexisting_dirty_untracked_unchanged'],
                     'historical_artifacts_unchanged': integrity['historical_artifacts_unchanged']},
    'warnings': ['build主JS chunk 680.22kB，大于500kB', 'Ego提示更新但未升级'],
    'retained_failures': {'selector-red': '实际74/76确定性断言失败', 'problems-red': '22项中4个新增摘要断言失败',
                          's05-red': '两码×中英4个具体摘要断言失败', 'ego-capture': '实际1512×833/reducedMotion=false，未达到860门禁',
                          'ego-capture-v2': '第一组合后下一次导航失去CDP注入而超时；原部分图保留',
                          'vite': '主动SIGTERM清理；原始exit143不是测试失败'},
    'remaining': ['S05复合行其余真实配置/协议/包失败和原生恢复', '专用官方账号和受控请求', '三端真实桌面/隔离macOS GUI',
                  '签名更新安装重启', '无token人工恢复闭环', '既有最终二进制其余网络故障变体', '主控后续全分支门禁'],
}
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({'exit': 0, 'product_commit': PRODUCT, 'source_count': len(reference), 'artifact_count': len(artifacts),
                  'historical_artifacts_unchanged': integrity['historical_artifacts_unchanged'],
                  'preexisting_dirty_untracked_unchanged': integrity['preexisting_dirty_untracked_unchanged'],
                  'manifest': str(MANIFEST), 'manifest_record': record(MANIFEST)}, ensure_ascii=False))
