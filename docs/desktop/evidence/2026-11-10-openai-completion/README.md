# OpenAI 账号实施与验证记录

日期：2026-11-10（Asia/Shanghai）。状态：**部分实现，完整规格未交付、未完成真实验收**。

本轮仅修改 `bee-desktop-ui` worktree。已批准的 [规格](../../../../.scratch/bee-account-completion/spec.md) 保持有效；没有重新确认产品方案，没有修改 Hive 主工作区、合并、部署或登录真实账号。开始实施时 HEAD 为 `d5a8588`；验证期间另一会话提交了 `3773db9`（Claude 预览），本轮提交以该提交为父提交，只纳入本会话文件。

## 已实现的增量

- Go authorizer 持续读取本次受控 Codex 进程的 stderr。每行最多 16 KiB；分段输出先拼成完整行，过长整行丢弃至换行，收尾清除未完成行。只接受官方 HTTPS host/path、唯一 OAuth 参数、PKCE 与已绑定的 localhost callback；URL 留在私有内存，不进 journal、日志、IPC 或 UI。
- `authorize_progress` 提供真实阶段、原 operation、sequence、停止原因、维护核对 worker 与动作许可。`authorize_open` 只打开本次仍有效的链接，固定系统 opener argv，不经 shell；重复打开不会启动第二次登录。登录取消同时取消仍在执行的 opener；OS 已受理的页面不能撤回。
- bridge 可选接口决定 capability；Rust 注册、严格解码、实例 metadata 与 TypeScript client 一致。旧三方法 authorizer 不广告扩展。sequence／revision 较旧返回被拒绝。`actions.restart` 保持 false，没有注册复合重登命令。
- 正式账号页只为 OpenAI 使用新卡片；首次四步、直接接入两步、换号三步，保留数字与当前来源。成功提示要求本次 owned operation 与当前同步／注册／供给证据；同一 App 运行中切页保留，点击完成只收提示，重启不重放，新故障或身份变化优先。
- 账号详情只补充身份、读取历史与来源设置。设置保存在现有私有 preferences 文件中；旧配置可缺省 `openai_source`，显式 null、未知字段、非法 store 与相对／过长目录被拒绝。保存成功须 save 回执和 readback 一致，再执行真实来源读取与官方核验。保存失败保留输入，打开或关闭面板不等于修复。
- OpenAI 普通 account／supply 读取临时失败按 1／2／4 秒最多重试三次；自动 account snapshot 使用 `refresh=false`。已知接入／换号原 ID 进行最多 60 秒纯查询，停止后允许手动核对；手动点击与在途查询合并。普通登录进度按原 ID 查询，保留管理端 10 分钟期限。重复同实例 metadata 不重建客户端或重置查询期限。
- 故障卡片隐藏无助于修复的额度区，同因去重，独立错误、供给条件及可信暂停事实保留。核验阶段不展示取消登录；取消／清理阶段不展示推进中的步骤。

## 未闭环项与证据

| 编号 | 已核实事实 | 影响与后续实施条件 |
| --- | --- | --- |
| B1 | 绑定的 Codex SHA `092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`：普通 CLI login 使用 1455／备用 1457；`/success`、`/cancel` 没有本次 state 校验；端口冲突路径可能请求旧 `/cancel`。未找到普通 CLI 可设置隔离端口的入口 | 不能仅靠当前 PID、空闲端口或 UI cancel→snapshot→start 证明复合重登安全。restart／status／cancel、新登录提交边界的取消路由、缺失归属恢复均未实现。需先补可证明隔离的官方适配协议；不能删除 journal 或结束未知外部进程绕过 |
| B2 | 只读核实 Hive 的 `hive/internal/service/platform_control.go`，平台控制仍直接 UPSERT paused 并返回当前供给快照；缺少原操作持久结果、意图排序及恢复资格／替换归属协议 | 当前授权不含 Hive 写工作区。任务 03 需要在获授权的 Hive checkout 实施事务协议与数据库测试；不以 Bee mock、当前 paused 或修复条件冒充原操作结果 |
| B3 | Bee 的接入／换号查询只认已取得的原 operation ID，且只读当前 verified record；ID 不匹配立即停止并保留错误 | 首次写回执丢失而未取得 ID、记录被替换、App 重启后的完整原操作恢复仍未闭环；60 秒查询器不能补造缺失 ID |
| B4 | 官方登录取链未单设短等待阈值；无链接时保持 starting，最终由 10 分钟 authorizer 期限收尾。现有维护核对不能修复未知进程归属 | 无链接短等待、安全再次登录、维护阻塞后的完整用户出口，以及准备失败后的连续重试 UI 仍需补齐。候选页面只表达真实阻塞，不能算 Q1 已完成 |
| B5 | 未执行实际官方账号、Tauri 桌面和配套 Hive 部署联调 | 全部 108 项真实业务验收保持未验收。受控 OS 子进程和模拟 opener 不证明官方网络、真实浏览器或部署兼容 |

