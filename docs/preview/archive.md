# Bee 开发档案

历史预览和开发记录存放在独立的 `bee-design-archive` 本地 Git 仓库，与 Bee 主仓库及 `.worktrees` 平级。它不随本仓库 PR 上传，也不随 worktree 清理删除。档案库首页 README 与 INDEX 是查找版本、来源、评审状态及维护流程的入口。

## 查找与打开

归档保留原相对路径：

- `docs/preview/history/`：静态主预览及设计历史。
- `desktop/tests/fixtures/bee-preview/history/`：React 冻结包。
- `docs/preview/overview-layout-options/history/`：概览候选历史。
- `docs/desktop/evidence/`：验收截图、日志与结论。
- `docs/superpowers/`：历史设计与实施计划。
- `.scratch/`：有参考价值的阶段记录。

在档案库根目录运行：

```sh
python3 -m http.server 15500 --bind 127.0.0.1 --directory .
```

静态主预览和草稿里的“查看旧版”链接使用上述端口。最新静态归档：
<http://127.0.0.1:15500/docs/preview/history/20261113-180820-combined-integration/index.html>

组件包必须另以选中的版本目录作为网站根目录：

```sh
python3 -m http.server 15501 --bind 127.0.0.1 --directory desktop/tests/fixtures/bee-preview/history/20261113-181800-combined-final
```

然后打开 <http://127.0.0.1:15501/tests/fixtures/bee-preview/index.html?scene=switch-first-launch>。

未取得档案库的开发者仍可运行 Bee 当前源码、主预览与测试；历史对照需要档案库和上述本地服务。文档中的其它历史相对路径可以在档案库相同路径查找，原提交 SHA 用于记录来源，不代表当前重写后的提交。

## 维护与备份

开发留在 Bee；阶段交付后，按档案库 README 保存完整快照、来源和评审状态，提交归档，再运行 `python3 tools/backup.py`。当前源码、构建／测试必需 fixture 与脚本继续随 Bee 维护。

最新完整 bundle 位于档案库旁的 `bee-design-backups/bee-design-archive-latest.bundle`；生成临时完整 bundle、验证并实际恢复核对后才替换上一份。它包含全部已提交历史，不是增量。凭据、真实设备配置及未脱敏日志不进入归档，工具缓存和可重建产物不归档。

清理 worktree 前先确认需要保留的版本已经提交并备份。本地仓库及 bundle 仍在同一台电脑，异地／磁盘故障备份需另行配置。
