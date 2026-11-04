# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: account-auto-read.spec.ts >> owned official login releases pending confirmation only after its cancelled terminal observation
- Location: tests/account-auto-read.spec.ts:195:57

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  97  |  await page.evaluate(()=>{
  98  |   const w=window as any;w.autoRead=true;
  99  |   const delayed=new Promise<void>(resolve=>w.releaseReadback=resolve);
  100 |   w.coordinated={defaults:w.model.defaults,error:'',accountErrors:{},refresh:async()=>{w.readbackPending=true;await delayed;w.runtime={platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:structuredClone(w.data[p])}]))};w.rerender();}};
  101 |   w.rerender();
  102 |  });
  103 |  await expect.poll(()=>page.evaluate(()=>(window as any).readbackPending)).toBe(true);
  104 |  await page.evaluate(()=>{const w=window as any;w.autoRead=false;w.rerender();});
  105 |  await page.evaluate(()=>{const w=window as any;w.model.edit('openai',{directory:'/tmp/replacement',store:'file'});w.releaseReadback();});
  106 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.sources.openai.directory)).toBe('/tmp/replacement');
  107 |  await page.waitForTimeout(100);
  108 |  expect(await page.evaluate(()=>(window as any).model.dirty.openai)).toBe(true);
  109 |  expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
  110 | });
  111 | async function holdSnapshot(page:Page){
  112 |  await page.evaluate(()=>{
  113 |   const w=window as any,original=w.client.snapshot;
  114 |   w.client.snapshot=async(...args:any[])=>{await new Promise<void>(resolve=>w.releaseSnapshot=resolve);w.client.snapshot=original;return original(...args);};
  115 |   const action=w.client.action;w.client.action=async(request:any)=>{w.actionRequests??=[];w.actionRequests.push(request);return action(request);};
  116 |   w.model.refresh('openai');
  117 |  });
  118 |  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).releaseSnapshot))).toBe(true);
  119 | }
  120 | test('account action waits for a background snapshot and submits once using the refreshed revision',async({page})=>{
  121 |  await hookHarness(page);await holdSnapshot(page);
  122 |  await page.evaluate(()=>{const w=window as any;w.data.openai.revision++;w.model.action('openai','select');w.model.action('openai','select');});
  123 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(true);expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
  124 |  await page.evaluate(()=>(window as any).releaseSnapshot());await expect.poll(()=>page.evaluate(()=>(window as any).counts.action)).toBe(1);
  125 |  expect(await page.evaluate(()=>(window as any).actionRequests[0].revision)).toBe(2);
  126 | });
  127 | for(const outcome of ['failed','candidate-changed','expired','unmounted'])test('a waiting account action never writes after '+outcome,async({page})=>{
  128 |  await page.clock.install();await hookHarness(page);
  129 |  await page.evaluate(()=>{const w=window as any;w.data.openai.candidate.expires_at=new Date(Date.now()+31000).toISOString();w.model.refresh('openai');});
  130 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.candidate.expires_at)).not.toBeNull();
  131 |  await holdSnapshot(page);await page.evaluate(()=>{const w=window as any;w.model.action('openai','select');});
  132 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(true);
  133 |  if(outcome==='expired')await page.clock.runFor(1100);
  134 |  await page.evaluate(outcome=>{const w=window as any;if(outcome==='failed')w.snapshotFail='openai';if(outcome==='candidate-changed')w.data.openai.candidate.reference='f'.repeat(48);if(outcome==='unmounted')w.unmount();w.releaseSnapshot();},outcome);
  135 |  if(outcome!=='unmounted')await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(false);
  136 |  expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
  137 | });
  138 | test('account read errors remain visible throughout the retry and clear only after success',async({page})=>{
  139 |  await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.snapshotFail='openai';w.model.refresh('openai');});
  140 |  await expect.poll(()=>page.evaluate(()=>((window as any).model.errors.openai?.message??''))).toContain('snapshot unavailable');
  141 |  await page.evaluate(()=>(window as any).snapshotFail='');await holdSnapshot(page);
  142 |  expect(await page.evaluate(()=>((window as any).model.errors.openai?.message??''))).toContain('snapshot unavailable');
  143 |  await page.evaluate(()=>(window as any).releaseSnapshot());await expect.poll(()=>page.evaluate(()=>((window as any).model.errors.openai?.message??''))).toBe('');
  144 | });
  145 | 
  146 | test('repeated account read failures keep retrying until a successful snapshot',async({page})=>{
  147 |  await page.clock.install();await hookHarness(page);await page.evaluate(()=>{const w=window as any;w.snapshotFail='openai';w.model.refresh('openai');});
  148 |  await expect.poll(()=>page.evaluate(()=>((window as any).model.errors.openai?.message??''))).toContain('snapshot unavailable');
  149 |  for(let attempt=0;attempt<3;attempt++){
  150 |   const before=await page.evaluate(()=>(window as any).counts.snapshot);await page.clock.runFor(10000);
  151 |   await expect.poll(()=>page.evaluate(()=>(window as any).counts.snapshot)).toBeGreaterThan(before);
  152 |   expect(await page.evaluate(()=>((window as any).model.errors.openai?.message??''))).toContain('snapshot unavailable');
  153 |  }
  154 |  await page.evaluate(()=>(window as any).snapshotFail='');await page.clock.runFor(10000);
  155 |  await expect.poll(()=>page.evaluate(()=>((window as any).model.errors.openai?.message??''))).toBe('');expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
  156 | });
  157 | 
  158 | for(const state of ['running','succeeded','replaced'])test('waiting login cancellation revalidates the same operation when it becomes '+state,async({page})=>{
  159 |  await hookHarness(page);await page.evaluate(()=>{
  160 |   const w=window as any;w.cancelIds=[];w.authorizer={status:async()=>{},cancel:async(id:string)=>{w.cancelIds.push(id);}};
  161 |   w.data.openai.operation={id:'c'.repeat(48),kind:'authorize',state:'pending',platform:'openai',revision:w.data.openai.revision,error:null};w.rerender();
  162 |  });
  163 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai.operation?.state)).toBe('pending');
  164 |  await holdSnapshot(page);await page.evaluate(()=>{(window as any).model.cancelAuthorize('openai');});
  165 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(true);
  166 |  await page.evaluate(state=>{const w=window as any;if(state==='replaced')w.data.openai.operation.id='d'.repeat(48);else w.data.openai.operation.state=state;w.releaseSnapshot();},state);
  167 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(false);
  168 |  expect(await page.evaluate(()=>(window as any).cancelIds)).toEqual(state==='running'?['c'.repeat(48)]:[]);
  169 | });
  170 | 
  171 | test('NativeApp reconciling coordinator waits exactly ten seconds without replaying writes',async({page})=>{
  172 |  await page.clock.install();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
  173 |  const openai=accountFixture('openai') as AccountSnapshot;openai.operation={id:'e'.repeat(48),kind:'select',state:'reconciling',platform:'openai',revision:openai.revision,error:null};
  174 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai,claude:accountFixture('claude')}});await page.goto('/');
  175 |  await expect.poll(async()=>(await calls(page,'account_snapshot')).length).toBe(2);
  176 |  await page.clock.runFor(9999);expect(await calls(page,'account_snapshot')).toHaveLength(2);
  177 |  await page.clock.runFor(1);await expect.poll(async()=>(await calls(page,'account_snapshot')).length).toBe(4);
  178 |  for(const command of ['account_action','authorize_start','runtime_start','supply_set_paused'])expect(await calls(page,command)).toHaveLength(0);
  179 | });
  180 | 
  181 | async function ownedLoginHarness(page:Page){
  182 |  await hookHarness(page);await page.evaluate(()=>{
  183 |   const w=window as any;w.generation=1;
  184 |   const adopt=()=>{w.runtime={local:'stopped',run_id:null,platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:structuredClone(w.data[p])}]))};w.rerender();};
  185 |   w.runtime={local:'stopped',run_id:null,platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:structuredClone(w.data[p])}]))};
  186 |   w.coordinated={defaults:w.model.defaults,error:null,accountErrors:{},generation:()=>w.generation,refresh:async()=>adopt(),snapshot:()=>({runtime:w.runtime,error:null,accountErrors:{},busy:false})};
  187 |   w.authorizer={start:async()=>{const a=w.data.openai;a.operation={id:'d'.repeat(48),kind:'authorize',platform:'openai',state:'running',revision:++a.revision,error:null};return structuredClone(a.operation);}};w.rerender();
  188 |  });
  189 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.submissionBlocked)).toBe(false);
  190 |  await page.evaluate(()=>(window as any).model.authorize('openai'));
  191 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.views.openai?.operation?.state)).toBe('running');
  192 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.writeBusy.openai)).toBe(false);
  193 |  expect(await page.evaluate(()=>(window as any).model.uncertain.openai)).toBe(true);
  194 | }
  195 | for(const outcome of ['succeeded','failed','cancelled'])test(`owned official login releases pending confirmation only after its ${outcome} terminal observation`,async({page})=>{
  196 |  await ownedLoginHarness(page);await page.evaluate(async outcome=>{const w=window as any,a=w.data.openai;a.operation={...a.operation,state:outcome,revision:++a.revision};await w.coordinated.refresh();},outcome);
> 197 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.uncertain.openai)).toBe(false);expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
      |                                                                                   ^ Error: expect(received).toBe(expected) // Object.is equality
  198 | });
  199 | for(const mismatch of ['old-revision','other-operation','other-platform','other-generation'])test(`owned official login ignores ${mismatch} terminal confirmation`,async({page})=>{
  200 |  await ownedLoginHarness(page);await page.evaluate(async mismatch=>{
  201 |   const w=window as any,a=w.data.openai,receiptRevision=a.revision;
  202 |   a.operation={...a.operation,state:'succeeded',revision:++a.revision};
  203 |   if(mismatch==='old-revision'){a.revision=receiptRevision-1;a.operation.revision=a.revision;}
  204 |   if(mismatch==='other-operation')a.operation.id='e'.repeat(48);
  205 |   if(mismatch==='other-platform')a.operation.platform='claude';
  206 |   if(mismatch==='other-generation')w.generation++;
  207 |   await w.coordinated.refresh();
  208 |  },mismatch);
  209 |  await expect.poll(()=>page.evaluate(()=>(window as any).model.busy.openai??false)).toBe(false);expect(await page.evaluate(()=>(window as any).model.uncertain.openai)).toBe(true);
  210 |  expect(await page.evaluate(()=>(window as any).counts.action)).toBe(0);
  211 | });
  212 | 
```