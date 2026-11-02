"""冻结本次修复源与证据；不重写旧manifest或任何旧artifact。"""
import datetime, hashlib, json, pathlib, subprocess

B=pathlib.Path(__file__).resolve().parents[4]
H=B.parent/'hive-desktop-interaction'
E=pathlib.Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(root,*args):return subprocess.check_output(['git',*args],cwd=root).strip()
old_path=E/'t10-final-source-manifest.json'
old=json.loads(old_path.read_text())
old_blob=subprocess.check_output(['git','show','5dec62186aaf41bd8b54059eded7e73df1730b6d:'+str(old_path.relative_to(B))],cwd=B)
assert old_blob==old_path.read_bytes(), 'Original manifest differs from baseline blob'
for item in old['evidence']:assert sha(B/item['path'])==item['sha256'], 'Original artifact changed: '+item['path']
for name,digest in old['bee_product_source_sha256'].items():assert sha(B/name)==digest, 'Product source changed: '+name
bee_files=['desktop/playwright.config.ts','desktop/playwright.t10-layout.config.ts','desktop/tests/fixtures/bee-preview/fixture.mjs','desktop/tests/fixtures/bee-preview/scenarios.mjs','desktop/tests/fixtures/t10-layout-cases.json','desktop/tests/t10-layout.spec.ts','desktop/tests/t10-layout-fix.spec.ts','docs/desktop/interaction-clarity-validation.md']
hive_files=['hive/internal/integration/desktop_broker_test.go','hive/internal/integration/desktop_broker_cleanup_test.go','docs/bee-supply.md']
hive_head=git(H,'rev-parse','HEAD').decode()
assert hive_head=='87e3233faa3b00e2a207e6dc0fdc5ea380c3a02a'
for name in hive_files:assert hashlib.sha256(subprocess.check_output(['git','show','HEAD:'+name],cwd=H)).hexdigest()==sha(H/name), 'Hive committed blob differs: '+name
commands=[]
for p in sorted(E.glob('t10-fix-*.json')):
    data=json.loads(p.read_text())
    if 'argv' not in data:continue
    sources=data.get('source_sha256',{})
    commands.append({k:data[k] for k in ['started_at','finished_at','argv','cwd','exit','bee_head','hive_head','hive_bee_gitlink']}|{'metadata':str(p.relative_to(B)),'metadata_sha256':sha(p),'relevant_source_sha256':{n:sources[n] for n in bee_files+['H/'+n for n in hive_files] if n in sources}})
ledger=json.loads((E/'t10-fix-scenario-ledger.json').read_text())
assert len(ledger)==76 and len({x['id'] for x in ledger})==76
for row in ledger:
    for key in ['layout_json','screenshot','source_manifest']:assert (B/row[key]).is_file(), (row['id'],key)
    for item in row.get('fix_subpaths',[]):
        for key in ['layout_json','screenshot','source_manifest','entry_screenshot']:
            if key in item:assert (B/item[key]).is_file(), (row['id'],key)
        for name in item['reason_screenshots']:assert (B/name).is_file(), name
captures=[]
for p in (E/'t10-fix-reasons-visible-final-output').rglob('*.json'):
    data=json.loads(p.read_text())
    for item in data.get('preconditions',{}).get('reasonCaptures',[]):
        assert item['rect']['top']>=52 and item['rect']['bottom']<=571 and item['impact'].strip()
        captures.append({'platform':item['platform'],'reason':item['reason'],'top':item['rect']['top'],'bottom':item['rect']['bottom']})
assert len(captures)==22
artifacts=[]
for root in sorted(E.glob('t10-fix-*')):
    paths=root.rglob('*') if root.is_dir() else [root]
    for p in sorted(paths):
        if p.is_file() and p.name!='t10-fix-source-manifest.json':artifacts.append({'path':str(p.relative_to(B)),'sha256':sha(p),'bytes':p.stat().st_size})
manifest={
 'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'bee_baseline_test_head':'5dec62186aaf41bd8b54059eded7e73df1730b6d','bee_product_head':old['bee_product_head'],
 'hive_baseline_test_head':'d0e979b43a6381b0c05c95d9cb585a7ec773766b','hive_fix_head':hive_head,'hive_bee_gitlink':git(H,'rev-parse','HEAD:bee').decode(),
 'bee_commit_binding':'This manifest is committed with the eight Bee source files below; bind the final Bee commit by matching every SHA256 to its committed blob. The ignored T10-fix-report.md records the resulting commit and post-commit check. No future commit id is invented here.',
 'bee_product_source_sha256':old['bee_product_source_sha256'],'bee_product_source_count':len(old['bee_product_source_sha256']),'bee_product_sources_unchanged':True,
 'bee_fix_source_sha256':{name:sha(B/name) for name in bee_files},'hive_fix_source_sha256':{name:sha(H/name) for name in hive_files},'hive_sources_match_fix_commit':True,
 'linux_bee':old['linux_bee'],
 'legacy_preservation':{'manifest':str(old_path.relative_to(B)),'manifest_sha256':sha(old_path),'manifest_matches_baseline_blob':True,'evidence_count':len(old['evidence']),'verified_unchanged_count':len(old['evidence'])},
 'source_boundaries':['ui-frozen: same run 25 behavior tests; before the later P04-P07 screenshot geometry-only adjustment.','reasons-visible-final: separate run 4 P04-P07 tests, final reason screenshots and full item geometry; do not combine as same-run 29.','All historical v6/v9 and 252/61/88/9 evidence keeps its own original command/source metadata.','Original synthetic S05 code screenshots and the clipped P04 frozen screenshots are historical only; the ledger links the actual final DTO codes and later full item captures.'],
 'commands':commands,'reason_capture_checks':captures,'evidence_count':len(artifacts),'evidence':artifacts,
 'scope':'Only t10-fix-prefixed roots; excludes this manifest self-reference and ignored handoff report. All failures and tool-discovery mistakes remain raw artifacts. No product/protocol, user account or user configuration changes.'
}
(E/'t10-fix-source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'new_evidence':len(artifacts),'old_evidence_unchanged':len(old['evidence']),'product_sources_unchanged':len(old['bee_product_source_sha256']),'hive_fix_head':hive_head,'reason_items_fully_visible':len(captures),'ledger_ids':len(ledger)},ensure_ascii=False))
