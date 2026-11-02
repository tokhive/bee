# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: t10-layout-supplement.spec.ts >> L01-client-missing
- Location: tests/t10-layout-supplement.spec.ts:12:209

# Error details

```
Test timeout of 50000ms exceeded.
```

```
Error: locator.click: Test timeout of 50000ms exceeded.
Call log:
  - waiting for getByRole('navigation').getByRole('button', { name: 'AI 账号', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e5]: Bee
    - navigation "Main navigation" [ref=e7]:
      - button "Overview" [ref=e8] [cursor=pointer]
      - button "AI accounts" [ref=e12] [cursor=pointer]
      - button "Diagnostics" [ref=e18] [cursor=pointer]
      - button "Settings" [ref=e21] [cursor=pointer]
    - generic [ref=e25]:
      - generic [ref=e26]:
        - text: hive.example
        - paragraph [ref=e28]: No AI account connected
      - generic [ref=e33]:
        - text: Fixture
        - generic [ref=e34]: Device and platform controls
  - generic [ref=e35]:
    - banner [ref=e36]:
      - generic [ref=e37]: This device
    - main [ref=e41]:
      - generic [ref=e42]:
        - heading "Overview" [active] [level=1] [ref=e44]
        - button "Open Hive console" [ref=e45] [cursor=pointer]
      - region "Contribution runtime" [ref=e48]:
        - generic [ref=e49]:
          - generic [ref=e54]:
            - heading "No AI account connected" [level=2] [ref=e55]
            - paragraph [ref=e56]: Start to connect; resume each platform separately.
          - button "Start contributing" [disabled] [ref=e57]
        - paragraph [ref=e58]: Connect at least one AI account first.
        - generic [ref=e59]:
          - generic [ref=e60]: Bee stopped
          - generic [ref=e64]: Hive connection has not been started
      - region "Prepare to contribute" [ref=e68]:
        - heading "Prepare to contribute" [level=2] [ref=e69]
        - list [ref=e70]:
          - listitem [ref=e71]: Bind this device
          - listitem [ref=e72]: Confirm on Hive
          - listitem [ref=e73]: Connect an AI account
          - listitem [ref=e74]: Start Bee and resume each platform
        - button "Prepare accounts" [ref=e75] [cursor=pointer]
      - region "Device pairing" [ref=e77]:
        - generic [ref=e78]:
          - heading "This device" [level=2] [ref=e79]
          - button "Verify device again" [ref=e80] [cursor=pointer]
        - generic [ref=e81]:
          - generic [ref=e82]:
            - paragraph [ref=e83]: This device
            - strong [ref=e84]: Fixture
            - status [ref=e85]: Device paired.
          - generic [ref=e86]:
            - paragraph [ref=e87]: Owner account
            - strong [ref=e88]: owner@example.test
            - generic [ref=e89]: Device owner
          - generic [ref=e90]:
            - paragraph [ref=e91]: Hive
            - strong [ref=e92]: https://hive.example
            - generic [ref=e93]: Pairing does not start contribution
      - region "Platform accounts" [ref=e94]:
        - generic [ref=e95]:
          - heading "AI accounts" [level=2] [ref=e96]
          - generic [ref=e97]: 0 connected
        - generic [ref=e99]:
          - region "OpenAI account" [ref=e100]:
            - generic [ref=e106]:
              - heading "OpenAI" [level=3] [ref=e108]
              - paragraph [ref=e109]: No OpenAI account connected yet
              - paragraph [ref=e110]: Not accepting tasks
              - paragraph [ref=e114]: Sign-in status in the selected source is unconfirmed.
              - list [ref=e115]:
                - listitem [ref=e116]:
                  - text: Hive does not see this platform’s Bee connection
                  - paragraph [ref=e117]: Open Overview to check contribution runtime and the actual connection cause.
                  - button "View connection" [ref=e118] [cursor=pointer]
            - generic [ref=e120]:
              - generic [ref=e121]:
                - generic [ref=e122]: Quota
                - generic [ref=e123]: Not checked yet
              - progressbar "Used quota" [ref=e124]
          - region "Claude account" [ref=e126]:
            - generic [ref=e127]:
              - generic [aria-hidden] [ref=e129]: ✳
              - generic [ref=e130]:
                - heading "Claude" [level=3] [ref=e132]
                - paragraph [ref=e133]: No Claude account connected yet
                - paragraph [ref=e134]: Not accepting tasks
                - paragraph [ref=e138]: Sign-in status in the selected source is unconfirmed.
                - list [ref=e139]:
                  - listitem [ref=e140]:
                    - text: Manually paused
                    - paragraph [ref=e141]: Resuming removes only this platform's manual pause. Contribution will not start, and other blockers still apply.
                  - listitem [ref=e142]:
                    - text: Hive does not see this platform’s Bee connection
                    - paragraph [ref=e143]: Open Overview to check contribution runtime and the actual connection cause.
                    - button "View connection" [ref=e144] [cursor=pointer]
            - generic [ref=e146]:
              - generic [ref=e147]:
                - generic [ref=e148]: Quota
                - generic [ref=e149]: Not checked yet
              - progressbar "Used quota" [ref=e150]
        - paragraph [ref=e152]: Authorization stays on this device
    - contentinfo [ref=e156]:
      - text: Bee
      - generic [ref=e157]: Device binding does not automatically start contribution
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
     |                                                                                                                                                                                                                         ^ Error: locator.click: Test timeout of 50000ms exceeded.
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