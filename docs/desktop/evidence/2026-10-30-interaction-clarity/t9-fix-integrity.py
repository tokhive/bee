import pathlib,json,hashlib,subprocess,datetime,struct
root=pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
evidence=root/'docs/desktop/evidence/2026-10-30-interaction-clarity'
base='ce2b542117c9332561f28d0fa6955b5070b1ef9c'
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
assert commit=='3b0b747ff2ca60f8cab621056207971806c75c43'
files=subprocess.check_output(['git','diff','--name-only',base,commit],cwd=root,text=True).splitlines()
assert files==['desktop/src-tauri/src/notifications.rs','desktop/src/i18n/en.ts','desktop/src/presentation/problems.ts','desktop/tests/native-updater.spec.ts','desktop/tests/problems.test.ts']
check={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'base':base,'commit':commit,'task_files':{},'verification_scope_matches':{},'screenshots':{}}
for path in files:
 content=(root/path).read_bytes(); blob=subprocess.check_output(['git','show',commit+':'+path],cwd=root)
 assert content==blob,path
 check['task_files'][path]={'sha256':hashlib.sha256(content).hexdigest(),'commit_matches_worktree':True}
for name in ['t9-fix-green-node24','t9-fix-green-updater-ui24','t9-fix-typecheck24','t9-fix-notifications194','t9-fix-manual-ego24']:
 meta=json.loads((evidence/(name+'.json')).read_text());assert meta['exit_code']==0,name
 mismatches=[p for p,h in meta['source_sha256'].items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h]
 assert not mismatches,(name,mismatches)
 check['verification_scope_matches'][name]={'source_count':len(meta['source_sha256']),'mismatches':mismatches}
previous=json.loads((evidence/'t9-final-manifest.json').read_text())
for path,entry in previous['artifacts'].items():
 actual=(evidence/path).read_bytes();assert hashlib.sha256(actual).hexdigest()==entry['sha256'],path
check['preserved_previous_artifacts']=len(previous['artifacts'])
check['previous_manifest_sha256']=hashlib.sha256((evidence/'t9-final-manifest.json').read_bytes()).hexdigest()
for name in ['t9-fix-ego-zh-previous-860.png','t9-fix-ego-en-previous-860.png']:
 w,h=struct.unpack('>II',(evidence/name).read_bytes()[16:24]);assert (w,h)==(860,600)
 check['screenshots'][name]={'width':w,'height':h}
subprocess.run(['git','diff','--check'],cwd=root,check=True)
subprocess.run(['git','diff','--cached','--check'],cwd=root,check=True)
assert not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=root,text=True).strip()
assert not subprocess.check_output(['git','diff','--name-only','HEAD','--',*files],cwd=root,text=True).strip()
check['clean_task_worktree_and_index']=True
check['sidecar_provenance']=json.loads((root/'desktop/src-tauri/binaries/bee-aarch64-apple-darwin.source.json').read_text())
assert check['sidecar_provenance']['revision']==base
assert hashlib.sha256((root/'desktop/src-tauri/binaries/bee-aarch64-apple-darwin').read_bytes()).hexdigest()==check['sidecar_provenance']['binarySha256']
check['sidecar_note']='Cargo tested before commit at BASE; source unchanged. Rebuild sidecar before any future Cargo at new HEAD.'
print(json.dumps(check,ensure_ascii=False,indent=2))
(evidence/'t9-fix-integrity-result.json').write_text(json.dumps(check,ensure_ascii=False,indent=2)+'\n')
