# 账户页 HTML 预览历史

> 维护入口已统一为 [Bee App 主预览](../../../../preview/index.html)。本目录的 HTML 保留为历史参考，不再作为主入口。三场景版本已认可并纳入主预览；其他历史方案不因此视为认可。

[旧工作预览](../accounts-preview.html)仅保留供回看；以下目录为固定快照。后续留版遵守`bee/AGENTS.md` 的“HTML 预览历史”规则。

| 版本时间（Asia/Shanghai，UTC+08:00） | 内容 | 来源 | 评审状态 | 固定 HTML |
| --- | --- | --- | --- | --- |
| 2026-11-05 15:06:44 | 轻量步骤线与独立操作按钮；沿用自动运行流程 | 当前工作预览的完整副本 | 待评审 | [打开此版本](20261105-150644-compact-steps/accounts-preview.html) |
| 2026-11-05 17:00:52 | 三场景步骤对比；页面操作自动承接预设结果，完成后隐藏步骤 | 用户确认步骤原则后的独立候选；复用原账号页布局 | 已认可，已纳入主预览 | [打开此版本](20261105-170052-three-account-flows/accounts-steps-prototype.html) |

本轮聚焦三个场景的[已归档三场景预览](../accounts-steps-prototype.html)：首次接入、故障恢复、可接单。三场景呈现已认可并纳入主预览；完整旧场景预览仅供历史回看。

三场景候选和快照均为单文件、无外部依赖；支持 `scene=onboarding|recovery|ready`、`theme=light|dark`、`size=narrow|wide`。本目录上一级运行 `python3 -m http.server 1487 --bind 127.0.0.1`，然后访问 `http://127.0.0.1:1487/accounts-steps-prototype.html`，固定版本为 `http://127.0.0.1:1487/history/20261105-170052-three-account-flows/accounts-steps-prototype.html`。

## 打开与试用

在本索引所在的 `history` 目录执行：

```sh
python3 -m http.server 1488 --bind 127.0.0.1
```

然后打开 `http://127.0.0.1:1488/20261105-150644-compact-steps/accounts-preview.html?scene=error&theme=light&size=narrow`。预览已内联 CSS、JavaScript 和应用图标；原界面标注图片也已复制到版本目录。场景、主题和窗口尺寸可通过页面控件切换，交互只改变本页模拟数据，不需要正式 mock 或外部服务。

当前 1487 服务运行时，也可打开 `http://127.0.0.1:1487/history/20261105-150644-compact-steps/accounts-preview.html?scene=error&theme=light&size=narrow`。

## 更早版本

本索引从本次归档起保留完整 HTML。此前的 `html-task-*`、`html-clickable-steps-*` 等截图仍保留在上级目录；其中未单独保存完整 HTML 的版本不能仅凭截图还原为原始快照。

## 三场景候选验证记录

2026-11-05，已在浏览器打开当前候选及 `20261105-170052-three-account-flows` 固定版。核对首次登录、接入确认、自动准备、手动恢复；授权过期恢复、自动核验、暂停保留；普通暂停无步骤；场景切换取消旧任务；主题切换保留状态和详情展开；重置保留窗口尺寸；确认弹层 Escape 关闭。三种初始页面已截图复核。以上仅为 HTML 模拟交互验证，视觉待用户确认。

截图：[首次接入](../steps-onboarding.png)、[故障恢复](../steps-recovery.png)、[可接单](../steps-ready.png)。
