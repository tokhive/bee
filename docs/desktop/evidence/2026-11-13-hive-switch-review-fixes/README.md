# Hive 切换最终审查修复证据

日期：2026-11-13（Asia/Shanghai）。来源分支 `codex/bee-hive-switch-review-fixes`，精确基线 `98c5ded8e6fa73c5cb23d229ebb49f7190b326d4`。范围仅为最终 Standards 的 1 个 P2、Spec 的 1 个 P1 和 2 个 P2，以及对应预览同步。批准规格为 `docs/desktop/designs/2026-11-12-hive-url-switching.md`，device-drain DTO 沿用已批准协议。

## 修复与红绿证据

| 审查项 | 最终行为 | 证据 |
| --- | --- | --- |
| begin 丢失后的取消（P1） | 仅在已持久化取消／退出意图、原 pending begin 且原 ID 查询 absent 时，先原子保存 cancel release，再发原 ID 终结标记；普通 unknown 继续只查。取消 release 响应丢失后重启只核对原请求。 | 旧断言原先要求 unknown 永不写；替换断言观察到取消仍停在 restoring_source，随后修复通过。该首次红灯仅存在工具输出，未另存日志，不补造。`cancel-restart-green.log` 证明 source/target 两腿的真实 Go 子进程、合成 HTTP 的丢 begin＋丢 release 回执＋重启，且迟到 begin 不能复活。 |
| 历史规范化冲突（P2） | 迁移保留原始记录；明确登记冲突目标才创建 profile，投影及登记均阻塞受影响目标，当前有独立归属证据的 A 保持可用；start 在日志与目标进程创建前拒绝。 | `history-red.log` → `history-green.log`；`history-coordinator-red.log` → `history-coordinator-green.log`；UI 两例 red→green。 |
| 切换日志诊断（P2） | unique JSON 与 typed JSON 同时保留安全的具体 Serde 原因；已知缺字段名／类型要求可见，未知名称与值脱敏，原文件保留。 | 缺 commit_revision 首次红灯仅保存在工具输出；最终 `rust-affected.log` 含该用例绿灯。覆盖缺字段、类型、未知字段、重复字段与秘密不回显。 |
| 已投递通知来源（P2） | 新通知保存 profile／公开 origin，正文与 OS 点击路由保留来源。点击时读取持久当前索引；跨 Hive 或读取失败不导航，来源提示只提供列表与关闭。读取失败输出具体错误。历史无来源 ledger 保留原归属未知与去重。 | `notification-red.log` → `notification-green.log`（行为红灯）；`notification-activation-red.log` 最初为缺函数的编译红灯，不算独立行为失败；最终 activation/bridge/legacy/UI 的绿灯及后述 durable A→B 测试。 |

来源契约追加核对发现浏览器 URL API 会重写 Unicode、非压缩 IPv6 和短 IPv4，错误拒绝共享 origin 契约中已合法的不同键。`notification-origin-red.log` 为可复现行为失败；改用现有 normalizeHiveOrigin 后，`node-final-green.log` 通过，并拒绝数组 page／带凭据的 origin。

## 验证结果

- Rust 初次受影响组共 **77 例通过**：hive_switch 21、profiles 17、notifications 28、notification_poll 11，见 `rust-affected.log`。包含真实 Go child＋合成 HTTP，以及真实 ProfileStore 迁移、索引提交、重开；没有将这些故障 fixture 称为真实 Hive。
- 最终诊断与轮询来源断言补齐后 `cargo +1.94 test --locked notification --lib` **40 例通过**（含前述通知两组及 protocol 1 例），见 `notification-final-green.log`。轮询 locale 门禁用例确认采样来源实际写入投递记录，后续英文轮询不改变去重记录。
- 最终 `node --test tests/bridge.test.ts tests/hiveSwitch.test.ts tests/notifications.test.ts tests/i18n.test.ts` **14/14**；`npm run typecheck` 通过，见对应日志。
- 完整 `preview-hive-switch.spec.ts` **12/12**，见 `ui-full-final-green.log`；主静态预览同步后再跑原有 main preview 用例 **1/1**，见 `main-preview-final-green.log`，覆盖正常布局、两个平台模板、Escape 和失败输入保留。
- 最终 Rust Linux cfg 编译通过，36.52 秒，日志与文件摘要见 `linux-review-final-compile.log`、`linux-review-source-manifest.json`。notifications.rs 最终 SHA-256 为 `e77bedc8e575d3c4281729b53f0b92e2a02cd4c362814e05f10c245da1d932d7`，与本轮源码一致。该门禁只声明跨平台编译。
- 源码与文档的 `git diff --check` 通过。原始捕获日志以及有效 SOURCE.patch 的空白上下文行保留原样；全量 staged diff 的空白检查会指出这些证据文件的尾空白／末尾空行，源码检查显式排除这两类原始证据，不改写记录或补丁。预先存在的 sidecar dead_code 和 Vite 大 chunk 提示仍存在。

