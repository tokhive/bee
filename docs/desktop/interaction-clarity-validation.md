# Bee 桌面交互清晰化验证台账

日期：2026-11-02。当前为执行中台账，尚未完成的任务和场景不能视为通过。

## 授权与版本

用户在本次会话明确批准设计与计划全量实施，包括启动恢复、设备重新绑定和首次配对保护。保留已有修改，不改变原桌面布局及主要操作位置。

- Bee 工作树：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0`；实施基线 `5e3d773`。
- Hive 隔离工作树：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/hive-desktop-interaction`；基线 `ae6573b`，分支 `feat/desktop-interaction-clarity`。
- Hive 原工作树本次检查干净；实际 Bee gitlink 为 `6fccf3b11a2a430075e4e23634eda4913e3ced08`，与计划先前记录不同。保留当前有效基线，在隔离子模块上引入协议改动，不回退其既有修复。
- 执行前已有：Makefile、desktop/README.md、设计及决策记录修改；计划、两份审查报告、独立原型与 .DS_Store 未跟踪。各任务只提交本任务文件。

## 环境与证据边界

当前宿主 macOS arm64，Go 1.27.3，Node 24.22.1（显式使用 NVM 路径），Rust/Cargo 1.94.0（完整同版安装名为 `1.94`，通过 `RUSTUP_TOOLCHAIN=1.94` 选择）。不修改锁文件版本。Docker 27.3.1 可用；`make db` 已确认本地 PostgreSQL 健康，集成测试使用本地测试 DSN 与逐测试 schema。

分层登记：核心/协议测试、正式组件模拟 IPC、真实核心/Hive、官方客户端/账号、原生系统。截图只证明对应画面的布局，不证明业务副作用；ready 不证明请求实际返回。需要真实官方账号、目标操作系统、签名更新包或人工恢复协议的项目，没有实际证据时保留待验。

2026-11-02 用户明确回复：目前暂不具备上述专用官方账号与请求范围、目标桌面环境和签名更新包，按实际缺口记录。本地隔离核心／Hive及已有自动化验证继续执行；这些资源缺口不以模拟结果替代。

## 已确认的真实环境缺口

以下仅登记已确认资源缺口，不影响继续实现和可用环境验证；对应场景仍须分别记录已完成的核心／模拟部分。

| 缺少条件 | 受影响的真实验收 | 保留结论 |
| --- | --- | --- |
| 专用 OpenAI／Claude 官方账号及允许的受控请求范围 | L03–L06 官方登录／取消／来源核验；W01／W02／W05 接入、换号及未知结果；R03 两平台实际请求、暂停阻止派发和停止后不可接单；T10 从重新绑定到官方上游返回的全链路 | 待验；合成候选、协议回执或 ready 均不证明官方请求已通过 |
| Windows／Linux 真实桌面会话 | A04 对应平台凭据存储；N05／N06 通知权限与自启登记；X01–X04 窗口／托盘／退出与重开；C04 实际辅助技术 | 对应 OS 待验；Linux Docker／Xvfb／编译不能替代真实桌面 |
| macOS 最终 GUI 的隔离用户状态环境 | 最终 App 的菜单／托盘／通知／自启／窗口／退出重开实际操作 | 当前正式 Go 核心使用固定用户配置目录；另名 QA 包不隔离该目录，完整启动可能读取并恢复用户意图。本轮只能先做独立包完整性及无 GUI 握手专项，不能冒称最终 GUI 已验收 |
| 可用于安装和重启验收的签名更新包 | U02–U05 真实签名验证、安装、失败恢复和重启后核验 | 待验；本地 ad-hoc App 完整性专项不等于完整更新验收 |
| Hive 创建响应丢失且无 token 时的可验证人工恢复闭环 | D07 无 token 创建未知 | 现有协议不能查回原 token；须保持具体阻塞，不能把导出／管理员指引当恢复成功 |

## 任务进度

| 任务 | 状态 | 提交/证据 |
| --- | --- | --- |
| T1 | 已完成任务验证 | `f33a0e3`；Go三包、TS46、Rust179、typecheck；任务审查通过，签名包2项待验 |
| T2 | 已完成，任务审查通过 | Bee `2c48adb`、Hive `da161c5`；Hive 10顶层＋15数据库子例／0跳过，Bee DesktopSupply race通过 |
| T3 | 已完成，任务审查通过 | `fca085a`＋修复`94f580c`；Go race26/69、TS15、Rust181；修复Go62/TS18/Rust3/typecheck；2签名包测试待验 |
| T4 | 已完成，任务审查通过 | `adeba1b`＋修复`00b13dd`；Go两包、TS49/120、Rust185、typecheck；修复TS11/浏览器1，I1/I2闭合；2项签名包测试仍待验 |
| T4a | 已完成，独立有限复审通过（C/I/M=0/0/0） | `6a3e231`＋`9dd0492`；Go定向、TS37/12、Rust196及最终窄修1/7、typecheck通过；2项签名包仍待验 |
| T4b | 已完成，独立复审通过（C/I/M=0/0/1） | `83cd3e9`＋`a114c99`＋`8897183`；修复Go38、race106顶层/433含子项、Rust定向15；此前TS15/typecheck及Rust203（2ignored）覆盖边界见下文 |
| T5 | 实施与独立复审通过 | `cf573e4`＋`987ca4c`＋`9bcb051`；四项Important已闭合；C/I/M=0/0/0，阶段验证见下文，最终全场景仍待T10 |
| T6 | 实施与独立复审通过（C/I/M=0/0/0） | `6022fd7`＋`6fa2eba`；最终UI57、Node72、Rust定向11＋1及typecheck通过，Go两包定向沿用，真实全场景仍待T10 |
| T7 | 实施与独立有限复审通过（新增C/I/M=0/0/0，历史M2保留） | `267a33d`＋`5bd9c786`；任务级验证见下文，四文件最终整轮及真实全场景仍待T10 |
| T8 | 实施及独立有限复审通过（C/I/M=0/0/0） | `c3cc102`＋`49f7298`；Node38＋desktopState28沿用、修后UI64、typecheck；Rust network23，范围见下文 |
| T9 | 实施与独立有限复审通过（C/I/M=0/0/2） | `ce2b542`＋`3b0b747`；I1/I2闭合；原Node41/UI71/build/Rust230及修后Node28/UI23/notification27各自范围保留；真实原生仍待T10 |
| T10 | 自动/真实HTTP子路径已验；本轮窄修待有限复审；复合场景/原生/官方段未完整验收 | Bee当前产品 `dd554529e8803f2791f26ab99c9ee5178a9479fd`（本轮TS/i18n修改，已非`3b0b747`）、Hive验收提交 `bf05ea6`＋`d0e979b`＋修复`87e3233`／bee `ab8140a`；[本轮来源manifest](evidence/2026-10-30-interaction-clarity/t10-fix2-source-manifest.json)、[S05增量台账](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-ledger.json)；其他子路径沿用原确切来源与[前轮台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)，不重标旧证据 |

## 76 项场景索引

每行包含多个异常时，后续分开记录子用例；部分通过不能覆盖整行。以下“待验”不代表已经实现。逐项证据须记录最终版本、前置与输入、实际操作、预期/实际、证据层级、结论及缺口。

