import datetime
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[4]
evidence = Path(__file__).resolve().parent
base = '267a33d38db3a09f0c47917419e36055a6660ee6'
sources = [
    'desktop/src/features/accounts/AccountDisplay.tsx',
    'desktop/src/features/accounts/NativeAccountActions.tsx',
    'desktop/src/features/accounts/NativeAccountDetails.tsx',
    'desktop/src/features/accounts/NativeAccountList.tsx',
    'desktop/src/features/accounts/accountPresentation.ts',
    'desktop/src/features/accounts/useAccounts.ts',
    'desktop/src/i18n/en.ts',
    'desktop/src/i18n/zh.ts',
    'desktop/src/presentation/problems.ts',
    'desktop/src/styles/app.css',
    'desktop/tests/account-auto-read.spec.ts',
    'desktop/tests/accountPresentation.test.ts',
    'desktop/tests/fixtures/native-accounts.mjs',
    'desktop/tests/native-accounts.spec.ts',
    'desktop/tests/problems.test.ts',
]


def record(path):
    return {
        'path': str(path.relative_to(root)),
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'bytes': path.stat().st_size,
    }


def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()


metadata = {
    'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'workspace': str(root),
    'base': base,
    'head': git('rev-parse', 'HEAD'),
    'dirty': git('status', '--short'),
}
traces = sorted(path for path in evidence.glob('t7-fix-*/**/trace.zip'))
(evidence / 't7-fix-source-manifest.json').write_text(json.dumps({
    **metadata,
    'sources': [record(root / name) for name in sources],
    'preserved_traces': [record(path) for path in traces],
}, ensure_ascii=False, indent=2) + '\n')
excluded = {'t7-fix-source-manifest.json', 't7-fix-evidence-manifest.json'}
artifacts = sorted(path for path in evidence.rglob('*')
                   if path.is_file() and path.name not in excluded
                   and path.relative_to(evidence).parts[0].startswith('t7-fix-'))
(evidence / 't7-fix-evidence-manifest.json').write_text(json.dumps({
    **metadata,
    'artifacts': [record(path) for path in artifacts],
}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'head': metadata['head'], 'sources': len(sources),
                  'preserved_traces': len(traces), 'artifacts': len(artifacts)}))
