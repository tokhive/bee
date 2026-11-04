# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-updater.spec.ts >> T9 saved language and same-revision system changes synchronize native metadata without notification or runtime writes
- Location: tests/native-updater.spec.ts:183:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
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
        - paragraph [ref=e28]: 尚未接入 AI 账号
      - generic [ref=e33]:
        - text: Fixture
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
            - heading "尚未接入 AI 账号" [level=2] [ref=e55]
            - paragraph [ref=e56]: 开始后建立连接；接单需单独恢复。
          - button "开始贡献" [disabled] [ref=e57]
        - paragraph [ref=e58]: 请先接入至少一个 AI 账号。
        - generic [ref=e59]:
          - generic [ref=e60]: Bee 未运行
          - generic [ref=e64]: 尚未建立 Hive 连接
      - region "准备贡献" [ref=e68]:
        - heading "准备贡献" [level=2] [ref=e69]
        - list [ref=e70]:
          - listitem [ref=e71]: 绑定本机设备
          - listitem [ref=e72]: 在 Hive 网页确认
          - listitem [ref=e73]: 接入 AI 账号
          - listitem [ref=e74]: 开始贡献并按平台恢复接单
        - button "前往准备账号" [ref=e75] [cursor=pointer]
      - region "设备配对" [ref=e77]:
        - generic [ref=e78]:
          - heading "本机设备" [level=2] [ref=e79]
          - button "重新核对设备" [ref=e80] [cursor=pointer]
        - generic [ref=e81]:
          - generic [ref=e82]:
            - paragraph [ref=e83]: 本机设备
            - strong [ref=e84]: Fixture
            - status [ref=e85]: 设备已绑定。
          - generic [ref=e86]:
            - paragraph [ref=e87]: 归属账号
            - strong [ref=e88]: owner@example.test
            - generic [ref=e89]: 设备所属账号
          - generic [ref=e90]:
            - paragraph [ref=e91]: Hive
            - strong [ref=e92]: https://hive.example
            - generic [ref=e93]: 配对不会自动开始贡献
      - region "平台账号列表" [ref=e94]:
        - generic [ref=e95]:
          - heading "AI 账号" [level=2] [ref=e96]
          - generic [ref=e97]: 0 个已接入
        - generic [ref=e99]:
          - region "OpenAI 账号" [ref=e100]:
            - generic [ref=e106]:
              - heading "OpenAI" [level=3] [ref=e108]
              - paragraph [ref=e109]: 尚未接入 OpenAI 账号
              - paragraph [ref=e110]: 不能接单
              - paragraph [ref=e114]: 所选来源的登录状态待确认。
              - list [ref=e115]:
                - listitem [ref=e116]:
                  - text: Hive 未看到此平台的 Bee 连接
                  - paragraph [ref=e117]: 请在概览核对贡献运行和实际连接原因。
                  - button "查看连接" [ref=e118] [cursor=pointer]
            - generic [ref=e120]:
              - generic [ref=e121]:
                - generic [ref=e122]: 额度
                - generic [ref=e123]: 尚未核对
              - progressbar "已用额度" [ref=e124]
          - region "Claude 账号" [ref=e126]:
            - generic [ref=e127]:
              - generic [aria-hidden] [ref=e129]: ✳
              - generic [ref=e130]:
                - heading "Claude" [level=3] [ref=e132]
                - paragraph [ref=e133]: 尚未接入 Claude 账号
                - paragraph [ref=e134]: 不能接单
                - paragraph [ref=e138]: 所选来源的登录状态待确认。
                - list [ref=e139]:
                  - listitem [ref=e140]:
                    - text: 已手动暂停
                    - paragraph [ref=e141]: 恢复接单只解除此平台暂停；不会开始贡献，其他阻塞仍需满足。
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
  87  |  await page.keyboard.press('Escape');await expect(prepare).toBeFocused();expect(await calls(page,'update_install')).toHaveLength(0);
  88  | });
  89  | 
  90  | test('late older poll stays blocked and exposes revision evidence',async({page})=>{
  91  |  await mount(page,available({state:'downloading',revision:10}));await replace(page,available({state:'verified',revision:9}));
  92  |  await expect(page.getByRole('alert')).toContainText('revision');await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);
  93  | });
  94  | 
  95  | test('current version says current and never invents recovery success in English',async({page})=>{
  96  |  await mount(page,snapshot({state:'current',revision:1,checked_at:'2026-10-27T01:02:03Z'}),'en');
  97  |  await expect(page.getByText('The current version is up to date',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeVisible();
  98  |  await expect(page.getByRole('region',{name:'Application updates'})).not.toContainText('success');
  99  | });
  100 | 
  101 | test('settings About has one version and one update action wired to the fixed native commands',async({page})=>{
  102 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  103 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  104 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.__TAURI_INTERNALS__.invoke=async(command:string,args:unknown)=>{const value=await invoke(command,args);if(command==='bridge_status'&&value.metadata)value.metadata.bee_version='0.1.0';return value;};});
  105 |  await page.goto('/');
  106 |  await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
  107 |  await page.getByRole('tab',{name:'关于',exact:true}).click();
  108 |  const about=page.getByRole('region',{name:'关于 Bee',exact:true});
  109 |  const update=about.getByRole('region',{name:'应用更新',exact:true});
  110 |  await expect(update.getByText('Bee 0.1.0',{exact:true})).toBeVisible();
  111 |  await expect(about.getByText('桌面应用版本',{exact:true})).toHaveCount(0);
  112 |  await expect(about.getByText('Bee 版本',{exact:true})).toHaveCount(0);
  113 |  await expect(update.getByRole('button')).toHaveCount(1);
  114 |  await expect(update.getByRole('button',{name:'检查更新',exact:true})).toBeVisible();
  115 |  await expect(about).toContainText('macOS · arm64');
  116 |  const updateCalls=()=>page.evaluate(()=>(window as any).calls.filter((c:any)=>c.command.startsWith('update_')));
  117 |  await update.getByRole('button',{name:'检查更新',exact:true}).click();
  118 |  await expect(update.getByRole('button',{name:'下载更新',exact:true})).toBeVisible();
  119 |  const notes=update.getByRole('group',{name:'发布说明',exact:true});
  120 |  await expect(notes).not.toHaveAttribute('open');await notes.getByText('发布说明',{exact:true}).click();
  121 |  await expect(notes).toContainText('Fixture release notes');
  122 |  await update.getByRole('button',{name:'下载更新',exact:true}).click();
  123 |  const install=update.getByRole('button',{name:'安装更新…',exact:true});await expect(install).toBeVisible();
  124 |  await page.getByRole('tab',{name:'通用',exact:true}).click();
  125 |  await page.getByLabel('外观',{exact:true}).selectOption('dark'); // switching tabs and parent rerender must preserve the verified client receipt
  126 |  await page.getByRole('tab',{name:'关于',exact:true}).click();
  127 |  await install.click();const dialog=page.getByRole('dialog');
  128 |  await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeFocused();
  129 |  await page.keyboard.press('Escape');await expect(install).toBeFocused();
  130 |  expect((await updateCalls()).filter((c:any)=>c.command==='update_install')).toHaveLength(0);
  131 |  await install.click();await dialog.getByRole('button',{name:'退出并安装',exact:true}).click();
  132 |  await expect(update.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
  133 |  expect((await updateCalls()).filter((c:any)=>c.command!=='update_snapshot')).toEqual([
  134 |   {command:'update_check',args:{}},{command:'update_download',args:{}},
  135 |   {command:'update_install',args:{request:{operation_id:'fixture-update',expected_revision:2,confirmed:true}}},
  136 |  ]);
  137 | });
  138 | 
  139 | test('a failed install receipt can be reconciled and replaced without repeating the same install',async({page})=>{
  140 |  await mount(page,available({state:'verified',revision:6}));
  141 |  await page.evaluate(()=>{const w=window as any,invoke=w.updaterInvoke;w.updaterInvoke=(command:string,args:unknown)=>{
  142 |   if(command==='update_install'&&!w.firstInstallFailed){w.firstInstallFailed=true;w.updateCalls.push({command,args});return Promise.reject({code:'UPDATE_DISK_SPACE',message:'available=1; required=600 bytes; no exit performed'});}
  143 |   return invoke(command,args);
  144 |  };});
  145 |  await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
  146 |  await expect(page.getByRole('alert')).toContainText('available=1; required=600');
  147 |  await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();
  148 |  await page.getByRole('button',{name:'重新检查更新',exact:true}).click();
  149 |  await replace(page,available({operation_id:'retry-check',revision:8}));
  150 |  await page.getByRole('button',{name:'下载更新',exact:true}).click();
  151 |  await replace(page,available({operation_id:'retry-check',state:'verified',revision:10}));
  152 |  await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
  153 |  await expect(page.getByText('正在停止 Bee，准备安装…',{exact:true})).toBeVisible();
  154 |  const installs=await calls(page,'update_install');expect(installs).toHaveLength(2);
  155 |  expect(installs.map((c:any)=>c.args.request)).toEqual([
  156 |   {operation_id:'update-a',expected_revision:6,confirmed:true},
  157 |   {operation_id:'retry-check',expected_revision:10,confirmed:true},
  158 |  ]);
  159 | });
  160 | 
  161 | test('T9 known update failure is localized with the original evidence in the same notice',async({page})=>{
  162 |  await mount(page,snapshot({state:'failed',revision:1,error:{code:'UPDATE_SIGNATURE_FAILED',message:'signed=0.2.0; announced=0.3.0; installer not called',details:{check:'update_signature',observed_at:'2026-11-02T12:00:00Z',evidence:{actual:'0.2.0',required:'0.3.0'}}}}));
  163 |  const alert=page.getByRole('alert');await expect(alert).toContainText('更新签名验证失败');await expect(alert).toContainText('signed=0.2.0; announced=0.3.0');await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);
  164 | });
  165 | 
  166 | test('T9 an unknown install receipt survives leaving settings and permits only reading that operation',async({page})=>{
  167 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  168 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  169 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.installSubmissions=0;w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{
  170 |   if(command==='update_install'){w.installSubmissions++;throw {code:'IPC_TIMEOUT',message:'installation receipt unavailable; operation=fixture-update; submission outcome unknown'};}
  171 |   return invoke(command,args);
  172 |  };});
  173 |  await page.goto('/');const nav=page.getByRole('navigation');await nav.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  174 |  await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'下载更新',exact:true}).click();await page.getByRole('button',{name:'安装更新…',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'退出并安装',exact:true}).click();
  175 |  await expect(page.getByRole('alert')).toContainText('installation receipt unavailable');
  176 |  await nav.getByRole('button',{name:'概览',exact:true}).click();await nav.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  177 |  await expect(page.getByText('安装请求回执尚未确认；只核对原更新，不会再次提交安装。',{exact:true})).toBeVisible();
  178 |  await page.getByRole('button',{name:'重新读取更新状态',exact:true}).click();
  179 |  await expect(page.getByRole('button',{name:'安装更新…',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新检查更新',exact:true})).toHaveCount(0);
  180 |  expect(await page.evaluate(()=>(window as any).installSubmissions)).toBe(1);
  181 | });
  182 | 
  183 | test('T9 saved language and same-revision system changes synchronize native metadata without notification or runtime writes',async({page})=>{
  184 |  const {installAccountFixture,accountFixture}=await import('./fixtures/native-accounts.mjs');
  185 |  await page.addInitScript(installAccountFixture,{runtimeEnabled:true,accounts:{openai:accountFixture('openai'),claude:accountFixture('claude')}});
  186 |  await page.addInitScript(()=>{const w=window as any,invoke=w.__TAURI_INTERNALS__.invoke;w.localeRequests=[];w.__TAURI_INTERNALS__.invoke=async(command:string,args:any)=>{if(command==='native_locale_sync'){w.localeRequests.push(args.request);if(w.localeFails)throw {code:'NATIVE_LOCALE_MENU_FAILED',message:'native menu set_text failed: item=bee-open; actual=permission denied'};return null;}return invoke(command,args);};});
> 187 |  await page.goto('/');await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.length)).toBe(1);
      |                                                                                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  188 |  await page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');
  189 |  await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('en');
  190 |  await page.getByLabel('Language',{exact:true}).selectOption('system');await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('zh');
  191 |  const revision=await page.evaluate(()=>(window as any).localeRequests.at(-1).revision);
  192 |  await page.evaluate(()=>{Object.defineProperty(navigator,'language',{configurable:true,value:'en-US'});dispatchEvent(new Event('languagechange'));});
  193 |  await expect.poll(()=>page.evaluate(()=>(window as any).localeRequests.at(-1).locale)).toBe('en');
  194 |  const metadata=await page.evaluate(()=>(window as any).localeRequests);expect(metadata.at(-1).revision).toBe(revision);expect(metadata.every((r:any,i:number)=>i===0||r.sequence>metadata[i-1].sequence)).toBe(true);
  195 |  const writes=await page.evaluate(()=>(window as any).calls.filter((c:any)=>['notification_enable','notification_retry','runtime_start','runtime_stop'].includes(c.command)));expect(writes).toEqual([]);
  196 |  await page.evaluate(()=>{(window as any).localeFails=true;});await page.getByLabel('Language',{exact:true}).selectOption('zh');await expect(page.getByRole('alert')).toContainText('native menu set_text failed');
  197 |  await page.evaluate(()=>{(window as any).localeFails=false;});await page.getByRole('button',{name:'重新同步原生语言',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
  198 | });
  199 | 
```