| 场景 | 任务/入口 | 预期结果 | 状态 | 最终证据及真实环境缺口 |
| --- | --- | --- | --- | --- |
| S01 | T4a/T5；首次打开、管理进程启动中 | 加载有对象；无未绑定、零账号或可接单的提前结论 | 子路径已验；整行待验 | bridge-starting 加载画面；正式 device/recovery-navigation 回归无提前写入。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S01-T4a-T5；首次打开、管理进程启动中-chromium/S01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S01-T4a-T5；首次打开、管理进程启动中-chromium/S01.json) |
| S02 | T5/T6；管理进程可通信、启动检查通过 | 进入四页并按真实缺项引导 | 子路径已验；整行待验 | 已绑定概览入口；四页导航由 recovery-navigation 回归；真实 GUI 待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S02-T5-T6；管理进程可通信、启动检查通过-chromium/S02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S02-T5-T6；管理进程可通信、启动检查通过-chromium/S02.json) |
| S03 | T4a/T9；管理进程缺失、崩溃、被占用 | 说明失败环节；可用日志和菜单恢复入口；不假造重启按钮 | 子路径已验；整行待验 | sidecar exit=17 组件画面；原生 seal/handshake/reap 两专项通过；真实菜单恢复待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S03-T4a-T9；管理进程缺失、崩溃、被占用-chromium/S03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S03-T4a-T9；管理进程缺失、崩溃、被占用-chromium/S03.json) |
| S04 | T4a/T4b；身份／网络前置检查受阻 | 四页可达、本地读取可用、Hive 写入受保护 | 子路径已验；整行待验 | startup blocked 画面；正式 native-runtime 的 device/recovery 失败仍允许本地登录且禁止账号写入。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S04-T4a-T4b；身份／网络前置检查受阻-chromium/S04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S04-T4a-T4b；身份／网络前置检查受阻-chromium/S04.json) |
| S05 | T4a/T9/T10；配置损坏、版本／协议／签名不符 | 保留文件和证据，禁止自动贡献，不当作首次使用 | 子路径已验；整行待验 | 本轮按Rust实际`VERSION_MISMATCH`／`BUNDLED_BEE_INVALID`验证两码×中英：具体协议不兼容／完整性校验失败摘要、原生操作仍受阻与应用菜单退出/重开或可信安装包指引，同一提示保留协议2/1及actual/required SHA原文，零业务写且原生读取仍被门禁阻止。正式NativeApp＋模拟IPC，不证明真实文件保留、包校验、退出重开或签名安装。 [S05-protocol-mismatch画面](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-green-output/t10-layout-fix-S05-protocol-mismatch-chromium/S05-protocol-mismatch.png)／[DTO及调用](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-green-output/t10-layout-fix-S05-protocol-mismatch-chromium/S05-protocol-mismatch.json)；[S05-protocol-mismatch-en画面](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-green-output/t10-layout-fix-S05-protocol-mismatch-en-chromium/S05-protocol-mismatch-en.png)／[DTO及调用](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-green-output/t10-layout-fix-S05-protocol-mismatch-en-chromium/S05-protocol-mismatch-en.json)；[S05-integrity-blocked画面](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-green-output/t10-layout-fix-S05-integrity-blocked-chromium/S05-integrity-blocked.png)／[DTO及调用](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-green-output/t10-layout-fix-S05-integrity-blocked-chromium/S05-integrity-blocked.json)；[S05-integrity-blocked-en画面](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-green-output/t10-layout-fix-S05-integrity-blocked-en-chromium/S05-integrity-blocked-en.png)／[DTO及调用](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-green-output/t10-layout-fix-S05-integrity-blocked-en-chromium/S05-integrity-blocked-en.json)；[增量台账及旧证据边界](evidence/2026-10-30-interaction-clarity/t10-fix2-s05-ledger.json)。配置损坏仍沿用前轮独立证据，不因本轮两码通过宣称整行完成。 |
| S06 | T5/T10；旧启动事件迟到、新实例接管 UI | 清除旧可操作依据、保留语言导航，不接受旧成功 | 子路径已验；整行待验 | 当前图为 startup blocked 关联表面；supply 的新实例回归证明旧响应隔离并保留导航/语言。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S06-T5-T10；旧启动事件迟到、新实例接管-UI-chromium/S06.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-S06-T5-T10；旧启动事件迟到、新实例接管-UI-chromium/S06.json) |
| D01 | T6；真正未绑定，输入 Hive／名称 | 就地校验；有效输入才生成配对，保留草稿 | 子路径已验；整行待验 | 未绑定表单；device 回归有效输入、草稿和就地校验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D01-T6；真正未绑定，输入-Hive／名称-chromium/D01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D01-T6；真正未绑定，输入-Hive／名称-chromium/D01.json) |
| D02 | T4b/T6；正在创建配对、重复点击 | 单个动作；明确进度，重复点击不新增远端请求 | 子路径已验；整行待验 | 首次 creating 阶段画面；device-recovery 回归单次确认与阶段；真实 POST 数由 broker 断言。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D02-T4b-T6；正在创建配对、重复点击-chromium/D02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D02-T4b-T6；正在创建配对、重复点击-chromium/D02.json) |
| D03 | T6；pending、打开网页／复制 | 主按钮明显；打开／复制失败保留原配对和手动路径 | 子路径已验；整行待验 | pending 画面；device 回归打开/复制失败仍保留请求；Ego 真实 Hive 网页取消/确认另有回执。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D03-T6；pending、打开网页／复制-chromium/D03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D03-T6；pending、打开网页／复制-chromium/D03.json) |
| D04 | T4b/T6；draining，等待替换旧设备 | 单独解释 Hive 正在等待的条件；不承诺任务完成时间，不自动强制替换 | 子路径已验；整行待验 | 首次 draining 画面；device-recovery 回归独立文案与禁止重建。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D04-T4b-T6；draining，等待替换旧设备-chromium/D04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D04-T4b-T6；draining，等待替换旧设备-chromium/D04.json) |
| D05 | T4b/T6；本地有效期结束、Hive 确认过期 | 到期只读核对；确认终态且无未知写入才允许重新生成 | 子路径已验；整行待验 | Hive expired 画面；device 回归本机到期只读、可信终态才解锁。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D05-T4b-T6；本地有效期结束、Hive-确认过期-chromium/D05.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D05-T4b-T6；本地有效期结束、Hive-确认过期-chromium/D05.json) |
| D06 | T4b/T6；网页批准、兑换、身份回读成功 | 验证身份并保存，贡献保持停止，进入账号步骤 | 子路径已验；整行待验 | 首次pending经模拟网页批准并只读核对后bound、stopped、两平台not_selected、开始禁用且零写；历史真实网页v2的POST/DB增量与最终核心stopped证据仍按其原来源保留。 [D06-bound-stopped-no-selection画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-D06-initial-pairing-completed-stopped-chromium/D06-bound-stopped-no-selection.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-D06-initial-pairing-completed-stopped-chromium/D06-bound-stopped-no-selection.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| D07 | T4b/T10；创建／兑换响应丢失、写盘失败、重启 | 续查同一操作；无明确未提交证明不重建／重兑 | 子路径已验；整行待验 | 本图只 creation_unknown；device-recovery 另验兑换未知/保存阶段，真实 broker 验提交丢失、重启2次、chmod保存失败；无token查回及人工恢复闭环待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D07-T4b-T10；创建／兑换响应丢失、写盘失败、重启-chromium/D07.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D07-T4b-T10；创建／兑换响应丢失、写盘失败、重启-chromium/D07.json) |
| D08 | T4/T6；绑定有效但临时核对失败／身份不一致 | 保留上次信息，明确未知／拒绝，不出现首次绑定表单 | 子路径已验；整行待验 | 临时503保留当前设备画面；device 回归身份失败不回退未绑定；真实503 DTO含本次时间与origin/path。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D08-T4-T6；绑定有效但临时核对失败／身份不一致-chromium/D08.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D08-T4-T6；绑定有效但临时核对失败／身份不一致-chromium/D08.json) |
| D09 | T4b/T10；撤销后重绑，同／不同所有者 | 本机确认＋网页确认；新归属再确认，旧选择与运行意图隔离 | 子路径已验；整行待验 | owner 新归属画面；device-recovery 验显式 adopt；真实 broker 同owner/不同owner/未知/保存失败均保持停止。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D09-T4b-T10；撤销后重绑，同／不同所有者-chromium/D09.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-D09-T4b-T10；撤销后重绑，同／不同所有者-chromium/D09.json) |
| A01 | T5/T7；两平台初次读取／一平台迟缓 | 分平台加载；已确认设备、运行和另一平台仍可见 | 子路径已验；整行待验 | OpenAI 挂起/Claude独立的正在读取画面；account-auto-read 验平台互不阻塞。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A01-T5-T7；两平台初次读取／一平台迟缓-chromium/A01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A01-T5-T7；两平台初次读取／一平台迟缓-chromium/A01.json) |
| A02 | T7；真正未找到官方登录 | 明确哪个客户端、下一步登录；不假称已接入 | 子路径已验；整行待验 | source_missing 空来源画面；native-accounts 验候选存在与未接入区别。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A02-T7；真正未找到官方登录-chromium/A02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A02-T7；真正未找到官方登录-chromium/A02.json) |
| A03 | T4/T7；所选文件缺失、权限拒绝、解析失败 | 区分具体失败，定位读取位置；修复后自动读取 | 子路径已验；整行待验 | permission_denied 画面；正式 source replacement/denied 回归；device-recovery combined另验实际not_found DTO。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A03-T4-T7；所选文件缺失、权限拒绝、解析失败-chromium/A03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A03-T4-T7；所选文件缺失、权限拒绝、解析失败-chromium/A03.json) |
| A04 | T7/T10；文件／Keychain／Keyring／auto 不支持或有冲突 | 显示实际支持限制及可选读取方式，不自动改来源 | 子路径已验；整行待验 | 实际unsupported store reason=keyring_not_supported_on_this_os，keyring选项disabled、可读说明、当前file保留且零写；真实目标OS读取仍待验。 [A04-keyring-unsupported画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-A04-unsupported-store-real-reason-chromium/A04-keyring-unsupported.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-A04-unsupported-store-real-reason-chromium/A04-keyring-unsupported.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| A05 | T7；候选有效、尚未接入 | 显示平台及可核对身份，提供明确接入确认 | 子路径已验；整行待验 | 候选未接入画面；native-accounts 接入目标/暂停说明与单次动作。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A05-T7；候选有效、尚未接入-chromium/A05.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A05-T7；候选有效、尚未接入-chromium/A05.json) |
| A06 | T5/T7；候选过期／离提交期限过近 | 说明待重新读取，刷新候选后重新确认，不留下无原因禁用 | 子路径已验；整行待验 | 过期候选画面；native-accounts/auto-read 验临近期限和回读屏障；新鲜候选重新确认。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A06-T5-T7；候选过期／离提交期限过近-chromium/A06.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A06-T5-T7；候选过期／离提交期限过近-chromium/A06.json) |
| A07 | T5/T7；来源修改、候选变化、旧读取迟到 | 保留草稿；旧回调不覆盖新来源，不自动换号 | 子路径已验；整行待验 | 候选变化画面；native-runtime/auto-read 验来源草稿和旧候选迟到不覆盖。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A07-T5-T7；来源修改、候选变化、旧读取迟到-chromium/A07.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-A07-T5-T7；来源修改、候选变化、旧读取迟到-chromium/A07.json) |
| A08 | T3/T7；官方查询失败、retry_at／授权维护失败 | 本地候选与远端查询分开；实际调度才显示等待，不反复弹系统权限 | 子路径已验；整行待验 | official capability=rate_limited、HTTP429、retry_after_seconds=25及真实retry_at字段；展开失败环节与原始原因、本地候选保留且零授权/接入/开始。仅模拟官方查询结果，不是实际官方请求。 [A08-official-query-failed画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-A08-official-query-failure-with-retry-at-chromium/A08-official-query-failed.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-A08-official-query-failure-with-retry-at-chromium/A08-official-query-failed.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| L01 | T4/T7；官方客户端缺失／不支持版本 | 明确缺项及支持版本指引，不显示空泛登录失败 | 子路径已验；整行待验 | 补充最终正式组件860×600图分别呈现 client_missing 与 client_version_unsupported，错误正文、影响、处理指引、滚动顶端/错误区均留证；零account_action/runtime_start。真实官方CLI环境仍待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-L01-T4-T7；官方客户端缺失／不支持版本-chromium/L01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-L01-T4-T7；官方客户端缺失／不支持版本-chromium/L01.json)；补充 [L01-client-missing](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L01-client-missing-chromium/L01-client-missing.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L01-client-missing-chromium/L01-client-missing.json)；[L01-version](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L01-version-chromium/L01-version.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L01-version-chromium/L01-version.json) |
| L02 | T5/T7；运行中请求登录 | 明确需停止贡献，直接定位停止入口 | 子路径已验；整行待验 | 真实运行中组件重新登录disabled、明确先停止说明；查看贡献运行跳转实际runtime目标获焦且停止按钮可用，零自动停止/登录/接入。真实官方进程仍待验。 [L02-running-login-disabled画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-L02-running-login-stop-entry-chromium/L02-running-login-disabled.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-L02-running-login-stop-entry-chromium/L02-running-login-disabled.json)；[L02-stop-entry画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-L02-running-login-stop-entry-chromium/L02-stop-entry.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-L02-running-login-stop-entry-chromium/L02-stop-entry.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| L03 | T7/T10；启动官方登录，等待用户／回到 Bee | 说明在何处完成，等待与超时可区分，完成后核对所选来源 | 子路径已验；整行待验 | 官方登录确认组件；native-runtime 模拟完成只成候选；专用官方登录及真实来源落点待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-L03-T7-T10；启动官方登录，等待用户／回到-Bee-chromium/L03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-L03-T7-T10；启动官方登录，等待用户／回到-Bee-chromium/L03.json) |
| L04 | T7/T10；用户取消、超时、进程启动失败 | 只结束本次创建的进程；取消失败／未知不说已取消 | 子路径已验；整行待验 | 补充最终正式组件分别呈现 authorization_timeout、authorization_process_failed 与取消响应未知，原操作仅核对、不接入/启动；Go受控进程回收通过。真实官方取消及来源落点仍待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-L04-T7-T10；用户取消、超时、进程启动失败-chromium/L04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-L04-T7-T10；用户取消、超时、进程启动失败-chromium/L04.json)；补充 [L04-timeout](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L04-timeout-chromium/L04-timeout.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L04-timeout-chromium/L04-timeout.json)；[L04-process-failed](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L04-process-failed-chromium/L04-process-failed.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L04-process-failed-chromium/L04-process-failed.json)；[L04-cancel-unknown](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L04-cancel-unknown-chromium/L04-cancel-unknown.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-L04-cancel-unknown-chromium/L04-cancel-unknown.json) |
| L05 | T7/T10；官方退出成功但来源未变化／身份不符 | 不能仅按退出码报登录成功；保留候选及具体原因 | 子路径已验；整行待验 | 实际authorize操作failed分别为来源未变/namespace不符，显示具体失败、一次authorize_start、零接入/开始；真实官方客户端及文件落点仍待验。 [L05-authorization_source_unchanged画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-L05-authorization-source-unchanged-chromium/L05-authorization_source_unchanged.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-L05-authorization-source-unchanged-chromium/L05-authorization_source_unchanged.json)；[L05-authorization_namespace_mismatch画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-L05-authorization-namespace-mismatch-chromium/L05-authorization_namespace_mismatch.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-L05-authorization-namespace-mismatch-chromium/L05-authorization_namespace_mismatch.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| L06 | T5/T7/T10；取消与成功竞态、页面离开／重启 | 迟到成功不自动接入；关闭面板不是取消登录 | 子路径已验；整行待验 | 当前图为未接入候选；模拟取消成功竞态/导航回归，不证明真实登录重启。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-L06-T5-T7-T10；取消与成功竞态、页面离开／重启-chromium/L06.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-L06-T5-T7-T10；取消与成功竞态、页面离开／重启-chromium/L06.json) |
| W01 | T7；确认接入 | 说明账号及平台暂停影响；接入后仍停止／暂停 | 子路径已验；整行待验 | 确认接入目标与影响画面；组件确认后paused、runtime_start=0；真实账号接入待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-W01-T7；确认接入-chromium/W01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-W01-T7；确认接入-chromium/W01.json) |
| W02 | T7；确认换号 | 当前／目标身份可核对，完成后暂停，不继承旧额度 | 子路径已验；整行待验 | 当前/目标身份确认画面；组件换号后暂停且旧额度清空；真实账号换号待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-W02-T7；确认换号-chromium/W02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-W02-T7；确认换号-chromium/W02.json) |
| W03 | T7；取消尚未注册的本地选择 | 明确取消对象和边界；已注册账号不伪造完整移除功能 | 子路径已验；整行待验 | 取消本地选择确认画面；native-runtime严格 select/clear_selection 两次明确动作，无runtime_start。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-W03-T7；取消尚未注册的本地选择-chromium/W03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-W03-T7；取消尚未注册的本地选择-chromium/W03.json) |
| W04 | T5/T7；弹窗期间候选／revision／运行条件变化 | 提交前重新验证；过时确认失效并解释，不静默无反应 | 子路径已验；整行待验 | 打开换号确认后真实增加revision，旧确认disabled并显示条件变化，account_action=0、runtime_start=0；关闭重开后新revision确认沿用既有native-runtime回归来源。 [W04-stale-confirmation画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-W04-stale-confirmation-disabled-zero-write-chromium/W04-stale-confirmation.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-W04-stale-confirmation-disabled-zero-write-chromium/W04-stale-confirmation.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| W05 | T7/T10；暂停／换号提交未知、远端成功本地保存失败 | 保存原操作，查询指纹＋代次，不重复写入／恢复接单 | 子路径已验；整行待验 | 接入提交回执未知，原operation.id及reconciling跨诊断/账号页保留；仅核对原操作，account_action始终1、runtime_start=0。不同于旧supply PUT503关联图；真实官方接入回执丢失仍待验。 [W05-original-operation-unconfirmed画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-W05-account-5f622-wn-keeps-original-operation-chromium/W05-original-operation-unconfirmed.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-W05-account-5f622-wn-keeps-original-operation-chromium/W05-original-operation-unconfirmed.json)；[W05-original-operation-diagnostics画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-W05-account-5f622-wn-keeps-original-operation-chromium/W05-original-operation-diagnostics.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-W05-account-5f622-wn-keeps-original-operation-chromium/W05-original-operation-diagnostics.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| W06 | T5/T7；关闭弹窗／离页／重启、另一平台操作 | 原操作可继续核对，另一平台事实不丢失，不创建替代操作 | 子路径已验；整行待验 | 当前详情关联图；auto-read/runtime/polling回归离页不重放，另一平台事实保留；账号进程重启实际段待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-W06-T5-T7；关闭弹窗／离页／重启、另一平台操作-chromium/W06.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-W06-T5-T7；关闭弹窗／离页／重启、另一平台操作-chromium/W06.json) |
| R01 | T5/T6；没有账号／账号未确认时开始贡献 | 具体禁用原因与账号入口；不将未知显示零账号 | 子路径已验；整行待验 | 无已选账号：开始禁用、具体接入说明与账号入口；独立账号读取未完成：设备bound/运行stopped可信、两平台account_snapshot未完成，数量待确认不显示零，账号页来源读取中且导航零写。runtime提供可信not_selected，不把后续账号读取未完成等同运行未知；共享runtime读取失败另作附加路径。 [R01-account-reads-pending画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-R01-account-7a397-ding-shared-state-confirmed-chromium/R01-account-reads-pending.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-R01-account-7a397-ding-shared-state-confirmed-chromium/R01-account-reads-pending.json)；[R01-account-reads-pending-accounts画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-R01-account-7a397-ding-shared-state-confirmed-chromium/R01-account-reads-pending-accounts.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-R01-account-7a397-ding-shared-state-confirmed-chromium/R01-account-reads-pending-accounts.json)；[R01-no-selection画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-R01-no-selection-chromium/R01-no-selection.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-R01-no-selection-chromium/R01-no-selection.json)；[R01-accounts-unconfirmed画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-R01-accounts-unconfirmed-chromium/R01-accounts-unconfirmed.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-R01-accounts-unconfirmed-chromium/R01-accounts-unconfirmed.json)；[R01画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-R01-T5-T6；没有账号／账号未确认时开始贡献-chromium/R01.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-R01-T5-T6；没有账号／账号未确认时开始贡献-chromium/R01.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| R02 | T3/T6；开始贡献、首次连接、重复点击 | 一次启动，连接中不等于可接单；开始不解除暂停 | 子路径已验；整行待验 | 首次连接组件画面；native-runtime一次runtime_start且resume_platforms为空；最终可执行核心用真实Hive WS连接，自动恢复不解除手动暂停。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R02-T3-T6；开始贡献、首次连接、重复点击-chromium/R02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R02-T3-T6；开始贡献、首次连接、重复点击-chromium/R02.json) |
| R03 | T5/T6/T7/T10；运行连接正常、平台部分可用 | 主状态基于平台；两平台分别有受控请求实际返回，暂停阻止新派发、停止后不可继续接单 | 子路径已验；整行待验 | 贡献运行/部分平台组件画面；专用OpenAI/Claude上游请求、暂停阻止真实派发及真实停止后准入待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R03-T5-T6-T7-T10；运行连接正常、平台部分可用-chromium/R03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R03-T5-T6-T7-T10；运行连接正常、平台部分可用-chromium/R03.json) |
| R04 | T3/T4/T6；DNS/TLS/拒绝/超时/5xx、心跳或同步失败 | 本次具体原因、真实退避、恢复后剩余阻塞 | 子路径已验；整行待验 | 当前布局为心跳断连及实际scheduled时间；最终可执行/race真实401/403/409/503/EOF、真实connection_refused与同run恢复连接均通过，暂停保留、resume PUT=0、停止回执完整。DNS/TLS/timeout/心跳/同步分类及旧run迟到另有最终Go受控回归；这些仍不作为所有故障的最终可执行复现。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R04-T3-T4-T6；DNS-TLS-拒绝-超时-5xx、心跳或同步失败-chromium/R04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R04-T3-T4-T6；DNS-TLS-拒绝-超时-5xx、心跳或同步失败-chromium/R04.json) |
| R05 | T3/T4b/T6；401/403、409占用、持续冲突 | 区分授权与所有权；停止不适用的重试，不自动抢占 | 子路径已验；整行待验 | 当前布局为409占用；最终可执行/race真实401/403进入rejected/halted、409进入occupied/halted且仅一次agent请求，附本次时间/path/HTTP证据；持续冲突阈值与旧run迟到用Go受控回归，未声称最终可执行重复冲突全矩阵。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R05-T3-T4b-T6；401-403、409占用、持续冲突-chromium/R05.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R05-T3-T4b-T6；401-403、409占用、持续冲突-chromium/R05.json) |
| R06 | T6/T9；停止、取消停止确认、停止部分成功 | workers/intent/session 逐项证据；保存失败不声称下次保持停止 | 子路径已验；整行待验 | 停止确认画面；native-runtime停止回执与取消焦点回归；最终可执行重连后真实stop_receipt三项true；真实原生退出/保存失败待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R06-T6-T9；停止、取消停止确认、停止部分成功-chromium/R06.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R06-T6-T9；停止、取消停止确认、停止部分成功-chromium/R06.json) |
| R07 | T3/T5/T10；启停结果未知、旧 run 迟到 | 只读核对原操作；失效回执不能解锁新操作 | 子路径已验；整行待验 | 实际一次模拟开始后未知画面；auto-read/polling 保持只读核对且旧run不解锁；真实runtime结果丢失待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R07-T3-T5-T10；启停结果未知、旧-run-迟到-chromium/R07.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-R07-T3-T5-T10；启停结果未知、旧-run-迟到-chromium/R07.json) |
| P01 | T5/T7；无报告、过期、读取失败／正在读取 | 显示新鲜度及真实调度，不能继续可接单 | 子路径已验；整行待验 | 过期后核对画面；supply严格30秒失效、禁写和失败重试回归。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-P01-T5-T7；无报告、过期、读取失败／正在读取-chromium/P01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-P01-T5-T7；无报告、过期、读取失败／正在读取-chromium/P01.json) |
| P02 | T7；手动暂停／恢复；全部暂停仍有别的阻塞 | 恢复仅解除暂停，不承诺立即接单，展示独立问题 | 子路径已验；整行待验 | 手动暂停画面；supply/native-accounts恢复只解除平台暂停、不开始贡献且保留其他阻塞。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-P02-T7；手动暂停／恢复；全部暂停仍有别的阻塞-chromium/P02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-P02-T7；手动暂停／恢复；全部暂停仍有别的阻塞-chromium/P02.json) |
| P03 | T5/T7；一平台失败、另一平台正常／慢请求 | 失败和加载局部化，正常平台保持可见 | 子路径已验；整行待验 | 单平台失败另一平台正常画面；独立10秒调度、同平台不重叠与慢请求回归通过。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-P03-T5-T7；一平台失败、另一平台正常／慢请求-chromium/P03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-P03-T5-T7；一平台失败、另一平台正常／慢请求-chromium/P03.json) |
| P04 | T1/T2/T7；not_configured及五个新细分原因 | 区分本机未接入、Hive未注册、市场未开放、供给未启用、设备受限、账号未准入 | 子路径已验；整行待验 | 分别断言五详细原因account_not_registered/market_not_open/supply_not_enabled/supply_device_restricted/account_not_admitted，每个原因滚动至可见后独立截图；零写，不据合成已确认供给事实证明真实上游。 [P04-detailed-reasons画面](evidence/2026-10-30-interaction-clarity/t10-fix-reasons-visible-final-output/t10-layout-fix-P04-detailed-reasons-chromium/P04-detailed-reasons.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-reasons-visible-final-output/t10-layout-fix-P04-detailed-reasons-chromium/P04-detailed-reasons.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| P05 | T1/T2/T7；banned、device_draining、offline、model_unavailable、authorization_unavailable、capabilities_unknown、plan_not_configured | 按原准入事实逐码解释；管理员问题不让用户循环登录 | 子路径已验；整行待验 | 分别断言banned/device_draining/offline/model_unavailable/authorization_unavailable/capabilities_unknown/plan_not_configured，每个原因独立视口截图；零写，真实Hive/数据库语义沿用原定向证据。 [P05-existing-reasons画面](evidence/2026-10-30-interaction-clarity/t10-fix-reasons-visible-final-output/t10-layout-fix-P05-existing-reasons-chromium/P05-existing-reasons.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-reasons-visible-final-output/t10-layout-fix-P05-existing-reasons-chromium/P05-existing-reasons.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| P06 | T3/T7；rate_limited、quota_unknown、quota_exhausted、concurrency_full | 可证明的恢复条件和时间；无根据不倒计时 | 子路径已验；整行待验 | 分别断言rate_limited/quota_unknown/quota_exhausted/concurrency_full原因与处理说明，每个原因独立视口截图；零写，真实额度及请求仍待验。 [P06-limit-reasons画面](evidence/2026-10-30-interaction-clarity/t10-fix-reasons-visible-final-output/t10-layout-fix-P06-limit-reasons-chromium/P06-limit-reasons.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-reasons-visible-final-output/t10-layout-fix-P06-limit-reasons-chromium/P06-limit-reasons.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| P07 | T4/T7；Codex／Claude 的 source_unavailable、confirmation_required、authorization_rejected | 两平台分别定位来源／换号确认／登录；不混为市场未开放 | 子路径已验；整行待验 | OpenAI与Claude分别断言source_unavailable/confirmation_required/authorization_rejected六个真实reason码对应文案与处理入口，每个原因独立视口截图且零写；真实来源和官方授权仍待验。 [P07-source-authorization-reasons画面](evidence/2026-10-30-interaction-clarity/t10-fix-reasons-visible-final-output/t10-layout-fix-P07-source-authorization-reasons-chromium/P07-source-authorization-reasons.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-reasons-visible-final-output/t10-layout-fix-P07-source-authorization-reasons-chromium/P07-source-authorization-reasons.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| P08 | T1/T2/T7/T10；多额度窗口、未知、过期、超过100%；旧Hive兼容 | 保留原值与时间；旧原因不猜测，矛盾响应失败关闭 | 子路径已验；整行待验 | 多窗口与原值画面；正式120%/unknown/expired和真实旧Hive处理器组合通过。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-P08-T1-T2-T7-T10；多额度窗口、未知、过期、超过100-；旧Hive兼容-chromium/P08.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-P08-T1-T2-T7-T10；多额度窗口、未知、过期、超过100-；旧Hive兼容-chromium/P08.json) |
| N01 | T4/T8/T9；语言主题读取／保存成功或失败 | UI按已确认偏好更新；错误可重读，切语言更新已有提示 | 子路径已验；整行待验 | 语言外观设置画面；native-experience/native-updater locale回执与失败回归，真实菜单/系统语言待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N01-T4-T8-T9；语言主题读取／保存成功或失败-chromium/N01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N01-T4-T8-T9；语言主题读取／保存成功或失败-chromium/N01.json) |
| N02 | T8；代理草稿、无效输入、测试成功／失败 | 就地校验，保留输入；测试不保存、不代表 Hive 可达 | 子路径已验；整行待验 | 代理页面画面；native-runtime无效loopback输入不network_test，测试不保存/应用。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N02-T8；代理草稿、无效输入、测试成功／失败-chromium/N02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N02-T8；代理草稿、无效输入、测试成功／失败-chromium/N02.json) |
| N03 | T8；代理保存但未应用，重启应用 | 区分保存／生效；停止、配置、恢复各阶段独立反馈 | 子路径已验；整行待验 | 补充正式组件保存未生效画面，真实已保存/当前生效字段和应用入口分别留证；未确认时network_apply_saved=0。真实原生代理重启应用仍待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N03-T8；代理保存但未应用，重启应用-chromium/N03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N03-T8；代理保存但未应用，重启应用-chromium/N03.json)；补充 [N03-N04-saved-not-effective](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-N03-N04-saved-not-effective-chromium/N03-N04-saved-not-effective.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-N03-N04-saved-not-effective-chromium/N03-N04-saved-not-effective.json) |
| N04 | T8/T10；应用部分失败／响应未知、导航／重启 | 先读当前revision及运行状态，不能重复“停止并重启” | 子路径已验；整行待验 | 补充正式组件分别呈现恢复失败、应用响应未知、保存后读取失败；一次network_apply_saved、零额外runtime_start/stop，未知只读保锁；真实原生重启应用仍待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N04-T8-T10；应用部分失败／响应未知、导航／重启-chromium/N04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N04-T8-T10；应用部分失败／响应未知、导航／重启-chromium/N04.json)；补充 [N03-N04-restore-failed](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-N03-N04-restore-failed-chromium/N03-N04-restore-failed-entry.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-N03-N04-restore-failed-chromium/N03-N04-restore-failed.json)；[N03-N04-apply-unknown](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-N03-N04-apply-unknown-chromium/N03-N04-apply-unknown-entry.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-N03-N04-apply-unknown-chromium/N03-N04-apply-unknown.json)；[N03-N04-saved-read-failed](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-N03-N04-saved-read-failed-chromium/N03-N04-saved-read-failed.png)／[JSON](evidence/2026-10-30-interaction-clarity/t10-layout-supplement-final-v6-output/t10-layout-supplement-N03-N04-saved-read-failed-chromium/N03-N04-saved-read-failed.json) |
| N05 | T8/T9；通知拒绝／未询问／未知、发送失败 | 偏好≠系统授权≠投递成功；有真实设置路径及显式重试 | 子路径已验；整行待验 | 通知拒绝设置画面；native-experience模拟权限/投递未知；真实OS授权和系统设置入口待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N05-T8-T9；通知拒绝／未询问／未知、发送失败-chromium/N05.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N05-T8-T9；通知拒绝／未询问／未知、发送失败-chromium/N05.json) |
| N06 | T8/T9；自启期望与实际登记不同／查询失败 | 分别显示，不假成功；重新核对而非自动改用户选择 | 子路径已验；整行待验 | 自启实际查询失败画面；native-experience模拟期望/实际分离；真实OS登记待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N06-T8-T9；自启期望与实际登记不同／查询失败-chromium/N06.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-N06-T8-T9；自启期望与实际登记不同／查询失败-chromium/N06.json) |
| G01 | T8；未运行、显式开始、部分检查／全部通过 | 导航不启动诊断；完成≠全通过≠可接单 | 子路径已验；整行待验 | 显式诊断结果画面；native-experience/diagnostic回归导航不启动、完成不等于全过。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G01-T8；未运行、显式开始、部分检查／全部通过-chromium/G01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G01-T8；未运行、显式开始、部分检查／全部通过-chromium/G01.json) |
| G02 | T8；诊断进行中读失败／临时中断 | 原报告可重读，说明查询停滞；不永久“进行中” | 子路径已验；整行待验 | 原报告读取暂停画面；重新读取原report回归，未重建报告。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G02-T8；诊断进行中读失败／临时中断-chromium/G02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G02-T8；诊断进行中读失败／临时中断-chromium/G02.json) |
| G03 | T8/T10；取消／取消未知、报告超时／跳过 | 保留已返回事实；按实际回执确认取消，不重建报告 | 子路径已验；整行待验 | 正在诊断画面；native-experience取消未知等回归；本图非所有cancel/skip画面。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G03-T8-T10；取消／取消未知、报告超时／跳过-chromium/G03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G03-T8-T10；取消／取消未知、报告超时／跳过-chromium/G03.json) |
| G04 | T4a/T5/T8；离开再返回、换绑定／网络／run | 同一报告可继续；旧上下文不污染概览 | 子路径已验；整行待验 | 结果画面；recovery-navigation诊断来源跳转与返回焦点、上下文失效回归。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G04-T4a-T5-T8；离开再返回、换绑定／网络／run-chromium/G04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G04-T4a-T5-T8；离开再返回、换绑定／网络／run-chromium/G04.json) |
| G05 | T8；日志未读／空／过滤／加载更多／轮转 | 明确各状态，旧过滤响应丢弃，不主动读取全部日志 | 子路径已验；整行待验 | 安全日志未读取/空/读取中/筛选与轮转、手动刷新及分页cursor均有实际画面与调用，未读前diagnostic_logs=0；仅手动读取、零业务写、零诊断启动。 [G05-logs-filtered-more画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-filtered-rotation-chromium/G05-logs-filtered-more.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-filtered-rotation-chromium/G05-logs-filtered-more.json)；[G05-logs-filtered-rotation画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-filtered-rotation-chromium/G05-logs-filtered-rotation.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-filtered-rotation-chromium/G05-logs-filtered-rotation.json)；[G05-logs-unread画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-unread-chromium/G05-logs-unread.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-unread-chromium/G05-logs-unread.json)；[G05-logs-empty画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-empty-chromium/G05-logs-empty.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-empty-chromium/G05-logs-empty.json)；[G05-logs-loading画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-loading-chromium/G05-logs-loading.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-G05-logs-loading-chromium/G05-logs-loading.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| G06 | T8/T10；导出范围、取消、失败／完成／下载未知 | 真实下载回执；未知给核对位置，不重复导出 | 子路径已验；整行待验 | 实际30秒无下载回执后unknown画面；previewDownloads记录曾明确导出且不重复，组件成功/取消/失败另有回归；OS下载投递待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G06-T8-T10；导出范围、取消、失败／完成／下载未知-chromium/G06.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-G06-T8-T10；导出范围、取消、失败／完成／下载未知-chromium/G06.json) |
| U01 | T9；idle/checking/current/available、后台失败 | 只读检查不影响贡献；可显式重试，有当前版本 | 子路径已验；整行待验 | 当前关于页入口；native-updater检查状态、失败/重试和贡献不受影响回归。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-U01-T9；idle-checking-current-available、后台失败-chromium/U01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-U01-T9；idle-checking-current-available、后台失败-chromium/U01.json) |
| U02 | T9；下载中、总大小未知、网络／磁盘／签名失败 | 不假100%，验证通过才安装，原版本可用 | 子路径已验；整行待验 | 下载中总大小未知画面；组件签名失败与字节回归；真实签名安装包缺失。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-U02-T9；下载中、总大小未知、网络／磁盘／签名失败-chromium/U02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-U02-T9；下载中、总大小未知、网络／磁盘／签名失败-chromium/U02.json) |
| U03 | T9；verified，打开／取消／过时安装确认 | 默认取消焦点，确认绑定精确版本／revision | 子路径已验；整行待验 | verified待安装画面；native-updater取消默认焦点、过时revision零安装；真实包待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-U03-T9；verified，打开／取消／过时安装确认-chromium/U03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-U03-T9；verified，打开／取消／过时安装确认-chromium/U03.json) |
| U04 | T9/T10；stopping/installing、回执丢失、停止不完整 | 不重复安装，不说已成功；查原操作／可信包恢复 | 子路径已验；整行待验 | installing尚无成功结论画面；native-updater回执丢失保锁/不重复安装；真实停止和安装待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-U04-T9-T10；stopping-installing、回执丢失、停止不完整-chromium/U04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-U04-T9-T10；stopping-installing、回执丢失、停止不完整-chromium/U04.json) |
| U05 | T4a/T9/T10；重启核验成功／失败、数据迁移失败 | 核对包、设备、选择和运行意图；不绕过完整性或丢暂停 | 子路径已验；整行待验 | 复用现有更新recovery DTO：可信旧版本未安装目标与恢复证据不足继续保护两分支；显示可重试检查/只读回读入口，零自动检查/下载/安装。不是实际签名安装或重启验收。 [U05-trusted-previous画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-U05-recovery-trusted-previous-chromium/U05-trusted-previous.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-U05-recovery-trusted-previous-chromium/U05-trusted-previous.json)；[U05-unproven-protected画面](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-U05-recovery-unproven-protected-chromium/U05-unproven-protected.png)／[DTO与实际调用](evidence/2026-10-30-interaction-clarity/t10-fix-ui-frozen-output/t10-layout-fix-U05-recovery-unproven-protected-chromium/U05-unproven-protected.json)；旧图边界及逐原因图见[修复台账](evidence/2026-10-30-interaction-clarity/t10-fix-scenario-ledger.json)。 |
| X01 | T9/T10；关窗、菜单／托盘重开、第二次启动 | 保持当前运行，回到同一窗口，不启动第二套贡献 | 子路径已验；整行待验 | 仅关联运行页面图；Rust生命周期逻辑通过，三端真实关窗/菜单/托盘/二次启动待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-X01-T9-T10；关窗、菜单／托盘重开、第二次启动-chromium/X01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-X01-T9-T10；关窗、菜单／托盘重开、第二次启动-chromium/X01.json) |
| X02 | T9/T10；退出、停止超时／强制回收 | 区分停止贡献与退出意图，只处理本App进程 | 子路径已验；整行待验 | 仅关联停止确认图；Rust owned退出逻辑通过，真实OS退出/超时/强制回收待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-X02-T9-T10；退出、停止超时／强制回收-chromium/X02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-X02-T9-T10；退出、停止超时／强制回收-chromium/X02.json) |
| X03 | T9/T10；正常重开、异常退出／断电后重开 | 正常按既有意图核验；不洁会话保持停止 | 子路径已验；整行待验 | 仅关联停止页面图；Go/Rust不洁会话/运行意图回归，真实OS正常/异常重开待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-X03-T9-T10；正常重开、异常退出／断电后重开-chromium/X03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-X03-T9-T10；正常重开、异常退出／断电后重开-chromium/X03.json) |
| X04 | T5/T9/T10；通知点击、登录返回、无托盘环境 | 定位当前可用页／窗口，旧事件不自动提交或启动 | 子路径已验；整行待验 | 仅关联设备已绑定页面图；Rust回跳路由逻辑，真实通知/登录返回/无托盘待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-X04-T5-T9-T10；通知点击、登录返回、无托盘环境-chromium/X04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-X04-T5-T9-T10；通知点击、登录返回、无托盘环境-chromium/X04.json) |
| C01 | T5/T8；跨四页修复、返回、未保存草稿 | 保留平台、目标、草稿与操作；返回焦点正确 | 子路径已验；整行待验 | 详情来源草稿画面；recovery-navigation全路径与焦点回归，Ego双Escape返回触发器后设置标题y77。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C01-T5-T8；跨四页修复、返回、未保存草稿-chromium/C01.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C01-T5-T8；跨四页修复、返回、未保存草稿-chromium/C01.json) |
| C02 | T6–T10；860×600／常规尺寸，长URL／错误／标识 | 主操作可发现、纵向可滚动、无横向溢出；同尺寸对照原布局，暂停／恢复保留右侧额度区下方靠右 | 子路径已验；整行待验 | 长URL关联图；12代表图覆盖860×600/1000×700/1512×833中英明暗/长错误，几何无横溢；右侧动作坐标保存，未逐88图人工细看。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C02-T6–T10；860×600／常规尺寸，长URL／错误／标识-chromium/C02.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C02-T6–T10；860×600／常规尺寸，长URL／错误／标识-chromium/C02.json) |
| C03 | T4/T6–T10；中英、明暗、系统语言不同 | 全部可达路径本地化；技术原文只在合适详情 | 子路径已验；整行待验 | 中文设置画面＋中英明暗代表路径；missingTranslations检查通过；真实OS不同系统语言待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C03-T4-T6–T10；中英、明暗、系统语言不同-chromium/C03.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C03-T4-T6–T10；中英、明暗、系统语言不同-chromium/C03.json) |
| C04 | T5/T6–T10；键盘、Escape、屏幕阅读、减少动态效果 | 正确名称、焦点、状态播报；轮询不抢焦点 | 子路径已验；整行待验 | 换号嵌套弹窗；Ego Enter/Escape焦点、自动reduced-motion几何；真实屏幕阅读器和三端系统键盘待验。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C04-T5-T6–T10；键盘、Escape、屏幕阅读、减少动态效果-chromium/C04.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C04-T5-T6–T10；键盘、Escape、屏幕阅读、减少动态效果-chromium/C04.json) |
| C05 | T4b/T5/T10；双击、导航、旧实例／revision、身份变化、结果未知组合 | 显式操作只提交一次；读取恢复不得变成写入重放 | 子路径已验；整行待验 | 新owner确认画面；device-recovery/auto-read/polling旧revision/实例/候选屏障和真实重启单次POST通过。 [画面](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C05-T4b-T5-T10；双击、导航、旧实例／revision、身份变化、结果未知组合-chromium/C05.png)／[几何与实际DTO调用](evidence/2026-10-30-interaction-clarity/t10-layout-v1-output/t10-layout-C05-T4b-T5-T10；双击、导航、旧实例／revision、身份变化、结果未知组合-chromium/C05.json) |

