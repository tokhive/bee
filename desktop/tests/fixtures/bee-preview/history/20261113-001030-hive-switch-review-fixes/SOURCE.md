# Hive 切换审查修复预览

时间：2026-11-13 00:10:30 Asia/Shanghai。状态：**待评审，当前正式组件交付版**。基线 `98c5ded8e6fa73c5cb23d229ebb49f7190b326d4`，来源分支 `codex/bee-hive-switch-review-fixes` 的本轮本地改动。`SOURCE.patch` 保存本轮 Rust、React 与受影响测试差异（不含文档／主静态预览），SHA-256：`42b151fe9a284dad9e8da56f780b09a8f3429e92b7eecc08db9042000a70d1a1`。

修改前有效完整基线：`../20261112-232850-hive-switch-acceptance-fixes/`。本轮第一次构建漏 iframe HTML，已保留为 `../20261113-000807-hive-switch-review-fixes/` 并标记未通过；本版包含 iframe 及全部依赖。

## 构建与运行

在 desktop 使用 Node 24.22.1、Vite 8.2.4、现有 React 插件，以独立配置 `configFile:false`、`mode:e2e` 构建。固定 `import.meta.env.DEV=true`、`VITE_BEE_DATA_MODE=native`、`target:esnext`；入口为 `index.html`、`tests/fixtures/bee-preview/index.html`、`tests/fixtures/bee-preview/app.html`。`__BEE_BUILD_PLATFORM__` 设为构建机 `darwin/arm64`。冻结 HTML、JavaScript、CSS、SVG 及 mock；本版用于现代浏览器，不连接真实 Hive 或启动原生进程。

```sh
python3 -m http.server 19314 --bind 127.0.0.1 --directory '<本目录绝对路径>'
```

打开 `http://127.0.0.1:19314/tests/fixtures/bee-preview/index.html?scene=switch-success&theme=dark&size=narrow`。支持原有 scene/theme/size 参数。

## 复现本轮反馈

在上述页面的浏览器控制台注入旧 A 通知：

```js
const w=document.querySelector('iframe').contentWindow;
w.emitNotification({target:{page:'accounts',source:{profile_id:'1'.repeat(32),origin:'https://hive.example'}},current_profile:'2'.repeat(32),can_navigate:false});
```

应停留当前页面并说明来源；“查看 Hive 列表”只打开列表。可通过 `w.calls.filter(c=>c.command==='hive_switch_start')` 确认没有发起切换。来源与当前 profile 相同且 native `can_navigate:true` 才能进入对应账号页。旧版全局设置／诊断路由继续可用。

历史冲突：打开 `?scene=switch-saved&theme=light&size=narrow`（可换 dark），在控制台注入已投影的真实 DTO 并等候下一轮读取，再打开列表：

```js
const w=document.querySelector('iframe').contentWindow,original=w.__TAURI_INTERNALS__.invoke;
w.__TAURI_INTERNALS__.invoke=async(command,args)=>{const result=await original(command,args);if(command==='hive_switch_snapshot')result.profiles.profiles[1].blockers=['historical_origin_conflict:https://target-hive.example'];return result;};
```

受影响目标显示中文解释并禁用；当前 A 仍可用，界面不显示内部 blocker 标记。窄窗口列表可滚动查看完整提示。

已在独立 HTTP 服务用 ego-browser 检查深色旧通知、只开列表不切换、Escape 焦点、关闭提示、明暗冲突；截图及测试边界见仓库 `docs/desktop/evidence/2026-11-13-hive-switch-review-fixes/README.md`。完整切换浏览器回归 12/12、受影响 Node 测试 14/14、typecheck 通过。静态主预览另见 `docs/preview/history/20261113-001425-hive-switch-review-fixes/`。
