"""保留初版manifest，增量绑定暂存检查原始失败与精确排除后的结果。"""
import datetime
import hashlib
import json
import pathlib

B = pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
E = B / 'docs/desktop/evidence/2026-10-30-interaction-clarity'
OLD = E / 'final-fix-manifest.json'
NEW = E / 'final-fix-manifest-v2.json'
REPORT = B / '.superpowers/sdd/final-fix-report.md'
assert not NEW.exists(), 'refusing to overwrite v2 manifest'


def record(path):
    data = path.read_bytes()
    return {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


manifest = json.loads(OLD.read_text())
for name, expected in manifest['new_artifacts'].items():
    assert record(B / name) == expected, name
manifest['supersedes'] = {'path': str(OLD.relative_to(B)), **record(OLD), 'reason': '初版冻结后暂存检查发现机器原始输出尾随空格；保留原字节及失败检查，新增明确排除检查记录。'}
manifest['observed_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest['new_artifacts'] = {
    str(path.relative_to(B)): record(path)
    for path in sorted(E.rglob('*'))
    if path.is_file() and path.relative_to(E).parts[0].startswith('final-fix-') and path != NEW
}
manifest['new_artifact_count'] = len(manifest['new_artifacts'])
for name in ['staged-diff-check', 'staged-authored-check']:
    path = E / ('final-fix-' + name + '.json')
    data = json.loads(path.read_text())
    manifest['commands'][path.stem] = {
        key: data[key] for key in ['cwd', 'argv', 'started_at', 'finished_at', 'exit', 'bee_head', 'hive_head', 'hive_bee_gitlink', 'node', 'go', 'rust']
    }
    manifest['commands'][path.stem].update(metadata=str(path.relative_to(B)), log=str(path.with_suffix('.log').relative_to(B)), source_count=len(data['source_sha256']), source_index_sha256=hashlib.sha256(json.dumps(data['source_sha256'], sort_keys=True).encode()).hexdigest())
assert manifest['commands']['final-fix-staged-diff-check']['exit'] == 2
assert manifest['commands']['final-fix-staged-authored-check']['exit'] == 0
manifest['staged_whitespace_boundary'] = {
    'original_exit': 2, 'trailing_whitespace_reports': 44,
    'original_raw_artifacts': 5, 'rewritten_raw_artifacts': 0,
    'authored_check_exit': 0,
    'exclusions': manifest['commands']['final-fix-staged-authored-check']['argv'][6:],
    'boundary': '仅排除明确的原始log/error-context及该失败检查的逐字输出；不清洗证据，不排除源码或手写文档。',
}
with NEW.open('x') as stream:
    json.dump(manifest, stream, ensure_ascii=False, indent=2)
text = REPORT.read_text()
old_link = '[final-fix-manifest.json](' + str(OLD) + ')'
new_link = '[final-fix-manifest-v2.json](' + str(NEW) + ')'
text = text.replace(old_link, new_link).replace('及141份本轮新artifact', '及' + str(manifest['new_artifact_count']) + '份本轮新artifact')
marker = '自检：两项发现的全部要求均有对应实现/行为或版本屏障证据；'
note = '提交前全暂存 `git diff --cached --check` 实际exit=2，44处尾随空格全部来自5份机器原始log/error-context。保留原字节；仅排除这些明确路径及检查失败原文log后，源码/手写脚本/台账检查exit=0。原始输出为 [final-fix-staged-diff-check.log](' + str(E / 'final-fix-staged-diff-check.log') + ')；精确排除与结果为 [final-fix-staged-authored-check.json](' + str(E / 'final-fix-staged-authored-check.json') + ')。初版manifest未覆盖，v2将初版及新增检查一起散列绑定。一次只读路径分类探针最初只允许error-context而断言失败；核明原始log同样含尾随空格后收窄到实际5份原始artifact，未改产品或放宽源码检查。\n\n'
assert marker in text
text = text.replace(marker, note + marker)
for name in ['final-fix-staged-diff-check', 'final-fix-staged-authored-check']:
    data = manifest['commands'][name]
    text += '\n### ' + name + '\n\n'
    text += '- cwd：`' + data['cwd'] + '`\n'
    text += '- argv：`' + json.dumps(data['argv'], ensure_ascii=False) + '`\n'
    text += '- UTC：`' + data['started_at'] + '` → `' + data['finished_at'] + '`；exit=`' + str(data['exit']) + '`。\n'
    text += '- 工具：`' + data['node'] + '`；`' + data['go'] + '`；`' + data['rust'] + '`；来源索引 ' + str(data['source_count']) + ' 项。\n'
    text += '- [metadata/真实输入SHA](' + str(B / data['metadata']) + ')；[完整原始输出](' + str(B / data['log']) + ')。\n'
REPORT.write_text(text)
print(json.dumps({'manifest': str(NEW), 'artifacts': manifest['new_artifact_count'], 'commands': len(manifest['commands']), 'raw_originals_preserved': True}, ensure_ascii=False))
