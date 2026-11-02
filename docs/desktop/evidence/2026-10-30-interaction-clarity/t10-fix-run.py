"""T10 命令原始记录；不读取用户凭据，不改全局环境。"""
import datetime, hashlib, json, os, pathlib, subprocess, sys

B = pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
H = B.parent / 'hive-desktop-interaction'
E = B / 'docs/desktop/evidence/2026-10-30-interaction-clarity'
name, cwd, *argv = sys.argv[1:]
env = os.environ.copy()
env.update(PATH='/Users/dayong/.nvm/versions/node/v24.22.1/bin:' + env['PATH'], RUSTUP_TOOLCHAIN='1.94', GOTOOLCHAIN='go1.27.3', BEE_DEVICE_TEST_PORT='1517', BEE_E2E_PORT='1518')
env.pop('NO_COLOR', None)
env.pop('FORCE_COLOR', None)
def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
sources = {}
for root, patterns in [(B, ['agent', 'beewire', 'desktopbridge', 'cmd', 'desktop/src', 'desktop/src-tauri/src', 'desktop/tests']), (H, ['hive/internal', 'hive/web/tests'])]:
    for pattern in patterns:
        for p in (root / pattern).rglob('*'):
            if p.is_file() and p.suffix in ('.go', '.rs', '.ts', '.tsx', '.mjs', '.css'):
                sources[str(p.relative_to(root)) if root == B else 'H/' + str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
# Include tracked build inputs outside the source directories; historical records
# remain untouched. Also include the fixture/config inputs added during T10.
for repo, prefix in [(B, ''), (H, 'H/')]:
    names = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=repo,text=True).splitlines()
    for source_name in names:
        p=repo/source_name
        if p.is_file() and not source_name.startswith(('docs/','.superpowers/','.cache/','.vite/','hive/web/dist/')) and (p.suffix in ('.go','.rs','.ts','.tsx','.mjs','.css','.toml','.json','.lock','.sum','.mod','.yaml','.html') or p.name in ('Makefile','go.mod','go.sum','Cargo.lock')):
            sources[prefix+source_name]=hashlib.sha256(p.read_bytes()).hexdigest()
meta = dict(started_at=now(), cwd=cwd, argv=argv, bee_head=git(B,'rev-parse','HEAD'), hive_head=git(H,'rev-parse','HEAD'), hive_bee_gitlink=git(H,'rev-parse','HEAD:bee'), bee_dirty=git(B,'status','--short'), hive_dirty=git(H,'status','--short'), source_sha256=sources)
for key, command in [('node',['node','--version']),('rust',['rustc','--version']),('go',['go','version'])]:
    meta[key] = subprocess.check_output(command, cwd=cwd, env=env, text=True).strip()
path = E / ('t10-fix-' + name)
if path.with_suffix('.log').exists():
    raise SystemExit('Refusing to overwrite evidence: ' + str(path))
path.with_suffix('.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2))
with path.with_suffix('.log').open('w') as log:
    log.write(json.dumps({k:v for k,v in meta.items() if k != 'source_sha256'},ensure_ascii=False)+'\n');log.flush()
    result = subprocess.run(argv, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    meta.update(finished_at=now(), exit=result.returncode)
    log.write(json.dumps(dict(finished_at=meta['finished_at'],exit=meta['exit']))+'\n')
path.with_suffix('.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
print(json.dumps(dict(log=str(path.with_suffix('.log')),exit=result.returncode)))
print('\n'.join(path.with_suffix('.log').read_text(errors='replace').splitlines()[1:][-22:]))
sys.exit(result.returncode)
