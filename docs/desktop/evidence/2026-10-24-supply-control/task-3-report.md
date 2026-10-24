# Task3 客户端实现报告

状态：DONE（本代理受派的客户端、测试、使用说明范围）。源码提交：`8add4c9 feat(desktop): add verified platform supply controls`。最终 whole review、任务勾选、App 备份/打包/签名、包内真实只读冒烟和 CUA 仍由主控收尾，本报告不把它们视为已完成。

## 实现

- `SupplyClient.status(platform)` / `setPaused(platform,paused)` 使用固定 typed 命令，不接受 Hive URL、设备 ID、配置路径或凭证作为 IPC 参数。构造时绑定已核验 Hive/设备，仅供校验回包归属。
- 严格检查 `result.supply` 精确七字段，显式 bool、平台白名单、当前 Hive/device、修改目标值、原因白名单/去重/平台隔离、ready/reasons 与 paused/manually_paused 不变量及有效 UTC 时间/未来时间。未知字段/原因载荷不回显，类型错误显示本次实际类型，业务 HTTP/方法证据保留。原始 JSON 重复字段上游 Go 已拒绝，前端接收解码后的对象。
- 以传输函数为键的共享串行队列防止跨客户端/重挂载并发；失败后队列仍可用，但没有 PUT 重试或本地修改意图存储。
- 仅已核验 bound 设备在概览显示 OpenAI/Claude 卡；按顺序全部读取，全部成功后 10 秒再读；失败停止直到手动 GET 重查。核对中、失败、旧于 30 秒都隐藏当前成功，按钮禁用；点击写入前再检查时间，避免后台计时器延迟时从旧按钮写入。
- 每次 effect 独立 active 标志，卸载不继续第二平台、不留轮询；管理状态/实例改变以 key 丢弃旧设备与供给状态，旧回包不能覆盖新实例；语言、主题和导航继续保留在本次运行。
- 所有供给原因中英双语，包括实际 Hive 可见的 offline/codex_source_unavailable/authorization_unavailable；设备已绑定与平台接单条件分开，不推断贡献在线。说明 owner/platform 持久范围、暂停不终止在途请求、恢复不启动贡献。侧栏改为准确的“平台状态由 Hive 核对”。
- `test:device` 包含新单元/页面；现有 CI 已调用该入口。普通 demo E2E 排除 native fixture 测试，独立 demo 原生壳用例证实不会发 device/supply 命令。未改 demo 业务。

## TDD 证据

### 初始 TS RED → GREEN

先写测试与仅抛出 not implemented 的接口桩。执行：

```sh
PATH="$PWD/.cache/toolchains/node-v24.22.1-darwin-arm64/bin:$PATH" node --test desktop/tests/supply.test.ts
```

RED 原始结果：`tests 4 / pass 0 / fail 4`；分别为 `supply decoder not implemented`、业务证据预期 `PUT .* HTTP 503` 未匹配，以及串行 status 尚未实现。首次无模块的导入错误不作为 RED 证据；补接口桩后得到上述真实断言失败。

实现后相同命令：`tests 4 / pass 4 / fail 0`。测试覆盖两平台、全部平台匹配原因、显式 false、缺失/null/错类型/未知字段/错误归属/时间/不变量、业务错误及跨替换客户端串行。

### 页面 RED → GREEN

在 `desktop` 目录执行：

```sh
PATH="$PWD/../.cache/toolchains/node-v24.22.1-darwin-arm64/bin:$PATH" npx playwright test --config playwright.device.config.ts supply.spec.ts --grep 'two verified' --timeout 8000
```

实现前 RED：`1 failed`，`getByRole('region', { name: 'OpenAI', exact: true }).getByText('不满足接单条件')` 不存在。实现页面及原生入口后，同一行为已在最终 `test:device` 中通过。

### 自检补充 RED → GREEN

1. `setPaused(..., undefined)` 边界先补断言：`Missing expected rejection`，随后增加独立 boolean 前置检查；最终通过且无 IPC。
2. 后台时间跳进 31 秒但计时器未触发：页面测试先失败 `Expected: 0 / Received: 1`（旧按钮确实提交一次写入）；随后在操作开始处重新检查最新核对时间。最终该测试通过、写入数为 0。
3. 独立 decoder 平台白名单先失败 `Missing expected exception`；`paused:null` 的类型证据断言先失败（原消息缺 `actual_type=null`）；随后补枚举检查与实际类型证据。最终五项 supply 单测通过。
4. 管理实例替换保留运行中语言/导航：先失败 `Settings heading ... element(s) not found`；定位为整个 workspace key 重挂载导致 UI 偏好重置，随后将运行中 UI 状态提升到管理组件。最终通过，设备/供给状态仍独立重置。

测试调试还修复了 fixture 未设置 `window.isTauri=true`、虚拟时钟晚于轮询 timer 安装，以及在旧页面尚未卸载时推进时钟的用例时序；这些是测试接线/时间问题，未将其算作产品红绿证据。

## 最终验证命令与输出

全程 Node 24.22.1 使用工作树固定 PATH；Playwright 使用默认已安装 Chromium，无新增浏览器/依赖，无重复全矩阵。

| 命令 | 本代理实际结果 |
| --- | --- |
| `npm --prefix desktop run test:device` | 最终 `tests 8 / pass 8 / fail 0`；`Running 17 tests ... 17 passed (4.5s)`，含原6项设备页面和11项供给页面 |
| `npm --prefix desktop run typecheck` | 最终 `tsc --noEmit`，exit 0 |
| `npm --prefix desktop run build` | 最终 production `2003 modules transformed`、`built in 181ms`，exit 0 |
| `npm --prefix desktop run build:demo` | 最终 demo `2003 modules transformed`、`built in 111ms`，exit 0 |
| `npm --prefix desktop run test:bridge` | `tests 10 / pass 10 / fail 0` |
| 在 desktop：`npx playwright test navigation.spec.ts onboarding-overview.spec.ts settings-diagnostics.spec.ts lifecycle-ui.spec.ts --project chromium` | `Running 89 tests ... 89 passed (20.6s)`，含新增原生壳 demo 隔离用例 |
| `git diff --check`、`git diff --cached --check` | 无输出，exit 0 |

