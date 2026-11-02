# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: t10-layout-supplement.spec.ts >> L01-version
- Location: tests/t10-layout-supplement.spec.ts:12:277

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('官方客户端版本不在支持范围内。', { exact: true })
Expected: visible
Error: strict mode violation: getByText('官方客户端版本不在支持范围内。', { exact: true }) resolved to 2 elements:
    1) <p>官方客户端版本不在支持范围内。</p> aka getByLabel('平台账号列表').getByText('官方客户端版本不在支持范围内。')
    2) <p>官方客户端版本不在支持范围内。</p> aka locator('#radix-_r_7_').getByText('官方客户端版本不在支持范围内。')

Call log:
  - Expect "toBeVisible" getByText('官方客户端版本不在支持范围内。', { exact: true }) with timeout 5000ms
  - waiting for getByText('官方客户端版本不在支持范围内。', { exact: true })

```

# Page snapshot

```yaml
- generic:
  - generic [aria-hidden]:
    - generic:
      - complementary:
        - generic: Bee
        - navigation:
          - button: 概览
          - button: AI 账号
          - button: 诊断
          - button: 设置
        - generic:
          - generic:
            - text: hive.example
            - paragraph: 尚未接入 AI 账号
          - generic:
            - generic:
              - text: Fixture
              - generic: 设备与平台控制
      - generic:
        - banner:
          - generic: 本机设备
        - main:
          - generic:
            - generic:
              - heading [level=1]: AI 账号
              - paragraph: 管理这台设备用于贡献的 AI 账号。
            - button: 打开 Hive 控制台
          - region:
            - generic:
              - heading [level=2]: AI 账号
              - generic: 0 个已接入
            - generic:
              - region:
                - generic:
                  - generic:
                    - generic:
                      - heading [level=3]: OpenAI
                    - paragraph: 尚未接入 OpenAI 账号
                    - paragraph: 不能接单
                    - paragraph: 已有登录，尚未接入
                    - list:
                      - listitem:
                        - text: Hive 未看到此平台的 Bee 连接
                        - paragraph: 请在概览核对贡献运行和实际连接原因。
                        - button: 查看连接
                    - generic:
                      - status: 账号操作失败
                      - alert:
                        - paragraph: 官方客户端版本不在支持范围内。
                        - paragraph: 支持 Codex 0.162.x／0.163.x，以及 Claude Code 2.1.153 以上的 2.1.x；请核对已安装版本。
                        - group:
                          - generic: 查看失败详情
                - generic:
                  - generic:
                    - generic:
                      - generic: 额度
                      - generic: 尚未核对
                    - progressbar
                - generic:
                  - generic:
                    - button: 接入
                  - button [expanded]
              - region:
                - generic:
                  - generic:
                    - generic [aria-hidden]: ✳
                  - generic:
                    - generic:
                      - heading [level=3]: Claude
                    - paragraph: 尚未接入 Claude 账号
                    - paragraph: 不能接单
                    - paragraph: 已有登录，尚未接入
                    - list:
                      - listitem:
                        - text: 已手动暂停
                        - paragraph: 恢复接单只解除此平台暂停；不会开始贡献，其他阻塞仍需满足。
                      - listitem:
                        - text: Hive 未看到此平台的 Bee 连接
                        - paragraph: 请在概览核对贡献运行和实际连接原因。
                        - button: 查看连接
                - generic:
                  - generic:
                    - generic:
                      - generic: 额度
                      - generic: 尚未核对
                    - progressbar
                - generic:
                  - generic:
                    - button: 接入
                  - button
            - paragraph: 授权信息保留在本机
        - contentinfo:
          - text: Bee
          - generic: 设备绑定不自动开始贡献
  - dialog [active] [ref=e2]:
    - banner [ref=e3]:
      - heading "OpenAI 账号详情" [level=2] [ref=e4]
      - button "关闭" [ref=e5] [cursor=pointer]
    - paragraph [ref=e6]: 查看账号与额度，管理凭证读取方式。
    - generic [ref=e7]:
      - generic [ref=e8]:
        - term [ref=e9]: 当前账号标识
        - definition [ref=e10]: 尚未接入 OpenAI 账号
      - generic [ref=e11]:
        - term [ref=e12]: 候选账号标识
        - definition [ref=e13]: bbbbbbbbbbbbbbbb
    - paragraph [ref=e14]: 已有登录，尚未接入
    - generic [ref=e15]:
      - heading "额度与重置" [level=3] [ref=e16]
      - generic [ref=e18]:
        - generic [ref=e19]:
          - generic [ref=e20]: 额度
          - generic [ref=e21]: 尚未核对
        - progressbar "已用额度" [ref=e22]
    - group [ref=e24]:
      - generic "凭证读取方式" [ref=e25] [cursor=pointer]
      - paragraph [ref=e26]: 读取官方客户端已保存的登录；目录留空使用默认位置。
      - generic [ref=e27]:
        - text: 自定义目录
        - textbox "自定义目录" [ref=e28]:
          - /placeholder: /tmp/codex
      - generic [ref=e29]:
        - text: 存储方式
        - combobox "存储方式" [ref=e30]:
          - option "自动"
          - option "文件" [selected]
          - option "钥匙串"
      - paragraph [ref=e31]: 修改读取位置不会自动更换已接入账号。
    - generic [ref=e32]:
      - status [ref=e33]: 账号操作失败
      - alert [ref=e34]:
        - paragraph [ref=e35]: 官方客户端版本不在支持范围内。
        - paragraph [ref=e36]: 支持 Codex 0.162.x／0.163.x，以及 Claude Code 2.1.153 以上的 2.1.x；请核对已安装版本。
        - group [ref=e37]:
          - generic "查看失败详情" [ref=e38] [cursor=pointer]
    - generic [ref=e40]:
      - button "接入" [ref=e41] [cursor=pointer]
      - button "登录 OpenAI" [ref=e42] [cursor=pointer]
