# 03／09 原生实现与验证记录

日期：2026-11-05（Asia/Shanghai）。本记录仅覆盖 Go 原生实现；Rust、TypeScript、页面及跨层整体验收由主代理汇总。

## 03：保留 Hive 当前接单选择

- 普通 Restore 不再把保存的 resume_platforms 转成解除暂停写入；平台准备不再临时暂停。保存的恢复证据继续保留，但 Hive 当前平台状态决定接单选择。
- 明确用户操作 `Start(resume_platforms)` 仍受现有修订、来源、账号、转发和同步保护。
- 真实 HTTP／WebSocket／CONNECT 替身覆盖两平台四种暂停组合、重启后采用 Hive 新选择、断线后新 lease 的即刻转发、两平台同身份凭据刷新、异号等待确认，以及恢复中的最新暂停。
- 初始 red：`/tmp/bee-ticket03-red.log`，旧实现发生 1–3 次额外暂停／恢复写入。
- 专票 race：`go test -race ./agent -run '^TestDesktopSupplyChoice' -count=1`，通过 10.915s。
- 当时相关回归：`go test -race ./agent -run '^TestDesktop(SupplyChoice|AutoMaintenance|AutoService|Presence|Runtime|Upgrade)' -count=1`，通过 29.206s。

## 09：一次性转换旧版停止记录

- ai-accounts 状态升级为 v3；v1／v2 继续严格解码，v2 首次替换前保存受保护、逐字节核对的 `.v2.bak`。新 scope 的迁移标记为 not_required。
- 只有旧 v2 `running=false` 且有已选账号的 scope 生成迁移记录。原运行意图、原选择及每平台 intent／submitted／confirmed 进度保留；历史 scope 不产生远端操作。
- 当前设备／Hive 用户、原选择和当前官方来源核验通过后，先持久化原迁移及 submitted，再发送一次暂停。供给 GET 确认后才记 confirmed；全部确认并持久化 completed 后才允许占用贡献会话、连接和授权。
- 迁移本身不占贡献 Session，不创建 dirty runtime guard；因此迁移中进程被终止可以核对原 journal。已有脏会话、脏 guard、未决账号操作、异号来源、损坏状态仍会阻挡。
- submitted 结果未知时只 GET 原结果，绝不自动重放 PUT。用户可通过已有 `Start([])` 继续已批准迁移；原来尚未 submitted 的步骤在重新验证后可以首次发送。完成后不再覆盖后来的明确恢复／暂停。
- 完成写入与 Stop admission 共用运行锁，晚到的迁移不能把用户停止改回 running。
- 公开新增必需 nullable `legacy_stop`，含 phase、platforms、error、can_recheck。processing 时不可重核，未知结果可继续核对；状态异常的 admission 受阻时不提供绕过入口。

## 证据范围

- 真实旧格式：测试写入独立 v2 JSON 形状，不使用当前 struct 冒充旧格式。
- 真实故障：实际 HTTP 连接丢失响应；实际管理子进程被 SIGKILL；实际 Unix 目录权限导致原子替换失败（发送前和远端提交后）；真实 Stop 取消正在进行的暂停。
- 直接构造的故障样本：脏 guard／Session、未决选择、坏 JSON、v3 缺失／null／未知进度／虚假完成／矛盾运行意图。这些属于存储边界注入，未宣称是实际崩溃生成。
- 严格保护：当前 Hive owner 不匹配时不迁移、不写供给；源身份在 GET 后改变时，暂停发送前再次验证并阻止写入；仅处理当前 scope 的已选平台。
- 初始 red：`/tmp/bee-ticket09-first-red.log`（旧停止记录无法维护）；`/tmp/bee-ticket09-source-race-red.log`（源身份中途改变仍发出暂停）；`/tmp/bee-ticket09-pending-running-red.log`（矛盾 v3 记录被允许运行）。
- 专票 race：`/tmp/bee-ticket09-race.log`，通过 6.263s；真实 Stop 竞争另通过 1.867s。
- 相关 race 回归：`go test -race ./agent -run '^TestDesktop(LegacyStop|Account|Upgrade|SupplyChoice|AutoService|AutoMaintenance|Presence|Runtime|Exit|Authorize)' -count=1`，通过 47.555s。之后最后增加矛盾 v3 拒绝与预留 guard 的失败保护，执行 `go test -race ./agent -run '^TestDesktop(LegacyStop|AccountState|Upgrade|AutoService)' -count=1`，通过 8.672s（`/tmp/bee-ticket09-final-safety.log`）。

限制：Windows ACL／原子替换失败场景未在本机执行；未连接用户真实账号或真实 Hive。受控服务与官方来源使用合成凭据。页面验收和严格 Rust／TS 契约验收仍由主代理合并记录。
