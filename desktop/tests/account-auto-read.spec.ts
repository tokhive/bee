import {test,expect,type Page} from '@playwright/test';
import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).calls.filter((c:any)=>c.command===command),command);
const card=(page:Page)=>page.getByRole('region',{name:'OpenAI 账号',exact:true});
test('account entry reads each source once and never performs automatic writes or sign-in',async({page})=>{
 await page.addInitScript(installAccountFixture,{accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
 await page.goto('/');expect(await calls(page,'account_detect')).toHaveLength(0);
 await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect.poll(async()=>(await calls(page,'account_detect')).filter((c:any)=>c.args.request.mode==='local').length).toBe(2);
 await expect(card(page).getByRole('button',{name:'检测已有登录',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'概览',exact:true}).click();await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await page.waitForTimeout(500);expect(await calls(page,'account_detect')).toHaveLength(2);
 expect(await calls(page,'account_action')).toHaveLength(0);expect(await calls(page,'authorize_start')).toHaveLength(0);
 await card(page).getByRole('button',{name:'OpenAI 详情',exact:true}).click();const source=page.getByRole('dialog').getByLabel('自定义目录');await source.fill('/tmp/new');await source.blur();
 await expect.poll(async()=>(await calls(page,'account_detect')).filter((c:any)=>c.args.request.directory==='/tmp/new').length).toBe(1);
});
test('selected matching candidate automatically reads official quota once and retains the raw percentage',async({page})=>{
 const openai=accountFixture('openai') as any;openai.selection={...openai.selection,state:'selected',fingerprint:'b'.repeat(64)};
 await page.addInitScript(installAccountFixture,{accounts:{openai,claude:accountFixture('claude')}});
 await page.goto('/');await page.getByRole('button',{name:'AI 账号',exact:true}).click();
 await expect.poll(async()=>(await calls(page,'account_detect')).filter((c:any)=>c.args.request.mode==='official').length).toBe(1);
 await page.waitForTimeout(500);expect(await calls(page,'account_detect')).toHaveLength(3);
 await card(page).getByRole('button',{name:'OpenAI 详情',exact:true}).click();await expect(page.getByRole('dialog').getByText(/120%/).first()).toBeVisible();
});

async function hookHarness(page:Page){
 await page.addInitScript(({openai,claude})=>{
  const w=window as any;w.data={openai,claude};w.counts={snapshot:0,detect:0,action:0};w.detected=[];
  w.client={defaults:async()=>({platforms:['openai','claude'].map(platform=>({platform,directory:'/tmp/default',default_store:'file',stores:[]}))}),invalidate:()=>{},snapshot:async(platform:string,refresh:boolean)=>{(w.snapshotReads??=[]).push({platform,refresh});w.counts.snapshot++;(w.snapshotPlatforms??=[]).push(platform);if(w.snapshotFail===platform)throw Error('snapshot unavailable');return structuredClone(w.snapshotOverride?.[platform]??w.data[platform]);},detect:async(request:any)=>{w.counts.detect++;w.detected.push(request);if(w.detectFail===request.platform)throw Error('source_read permission_denied=true; check=file_read');if(w.detectFailureReply?.platform===request.platform)return structuredClone(w.detectFailureReply);const view=structuredClone(w.data[request.platform]);view.revision++;view.candidate={...view.candidate,state:'available',source:{directory:request.directory,store:request.store},fingerprint:'b'.repeat(64)};if(w.detectDelay&&request.directory===null)await new Promise(r=>setTimeout(r,w.detectDelay));w.data[request.platform]=view;return view;},action:async(request:any)=>{w.counts.action++;const view=w.data[request.platform];view.revision++;if(w.writeFails)throw Error('write reply lost');return structuredClone(view);}};
 },{openai:accountFixture('openai'),claude:accountFixture('claude')});
 await page.route('**/model-harness',route=>route.fulfill({contentType:'text/html',body:`<div id="harness"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {useAccounts} from '/src/features/accounts/useAccounts.ts';
 const root=ReactDOM.createRoot(document.getElementById('harness'));window.unmount=()=>root.unmount();function Harness(){window.model=useAccounts(window.client,true,window.authorizer,window.runtime,window.autoRead??false,window.coordinated);return null;}window.rerender=()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Harness)));window.rerender();</script>`}));
 await page.goto('/model-harness');await expect.poll(()=>page.evaluate(()=>!!(window as any).model?.defaults)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>Object.values((window as any).model.busy).every(v=>!v))).toBe(true);
}
test('failed account snapshots retry after ten seconds without replaying writes',async({page})=>{
 await page.clock.install();await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.snapshotFail='openai';w.model.refresh('openai');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.errors.openai)).toContain('snapshot unavailable');
 const reads=await page.evaluate(()=>(window as any).counts.snapshot);await page.clock.runFor(9000);expect(await page.evaluate(()=>(window as any).counts.snapshot)).toBe(reads);
 await page.evaluate(()=>{(window as any).snapshotFail='';});await page.clock.runFor(1000);await expect.poll(()=>page.evaluate(()=>(window as any).model.errors.openai)).toBe('');expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
});
test('uncertain writes survive passive runtime, old snapshots and pending replies until explicit terminal confirmation',async({page})=>{
 await page.clock.install();await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.writeFails=true;w.snapshotOverride={openai:structuredClone(w.data.openai)};w.model.action('openai','select');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.uncertain.openai)).toBe(true);
 await page.evaluate(()=>{const w=window as any;w.runtime={platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:structuredClone(w.data[p])}]))};w.rerender();});
 await page.clock.runFor(10000);expect(await page.evaluate(()=>(window as any).model.uncertain.openai)).toBe(true);
 await page.evaluate(()=>{const w=window as any;const view=structuredClone(w.data.openai);view.operation={id:'c'.repeat(48),kind:'select',state:'pending',platform:'openai',revision:view.revision,error:null};w.snapshotOverride.openai=view;});await page.clock.runFor(10000);expect(await page.evaluate(()=>(window as any).model.uncertain.openai)).toBe(true);
 await page.evaluate(()=>{(window as any).snapshotOverride.openai.operation.state='succeeded';});await page.clock.runFor(10000);await expect.poll(()=>page.evaluate(()=>(window as any).model.uncertain.openai)).toBe(false);expect(await page.evaluate(()=>(window as any).counts.action)).toBe(1);
});
test('source replacement rejects a late previous-source reply',async({page})=>{
 await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.detectDelay=400;w.autoRead=true;w.rerender();});await expect.poll(()=>page.evaluate(()=>(window as any).detected.length)).toBe(2);
 await page.evaluate(()=>{(window as any).model.edit('openai',{directory:'/tmp/replacement',store:'file'});});await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.candidate.source?.directory)).toBe('/tmp/replacement');await page.waitForTimeout(500);expect(await page.evaluate(()=>(window as any).model.views.openai.candidate.source.directory)).toBe('/tmp/replacement');
});
test('official retry_at defers reads and unchanged failed observations never create a prompt loop',async({page})=>{
 await page.clock.install();await hookHarness(page);
 await page.evaluate(()=>{const w=window as any;const view=w.data.openai;view.selection={...view.selection,state:'selected',fingerprint:'b'.repeat(64)};view.capabilities[0].retry_at=new Date(Date.now()+25000).toISOString();w.model.refresh('openai');w.autoRead=true;w.rerender();});
 await expect.poll(()=>page.evaluate(()=>(window as any).detected.filter((r:any)=>r.mode==='local').length)).toBe(2);
 await page.clock.runFor(20000);expect(await page.evaluate(()=>(window as any).detected.filter((r:any)=>r.mode==='official').length)).toBe(0);
 await page.clock.runFor(10000);await expect.poll(()=>page.evaluate(()=>(window as any).detected.filter((r:any)=>r.mode==='official').length)).toBe(1);
 await page.clock.runFor(60000);expect(await page.evaluate(()=>(window as any).detected.filter((r:any)=>r.mode==='official').length)).toBe(1);
});