官方源码依据：[login server](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/login/src/server.rs)、[CLI login](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/cli/src/login.rs)。绑定源码的调查不代表这些风险已被修复。未新增普通登录对外部端口的安全保证。

## 参数与兼容

| 环节 | 本轮实际参数／规则 | 依据与边界 |
| --- | --- | --- |
| 安全查询失败 | 初次＋最多三次；1／2／4 秒 | 已批准规格；参数／权限／结构错误立即停止；不套用于业务写 |
| 接入／换号原 ID 查询 | 一轮 60 秒，正常轮询 1 秒 | 独立 deadline，即使一次 read 仍 pending 也停止 UI 等待；迟到确定结果可更新证据；手动点击加入 pending，不重放写 |
| 普通登录进度 | 正常 1 秒轮询，查询轮次最多 10 分钟 | backend 从 Start 起的 10 分钟仍权威；前端手动核对不能延长后台期限 |
| 共享稳定状态 | 10 秒；现有 moving 协调器有 400 ms 检查节奏 | 共享读取与原操作查询仍存在重复只读观测；不是进度遥测，也不证明原操作持久结果 |
| 官方 probe／系统 opener | 各最多 5 秒 | 沿用 probe 上限；opener 绑定请求和 owned 登录 context |
| 既有维护 worker | 12 秒 | 沿用恢复机制，返回真实 blocker；不是 Hive 保护 TTL，不自动释放保护 |
| 取链短阈值／安全暂停写重试 | 未落实；本轮无自动业务写重试 | B1／B2 阻塞，不把查询三次上限套给写，不用 HTML 延时当参数 |
| 工具链 | 现有 Node 24、React／TS／Tauri／Go；Rust 使用已安装 `cargo +1.94` | 未安装／升级依赖。默认 `1.94.0` 工具链异常时使用已有 toolchain；Chrome 使用系统已安装版本 |

## 自动验证

| 证据 | 命令／文件 | 结果和范围 |
| --- | --- | --- |
| G1 | 见下方可复制命令 | 通过。含真实 authorizer、受控 OS 子进程、分段／超长 URL、打开失败、取消撤销、超时及维护边界；未做真实官方授权 |
| R1 | `cargo +1.94 test --manifest-path desktop/src-tauri/Cargo.toml --lib` | 289 passed，4 ignored；其中一项 ignored 的跨层登录测试另行执行。新增来源持久化验证在后续目录约束修改后再次单测通过 |
| N1 | `go test -c -o .cache/openai-completion/agent.test ./agent`，再设 `BEE_NATIVE_BRIDGE_TEST_BINARY` 执行 `cargo +1.94 test --manifest-path desktop/src-tauri/Cargo.toml native_login_progress_open_cancel --lib -- --ignored --nocapture` | 通过。真实 Rust Bridge → 生产 Go transport → authorizer → 受控 OS 子进程／Hive HTTP／browser launcher；覆盖原 ID 进度、重复打开不新建、取消与终态。Hive 为受控服务，没有真实数据库事务 |
| T1 | `cd desktop` 后 `node --test tests/*.test.ts tests/tooling.test.mjs` | 365 passed。含生产 decoder、同实例 capability、查询时钟、偏好配置、共享状态和 50 个原生命令参数与 Rust 源码契约；不包含浏览器 spec |
| U1～U5 | [openai-completion.spec.ts](../../../../desktop/tests/openai-completion.spec.ts) | 10 项专项测试全部通过；真实 React＋受控原生返回：完成提示／无写、保存失败留输入／readback、同 ID 打开／重试耗尽、60 秒原操作查询、独立故障与暂停展示 |
| U6 | 同一 spec 的四种截图组合 | 浅／深色 × 820×680／1080×700；受控首次登录→接入→四步全绿，完成提示切页保留，新故障覆盖，reload 不重放完成提示；无横向溢出 |
| H1 | 同一 spec 的候选与冻结历史 | 查询仍未知→手动查询→仍未知；归属缺失不假成功；原历史可独立打开。仅静态候选验证 |
| Build | `cd desktop` 后 `npm run build` | TypeScript 检查和 Vite build 通过；已有大 chunk 提示，未改打包策略 |

G1 在本 worktree 根目录执行：

```sh
go test -race ./agent ./desktopbridge -run 'TestDesktop(Login|Authorize)|TestCodexLogin' -count=1 -timeout=120s
```

UI 专项在本 worktree 的 `desktop` 目录执行，使用系统已安装的 Chrome：

```sh
BEE_TEST_BROWSER_CHANNEL=chrome npx playwright test --config playwright.openai.config.ts
```

最后一次原 ID 查询修正后，U4 专项和 `npm run typecheck` 再次通过：后台当前记录替换为新 ID 后，仍保留本次原 ID，停止查询并在详情保留 `actual`／`required` 证据；没有自动改查新操作或重放写。

