# 桌面回归整理（2026-11-12）

本记录接续 [P0 整理报告](../2026-11-11-p0-retirement/README.md)，保留旧报告作为当时的验证记录。此次修复后，下列前端测试组分别执行通过；没有声称执行过一次完整的 `npm test`。

## 修复内容

- 恢复设备凭据失效时的重新绑定入口，以及恢复事务中的手动核对。
- OpenAI 确认弹窗固定原始账号目标，状态变化或过期时阻止写入并提示；恢复取消未注册账号接入、维护核对、来源设置故障导航及缺失翻译。
- 旧测试适配当前详情面板、来源保存、账号核对流程和轮询时序，保留禁止重复写入等安全断言。
- 安装 Playwright WebKit；默认 E2E 使用 Chromium 和 WebKit，Firefox 改为可选，CI 安装命令同步。

## 已执行验证

命令均在 `desktop/` 执行。原始日志位于 worktree 的 `.cache/commit-cleanup/`（本地忽略目录，不随提交分发）。

| 命令／组 | 结果 | 本地日志 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | `typecheck-final.log` |
| `npm run test:unit` | 333 通过 | `unit-final.log` |
| `npm run test:tooling` | 37 通过 | `tooling-final.log` |
| `npm run test:e2e`（Chromium + WebKit） | 338 通过 | `e2e-final.log` |
| `npm run test:device -- --workers=3 --output ../.cache/commit-cleanup/device-verified-results` | 前置 Node 测试通过，浏览器 366 通过 | `device-verified.log` |
| `npm run test:preview` | 99 通过 | `preview-verified.log` |
| `npm run build` | 通过，仍有现有大 chunk 提示 | `build-final.log` |

表中 E2E 和 preview 命令表示测试入口，运行时另外指定过 workers/output。366 项结果取得于最终预览范围收窄之前，其中包含随后移除的候选／历史预览测试；不能把该数量当成当前测试总数。收尾不再重跑全套或历史预览，仅检查类型、测试收集和 diff。

## 预览范围纠正

用户明确要求只测试主设计预览 `docs/preview/index.html`。已移除候选和历史设计预览检查，删除本轮新增的两份 fixture 快照，恢复测试覆盖的旧证据 PNG。已有归档不删除、不改写。后续测试截图写入已忽略目录，避免再次污染旧证据。

`test:preview` 中的 React + mock IPC 是正式应用功能回归，与历史设计预览不同，予以保留。本轮未修改主设计预览内容。

## 验证边界

以上证明前端、模拟 IPC 和浏览器回归通过，不等于真实 Tauri、系统 WKWebView、真实 Hive 或官方账号端到端验收。没有修改 Go/Rust，没有推送或部署。下一步建议在真实 Tauri 中做设备恢复与 OpenAI 接入／换号的短流程验收。
