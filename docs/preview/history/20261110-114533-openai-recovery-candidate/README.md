# OpenAI 恢复候选快照

本目录为单文件完整 HTML（图标内嵌，无 CSS/JS 外部依赖）。index.html 为本轮未修改的认可基线。draft.html 为 Git HEAD 的旧对照稿，不含其他会话未提交修改。

从仓库根目录运行 `python3 -m http.server 1497 --directory docs/preview`，打开 `/history/本目录名/对应文件名`。候选入口 `?scene=candidate-retries&theme=dark&size=narrow`；可选 candidate-intake-limit、candidate-change-limit、candidate-pause-limit、candidate-resume-limit、candidate-ownership，浅深色及 narrow/wide。

候选尚未认可。查询演示只返回“仍未确认”，不模拟未知业务成功；归属缺失不能凭演示解除。真正的 Hive 原操作协议及本机安全重登仍未实现，不属于验收证据。
