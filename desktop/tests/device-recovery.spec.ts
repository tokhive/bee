import {test,expect,type Page} from '@playwright/test';
async function open(page:Page,scene:string){
 await page.clock.install();
 await page.goto('/tests/fixtures/bee-preview/app.html?scene='+scene);
 await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
 expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
}
const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
const calls=(page:Page)=>page.evaluate(()=>(window as any).calls as {command:string;args:any}[]);
const writes=new Set(['device_recovery_start','device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','supply_set_paused']);
const phases:{[key:string]:string}={
 'recovery-pending':'在 Hive 网页确认设备','recovery-draining':'正在完成重新绑定','recovery-creation-unknown':'绑定结果尚未确认','recovery-redemption-unknown':'绑定结果尚未确认','recovery-saving':'绑定已完成，本机保存失败','recovery-owner':'新设备归属与原设备不同',
};
for(const [scene,copy] of [
 ['device-creation-unknown','尚无法确认配对请求结果'],
 ['device-redemption-unknown','尚未确认绑定结果。Bee 只检查原事务，不会再次兑换。'],
 ['device-saving','设备身份已确认，本机保存尚未完成。'],
] as const)test('unresolved first binding stays in the gate and returns from diagnostics without replay: '+scene,async({page})=>{
 await open(page,scene);await expect(page.getByText(copy,{exact:true})).toBeVisible();
 const operation=await page.evaluate(()=>(window as any).__beeMockDeviceContext().operationId);
 await expect(page.getByRole('navigation')).toHaveCount(0);
 await page.getByRole('button',{name:'查看诊断',exact:true}).click();
 await expect(page.getByRole('heading',{level:1,name:'诊断',exact:true})).toBeFocused();
 await expect(page.getByRole('navigation')).toHaveCount(0);
 await page.getByRole('button',{name:'返回设备设置',exact:true}).click();
 await expect(page.getByText(copy,{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__beeMockDeviceContext().operationId)).toBe(operation);
 expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
 await expect(page.getByRole('button',{name:/继续绑定设备|重新生成配对码/})).toHaveCount(0);
});
for(const [scene,copy] of Object.entries(phases))test('unresolved device transaction survives four pages without write replay: '+scene,async({page})=>{
 await open(page,scene);await expect(page.locator('.pairing-phase')).toContainText(copy);
 for(const destination of ['AI 账号','设置','诊断','概览']){await nav(page,destination).click();await expect(page.getByRole('heading',{level:1,name:destination,exact:true})).toBeFocused();}
 await expect(page.locator('.pairing-phase')).toContainText(copy);
 expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
 await expect(page.getByRole('button',{name:'生成配对码',exact:true})).toHaveCount(0);
});
test('revoked credential recovery requires local consent, external approval and explicit new owner adoption',async({page})=>{
 await open(page,'device-recovery-confirm');
 await page.getByRole('button',{name:'修复设备绑定',exact:true}).click();
 const rebind=page.getByRole('button',{name:'重新绑定 Hive',exact:true});await rebind.click();
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(rebind).toBeFocused();
 expect((await calls(page)).filter(c=>c.command==='device_recovery_confirm')).toEqual([]);
 await rebind.click();await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();
 await expect(page.locator('.pairing-phase')).toHaveText('在 Hive 网页确认设备');
 await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
 await expect(page.locator('.pairing-phase')).toHaveText('在 Hive 网页确认设备');
 await page.evaluate(()=>(window as any).__beePreviewApprove());
 await page.clock.runFor(2100);
 await expect(page.locator('.pairing-phase')).toHaveText('新设备归属与原设备不同');
 await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('owner@example.test');await expect(page.getByRole('dialog')).toContainText('new-owner@example.test');
 await page.getByRole('dialog').getByRole('button',{name:'确认采用新归属',exact:true}).click();
 await expect(page.getByText('设备绑定已保存。',{exact:true})).toBeVisible();
 await page.clock.runFor(2100);
 const commands=(await calls(page)).filter(c=>writes.has(c.command));
 expect(commands.map(c=>c.command)).toEqual(['device_recovery_start','device_recovery_confirm','device_recovery_confirm']);
 expect(commands.filter(c=>c.command==='device_recovery_confirm').map(c=>c.args.decision)).toEqual(['begin_pairing','adopt_owner']);
 expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);await expect(page.locator('.device-card').getByRole('button',{name:'接入 AI 账号',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'前往接入',exact:true}).first()).toBeVisible();
});
test('saved revoked identity and missing selected source keep all pages reachable without account or runtime writes',async({page})=>{
 await open(page,'device-revoked-source-missing');await expect(page.locator('body')).toContainText('上次保存的设备信息');
 await nav(page,'AI 账号').click();await expect(page.getByTestId('startup-recovery')).toContainText('设备');await expect(page.getByRole('button',{name:'OpenAI 详情',exact:true})).toHaveCount(0);
 for(const destination of ['设置','诊断','概览']){await nav(page,destination).click();await expect(page.getByRole('heading',{level:1,name:destination,exact:true})).toBeFocused();}
 expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
});

