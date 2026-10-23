# Bee 银白精工视觉基线

来源：工作区 `docs/ui/bee-silver-2026-10-22/`，2026-10-22 已批准中文原型。品牌源为工作区 `logos/export/svg/app-icon-dark.svg`。复制前已按来源 manifest 逐项校验 SHA256；新路径及原哈希保存在 `reference/manifest.json`。工程只依赖此处已提交副本，不依赖个人目录。

`bee-silver.html` 与 `bee-silver-source.html` 仅用于核对，不能作为 App 的运行时实现。正式页面使用 React 重建，不加载原型宿主、iframe、CDN 或演示脚本。

## Task1 token / layout 自检

- 沿用 canvas `#f7f8fa`、side `#f2f3f5`、ink `#242830`、line `#e8eaee`、accent `#ae7615`；暗色逐项映射原型变量，使用显式 CSS 变量及系统媒体查询，不使用 `light-dark()`。
- 系统字体，正文 13px、辅助 11–12px、页标题 23px；侧栏基准 178px，工具栏 57px，内容左右留白 30px。系统窗口控件由 Tauri 提供，不复制网页仿制按钮。
- 摘要用分隔线组织，账号共用一个列表面，保留克制阴影与金色选中图标。未引入默认后台卡片布局。
- Task1 仅建立壳与数据接口；其余页面保留明确后续入口文案。英文、完整异步状态和三端 WebView 视觉验收属于后续任务，不能以此记录替代。