test('failed local sources remain diagnosed without automatic prompts and retry once on account re-entry',async({page})=>{
 await page.clock.install();await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.detectFail='openai';w.autoRead=true;w.rerender();});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.sourceReadFailed.openai)).toContain('permission_denied');expect(await page.evaluate(()=>(window as any).model.dirty.openai)).toBe(true);await page.clock.runFor(30000);
 expect(await page.evaluate(()=>(window as any).detected.filter((r:any)=>r.platform==='openai').length)).toBe(1);expect(await page.evaluate(()=>(window as any).model.sourceReadFailed.openai)).toContain('permission_denied');
 await page.evaluate(()=>{const w=window as any;w.autoRead=false;w.rerender();});await page.waitForTimeout(20);await page.evaluate(()=>{const w=window as any;w.detectFail='';w.autoRead=true;w.rerender();});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.sourceReadFailed.openai)).toBe('');expect(await page.evaluate(()=>(window as any).detected.filter((r:any)=>r.platform==='openai').length)).toBe(2);expect(await page.evaluate(()=>(window as any).detected.filter((r:any)=>r.platform==='claude').length)).toBe(1);
});

test('one platform snapshot error does not slow the other pending operation or starve its retry',async({page})=>{
 await page.clock.install();await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.snapshotFail='openai';const view=w.data.claude;view.operation={id:'d'.repeat(48),kind:'select',state:'pending',platform:'claude',revision:view.revision,error:null};w.model.refresh('openai');w.model.refresh('claude');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.errors.openai)).toContain('snapshot unavailable');const before=await page.evaluate(()=>(window as any).snapshotPlatforms.filter((p:string)=>p==='claude').length);await page.clock.runFor(450);expect(await page.evaluate(()=>(window as any).snapshotPlatforms.filter((p:string)=>p==='claude').length)).toBeGreaterThan(before);
 await page.evaluate(()=>{(window as any).snapshotFail='';});await page.clock.runFor(10000);await expect.poll(()=>page.evaluate(()=>(window as any).model.errors.openai)).toBe('');
});

