## Standards 定点复核

复核基线 `98c5ded8`，修复源 `fb26377e`；最终集成 `822b43fa` 与修复源的 tree 均为 `03080923f76dc2a90badc4113e41809598c12514`。

**原 P2 已解决。** `desktop/src-tauri/src/hive_switch.rs:194`、`:206` 的两层 JSON 包装现在调用安全的 `journal_schema_reason`，保留具体失败条件及预期类型。`startup_recovery.rs:23` 保留固定 schema 字段名，脱敏未知名称和被引号包裹的值。新增断言覆盖缺少 `commit_revision`、错误类型、未知字段、重复字段、秘密不回显和原文件不变；现有 `rust-affected.log:22` 记录该用例通过。符合 `fail-fast-with-evidence` 原则 2、4、6。

**未发现本轮新增的确认规范问题或需修改的基线 smell。** 通知来源在采样、ledger、正文、平台点击和前端校验中传递；前端复用共享 `normalizeHiveOrigin`，实际当前索引读取失败保留具体诊断并阻止跨 Hive 导航。冲突提示使用用户可理解的文案并保留明确下一步。

预览归档符合 Bee `AGENTS.md` 的历史规范：旧快照未改写；当前正式包与主静态包、来源、状态、启动方法及中间失败版限制均有索引。只读校验确认 `SOURCE.patch` 等于已提交的对应源码差异，摘要与证据 manifest 全部一致；正式 HTML 本地引用无缺失，最终主静态归档仅固定历史对照分支。原始日志／补丁空白例外及最终静态版的人工验证边界已明确记录。

仅复核本轮差异与已有证据，未重复运行测试或完整分支审查。
