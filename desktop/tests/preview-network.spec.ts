import {test,expect,type Page} from '@playwright/test';

async function openPreview(page:Page,scene='settings-network'){
 await page.goto(`/tests/fixtures/bee-preview/index.html?scene=${scene}&theme=light`);
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 return page.frameLocator('iframe');
}
async function condition(page:Page,action:string,value:string){
 await page.locator('#event-kind').selectOption(action);
 await page.locator('#event-value').selectOption(value);
 await page.getByRole('button',{name:'应用模拟条件',exact:true}).click();
 await expect(page.locator('#control-status')).toContainText(value);
}
async function saveProxy(page:Page){
 const app=page.frameLocator('iframe');
 await app.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7890');
 await app.getByRole('button',{name:'保存代理',exact:true}).click();
 await expect(app.getByText('代理已保存；当前仍使用上次生效配置。',{exact:true})).toBeVisible();
}
async function applyProxy(page:Page){
 const app=page.frameLocator('iframe');
 await app.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();
 await expect(app.getByRole('dialog')).toContainText('将停止当前贡献');
 await app.getByRole('button',{name:'停止并重新启动',exact:true}).click();
}

test('formal proxy save requires apply confirmation and then diagnostics uses the applied runtime context',async({page})=>{
 const app=await openPreview(page);
 await app.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7890');
 await app.getByRole('button',{name:'测试连接',exact:true}).click();
 await expect(app.getByText('本机代理连接',{exact:true})).toBeVisible();
 await saveProxy(page);
 await app.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();
 await app.getByRole('button',{name:'取消',exact:true}).click();
 await expect(app.getByText('下次启动生效。当前连接继续使用已生效配置。',{exact:true})).toBeVisible();
 await applyProxy(page);
 await expect(app.getByText('当前生效配置',{exact:true}).locator('..')).toContainText('http://127.0.0.1:7890');
 await app.getByRole('button',{name:'诊断',exact:true}).click();
 await app.getByRole('button',{name:'运行诊断',exact:true}).click();
 await expect(app.getByText('检查已完成',{exact:true})).toBeVisible();
 await expect(app.locator('body')).not.toContainText('DIAGNOSTICS_REPLY_INVALID');
});

test('formal proxy failures preserve the draft and recover after the simulated condition is repaired',async({page})=>{
 const app=await openPreview(page);
 await condition(page,'network-fault','save');
 await app.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7890');
 await app.getByRole('button',{name:'保存代理',exact:true}).click();
 await expect(app.locator('[data-testid="native-settings"]')).toContainText('PREFERENCES_WRITE_FAILED');
 await expect(app.locator('[data-testid="native-settings"]')).toContainText('os_code=13');
 await expect(app.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7890');
 await condition(page,'network-fault','none');
 await app.getByRole('button',{name:'核对当前保存配置',exact:true}).click();
 await app.getByRole('button',{name:'保存代理',exact:true}).click();
 await expect(app.getByText('代理已保存；当前仍使用上次生效配置。',{exact:true})).toBeVisible();
 await condition(page,'network-fault','apply');
 await applyProxy(page);
 await expect(app.locator('[data-testid="native-settings"]')).toContainText('NETWORK_RUNTIME_UNCONFIRMED');
 await expect(app.locator('[data-testid="native-settings"]')).toContainText('runtime_snapshot response unavailable');
 await condition(page,'network-fault','none');
 await applyProxy(page);
 await expect(app.getByText('当前生效配置',{exact:true}).locator('..')).toContainText('http://127.0.0.1:7890');
});

test('an unknown proxy apply receipt is reconciled by reading without another apply',async({page})=>{
 const app=await openPreview(page);
 await saveProxy(page);
 await condition(page,'network-fault','unknown');
 await applyProxy(page);
 await expect(app.getByText('应用请求结果尚未确认；只读取当前配置与运行状态，不会再次停止或应用。',{exact:true})).toBeVisible();
 await app.getByRole('button',{name:'刷新生效路径',exact:true}).click();
 await expect(app.getByText('当前生效配置',{exact:true}).locator('..')).toContainText('http://127.0.0.1:7890');
 const writes=await page.locator('iframe').evaluate((el:HTMLIFrameElement)=>(el.contentWindow as any).calls.filter((call:any)=>call.command==='network_apply_saved').length);
 expect(writes).toBe(1);
});

test('formal diagnostics keep cancellation terminal and recover the same paused report through controls',async({page})=>{
 const app=await openPreview(page,'diagnostics-running');
 await app.getByRole('button',{name:'取消诊断',exact:true}).click();
 await expect(app.getByText('诊断已取消',{exact:true})).toBeVisible();
 await app.getByRole('button',{name:'概览',exact:true}).click();
 await app.getByRole('button',{name:'诊断',exact:true}).click();
 await expect(app.getByText('诊断已取消',{exact:true})).toBeVisible();
 await app.getByRole('button',{name:'重新运行诊断',exact:true}).click();
 await expect(app.getByText('诊断进行中',{exact:true})).toBeVisible();
 await condition(page,'diagnostics-result','read-failed');
 await expect(app.getByText('报告读取已暂停，已返回的检查仍保留。',{exact:true})).toBeVisible();
 await condition(page,'diagnostics-result','available');
 await app.getByRole('button',{name:'重新读取原报告',exact:true}).click();
 await expect(app.getByText('报告读取已暂停，已返回的检查仍保留。',{exact:true})).toBeHidden();
 await condition(page,'diagnostics-result','completed');
 await expect(app.getByText('检查已完成',{exact:true})).toBeVisible();
});
