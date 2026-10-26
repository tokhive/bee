# Bee 自动选择启动方式实施计划

> 使用 executing-plans，由主代理直接执行，不使用子代理。

**目标：** 按用户最新要求，取消启动方式菜单，只询问是否引导补齐配置，依据实际服务支持自动后台或前台启动。

**架构与技术栈：** 沿用 Go 1.27.3、数字菜单、双语 ANSI 呈现、现有 managedService 与 systemd 243+；沿用 Go test 和 Python PTY，不新增依赖。普通启动固定使用设备文件旁的 egress.json；高级选项保留直接前台运行及自定义供给路径。

## Task 1：自动启动流程与能力判断

涉及 agent/menu_start.go、agent/managed_service.go、agent/menu_options.go 及对应测试。

- [x] 添加行为测试：一次配置选择后自动启动服务；macOS、缺失 unit、缺少 systemctl、非 systemd Linux 自动前台；已经运行不重复操作；真实检查失败不得降级；取消不启动；引导取消、默认路径恢复与前台锁保持。
- [x] 运行 `go test ./agent -run 'TestMenu(Start|Guided)|TestManaged.*(Unavailable|Missing|Init)' -count=1`，确认新行为断言失败。
- [x] 实现自动运行选择，移除重复的启动确认，保留配对和账号保存确认；高级选项保留显式前台运行。
- [x] 运行相关 Go 测试，确认通过。

## Task 2：真实终端流程与文档同步

涉及 scripts/test-menu.py、agent/menu_help.go、agent/menu_errors.go、agent/menu_pairing.go、README.md、设计 spec、doc-site/docs/provider/install.mdx。

- [x] 更新真实 PTY 的启动输入；验证引导、复用配置、取消、前台连接与 Ctrl+C 退出，高级前台仍可操作。
- [x] 同步中英文提示、README、spec 与站点文档，删除旧的启动方式选择说明。
- [x] 运行 `make test`、`make build` 与站点 `npm run build`；记录实际输出。
- [x] 完成一致性检查及计划核对，整理现有英文 PR 的最新描述。

## 交付

提交并更新现有 Bee PR #22 与文档 PR #1；远端 CI 的最终状态在交付回复和 PR checks 中记录。保留工作树，不合并或发布 release。
