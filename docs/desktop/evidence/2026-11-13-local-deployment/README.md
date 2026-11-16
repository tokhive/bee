# macOS 本地部署与切换验收阻塞

时间：2026-11-13，Asia/Shanghai。

Hive 和对应 Bee 已部署到用户本机；本轮 A → B → A 验收在初始设备配对阶段阻塞，尚未发起切换，不能计为通过。

## 实际版本与部署

| 项目 | 实际结果 |
| --- | --- |
| Hive PR | [#307](https://github.com/tokhive/hive/pull/307)，已正常 merge，未使用 admin 绕过保护 |
| Hive main | `f208e408012bb08d257acfd858497dcc438fd010` |
| Hive 固定 Bee 与本次 App 源码 | `8b5ba8027795475edb43d338caf173cf6a5a0221` |
| macOS | arm64；Go 1.27.3、Node 24.22.1、Rust/Cargo 1.94.0 |
| Bee 安装 | `~/Applications/Bee.app`，bundle ID `dev.tokhive.bee`，0.1.0 开发构建 |
| Hive 地址 | `http://127.0.0.1:8080`，与现有 Bee 配置的 origin 一致 |
| Hive 数据库 | 沿用现有本地 PostgreSQL 的 `hive` 数据库，没有重建用户数据 |

Hive 在已合并 main 的独立集成工作区构建，Bee 从上表固定版本构建。没有重置用户主工作区及旧 Bee 工作区。Hive 作为当前用户的后台进程运行；本轮没有新增系统开机启动项。

## 已完成的检查

- 升级前对原数据库执行 custom-format `pg_dump`，再用 `pg_restore --list` 校验成功。
- 旧 Bee 通过原生菜单正常退出后，备份 `tokhive` 和 `dev.tokhive.bee` 两个配置目录；备份根目录权限为 0700，配置副本为 0600。
- 合并后的 Hive 控制台构建与 Go 主程序构建成功。
- Hive 启动迁移成功，`080_device_drains.sql` 和同一 main 中的 `080_long_context.sql` 均已登记。迁移按完整文件名登记，两者都得到应用。
- 控制台 `/login` 返回 HTTP 200；未携带设备凭据的 drain 能力请求返回 HTTP 401。这只能证明路由及鉴权入口可用，不能作为设备能力鉴权成功的证据。
- 数据库仍有原来的 1 个用户、1 个设备。
- Bee sidecar、正式前端及 macOS 原生 App 构建成功。App 使用本地 ad-hoc 签名，`codesign --verify --deep --strict` 通过；签名和安装前后的 sidecar SHA-256 一致。
- 已安装的 App 和 Go 子进程实际运行，子进程使用新的固定 profile 目录及 `current` 模式。
- 原配置成功迁入唯一的 `http://127.0.0.1:8080` profile；没有迁移阻塞。迁入的设备文件和恢复记录与升级前备份逐字节一致。
- 通过 macOS Accessibility 读取原生窗口，操作了一次“核对结果”，并取得按 Bee 窗口 ID 截取的原生截图。页面仍明确显示“创建结果未知”。

App 可执行文件与 sidecar 的 SHA-256、配置迁移及数据库观察的脱敏事实保存在同目录的 `facts.json`。

## 真实阻塞及原因

用户原先已有一笔初次配对记录：`phase=creation_unknown`、`create_attempted=true`、`redeem_attempted=false`，但未保存到配对 token。原始失败是：

```text
pairing verification URL rejected; required=configured Hive origin plus /devices/pair without query or fragment
```

按当前设备凭据在本地计算摘要，并仅以摘要查询 Hive 数据库，确认唯一匹配的配对已在 **2026-11-12 18:34:02 +08:00** 过期，未获批、未兑换；没有该凭据对应的设备。查询没有修改数据库，也没有输出设备凭据、配对 token 或摘要。

现有协议需要原配对 token 查询状态；Hive 只保存其摘要，不能取回原 token。Bee 的 `agent/desktop_device_recovery.go` 中，`advanceRecovery` 对“创建已尝试、配对 token 缺失”保留原记录；`initialRecoveryOperate` 仅允许已进入 `expired` 的记录显式重建。数据库中的过期事实目前没有进入这个恢复流程的接口，App 自身因此仍无法判定原操作终态。

当前配置没有已绑定的 A 设备身份，无法开始本次切换验收。页面顶部还显示“设备身份不足以确认网络设置的作用域”，这是同一缺失身份造成的启动阻塞。本轮没有伪造 `expired`、删除恢复记录或生成替代凭据来宣称通过。

## 保留的私有材料

本机目录 `~/Library/Application Support/tokhive-deployments/20261113-hive-switch/` 保存数据库备份、原配置副本、构建与运行日志、进程 ID、旧 App 路径以及原生窗口截图。原数据和这些私有材料不提交到 Git。

当前 Hive 未配置真实 TEE 供给，本轮没有调用真实模型服务；没有创建第二个 Hive、执行 A → B → A 或验证真实账号可用性。此前的 Linux 原生及真实任务验收见旧分支提交 `62b7cc1` 中的 `docs/desktop/evidence/2026-11-13-hive-switch-final-review/README.md`，不能代替本轮 macOS 用户数据的验收结果。Hosted CI 原有账单限制也不能算作通过。

## 2026-11-13 当时的下一步

补齐“原配对 token 缺失”的安全恢复入口：由 Hive 对原凭据对应操作给出权威终态，Bee 保存该证据并保留旧记录，然后由用户显式发起新配对。完成 A 的正常配对后，再准备独立 B 环境并验证 A → B → A。不能将管理员这次数据库查询当成 App 已具备的恢复能力。


## 2026-11-16：隔离实施验证

本节追加代码验证，不改写上面的真实部署历史。用户明确要求“实施”后，Bee/Hive 已补齐恢复协议和入口；本轮没有安装或启动真实用户 App、确认或撤销真实设备、修改原 Hive 数据库。原安装 App 的 `creation_unknown` 仍不能因测试通过而算作已恢复。

实现位于 Bee `codex/pairing-recovery-main` 和 Hive `codex/pairing-recovery` 两个独立 worktree；实际契约见[设计实施结果](../../designs/2026-11-13-pairing-recovery.md#本轮实施结果2026-11-16)。Hive 实现基于 `f208e408012bb08d257acfd858497dcc438fd010`，应用恢复迁移 081，以及同步 Bee 既有 Claude 套餐的迁移 082；数据库验证使用本轮临时 PostgreSQL 18 和每项独立 schema，账号及设备秘密均为合成数据。

| 检查 | 结果与范围 |
| --- | --- |
| Bee `make test` | 完整通过：安装器/菜单、Go vet 和全部 Go race；macOS 按既有条件跳过 Linux systemd 项 |
| Bee 配对恢复专项 race | 覆盖创建回包丢失后原键重放、可信原凭证恢复、损坏配置、可信原 owner/device 保留、旧 guard 精确归属、取消预算、取消意图保存中断及错误关闭证明；通过 |
| Rust 原生 | 362 项通过、6 项按既有条件忽略；另补目录重复归属、原迁移冲突保留、缺失当前目录不启动子进程专项，不忽略权限、symlink、owner 或更新包校验 |
| Bee 前端 | 单元 348 项、工具链 38 项、类型及生产构建通过；完整设备页面测试 427 项通过，后续局部调整的相关 69 项及最新 14 项恢复确认路径再次通过 |
| Hive 受影响路径 | `go test -race ./hive/internal/integration -run '^Test(PairingRecovery\|BeeSingleDevice\|BeeReplacement\|DeviceDrain\|RuntimeRecovery)' -count=1 -timeout=240s` 通过；真实 HTTP、隔离 PostgreSQL、已有任务/结算及连接路径 |
| 真实 Bee/Hive 跨端 | 整个本地绑定记录缺失、Hive 网页明确确认旧设备、Bee 关闭后重建对象继续同一次恢复、结束离线旧排空、替换及新配置保存；通过 |
| Hive 其他 Go 包 | 全部非 integration 包 race 与 `go vet ./...` 通过 |
| Hive 其他集成路径 | 排除上表已跑路径后执行其余 integration；其中 7 项曾读到修改中的源码而编译失败，另 1 项发现 Bee/Hive 套餐清单不一致。冻结源码并补齐迁移 082 后，这 8 项 race 精准重跑全部通过（193.593 秒）；其余项在原分组运行通过，live/browser 等可选项仍按既有条件跳过 |
| Hive 网页 | 类型检查及生产构建通过；复用原设备确认页，增加本次权限和取消后继续停单的说明 |
| 浏览器 | 合成回包下实际操作恢复表单、失败保留输入、确认后显示原配对、取消对话框；没有登录或操作真实 Hive |

Hive 首次全套运行期间迁移 081 仍在补充，父测试程序嵌入旧 schema、真实子服务读取新源码，出现 `recovery_end` 缺列并使该次运行失败。随后冻结迁移，以一致源码/schema 重跑所有受影响路径并通过；该次失败不算全套通过。其余集成测试采用上表分组与失败项精准补跑结果，不宣称单次 `make test` 全通过。工作区联调使用临时 Go workspace 引用两份源码；最终固定 Bee 子模块后还须在 Hive 关闭该覆盖验证，结果随 Hive 提交记录。

新增数据库故障测试只操作自己的 schema：模拟最终提交失败、结算证据不足、持久结果重放和取消竞争，未伪造真实用户成功。仍未证明所有硬崩溃、文件系统同步失败组合；未做实际部署参数审计，也不承诺重绑总等待时间。后来被替换的历史身份和无法归属的旧证据，仍有转人工边界。

下一步是部署匹配 Hive/Bee 到隔离验收环境，使用测试设备验证“原配对 token 缺失”和“整个本地记录丢失”两个入口，然后验证 A → B → A。真实用户数据的部署及恢复另行执行，不能拿本节代替原阻塞的解决证明。
