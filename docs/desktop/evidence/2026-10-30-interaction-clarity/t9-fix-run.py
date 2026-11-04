import sys, pathlib, subprocess, os, json, hashlib, datetime, types
root=pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
evidence=root/'docs/desktop/evidence/2026-10-30-interaction-clarity'
name,cwd,*argv=sys.argv[1:]
assert name.startswith('t9-fix-')
log=evidence/(name+'.log'); meta=evidence/(name+'.json')
assert not log.exists() and not meta.exists(), name
paths=[]
for folder in ['desktop/src','desktop/tests','desktop/src-tauri/src','desktop/scripts','desktopbridge']:
    paths.extend(p for p in (root/folder).rglob('*') if p.is_file() and p.suffix in ['.ts','.tsx','.css','.html','.mjs','.rs','.go','.json'])
paths.extend(root/p for p in ['desktop/package.json','desktop/package-lock.json','desktop/playwright.device.config.ts','desktop/src-tauri/Cargo.toml','desktop/src-tauri/Cargo.lock','desktop/src-tauri/build.rs','desktop/src-tauri/tauri.conf.json','go.mod','go.sum','TEE_REVISION'] if (root/p).exists())
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
env=os.environ.copy(); env['PATH']='/Users/dayong/.nvm/versions/node/v24.22.1/bin:'+env['PATH']
info={'start_utc':utc(),'cwd':str(root/cwd),'argv':argv,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'dirty':subprocess.check_output(['git','status','--short'],cwd=root,text=True),'toolchain':{'node':subprocess.check_output(['/Users/dayong/.nvm/versions/node/v24.22.1/bin/node','--version'],text=True).strip(),'rust':subprocess.check_output(['rustc','+1.94','--version'],text=True).strip()},'source_sha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(paths))}}
with log.open('x') as output:
    output.write(json.dumps(info,ensure_ascii=False,indent=2)+'\n'); output.write('\nCOMMAND OUTPUT\n'); output.flush()
    try:
        result=subprocess.run(argv,cwd=root/cwd,env=env,stdout=output,stderr=subprocess.STDOUT)
    except KeyboardInterrupt:
        result=types.SimpleNamespace(returncode=130)
    info.update(end_utc=utc(),exit_code=result.returncode)
    output.write('\n'+json.dumps({'end_utc':info['end_utc'],'exit_code':result.returncode})+'\n')
meta.write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:info[k] for k in ['start_utc','end_utc','argv','exit_code']},ensure_ascii=False))
print('\n'.join(log.read_text().split('\nCOMMAND OUTPUT\n',1)[1].splitlines()[-100:]))
sys.exit(result.returncode)
