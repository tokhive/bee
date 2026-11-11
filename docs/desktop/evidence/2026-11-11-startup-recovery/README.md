# Bee 启动恢复实施与验收记录

日期：2026-11-11（Asia/Shanghai）。用户已授权实施，并确认在 Hive 独立分支集成与隔离联调。保留 Bee 共享 worktree 其他会话改动；Hive 主工作区与真实账号未修改。

## 当前交付结论

已实现 Bee 旧会话安全结束、Hive 旧代请求隔离与持久证明配套补丁、原生恢复协调和紧凑恢复入口。旧记录、未知结果、暂停选择均保留。macOS ad-hoc 开发包已重建并验证签名，约 77.31 MiB：

`desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app`

**Hive 已在独立分支集成，未部署，真实账号未恢复。** 仅换 App 不能证明解除当前阻塞：旧 Hive 返回 404 时明确要求先升级 Hive；任务未排空时保留原恢复 ID，可继续恢复。新增真实 Rust → Go sidecar → Hive HTTP → PostgreSQL 的五场景隔离验收通过，见[联调摘要](native-hive-integration.txt)。打包原生窗口、真实账号与其他平台验收仍未完成，完整发布门槛尚未通过。当前开发包沿用前轮产物；本轮 Bee 只新增测试与文档，未重建或启动真实 App。

交付入口：[主预览](../../../preview/index.html?scene=startup-draining)、[历史索引](../../../preview/history/README.md)、[Hive 配套补丁与部署说明](../../integrations/hive-session-retirement/README.md)、[补充设计](../../designs/2026-11-11-session-retirement.md)。首阶段实现及原始证据保留在[历史验收记录](initial-phase.md)。

## 最终行为

| 场景 | 行为 |
| --- | --- |
| 旧会话仍 active／非 clean | 本机独占锁和生命周期锁下确认当前 worker、写操作、登录维护已结束；先保存原结束请求，再核对 Hive 同 ID |
| 旧写已准入 | Hive 等待旧 HTTP 写返回，持久化新 epoch／pending，关闭并 join 原连接；调度排除 pending 设备 |
| 旧请求迟到或 Hive 重启 | 旧 epoch／无 epoch 写拒绝；原恢复 ID、请求和阶段在数据库保留 |
| 未结束任务或上游终止未知 | 返回 draining，不结束原准备保护，不启动贡献；页面提供继续原恢复 |
| 原准备、指纹或归属冲突 | 保留原保护，拒绝签发证明；具体 HTTP／错误码留在详情，页面只提供诊断 |
| 完整远端结束证明 | 先持久保存 proof，再保存 epoch、结束旧本地 scope、写 clean guard、完成记录，随后走普通 Restore 再核验 |
| 本地部分保存中断 | 未完成记录阻塞 Restore；沿用同 ID／proof 继续，四个中断阶段不再远端写 |
| 恢复回执未知 | Go 查询同一 Hive 操作；Rust 保留原 operation 的未知事实。同设备持久绑定与真实证明吻合后仅将旧会话记 retired，新尝试关联并归档前次 |
| 历史未知记录缺少绑定摘要 | 继续阻塞；不能以两个实例恰好相同的 revision 推断为同一设备 |
| 原意图停止／新停止／退出或升级 | 不越过现有准入和写屏障；结束旧会话不等于启动贡献 |
| Hive 尚不支持 | 明确需升级 Hive，保留诊断，隐藏无效“核对结果”；不让用户反复改凭证或重启试错 |
| 恢复后 | 继续正常账号读取，清除启动阻塞；不直接调用前端 runtime_start，不解除暂停 |

Go 新文件：`desktop_recovery_inspection.go`、`desktop_session_retirement.go`；共享协议：`beewire/runtime_recovery.go`；桥接：`desktopbridge/server.go`。Rust 使用 `startup_recovery.rs`、`update_install.rs`、`experience.rs` 与 `sidecar.rs`；前端沿用 `StartupRecoveryNotice.tsx` 和 `NativeApp.tsx`。

## 验证证据

