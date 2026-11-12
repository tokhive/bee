# Hive 切换验收修复预览

时间：2026-11-12 23:28:50 Asia/Shanghai。来源：`codex/bee-hive-switch-09` 的 `4a1c2fce1ad32407617c22f36f805fa001b182b6`，本轮 UI 修复提交 `9a254fb`。评审状态：待评审。

修改前完整基线：`../20261112-222601-hive-switch-final/`。本版修复目标首次配对地址预填并只读、保留设备名、初次配对完成反馈及英文切换文案；旧快照原样保留。

完整 Vite e2e 构建，显式 `VITE_BEE_DATA_MODE=native`、`import.meta.env.DEV=true`、`target=esnext`；使用独立构建配置，包含正式 React、HTML、JS、CSS、图标和全部 mock。该版本仅用于现代浏览器评审，不连接真实 Hive、不启动原生进程、不接触真实账号。初次沿用当前 Vite 配置合并 target 时出现构建参数重复，未生成有效产物；随后独立配置的完整构建成功。

以本目录作为 HTTP 根目录：

```sh
python3 -m http.server 19309 --bind 127.0.0.1 --directory '/absolute/path/to/20261112-232850-hive-switch-acceptance-fixes'
```

打开 `/tests/fixtures/bee-preview/index.html?scene=switch-target-pairing&theme=light&size=narrow`；暗色列表使用 `?scene=switch-saved&theme=dark&size=narrow`。支持原有 scene/theme/size 参数。

已用 ego-browser 在独立 HTTP 服务中检查：目标 `https://target-hive.example` 精确预填且 readOnly，设备名输入后可生成目标配对码；暗色窄窗口列表可打开，Escape 关闭后焦点回到入口，再打开时 Hive/设备名均保留。跨 iframe 文本等待曾超时，随后页面快照确认已进入真实 mock 的“等待网页确认”，没有重复提交。截图位于 `docs/desktop/evidence/2026-11-12-hive-switch-acceptance/`，浏览器 TaskSpace 已完成关闭。此前正式预览切换回归 10/10 通过。