## 实际执行记录

- 环境准备：原生工作树工具在聊天根目录返回 `Not a git repository`；已按用户指定隔离要求回退到 Git worktree，Hive 原树未修改。
- Hive 基线：T2指定数据库命令退出0，集成包5项通过、0失败、0跳过；service包该过滤器没有匹配测试，不能算该包验收。日志在本轮证据目录 hive-baseline.log。
- 原布局实测：860×600停止按钮保持摘要右侧，暂停按钮位于额度下方靠右，高25px；其底部与固定页脚区重叠，后续须验证32px按钮及实际可见性。三尺寸坐标和截图见 before-layout.json / before-running-*.png。仅布局基线。
- T1 基线：Go beewire/agent/desktopbridge 供给相关定向测试通过；TS supply/diagnostics 44 项通过。仅为改动前基线，新增功能另验。

## T2 原因与兼容验证

版本：Bee `2c48adb`、Hive `da161c5`，Hive Bee协议子模块 `ab8140a`。环境：本机 Go 1.27.3、Docker PostgreSQL 55432；独立测试schema、合成账号与本地服务。证据层为核心／数据库／真实HTTP集成，不证明正式页面或官方请求完成。

- P04/P05：15个数据库子例覆盖五个新原因、全局市场与设备子集、授权、暂停叠加、多个阻塞共存、查询失败；新旧详细模式ready/paused一致。三种原本ready的静态／动态路径有明确true断言。
- P08：Bee接受旧Hive忽略查询参数后的原not_configured；新原因严格解码；未知／跨平台／矛盾响应拒绝。最终跨仓组合仍在T10统一验证。
- W05/C05：响应丢失只GET回读，PUT计数为1；Hive非法／重复／错误编码的详细选项在写入前400，触发器证明有效详细PUT只写暂停一次。
- 原始日志：[Hive最终race](evidence/2026-10-30-interaction-clarity/t2-hive-green-final.log)、[静态与动态ready断言](evidence/2026-10-30-interaction-clarity/t2-hive-green-ready-final.log)、[Bee最终race](evidence/2026-10-30-interaction-clarity/t2-bee-green-final.log)、[版本与测试清单](evidence/2026-10-30-interaction-clarity/t2-verification.json)。对应RED均在同目录，编译／测试准备错误未计为行为失败。

