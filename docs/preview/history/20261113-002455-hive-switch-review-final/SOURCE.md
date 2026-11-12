# Hive 切换审查修复主预览最终留版

时间：2026-11-13 00:24:55 Asia/Shanghai。状态：**待评审，当前主静态预览交付版**。

来源：`98ce163` 后的本轮 `docs/preview/index.html` 局部同步；生产修复提交 `d13851d`、`98ce163`。当前源码 HTML SHA-256 `742b86a1c7da761d6547872b5ef032325b8675c7693b0be71f410ee76240de34`，归档 HTML SHA-256 `4ecb3ccb69548308c79cb8596c41772a3c965f9627e7c3d690d86518f10814a0`。归档仅将 `location.pathname.includes('/history/')` 固定为 true，使旧版对照使用一并冻结的文件。

修改前主预览逐字节等于 `../20261112-221434-hive-switch-interface/index.html`（SHA-256 `3beb283f43fb19b13fb515194fa30cec1c138a1ed2f728e2d509f27faec97458`），复用该完整基线。本版保留全部原场景及 baseline.html、before-setup.html、before-startup.html、claude-baseline.html、before-switch.html；产品资源内联。

```sh
python3 -m http.server 19317 --bind 127.0.0.1 --directory '<本目录绝对路径>'
```

打开 `http://127.0.0.1:19317/index.html?scene=switch-history-conflict&theme=light&size=narrow` 或 `?scene=switch-notification-source&theme=dark&size=narrow`。受影响冲突目标禁用，旧通知保留原 Hive；查看列表不自动切换。保留原有 scene/theme/size。

001934 版已独立 HTTP/ego-browser 验证两个场景、列表／关闭提示及冻结对照 HTTP 200。最终截图发现其“旧 A 通知／当前 B”场景设备区是 B、侧栏仍用原固定 A；本版将两平台概览侧栏地址随当前 Hive 同步，随后原有 main-preview 定点浏览器测试 1/1 通过。按主任务停止额外验证要求，没有再次启动人工浏览器检查这一行数据修正；此前关键交互／独立对照证据与该差异在本轮证据 README 明确记录。未将此前截图冒称本版逐字节截图。

本版是静态模拟。正式 React mock 的独立交付版仍为仓库 `desktop/tests/fixtures/bee-preview/history/20261113-001030-hive-switch-review-fixes/`，已完成独立运行和本轮反馈人工验证。