Playwright 的 Node 输出含既有环境 `NO_COLOR` 与 `FORCE_COLOR` 同时设置警告；没有应用错误或失败测试。主控已执行的 Go 全量7包/vet、tooling37和前两任务 Rust50+protocol10未重复。本代理未访问真实 Hive、真实设备配置或凭证，所有自动写入仅在页面内存 fixture。

## 页面核对

生成并人工查看以下 860×600 截图，文字可读、平台卡/按钮完整、无横向溢出；小窗口滚动后可达平台区：

- `.cache/device-pairing/supply-zh-860.png`
- `.cache/device-pairing/supply-en-860.png`

图片为本地 fixture 页面，不是真实原生包验收，不含用户真实身份。未操作现有 App PID 67414/owned 67433；没有打包或启动 GUI。

## 修改文件

- 新增：`desktop/src/system/supply.ts`、`desktop/src/features/supply/SupplyPanel.tsx`、`desktop/tests/supply.test.ts`、`desktop/tests/supply.spec.ts`、`docs/desktop/supply-control.md`。
- 接入：`desktop/src/app/NativeApp.tsx`、`desktop/src/main.tsx`、`desktop/src/components/AppShell.tsx`、`desktop/src/i18n/en.ts`、`desktop/src/styles/app.css`。
- 测试/入口：`desktop/package.json`、`desktop/playwright.config.ts`、`desktop/playwright.device.config.ts`、`desktop/tests/device.spec.ts`、`desktop/tests/navigation.spec.ts`。
- 说明：根 `README.md`、`desktop/README.md`、`docs/desktop/bridge-protocol.md`、`docs/superpowers/plans/2026-10-24-desktop-supply-control.md`（仅客户端实施记录，不勾选 Task3）。

## 自检与剩余边界

已逐项自检最小窗口、两平台归属、时间/状态不变量、共享队列、StrictMode、卸载/实例更替、禁止重试写和 demo 隔离；自检发现并修复的时间/偏好问题见 TDD 证据。没有 Go/Rust、Hive 子模块、ledger、cache 或 Superpowers 内部文件进入源码提交。

剩余工作均属主控已明确保留的 Task3 收尾：任务级独立复核与 whole review；旧包备份、匹配 `8add4c9` 或后续审查修补源码的新 Mac 包；签名及2项签名包专项、包内真实只读协议/供给冒烟、尽量 CUA 图形验收；最终来源/hash/已验收项证据入文档；最终一致性与 checkbox 收尾。`supply-control.md` 已如实标待。Windows/Linux 和既有 P0/P1 缺口不因本增量视为通过。

## Task3 审查 M1 窄修补

主控接受任务级审查 `Approved C0/I0/M1`，本轮只修 `supply.ts` 两处 paused 输入类型错误缺少本次实际类型的诊断问题。复用现有 `kind(paused)`，改为 `request paused actual_type=...; required=boolean`；拒绝条件、合法请求、串行队列及 IPC 行为保持不变。仅修改 `desktop/src/system/supply.ts` 和 `desktop/tests/supply.test.ts`。

补充 undefined/null/string 三个独立测试，分别断言确切类型诊断以及零 IPC。先运行以下命令取得真实 RED，再改两条消息并运行同一命令取得 GREEN：

```sh
PATH="$PWD/.cache/toolchains/node-v24.22.1-darwin-arm64/bin:$PATH" node --test desktop/tests/supply.test.ts
```

RED 原始结果：`tests 8 / pass 5 / fail 3`。三个失败分别为预期 `/request paused actual_type=undefined; required=boolean/`、`/request paused actual_type=null; required=boolean/`、`/request paused actual_type=string; required=boolean/`，实际均是 `SUPPLY_REPLY_INVALID: request paused wrong type; required=boolean`。

GREEN 原始结果：`tests 8 / pass 8 / fail 0 / duration_ms 100.49875`，三种类型的新增诊断断言均通过；输出无警告。`git diff --check` 和 `git diff --cached --check` 均无输出、exit 0。按主控限定未重复页面/build/其它 suite，未操作 App/Hive。

修补提交：`0c0a789 fix(desktop): report paused input types`（2 files changed, 10 insertions, 2 deletions）。提交后工作树干净，报告继续留在忽略的 `.superpowers/sdd/`，未纳入源码提交。本修补留给主控独立 final whole review。

## 主控最终审查 M1 窄修补

最终全路径审查 Approved C0/I0/M1，唯一 M1 为 Go 严格响应类型错误缺少实际类型。主控新增 `TestDesktopSupplyTypeErrorsIncludeSafeActualType`，覆盖 platform 的 number/boolean、paused 的 string/number、ready 的 array、reasons 的 object 及 array 内 number；同时断言字节位置、字段名和原始字符串/数字不泄露。首次运行七个子测试全部因旧错误缺少 actual_type 而 RED。

随后从 `json.UnmarshalTypeError` 仅提取 JSON kind（剥除 number 后的原值，并将 bool 归一为 boolean）和字节偏移；合法响应和拒绝条件保持不变。`go test ./agent -run 'TestDesktopSupply(TypeErrorsIncludeSafeActualType|RejectsResponseSchemaAndInvariantViolations)' -count=1` GREEN，exit0，agent 0.787s。
