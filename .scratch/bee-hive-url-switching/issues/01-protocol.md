# 01: 共享安全切换协议与地址判定

**What to build:** 通过 Bee 公开客户端查询 Hive 能力及原停止派单操作；统一 URL 键，保留历史原始上下文。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** None (can start immediately)

**Status:** in-progress

- [ ] Go／Rust／TS 使用同组 URL 样本，默认端口和大小写等价，别名不合并。
- [ ] 严格请求／响应覆盖 begin、status、seal、release 和不可变回执；错误不泄露凭据。
- [ ] 客户端仅查询原操作、拒绝不支持能力和畸形响应，不能用身份成功替代能力证明。

**进度：** 共享协议与客户端增量已合入 `36b73a0`，定向 race 测试通过；Go／Rust／TS 地址契约的剩余验证继续。03 的共享接口前置已满足。
