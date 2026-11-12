# 05: Bee 后台支持受限准备与安全交接

**What to build:** 后台固定 profile 路径，准备 B 仅配对核验；提供有证据的 A 停用和 B 无账号连接验证。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 01 共享安全切换协议与地址判定; 02 独立 Hive 数据目录、旧数据迁移与进程归属

**Status:** in-progress

- [ ] 正式 desktop 参数支持内部 profile 及 preparation 模式；Go 与 Rust 白名单一致。
- [ ] 封存前不清保护，不强停任务；保存原证明后结束 owned worker／IPC。
- [ ] 无 AI 账号也能验证连接；提交前不上传账号授权、不维护供给。
