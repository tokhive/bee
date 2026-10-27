import {test,expect,type Page} from '@playwright/test';
const snapshot = (change:Record<string,unknown>={}) => ({operation_id:null,revision:0,state:'idle',current_version:'0.1.0',target_version:null,checked_at:null,downloaded_bytes:0,total_bytes:null,release_notes:null,error:null,...change});
const available = (change:Record<string,unknown>={}) => snapshot({operation_id:'update-a',revision:2,state:'available',target_version:'0.2.0',checked_at:'2026-10-27T01:02:03Z',...change});
async function mount(page:Page,initial=snapshot(),language='zh') {
 await page.addInitScript(({initial}) => {
  const w=window as any;w.updaterSnapshot=initial;w.updateCalls=[];w.failCheck=false;w.installFails=false;
  w.updaterInvoke=async(command:string,args:any) => {
   w.updateCalls.push({command,args});
   if(command==='update_snapshot'&&w.frozenPollSnapshot)return structuredClone(w.frozenPollSnapshot);
   if(command==='update_check') {
    if(w.failCheck){w.updaterSnapshot={...w.updaterSnapshot,operation_id:'failed-check',revision:w.updaterSnapshot.revision+1,state:'failed',error:{code:'UPDATE_CHECK_FAILED',message:'manifest HTTP 503; body=temporarily unavailable'}};return structuredClone(w.updaterSnapshot);}
    w.updaterSnapshot={...w.updaterSnapshot,operation_id:'retry-check',revision:w.updaterSnapshot.revision+1,state:'checking',error:null};
   }
   if(command==='update_download')w.updaterSnapshot={...w.updaterSnapshot,revision:w.updaterSnapshot.revision+1,state:'downloading'};
   if(command==='update_install') {
    const request=args?.request;
    if(request?.operation_id!==w.updaterSnapshot.operation_id||request?.expected_revision!==w.updaterSnapshot.revision)throw {code:'UPDATE_INSTALL_REJECTED',message:`expected_revision=${request?.expected_revision}; actual_revision=${w.updaterSnapshot.revision}`};
    w.updaterSnapshot={...w.updaterSnapshot,revision:w.updaterSnapshot.revision+1,state:'stopping'};
   }
   return structuredClone(w.updaterSnapshot);
  };
 },{initial});
 await page.goto(`/tests/fixtures/native-updater.html?lang=${language}`);
 await expect(page.getByRole('region',{name:language==='zh'?'应用更新':'Application updates',exact:true})).toBeVisible();
}
async function replace(page:Page,value:unknown) {await page.evaluate(value=>{(window as any).updaterSnapshot=value;},value);}
const calls=(page:Page,command:string)=>page.evaluate(command=>(window as any).updateCalls.filter((c:any)=>c.command===command),command);

test('native background check is observed through read-only polls without triggering an automatic check',async({page})=>{
 await mount(page);
 await replace(page,snapshot({operation_id:'background-check',revision:1,state:'failed',error:{code:'UPDATE_CHECK_FAILED',message:'background manifest HTTP 503; required=200'}}));
 await expect(page.getByRole('alert')).toContainText('background manifest HTTP 503');
 expect(await calls(page,'update_check')).toHaveLength(0);
 await expect(page.getByRole('status',{name:'现有贡献'})).toHaveText('贡献中');
});

