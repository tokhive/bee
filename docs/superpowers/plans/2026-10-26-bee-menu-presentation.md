# Bee 菜单呈现优化实施计划

> 使用 executing-plans，主代理直接执行。设计：../specs/2026-10-26-bee-menu-presentation-design.md。复用 feat/bee-management-menu 工作树，完成后更新 PR #22。

## Task 1：紧凑视图与导航

- [x] 在 agent/menu_test.go 增加连续返回回归并确认红灯，在 scripts/test-menu.py 更新真实终端导航与语言回归。
- [x] 新建 agent/menu_view.go 统一页面标题、编号、状态、辅助字段；更新 menu.go 及各动作页。保留现有 ANSI/终端降级，导航不增加业务操作。
- [x] 更新真实终端验证，确保主/子菜单 0 的区别、返回不多一次回车和即时语言切换。

## Task 2：统一错误和诊断

- [x] 增加 device_replaced、账号不可读、具体授权格式、未知错误证据的行为测试，先确认失败。
- [x] 新建 agent/menu_errors.go 按 apiFailure/codedError 翻译原因与下一步。必要时保留原因链；修正 Codex 文件和 Claude 格式校验的合并错误，保留具体证据且不输出秘密。
- [x] 接入 menu_reports.go、menu_account_setup.go、menu_service.go、menu_pairing.go、menu_accounts.go，诊断保留结构化原始错误用于菜单渲染；原有 CLI/JSON 兼容。

## Task 3：验证与交付

- [x] 运行 `make test`、ShellCheck、`git diff --check`，查看真实 PTY 中英文/配色/降级输出。
- [x] 同步使用说明，自检 spec 与实现一致，记录结果、勾选计划。
交付步骤（实现验证之后）：提交并推送现有 PR，检查 Linux CI，给出重新构建测试方法。


## 实施与验证记录

8/8 实施项完成，由主代理直接执行。新增回归先重现：连续返回吞输入、未知错误无详情区、旧设备凭证英文混排、Codex 文件校验合并错误、Claude 凭证失败条件不明确、检测失败被当作未选择、诊断误将不可读路径当作缺失。

验证结果：完整 `make test` 通过（安装器 64 项：macOS 62 通过、2 项 Linux 原生检查交由 CI；真实 PTY 10/10；Go vet 与 race 通过）。最后修正诊断路径后，再次通过全量 Go vet/race 与 `make build`。ShellCheck、两仓库 `git diff --check`、文档站 `npm run build` 通过。查看过真实中英文 PTY 的主菜单、状态页、诊断页与返回流程。

一致性自检：用户授权与不使用子代理约束、spec 内部术语、实现与计划、环境变量及降级行为、README/文档站说明均一致。原 spec 标注后续呈现设计的覆盖范围。无新增依赖，无 CI/Makefile 追加改动。
