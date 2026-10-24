# 桌面设备配对实施计划

> 按 executing-plans 逐任务执行；用户已授权按不改 Hive 的方案继续，不重复请求批准。

**目标：** 普通 Bee 原生客户端完成现有 Hive 设备配对和重启核验，保护 CLI 和 Hive。

**架构：** Go 提供受保护配置上的结构化设备操作；私有管道增加两个白名单方法；Rust 提供受限命令与浏览器打开；React 在普通原生模式展示真实配对页，演示入口保留。

**技术栈：** 沿用 spec 中全部版本，无新依赖。

## 全局约束

不修改 Hive；不覆盖 CLI；秘密只在 Go；绑定不启动贡献；不冒充独立账号登录；普通网页不假成功；不扩大既有平台验收结论。执行目录为现有隔离检出 `.worktrees/bee-desktop-p0`。

### 任务 1：Go 设备配对服务

文件：新增 agent/desktop_device.go、agent/desktop_device_test.go。接口：NewDesktopDevice() 固定生产路径；Begin(ctx,hive,name)、Status(ctx) 返回白名单 DeviceView 或有证据的错误。每次操作获取既有文件锁。

- [x] 先写风险矩阵测试，`go test ./agent -run TestDesktopDevice -count=1` 确认缺实现红灯。
- [x] 实现读取/校验、先保存凭证、创建/轮询/兑换、原凭证恢复和身份不变校验；不增加后台贡献循环。
- [x] 同命令通过，并运行 `go test ./agent`，记录真实接口字段交叉核对。

### 任务 2：私有管道与原生命令

文件：desktopbridge/{protocol,server}.go 及测试，cmd/bee/main.go；desktop/src-tauri/src/{commands,sidecar,protocol,lib}.rs 及相关测试。接口：device_status({})、device_begin({hive,name})；result 中设备业务错误与协议 error 分开。Rust 命令同名且无任意路径参数；device_open 无 URL 参数，由设备结果生成受限 URL。

- [x] 红灯覆盖严格参数、业务失败后 ping、来源/实例/ID 仍受校验。
- [x] 实现 typed 白名单及有限时长设备请求，保留 hello/ping/shutdown 行为；受限启动系统浏览器。
- [x] `go test ./desktopbridge ./cmd/bee`、`cargo test --manifest-path desktop/src-tauri/Cargo.toml` 通过；不弱化签名包和来源检查。

### 任务 3：真实原生配对页与交付

文件：desktop/src/system/device.ts、desktop/src/features/device/*、desktop/src/app/NativeApp.tsx、main.tsx、AppShell.tsx、i18n 字典及测试；docs/desktop/device-pairing.md。

- [x] 红灯覆盖结果校验、失败/未知结果、序列化轮询、demo 隔离及无凭证前端状态。
- [x] 实现普通原生入口、表单、打开网页、公开码、等待/过期/旧设备收尾/绑定结果；相关域清楚显示未接通。保持固定视觉与中英文、最小窗口可操作。
- [x] TypeScript 测试、typecheck、普通/demo build 及相关页面测试通过；完成一次真实子进程设备 API 冒烟。
- [x] 独立代码复核并修复实际问题；记录验证、未验证环境与用户验收步骤。检查 Hive 原有状态未变，再提交已授权改动；不发布生产版本。

## 执行记录

任务 1/2 及任务 3 的实现和测试已完成：12 项设备风险测试（含首次明确 410 与已有未知兑换的区别）及 race、Go 全量 7 包、vet、Rust 45 项、TS 13 项、配对页面 6 项和既有页面相关回归 56 项通过；普通/demo 构建通过。真实原生 Bee 子进程完成 hello/device_status/ping/shutdown，返回 unbound、退出 0，未创建凭证或联网。

独立复核已核对先前 8 项问题及首次 410 补充修复，当前无未解决发现。源码检查点 `70518b4` 已提交；该提交的 Mac arm64 开发包已构建，签名检查及 2 项签名包测试通过。再次从实际包内运行设备 API 冒烟通过，未创建凭证或联网。CUA 已启动 App 进程，但两次返回 cgWindowNotFound、未取得截图或 AX，原生图形不计通过。最终包、hash、用户三步验收及已知缺口见 [设备配对说明](../../desktop/device-pairing.md)。旧 P0/P1 三端缺口不变。


## 收尾核对

一致性检查：用户的“不改 Hive”决定、暂缓方案和保护现有改动要求一致；spec/plan/协议/使用说明内部术语一致；实现符合计划，提交说明与变更相符，typed 接口已传播到全部调用方；独立配置默认值与文档一致、没有新增环境变量或依赖；20 个本地文档链接、交付 ZIP hash 和源码清单核对通过。没有恢复暂缓的账号会话方案，也没有把图形缺口或未运行的远端 CI 写成通过。

post-verification-check 重新逐项核对：总计 10 项，原已勾选 9 项，本次补勾 1 项，剩余 0 项。该结果仅指本设备配对增量，不表示旧 P0/P1/P2 全部完成。Mac 图形及 Windows/Linux 新配对原生验收仍按交付记录保留未验证。