test('background check failure leaves contribution intact and manual retry needs no app restart',async({page})=>{
 await mount(page);expect(await calls(page,'update_check')).toHaveLength(0);
 await page.evaluate(()=>{(window as any).failCheck=true;});await page.getByRole('button',{name:'检查更新',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('manifest HTTP 503; body=temporarily unavailable');
 await expect(page.getByRole('status',{name:'现有贡献'})).toHaveText('贡献中');
 await page.evaluate(()=>{(window as any).failCheck=false;});await page.getByRole('button',{name:'检查更新',exact:true}).click();
 await expect(page.getByText('正在检查更新…',{exact:true})).toBeVisible();
 await replace(page,available({operation_id:'retry-check',revision:3}));await expect(page.getByRole('button',{name:'下载更新',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>(window as any).updateCalls)).every((c:any)=>c.command.startsWith('update_'))).toBe(true);
});

test('unknown bytes never imply 100 percent and download completion awaits signed verified state',async({page})=>{
 await mount(page,available({release_notes:'<img src=x onerror="window.injected=true">\nPlain release notes'}));
 const notes=page.getByRole('region',{name:'发布说明',exact:true});await expect(notes).toContainText('<img src=x onerror="window.injected=true">');await expect(notes.locator('img')).toHaveCount(0);
 await page.getByRole('button',{name:'下载更新',exact:true}).click();
 await replace(page,available({state:'downloading',revision:4,downloaded_bytes:123,total_bytes:null}));
 await expect(page.getByText('已接收 123 字节；总大小未知',{exact:true})).toBeVisible();
 const progress=page.getByRole('progressbar');await expect(progress).not.toHaveAttribute('value');await expect(page.getByRole('region',{name:'应用更新'})).not.toContainText('100%');
 await replace(page,available({state:'downloading',revision:5,downloaded_bytes:200,total_bytes:200}));
 await expect(page.getByText('正在下载并验证更新…',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'准备安装',exact:true})).toHaveCount(0);
 expect(await calls(page,'update_install')).toHaveLength(0);
 await replace(page,available({state:'verified',revision:6,downloaded_bytes:200,total_bytes:200}));
 await expect(page.getByText('更新已下载并通过签名验证',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'准备安装',exact:true})).toBeEnabled();
});

test('quit-and-install confirmation is sole install action and failed stopping state never claims success',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'准备安装',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('可能中断正在处理的任务');await expect(dialog).not.toContainText('无任务');expect(await calls(page,'update_install')).toHaveLength(0);
 await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await calls(page,'update_install')).toHaveLength(0);
 await page.getByRole('button',{name:'准备安装',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).dblclick();
 await expect(page.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
 expect(await calls(page,'update_install')).toEqual([{command:'update_install',args:{request:{operation_id:'update-a',expected_revision:6,confirmed:true}}}]);
 await replace(page,available({state:'failed',revision:8,error:{code:'UPDATE_EXIT_FAILED',message:'child_reaped=false; Bee remains stopped; required=true'}}));
 await expect(page.getByRole('alert')).toContainText('child_reaped=false; Bee remains stopped');
 await expect(page.getByRole('region',{name:'应用更新'})).not.toContainText('更新成功');
});

test('stale confirmation surfaces native revision evidence and cannot silently install a changed receipt',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));await page.getByRole('button',{name:'准备安装',exact:true}).click();
 // Keep the client at the confirmed receipt so this case specifically exercises
 // native rejection. A poll that already observed 7 correctly rejects locally.
 await page.evaluate(()=>{const w=window as any;w.frozenPollSnapshot=structuredClone(w.updaterSnapshot);});
 await replace(page,available({state:'verified',revision:7}));await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('expected_revision=6; actual_revision=7');expect(await calls(page,'update_install')).toHaveLength(1);
});

test('keyboard confirmation starts on cancel and returns focus after dismissal',async({page})=>{
 await mount(page,available({state:'verified',revision:6}));
 const prepare=page.getByRole('button',{name:'准备安装',exact:true});await prepare.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog').getByRole('button',{name:'取消',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(prepare).toBeFocused();expect(await calls(page,'update_install')).toHaveLength(0);
});

test('late older poll stays blocked and exposes revision evidence',async({page})=>{
 await mount(page,available({state:'downloading',revision:10}));await replace(page,available({state:'verified',revision:9}));
 await expect(page.getByRole('alert')).toContainText('revision');await expect(page.getByRole('button',{name:'准备安装',exact:true})).toHaveCount(0);
});

test('current version says current and never invents recovery success in English',async({page})=>{
 await mount(page,snapshot({state:'current',revision:1,checked_at:'2026-10-27T01:02:03Z'}),'en');
 await expect(page.getByText('The current version is up to date',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Application updates'})).not.toContainText('success');
});