以上是场景的核心子用例证据；涉及T7页面、T10最终集成或真实平台的整行保持待验。

## T3 连接观察验证

版本：Bee `fca085a`（测试时HEAD为父提交`2c48adb`加相同T3源码），Node24.22.1、Go1.27.3、Rust1.94.0。侧车按最终Go源码构建。使用类型注入和本地HTTP／WebSocket服务；没有操作真实Hive绑定或贡献。

- R04/R05：DNS、TLS、拒绝、超时、HTTP200未升级／无效101／401／403／409／503、心跳断线、同步终止均有具体断言。重试时间来自原退避定时器；保留原次数、退避上限与所有权规则。
- A08/P03：非终端平台同步失败仍保持WebSocket connected，其他平台供给不被清空；另一平台成功不清除该失败。正式页面需T7复验。
- R07/C05：旧run、停止后及取消上下文的回调拒收；连接成功及主动停止清除当前失败。三层严格DTO拒绝缺字段、null证据、不安全origin／path和矛盾重试时间。
- 安全原文：URL秘密参数、已知凭据、Bearer及带引号的token/password赋值脱敏；HTTP证据不复制任意服务端正文。日志内秘密样例均为合成标记。
- 原始证据：[Go race逐项记录](evidence/2026-10-30-interaction-clarity/t3-green-race.jsonl)、[TS](evidence/2026-10-30-interaction-clarity/t3-green-ts.log)、[Rust](evidence/2026-10-30-interaction-clarity/t3-green-rust.log)、[带引号脱敏RED](evidence/2026-10-30-interaction-clarity/t3-red-quoted-secrets.log)。主控独立统计race为26顶层／69含子项通过，0失败／0跳过／0竞态警告。

