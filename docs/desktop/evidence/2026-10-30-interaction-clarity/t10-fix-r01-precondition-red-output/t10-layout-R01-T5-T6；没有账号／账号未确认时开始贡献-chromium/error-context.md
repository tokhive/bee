# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: t10-layout.spec.ts >> R01 T5/T6；没有账号／账号未确认时开始贡献
- Location: tests/t10-layout.spec.ts:28:22

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Array [
-   "not_selected",
+   "selected",
    "not_selected",
  ]
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e5]: Bee
    - navigation "主导航" [ref=e7]:
      - button "概览" [ref=e8] [cursor=pointer]
      - button "AI 账号" [ref=e12] [cursor=pointer]
      - button "诊断" [ref=e18] [cursor=pointer]
      - button "设置" [ref=e21] [cursor=pointer]
    - generic [ref=e25]:
      - generic [ref=e26]:
        - text: hive.example
        - paragraph [ref=e28]: 贡献尚未启动
      - generic [ref=e33]:
        - text: Bee Desktop
        - generic [ref=e34]: 设备与平台控制
  - generic [ref=e35]:
    - banner [ref=e36]:
      - generic [ref=e37]: 本机设备
    - main [ref=e41]:
      - generic [ref=e42]:
        - heading "概览" [active] [level=1] [ref=e44]
        - button "打开 Hive 控制台" [ref=e45] [cursor=pointer]
      - region "贡献运行" [ref=e48]:
        - generic [ref=e49]:
          - generic [ref=e54]:
            - heading "贡献尚未启动" [level=2] [ref=e55]
            - paragraph [ref=e56]: 开始后建立连接；接单需单独恢复。
          - button "开始贡献" [ref=e57] [cursor=pointer]
        - generic [ref=e58]:
          - generic [ref=e59]: Bee 未运行
          - generic [ref=e63]: 尚未建立 Hive 连接
      - region "设备配对" [ref=e68]:
        - generic [ref=e69]:
          - heading "本机设备" [level=2] [ref=e70]
          - button "重新核对设备" [ref=e71] [cursor=pointer]
        - generic [ref=e72]:
          - generic [ref=e73]:
            - paragraph [ref=e74]: 本机设备
            - strong [ref=e75]: Bee Desktop
            - status [ref=e76]: 设备已绑定。
          - generic [ref=e77]:
            - paragraph [ref=e78]: 归属账号
            - strong [ref=e79]: owner@example.test
            - generic [ref=e80]: 设备所属账号
          - generic [ref=e81]:
            - paragraph [ref=e82]: Hive
            - strong [ref=e83]: https://hive.example
            - generic [ref=e84]: 配对不会自动开始贡献
      - region "平台账号列表" [ref=e85]:
        - generic [ref=e86]:
          - heading "AI 账号" [level=2] [ref=e87]
          - generic [ref=e88]: 1 个已接入
        - generic [ref=e90]:
          - region "OpenAI 账号" [ref=e91]:
            - generic [ref=e97]:
              - generic [ref=e98]:
                - heading "OpenAI" [level=3] [ref=e99]
                - generic [ref=e100]: Plus
              - paragraph [ref=e101]:
                - generic [ref=e102]: "账号标识:"
                - text: bbbbbbbbbbbbbbbb
              - paragraph [ref=e103]: 不能接单
              - list [ref=e107]:
                - listitem [ref=e108]:
                  - text: 已手动暂停
                  - paragraph [ref=e109]: 恢复接单只解除此平台暂停；不会开始贡献，其他阻塞仍需满足。
                - listitem [ref=e110]:
                  - text: Hive 未看到此平台的 Bee 连接
                  - paragraph [ref=e111]: 请在概览核对贡献运行和实际连接原因。
                  - button "查看连接" [ref=e112] [cursor=pointer]
            - generic [ref=e113]:
              - generic [ref=e114]:
                - generic [ref=e115]:
                  - generic [ref=e116]: 5 小时
                  - generic [ref=e117]: 已用 3%
                - progressbar "5 小时 已用额度" [ref=e118]
              - generic [ref=e120]:
                - generic [ref=e121]:
                  - generic [ref=e122]: 7 日
                  - generic [ref=e123]: 已用 2%
                - progressbar "7 日 已用额度" [ref=e124]
          - region "Claude 账号" [ref=e126]:
            - generic [ref=e127]:
              - generic [aria-hidden] [ref=e129]: ✳
              - generic [ref=e130]:
                - heading "Claude" [level=3] [ref=e132]
                - paragraph [ref=e133]: 尚未接入 Claude 账号
                - paragraph [ref=e134]: 不能接单
                - paragraph [ref=e138]: 所选来源未找到登录；可调整读取位置或使用官方登录。
                - list [ref=e139]:
                  - listitem [ref=e140]:
                    - text: 此 Hive 未提供更具体的接单原因
                    - paragraph [ref=e141]: 请联系 Hive 管理员核对平台配置；当前原因不能证明市场或账号状态。
                  - listitem [ref=e142]:
                    - text: Hive 未看到此平台的 Bee 连接
                    - paragraph [ref=e143]: 请在概览核对贡献运行和实际连接原因。
                    - button "查看连接" [ref=e144] [cursor=pointer]
            - generic [ref=e146]:
              - generic [ref=e147]:
                - generic [ref=e148]: 额度
                - generic [ref=e149]: 尚未核对
              - progressbar "已用额度" [ref=e150]
        - paragraph [ref=e152]: 授权信息保留在本机
    - contentinfo [ref=e156]:
      - text: Bee
      - generic [ref=e157]: 设备绑定不自动开始贡献