本轮没有声称全套 UI spec 或全量 Go 仓库测试通过。原有 OpenAI UI spec 仍按旧结构断言，尚未全部迁移。Ego 原任务空间已失效，未新建或接管其他会话空间；可运行界面验证使用上表 Playwright 独立受控 Chrome。HTML 认可、受控测试与真实联调分别记账。

## 正式界面与认可主预览差异

比较基线是 [docs/preview/index.html](../../../preview/index.html?scene=first-success-paused)，没有用旧 draft 作为新卡片依据。下表是本轮实际检查范围，不表示 227 个入口或 108 个业务项全部一致。

| 部分 | 核对结果／仍有差异 |
| --- | --- |
| 步骤 | 首次四步顺序、编号、完成绿圈与完成按钮一致；直接接入两步经 React 断言。换号三步已实现，但失败重试连续性未全面验收 |
| 完成文案／按钮 | 接入成功且保持暂停的正文一致；完成只收提示，不发账号、接单或 runtime 写。来源文案通过真实证据选择；其他完成分支未全量截图 |
| 布局 | 卡片内部头部、步骤、正文、底部完成动作的次序一致；正式页沿用原页头，额外 Hive 控制台按钮和已接入数量占一行，卡片整体比认可稿下移约 30 px，仍待页面范围内收敛 |
| 字体／图标 | 本轮已将卡片主状态调整为认可稿的轻量 13 px，使用单星形 20 px 图标；窄屏 padding 对齐主预览。页头造成的整体偏移仍在，不声称像素级一致 |
| 详情 | 正式右侧 sheet 有信息、读取历史、来源保存／取消；不复制主步骤、接单按钮和额度。保存失败保留输入，关闭后切页再开仍保留草稿。可信细分准备进度、安装指引仍缺 |
| 错误／折叠 | 正式故障隐藏额度，同因去重保留独立错误；暂停事实独立显示。查询错误保留原原因。专项验证覆盖受控权限／Hive 双故障；更多真实错误与下一步尚未闭合 |
| 浅深色／宽窄 | 四组完成态已截图并查看，编号、按钮与文案可见，无横向溢出。故障与设置另有深色窄屏截图；不能据此宣称所有状态全通过 |
| Claude／其他页面 | 使用原组件和原数据；截图中 Claude 夹具身份、侧栏设备名及底部摘要与 HTML 模拟数据不同，不作为本轮 OpenAI 视觉改动。其他会话原有修改未纳入提交 |

截图：[正式浅色宽屏](formal-first-success-light-wide.png) · [认可浅色宽屏](approved-first-success-light-wide.png) · [正式深色窄屏](formal-first-success-dark-narrow.png) · [认可深色窄屏](approved-first-success-dark-narrow.png) · [独立故障](formal-independent-errors-dark-narrow.png) · [设置详情](formal-source-details-dark-narrow.png)。其余浅深宽窄对应图同目录保存。

## 恢复候选与历史

- 当前候选：[openai-recovery-candidate.html](../../../preview/openai-recovery-candidate.html?scene=candidate-retries)。新增查询重试耗尽、接入／换号／暂停／恢复的 60 秒查询结束、归属缺失共六个入口，**均待评审**。
- [历史索引](../../../preview/history/README.md) 包含本轮修改前认可基线与交付候选；冻结文件只追加，不改主预览，不纳入另一会话未提交 draft。
- 修改前快照打开 `20261110-114533-openai-recovery-before/index.html`；恢复候选场景只在 candidate 快照的 `openai-recovery-candidate.html` 中。冻结 README 的通用候选参数说明不表示 before 的 index 已有这些新增场景。
- 候选只演示“继续核对仍未知”，未模拟成功恢复，也没有替代 B1／B2 的协议工作。

完整逐项状态见 [108 项实施映射](scenarios.md)。任务 01～05 均未标 done，当前保留未闭环项及继续实施条件。

## 交付前一致性检查

- ✅ 对话：沿用已批准规格与唯一认可主预览；未恢复已否定方案，遵守当前 worktree、文件归属与真实写入边界。
- ✅ 纵向：本报告、108 项映射及任务状态均区分受控证据、未闭环项和真实未验收；术语与参数一致。
- ❌ 横向完整性：实现尚未覆盖完整规格，B1～B4 保持缺口；本次提交仅描述已实现增量。已实现接口的 Go／bridge／Rust／TS 调用方及 capability 已同步并验证。
- ✅ 配置：`openai_source` 为私有 preferences 的兼容可选字段，旧配置缺省可读，新值经严格校验；没有新增必填运行环境变量。测试用 Chrome 选择参数和运行位置已记录。
- ✅ 文档：生产登录契约、命令、测试范围、截图差异和候选评审状态与本次行为一致；本地链接与 108 个唯一索引已检查。

结论：**已知缺口如实记录，不能宣称完整规格完成**。B5 的真实官方账号、桌面和 Hive 联调仍未执行。
