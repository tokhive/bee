## Standards

- **[P2] 硬性违例：保留切换日志解析的具体失败原因。** Bee `desktop/src-tauri/src/hive_switch.rs:205` 用 `format!("switch journal JSON rejected: category={:?} line={} column={}…", …)` 替换 Serde 原错误。现有 `:3043` 删除 `commit_revision` 的用例会丢失 `missing field` 与字段名，只剩 `category=Data line=0 column=0`；缺字段、未知字段和类型错误因此无法区分。该错误沿 `HiveSwitch::from_store` → `open` → `lib.rs:190` 阻止应用启动，操作者无法从失败输出判断需修复哪项原记录。违反 `/Users/dayong/.agents/skills/fail-fast-with-evidence/SKILL.md` 原则 2、4（证据随错误输出、包装不能替换具体错误）；原则 6 明确允许缺失项名称。请保留脱敏后的具体错误，或输出安全字段路径、失败条件和要求；同时覆盖错误内容的断言。`:194` 的重复键解析包装也存在同类证据丢失。

Hive：未发现已确认的文档规范违例。两仓库未发现足以要求修改的基线 smell；没有将语言边界的协议重复、既有上游 CLI 改动或验证环境限制列为缺陷。

本次只读核对了固定差异、错误传播路径、相关测试及预览归档来源/索引；未重跑完整验证。
