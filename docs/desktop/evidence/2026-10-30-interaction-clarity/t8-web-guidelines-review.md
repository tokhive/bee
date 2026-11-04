# T8 界面规范自审

2026-11-02 UTC；范围为本任务影响的正式 NativeApp、设置、诊断及局部样式。规则源为 `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`，本轮获取的原文保存在 `t8-web-interface-guidelines.md`。此为实施者自审，独立任务审查另行进行。

## desktop/src/features/settings/NativeSettingsPage.tsx

- `:120` — ✓ Radix 页签有分类标签及原生键盘行为。
- `:123`、`:127`、`:141`、`:146` — ✓ 控件具可点击标签；代理及 Hive 输入有 name、autocomplete、正确输入类型，允许粘贴。
- `:121`、`:130`、`:131`、`:133`、`:135` — ✓ 异步结果用 status；具体失败复用 alert 和同一提示内的安全详情。
- `:136` — ✓ 停止并应用继续使用原确认；Escape 退出恢复触发按钮，提交等待期间不重放。
- `:137`、`:138` — ✓ 已保存、生效及上次确认事实区分；长地址可换行；路径使用表格及行列标题。
- `:141`、`:146` — ✓ 通知、自启采用单一标签点击目标；期望与真实 OS 状态分列。

## desktop/src/features/diagnostics/NativeDiagnosticsPage.tsx

- `:73`、`:75`、`:93` — ✓ 恢复目标可聚焦；保留具体检查、失败证据与重新读取入口。
- `:84`、`:85` — ✓ 导出采用有标题及说明的 Radix 对话框，选项带标签；保留确认与 Escape。
- `:91`、`:92`、`:93` — ✓ 各失败独立呈现；未知和读取恢复提示使用 status。
- `:96`、`:111` — ✓ 日期、数字按 App 语言格式化；安全原文保留。
- `:106`、`:107`、`:108` — ✓ 日志筛选具标签；显式读取、空状态、游标分页保留。

## desktop/src/features/settings/native-settings.css

- ✓ focus-visible 明确；select 同时设背景与前景；长 URL、错误和路径可换行。
- ✓ 12 个尺寸/语言/主题组合无横向溢出；刷新按钮实测 32px，浅/深主题文字对比度分别为 5.7276/5.7400。

## desktop/src/features/diagnostics/native-diagnostics.css

- ✓ 检查详情、折叠标题及日志详情具可见焦点；导出面板限制滚动传播；长日志使用 content-visibility。
- ✓ 关键说明至少 12px，正文 13px，主状态 16px，按钮至少 32px；保留现有布局与响应式断点。

## desktop/src/app/NativeApp.tsx 与共享组件

- ✓ 复用原单层返回关系，显式导航聚焦真实目标；后台刷新不抢焦点或阅读位置。
- ✓ Ego 的 G02 实际后台读取前后焦点及 scrollTop 保持，prefers-reduced-motion=true；共享样式已有减少动态规则。
- ✓ 真实 Hive 身份 401 的诊断入口落设备区，返回原检查；没有执行恢复、配对、账号或运行写入。

## 适用范围说明

原生桌面采用已批准的四页及会话页签，导航按钮继续复用 NativeApp；本任务不引入 Web URL/router。草稿由同一 workspace 保留，换页不会丢弃输入，因此不另加离页确认。输入占位符保留可直接识别的 URL 样例。没有新增媒体、动画、拖动、手势或服务端渲染；这些规则不产生本次修改项。未发现本任务影响范围内尚需修复的规范问题。
