import {test,expect} from '@playwright/test';
import type {FirstLaunchWizardProps} from '../src/features/device/FirstLaunchWizard';
declare global {interface Window {setWizardProps:(props:Partial<FirstLaunchWizardProps>)=>void}}

test('first setup validates the Hive origin and Unicode device name before one explicit submission',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 const hive=page.getByRole('textbox',{name:'Hive 地址',exact:true}),name=page.getByRole('textbox',{name:'设备名称',exact:true});
 await expect(hive).toBeFocused();
 await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await expect(page.getByText('请填写 Hive 地址。',{exact:true})).toBeVisible();await expect(hive).toBeFocused();
 await hive.fill('http://remote.example');await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await expect(page.getByText('远程 Hive 必须使用 HTTPS；HTTP 仅限本机回环地址。',{exact:true})).toBeVisible();
 await hive.fill('https://hive.example/path');await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await expect(page.getByText('Hive 地址不能包含路径、查询参数或片段。',{exact:true})).toBeVisible();
 await hive.fill('http://127.0.0.1:8080/');await name.fill('😀'.repeat(81));
 await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await expect(page.getByText('设备名称最多为 80 个字符。',{exact:true})).toBeVisible();await expect(name).toBeFocused();
 await name.fill('  工作设备 😀  ');await page.getByRole('button',{name:'继续绑定设备',exact:true}).dblclick();
 await expect(page.getByRole('button',{name:'正在创建配对请求…',exact:true})).toBeDisabled();
 await expect(page.getByLabel('Fixture actions')).toHaveText('begin http://127.0.0.1:8080 工作设备 😀');
 await expect(hive).toHaveValue('http://127.0.0.1:8080/');
});

const pairing={code:'ABCD-EFGH',verification_url:'https://hive.example/devices/pair?code=ABCD-EFGH',expires_at:'2099-11-12T07:00:00Z'};
const pending={state:'pending' as const,hive:'https://hive.example',name:'Work Mac',user_code:pairing.code,verification_url:pairing.verification_url,expires_at:pairing.expires_at,poll_interval_seconds:5};

