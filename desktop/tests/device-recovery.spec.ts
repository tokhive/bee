import {test,expect,type Page} from '@playwright/test';
async function open(page:Page,scene:string){
 await page.goto('/tests/fixtures/bee-preview/app.html?scene='+scene);
 await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
 expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
}
const nav=(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true});
const calls=(page:Page)=>page.evaluate(()=>(window as any).calls as {command:string;args:any}[]);
const writes=new Set(['device_begin','device_recovery_prepare','device_recovery_confirm','runtime_start','runtime_stop','account_action','authorize_start','supply_set_paused']);
const phases:{[key:string]:string}={
 'recovery-pending':'等待网页确认','recovery-draining':'等待旧设备完成任务和结算','recovery-creation-unknown':'创建结果未知','recovery-redemption-unknown':'兑换结果未知','recovery-saving':'本机保存未完成','recovery-owner':'新设备归属与原设备不同',
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
 const rebind=page.getByRole('button',{name:'重新绑定设备',exact:true});await rebind.click();
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(rebind).toBeFocused();
 expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
 await rebind.click();await page.getByRole('dialog').getByRole('button',{name:'确认重新绑定',exact:true}).click();
 await expect(page.locator('.pairing-phase')).toHaveText('等待网页确认');
 await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
 await expect(page.locator('.pairing-phase')).toHaveText('等待网页确认');
 await page.evaluate(()=>(window as any).__beePreviewApprove());
 await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
 await expect(page.locator('.pairing-phase')).toHaveText('新设备归属与原设备不同');
 await page.getByRole('button',{name:'确认采用新归属',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('owner@example.test');await expect(page.getByRole('dialog')).toContainText('new-owner@example.test');
 await page.getByRole('dialog').getByRole('button',{name:'确认采用新归属',exact:true}).click();
 await expect(page.locator('.pairing-phase')).toContainText('未自动开始贡献');
 await page.getByRole('button',{name:'重新核对设备',exact:true}).click();
 const commands=(await calls(page)).filter(c=>writes.has(c.command));
 expect(commands.map(c=>c.command)).toEqual(['device_recovery_prepare','device_recovery_confirm','device_recovery_confirm']);
 expect(commands.filter(c=>c.command==='device_recovery_confirm').map(c=>c.args.decision)).toEqual(['begin_pairing','adopt_owner']);
 expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
 await expect(page.getByRole('button',{name:'开始贡献',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'停止贡献',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'前往准备账号',exact:true})).toBeVisible();
});
test('saved revoked identity and missing selected source keep all pages reachable without account or runtime writes',async({page})=>{
 await open(page,'device-revoked-source-missing');await expect(page.locator('body')).toContainText('上次保存的设备信息');
 await nav(page,'AI 账号').click();await expect(page.getByTestId('startup-recovery')).toContainText('设备');await expect(page.getByRole('button',{name:'OpenAI 详情',exact:true})).toHaveCount(0);
 for(const destination of ['设置','诊断','概览']){await nav(page,destination).click();await expect(page.getByRole('heading',{level:1,name:destination,exact:true})).toBeFocused();}
 expect((await calls(page)).filter(c=>writes.has(c.command))).toEqual([]);
});
