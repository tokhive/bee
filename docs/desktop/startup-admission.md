# 启动受理与配对衔接

2026-11-20（Asia/Shanghai）。适用范围：打开 App → 设备配对／修复 → 启动核验 → 退出／重启。沿用已认可的自动恢复、显式接入和暂停规则；不新增依赖、界面或业务授权。

## 修复前后对照

图例：**红色「原问题」**表示旧版错误行为，**绿色「已修复」**表示本次修改，**橙色「安全保护」**表示必须继续阻塞的真正未知结果，灰色表示既有正常步骤。每个节点同时有文字标签，颜色不是唯一识别方式。D1／D2／D3 与下方验收表对应；虚线仅表示修复对应关系，不表示运行时调用。

```mermaid
flowchart TB
    subgraph D1["D1：配对尚未完成时，启动检查怎么处理？"]
        direction LR
        O1["原问题 D1<br/>检查漏掉配对屏障，返回 idle<br/>随后提交 Restore，才被 Go 拒绝"]
        F1["已修复 D1<br/>检查设备配对／修复屏障<br/>未完成就返回 blocked，不创建启动尝试"]
        O1 -. 修复为 .-> F1
    end
    subgraph D2["D2：检查后发生变化，Restore 明确拒绝时怎么记？"]
        direction LR
        O2["原问题 D2<br/>运行操作尚未创建，已有明确拒绝回包<br/>Rust 却保存 unknown，并进入失败清理"]
        F2["已修复 D2<br/>保存 failed／RUNTIME_RESTORE_REJECTED<br/>保留原错误和管理进程，不对不存在的 worker 执行 Stop"]
        O2 -. 修复为 .-> F2
    end
    subgraph D3["D3：配对已经完成，旧错误记录如何收尾？"]
        direction LR
        O3["原问题 D3<br/>旧 journal 仍是 unknown，operation_id 为空<br/>持续查询不存在的运行操作，重启仍阻塞"]
        F3["已修复 D3<br/>依据明确受理前拒绝证据识别旧误记<br/>重检当前条件；新启动关联并原样归档旧记录"]
        O3 -. 修复为 .-> F3
    end
    S["安全保护仍生效<br/>只有空编号、超时或回包丢失，不能证明未受理<br/>继续核对原操作；证据不足时保持阻塞"]
    classDef old fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d,stroke-width:2px;
    classDef fixed fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:2px;
    classDef guard fill:#fef3c7,stroke:#b45309,color:#78350f,stroke-width:2px;
    class O1,O2,O3 old;
    class F1,F2,F3 fixed;
    class S guard;
```

## 修复后的完整流程与责任

下图绿色节点标明本次具体修复点；正常的失败处理不是旧问题，使用灰色或橙色表示。

```mermaid
flowchart TD
    A[打开 App：Rust 创建固定 profile 的 Go 管理进程] --> B[核对原启动记录与本地恢复资格]
    B --> C{设备配对或修复尚未完成？}
    C -->|是| D["已修复 D1：检查配对屏障<br/>Go 返回 RECOVERY_DEVICE_UNRESOLVED；不提交运行恢复"]
    D --> E[用户完成原配对；Go 核对 Hive 原申请并保存 completed]
    E --> F[Rust 重检绑定、账号数据和网络；恢复管理能力]
    F --> G[用户显式接入账号；原有贡献与暂停规则继续生效]
    C -->|否| H{原启动尝试是否未决？}
    H -->|明确受理前拒绝| T["已修复 D3：识别具有明确拒绝证据的旧误记<br/>原件完整保留；不再查询不存在的操作"]
    T --> I[重新核验当前上下文；新尝试归档并关联已有记录]
    H -->|已受理或无法证明| J[核对原操作；跨实例须满足原会话退役协议]
    H -->|无记录或已安全结束| I
    J -->|证据仍不足| K["安全保护：证据不足<br/>阻塞并保留诊断；不提交新恢复"]
    J -->|已安全结束| I
    I --> L[Rust 保存 submitted；Go 在生命周期锁内重复受理检查]
    L -->|明确拒绝| M["已修复 D2：明确受理前拒绝<br/>保存 failed／RUNTIME_RESTORE_REJECTED；保持管理进程"]
    L -->|返回带编号操作| N[先保存 operation_id，再回读终态]
    L -->|超时或回包不可信| O["安全保护：真正 unknown<br/>不得按空编号推定未受理"]
    N -->|运行、等待账号或原停止意图得到证实| P[succeeded]
    N -->|原操作明确失败或取消| Q[failed；按既有流程清理并等待人工处理]
    N -->|回读或落盘结果不明| O
    M -->|前置条件处理后| B
    O --> J
    P --> R[退出保存原意图、暂停选择和会话收尾证据]
    R -->|重新打开| A
    classDef default fill:#f1f5f9,stroke:#64748b,color:#334155;
    classDef fixed fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:2px;
    classDef guard fill:#fef3c7,stroke:#b45309,color:#78350f,stroke-width:2px;
    class D,T,M fixed;
    class J,K,O guard;
```