日志保存在当前 worktree `.cache/startup-stall/`；以下为实际结果，未把依赖缺失当作行为回归。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Go 完整竞态 `go test -race ./agent ./desktopbridge ./beewire` | agent 155.554s、bridge 2.661s、beewire 1.513s 通过；后续局部校验／绑定／错误码补强另有最终风险回归 | [retirement-go-full.log](../../../../.cache/startup-stall/retirement-go-full.log) |
| Go 最终恢复风险 | 通过：完整／未决／不支持／缺失或错误证明、epoch／原请求不符、未决账号、guard 不符、损坏记录、准备冲突证据；四阶段部分保存后继续同 proof | [retirement-go-final.log](../../../../.cache/startup-stall/retirement-go-final.log) |
| Go bridge 协议边界 | capability 顺序、空参数、拒绝额外字段、保留原排空原因且不启动运行通过 | [retirement-bridge-final.log](../../../../.cache/startup-stall/retirement-bridge-final.log) |
| Go 静态检查 `go vet ./...` | 通过 | [retirement-vet.log](../../../../.cache/startup-stall/retirement-vet.log) |
| Rust 完整库与合约 | 303 单测通过、4 ignored；76 独立合约通过。修正原既有测试对并行响应顺序的假设，用有界等待核对原请求 permit 回收 | [retirement-rust-complete.log](../../../../.cache/startup-stall/retirement-rust-complete.log) |
| Rust 最终 query 风险 | 原检查仍阻塞时，查询保留继续原 retirement 的资格；不调用 Restore，通过 | [retirement-query-final.log](../../../../.cache/startup-stall/retirement-query-final.log) |
| TS 状态与命令 | 10 项通过；类型检查通过，最终正式前端 build 通过 | [retirement-node.log](../../../../.cache/startup-stall/retirement-node.log)、[retirement-typecheck.log](../../../../.cache/startup-stall/retirement-typecheck.log) |
| 界面全组 | 73 项通过：生产 React、模拟 IPC、系统 Chrome；启动阶段、60 秒停止读取、失败核对、诊断与继续恢复 | [retirement-ui-final.log](../../../../.cache/startup-stall/retirement-ui-final.log) |
| 最终受影响界面 | 7 项通过，包括新增 409 冲突保留具体原因、无效入口隐藏及恢复后继续账号读取 | [retirement-ui-focused.log](../../../../.cache/startup-stall/retirement-ui-focused.log) |
| Hive 请求 gate 与编译 | service／controller／router 通过 | [hive-gate.log](../../../../.cache/startup-stall/hive-gate.log) |
| Hive 真实 PostgreSQL／HTTP | 4 项集成通过，3.873s：旧写排空、旧 WS 关闭、原暂停保持、旧代拒绝、原 ID 及参数保护、Market 重建、执行未决／终止未知、准备指纹冲突保护 | [hive-retirement-integration-final.log](../../../../.cache/startup-stall/hive-retirement-integration-final.log) |
| Hive 独立分支集成 | `fix/runtime-session-retirement` 实际应用；Bee gitlink 引用 `328270e79c5ba040f8537eab56010c0286f3ed8b`，原补丁十文件哈希匹配；新增跨进程 harness 同步补丁 | [补丁与逐文件哈希](../../integrations/hive-session-retirement/source-manifest.json) |
| 新协议完整跨进程隔离联调 | 五个原生场景加四个 Hive HTTP／DB 测试通过，31.395s；零暂停写、旧代 409、未知证据保留与同 ID 继续 | [可归档证据](native-hive-integration.txt)、[完整日志](../../../../.cache/runtime-retirement-integration/hive-native.log) |
| App 构建与签名 | 正式前端／原生 debug 构建和 ad-hoc 签名通过，未启动 App | [retirement-app-final.log](../../../../.cache/startup-stall/retirement-app-final.log)、[签名与哈希](retirement-build-verification.txt) |

