"""只读审计本轮来源、旧文件与自有资源；默认仅新增唯一保持回执。"""
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys

B = pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
H = B.parent / 'hive-desktop-interaction'
E = B / 'docs/desktop/evidence/2026-10-30-interaction-clarity'
PRODUCT = '843e3fff557d723ed8626c081f8cecf2567856a5'
PATHS = [
    'agent/desktop_connection_test.go', 'agent/desktop_runtime_sync.go',
    'agent/desktop_runtime_test.go', 'desktop/playwright.final-fix.config.ts',
    'desktop/tests/fixtures/bee-preview/fixture.mjs',
    'desktop/tests/fixtures/synchronization-recovery.json',
    'desktop/tests/t10-layout-fix.spec.ts',
]


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()


def record(path):
    data = path.read_bytes()
    return {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def preserved(entries):
    differences = []
    for name, expected in entries.items():
        path = B / name
        actual = record(path) if path.is_file() else None
        wanted = {key: expected[key] for key in ('size', 'sha256')}
        if actual != wanted:
            differences.append({'path': name, 'expected': wanted, 'actual': actual})
    assert not differences, differences
    return {'count': len(entries), 'differences': differences, 'exclusions': []}


baseline = json.loads((E / 'final-fix-baseline.json').read_text())
prior = json.loads((E / 't10-fix2-initial-state.json').read_text())
result = {
    'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'bee_head': git(B, 'rev-parse', 'HEAD'), 'bee_product_commit': PRODUCT,
    'preservation': {
        'complete_preexisting_dirty_untracked': preserved(prior['preexisting_dirty_and_untracked']),
        'current_round_dirty_baseline': preserved(baseline['dirty_files']),
        'current_round_historical_evidence': preserved(baseline['old_evidence']),
    },
}
subprocess.run(['git', 'merge-base', '--is-ancestor', PRODUCT, 'HEAD'], cwd=B, check=True)
assert git(B, 'rev-parse', PRODUCT + '^') == baseline['bee_head']
assert sorted(git(B, 'diff-tree', '--no-commit-id', '--name-only', '-r', PRODUCT).splitlines()) == sorted(PATHS)
result['product_sources'] = {}
for name in PATHS:
    blob = subprocess.check_output(['git', 'show', PRODUCT + ':' + name], cwd=B)
    actual = record(B / name)
    assert hashlib.sha256(blob).hexdigest() == actual['sha256'], name
    result['product_sources'][name] = dict(actual, commit_blob_sha256=hashlib.sha256(blob).hexdigest())

coverage = {
    'green-runtime-worker': ['agent/desktop_runtime_sync.go', 'agent/desktop_runtime_test.go'],
    'affected-go-race': ['agent/desktop_runtime_sync.go', 'agent/desktop_runtime_test.go'],
    'affected-go-vet': ['agent/desktop_runtime_sync.go', 'agent/desktop_runtime_test.go'],
    'scope-barriers-race': PATHS[:3],
    'green-components-final': PATHS,
    'fixture-direct-consumers-final': PATHS,
    'typecheck-committed': PATHS,
    'linux-core-build': ['agent/desktop_runtime_sync.go'],
}
result['verification_source_coverage'] = {}
for command, paths in coverage.items():
    metadata = json.loads((E / ('final-fix-' + command + '.json')).read_text())
    assert metadata['exit'] == 0, command
    for name in paths:
        assert metadata['source_sha256'][name] == result['product_sources'][name]['sha256'], (command, name)
    differences = [name for name in PATHS if metadata['source_sha256'].get(name) != result['product_sources'][name]['sha256']]
    result['verification_source_coverage'][command] = {'covered_final_paths': paths, 'other_product_path_differences': differences, 'metadata': 'final-fix-' + command + '.json'}
for command, name in [('red-runtime', 'agent/desktop_runtime_sync.go'), ('red-d06-native', 'desktop/tests/fixtures/bee-preview/fixture.mjs')]:
    metadata = json.loads((E / ('final-fix-' + command + '.json')).read_text())
    blob = subprocess.check_output(['git', 'show', baseline['bee_head'] + ':' + name], cwd=B)
    assert metadata['exit'] == 1 and metadata['source_sha256'][name] == hashlib.sha256(blob).hexdigest(), command
result['behavior_red_inputs_match_base'] = True
core = json.loads((E / 'final-fix-linux-core-build.json').read_text())
for name, expected in core['source_sha256'].items():
    if name.endswith('.go') and not name.endswith('_test.go') and not name.startswith('H/'):
        assert record(B / name)['sha256'] == expected, name
hive_build = json.loads((E / 'final-fix-linux-hive-test-build.json').read_text())
for name, expected in hive_build['source_sha256'].items():
    if name.startswith('H/'):
        assert record(H / name[2:])['sha256'] == expected, name
result['binary_build_sources_unchanged'] = True
result['hive'] = {'head': git(H, 'rev-parse', 'HEAD'), 'gitlink': git(H, 'rev-parse', 'HEAD:bee'), 'status': git(H, 'status', '--porcelain=v1', '--untracked-files=all')}
assert result['hive'] == {'head': baseline['hive_head'], 'gitlink': baseline['hive_gitlink'], 'status': baseline['hive_status'].strip()}

validation = B / 'docs/desktop/interaction-clarity-validation.md'
links = [target for target in re.findall(r'\]\(([^)]+)\)', validation.read_text()) if '/final-fix-' in target]
for target in links:
    assert (validation.parent / target).is_file(), target
result['new_validation_links'] = {'count': len(links), 'targets': links, 'all_exist': True}
result['ports'] = {}
for port in [1518, 1519]:
    check = subprocess.run(['lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN'], capture_output=True, text=True)
    assert check.returncode == 1 and not check.stdout.strip(), (port, check.stdout, check.stderr)
    result['ports'][str(port)] = {'argv': check.args, 'exit': check.returncode, 'stdout': check.stdout, 'stderr': check.stderr}
result['docker'] = {}
for kind, argv in [('containers', ['docker', 'ps', '-a', '--filter', 'name=bee-final-fix-', '--format', '{{.Names}}']), ('networks', ['docker', 'network', 'ls', '--filter', 'name=bee-final-fix-', '--format', '{{.Name}}'])]:
    check = subprocess.run(argv, capture_output=True, text=True)
    assert check.returncode == 0 and not check.stdout.strip(), (argv, check.stdout, check.stderr)
    result['docker'][kind] = {'argv': argv, 'exit': check.returncode, 'stdout': check.stdout, 'stderr': check.stderr}
finish = json.loads((E / 'final-fix-ego-finish-receipt.json').read_text())
assert finish['spaceId'] == 43 and finish['completedFinishCalls'] == 1
assert finish['receipt'] == {'spaceId': 43, 'closedSpace': True, 'keptManagedLabels': [], 'closedManagedLabels': ['p1'], 'preservedUnmanagedCount': 0}
result['ego_finish'] = finish
d06 = json.loads((E / 'final-fix-ego-d06.json').read_text())['actual']
runtime = json.loads((E / 'final-fix-ego-runtime.json').read_text())['recovered']
for actual in [d06, runtime]:
    assert actual['viewport'] == {'width': 1512, 'height': 833} and actual['reducedMotion'] is False
result['visual_layers'] = {'ego': {'viewport': {'width': 1512, 'height': 833}, 'reducedMotion': False}, 'playwright': {'viewport': {'width': 860, 'height': 600}, 'reducedMotion': True}}
component_records = []
for path in sorted((E / 'final-fix-green-components-final-output').rglob('*.json')):
    data = json.loads(path.read_text())
    if 'actual' in data:
        assert data['actual']['viewport'] == {'width': 860, 'height': 600} and data['actual']['reducedMotion'] is True
        component_records.append(str(path.relative_to(B)))
assert len(component_records) == 5, component_records
result['visual_layers']['playwright']['records'] = component_records
result['external_binaries'] = {}
for name, size, sha in [
    ('bee-final-fix', 30965181, '313a32810ac16b5fa9d640c8fdfb41995817d14da2d2cb49d1840151caa5329c'),
    ('hive-integration-final-fix.test', 71859248, '148825231574ecc350bfa890d8c5b36bf69ab3793e2df7a2e8f726aaea599706'),
]:
    path = B / '.cache/interaction-clarity-linux' / name
    actual = record(path)
    assert actual == {'size': size, 'sha256': sha}, name
    result['external_binaries'][str(path)] = actual
diff_check = subprocess.run(['git', 'diff', '--check'], cwd=B, capture_output=True, text=True)
assert diff_check.returncode == 0, diff_check.stdout + diff_check.stderr
result['git_diff_check'] = {'exit': diff_check.returncode, 'stdout': diff_check.stdout, 'stderr': diff_check.stderr}
result['passed'] = True
if '--stdout-only' not in sys.argv:
    output = E / 'final-fix-preservation.json'
    with output.open('x') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
print(json.dumps(result, ensure_ascii=False, indent=2))