任务审查发现并关闭I1：Go接受的大小写host／默认端口被Rust/TS规范化等值校验拒绝。修复`94f580c`保留安全原文，并以同一份9个Go生产产物和17个安全反例跨三层回归。主控已核原始RED／GREEN：Go15顶层／62项、TS18、Rust3均通过，typecheck退出0；复审Approved，无遗留问题。证据：[TS修复验证](evidence/2026-10-30-interaction-clarity/t3-origin-green-ts.log)、[Rust修复验证](evidence/2026-10-30-interaction-clarity/t3-origin-green-rust.log)、[Go修复验证](evidence/2026-10-30-interaction-clarity/t3-origin-green-go.log)。

以上证明核心观察和契约，不证明最终页面、真实网络全流程或原生菜单已验收。

## T4 与 T4a 任务级验证

版本：T4 `adeba1b`＋`00b13dd`；T4a `6a3e231`＋`9dd0492`。环境沿用上述宿主工具链；Go 使用合成数据及本地 HTTP 服务，Rust 使用测试侧车，浏览器正式 NativeApp 使用合成 IPC。独立任务审查均通过；此处不代表 T5–T10 最终页面和全链路已通过。

- S04／D08／C03：结构化失败逐层保留机器码、环节、时间、安全实际值及原始原因；已知错误中英说明与修复入口同步，未知错误不猜测。旧 runtime 回执保留 `STALE_RECEIPT`，设置“查看设备”能导航。T4 最终 Go 两包、TS49及120、Rust185、typecheck通过；修复后TS11、正式组件浏览器1通过。原始证据：[T4 Go](evidence/2026-10-30-interaction-clarity/t4-final-go.log)、[T4 TS](evidence/2026-10-30-interaction-clarity/t4-final-ts.log)、[T4 Rust](evidence/2026-10-30-interaction-clarity/t4-final-rust.log)、[回执修复](evidence/2026-10-30-interaction-clarity/t4-fix-green-runtime.log)、[设置入口](evidence/2026-10-30-interaction-clarity/t4-fix-green-settings.log)。
- S04／S05／G04：可信管理进程与业务启动状态分开；未配置／损坏记录以真实 binding revision 进行诊断，诊断严格相等和旧请求屏障保持。合成 IPC 的 absent1 → corrupt2 → valid3 转换均清除旧报告、可显示同修订诊断；Restore和Start均为0。证据：[修订转换](evidence/2026-10-30-interaction-clarity/t4a-fix-browser-synthetic.json)。只证明模拟组件行为，不证明真实导出或 Hive 核验。
- N03／N04／S04：显式应用网络可处理具体 `NETWORK_APPLY_REQUIRED` 阻塞，已有启动验证与真正启动 hold 分别沿用原恢复语义或保持停止。重新检查仅读取、零 Stop／Configure／Restore／Start；pending update、身份、受保护数据、owned exit 及非网络阻塞仍拒绝。最终定向证据：[experience 7项](evidence/2026-10-30-interaction-clarity/t4a-fix-final-experience-rust.log)。
- T4a 最终修复：Go两包、TS37及呈现12、typecheck通过；Rust196通过、2既有签名包测试ignored，随后两个窄修分别1／7通过。证据：[Go](evidence/2026-10-30-interaction-clarity/t4a-fix-final-go.log)、[TS](evidence/2026-10-30-interaction-clarity/t4a-fix-green-ts.log)、[呈现](evidence/2026-10-30-interaction-clarity/t4a-fix-final-problems.log)、[Rust全套](evidence/2026-10-30-interaction-clarity/t4a-fix-final-rust.log)、[无修订原错误透传](evidence/2026-10-30-interaction-clarity/t4a-fix-final-context-rust.log)、[typecheck](evidence/2026-10-30-interaction-clarity/t4a-fix-final-typecheck-after-problems.log)。
- C02／C03 的阶段性视觉：最终损坏配置提示保留 actual／required，网络错误“查看设置”实际进入网络页签。证据：[最终交互记录](evidence/2026-10-30-interaction-clarity/t4a-fix-browser-feedback-final.json)、[损坏配置图](evidence/2026-10-30-interaction-clarity/t4a-fix-browser-corrupt-final.png)、[网络图](evidence/2026-10-30-interaction-clarity/t4a-fix-browser-network-final.png)。旧 `t4a-fix-browser-corrupt.png` 为中间状态；所有图只证明对应布局，不替代功能和原生验收。

T4a 原审查三项 Important（无context诊断修订、网络应用循环、缺少具体失败事实）均在有限复审关闭，C/I/M=0/0/0。上述场景的整行仍等待最终版本与其余子用例核验，不因任务级通过统一勾绿。

## T4b 配对与凭据恢复的任务级验证

版本：主体 `83cd3e9`，账号准入错误收口 `a114c99`，独立审查修复 `8897183`；复审通过，I1/I2/M1关闭，历史测试稳定性M2留最终审查。使用隔离临时配置、本地 HTTP 协议服务、真实文件写入失败和重启注入。尚未连接正式页面，也没有操作真实用户绑定或官方账号。

- D02／D07／C05：首次创建响应丢失后再次 Begin／重启不新增 POST；旧 redeeming 且轮询仍 approved 不重复兑换。尝试标记在提交前持久化；未知兑换只查新凭据身份，后续过期不授权重建。最初 RED 的创建计数为3（应1）、兑换计数为3（应0），最终 race 包含修复断言。证据：[最初 RED](evidence/2026-10-30-interaction-clarity/t4b-red-go.log)、[主体最终 race](evidence/2026-10-30-interaction-clarity/t4b-race-final.log)。
- D04–D09：严格阶段、允许的401领域码、网页归属与不同 owner 本机确认、旧未决操作阻塞、同 owner 新设备的账号／运行／代理隔离分别验证。token保存、配置保存及事务收尾失败通过真实文件路径故障注入；远端已成功后恢复本地保存仍只兑换1次。已有事务而配置缺失须保留阻塞，不得变成 unbound；证据：[缺绑定 RED](evidence/2026-10-30-interaction-clarity/t4b-red-go-missing-binding.log)。
- S04／D09／C05：原生恢复受真实bridge、完整性、更新、frozen及owned-exit保护；完成后仍需显式启动重查，不调用 Restore／Start。completed重复查询曾重新封锁已核验启动状态，新增反例后修复；证据：[completed RED](evidence/2026-10-30-interaction-clarity/t4b-red-rust-2.log)、[主体最终 Rust 203通过／2既有ignored](evidence/2026-10-30-interaction-clarity/t4b-rust-final.log)。两项签名包专项未计通过。
- 首次 DeviceView 的公开恢复阶段与凭据恢复三方法、无URL参数的 recoveryOpen 均经严格消费者检查。证据：[TS15](evidence/2026-10-30-interaction-clarity/t4b-green-node-4.log)、[typecheck](evidence/2026-10-30-interaction-clarity/t4b-typecheck-3.log)。这些结果不证明真实网页打开或归属确认已经验收。
- 准入并发：已准入供给写未结束时恢复拒绝，结束后才可准备；恢复与账号worker拒绝原因不能误报closed。四调用路径×五拒绝事实共20组合真实RED→GREEN，确认无worker、无配对POST、不清pending。证据：[错误原因 RED](evidence/2026-10-30-interaction-clarity/t4b-admission-reason-red.log)、[定向通过](evidence/2026-10-30-interaction-clarity/t4b-admission-reason-green.log)、[最终收口 race](evidence/2026-10-30-interaction-clarity/t4b-admission-reason-race.log)。最后收口仅Go变化，未把此前Rust结果冒充新Go构建全量验证；下一次Cargo前须按新HEAD重建sidecar。