上述不同轮次有重叠，不相加为新的总覆盖数。Rust 使用独占 `/private/tmp/bee-ticket05-target`、`CARGO_INCREMENTAL=0`、Rust 1.94；真实 Go child 使用 Go 1.27.3。Node 使用 24.22.1。构建来源检查曾拒绝来自较旧提交的复制 sidecar，之后在精确基线重建 sidecar 并完成测试，未绕过校验。

## 可运行留版与人工检查

- 正式组件交付：`desktop/tests/fixtures/bee-preview/history/20261113-001030-hive-switch-review-fixes/`。SOURCE.md 提供独立 HTTP、来源通知和历史冲突 DTO 注入命令；SOURCE.patch 保存该构建对应的生产／测试差异及摘要。此前 20261112-232850 有效基线未改写。000807 构建漏 iframe 入口，独立运行返回 404，已原样保留并明确标记未通过。
- 主静态预览：`docs/preview/index.html` 增加两个场景；最终交付为 `docs/preview/history/20261113-002455-hive-switch-review-final/`。修改前主预览逐字节等于已有 20261112-221434 快照，复用完整基线。001425 的产品场景可用但独立旧版对照仍依赖源码路径，已追加 LIMITATION；001934 把归档内链接固定到冻结依赖并验证 HTTP 200。所有旧目录保留。
- ego-browser 同一 TaskSpace 122：独立正式组件包核对旧 A 通知在 B 当前时保留原地址、不跳 B 账号页；“查看 Hive 列表”没有 hive_switch_start；Escape 关闭后焦点回切换入口；关闭提示；浅／深色冲突目标禁用、当前 A 保留、无内部 token。窄列表有滚动区域，完整文案可滚动阅读。
- 独立主预览核对两个新增场景、来源提示列表动作、关闭提示与冲突禁用。截图 `notification-source-dark.png`、`history-conflict-light.png`、`history-conflict-dark-scrolled.png` 为正式组件；`main-frozen-conflict-light.png`、`main-frozen-notification-dark.png` 为 001934 独立静态主预览。最终版只修正概览侧栏跟随当前 Hive 地址；修正后 main-preview 1/1 通过，按主任务停止额外验证要求未重复人工浏览器，SOURCE.md 明确记录该差异。

## 边界

本轮没有新增完整原生 GUI／真实 Hive／PostgreSQL／发布包验收；既有验收与原生 GUI 资产未改写。macOS 通知路由由当前 Rust 编译与定点测试覆盖，Linux cfg 已编译；没有声称用真实桌面通知中心完整执行每个点击场景，Windows 未新增目标编译门禁。旧 ledger 无来源的历史通知无法恢复其真实 Hive，因此继续兼容原去重和无来源路径，不追认归属。

ego-browser 提示 Ego Lite 有可用更新；本轮按现有版本完成验证，未执行升级。


## 一致性核对

- ✅ 会话约束：仅修复四项最终发现与必要主预览同步；不推送、不修改 PR、不触及用户主工作区或 UI 分支。
- ✅ 文档内部：区分行为红灯／编译红灯、原始／重叠测试数及静态／真实 Go／原生 GUI 范围；未保存的红灯不伪造日志。
- ✅ 跨文件：取消原 ID 终结标记与 spec／协议一致；冲突只阻塞对应项；Notice、三平台路由、native activation、bridge 与 UI 的来源字段一致；旧 ledger 使用明确兼容边界。
- ✅ 配置：无新增产品配置；Node24、Rust1.94、Go1.27.3 与命令一致；预览 mock 环境仅用于冻结包。
- ✅ 文档与代码：两个正式反馈均有主静态场景；当前交付版、保留的中间失败版、基线与冻结对照边界已标明。
- 已知验证边界：最终静态侧栏一行数据修正后没有再次人工打开新快照，主预览定点浏览器回归通过；原生 GUI、Windows 和旧无来源通知的边界见上文。