已核实的源码边界：

- `agent/desktop_runtime.go:beginStartLocked` 在设备恢复屏障、生命周期、修订和账号动作检查通过后才创建 operation／run、预留会话并启动 worker。返回非空 error 的分支均在该边界之前；预留或 worker 失败通过已受理 operation 的终态返回。
- `desktopbridge/runtime.go:runtimeResult` 和 `server.go` 将 Restore 的返回错误封装为 `RUNTIME_OPERATION_FAILED`。Rust 先验证相关 IPC 响应，再处理业务错误。
- `desktop/src-tauri/src/runtime.rs:restore_with_progress` 保存受理编号后才查询运行快照。因此在该调用路径保存的“无编号＋明确 Restore 拒绝”与“无编号＋响应丢失”有不同证据。
- `agent/desktop_recovery_inspection.go` 只读设备恢复记录并复用受理屏障；读取不会推进配对、兑换或创建会话。真正受理仍重复检查，检查通过不是授权票据。
- `experience.rs:recover_device`／`recheck_binding` 在配对完成后重新检查；只恢复管理能力和设备在线维护，不调用 runtime_restore，也不解除暂停。下次 App 启动由正常恢复协调器检查当前持久意图。

## 状态与协议约定

| 事实／状态 | 所有者与完成证据 | 重试、重启和收尾 |
| --- | --- | --- |
| 设备配对未完成 | Go 的 `bee-desktop-recovery.json`；Hive 原申请结果及本地 completed 保存共同确定完成 | 原设备流程负责续办；启动检查不提交恢复、不生成替代配对 |
| 启动检查明确阻塞 | Go 返回具体检查错误；Rust 尚未写 submitted | 前置条件处理后重新检查，不消耗已受理恢复次数 |
| Restore 受理前拒绝 | 当前相关 IPC 回包 `RUNTIME_OPERATION_FAILED`，运行编号未生成 | Rust 保存 failed／RUNTIME_RESTORE_REJECTED；原因保留，不执行 runtime_stop；后续必须重新检查资格 |
| 旧版误记 unknown 的拒绝 | 原 schema 中 phase=unknown、operation_id=null、failure.code=RUNTIME_OPERATION_FAILED；调用边界如上 | 不改写原件、不伪造运行结果。观察不查询不存在的操作；合格新尝试关联 previous_attempt_id 并完整归档原件 |
| 真正 submitted／unknown | 缺少可信相关拒绝，或已存在 operation_id | 沿原实例、绑定、网络、操作编号查询；跨实例沿原会话退役协议，不换编号重放 |
| 已受理失败／取消 | 同操作编号的 failed／cancelled 回执 | 保留已确认终态；继续既有清理、人工重试预算，不适用受理前例外 |
| 成功与退出 | 当前上下文、运行／等待／停止状态及 owned-exit 回执 | 不覆盖暂停选择；新尝试归档前次记录，旧 worker 必须已受控结束 |

旧拒绝的识别不依赖其英文 message；仅凭 `operation_id=null`、当前 idle 或当前配对 completed 都不足以认定未执行。损坏记录仍阻塞。旧拒绝不需要会话退役证明，因为没有创建该次运行会话；若当前另有脏会话，当前恢复检查仍要求它的退役证明。

## 差异与验收映射

| 编号 | 原实现差异 | 修复与对应测试 |
| --- | --- | --- |
| D1 | 检查返回 idle，但 Restore 因 pending 配对拒绝 | 复用设备写屏障；`TestDesktopRecoveryInspectionBlocksPendingPairingBeforeRestore` 覆盖真实配对、期间关闭重建及完成后重建 |
| D2 | 明确拒绝被写为 unknown，随后等待不存在的操作 | 明确拒绝保存 failed；`restore_admission_refusal_keeps_management_without_stopping_and_allows_recheck` 覆盖检查后拒绝、无错误 Stop、手动核对与重试 |
| D3 | 配对完成后旧拒绝仍阻塞观察及新实例启动 | 原样保留并识别旧证据；`startup_continues_after_legacy_pairing_admission_rejection` 覆盖同／异实例和归档；`completed_pairing_rechecks_legacy_refusal_without_restoring_contribution` 覆盖管理重检 |
| D4 | 仅测局部检查可能遗漏跨语言实际错误包装 | `native_pairing_admission_recovery_through_real_go` 使用真实 Rust Bridge、Go transport、设备及运行服务，受控 Hive 完成配对；旧 Rust 的误记行为由测试明确种入 |
| D5 | 原生启动已成功，前端拿旧 network=0 缓存拒绝 network=1 回执；刷新到 1 后仍没有接纳该回执 | 成功回执触发一次有序只读核对；`automatic startup confirms a newer network receipt`、`network confirmation joins an old read` 与 `native-experience.spec.ts` 的 `startup network receipt` 场景 |
| D6 | 真正不一致或读失败时，已有 checking 状态会吞掉核对错误，持续显示进行中 | 保留失败证据并结束该次核对；`fresh network ... cannot confirm`、`failed ... observation cannot confirm` 覆盖版本不一致、绑定读取失败和运行读取失败 |
| 安全边界 | 无编号不证明未受理；已有暂停不能被恢复覆盖 | `missing_operation_alone_never_proves_admission_rejection`、既有 unknown／retirement／exit 测试和 `native_auto_service_through_real_go_transport_and_controlled_hive` |

