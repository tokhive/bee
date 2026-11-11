# P0 工作区迁移与退役记录

日期：2026-11-11。P0 分支 `feat/bee-desktop-p0`，HEAD `48dce01073ff78f7e5a2000f8f6feb37dafac4c3`；UI 比较基线 `c04ad482595f63f147e64807806119fae6f09aab`。

## 迁移结论

P0 所有已提交历史均为 UI 的祖先，无独有提交。剩余 15 个 tracked 修改和 136 个 untracked 文件不能直接丢弃，按以下方式处理：

- 迁入统一 npm test、test:unit、test:preview，以及四份 CI 调用与证据上传配置。
- 迁入 Playwright 分组和自定义端口适配；补充 UI 后来新增的 native-auto-service、OpenAI 完成流程和 compact 账户测试到正式页面测试组，避免普通 demo 模式错误收集。
- 恢复隔离历史 demo 的收益导航，仅 `demo && !deviceMode` 使用；正式桌面仍只有概览、账号、诊断、设置。
- 迁入深色主题 `#242421` 断言；保留 UI 的重试文案定位，并补回时间戳断言。
- 保留 UI 现有 OpenAI 回归，追加 P0 的 Claude 登录／取消、共享读等待、回执 revision 及设备拒绝约束共 9 项。接入按钮定位适配当前 UI 文案，保留禁止业务写入的断言。
- 预览 fixture 的 HTTP 503 结构化证据已被 UI 等效覆盖，不再复制旧实现。
- 历史 mock 审计报告归档到 `../2026-11-04-mock-interface-audit/README.md`，标明历史语境；132 个 `.scratch` 文件和 3 份旧 agent 流程文档保存在完整备份中。旧 GitHub tracker 规则不覆盖 UI 当前本地任务规则。

## 备份与恢复

完整本地备份：`/Users/dayong/myspace/mywork/tokenhive-backups/20261111-p0/`。

保留全部工作区内容（包括 ignored 缓存与构建产物），使用 APFS 文件克隆复制；这保证可恢复，不宣称释放全部物理磁盘占用。已核对 241237 个文件的路径、大小与符号链接；4471 个 tracked/untracked 源码文件的 SHA-256 一致。另保存 `p0-history.bundle`、`uncommitted.patch`、`status.txt` 和 `source-sha256.json`。本地分支保留，不推送。

恢复说明见备份目录的 `RESTORE.md`。该目录在仓库之外，不将本地配置、缓存或其他潜在敏感资料提交到 Git。

## 验证结果与未解决项

- 类型检查与生产前端构建通过（保留既有大 chunk 提示）。
- 统一入口先通过 333 项 TS 单测、37 项工具测试。
- 普通 Chromium E2E：169 项通过，覆盖迁入的 demo 导航、收益自定义端口、主题及键盘交互。
- Claude 专项：9 项通过；test:device 前置 Node 测试通过。
- 自动恢复时间戳／只读查询专项：1 项通过。
- Ego 浏览器确认隔离 demo 的收益导航可打开；没有修改正式桌面导航。
- 差异空白检查通过。

**全套尚未全绿，不能把本次退役理解为全产品验收通过。**

本机未安装 Firefox/WebKit；下载未完成，跨浏览器全套的 338 个启动失败来自缺少对应浏览器。停止下载，未修改 CI 的三浏览器要求。

正式页面全套探索运行记录到 81 passed、15 failed、2 interrupted、259 did not run；预览全套记录到 16 passed、5 failed、2 interrupted、76 did not run，发现多项旧测试定位或操作假设与当前 UI 不符后停止广泛运行。未删除用例、放宽断言或把失败转为跳过。其中 account-auto-read 首项仍查找旧来源编辑入口，已在迁移前 UI 提交 c04ad48 的隔离副本复现同一失败；其余失败尚未逐项诊断，不能全部认定为同一原因。需另行完成这些旧套件与当前界面的逐项核对。

各日志摘要及失败用例名见 `verification.txt`。完整运行日志同时保存在 UI 的 `.cache/commit-cleanup/` 与仓库外备份的 `migration-validation/`。

本轮不改变 Go/Rust 协议、真实账号或 Hive；不打包发布。另一个会话修改的 NativeApp.tsx 与 native-experience.spec.ts 不纳入本轮提交。
