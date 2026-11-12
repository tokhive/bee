# Hive 切换审查修复主预览独立交付版

时间：2026-11-13 00:19:34 Asia/Shanghai；状态：**待评审，当前主静态预览交付版**。

来源基线 `98c5ded8e6fa73c5cb23d229ebb49f7190b326d4` 加本轮 `docs/preview/index.html` 局部同步，当前源码 HTML SHA-256 `c9f67fcc0fc01e6e97f94ff40b4b113f21c4fd19f9308aa508b92e16857aa50f`。归档将 `location.pathname.includes('/history/')` 的分支固定为归档模式，让所有对照入口使用随包保存的文件；归档 `index.html` SHA-256 `696fdfb32cfe9794650a129d8f4456f4a640cfb807354891b929024236de92aa`。

修改前主预览与 `../20261112-221434-hive-switch-interface/index.html` 逐字节一致，SHA-256 `3beb283f43fb19b13fb515194fa30cec1c138a1ed2f728e2d509f27faec97458`，复用该完整基线。此前本轮 `../20261113-001425-hive-switch-review-fixes/` 场景可用但独立对照依赖源码路径，原样保留并追加 LIMITATION.md。本版冻结 baseline.html、before-setup.html、before-startup.html、claude-baseline.html、before-switch.html，产品资源全部内联。

```sh
python3 -m http.server 19317 --bind 127.0.0.1 --directory '<本目录绝对路径>'
```

- 历史冲突：`http://127.0.0.1:19317/index.html?scene=switch-history-conflict&theme=light&size=narrow`，打开列表，受影响目标被禁用并说明原记录保留。
- 旧通知：`http://127.0.0.1:19317/index.html?scene=switch-notification-source&theme=dark&size=narrow`，当前 B 的设备区保留来源 A 的通知；查看列表只打开选择，关闭提示保留当前页。

保留已有 scene/theme/size 参数和正常布局。本版为静态模拟；正式 React mock 包位于仓库 `desktop/tests/fixtures/bee-preview/history/20261113-001030-hive-switch-review-fixes/`。已通过独立 HTTP/ego-browser 场景检查及本地对照链接 HTTP 200 验证；截图与完整边界见仓库 `docs/desktop/evidence/2026-11-13-hive-switch-review-fixes/README.md`。