for(const kind of ['select','confirm_change'])test(`reconciling ${kind} retries refreshed snapshots at ten seconds without replaying actions`,async({page})=>{
 await page.clock.install();await hookHarness(page);await page.evaluate(kind=>{const w=window as any;const view=w.data.openai;view.operation={id:'e'.repeat(48),kind,state:'reconciling',platform:'openai',revision:view.revision,error:null};w.model.refresh('openai');},kind);
 await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.operation?.state)).toBe('reconciling');
 const before=await page.evaluate(()=>(window as any).snapshotReads.length);await page.clock.runFor(9000);expect(await page.evaluate(()=>(window as any).snapshotReads.length)).toBe(before);
 await page.clock.runFor(1000);await expect.poll(()=>page.evaluate(()=>(window as any).snapshotReads.length)).toBe(before+1);expect(await page.evaluate(()=>(window as any).snapshotReads.at(-1))).toEqual({platform:'openai',refresh:true});
 await page.evaluate(()=>{const w=window as any;w.data.openai.revision++;w.data.openai.operation.state='succeeded';});await page.clock.runFor(10000);await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.operation.state)).toBe('succeeded');expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
});
for(const code of ['permission_denied','source_unavailable'])test(`resolved ${code} source failures retry on re-entry without repeated permission prompts`,async({page})=>{
 await page.clock.install();await hookHarness(page);await page.evaluate(code=>{const w=window as any;const view=structuredClone(w.data.openai);view.revision++;view.candidate={...view.candidate,state:code,reference:null,source:null,fingerprint:null,error:{code,check:'source_read',platform:'openai',message:'source access failed',evidence:{permission_denied:String(code==='permission_denied')}}};w.detectFailureReply=view;w.autoRead=true;w.rerender();},code);
 await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.candidate.state)).toBe(code);await expect.poll(()=>page.evaluate(()=>(window as any).model.sourceReadFailed.openai)).toContain(code);
 await page.clock.runFor(30000);expect(await page.evaluate(()=>(window as any).detected.filter((r:any)=>r.platform==='openai').length)).toBe(1);
 await page.evaluate(()=>{const w=window as any;w.autoRead=false;w.rerender();});await page.waitForTimeout(20);await page.evaluate(()=>{const w=window as any;w.data.openai.revision++;w.detectFailureReply=null;w.autoRead=true;w.rerender();});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.sourceReadFailed.openai)).toBe('');await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.candidate.state)).toBe('available');expect(await page.evaluate(()=>(window as any).detected.filter((r:any)=>r.platform==='openai').length)).toBe(2);expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
});


