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

## 下一步

补齐“原配对 token 缺失”的安全恢复入口：由 Hive 对原凭据对应操作给出权威终态，Bee 保存该证据并保留旧记录，然后由用户显式发起新配对。完成 A 的正常配对后，再准备独立 B 环境并验证 A → B → A。不能将管理员这次数据库查询当成 App 已具备的恢复能力。
