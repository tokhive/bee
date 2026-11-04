import {test,expect,type Page} from '@playwright/test';

async function openPreview(page:Page,scene='settings-general'){
 await page.goto(`/tests/fixtures/bee-preview/index.html?scene=${scene}&theme=light`);
 await expect(page.locator('#control-status')).toHaveText('场景已就绪。');
 return page.frameLocator('iframe');
}
async function applySystemCondition(page:Page,action:string,value:string){
 await page.locator('#event-kind').selectOption(action);
 await page.locator('#event-value').selectOption(value);
 await page.getByRole('button',{name:'应用模拟条件',exact:true}).focus();
 await expect(page.getByRole('button',{name:'应用模拟条件',exact:true})).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page.locator('#control-status')).toContainText('模拟');
 await expect(page.locator('#control-status')).toContainText(value);
}

test('formal settings save language and appearance and retain both across navigation',async({page})=>{
 const app=await openPreview(page);
 await app.getByLabel('语言',{exact:true}).selectOption('en');
 await expect(app.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
 await app.getByLabel('Appearance',{exact:true}).selectOption('dark');
 await expect(app.locator('html')).toHaveAttribute('data-theme','dark');
 await app.getByRole('button',{name:'Overview',exact:true}).click();
 await app.getByRole('button',{name:'Settings',exact:true}).click();
 await app.getByRole('tab',{name:'General',exact:true}).click();
 await expect(app.getByLabel('Language',{exact:true})).toHaveValue('en');
 await expect(app.getByLabel('Appearance',{exact:true})).toHaveValue('dark');
 const frame=await (await page.locator('iframe').elementHandle())!.contentFrame();
 const saved=await frame!.evaluate(async()=>{
  const w=window as any;
  const {createPreferencesClient}=await import(/* @vite-ignore */String('/src/system/preferences.ts'));
  return createPreferencesClient(w.__TAURI_INTERNALS__.invoke).read();
 });
 expect(saved.preferences).toMatchObject({revision:2,language:'en',theme:'dark'});
});

test('formal settings reject an old revision, retain a draft, and recover by rereading preferences',async({page})=>{
 const app=await openPreview(page);
 await app.getByRole('tab',{name:'网络与代理',exact:true}).click();
 await app.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:7890');
 await app.getByRole('tab',{name:'通用',exact:true}).click();
 const frame=await (await page.locator('iframe').elementHandle())!.contentFrame();
 await frame!.evaluate(async()=>{
  const w=window as any;
  const {createPreferencesClient}=await import(/* @vite-ignore */String('/src/system/preferences.ts'));
  const client=createPreferencesClient(w.__TAURI_INTERNALS__.invoke),snapshot=await client.read();
  await client.save(snapshot.preferences.revision,{...snapshot.preferences,notifications_enabled:true});
 });
 await app.getByLabel('外观',{exact:true}).selectOption('dark');
 await expect(app.locator('[data-testid="native-settings"]')).toContainText('PREFERENCES_REVISION_CONFLICT');
 await expect(app.locator('[data-testid="native-settings"]')).toContainText('actual=1 required=0');
 await app.getByRole('button',{name:'重新读取偏好',exact:true}).click();
 await app.getByLabel('外观',{exact:true}).selectOption('dark');
 await expect(app.locator('html')).toHaveAttribute('data-theme','dark');
 await app.getByRole('tab',{name:'网络与代理',exact:true}).click();
 await expect(app.getByLabel('本机 HTTP 代理',{exact:true})).toHaveValue('http://127.0.0.1:7890');
});

test('notification denied stays denied on enable and recovers after a simulated system change',async({page})=>{
 const app=await openPreview(page,'settings-system');
 const permission=app.locator('.ns-system-row').filter({has:app.getByLabel('接收系统通知',{exact:true})});
 await expect(permission).toContainText('已拒绝');
 await app.getByLabel('接收系统通知',{exact:true}).check();
 await expect(permission).toContainText('已拒绝');
 await expect(app.getByLabel('接收系统通知',{exact:true})).toBeChecked();
 await applySystemCondition(page,'notification-permission','granted');
 await app.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
 await expect(permission).toContainText('已允许');
 await expect(app.getByLabel('接收系统通知',{exact:true})).toBeChecked();
 await app.getByRole('button',{name:'概览',exact:true}).click();
 await app.getByRole('button',{name:'设置',exact:true}).click();
 await app.getByRole('tab',{name:'通知与启动',exact:true}).click();
 await expect(permission).toContainText('已允许');
});

test('autostart failure distinguishes desired and actual registration and recovers through explicit settings actions',async({page})=>{
 const app=await openPreview(page,'running');
 await app.getByRole('button',{name:'设置',exact:true}).click();
 await app.getByRole('tab',{name:'通知与启动',exact:true}).click();
 const startup=app.getByLabel('登录系统后启动 Bee',{exact:true});
 const registration=app.locator('.ns-system-row').filter({has:startup});
 await applySystemCondition(page,'autostart-registration','fail');
 await startup.check();
 await expect(startup).toBeChecked();
 await expect(registration).toContainText('未登记');
 await expect(app.locator('[data-testid="native-settings"]')).toContainText('AUTOSTART_REGISTER_FAILED');
 await expect(app.locator('[data-testid="native-settings"]')).toContainText('os_code=13');
 await applySystemCondition(page,'autostart-registration','available');
 await app.getByRole('button',{name:'重新检查系统状态',exact:true}).click();
 await expect(registration).toContainText('未登记');
 await startup.uncheck();
 await startup.check();
 await expect(registration).toContainText('已登记');
 await expect(app.getByText('已核对系统启动登记。',{exact:true})).toBeVisible();
});