```

# Test source

```ts
  1  | import {test,expect,type Page,type TestInfo} from '@playwright/test';
  2  | import {readFileSync,writeFileSync} from 'node:fs';
  3  | const cases=JSON.parse(readFileSync(new URL('./fixtures/t10-layout-cases.json',import.meta.url),'utf8')) as {id:string;scene:string;scope:string;expectation:string;layer:string;viewport:{width:number;height:number};locale:string;theme:string}[];
  4  | async function capture(page:Page,info:TestInfo,c:typeof cases[number],long=false){
  5  |  await page.setViewportSize(c.viewport);await page.emulateMedia({reducedMotion:'reduce'});
  6  |  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  7  |  await page.goto('/tests/fixtures/bee-preview/app.html?'+new URLSearchParams({scene:c.scene,locale:c.locale,theme:c.theme,...long?{long:'1'}:{}}));
  8  |  await page.waitForFunction(()=>(window as any).__beePreviewReady||(window as any).__beePreviewError);
  9  |  expect(await page.evaluate(()=>(window as any).__beePreviewError)).toBeUndefined();
  10 |  if(c.id==='R01'){
> 11 |   expect(await page.evaluate(()=>Object.values((window as any).accounts).map((a:any)=>a.selection.state))).toEqual(['not_selected','not_selected']);
     |                                                                                                            ^ Error: expect(received).toEqual(expected) // deep equality
  12 |   await expect(page.getByRole('button',{name:c.locale==='en'?'Start contribution':'开始贡献',exact:true})).toBeDisabled();
  13 |   await expect(page.getByRole('region',{name:c.locale==='en'?'Contribution runtime':'贡献运行',exact:true})).toContainText(c.locale==='en'?'Connect at least one AI account first.':'请先接入至少一个 AI 账号。');
  14 |   await expect(page.getByRole('button',{name:c.locale==='en'?'Prepare accounts':'前往准备账号',exact:true})).toBeVisible();
  15 |  }
  16 |  if(c.scene==='diagnostics-export-unknown')await expect(page.locator('body')).toContainText(c.locale==='en'?'Report download result unconfirmed':'报告下载结果未确认',{timeout:35000});
  17 |  if(c.scene==='check-expired')await expect(page.locator('.account-check-status')).toHaveCount(1);
  18 |  if(c.scene==='diagnostics-read-failed')await expect(page.locator('body')).toContainText('报告读取已暂停');
  19 |  const metrics=await page.evaluate(()=>{
  20 |   const rect=(e:Element)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  21 |   return {viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},main:document.querySelector('main')?rect(document.querySelector('main')!):null,heading:document.querySelector('main h1')?.textContent,theme:document.documentElement.dataset.theme,text:document.querySelector('main')?.textContent,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({name:e.getAttribute('aria-labelledby'),...rect(e)})),actions:[...document.querySelectorAll('main button')].map(e=>({text:e.textContent,disabled:(e as HTMLButtonElement).disabled,...rect(e)})),reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,calls:(window as any).calls,scene:(window as any).__beePreviewScene};
  22 |  });
  23 |  expect(errors).toEqual([]);expect(metrics.scene).toBe(c.scene);expect(metrics.document.width).toBeLessThanOrEqual(c.viewport.width);expect(metrics.reducedMotion).toBe(true);await expect(page.locator('body')).not.toContainText('REPLY_INVALID');
  24 |  for(const d of metrics.dialogs){expect(d.x).toBeGreaterThanOrEqual(0);expect(d.right).toBeLessThanOrEqual(c.viewport.width+1);expect(d.y).toBeGreaterThanOrEqual(0);expect(d.bottom).toBeLessThanOrEqual(c.viewport.height+1);}
  25 |  const screenshot=info.outputPath(c.id+'.png');await page.screenshot({path:screenshot,fullPage:true});
  26 |  writeFileSync(info.outputPath(c.id+'.json'),JSON.stringify({...c,long,actual:metrics,screenshot,observed_at:new Date().toISOString(),pageErrors:errors},null,2));
  27 | }
  28 | for(const c of cases)test(c.id+' '+c.scope,async({page},info)=>capture(page,info,c));
  29 | for(const viewport of [{width:860,height:600},{width:1000,height:700},{width:1512,height:833}])for(const locale of ['zh','en'])for(const theme of ['light','dark'])test(`representative ${viewport.width} ${locale} ${theme}`,async({page},info)=>{
  30 |  const scene=viewport.width===860?'confirm-change':viewport.width===1000?'device-error':'running';
  31 |  await capture(page,info,{id:`matrix-${viewport.width}-${locale}-${theme}`,scene,scope:'三尺寸×中英×明暗长内容',expectation:'主页面和模态框无横向溢出',layer:'正式组件＋模拟IPC',viewport,locale,theme},true);
  32 |  if(scene==='confirm-change'){const dialogs=page.getByRole('dialog');await page.keyboard.press('Escape');await expect(dialogs).toHaveCount(1);await page.keyboard.press('Escape');await expect(dialogs).toHaveCount(0);await expect(page.getByRole('button',{name:locale==='en'?'OpenAI details':'OpenAI 详情',exact:true})).toBeFocused();}
  33 | });
  34 | 
```