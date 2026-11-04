import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2]
name, cwd_name, *argv = sys.argv[1:]
if argv[0] == '--':
    argv.pop(0)
cwd = root / cwd_name
evidence = root / '.superpowers/sdd'
meta = {
    'start_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'cwd': str(cwd), 'argv': argv,
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'dirty': subprocess.check_output(['git', 'status', '--short'], cwd=root, text=True),
}
meta['source_sha256'] = {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in [
    'desktop/src/features/settings/NativeSettingsPage.tsx',
    'desktop/tests/native-experience.spec.ts',
]}
child_env = os.environ.copy()
if argv[0] == 'env':
    env_args = iter(argv[1:])
    for arg in env_args:
        if arg == '-u':
            child_env.pop(next(env_args), None)
        elif '=' in arg:
            key, value = arg.split('=', 1)
            child_env[key] = value
        else:
            break
meta['test_environment'] = {key: child_env.get(key) for key in ['BEE_DEVICE_TEST_PORT', 'BEE_E2E_PORT', 'NO_COLOR', 'FORCE_COLOR']}
log_path = evidence / f't8-fix-{name}.log'
with log_path.open('w') as log:
    log.write(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    log.flush()
    result = subprocess.run(argv, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    meta.update(end_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(), exit=result.returncode)
    log.write('\n' + json.dumps({'end_utc': meta['end_utc'], 'exit': result.returncode}) + '\n')
(evidence / f't8-fix-{name}.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'log': str(log_path), **meta}, ensure_ascii=False, indent=2))
sys.exit(result.returncode)
