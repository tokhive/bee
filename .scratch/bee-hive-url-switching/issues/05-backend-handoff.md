# 05: Bee 后台支持受限准备与安全交接

**What to build:** 后台固定 profile 路径，准备 B 仅配对核验；提供有证据的 A 停用和 B 无账号连接验证。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 01 共享安全切换协议与地址判定; 02 独立 Hive 数据目录、旧数据迁移与进程归属

**Status:** done

- [x] 正式 desktop 参数支持内部 profile 及 preparation 模式；Go 与 Rust 白名单一致。
- [x] 封存前不清保护，不强停任务；保存原证明后结束 owned worker／连接。IPC 排空和子进程 reap 已由任务 06 的 App 协调器落实。
- [x] 无 AI 账号也能验证连接；提交前不上传账号授权、不维护供给。

实现入口：`agent/desktop_switch.go`、`agent/desktop_profile.go`、`desktopbridge/switch.go`、Rust `Bridge::switch_control`／`switch_protocol.rs`。契约详见 `docs/desktop/device-drain-protocol.md` 的桌面后台交接边界。已覆盖原回执落盘失败、未知 seal、冻结停止绕过、退出保留 guard、重启绑定／epoch 不匹配，以及无账号／账号来源失效的设备连接验证。真实 Go 子进程验证 preparation launch、Rust 发送前门禁、原 profile／instance 核对；本任务不宣称完整 A→B E2E。
