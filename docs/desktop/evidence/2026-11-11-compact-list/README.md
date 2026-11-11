# 紧凑列表桌面实现验证（2026-11-11）

## 认可基线与范围

- 主预览：`../../../preview/index.html`。
- 冻结版：`../../../preview/history/20261111-112027-approved-compact-list/index.html`；目录内 baseline.html 保留此前认可概览与对比基线。
- 设计：`../../accounts-preview-design.md` 的“紧凑账号列表与错误证据”章节。
- 桌面实现：账号、状态、额度、操作四列；窄窗口重排。OpenAI 状态后 ⓘ 展示只读错误浮层，错误更新或清除时关闭旧内容；额度保持真实数值、历史标识、未知占位及重置时间。保留现有流程与暂停选择。
- 修复满额进度条无颜色问题。换号确认框由 Radix 管理挂载，Esc 阻止同一事件继续传播给下层弹层，保留核对面板及返回焦点。

## 验证结果

- HTML：55 个失败场景 × 深浅色 × 宽窄窗口，220 次检查通过，无页面脚本异常；概览额度与布局保留。
- `npm --prefix desktop run typecheck`：通过。
- `BEE_TEST_BROWSER_CHANNEL=chrome ./desktop/node_modules/.bin/playwright test --config desktop/playwright.openai.config.ts`：13/13 通过，包括接入完成、草稿保存、登录查询重试耗尽、原操作核对、独立错误与暂停、深浅宽窄布局、钥匙串缺失、换号与焦点恢复、主预览及新冻结版。
- `./desktop/node_modules/.bin/playwright test --config desktop/playwright.compact.config.ts`：5/5 通过，包括 1080/820/600 宽度、Esc/外部点击/关闭、未知与耗尽额度、错误更新清除、无横向溢出、查看错误零业务写。
- 换号确认 Esc 焦点回归额外连续运行 3 次通过。
- `git diff --check`：通过。
- 实际 React 截图：`native-1080.png`、`native-820.png`、`native-600.png`；深色浮层：`native-error-1080-dark.png`、`native-error-820-dark.png`、`native-error-600-dark.png`。
- 本轮测试截图均保存到本目录，不覆盖旧证据截图或旧冻结预览。

## 验证边界

浏览器使用系统 Chrome 与受控 Tauri 回执，不调用真实账号登录、Hive 注册、接单或暂停写入。HTML 验证与 React 交互验证通过不代表真实业务或 macOS WebView 端到端验收完成。

此工作树有其他会话并行修改启动恢复等模块。应用包包含打包时整个工作树的状态，不能将这些并行改动归为本轮 UI 修改。本轮未提交或合并代码。

## 构建

构建命令：`make app`。结果与包校验见下方完成记录。

完成记录：`make app` 退出码 0；生成 `desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app`（77.16 MiB）。`codesign --verify --deep --strict --verbose=2` 通过，主程序和 Bee sidecar 均通过校验。Info.plist：Bee S1 Dev 0.1.0、dev.tokhive.bee、最低 macOS 13.0。本地 ad-hoc 签名，未公证；未启动应用进行真实登录。

主程序 SHA-256：`95f298d8a13470e1a4776f739155b8d4f6c9b7f1ebfdc5d6d69ce12301ad9b14`。

构建日志：工作树内 `.cache/compact-list-implementation/build.log`；测试日志为同目录的 `regression-final.log`、`native-final.log`、`preview-check.log`。这些缓存日志用于本机追溯，本目录截图及说明作为持久证据。
