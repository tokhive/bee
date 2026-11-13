# Bee 请求保活与重试验证记录

日期：2026-11-03。工作树：`.worktrees/bee-desktop-p0`。依据：[批准设计](../specs/2026-11-03-desktop-request-retry-design.md)、[实施计划](../plans/2026-11-03-desktop-request-retry.md)。本记录只说明请求保活与重试增量，不将同工作树的通知等并行修改算作本任务。

## 原故障与修复范围

原生窗口保留 `supply_status / shell-2487 / RESPONSE_TIMEOUT`，已确认旧 Bee 子进程不存在。旧实现把已发送查询超时升级为私有会话失败，关闭 stdin 并回收 Bee，因此独立 WebSocket 也消失。排队时间吞掉执行预算的缺陷已由源码和回归测试证明；现场 shell-2487 的精确耗时没有保存，不声称已证实唯一触发原因。

方案 A 保留普通超时后的管理进程、实例、原请求和屏障；迟到回复必须通过原方法严格校验。前端等待原请求结束，再按资源退避核对，写操作不自动重放。真实进程退出、管道损坏、错误实例和非法／重复回复仍失败关闭。

## 已完成验证

| 层次 | 命令／证据 | 结果 |
| --- | --- | --- |
| Go | `go vet ./...` 与 `go test -race -timeout=600s ./...`；`.cache/retry-final-go.log` | 7 包通过；含最终 HTTP failure_kind 传播 |
| Rust | `RUSTUP_TOOLCHAIN=1.94 cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml --lib --tests --bins`；`.cache/retry-final-rust.log` | 258 单元＋62 集成通过；2 项签名包测试另验 |
| 子进程合成故障 | `.cache/retry-native-pid.log` | 真实 Rust Bridge＋受控子进程；超时前后同 PID／instance，迟到成功或失败后清空 pending，ping 成功，再受控回收 |
| HTTP 分类跨层 | `.cache/retry-http-kind-red.log`、`.cache/retry-http-kind-green.log` | 远端 unavailable 与 typed HTTP 类别分开保存；账号嵌入错误不丢分类；聚焦 race 通过 |
| Linux 验收脚本单测 | `.cache/retry-root-linux-smoke-check.log` | 34 通过；这是脚本合成测试，不是 Linux 原生 App 验收 |
| 前端全量单测 | `node --test --test-concurrency=4 tests/*.test.ts tests/*.test.mjs`；`.cache/retry-root-node-verify-0755.log` | 465 通过、0 失败、1 项原有跳过 |
| 浏览器回归 | `.cache/retry-root-playwright-0755.log` | 299 场景全套运行：297 通过，2 条概览旧夹具失败；修正结果见下一行 |
| 概览失败夹具修正 | `.cache/retry-root-overview-final.log`、`.cache/retry-root-overview-current.log` | 将账号／供给模拟 503 改为真实 typed HTTP 证据，保留未知设备错误对照；概览 17 通过，最终条件调整后受影响 3 条再次通过。产品代码未因此修改 |
| 构建／类型检查 | `.cache/retry-root-app-build-0755.log` | 正式前端 tsc／Vite 与 Tauri debug App 构建退出 0 |
| 最终签名包 | `.cache/retry-root-codesign-final.log`、`.cache/retry-root-signed-final.log` | codesign 深度／严格校验通过；签名完整性／篡改拒绝、包内 Bee 握手／ping／回收 2 项通过 |

全套浏览器结果与定向修复结果分别保留，不把后者写成又跑了一遍全套。早期 `.cache/retry-final-node.log`／`retry-final-playwright.log` 出现并发写入交错，不作为最终证据；以上 `retry-root-*` 使用独立日志与输出目录。

## 原生运行核对

通过 CUA 正常退出旧窗口后，启动最终 `desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app`。实际窗口显示“设备已绑定”“Hive 已连接”“贡献未启动”，0 个已接入 AI 账号。进程表显示桌面壳 PID 38878、其直接 Bee 子进程 PID 38921；随后再次核对该 Bee 仍存活，并有至 Hive 的 established TCP 连接。WebSocket 已连接结论来自原生运行状态，不单凭 TCP 推断。

没有点击开始贡献、账号接入或恢复接单。最终 App 保持打开，停留概览。临时故障注入的同 PID／instance、迟到恢复、受控退出由上述真实 Rust 管道合成测试验证；本次没有对真实 Hive 连接主动断网。

## 审查修正

- 原生迟到 nested `result.error` 不再被 wrapper 的业务 Err 误当致命协议错误。闭合结构、固定诊断码、消息限额与绑定修订校验保留。`.cache/retry-native-review.md` 原 P1 已复审关闭。
- HTTP 日志补充 typed failure_kind；Rust 在 Value 投影前拒绝重复 JSON 字段；Go 使用单 writer 和 64 项非阻塞日志队列，避免日志反压阻塞业务。`.cache/retry-go-review.md` 原 3 项已复审关闭。
- 前端最终审查发现 1 项 P1 和 2 项 P2：pause 后轮询停止、context 查询绕开退避、带平台的写被误判为平台读取屏障。均已补回归并通过有限复审，互斥绑定上下文也已修正。
- 浏览器回归另修正未知写后沿用旧健康轮询到期时间、设备恢复确认前沿用终止身份事实两处边界。只有已确认的主动恢复核验可解除终止条件；普通轮询、读取 receipt、400ms 核对不绕过失败或等待闸门。
- `.cache/retry-final-review.md` 最终有限复审无未解决 P1/P2，未再扩张审查范围。

## 验证边界

- 保留已有工作区变更；未提交、推送、发布或修改 Hive，未开始真实贡献、选择账号或解除暂停。
- Rust 裸 `cargo test --locked` 会编译历史 `examples/experience_probe.rs` 的过期接口；本次明确使用 `--lib --tests --bins`，不将历史 example 计为通过。
- 子进程故障测试验证真实 Rust 管道及受控进程生命周期；浏览器故障场景验证正式 React 消费者和 Tauri 替身。两者不冒充已在真实 Hive 上注入断网／15 秒超时的完整 GUI 实验。
- 日志队列拥堵允许丢诊断，不阻塞业务。调用方拥有的任意 io.Writer 仍须由调用方解除阻塞；旧有终止错误输出不承诺任意 Writer 下完全有界。
- Windows/Linux 原生桌面增量未运行，不扩大本机 macOS 验证结论。

## 一致性检查

- ✅ 会话：实现用户批准的方案 A；保留绑定即在线／贡献单独控制，不自动重放写入、不提交发布。
- ✅ 文档内部：设计中的在途等待、真实退避时刻、终止类别与报告验证边界一致；没有把模拟测试当真实 Hive 故障注入。
- ✅ 跨模块：Go typed 分类和 Retry-After → Rust 严格字段 → TS 调度一致；pending／settled 的实例、ID、method、platform 与通道规则一致。
- ✅ 配置：没有新增运行时开关或环境变量；继续沿用既有超时例外、16 项预算及退出总期限。
- ✅ 文档与实现：已同步 bridge-protocol、ai-accounts 与 desktop README，移除“已发送超时必杀 Bee”的旧规则。

结论：本计划范围实现与验证闭合。保留以上平台／原生故障注入边界，无提交、推送或发布。