test('pending pairing uses the original URL and preserves manual selection when clipboard is denied',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('clipboard permission denied');}}}));
 await page.goto('/tests/fixtures/first-launch-wizard.html');await page.evaluate(view=>window.setWizardProps({view}),pending);
 await expect(page.getByRole('heading',{name:'在 Hive 网页确认设备归属',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'复制确认网址',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'clipboard permission denied'})).toBeVisible();
 await expect(page.getByText(pairing.verification_url,{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'打开 Hive 确认网页',exact:true}).click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('open');
 await expect(page.getByText('浏览器已打开',{exact:true})).toHaveCount(0);
 await page.evaluate(view=>window.setWizardProps({view:{...view,expires_at:'2000-01-01T00:00:00Z'}}),pending);
 await expect(page.getByText('配对码有效期已到。Bee 正在向 Hive 确认最新状态，请稍等，结果会自动更新。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'复制确认网址',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'重新生成配对码',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.setWizardProps({refreshStatus:{state:'blocked',nextRetryAt:null,lastConfirmedAt:null}}));
 await expect(page.getByText('设备检查已暂停，请先处理当前问题，再重新检查设备。',{exact:true})).toBeVisible();
 await expect(page.getByText('配对码有效期已到。Bee 正在向 Hive 确认最新状态，请稍等，结果会自动更新。',{exact:true})).toHaveCount(0);
});

const identity={id:'device-1',name:'Work Mac',owner_id:'owner-1',owner_email:'owner@example.test'};
const transaction={operation_id:'a'.repeat(48),revision:1,old_identity:null,new_identity:identity,pairing:null,failure:null};

test('saving failure continues the original binding and completion waits for matching saved identity and navigation',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 await page.evaluate(({transaction})=>window.setWizardProps({view:{state:'pairing',hive:'https://hive.example',name:'Work Mac',recovery:{...transaction,phase:'saving',failure:{code:'CONFIG_WRITE_DENIED',message:'write device.json: permission denied (EACCES)',details:{check:'device_config_save',observed_at:new Date().toISOString(),evidence:{actual:'EACCES',required:'writable configuration directory'}}}}}}),{transaction});
 await expect(page.getByRole('alert').filter({hasText:'write device.json: permission denied (EACCES)'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'重新生成配对码',exact:true})).toHaveCount(0);
 const details=page.getByRole('button',{name:'查看错误详情',exact:true});await details.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog')).toContainText('EACCES');await page.keyboard.press('Escape');await expect(details).toBeFocused();
 await page.getByRole('button',{name:'继续完成绑定',exact:true}).click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('refresh');
 await page.evaluate(({transaction})=>window.setWizardProps({checking:true,view:{state:'pairing',hive:'https://hive.example',name:'Work Mac',recovery:{...transaction,phase:'saving'}}}),{transaction});
 await expect(page.getByText('正在检查绑定结果并继续保存…',{exact:true})).toBeVisible();
 await page.evaluate(({identity})=>window.setWizardProps({checking:false,completed:true,view:{state:'bound',hive:'https://hive.example',name:'Work Mac',identity},context:{hive:'https://other.example',name:'Work Mac',device_id:'device-1',owner_id:'owner-1',binding_revision:2}}),{identity});
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.setWizardProps({context:{hive:'https://hive.example',name:'Work Mac',device_id:'device-1',owner_id:'owner-1',binding_revision:2}}));
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toBeFocused();
 await expect(page.getByText('owner@example.test',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Fixture actions')).toHaveText('refresh');
 await page.getByRole('button',{name:'前往接入 AI 账号',exact:true}).click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('refresh\nnavigate accounts');
 await page.getByRole('button',{name:'进入概览',exact:true}).click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('refresh\nnavigate accounts\nnavigate overview');
});

test('transaction phases expose only the permitted original-request actions',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 await page.evaluate(({transaction})=>window.setWizardProps({view:{state:'pairing',hive:'https://hive.example',name:'Work Mac',recovery:{...transaction,new_identity:null,phase:'creation_unknown'}}}),{transaction});
 await expect(page.getByRole('heading',{name:'尚无法确认配对请求结果',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/继续绑定设备|重新生成配对码|打开 Hive 确认网页/})).toHaveCount(0);
 await page.getByRole('button',{name:'重新检查设备',exact:true}).click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('refresh');
 await page.evaluate(({pending,transaction,pairing})=>window.setWizardProps({view:{...pending,state:'draining',recovery:{...transaction,new_identity:null,phase:'draining',pairing}}}),{pending,transaction,pairing});
 await expect(page.getByText('正在等待旧设备完成任务和结算。',{exact:true})).toBeVisible();
 await expect(page.getByText('完成网页确认后回到 Bee，此处会自动更新。',{exact:true})).toHaveCount(0);
 await page.evaluate(({pending,transaction,pairing})=>window.setWizardProps({view:{...pending,state:'pairing',recovery:{...transaction,new_identity:null,phase:'redemption_unknown',pairing}}}),{pending,transaction,pairing});
 await expect(page.getByText('尚未确认绑定结果。Bee 只检查原事务，不会再次兑换。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/继续绑定设备|重新生成配对码|打开 Hive 确认网页|复制确认网址/})).toHaveCount(0);
 await page.evaluate(({pending,transaction})=>window.setWizardProps({view:{state:'expired',hive:pending.hive,name:pending.name,recovery:{...transaction,new_identity:null,phase:'expired'}}}),{pending,transaction});
 await page.getByRole('button',{name:'重新生成配对码',exact:true}).click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('refresh\nbegin https://hive.example Work Mac');
 await page.evaluate(({pending,transaction})=>window.setWizardProps({view:{state:'pairing',hive:pending.hive,name:pending.name,recovery:{...transaction,new_identity:null,phase:'blocked'}}}),{pending,transaction});
 await expect(page.getByText('设备绑定暂时无法继续，请查看具体原因并导出诊断。',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/继续绑定设备|重新生成配对码|重新检查设备/})).toHaveCount(0);
 await page.getByRole('button',{name:'查看诊断',exact:true}).click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('refresh\nbegin https://hive.example Work Mac\ndiagnostics');
});

test('startup reads and actual failures block the form while the authorized pre-creation retry preserves fields',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 await page.getByRole('textbox',{name:'Hive 地址',exact:true}).fill('https://draft.example');
 await page.evaluate(()=>window.setWizardProps({initialLoading:true}));
 await expect(page.getByRole('heading',{name:'正在检查设备…',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Hive 地址',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.setWizardProps({initialLoading:false,error:{code:'CONFIG_READ_DENIED',check:'device_context',observedAt:null,evidence:{},message:'read device.json: permission denied (EACCES)'}}));
 await expect(page.getByText('read device.json: permission denied (EACCES)',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'继续绑定设备',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'查看错误详情',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'重新检查设备',exact:true}).click();
 await page.evaluate(({transaction})=>window.setWizardProps({error:null,view:{state:'pairing',hive:'https://hive.example',name:'Retry Mac',recovery:{...transaction,new_identity:null,phase:'awaiting_confirmation',failure:{code:'HTTP_UNAVAILABLE',message:'identity GET HTTP 503 before pairing creation'}}}}),{transaction});
 await expect(page.getByRole('textbox',{name:'Hive 地址',exact:true})).toHaveValue('https://hive.example');
 await expect(page.getByRole('textbox',{name:'设备名称',exact:true})).toHaveValue('Retry Mac');
 await page.getByRole('button',{name:'继续绑定设备',exact:true}).click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('refresh\nbegin https://hive.example Retry Mac');
 await page.evaluate(({transaction})=>window.setWizardProps({busy:true,view:{state:'pairing',hive:'https://hive.example',name:'Retry Mac',recovery:{...transaction,new_identity:null,phase:'creating'}}}),{transaction});
 await expect(page.getByRole('button',{name:'正在创建配对请求…',exact:true})).toBeDisabled();
 await expect(page.getByRole('textbox',{name:'Hive 地址',exact:true})).toHaveValue('https://hive.example');
});

for(const theme of ['light','dark'])test(`narrow ${theme} English setup keeps fields and keyboard actions readable`,async({page})=>{
 await page.setViewportSize({width:360,height:520});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(`/tests/fixtures/first-launch-wizard.html?lang=en&theme=${theme}`);
 await expect(page.getByRole('heading',{name:'Set up this device',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Hive address',exact:true}).fill('https://hive.example');
 await page.getByRole('textbox',{name:'Device name',exact:true}).fill('My Mac');
 await page.getByRole('button',{name:'Continue to bind device',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByLabel('Fixture actions')).toHaveText('begin https://hive.example My Mac');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a known unbound result keeps the draft retry and normal scheduled checks remain automatic',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 await page.getByRole('textbox',{name:'Hive 地址',exact:true}).fill('https://draft.example');
 await page.evaluate(()=>window.setWizardProps({operationError:{code:'PRECHECK_REJECTED',check:'device_begin',observedAt:null,evidence:{},message:'identity GET HTTP 503 before pairing creation'}}));
 await expect(page.getByRole('textbox',{name:'Hive 地址',exact:true})).toHaveValue('https://draft.example');
 await expect(page.getByRole('button',{name:'继续绑定设备',exact:true})).toBeEnabled();
 await page.evaluate(view=>window.setWizardProps({view,operationError:null,refreshStatus:{state:'scheduled',nextRetryAt:new Date(Date.now()+5000).toISOString(),lastConfirmedAt:new Date().toISOString()}}),pending);
 await expect(page.getByText('完成网页确认后回到 Bee，此处会自动更新。',{exact:true})).toBeVisible();
 await expect(page.getByText('设备检查暂未完成，等待已安排的重试。',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.setWizardProps({error:{code:'HTTP_UNAVAILABLE',check:'device_status',observedAt:null,evidence:{},message:'GET pairing HTTP 503'}}));
 await expect(page.getByText(pairing.code,{exact:true})).toBeVisible();
 await expect(page.getByText('GET pairing HTTP 503',{exact:false})).toBeVisible();
 await expect(page.getByText('完成网页确认后回到 Bee，此处会自动更新。',{exact:true})).toHaveCount(0);
});

test('late clipboard outcomes cannot follow the user into a different transaction',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>new Promise((_resolve,reject)=>{(window as any).rejectClipboard=()=>reject(new Error('late clipboard denial'));})}}));
 await page.goto('/tests/fixtures/first-launch-wizard.html');await page.evaluate(view=>window.setWizardProps({view}),pending);
 await page.getByRole('button',{name:'复制确认网址',exact:true}).click();
 await page.evaluate(({pending})=>{window.setWizardProps({view:{...pending,name:'New request',user_code:'JKLM-NPQR',verification_url:'https://hive.example/devices/pair?code=JKLM-NPQR'}});},{pending});
 await expect(page.getByText('JKLM-NPQR',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).rejectClipboard());
 await expect(page.getByText('late clipboard denial',{exact:true})).toHaveCount(0);
 await expect(page.getByText('确认网址已复制',{exact:true})).toHaveCount(0);
});

test('origin validation rejects browser-normalized numeric aliases and unsafe origin parts before the native boundary',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 const hive=page.getByRole('textbox',{name:'Hive 地址',exact:true}),submit=page.getByRole('button',{name:'继续绑定设备',exact:true});
 for(const address of ['http://127.1','http://0x7f000001','https://user:password@hive.example','https://hive.example?debug=true','https://hive.example#fragment']){
  await hive.fill(address);await submit.click();await expect(hive).toHaveAttribute('aria-invalid','true');
 }
 await expect(page.getByLabel('Fixture actions')).toHaveText('');
 await hive.fill('http://[::1]:8080/');await page.getByRole('textbox',{name:'设备名称',exact:true}).fill('😀'.repeat(80));await submit.click();
 await expect(page.getByLabel('Fixture actions')).toHaveText('begin http://[::1]:8080 '+'😀'.repeat(80));
});

test('contradictory or unsupported initial pairing facts fail closed without a retry action',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 await page.evaluate(({pending,transaction})=>window.setWizardProps({view:{...pending,recovery:{...transaction,new_identity:null,phase:'expired'}}}),{pending,transaction});
 await expect(page.getByRole('button',{name:'重新生成配对码',exact:true})).toHaveCount(0);
 await expect(page.getByRole('alert')).toContainText('pending');
 await page.evaluate(({pending,transaction})=>window.setWizardProps({view:{state:'pairing',hive:pending.hive,name:pending.name,recovery:{...transaction,phase:'awaiting_owner_confirmation'}}}),{pending,transaction});
 await expect(page.getByRole('alert')).toContainText('awaiting_owner_confirmation');
 await expect(page.getByRole('button',{name:/继续绑定设备|确认采用新归属|重新生成配对码|重新检查设备/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'查看诊断',exact:true})).toBeEnabled();
});

test('copy success preserves the exact original URL and background refresh does not move focus',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{(window as any).clipboardValue=value;}}}));
 await page.goto('/tests/fixtures/first-launch-wizard.html');await page.evaluate(view=>window.setWizardProps({view}),pending);
 const button=page.getByRole('button',{name:'复制确认网址',exact:true});await button.click();
 await expect(page.getByText('确认网址已复制',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).clipboardValue)).toBe('https://hive.example/devices/pair?code=ABCD-EFGH');
 await button.focus();await page.evaluate(view=>window.setWizardProps({view:{...view},checking:true}),pending);
 await expect(button).toBeFocused();
 await page.getByRole('button',{name:'复制配对码',exact:true}).click();
 await expect(page.getByText('配对码已复制',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).clipboardValue)).toBe('ABCD-EFGH');
});

