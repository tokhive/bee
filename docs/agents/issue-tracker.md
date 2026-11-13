# 任务跟踪器：本地 Markdown

2026-11-05，用户在本会话明确选择本地 Markdown，每张任务独立保存。

- 每个主题使用 `.scratch/<feature-slug>/`。
- 每张任务使用 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，依赖项编号在前，一票一文件。
- 每张任务必须说明用户可见交付、验收条件、阻塞任务及状态。
- `Blocked by` 记录真正阻塞实现的任务编号与标题；外部决策前置单独说明。
- 状态用语见 [triage-labels.md](triage-labels.md)。`ready-for-agent` 表示内容具备实现条件，实际开始仍须检查阻塞任务是否完成。
- 主题索引记录依赖关系、当前可开始项及已知待决事项。索引不替代逐票正文。
- 用户选择本地发布，不代表授权创建远程 issue、修改父 issue 或开始实现票据。

当前发布主题为 `bee-native-interface`。已有 `bee-account-auto-service` 是前端 mock 阶段的本地记录，保持独立。