测试结果和真实 App 验收属于每次执行的证据；本文件定义行为，不以测试名称或构建成功代替实际验收。历史执行记录保存于独立 `bee-design-archive`。

## 启动成功回执与前端快照衔接（D5／D6）

2026-11-20 续查路径：打开已绑定 App → 启动网络配置 → 恢复原运行意图 → 前端确认 → 退出／重启。沿用现有 TypeScript／React 状态协调器、Tauri 2／Rust 和 Go IPC；没有新增依赖、持久字段、账号选择或暂停行为。

已核实：`experience.rs:prerequisites` 在新管理进程的 stopped／revision=0／network_revision=0 状态下调用 `network.rs:bootstrap_saved`，配置版本至少为 1，回读一致后才继续恢复。`startup_mode` 在最终上下文与检查结果一致时发布 ready。前端 `desktopState.ts:refresh` 独立读取本地快照，所以它保存的 network=0 可能早于该配置提交；缓存值不能充当回执产生后的证据。

原问题中，`acceptStartup` 拒绝不同网络版本的成功回执后只刷新快照，既不保留回执继续核对，也不自动再查询启动终态。原生成功记录不会因此失败，前端却停在 checking 或 `STARTUP_STATUS_REJECTED`。真实故障中，原生 journal 为 succeeded／network=1，旧 App 手动“重新核对”后恢复正常显示，支持这一判断；不将所有版本差异概括为正常竞态。

```mermaid
flowchart TD
    A[Go 管理进程初始网络版本 0] --> B[Rust 配置并回读网络版本 1]
    A --> C[前端可能已缓存运行快照 0]
    B --> D[Rust 核验恢复及上下文完成，发布 ready 1]
    C --> E{当前实例和绑定有效？}
    D --> E
    E -->|否| F[拒绝过期回执；保持保护]
    E -->|是，网络等于当前缓存| G[沿用现有接纳路径]
    E -->|是，成功回执网络较新| H[已修复 D5：保留回执；合并重复事件]
    H --> I[等旧读取结束，再发起一次新的共享本地读取]
    I --> J{实例、绑定、回执仍有效且读取成功？}
    J -->|否| K[已修复 D6：保留错误或丢弃已失效核对；不解锁]
    J -->|是| L{新快照网络与回执完全相等？}
    L -->|否| K
    L -->|是| M[接纳原 ready；清除旧读取错误；恢复正常读取]
    K --> N[用户重新核对原结果；不自动重做 Restore]
    M --> O[正常受控退出；后端保存原意图和会话证据]
    O -->|重启| A
```

| 状态／边界 | 所有者、完成依据及收尾 |
| --- | --- |
| 网络配置、启动完成 | Go 拥有有效网络版本，Rust 拥有启动核验与持久恢复记录；前端不能修改或伪造成功记录 |
| 待确认的较新成功回执 | 前端仅暂存当前 epoch 的一份回执；核对期间阻止设备推进、账号维护和供给读取，不调 startup_retry／runtime_restore |
| 新的只读证据 | 等待先前共享读取结束，再读取绑定及运行快照；通过已有运行版本下限校验且绑定读取成功才计为有效观察。不能用旧缓存或失败读取确认成功 |
| 重复／迟到回执 | 同一待核对版本合并；较低版本不能覆盖较高版本。新 checking／blocked 回执取消旧核对；切实例、切绑定、切 Hive 或 dispose 后旧核对不能发布 |
| 明确不一致／读取失败 | 不解锁、不自动循环；保留具体错误及已有结果，提供既有“重新核对”入口。未来成功证据由原查询入口接纳 |
| 退出／重启 | 前端候选回执不落盘；关闭销毁它。重新打开重新读取原生状态和 journal，保持原有失败／unknown／会话退役协议，不删除未决记录、不通过 UI 修复重放业务操作 |

本轮边界：配对、暂停和 Hive 写入语义没有变化，沿用前文 D1—D4 的协议；新增验证直接覆盖前端真实状态协调器、实际页面与受控 IPC。真实 App 的具体版本、启动／退出证据及未完成项见本轮独立档案，不能由上述测试名称推导全生命周期已经验收。