test('native browser failure code and check remain available without invented timestamp or extra evidence',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 await page.evaluate(view=>window.setWizardProps({view,operationError:{code:'BROWSER_OPEN_FAILED',check:'device_open',observedAt:null,evidence:{},message:'default browser open failed: OS denied launch'}}),pending);
 await expect(page.getByRole('alert')).toContainText('默认浏览器打开失败。');
 await page.getByRole('button',{name:'查看错误详情',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('BROWSER_OPEN_FAILED');
 await expect(page.getByRole('dialog')).toContainText('device_open');
 await expect(page.getByRole('dialog').locator('pre')).toHaveText('错误码: BROWSER_OPEN_FAILED\n失败环节: device_open\n原始原因: default browser open failed: OS denied launch');
 await expect(page.getByRole('button',{name:'打开 Hive 确认网页',exact:true})).toBeEnabled();
});

test('completed binding accepts a Hive display name that differs from the saved local name while identity mismatches stay blocked',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 const renamed={...identity,name:'Hive renamed Mac'};
 await page.evaluate(({renamed,transaction})=>window.setWizardProps({completed:true,view:{state:'bound',hive:'https://hive.example',name:'Hive renamed Mac',identity:renamed,recovery:{...transaction,phase:'completed',new_identity:renamed}},context:{hive:'https://hive.example',name:'Work Mac',device_id:'device-1',owner_id:'owner-1',binding_revision:2}}),{renamed,transaction});
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toBeVisible();
 await expect(page.getByText('Hive renamed Mac',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.setWizardProps({context:{hive:'https://hive.example',name:'Work Mac',device_id:'different-device',owner_id:'owner-1',binding_revision:2}}));
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
 await page.evaluate(({renamed,transaction})=>window.setWizardProps({context:{hive:'https://hive.example',name:'Work Mac',device_id:'device-1',owner_id:'owner-1',binding_revision:2},view:{state:'bound',hive:'https://hive.example',name:'Hive renamed Mac',identity:renamed,recovery:{...transaction,phase:'completed',new_identity:{...renamed,id:'different-transaction-device'}}}}),{renamed,transaction});
 await expect(page.getByRole('heading',{name:'设备已绑定',exact:true})).toHaveCount(0);
});

test('Enter validation is announced politely while the invalid input already has focus',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html');
 const hive=page.getByRole('textbox',{name:'Hive 地址',exact:true}),name=page.getByRole('textbox',{name:'设备名称',exact:true});
 const hiveError=page.locator('#first-launch-hive-error'),nameError=page.locator('#first-launch-name-error');
 await expect(hiveError).toBeEmpty();await expect(nameError).toBeEmpty();
 await expect(hive).toBeFocused();await hive.press('Enter');
 await expect(hive).toBeFocused();await expect(hive).toHaveAttribute('aria-invalid','true');
 await expect(hive).toHaveAttribute('aria-describedby',/first-launch-hive-error/);
 await expect(hiveError).toHaveAttribute('aria-live','polite');await expect(hiveError).toHaveText('请填写 Hive 地址。');
 await hive.fill('https://hive.example');await name.fill('');await name.press('Enter');
 await expect(name).toBeFocused();await expect(name).toHaveAttribute('aria-invalid','true');
 await expect(name).toHaveAttribute('aria-describedby',/first-launch-name-error/);
 await expect(nameError).toHaveAttribute('aria-live','polite');await expect(nameError).toHaveText('请填写设备名称。');
 await expect(page.getByLabel('Fixture actions')).toHaveText('');
});

