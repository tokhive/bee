import {test,expect,type Page} from '@playwright/test';
const open=async(page:Page,query='')=>{await page.goto('/tests/fixtures/first-launch-integration.html'+query);await page.waitForFunction(()=>(window as any).__firstLaunchReady);};
const calls=(page:Page)=>page.evaluate(()=>(window as any).calls as {command:string;args:any}[]);
const finish=async(page:Page)=>{await page.evaluate(()=>(window as any).__beePreviewApprove());await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toBeVisible({timeout:15000});};
test('unconfigured startup waits for trusted recovery absence and fences notification accounts',async({page})=>{
 await open(page,'?hold=device_recovery_status');
 await expect(page.getByRole('heading',{name:'正在检查设备…',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).emitNotification('accounts'));
 await expect(page.getByLabel('Hive 地址',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('navigation')).toHaveCount(0);
 expect((await calls(page)).filter(c=>c.command==='account_detect')).toEqual([]);
 await page.evaluate(()=>(window as any).__firstLaunchTest.release('device_recovery_status'));
 await expect(page.getByLabel('Hive 地址',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'AI 账号',exact:true})).toHaveCount(0);
});
test('late begin receipt cannot replace the current binding within one native instance',async({page})=>{
 await open(page);await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
 await page.evaluate(()=>(window as any).__firstLaunchTest.holdReceipt('device_begin'));
 await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await page.waitForFunction(()=>(window as any).calls.some((c:any)=>c.command==='device_begin'));
 await page.evaluate(async()=>{
  const w=window as any,control=w.__firstLaunchTest,identity={id:'other-device',name:'Other desktop',owner_id:'other-owner',owner_email:'other@example.test'};
  control.contextOverride={hive:'https://other-hive.example',name:'Other desktop',device_id:identity.id,owner_id:identity.owner_id,binding_revision:3};
  control.deviceOverride={state:'bound',hive:'https://other-hive.example',name:'Other desktop',identity,recovery:{operation_id:'d'.repeat(48),revision:3,phase:'completed',old_identity:null,new_identity:identity,pairing:null,failure:null}};
  await control.forceRefresh();
 });
 await expect(page.getByText(/首次绑定完成证据不匹配/)).toBeVisible();
 await page.evaluate(()=>(window as any).__firstLaunchTest.releaseReceipt('device_begin'));
 await expect(page.getByText('https://other-hive.example',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
 await expect(page.getByRole('navigation')).toHaveCount(0);
});
test('configuration permission failure stays in recovery instead of offering fresh setup',async({page})=>{
 await open(page,'?contextFailure');
 await expect(page.getByRole('heading',{name:'无法确认设备状态',exact:true})).toBeVisible();
 await expect(page.getByText('configuration read permission_denied=true; path=/isolated/config; required=readable saved configuration',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Hive 地址',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('navigation')).toHaveCount(0);
});
test('initial transaction revision cannot move backwards within the same operation',async({page})=>{
 await open(page,'?scene=device-pending&recordRevision=5');await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).__firstLaunchTest.recordRevision=4);
 await expect(page.getByText(/首次绑定事务回执倒退/)).toBeVisible({timeout:5000});
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).__firstLaunchTest.recordRevision=5);
 await page.getByRole('button',{name:'重新检查设备',exact:true}).click();
 await expect(page.getByText(/首次绑定事务回执倒退/)).toHaveCount(0);
});
test('late begin receipt from an old native instance cannot clear the current failure',async({page})=>{
 await open(page);await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');
 await page.evaluate(()=>(window as any).__firstLaunchTest.holdReceipt('device_begin'));
 await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await page.waitForFunction(()=>(window as any).calls.some((c:any)=>c.command==='device_begin'));
 await page.evaluate(()=>{const w=window as any;w.__firstLaunchTest.recoveryFailure={code:'DEVICE_REPLY_INVALID',message:'new instance recovery record malformed; required=current trusted record'};w.emit('c'.repeat(32));});
 await expect(page.getByText('new instance recovery record malformed; required=current trusted record',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).__firstLaunchTest.releaseReceipt('device_begin'));
 await expect(page.getByText('new instance recovery record malformed; required=current trusted record',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
 await expect(page.getByRole('navigation')).toHaveCount(0);
});
test('corrupt credential recovery is a recoverable read error, never pristine setup',async({page})=>{
 await open(page,'?recoveryFailure');
 await expect(page.getByRole('heading',{name:'无法确认设备状态',exact:true})).toBeVisible();
 await expect(page.getByText('recovery record JSON invalid: expected object; actual=truncated',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Hive 地址',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).__firstLaunchTest.recoveryFailure=null);
 await page.getByRole('button',{name:'重新检查设备',exact:true}).click();
 await expect(page.getByLabel('Hive 地址',{exact:true})).toBeVisible();
});
test('restored unfinished initial pairing stops at completion but first observed completed binding opens overview',async({page})=>{
 await open(page,'?scene=device-pending');await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await finish(page);
 expect((await calls(page)).filter(c=>c.command==='device_begin')).toEqual([]);
 await open(page,'?scene=device-pending&completed');
 await expect(page.getByRole('heading',{name:'概览',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'前往接入 AI 账号',exact:true})).toHaveCount(0);
 expect((await calls(page)).filter(c=>c.command==='device_begin')).toEqual([]);
});
test('saved identity with a lost status receipt stays gated until matching original completion is read',async({page})=>{
 await open(page,'?scene=device-pending');await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.evaluate(()=>{const w=window as any;w.__firstLaunchTest.loseCompletion=true;w.__firstLaunchTest.holdAfterLost=true;w.__beePreviewApprove();});
 await expect(page.getByText('device status receipt lost after local identity save; result unconfirmed',{exact:true})).toBeVisible({timeout:10000});
 expect(await page.evaluate(()=>(window as any).__beeMockDeviceContext().deviceId)).toBe('dev-2');
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
 await expect(page.getByRole('navigation')).toHaveCount(0);
 await page.evaluate(()=>(window as any).__firstLaunchTest.release('device_status'));
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toBeVisible();
 expect((await calls(page)).filter(c=>c.command==='device_begin')).toEqual([]);
});
for(const mutation of ['operation','context-owner'])test('completion rejects current '+mutation+' mismatch and recovers with matching evidence',async({page})=>{
 await open(page,'?scene=device-pending');await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.evaluate(mutation=>{const w=window as any;w.__firstLaunchTest.completedMutation=mutation;w.__beePreviewApprove();},mutation);
 await expect(page.getByText(/首次绑定完成证据不匹配/)).toBeVisible({timeout:15000});
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
 await expect(page.getByRole('navigation')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'重新检查设备',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).__firstLaunchTest.completedMutation=null);
 await page.getByRole('button',{name:'重新检查设备',exact:true}).click();
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toBeVisible();
});
test('failed creation keeps the draft while diagnostics stays inside the first-launch gate',async({page})=>{
 await open(page);await page.getByLabel('Hive 地址',{exact:true}).fill('https://other-hive.example');await page.getByLabel('设备名称',{exact:true}).fill('Draft desktop');
 await page.evaluate(()=>(window as any).__firstLaunchTest.beginFailure={code:'http_rejected',message:'GET /api/bee/identity HTTP 503; creation_attempted=false; pairing POST not submitted'});
 await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await page.getByRole('button',{name:'查看诊断',exact:true}).click();
 await expect(page.getByRole('heading',{name:'诊断',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation')).toHaveCount(0);
 await page.getByRole('button',{name:'返回设备设置',exact:true}).click();
 await expect(page.getByLabel('Hive 地址',{exact:true})).toHaveValue('https://other-hive.example');
 await expect(page.getByLabel('设备名称',{exact:true})).toHaveValue('Draft desktop');
 await expect(page.getByRole('heading',{name:'设置这台设备',exact:true})).toBeFocused();
 await expect(page.getByRole('alert')).toContainText('GET /api/bee/identity HTTP 503; creation_attempted=false; pairing POST not submitted');
});
test('first binding survives configuration revisions and waits for explicit completion navigation',async({page})=>{
 await open(page);await page.getByLabel('Hive 地址',{exact:true}).fill('https://hive.example');await page.getByLabel('设备名称',{exact:true}).fill('My desktop');
 await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await expect(page.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).__beePreviewApprove());
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toBeVisible({timeout:15000});
 await expect(page.getByText('My desktop',{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).emitNotification('accounts');(window as any).emitNotification('overview');});
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation')).toHaveCount(0);
 expect((await calls(page)).filter(c=>c.command==='account_detect')).toEqual([]);
 await page.getByRole('button',{name:'前往接入 AI 账号',exact:true}).click();
 await expect(page.getByRole('heading',{name:'AI 账号',exact:true})).toBeVisible();
 expect((await calls(page)).filter(c=>['device_begin','device_recovery_prepare','device_recovery_confirm','account_action','authorize_start','runtime_start','supply_set_paused'].includes(c.command)).map(c=>c.command)).toEqual(['device_begin']);
});

test('unknown creation opens only the saved Hive console without replaying the original request',async({page})=>{
 await open(page,'?scene=device-creation-unknown');
 await expect(page.getByRole('heading',{name:'尚无法确认配对请求结果',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'打开 Hive 控制台',exact:true}).focus();await page.keyboard.press('Enter');
 expect((await calls(page)).filter(c=>c.command==='hive_open')).toEqual([{command:'hive_open',args:{}}]);
 expect(await page.evaluate(()=>(window as any).openedHive)).toBe('https://hive.example/');
 await expect(page.getByRole('navigation')).toHaveCount(0);
 expect((await calls(page)).filter(c=>['device_begin','device_recovery_prepare','device_recovery_confirm','account_action','authorize_start','runtime_start','supply_set_paused'].includes(c.command))).toEqual([]);
});