中间失败均保留：legacy expired持久化遗漏已修；一次既有Authorize测试在150ms内未产生子进程启动标记，未改生产或测试预算，隔离及后续完整消费者race通过。记录见任务报告和原始`t4b-race-2.log`，不把文件名含green视为通过。

独立审查I1/I2及M1修复 `8897183`：首次初始化先写现有未提交事务再保存配置，GET 503／断连／超时后，Status只读保持 `awaiting_confirmation`，显式Begin才创建一次；配置缺失只在严格未提交形态可继续。创建未知原code/message/details/observed_at跨五次重启／查询保持、记录字节有界；准入失败附实际关闭和worker状态。证据：[行为RED](evidence/2026-10-30-interaction-clarity/t4b-review-fix-red-2.log)、[最终Go38项](evidence/2026-10-30-interaction-clarity/t4b-review-fix-green-final.log)、[最终消费者race](evidence/2026-10-30-interaction-clarity/t4b-review-fix-race.log)、[重建sidecar](evidence/2026-10-30-interaction-clarity/t4b-review-fix-build-before-cargo.log)、[Rust定向15项](evidence/2026-10-30-interaction-clarity/t4b-review-fix-rust.log)。日志附命令、时间、基线和任务源码SHA256；主控实核指纹相同。race有106顶层/433含子项通过，0失败/跳过/数据竞争；故障注入WARN仍如实保留。Rust本轮为15项，190 filtered，不宣称全量205通过；此前2项签名包ignored仍待T10。

无token的 creation_unknown仍没有协议查回能力；导出／管理员指引不证明人工恢复闭环。上述只证明任务核心及契约子用例，D07该分支和最终真实环境整行继续待验。

## 未完成的真实环境验收

实施中逐项评估可执行条件。当前没有将用户正在使用的设备重新绑定、切换官方账号、开始贡献或恢复真实接单作为隐式测试动作。用户已确认暂不具备专用验收账号、明确请求范围、Linux/Windows 原生系统和可安装签名更新包；相关场景保持待验，不能引用旧版本证据替代本次最终版本。

当前 Hive 隔离子模块协议提交 `ab8140a`：以原有效 `6fccf3b` 为父提交，仅移植 Bee `f33a0e3` 的 beewire 两个文件；原因测试通过，原有效基线祖先检查通过。两树协议文件保持相同，主线既有 TEE/CLI/账号修复未回退。

## T5 前端阶段记录（不代表原生或整体验收）

范围：`8897183..cf573e4`，macOS arm64，Node 24.22.1；浏览器为 Chromium、模拟 native IPC。主控已核原始日志。共享主状态、分平台阶段发布／真实刷新元数据、一次返回导航及跨四页草稿已实现；完整概览、设备与账号呈现仍由 T6／T7 接续。

| 本阶段验证 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 状态派生与唯一协调器 | 36通过、0失败／跳过 | [状态测试](evidence/2026-10-30-interaction-clarity/t5-final-node-2.log) |
| 恢复导航与后台稳定性 | 29通过；草稿、目标焦点、零重复写入、轮询不抢焦点 | [导航测试](evidence/2026-10-30-interaction-clarity/t5-final-navigation-3.log) |
| 直接客户端消费者 | Node 84通过；TS transport两平台可独立到达invoke | [消费者Node测试](evidence/2026-10-30-interaction-clarity/t5-final-consumer-node.log) |
| 正式组件直接消费者 | 72通过；这次日志仍包含修复前容器嵌套警告 | [消费者浏览器测试](evidence/2026-10-30-interaction-clarity/t5-final-consumer-browser-3.log) |
| 最终启动提示增量 | 容器修复后1通过；单alert，无非法嵌套警告 | [启动提示增量](evidence/2026-10-30-interaction-clarity/t5-final-startup-notice.log) |
| 最终类型检查 | exit=0 | [typecheck](evidence/2026-10-30-interaction-clarity/t5-final-typecheck-4.log) |
| Ego正式组件人工检查 | 中文浅色／英文深色，860×600与1280×820；长目录草稿往返、标题和来源输入聚焦，写调用为0 | [实际尺寸及纠正记录](evidence/2026-10-30-interaction-clarity/t5-ego-manual.log) |

限制：TS并发与模拟IPC不证明Rust→Go真实桥接并发；该层证据由下方原生补段提供。总任务审查覆盖`8897183..987ca4c`。上述通过不勾选76项最终场景，也不替代官方账号、原生权限或完整桌面验收。

历史失败保留：首轮Node 35项中24失败包括新增API缺失，不能全部当作业务反例；来源导航与缺诊断目标的早期harness问题均有另行纠正后的行为RED。72项消费者通过发生在最终容器修复之前，最终仅重跑对应单alert用例，不表述为全部72项在容器修复后重跑。

## T5 原生读取隔离阶段记录

补段提交 `987ca4caa58fccbbb61daa2d348a0d36830a146b`。同一 owned Bee／协议实例中，三种合法平台读取保持同平台顺序、跨平台独立；其余操作为全局屏障。Rust 总准入16包含排队及发送中请求，首字节发送与取消／期限判定共用原子边界。EOF、shutdown及错误路径取消并收拢worker；冻结退出在既有期限内等待名额，不扩容。

| 验证及场景落点 | 实际结果 | 原始证据 |
| --- | --- | --- |
| A01／P03，真实io.Pipe及owned pipe初始行为RED | 两方向快平台均被慢平台阻挡；随后最小实现修复 | [Go RED](evidence/2026-10-30-interaction-clarity/t5-transport-red-go.log)、[Rust RED](evidence/2026-10-30-interaction-clarity/t5-transport-red-rust.log) |
| Go调度、屏障、响应ID和终止路径race | desktopbridge126条（55顶层）、cmd/bee10条（8顶层）通过，0失败／跳过 | [最终race](evidence/2026-10-30-interaction-clarity/t5-transport-go-race-terminal-verified.jsonl) |
| 现有核心准入／生命周期消费者race | agent定向318条（85顶层）通过，0失败／跳过；不是完整agent套件 | [核心定向race](evidence/2026-10-30-interaction-clarity/t5-transport-agent-race-final.jsonl) |
| 最终提交后重建与完整Rust | 213通过、0失败、2签名App专项ignored；真实CONNECT双方向包括在内 | [最终构建](evidence/2026-10-30-interaction-clarity/t5-transport-build-committed.log)、[完整Rust](evidence/2026-10-30-interaction-clarity/t5-transport-rust-lib-committed.log)、[来源与文件SHA256](evidence/2026-10-30-interaction-clarity/t5-transport-evidence-metadata.json) |
| R07／X02／C05，队列与收尾反例 | 屏障后EOF、满16预算退出、worker超限终止均先观察行为失败，再修复并纳入最终验证 | [EOF RED](evidence/2026-10-30-interaction-clarity/t5-transport-red-eof-barrier.log)、[退出预算RED](evidence/2026-10-30-interaction-clarity/t5-transport-red-exit-budget.log)、[worker终止RED](evidence/2026-10-30-interaction-clarity/t5-transport-red-worker-terminal.log) |

真实组合使用明确临时file来源和合成凭据，本地CONNECT代理仅门控并返回502，不建立官方上游连接。只隔离测试子进程PATH和代理变量，不覆盖HOME/CODEX_HOME，不读取用户绑定／官方登录，不启动贡献。因此它证明真实Rust→构建后Bee的读取隔离，不能证明官方CLI互操作、官方请求成功或Hive全链路。

首轮完整Rust为212通过／1失败／2ignored，失败是CONNECT准备门3秒内未到达；源码首次请求前可能执行最长3秒加清理的CLI版本探测，预算冲突已证，但原失败那次CLI实际耗时未测。仅将组合测试PATH隔离到空目录使用既有fallback，保持产品与测试3秒门不变；原[失败日志](evidence/2026-10-30-interaction-clarity/t5-transport-rust-lib-final.log)保留。完整T5仍以独立审查结论为门禁，76项最终场景尚未整体验收。

完整T5首次独立审查（`8897183..987ca4c`）发现4项Important，当时不能标记任务完成：身份门禁误伤本机停止及官方登录／取消；Claude行内来源修复丢失目标平台；reconciling核对从10秒变为400ms；未发送错误丢失底层证据，且直接前端消费者误按未知写入处理。随后修复波次已分别建立行为回归，闭合结果见下文；原首次审查与失败记录保留。


## T5 独立审查修复验证（9bcb051）

2026-11-02，`987ca4c..9bcb051`修复21个直接源码/测试文件；独立复审Spec通过、Quality Approved、C/I/M=0/0/0。身份失败下本机stop、合规官方登录/取消保留，身份写仍受保护；Claude行内导航保留平台；reconciling恢复10秒；确定未发送保留安全原始原因且不误入未知写入，不重放。共享/平台revision下限和等待后再验证保留。

| 验证范围 | 实际结果 | 证据 |
| --- | --- | --- |
| 协调器、错误呈现、供给消费者 | Node 71通过、0失败 | [最终Node](evidence/2026-10-30-interaction-clarity/t5-fix-node-verified.log) |
| 恢复导航、运行、自动账号读取与轮询 | 四文件84通过、0失败；模拟native IPC | [最终浏览器](evidence/2026-10-30-interaction-clarity/t5-fix-browser-verified.log) |
| TypeScript | typecheck退出0 | [最终类型检查](evidence/2026-10-30-interaction-clarity/t5-fix-typecheck-final.log) |
| 原生桥与协议 | sidecar 35通过/1签名App ignored，protocol 34通过 | [sidecar](evidence/2026-10-30-interaction-clarity/t5-fix-rust-sidecar-final.log)、[protocol](evidence/2026-10-30-interaction-clarity/t5-fix-protocol-verified.log) |
| 最终提交后构建来源 | 重建成功；21文件哈希与验证源码一致，二进制SHA256核对相等 | [构建](evidence/2026-10-30-interaction-clarity/t5-fix-build-committed.log)、[元信息](evidence/2026-10-30-interaction-clarity/t5-fix-evidence-metadata.json) |
| 人工操作检查 | 身份失败下停止按钮可用，点击确认后模拟stop调用1次，start仍禁用；Ego 36/p1 | [操作前截图](evidence/2026-10-30-interaction-clarity/t5-fix-identity-stop.png)、[操作后JSON](evidence/2026-10-30-interaction-clarity/t5-fix-ego-manual.log) |

截图实际1920×944，证明操作前可发现性，JSON对应点击后的不同时间；不混为同一帧，也不当真实设备/Hive验收。首轮浏览器82/84、随后本机只读resolution重复publish造成maximum update depth均有原始失败日志；最终84项无该错误。首次类型检查测试字面量问题也保留日志。Rust证据对应提交相同源码、当时987ca4c构建；提交后只重建到9bcb051，没有声称再跑Cargo。真实账号/OS/签名资源缺口保持，76项最终结论不因T5阶段通过提前勾绿。

## T6 设备、连接与概览验证

提交 `6022fd7`＋审查修复 `6fa2eba`，独立初审两项Important及一项Minor已全部闭合，有限复审Spec compliant／Approved，C/I/M=0/0/0。主控核原始输出、代表性原图及源码／提交blob／证据SHA-256；此为T6任务级验证，76项最终验收状态仍按上表保留。

