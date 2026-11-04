import datetime
import hashlib
import json
import pathlib
import struct
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
evidence = root / '.superpowers/sdd'
baseline = 'c3cc10284f8379a5343bc52b0b6a73292d22276d'
paths = ['desktop/src/features/settings/NativeSettingsPage.tsx', 'desktop/tests/native-experience.spec.ts']
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
def write(name, value):
    (evidence / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

head = git('rev-parse', 'HEAD')
assert head == '49f72989f38a07e83fe9614ef15a69a82397ff1d'
assert sorted(git('diff-tree', '--no-commit-id', '--name-only', '-r', head).splitlines()) == sorted(paths)
assert git('diff', '--cached', '--name-only') == ''
files = []
for path in paths:
    current = sha(root / path)
    committed = hashlib.sha256(subprocess.check_output(['git', 'show', f'{head}:{path}'], cwd=root)).hexdigest()
    assert current == committed
    files.append({'path': path, 'sha256': current, 'git_blob': git('rev-parse', f'{head}:{path}')})
for name in ['final-ui', 'final-typecheck', 'final-diff-check', 'manual-01-command', 'manual-02-command', 'manual-03-command', 'manual-04-command']:
    meta = json.loads((evidence / f't8-fix-{name}.json').read_text())
    assert meta['exit'] == 0
    assert meta['source_sha256'] == {f['path']: f['sha256'] for f in files}
assert '64 passed' in (evidence / 't8-fix-final-ui.log').read_text()
source_manifest = {'baseline': baseline, 'commit': head, 'files': files, 'verification_source_hashes_match': True}
write('t8-fix-source-manifest.json', source_manifest)

dirty = subprocess.check_output(['git', 'status', '--short'], cwd=root, text=True)
initial_dirty = json.loads((evidence / 't8-fix-red-ui.json').read_text())['dirty']
outside_initial = [line for line in initial_dirty.splitlines() if line[3:] not in paths]
assert dirty.splitlines() == outside_initial
write('t8-fix-commit-state.json', {'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseline':baseline,'head':head,'subject':git('show','-s','--format=%s',head),'committed_paths':paths,'index_empty':True,'outside_dirty_status_preserved':True,'dirty':dirty,'raw_argv':['git rev-parse HEAD','git diff-tree --no-commit-id --name-only -r HEAD','git diff --cached --name-only','git status --short']})

images = []
for path in sorted(evidence.glob('t8-fix-*.png')):
    data = path.read_bytes()
    width, height = struct.unpack('>II', data[16:24])
    images.append({'path':str(path.relative_to(root)),'actual_png_width':width,'actual_png_height':height,'sha256':sha(path),'note':'Filename says 860; actual 1512x833. Original retained, use manual-03/04 for 860 evidence.' if 'manual-02-' in path.name else 'Original screenshot; no crop or resampling.'})
write('t8-fix-image-sizes.json', {'images':images,'path_mapping':[],'path_mapping_note':'All evidence was created under .superpowers/sdd/t8-fix-* and remains at its original path; nothing moved.'})

entries = []
for path in sorted(evidence.rglob('*')):
    relative = path.relative_to(evidence)
    if not path.is_file() or not relative.parts[0].startswith('t8-fix-') or path.name == 't8-fix-evidence-manifest.json':
        continue
    entries.append({'path':str(path.relative_to(root)),'bytes':path.stat().st_size,'sha256':sha(path)})
write('t8-fix-evidence-manifest.json', {'commit':head,'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'file_count':len(entries),'excluded':['.superpowers/sdd/t8-fix-evidence-manifest.json','.superpowers/sdd/T8-fix-report.md'],'files':entries})
print(json.dumps({'commit':head,'source_manifest_sha256':sha(evidence/'t8-fix-source-manifest.json'),'evidence_manifest_sha256':sha(evidence/'t8-fix-evidence-manifest.json'),'evidence_file_count':len(entries),'files':files},ensure_ascii=False,indent=2))
