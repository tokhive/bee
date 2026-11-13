# 任务状态用语

沿用技能的标准用语，本地任务在顶部记录 `Status`。

| 技能用语 | 本仓库记录 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 尚需确认范围或分流 |
| `needs-info` | `needs-info` | 缺少必要事实或决策，不能直接实现 |
| `ready-for-agent` | `ready-for-agent` | 定义充分；阻塞任务完成后可执行 |
| `ready-for-human` | `ready-for-human` | 明确需要人工执行 |
| `wontfix` | `wontfix` | 明确不处理 |

实施阶段另使用 `in-progress`（正在实现）、`implemented`（代码与受控自动验证完成，可供依赖使用）及 `done`（逐项验收完成）。`implemented` 不将尚未执行的真实系统或生产环境验收算作通过。09 的规则已确认，现为 `ready-for-agent`；10 仍为 `needs-info`。