test('first launch keeps explicit original-request controls available after reopening',async({page})=>{
 await open(page,'device-creation-unknown');
 await expect(page.getByRole('button',{name:'继续核对原请求',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重新配对',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('先向 Hive 确认结束旧申请');
 await page.getByRole('dialog').getByRole('button',{name:'返回设备设置',exact:true}).click();
 await page.getByRole('button',{name:'取消本次重绑',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('旧设备不会自动恢复接单');
 expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
});

test('missing local binding exposes recovery from the first launch form and retains its address on failure',async({page})=>{
 await open(page,'device-unbound');
 await page.getByRole('button',{name:'修复设备绑定',exact:true}).click();
 const form=page.locator('.device-recovery-action form');
 await form.getByLabel('Hive 地址',{exact:true}).fill('https://original-hive.example');
 await form.getByLabel('设备名称',{exact:true}).fill('Recovered Bee');
 await form.getByRole('button',{name:'继续',exact:true}).click();
 await expect(form.getByLabel('Hive 地址',{exact:true})).toHaveValue('https://original-hive.example');
 expect((await calls(page)).filter(c=>c.command==='device_recovery_start').map(c=>c.args)).toEqual([{hive:'https://original-hive.example',name:'Recovered Bee'}]);
 expect((await calls(page)).filter(c=>['device_begin','runtime_start','account_action'].includes(c.command))).toEqual([]);
});

test('local recovery advances only after confirmation and cancel dialog returns focus',async({page})=>{
 await open(page,'device-unbound');
 await page.evaluate(()=>{
  const w=window as any,prior=w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>command==='device_recovery_start'?{result:{recovery:{operation_id:'a'.repeat(48),revision:1,phase:'awaiting_confirmation',old_identity:null,new_identity:null,pairing:null,failure:null}}}:command==='device_recovery_confirm'?{result:{recovery:{operation_id:'a'.repeat(48),revision:2,phase:'pending',old_identity:null,new_identity:null,pairing:{code:'ABCD-EFGH',verification_url:'https://original-hive.example/devices/pair?code=ABCD-EFGH',expires_at:'2099-01-01T00:00:00Z'},failure:null}}}:prior(command,args);
 });
 await page.getByRole('button',{name:'修复设备绑定',exact:true}).click();
 await page.locator('input[name="recovery-hive"]').fill('https://original-hive.example');
 await page.getByRole('button',{name:'继续',exact:true}).click();
 await expect(page.getByRole('heading',{name:'请重新绑定',exact:true})).toBeVisible();
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'重新绑定 Hive',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();
 await expect(page.getByRole('heading',{name:'在 Hive 网页确认设备',exact:true})).toBeVisible();
 const cancel=page.getByRole('button',{name:'重新绑定操作',exact:true});
 await cancel.click();
 await page.getByRole('menuitem',{name:'取消重新绑定',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('旧设备不会自动恢复接单');
 await page.getByRole('dialog').getByRole('button',{name:'继续重新绑定',exact:true}).click();
 await expect(cancel).toBeFocused();
 await page.getByRole('button',{name:'查看诊断',exact:true}).click();
 await expect(page.getByRole('heading',{name:'诊断',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'返回设备设置',exact:true}).click();
 await expect(page.getByRole('region',{name:'设备与 Hive',exact:true})).toBeFocused();
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 expect((await calls(page)).filter(c=>['device_begin','runtime_start','account_action'].includes(c.command))).toEqual([]);
});

test('locally expired pending code offers renewal without pretending Hive confirmed expiry',async({page})=>{
 await open(page,'recovery-pending');
 await expect(page.locator('.pairing-phase')).toContainText('在 Hive 网页确认设备');
 const before=await page.evaluate(()=>(window as any).__beeMockDeviceContext());
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)));
 await page.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now()+660000)));
 await page.clock.runFor(1000);
 const renewal=page.getByRole('button',{name:'重新获取配对码',exact:true});
 await expect(renewal).toBeVisible();
 await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeDisabled();
 await renewal.click();
 await expect(page.getByRole('dialog')).toContainText('若旧绑定已经成功');
 expect((await calls(page)).filter(c=>c.command==='device_recovery_confirm')).toHaveLength(0);
 await page.getByRole('dialog').getByRole('button',{name:'确认获取新码',exact:true}).click();
 const decisions=(await calls(page)).filter(c=>c.command==='device_recovery_confirm');
 expect(decisions).toHaveLength(1);
 expect(decisions[0].args.decision).toBe('restart_pairing');
 expect(decisions[0].args.operationId??decisions[0].args.operation_id).toBe(before.operationId);
});
