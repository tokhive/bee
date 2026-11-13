# 01: 共享安全切换协议与地址判定

**What to build:** 通过 Bee 公开客户端查询 Hive 能力及原停止派单操作；统一 URL 键，保留历史原始上下文。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Go／Rust／TS 使用同组 URL 样本，默认端口和大小写等价，别名不合并。
- [x] 严格请求／响应覆盖 begin、status、seal、release 和不可变回执；错误不泄露凭据。
- [x] 客户端仅查询原操作、拒绝不支持能力和畸形响应，不能用身份成功替代能力证明。

**进度：** 最终共享协议和跨语言地址契约已合入 `fbdefdc`，并同步 Bee 主线及后续兼容修复。定向 Go race／vet、Rust 309 项及 TypeScript 334 项验证通过；03 与 05 的协议前置已满足。全规格验收已由 09 完成，见最终交付记录。