test('a late coordinated readback cannot confirm a replacement credential source',async({page})=>{
 await hookHarness(page);
 await page.evaluate(()=>{
  const w=window as any;w.autoRead=true;
  const delayed=new Promise<void>(resolve=>w.releaseReadback=resolve);
  w.coordinated={defaults:w.model.defaults,error:'',accountErrors:{},refresh:async()=>{w.readbackPending=true;await delayed;w.runtime={platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:structuredClone(w.data[p])}]))};w.rerender();}};
  w.rerender();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).readbackPending)).toBe(true);
 await page.evaluate(()=>{const w=window as any;w.autoRead=false;w.rerender();});
 await page.evaluate(()=>{const w=window as any;w.model.edit('openai',{directory:'/tmp/replacement',store:'file'});w.releaseReadback();});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.sources.openai.directory)).toBe('/tmp/replacement');
 await page.waitForTimeout(100);
 expect(await page.evaluate(()=>(window as any).model.dirty.openai)).toBe(true);
 expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
});
async function holdSnapshot(page:Page){
 await page.evaluate(()=>{
  const w=window as any,original=w.client.snapshot;
  w.client.snapshot=async(...args:any[])=>{await new Promise<void>(resolve=>w.releaseSnapshot=resolve);w.client.snapshot=original;return original(...args);};
  const action=w.client.action;w.client.action=async(request:any)=>{w.actionRequests??=[];w.actionRequests.push(request);return action(request);};
  w.model.refresh('openai');
 });
 await expect.poll(()=>page.evaluate(()=>Boolean((window as any).releaseSnapshot))).toBe(true);
}
test('account action waits for a background snapshot and submits once using the refreshed revision',async({page})=>{
 await hookHarness(page);await holdSnapshot(page);
 await page.evaluate(()=>{const w=window as any;w.data.openai.revision++;w.model.action('openai','select');w.model.action('openai','select');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(true);expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
 await page.evaluate(()=>(window as any).releaseSnapshot());await expect.poll(()=>page.evaluate(()=>(window as any).counts.action)).toBe(1);
 expect(await page.evaluate(()=>(window as any).actionRequests[0].revision)).toBe(2);
});
for(const outcome of ['failed','candidate-changed','expired','unmounted'])test('a waiting account action never writes after '+outcome,async({page})=>{
 await page.clock.install();await hookHarness(page);
 await page.evaluate(()=>{const w=window as any;w.data.openai.candidate.expires_at=new Date(Date.now()+31000).toISOString();w.model.refresh('openai');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.candidate.expires_at)).not.toBeNull();
 await holdSnapshot(page);await page.evaluate(()=>{const w=window as any;w.model.action('openai','select');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(true);
 if(outcome==='expired')await page.clock.runFor(1100);
 await page.evaluate(outcome=>{const w=window as any;if(outcome==='failed')w.snapshotFail='openai';if(outcome==='candidate-changed')w.data.openai.candidate.reference='f'.repeat(48);if(outcome==='unmounted')w.unmount();w.releaseSnapshot();},outcome);
 if(outcome!=='unmounted')await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(false);
 expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
});
test('account read errors remain visible throughout the retry and clear only after success',async({page})=>{
 await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.snapshotFail='openai';w.model.refresh('openai');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.errors.openai)).toContain('snapshot unavailable');
 await page.evaluate(()=>(window as any).snapshotFail='');await holdSnapshot(page);
 expect(await page.evaluate(()=>(window as any).model.errors.openai)).toContain('snapshot unavailable');
 await page.evaluate(()=>(window as any).releaseSnapshot());await expect.poll(()=>page.evaluate(()=>(window as any).model.errors.openai)).toBe('');
});

test('repeated account read failures keep retrying until a successful snapshot',async({page})=>{
 await page.clock.install();await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.snapshotFail='openai';w.model.refresh('openai');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.errors.openai)).toContain('snapshot unavailable');
 for(let attempt=0;attempt<3;attempt++){
  const before=await page.evaluate(()=>(window as any).counts.snapshot);await page.clock.runFor(10000);
  await expect.poll(()=>page.evaluate(()=>(window as any).counts.snapshot)).toBeGreaterThan(before);
  expect(await page.evaluate(()=>(window as any).model.errors.openai)).toContain('snapshot unavailable');
 }
 await page.evaluate(()=>(window as any).snapshotFail='');await page.clock.runFor(10000);
 await expect.poll(()=>page.evaluate(()=>(window as any).model.errors.openai)).toBe('');expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
});

for(const state of ['running','succeeded','replaced'])test('waiting login cancellation revalidates the same operation when it becomes '+state,async({page})=>{
 await hookHarness(page);await page.evaluate(()=>{
  const w=window as any;w.cancelIds=[];w.authorizer={status:async()=>{},cancel:async(id:string)=>{w.cancelIds.push(id);}};
  w.data.openai.operation={id:'c'.repeat(48),kind:'authorize',state:'pending',platform:'openai',revision:w.data.openai.revision,error:null};w.rerender();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.operation?.state)).toBe('pending');
 await holdSnapshot(page);await page.evaluate(()=>{(window as any).model.cancelAuthorize('openai');});
 await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(true);
 await page.evaluate(state=>{const w=window as any;if(state==='replaced')w.data.openai.operation.id='d'.repeat(48);else w.data.openai.operation.state=state;w.releaseSnapshot();},state);
 await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(false);
 expect(await page.evaluate(()=>(window as any).cancelIds)).toEqual(state==='running'?['c'.repeat(48)]:[]);
});
