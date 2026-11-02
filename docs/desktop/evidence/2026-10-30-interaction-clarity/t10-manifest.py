"""归档T10原始证据；保留历史命令来源，不将当前SHA回填旧记录。"""
import datetime,hashlib,json,pathlib,struct,subprocess
B=pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
H=B.parent/'hive-desktop-interaction'
E=B/'docs/desktop/evidence/2026-10-30-interaction-clarity'
OUT=E/'t10-final-source-manifest.json'
def git(root,*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
files=[]
for top in sorted(E.iterdir()):
 if not top.name.startswith('t10-'):continue
 for p in sorted(top.rglob('*')) if top.is_dir() else [top]:
  if not p.is_file() or p==OUT:continue
  entry={'path':str(p.relative_to(B)),'sha256':sha(p),'bytes':p.stat().st_size}
  if p.suffix=='.png':entry['dimensions']=dict(zip(['width','height'],struct.unpack('>II',p.read_bytes()[16:24])))
  files.append(entry)
product={}
for n in git(B,'ls-files','agent','beewire','desktopbridge','cmd','logx','relay','telemetry','desktop/src','desktop/src-tauri/src','desktop/scripts','go.mod','go.sum','desktop/package.json','desktop/package-lock.json','desktop/src-tauri/Cargo.toml','desktop/src-tauri/Cargo.lock').splitlines():
 p=B/n
 if p.is_file():product[n]=sha(p)
subprocess.run(['git','diff','--exit-code','HEAD','--',*product.keys()],cwd=B,check=True,stdout=subprocess.DEVNULL)
task=[
'desktop/playwright.config.ts','desktop/playwright.device.config.ts','desktop/playwright.t10-layout.config.ts',
'desktop/tests/device.spec.ts','desktop/tests/device-recovery.spec.ts','desktop/tests/native-accounts.spec.ts','desktop/tests/native-runtime.spec.ts','desktop/tests/native-updater.spec.ts','desktop/tests/supply.spec.ts','desktop/tests/preview-scenarios.spec.ts',
'desktop/tests/t10-layout.spec.ts','desktop/tests/t10-layout-supplement.spec.ts','desktop/tests/fixtures/t10-layout-cases.json',
'desktop/tests/fixtures/bee-preview/app.mjs','desktop/tests/fixtures/bee-preview/fixture.mjs','desktop/tests/fixtures/bee-preview/scenarios.mjs',
'docs/desktop/account-runtime-validation.md','docs/desktop/bridge-protocol.md','docs/desktop/supply-control.md','docs/desktop/interaction-clarity-validation.md']
hsources=['hive/internal/integration/desktop_broker_test.go','hive/internal/integration/desktop_runtime_broker_test.go','docs/bee-supply.md']
for n in hsources:
 committed=subprocess.check_output(['git','show','HEAD:'+n],cwd=H)
 assert hashlib.sha256(committed).hexdigest()==sha(H/n),n
binary=B/'.cache/interaction-clarity-linux/bee-final'
data={'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bee_product_head':git(B,'rev-parse','HEAD'),'hive_final_test_head':git(H,'rev-parse','HEAD'),'hive_bee_gitlink':git(H,'rev-parse','HEAD:bee'),'bee_product_sources_match_head':True,'hive_test_sources_match_commit':True,'linux_bee':{'path':str(binary),'sha256':sha(binary)},'bee_product_source_sha256':product,'bee_task_source_sha256':{n:sha(B/n)for n in task},'hive_task_source_sha256':{n:sha(H/n)for n in hsources},'evidence_count':len(files),'evidence':files,'scope':'仅本轮t10前缀证据，排除本manifest自引用；历史命令源SHA以各次JSON为准；ignored交接报告不属于manifest源表。测试/文档提交不重标已构建产品二进制。'}
OUT.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'evidence_count':len(files),'product_sources':len(product),'task_sources':len(task),'hive_head':data['hive_final_test_head'],'linux_binary_sha256':data['linux_bee']['sha256']}))
