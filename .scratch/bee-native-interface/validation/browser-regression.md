# 自动服务浏览器契约回归

验证时间：2026-11-05，Asia/Shanghai。

本报告覆盖当前自动服务主入口下的前端交互与原生公开接口 mock 契约。浏览器结果不证明真实操作系统登录、Hive 归属、转发或跨进程恢复；这些边界由原生测试证据单独承接。

## 结果

以下 8 个套件分组执行，共 **216 个唯一用例全部通过**。这是分组验证结果，不能表述为单次运行 216/216。

| 套件 | 用例数 | 结果 |
| --- | ---: | --- |
| account-auto-read | 32 | 通过，未修改 |
| native-experience | 68 | 通过，未修改 |
| device | 33 | 通过 |
| device-recovery | 11 | 通过 |
| overview-refresh-stability | 17 | 通过 |
| polling-stability | 26 | 通过 |
| supply | 17 | 通过 |
| recovery-navigation | 12 | 通过 |

另外，本轮此前完成的 `native-runtime` 53/53、`native-updater` 23/23 均通过。`native-auto-service` 最初 5/5 通过，补充 Claude 去重永久回归后最终 6/6 通过。最终 TypeScript 类型检查与本轮修改文件的 `git diff --check` 通过。

## 迁移后的证明范围

- 使用已选账号在停止状态下的“重试准备”验证运行时提交；保留后台读取等待、重复点击只写一次、读取失败取消提交、身份变化取消提交、修订号低于回执时阻塞等安全断言。
- 普通运行状态没有日常开始／停止总开关。原 `central readback ... stop receipt` 用例改名为运行中轮询不提供日常停止；原等待停止后身份拒绝场景改为身份变化时不出现日常停止或准备写入。两者均断言零运行时写入。
- 原停止命令的回执修订号与可信本地停止语义移交现有 TypeScript client、Go、Rust 原生测试。上述两个浏览器替代用例不再声称验证用户可以通过日常 UI 触发停止，也没有添加产品测试入口或兼容开关。
- 通用官方登录的等待、取消、回执修订号及条件重验改用 OpenAI 现有确认弹窗。Claude 首次内联登录及来源修复导航仍由对应现有用例覆盖。
- 账号错误改从“查看原因”及“查看失败详情”读取；保留原始错误码、实际值和要求、重试后仍可诊断、写入保持阻塞。额度历史继续显示原值和观测时间。
- 未新增对其他会话已有 dirty offline 专用重连／诊断按钮的依赖。

## 回归发现

供给用例保留旧 Hive 的 `not_configured` 原因断言，发现自动账号行无条件过滤了该有效远端原因。主代理修复后，展开原因可看到“此 Hive 未提供更具体的接单原因”；恢复接单仍不消除其他供给阻塞。最后一次 `polling-stability` 与 `supply` 合计 43/43 通过。

### Claude 失败摘要的定向复核

在上述分组回归之后，单独增加一次临时浏览器诊断：自动服务主入口 → AI 账号 → Claude 详情 → 登录 Claude → 继续登录；fixture 将本次官方登录完成为 `failed`，使用默认 `authorization_process_failed`／`official_process` 错误，不添加 `transport_failed` 特例。展开同一 Claude 账号行的“查看原因”后，`row.getByText('官方登录进程执行失败。', {exact: true}).count()` 实测为 **2**，两处均可见：原因列表中的 `P` 与内联登录错误中的 `H4`。

修复前源码中，`AccountCondition` 的错误候选包含 `operation.error`，`NativeAccountLogin` 同时用该错误生成摘要；自动服务分支始终渲染前者，并在 Claude 登录时渲染后者。诊断中仅有一次 `authorize_start`，没有账号选择、供给写入、服务启动或停止。临时 Playwright 用例 1/1 通过（2.0 秒），输出目录 `/tmp/bee-claude-duplicate-directed-playwright`；该用例断言并证实重复，未纳入常驻测试。原始观测为：

```json
{"summary":"官方登录进程执行失败。","count":2,"matches":[{"tag":"P","className":"","parentClass":"","visible":true},{"tag":"H4","className":"","parentClass":"account-login-error","visible":true}],"writes":["authorize_start"]}
```

主代理修复后，永久回归加入 `desktop/tests/native-auto-service.spec.ts`：经真实确认入口提交 Claude 登录，将本次结果模拟为失败，并在快照中加入独立的 `hive_unconfirmed` 账号问题。展开原因后断言登录失败摘要 **count=1 且可见**，独立的“Hive 账号状态尚未确认。”仍可见，`authorize_start` 一次，`account_action`、`supply_set_paused`、`runtime_start`、`runtime_stop` 均为零。独立问题通过公开 `AccountIssue` 字段注入，不使用测试专用产品入口。

修复前证据为上述 count=2 的真实诊断观测；永久 count=1 回归新增时产品修复已经保存，没有伪称取得该永久用例的修复前失败日志。新用例定向 1/1 通过（1.9 秒），最终整个 `native-auto-service` **6/6 通过（5.1 秒）**，输出目录 `/tmp/bee-auto-service-claude-regression-playwright`。最终 `npm run typecheck` 与修改文件的 `git diff --check` 通过；测试与报告已冻结。

## 执行位置

工作目录：`desktop/`；Node.js 24.22.1；浏览器端口 1467。

```sh
BEE_DEVICE_TEST_PORT=1467 npx playwright test --config playwright.device.config.ts \
  tests/device.spec.ts tests/device-recovery.spec.ts tests/supply.spec.ts \
  tests/native-experience.spec.ts tests/account-auto-read.spec.ts \
  tests/polling-stability.spec.ts tests/overview-refresh-stability.spec.ts \
  tests/recovery-navigation.spec.ts --workers=4 \
  --output=/tmp/bee-device-remaining-playwright
```

迁移后的分组复验分别覆盖 `device`、`device-recovery`、`recovery-navigation`，以及 `overview-refresh-stability` 与 `polling-stability`。最后一次默认超时复验命令为：

```sh
BEE_DEVICE_TEST_PORT=1467 npx playwright test --config playwright.device.config.ts \
  tests/polling-stability.spec.ts tests/supply.spec.ts --workers=4 \
  --output=/tmp/bee-polling-supply-final-playwright
npm run typecheck
```