```

# Test source

```ts
  1  | import {test,expect,type Page,type TestInfo} from '@playwright/test';
  2  | import {writeFileSync} from 'node:fs';
  3  | import {accountFixture,installAccountFixture} from './fixtures/native-accounts.mjs';
  4  | const nav=(p:Page,name:string)=>p.getByRole('navigation').getByRole('button',{name,exact:true});
  5  | const calls=(p:Page,c:string)=>p.evaluate(c=>(window as any).calls.filter((x:any)=>x.command===c),c);
  6  | async function setup(p:Page,scenarios={}){await p.setViewportSize({width:860,height:600});await p.addInitScript(installAccountFixture,{runtimeEnabled:true,scenarios,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});await p.clock.install();await p.goto('/');await expect(p.getByText('owner@example.test',{exact:true})).toBeVisible();}
  7  | async function evidence(p:Page,i:TestInfo,id:string){
  8  |  expect(await p.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(860);await expect(p.locator('body')).not.toContainText('REPLY_INVALID');
  9  |  await p.screenshot({path:i.outputPath(id+'.png'),fullPage:true});
  10 |  writeFileSync(i.outputPath(id+'.json'),JSON.stringify(await p.evaluate(id=>({id,at:new Date().toISOString(),viewport:{width:innerWidth,height:innerHeight},body:document.body.innerText,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()})),calls:(window as any).calls}),id),null,2));
  11 | }
  12 | for(const [id,code,copy]of [['L01-client-missing','client_missing','未找到已安装的官方客户端。'],['L01-version','client_version_unsupported','官方客户端版本不在支持范围内。'],['L04-timeout','authorization_timeout','官方登录已超时。'],['L04-process-failed','authorization_process_failed','官方登录进程执行失败。']] as const)test(id,async({page},info)=>{
> 13 |  await setup(page,{loginOutcome:{state:'failed',error:{code,check:'official_source_recheck',platform:'openai',message:'safe official evidence; verified=false',evidence:{confirmed:'false'}}}});await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.evaluate(()=>(window as any).loginComplete=true);await page.clock.runFor(10001);await expect(page.getByText(copy,{exact:true})).toBeVisible();expect(await calls(page,'account_action')).toEqual([]);expect(await calls(page,'runtime_start')).toEqual([]);await evidence(page,info,id);
     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       ^ Error: expect(locator).toBeVisible() failed
  14 | });
  15 | test('L04-cancel-unknown',async({page},info)=>{
  16 |  await setup(page,{cancelUnknown:true});await nav(page,'AI 账号').click();await page.getByRole('button',{name:'OpenAI 详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'登录 OpenAI',exact:true}).click();await page.getByRole('dialog').last().getByRole('button',{name:'开始官方登录',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消官方登录',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('取消请求结果未确认');expect(await calls(page,'authorize_cancel')).toHaveLength(1);expect(await calls(page,'account_action')).toEqual([]);await evidence(page,info,'L04-cancel-unknown');
  17 | });
  18 | for(const mode of ['saved-not-effective','restore-failed','apply-unknown','saved-read-failed'])test('N03-N04-'+mode,async({page},info)=>{
  19 |  await setup(page);await nav(page,'设置').click();
  20 |  if(mode==='saved-read-failed')await page.evaluate(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;let saved=false;w.__TAURI_INTERNALS__.invoke=async(c:string,a:any)=>{if(c==='network_snapshot'&&saved){w.calls.push({command:c,args:a});throw {code:'NETWORK_RUNTIME_UNCONFIRMED',message:'network read unavailable after preference saved'};}const r=await invoke(c,a);if(c==='network_save_proxy')saved=true;return r;};});
  21 |  await page.getByLabel('本机 HTTP 代理',{exact:true}).fill('http://127.0.0.1:18393');await page.getByRole('button',{name:'保存代理',exact:true}).click();
  22 |  if(mode==='saved-not-effective'){await expect(page.locator('.ns-network-summary')).toContainText('18393');await expect(page.getByRole('button',{name:'停止并重新启动以应用',exact:true})).toBeEnabled();expect(await calls(page,'network_apply_saved')).toEqual([]);}
  23 |  else if(mode==='saved-read-failed')await expect(page.getByText('代理配置已保存；生效状态尚未确认。',{exact:true})).toBeVisible();
  24 |  else{
  25 |   await page.evaluate(mode=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(c:string,a:any)=>{const r=await invoke(c,a);if(c==='network_apply_saved'){if(mode==='apply-unknown')throw {code:'IPC_TIMEOUT',message:'apply accepted; reply lost'};r.error={code:'RUNTIME_OPERATION_FAILED',message:'restore failed: local=stopped; intended=running',details:{check:'network_restore',observed_at:new Date().toISOString(),evidence:{}}};}return r;};},mode);
  26 |   await page.getByRole('button',{name:'停止并重新启动以应用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'停止并重新启动',exact:true}).click();
  27 |   await expect(page.getByText(mode==='apply-unknown'?'应用请求结果尚未确认；只读取当前配置与运行状态，不会再次停止或应用。':'网络配置已生效，但贡献恢复未完成。',{exact:true})).toBeVisible();
  28 |   expect(await calls(page,'network_apply_saved')).toHaveLength(1);
  29 |  }
  30 |  expect(await calls(page,'runtime_start')).toEqual([]);expect(await calls(page,'runtime_stop')).toEqual([]);await evidence(page,info,'N03-N04-'+mode);
  31 | });
  32 | 
```