最初 Playwright 全组没有运行到页面，因为本机缺少其浏览器二进制；改用既有系统 Chrome 配置后通过。Hive 最初隔离副本缺依赖的失败不是有效行为红测试。客户端最初缺 ReconcileRecovery 的编译失败、准备冲突错误码丢失的实际回归均保留日志；不宣称每个分支都具备先红后绿证明。

## 页面与预览检查

使用 ego-browser 验证生产 React 的 Hive 不支持、诊断入口、排空继续恢复和恢复后账号读取，均为模拟 IPC；未调用真实 Hive。主预览新增两个分支，共 462 个入口；原有场景保留。修改前完整归档，交付版与依赖冻结，历史页独立打开并验证继续恢复入口。截图：[不支持](retirement-app-unsupported-desktop.png)、[排空中](retirement-app-draining-desktop.png)、[恢复后](retirement-app-restored-desktop.png)、[冻结历史](retirement-history-draining.png)。截图为桌面浏览器，不代表原生 App 窗口。

按最新 Web Interface Guidelines 核对本轮状态区：原生 button／details、单层详情、焦点恢复、单一主 alert、异步反馈、长证据换行、主题与紧凑布局。未发现本轮范围内未解决项；账号其他状态的设计由共享 worktree 其他任务维护。

## 部署与验收边界

1. Hive 主工作区与真实数据库均未修改。共享协议、Hive 和迁移已在独立分支集成；分支未推送。先发布共享协议提交，确保 Hive 的子模块引用可获取，再按现有发布流程部署并验证真实恢复；不能用仅替换 App 代替。
2. 同一设备的连接和调度必须由单个 Market 进程拥有。当前实现不提供多个 Market 同时拥有一台设备时的分布式排空保证。
3. Bee 配置新增 `runtime_epoch`，旧 Bee 严格解码不兼容；已有 epoch 后不可回滚到不实施隔离的旧 Hive。不要删除字段／guard 绕过保护。
4. 新结束协议已串联真实 Rust 协调／journal、生产 Go 管理 transport／runtime、实际 Hive HTTP 与 PostgreSQL，覆盖五场景；官方登录／额度为合成边界，未把模拟 IPC 页面或打包窗口混称真实原生窗口验收。draining 执行及终止事实由测试直接设置，子进程 SIGKILL 与提交后断连为实际故障注入。
5. 打包原生窗口、Windows／Linux、正式签名／公证与干净安装未验收；真实账号保持原状态，最初遗留脏保护的诱因仍待查明。
6. 本轮专用测试容器已停止，预览服务已关闭，浏览器任务已结束；不碰其他会话的服务和容器。

## 一致性检查

- ✅ 对话：实施授权、紧凑布局、暂停保持、真实恢复边界与此前决定一致；无被否定方案回流，未覆盖其他会话改动。
- ✅ 纵向：补充设计、原规格和本报告对 proof／clean／retired／unknown 的含义一致，首阶段报告明确作为历史保存。
- ✅ 横向：实现对应补充设计；Hive 独立分支与共享 wire 本地提交可审阅，Bee 共享 dirty 改动未整体提交；协议、调用者、Hive 路由／SQL 和前端分支一致。
- ✅ 配置：私有文件路径、`runtime_epoch`、数据库迁移、工具链与补丁基线明确；未引入新的运行环境变量或服务。
- ✅ 文档：README、桥接协议、场景、主预览与测试结果按实际行为同步。
- ❌ 环境：真实部署、真实账号、打包原生窗口和其他平台验收未完成，已明确记录；新协议完整跨进程隔离验收已闭合。

结论：实现与分层受控验证可交付；上述已知验收缺口仍在，不能宣称真实故障已解除。

## 后续提交整理

本报告上文保留各轮实施证据。共享工作区整理时发现实际启动入口尚有提前返回，底层联调通过不能覆盖该入口。现已补真实入口回归并修复；另修复自动查询预算的界面反馈、旧后台能力入口、诊断错误码跨语言白名单与原生验收示例编译。最新验证及提交边界见[整理报告](../2026-11-11-worktree-cleanup/README.md)，不以先前 App 包代表本轮修复。