for(const locale of ['zh','en'])test('wizard failures use '+locale+' reasons and guidance while retaining safe native evidence',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html?lang='+locale);
 const check=(code:string,message:string,evidence:Record<string,string>={})=>page.evaluate(({pending,code,message,evidence})=>window.setWizardProps({view:pending,error:{code,message,evidence,check:'device_status',observedAt:null}}),{pending,code,message,evidence});
 const alert=page.getByRole('alert');
 await check('tls_failed','TLS certificate verify failed; required=trusted issuer; target=https://hive.example?token=SECRET');
 await expect(alert).toContainText(locale==='zh'?'Hive 安全连接验证失败。':'Hive TLS verification failed.');
 await expect(alert).toContainText(locale==='zh'?'依赖设备身份的操作保持不可用':'Actions requiring its identity remain unavailable');
 await expect(alert).toContainText(locale==='zh'?'核对 Hive 地址与服务证书':'Check the Hive address and server certificate');
 const details=page.getByRole('button',{name:locale==='zh'?'查看错误详情':'View error details',exact:true});
 await details.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog')).toContainText('TLS certificate verify failed; required=trusted issuer');
 await expect(page.getByRole('dialog')).toContainText('tls_failed');
 await expect(page.getByRole('dialog')).not.toContainText('SECRET');
 await page.keyboard.press('Escape');await expect(details).toBeFocused();
 await check('unavailable','GET /api/bee/identity HTTP 503; service maintenance',{http_status:'503',path:'/api/bee/identity'});
 await expect(alert).toContainText(locale==='zh'?'Hive 暂时无法处理本次请求（HTTP 503）。':'Hive cannot process this request right now (HTTP 503).');
 await expect(alert).toContainText(locale==='zh'?'等待 Hive 恢复服务':'Wait for Hive to become available');
 await details.click();await expect(page.getByRole('dialog')).toContainText('GET /api/bee/identity HTTP 503; service maintenance');await page.keyboard.press('Escape');
 await check('future_reason','unclassified upstream rejection; actual=409; required=confirmed receipt');
 await expect(alert).toContainText('unclassified upstream rejection; actual=409; required=confirmed receipt');
 await expect(alert).not.toContainText(locale==='zh'?'服务证书':'server certificate');
 await expect(page.getByRole('button',{name:locale==='zh'?'重新检查设备':'Check device again',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:/继续绑定设备|Continue to bind device|进入概览|Go to overview/})).toHaveCount(0);
 await expect(page.getByLabel('Fixture actions')).toHaveText('');
});

