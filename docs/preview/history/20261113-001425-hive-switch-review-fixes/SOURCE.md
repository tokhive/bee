# Hive 切换审查修复主预览

时间：2026-11-13 00:14:25 Asia/Shanghai。状态：待评审，当前主静态预览交付版。来源：基线 `98c5ded8e6fa73c5cb23d229ebb49f7190b326d4` 加本轮主预览同步。`index.html` SHA-256：`c9f67fcc0fc01e6e97f94ff40b4b113f21c4fd19f9308aa508b92e16857aa50f`。

修改前主预览与 `../20261112-221434-hive-switch-interface/index.html` 逐字节相同（SHA-256 `3beb283f43fb19b13fb515194fa30cec1c138a1ed2f728e2d509f27faec97458`），复用该完整基线。只增加 `switch-history-conflict`、`switch-notification-source` 两个静态场景及对应反馈；旧场景继续保留。baseline.html、before-setup.html、before-startup.html、claude-baseline.html、before-switch.html 一并冻结，产品资源内联。

```sh
python3 -m http.server 19316 --bind 127.0.0.1 --directory '<本目录绝对路径>'
```

打开 `http://127.0.0.1:19316/index.html?scene=switch-history-conflict&theme=light&size=narrow`，点击“切换 Hive”查看受影响目标被禁用的原因。旧通知使用 `?scene=switch-notification-source&theme=dark&size=narrow`；“查看 Hive 列表”不自动切换，关闭提示保留当前页。支持原有 theme/size 场景参数和冻结的修改前对照。

本版是静态交互说明，不调用真实业务。正式组件的可运行 mock 包及注入步骤见仓库 `desktop/tests/fixtures/bee-preview/history/20261113-001030-hive-switch-review-fixes/SOURCE.md`。本版已在独立 HTTP 服务用 ego-browser 验证，详见本轮证据目录。