| 验证范围 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 正式组件设备／运行与二次凭据恢复 | 57/57通过，模拟native IPC；取消零写、新operation确认、等待后条件变化、恢复错误保留本机stop/login/cancel | [最终浏览器](evidence/2026-10-30-interaction-clarity/t6-fix-final-ui.log) |
| 唯一协调器与共享主状态 | Node72/72；恢复保存后回执失败同轮隔离绑定，不以恢复查询失败唤醒旧写worker | [最终Node](evidence/2026-10-30-interaction-clarity/t6-fix-final-node.log)、[保存后回执RED](evidence/2026-10-30-interaction-clarity/t6-red-save-receipt.log) |
| 原生无事务查询与保护 | experience11/11＋sidecar1/1；无事务不改ready/blocked/checking与网络范围，真实错误和同码写请求仍受保护 | [原生行为RED](evidence/2026-10-30-interaction-clarity/t6-fix-red-native.log)、[experience](evidence/2026-10-30-interaction-clarity/t6-fix-final-native.log)、[sidecar](evidence/2026-10-30-interaction-clarity/t6-fix-final-sidecar.log) |
| Go生产者／协议及TypeScript | Go两包定向通过；最终typecheck退出0；修复阶段未改Go | [Go定向](evidence/2026-10-30-interaction-clarity/t6-go-recovery-final.log)、[类型检查](evidence/2026-10-30-interaction-clarity/t6-fix-final-typecheck.log) |
| 布局／键盘／长内容 | 860×600／1000×700／1080×840，中英明暗代表状态；主按钮≥32px、重要对比度≥4.5；取消焦点返回、无自动写、后台不跳滚动 | [最终测量](evidence/2026-10-30-interaction-clarity/t6-manual-round4.json)、[修复人工记录](evidence/2026-10-30-interaction-clarity/t6-fix-manual.json) |
| 来源与提交绑定 | 初次21源文件＋62证据、修复7源文件＋18证据均hash一致；Rust为提交前相同源码定向验证 | [初次manifest](evidence/2026-10-30-interaction-clarity/t6-final-source-manifest.json)、[修复manifest](evidence/2026-10-30-interaction-clarity/t6-fix-source-manifest.json) |

配对网页主按钮因860×600首屏不可见，从网址下方移至配对阶段标题右侧；同尺寸[调整前](evidence/2026-10-30-interaction-clarity/t6-device-pending-860-zh-light.png)／[调整后](evidence/2026-10-30-interaction-clarity/t6-device-pending-860-zh-light-final.png)留证。贡献按钮和账号动作位置未迁移。账号旧套餐／原因文案及完整窄窗布局继续由T7处理。

早期49/69、v2 UI及取消未归还焦点、preview完成图沿用旧选择等历史结果均保留，不作最终通过依据。真实Hive网页恢复、官方请求、原生WebView剪贴板／OS打开浏览器、目标OS及签名包仍待相应环境；模拟交互、图像或原生门禁测试均不替代这些验收。

## T7 账号、平台接单与额度任务级验证

范围 `6fa2eba..267a33d`，审查修复 `267a33d..5bd9c786`；macOS arm64，Node 24.22.1，Chromium 正式组件、模拟 IPC。账号阶段、确认条件、24种供给原因、全部额度窗口与120%原值、实际取消出处、共享/单平台失败后的历史事实，以及已接收异步操作至同owner终态核对均有任务级行为断言。接入/换号后仍暂停，核对不重放写入；真实官方账号/上游和最终集成不在这些证据范围内。

- 最终修复原始日志：[Node68/0失败/0跳过](evidence/2026-10-30-interaction-clarity/t7-fix-node-final.log)、[两正式组件文件同次56/0失败](evidence/2026-10-30-interaction-clarity/t7-fix-ui-final-v2.log)、[最终typecheck退出0](evidence/2026-10-30-interaction-clarity/t7-fix-typecheck-final-v2.log)。主控实读日志，核15源文件工作副本/commit blob/manifest与69证据SHA256一致。
- 取消说明仅由实际取消未知动作产生；未取消的后台snapshot错误、真实取消未知/迟到成功分别覆盖。正常官方登录三种终态、旧revision/其他operation/平台/generation错配，以及reconciling接入操作的同owner终态均覆盖，写入次数明确断言。首轮RED及修复中暴露的终态失败保留，原始失败trace共8份独立目录保存。
- 共享runtime/defaults读取失败不再解释为身份撤销；共享/单平台snapshot失败保留“上次确认”、实际时间和旧额度，不支持当前ready或写操作。仅远端身份失败时，本机新读事实与旧Hive记录分开。恢复后移除历史标记，全程零自动写；[人工记录](evidence/2026-10-30-interaction-clarity/t7-fix-history-manual.json)。
- 三尺寸×中英×明暗12格长错误见[实际浏览器记录](evidence/2026-10-30-interaction-clarity/t7-fix-readability.json)。主控实际打开860中浅/英暗、1000中浅、1080英暗长错误、860处理入口和1000英文历史列表/详情原图；嵌入错误正文不再逐字母竖排。动作仍与右侧额度同组，处理入口可点击并聚焦对应来源。这些图片仅支持相应布局和模拟操作。
- 原始T7四文件86通过在最后翻译修复之前；修后83通过/3模块404，之后单文件24通过不能合并成同次86。原三个trace已被共用output清理，仅有当时实际摘录，Vite缓存因果未证。保留该历史边界，最终T10同源码整轮另验，不以本修复56通过代替。

本节记录可复核的任务级结果。独立有限复审已通过：新增C/I/M=0/0/0，原M2保留；跨任务核心保护由T5/T6既有证据支持，完整最终布局及四文件整轮由T10承接。76项最终场景均不据此整行勾选。专用官方账号/请求范围、跨平台真桌面、签名更新包等缺口沿用已确认记录。

## T8 设置与诊断任务级验证

T8 提交 `c3cc10284f8379a5343bc52b0b6a73292d22276d`，任务基线 `5bd9c786`。当前处于独立 Spec／Quality 审查，未勾选最终76项矩阵。保存、配置生效、贡献恢复独立反馈；未知写入只读核对；通知偏好、OS权限、投递及自启期望、登记分别呈现。原报告读取失败保留ID和checks，显式重读不重新start，无ID开始未知不伪造查询；同scope新报告代次隔离旧读／导出。

- 最新同次正式组件：`t8-accepted-final-ui.log`，59/59；规定五文件：`t8-accepted-final-node-fixed.log`，38/38；共享状态整文件：`t8-accepted-final-desktop-state.log`，28/28；`t8-accepted-final-typecheck-fixed.log`退出0。主控已读原始输出。
- Rust网络五个实际失败阶段仅为无details原错误补真实check及时间，原cause保留；`t8-final-rust-network.log`为23/23，此后Rust未改。先按当时HEAD正式重建sidecar，后续Cargo前需按最新HEAD再重建。不能据此宣称本轮完整Cargo已经通过。
- 真实生产者DTO经strict decoder：device_replaced＋next_action=diagnostics，以及http_rejected＋Hive/null平台/GET identity/401/明确server_code。呈现、共享sink及正式导航均先有行为RED，最小修复后两种诊断→设备区焦点→恢复入口→返回原check通过；start1、恢复／配对／账号／运行写入均0。设备／诊断两张最新原图与JSON已由主控实际查看。
- 原108张设置／诊断图有刷新按钮30.398px的视觉失败；窄修后12组合重新采集24图，按钮32px、重要文字对比度约5.73／5.74。旧图和targets-v2早于末次真实DTO/sink修正，早期未采逐文件SHA，不回填最终版本；最新59UI／38＋28Node覆盖最终源码，最新设备凭据两图在末次产品修改后采集。图片仅为对应布局证据。
- 最终19源文件工作副本／提交blob／source manifest与266证据SHA均由主控逐项核对一致；历史失败日志及21个trace保留。首轮50/55、后55及58与最终59分别记录，不拼接统计。

证据目录同前，完整实现与历史失败见`.superpowers/sdd/T8-report.md`和`t8-test-evidence-index.json`。真实OS权限／登记／投递、原生导出落盘、官方账号、签名更新及完整跨场景仍待相应环境／T10，模拟IPC不替代。

T8独立审查发现I1：真实自启status失败DTO的registered=null/error被误作confirmed，解除先前unknown写锁且虚报不一致。修复`49f7298`保留原写失败与当前读取错误、用户期望和上次确认登记；status错误不解除unknown，set的null登记仍未知，而set返回的可信bool即使附错误仍显示实际登记／已证不一致。主控已核Rust生产者并与reviewer统一边界，首轮第三个bool/error RED预期过严，单列测试假设错误，不能算新产品缺陷。

修复最终正式两文件同次64/64（`t8-fix-final-ui.log/json`）、typecheck／diff0；没有Go/Rust变更，不重跑或冒称新Cargo验证。2源文件工作副本／commit／manifest、70证据SHA及7份最终验证／人工命令来源SHA均由主控核对。人工03/04实测860×600：失败后期望保留、控件禁用、两错误独立；可信回读后才可继续，set始终1，实际键盘焦点可见。manual02原图实际1512×833，不能当860证据；原图与边界保留。70证据及原清单已逐字归档同一证据目录，`t8-fix-archive-manifest.json`保留.sdd原路径映射及SHA。独立有限复审已通过，I1闭合、无新增C/I/M；原⚠三项边界由主控承接。真实OS仍待验，最终矩阵不提前勾选。

## T10 最终执行（2026-11-03，UTC日志为2026-11-02）

本次没有产品源码变动。正式组件仍为 Bee `3b0b747`，Hive产品为`da161c5`，新增验收测试和文档提交`bf05ea6`＋`d0e979b`，gitlink保持`ab8140a`。各命令 JSON 记录执行时 HEAD/dirty/逐文件SHA；最终manifest只归档本轮新证据，不倒填历史缺失。布局每行的 PNG/JSON 都来自真实组件渲染，**仅证明明确登记的关联子画面**；复合行未展开的异常界面仍待验，不能以“共用组件”或同一入口截图抵作整行全覆盖。

| 层级 | 最终命令证据 | 结果/边界 |
| --- | --- | --- |
| Go | t10-baseline-go / t10-vet-final | race全7包、vet退出0；受控HTTP/WebSocket/进程，不等于官方上游 |
| Node | t10-baseline-node | 214通过；后续只改浏览器测试/fixture/文档 |
| 正式浏览器 | t10-device-final-v4 | 252通过，0失败；最终整轮，原副作用/未知/实例/候选/revision断言保留 |
| 正式预览 | t10-preview-final | 61通过；74场景，10组；导出实际30秒无回执进入unknown |
| 布局 | t10-layout-v1 | 88通过：76逐ID关联子画面＋12尺寸/语言/主题代表路径；保留viewport/DOM/动作坐标/实际调用，不代表所有异常子画面 |
| 异常布局补充 | t10-layout-supplement-final-v6 | 9通过：L01缺CLI/版本，L04超时/进程失败/取消未知，N03保存未生效，N04恢复失败/应用未知/保存后读取失败；滚动前后原图＋JSON，仅此子路径 |
| 网页构建 | t10-web-build-final / t10-typecheck-final | tsc＋vite通过；678.70KB chunk警告保留 |
| Rust | t10-sidecar-final / t10-cargo-final | 正式重建sidecar后230通过/2忽略；忽略专项单列 |
| 原生包专项 | t10-native-qa-build / t10-native-qa-codesign / t10-native-qa-ignored | Bee Interaction QA另名包、codesign通过，2项无GUI seal/篡改与握手/ping/reap通过；未启动完整GUI |
| Hive数据库 | t10-hive-final-race | T2数据库过滤完整命令通过，无跳过；service过滤无额外匹配时不增加计数 |
| 最终Bee/Hive | t10-linux-hive-race-v6-build / t10-linux-broker-race-v6 | race实际JSONL＋HTTP＋DB；严格原始故障DTO、首次配对/恢复/保存/重启和新旧供给三组合，无skip |
| 最终核心连接 | t10-linux-hive-race-v9-build / t10-linux-runtime-isolated-v9 | race，5拒绝子例＋1真实重连；401/403/409/503/EOF，真实断socket＋listener后拒绝连接，真实scheduled后同run重连，暂停保留/零resume PUT/完整停止；internal网络＋独立临时DB，无外部默认路由 |
| 真实Hive网页 | t10-real-website-v2 / t10-web-cancel / t10-web-confirm | Ego真实登录/inspect/Cancel/Confirm；取消confirm/redeem/device增量0，确认create/confirm/redeem=1/1/1、pairing/deviceDB=1/1；身份有效且stopped |
| Ego人工 | t10-manual-layout | en/dark/860换号双层Escape返回OpenAI details；换设置标题获焦y77，无横溢；截图已实看 |