for(const locale of ['zh','en'])test('native browser failures provide '+locale+' manual confirmation guidance without claiming success',async({page})=>{
 await page.goto('/tests/fixtures/first-launch-wizard.html?lang='+locale);
 for(const [code,message,zh,en]of [
  ['BROWSER_OPEN_FAILED','system browser launcher exited with status=7; use the displayed pairing URL','默认浏览器打开失败。','The default browser could not be opened.'],
  ['BROWSER_OPEN_TIMEOUT','browser launcher exceeded 5000ms and was reaped; opening result is unconfirmed; use the displayed pairing URL','打开浏览器超时，网页打开结果尚未确认。','Opening the browser timed out; the result is unconfirmed.'],
  ['BROWSER_OPEN_CLEANUP_FAILED','browser launcher exceeded 5000ms; terminate and reap failed: permission denied','浏览器打开程序超时，且未能确认已结束。','The browser launcher timed out and its termination could not be confirmed.'],
 ]){
  await page.evaluate(({pending,code,message})=>window.setWizardProps({view:pending,operationError:{code,message,check:'device_open',observedAt:null,evidence:{}}}),{pending,code,message});
  const alert=page.getByRole('alert');await expect(alert).toContainText(locale==='zh'?zh:en);
  await expect(alert).toContainText(locale==='zh'?'在浏览器中手动打开':'open it manually in your browser');
  await expect(page.getByRole('button',{name:locale==='zh'?'复制确认网址':'Copy confirmation URL',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:locale==='zh'?'查看错误详情':'View error details',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText(message);await expect(page.getByRole('dialog')).toContainText(code);await page.keyboard.press('Escape');
  await expect(page.getByText(locale==='zh'?'浏览器已打开':'Browser opened',{exact:true})).toHaveCount(0);
 }
 await expect(page.getByLabel('Fixture actions')).toHaveText('');
});