Linux最终Bee SHA256：`4ae0997ce1857681b7b5c63d02cfc82e13354994e378d7a67ceebda5e0e932ac`。使用非root Linux与独立XDG/DB schema，未设置HOME或CODEX_HOME、未运行smoke-accounts、未触碰用户真实账号/设备/贡献。另名App本身不隔离固定Go用户目录，不能因此启动GUI。

历史失败保留：最初预览33/12、后43/2及53/8等原始日志和trace未覆盖；正式首次230/22，经旧驱动/文案/locale null回执修正后96/2，再整轮250/2。后两项为80ms updater初始读次数和自动行进虚拟时钟的绝对计数断言；先pauseAt固定测量起点，定向重复三轮6通过，再最终252通过。W04旧测试自动用较新revision提交与批准语义相反，已改为revision变化后零写、关闭重开再显式确认；未放宽安全断言。

仍缺：专用OpenAI/Claude官方账号及受控请求范围、三端真实桌面、隔离macOS GUI会话、可安装签名更新包；无token创建未知的人工恢复闭环；最终可执行runtime的DNS/TLS/超时、心跳故障及持续冲突等其余变体（已有Go受控核心回归另列）；上述复合行未展开的所有异常布局。不得据当前子路径通过宣布整个计划/76行全部验收。

审查保留项：T4b曾有授权started在150ms/3秒窗口未观察到的失败，当时阶段耗时未采集，后续绿色不能倒推根因；T7旧83通过/3模块404的trace丢失保持事实；T8早108图无逐源SHA，70项修复归档为权威，manual02实际1512×833而03/04为860×600；T9旧unknown安装允许后续检查不证明升级成功。M1大chunk、M2颜色提示及Hive web npm ci记录的2个high审计项保留。

本轮补充的9个异常布局有独立最终命令与逐案原图；早期补充v1/v2因默认英文导航失败、v3中4个全局文案定位重复失败、v4通过但错误正文在下方，v5及最终v6补滚动前后视口后通过，均保留且不当产品回归失败。最终9案截图均已实际打开核对，正文及操作可通过原滚动区域到达，无横溢；并未把入口图当异常图。

真实连接专项使用专属 `bee-t10-runtime-internal-20261103` 网络与 `bee-t10-runtime-pg-20261103` 数据库容器；网络inspect Internal=true，QA /proc/net/route无默认路由，测试结束后只删除这两个任务资源。原有Postgres/MySQL未改动。成功升级后的合成维护返回503不证明官方同步成功；无真实模型请求。`t10-linux-runtime-race-v7`原5个失败源于复用“绑定后run_id=null”检查，而显式stop合法保留run历史；改为检查停止回执三项true，v8及隔离网络v9均通过，旧日志保留。

N03/N04截图范围：恢复失败及应用未知以 `-entry.png` 为反馈主图，显示完整错误和终态说明；同名无entry图为向下滚动后的配置路径表，不能据它证明顶部失败提示可读。保存未生效主图显示保存值18393与生效值未启用；保存后读失败主图显示上次确认及重新核对失败，entry图另有保存后生效未知反馈。

## T10 独立审查修复（2026-11-03）

产品源码仍为Bee `3b0b747`，Hive gitlink仍为`ab8140a`。本次仅测试、fixture、文档与证据；Hive修复提交`87e3233faa3b00e2a207e6dc0fdc5ea380c3a02a`。旧`t10-final-source-manifest.json`和其523项证据逐字保留，[修复manifest](evidence/2026-10-30-interaction-clarity/t10-fix-source-manifest.json)另列最终源SHA、每次命令和新artifact SHA；旧v6/v9、252/61/88/9按各自当次来源沿用，不重标为修后重跑。

- I1：来源测试未设置`TEST_BEE_BIN`时skip，显式设置后仍严格读取文件；相对路径拒绝。`t10-fix-provenance-unset-red`保留原失败；`t10-fix-provenance-unset-green`实际默认skip（不算真实验收通过）；`t10-fix-provenance-final-linux-green`只读最终Linux文件并核SHA，通过；`t10-fix-provenance-invalid-expected-fail`对显式无效路径实际exit1，错误未被skip吞掉。
- M1：`desktopBroker.stop`在shutdown前登记必执行的限时Wait/Kill/Wait，cmd只消费一次。`t10-fix-reap-red`中malformed/ignore均reaped=false；`t10-fix-reap-green`正常子例真实成功，畸形回执/忽略shutdown的子runner仍保留预期FAIL且reaped=true，父探针三子例通过。不是把故障子runner改成正常通过。
- I2及可用环境缺口：`t10-fix-ui-frozen`同次**25 passed (9.6s)**，为24个修复子用例加原R01主例。覆盖R01无已选账号、可信设备/运行但账号读取中、共享读取失败；以及S05/L02/G05/D06/A04/A08/L05/W04/W05/P04–P07/U05。正式NativeApp/真实DTO形状，模拟IPC；仅断言的子路径，不证明官方/原生副作用。R01独立读取中使用可信runtime的not_selected，开始禁用，账号count未知不零，导航后实际来源读取中，零业务写。
- 采图复核：25项之后P04某标题可见但说明被固定页脚遮住；只把P04–P07逐原因采图改为整项居中，核22项原因的正文、完整几何top>=52/bottom<=571。`t10-fix-reasons-visible-final`另一次**4 passed (3.2s)**，为最终逐原因画面来源。不能合称同次29；原frozen图保留历史，P04–P07主链接改用后续4项，其他行仍绑定frozen。
- 受影响既有回归：`t10-fix-affected-recovery`仅运行首次配对批准fixture影响的恢复单项，1 passed (3.5s)。`t10-fix-typecheck-after-capture`为最后采图代码后的typecheck，exit0；`t10-fix-discovery-layout-frozen`121项/3文件，`t10-fix-discovery-default`507项/13文件，新增fix未进入默认suite。发现命令不算实际执行这些测试。

本次失败轮次未覆盖：`t10-fix-ui-first`16/5、`ui-second`6/2、`ui-final`23/1。最后一项失败是导航到runtime目标后额外要求概览h1仍在视口；实际导航按目标滚动并聚焦runtime，最终保留真实runtime获焦、停止入口可用及零自动停止/登录的断言。S05对齐Rust实际`VERSION_MISMATCH`/`BUNDLED_BEE_INVALID`后，曾误传`details:null`触发严格`FAILURE_DETAILS_INVALID`，改为Rust实际序列化省略None字段；`s05-real-codes`原失败保留。`targeted-final`的1失败为额外假设账号卡应无runtime快照，实际可信runtime可提供本地selection，最终按真实边界校准；两S05当次通过。两次anchored grep的No tests found只算命令发现错误，不算RED行为证据。R01有效前提RED在`t10-fix-r01-precondition-red`，旧图selected/开始可用的反例完整保留。

15行主链接已改到实际子画面，新台账保留76个唯一ID及“已验所列子路径；复合行未全验”，并存旧图边界、所有修复JSON/入口图/逐原因图及精确命令来源。旧R01/D06/W04/W05/A04/A08/L05/U05等关联图不能支持目标前提，未补回历史结论。S05实际桥错误当前摘要仍通用，展开详情可读实际协议/SHA原因；本任务没有修改产品文案。

人工证据：Ego本任务space41按实际list后创建，仅860×600/reduced-motion两个R01场景，核开始disabled、未知不零、账号导航焦点及零写，结果见`t10-fix-ego-r01-result.json`。已实际打开21张原图，清单/观察/SHA见`t10-fix-visual-observations.json`，包括独立账号读取中、实际协议/完整性码、官方429详情和修后四类原因；没有把“已截图”当“已实看所有图”。space41已exactly-once finish keep[]，本任务Vite及临时子runner已清理，记录见`t10-fix-ego-finish`、`t10-fix-vite-stop*`和`t10-fix-cleanup`。Ego提示有更新，按授权未升级。

真实官方账号/上游请求、三端真实桌面、隔离macOS GUI、签名更新安装重启、无token人工恢复以及其余最终外部二进制DNS/TLS/超时/心跳/持续冲突仍保持各自待验；本次不勾整行或宣布整个计划验收完成。原chunk/颜色提示和2项high审计发现继续保留。

## T10 第二次窄修：预览消费者与 S05 已知失败（2026-11-03）

本轮产品／测试提交 `dd554529e8803f2791f26ab99c9ee5178a9479fd` 以 `e3584cf17d2a135153025296ec6ef0f1c65d0d48` 为父提交，修改 `problems.ts` 及英文翻译，产品源已发生变化。前面历史章节的 `3b0b747`、旧测试数量和图仍只对应其当时来源；没有回填或改写旧manifest。[本轮manifest](evidence/2026-10-30-interaction-clarity/t10-fix2-source-manifest.json)另列每次命令源SHA、全部新增产物size/SHA及旧证据保持证明。

- 预览直接消费者：原选择器明确期待74、实际76，有效RED见 `t10-fix2-selector-red.log`；最终 `t10-fix2-selector-final.log` **1 passed**，明确76及两个必备场景，保留原10个分组和换号确认的主题／尺寸切换，实际进入两个新场景验证未选前提、开始禁用、未知计数不零和零业务写。没有通过导入同一场景数组自证，也未重跑全部历史预览。
- S05：`t10-fix2-problems-red.log` 为22项中18通过／4个新增摘要断言失败；`t10-fix2-s05-red.log` 为中英两码4个具体摘要断言失败。修后 `t10-fix2-problems-green.log` **22 passed**、`t10-fix2-s05-green.log` **4 passed**；精确断言已知摘要、影响与匹配指引、原始安全详情、零业务写与硬门禁。未知错误含相同英文消息不被误分类，显式null详情仍拒绝。组件测试是故障DTO注入，不证明Rust真实失败或原生恢复已发生。
- 本轮最终 `t10-fix2-typecheck.log`、`t10-fix2-build.log` 均exit0；主JS chunk 680.22kB，超过500kB的构建警告保留。不重跑未受影响Go/Rust/Hive整套，后续全分支门禁由主控完成。
- Ego space42／p1：最终 `t10-fix2-ego-capture-v3.log`／[结果](evidence/2026-10-30-interaction-clarity/t10-fix2-ego-v3-result.json)在同次调用内设置注入、尺寸和媒体；两码×中英共4组合实际860×600、reduced-motion=true，中文light、英文dark，摘要和影响在视口内，键盘Enter展开详情且保持焦点，原始协议/SHA全文及零原生读取／业务写。已实看[中文协议详情](evidence/2026-10-30-interaction-clarity/t10-fix2-ego-v3-protocol-zh-light-details.png)与[英文完整性详情](evidence/2026-10-30-interaction-clarity/t10-fix2-ego-v3-integrity-en-dark-details.png)两张代表图；其余图保留而不冒称全部人工实看。截图只支持所列画面和交互，不证明真实应用菜单退出或安装恢复。
- 原人工采集失败不覆盖：`t10-fix2-ego-capture.log`实际1512×833且reducedMotion=false，尺寸门禁退出1；`t10-fix2-ego-capture-v2.log`第一组合后下一次导航丢失CDP注入而超时，退出1；`ego-observe`确认缺少fixture并显示默认未接通页。不是产品回归，也不把前轮文件名当860证据。v3同调用重新注入后通过，使用新图名。
- 资源：`t10-fix2-ego-finish.log`证明space42 exactly-once finish keep[]，关闭本任务p1，未接触用户space1／37；`t10-fix2-vite-stop.log`核本任务PID、cwd、命令后SIGTERM，服务日志exit143为主动停止；最终端口无监听见本轮完整性结果。Ego仅提示有更新，未升级。

S05复合行、官方账号／受控请求、三端真实桌面、隔离macOS GUI、签名更新安装重启、无token人工恢复及既有最终二进制网络故障变体仍待验。没有操作用户真实设备、账号或贡献，也没有勾选全Plan或整体验收。
