# 108 项 OpenAI 场景实施映射

2026-11-10（Asia/Shanghai）。逐行对照原有 [场景索引](../../account-scenarios.md)。**全部真实验收仍未执行**；“局部受控验证”只指列明的部分，不能等同整行完成、HTML 新增认可或任务 done。已认可 HTML 仍以主预览为准，新增恢复候选全部待评审。

G1／R1／N1／T1、U1～U6、H1 与 B1～B5 的证据、命令和限制见 [实施记录](README.md)。共享理由写在每行；未跑到的专属 UI、Hive 真实事务与官方授权不能借共享测试标成通过。

实现入口：[卡片／OpenaiAction](../../../../desktop/src/features/accounts/OpenaiAccountCard.tsx)、[useAccounts](../../../../desktop/src/features/accounts/useAccounts.ts)、[operationQuery](../../../../desktop/src/system/operationQuery.ts)、[progress](../../../../agent/desktop_authorize_progress.go)、[AccountQuota](../../../../desktop/src/features/accounts/AccountDisplay.tsx)、[useSupply](../../../../desktop/src/features/supply/useSupply.ts)。

| 索引 | 场景 | 本轮状态 | 实际行为／剩余差距及共享理由 | 证据／阻塞 |
| --- | --- | --- | --- | --- |
| [IN-12](../../account-scenarios.md#in-12) | 首次接入且无历史接单状态 | 受阻 | 缺少真实无历史判别和事务证据；首次默认告知未接入真实历史 | B2 |
| [IN-11](../../account-scenarios.md#in-11) | 接入结果长期未知，恢复操作出口 | 局部受控验证 | 已知原 ID 纯查询，60 秒停止后手动核对；丢失首次回执或跨重启仍不足 | U4；B3 |
| [IN-01](../../account-scenarios.md#in-01) | 尚未登录，首次接入起点 | 局部受控验证 | 首次来源保留四步，核验后待确认；完整真实官方链未联调 | U6、G1 |
| [IN-02](../../account-scenarios.md#in-02) | 已登录 Codex，待接入 Bee | 局部受控验证 | 直接接入确认、原操作、两步准备和完成提示；点击完成无业务写 | U1、U4 |
| [IN-03](../../account-scenarios.md#in-03) | 确认接入弹窗：身份及订阅额度用途 | 局部受控验证 | 直接接入确认、原操作、两步准备和完成提示；点击完成无业务写 | U1、U4 |
| [IN-04](../../account-scenarios.md#in-04) | 取消接入确认，保持未接入 | 已实现，未专项验收 | 关闭确认不提交；未做取消分支专项 UI 断言 | OpenaiAction |
| [IN-05](../../account-scenarios.md#in-05) | 已提交接入，正在接入账号 | 局部受控验证 | 直接接入确认、原操作、两步准备和完成提示；点击完成无业务写 | U1、U4 |
| [IN-06](../../account-scenarios.md#in-06) | 接入成功，转准备接单 | 局部受控验证 | 直接接入确认、原操作、两步准备和完成提示；点击完成无业务写 | U1、U4 |
| [IN-07](../../account-scenarios.md#in-07) | 明确接入失败，原操作不会再生效 | 待补 | 具体失败可见；安全连续重试和同身份同范围免重复确认仍未接通 | B3、B4 |
| [IN-08](../../account-scenarios.md#in-08) | 暂时无法确认接入结果，自动查询原操作 | 局部受控验证 | 已知原 ID 纯查询，60 秒停止后手动核对；丢失首次回执或跨重启仍不足 | U4；B3 |
| [IN-09](../../account-scenarios.md#in-09) | 同身份及范围重试接入，不重复确认 | 待补 | 具体失败可见；安全连续重试和同身份同范围免重复确认仍未接通 | B3、B4 |
| [IN-10](../../account-scenarios.md#in-10) | 重试前身份或范围变化，重新确认 | 共享校验，UI未专项验收 | 确认键包含账号、来源、运行条件；变化后拒绝提交，完整变更场景未专项验证 | T1、OpenaiAction |
| [LOGIN-15](../../account-scenarios.md#login-15) | 取消受阻或取消结果未知 | 未闭环 | 保留取消未知和 cleanup blocker；长期归属未知仍缺可执行恢复出口 | G1；B1、B4 |
| [LOGIN-13](../../account-scenarios.md#login-13) | 请求取消后，正在结束登录 | 局部受控验证 | 取消回执不等于终态；原进程回收后 finished，取消不撤销官方已授权事实 | G1、N1 |
| [LOGIN-14](../../account-scenarios.md#login-14) | 取消已完成，保留暂停，按实际来源核验 | 局部受控验证 | 取消回执不等于终态；原进程回收后 finished，取消不撤销官方已授权事实 | G1、N1 |
| [LOGIN-03](../../account-scenarios.md#login-03) | 其他启动失败：版本、存储或准入等具体原因 | 部分实现 | 保留版本、存储、准入的具体原因；按各原因匹配修复入口未全部闭合 | G1；B4 |
| [LOGIN-12](../../account-scenarios.md#login-12) | 登录结束但身份核验失败 | 部分实现 | 显示核验／来源失败并可重新核验；前序步骤保留及修复后继续准备未全面闭合 | G1；B4 |
| [LOGIN-04](../../account-scenarios.md#login-04) | 等待官方授权，尚无可安全打开的链接 | 未闭环 | 完整 URL 出现前保持 starting，最终按 10 分钟期限收尾；缺短取链阈值与安全重登出口 | G1；B1、B4 |
| [LOGIN-07](../../account-scenarios.md#login-07) | 打开页面失败，或本次链接已不可用 | 局部受控验证 | launcher 失败保留本次链接和错误；取消立即撤销，pending opener 随 owned context 停止 | G1、N1 |
| [LOGIN-01](../../account-scenarios.md#login-01) | 启动官方登录中 | 局部受控验证 | 真实 starting 阶段，无链接时不显示打开入口 | G1、progress |
| [LOGIN-05](../../account-scenarios.md#login-05) | 等待官方授权，有本次有效链接 | 局部受控验证 | 同实例同 ID 的私有有效链接才可打开，OS 受理不代表授权成功，不新建登录 | G1、N1、U3 |
| [LOGIN-06](../../account-scenarios.md#login-06) | 打开本次登录页面成功，继续等待授权 | 局部受控验证 | 同实例同 ID 的私有有效链接才可打开，OS 受理不代表授权成功，不新建登录 | G1、N1、U3 |
| [LOGIN-08](../../account-scenarios.md#login-08) | 官方登录后自动核验身份 | 部分实现 | 官方进程成功且回收后才 verifying，UI 核验时隐藏取消；完整成功链未真实联调 | G1、progress；B5 |
| [LOGIN-02](../../account-scenarios.md#login-02) | 未找到 Codex，安装指引及返回重试 | 待补 | 底层返回 client_missing；新卡片缺安装说明与返回核验流程 | B4 |
| [LOGIN-09](../../account-scenarios.md#login-09) | 核验成功：首次身份，进入确认接入 | 局部受控验证 | 首次来源保留四步，核验后待确认；完整真实官方链未联调 | U6、G1 |
| [LOGIN-10](../../account-scenarios.md#login-10) | 核验成功：仍是 A，保持暂停 | 部分实现 | 复用核验与维护结果；相同身份保持暂停，核验出不同身份才明确确认换号 | G1、OpenaiAction；B5 |
| [LOGIN-11](../../account-scenarios.md#login-11) | 核验成功：发现 B，转核对账号变更 | 部分实现 | 复用核验与维护结果；相同身份保持暂停，核验出不同身份才明确确认换号 | G1、OpenaiAction；B5 |
| [RE-11](../../account-scenarios.md#re-11) | 新登录准备或启动失败，按失败阶段恢复 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [RE-12](../../account-scenarios.md#re-12) | 复合重登结果未知，查询原请求，不重复启动 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [RE-13](../../account-scenarios.md#re-13) | 复合重登取消中、取消完成、取消受阻 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [RE-14](../../account-scenarios.md#re-14) | 新登录启动已提交，复合取消不可用，转新登录取消 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [RE-07](../../account-scenarios.md#re-07) | 原流程已停止，跳过终止并准备新登录 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [RE-10](../../account-scenarios.md#re-10) | 原记录或归属不明，不能安全终止／重试 | 未闭环 | 真实归属／维护阻塞可见，候选不假成功；缺失归属后隔离恢复仍未交付 | H1；B1、B4 |
| [RE-01](../../account-scenarios.md#re-01) | 账号详情主动重新登录，显示暂停告知确认 | 部分实现 | 详情保留主动登录确认与暂停告知；当前走普通 Start，不能当作复合重登 | U3、G1；B1 |
| [RE-02](../../account-scenarios.md#re-02) | 取消发起确认，不改变原接单选择 | 部分实现 | 详情保留主动登录确认与暂停告知；当前走普通 Start，不能当作复合重登 | U3、G1；B1 |
| [RE-03](../../account-scenarios.md#re-03) | 确认发起，暂停后进入官方登录 | 部分实现 | 详情保留主动登录确认与暂停告知；当前走普通 Start，不能当作复合重登 | U3、G1；B1 |
| [RE-04](../../account-scenarios.md#re-04) | 返回同账号 A／不同账号 B | 部分实现 | 普通登录已有 A／B 核验；跨层完整成功分支未验收 | G1；B5 |
| [RE-05](../../account-scenarios.md#re-05) | 登录已超时，提供一次重新登录动作 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [RE-06](../../account-scenarios.md#re-06) | 正在重新启动登录：识别、结束和确认旧流程停止 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [RE-08](../../account-scenarios.md#re-08) | 新登录已启动，移交新登录进度 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [RE-09](../../account-scenarios.md#re-09) | 结束旧流程失败，可安全再次重新登录 | 受阻 | 复合 restart／status／cancel 未实现或广告；停止证明、幂等受理和新登录取消路由未交付 | B1 |
| [PRE-01](../../account-scenarios.md#pre-01) | 接入／换号后的准备接单中 | 部分实现 | 复用既有准备保护，只展示真实 preparing；更多来源与故障后的连续性未验收 | OpenaiAccountCard；B4 |
| [PRE-02](../../account-scenarios.md#pre-02) | 准备成功，按原接单选择继续 | 局部受控验证 | 本次原操作成功且同步／注册／当前供给已核实才完成；切页保留，新故障覆盖，finish 无写 | U1、U6 |
| [PRE-03](../../account-scenarios.md#pre-03) | 准备失败，显示实际原因和重试 | 待补 | 错误可见并可修改读取／重新核验；准备失败后的原来源连续重试、登录修复与准备恢复未闭合 | U5；B2、B4 |
| [PRE-04](../../account-scenarios.md#pre-04) | 重试中，再次成功／失败 | 待补 | 错误可见并可修改读取／重新核验；准备失败后的原来源连续重试、登录修复与准备恢复未闭合 | U5；B2、B4 |
| [PRE-05](../../account-scenarios.md#pre-05) | 需重新登录或修改凭证读取设置才能准备 | 待补 | 错误可见并可修改读取／重新核验；准备失败后的原来源连续重试、登录修复与准备恢复未闭合 | U5；B2、B4 |
| [SUP-13](../../account-scenarios.md#sup-13) | 暂停／恢复长期未知的可执行恢复出口 | 受阻 | Hive 现时快照不能证明暂停／恢复原请求结果；旧 useSupply 查询不等于原结果协议，60 秒原结果 UI 未接通 | B2 |
| [SUP-14](../../account-scenarios.md#sup-14) | 暂停瞬时失败的有限自动重试 | 受阻 | 未增加自动暂停写重试；原意图排序和明确未生效证据缺失时不能重放 | B2 |
| [SUP-15](../../account-scenarios.md#sup-15) | 暂停／恢复遇权限等不可重试问题，转修复 | 未闭环 | 权限错误可见且不自动重放写，修复后原请求持久核对仍缺协议 | T1；B2 |
| [SUP-01](../../account-scenarios.md#sup-01) | 正常可接单 | 共享实现，UI未专项验收 | 复用 useSupply 当前供给与暂停，普通状态无步骤或祝贺页；未全跑旧 UI spec | T1、useSupply |
| [SUP-02](../../account-scenarios.md#sup-02) | 普通暂停，不展示步骤 | 共享实现，UI未专项验收 | 复用 useSupply 当前供给与暂停，普通状态无步骤或祝贺页；未全跑旧 UI spec | T1、useSupply |
| [SUP-03](../../account-scenarios.md#sup-03) | 正在暂停接单，按钮不可重复点击 | 共享实现，UI未专项验收 | 复用平台写和 busy 去重，新按钮沿用暂停／恢复；本轮未验收真实派单 | T1、useSupply；B5 |
| [SUP-04](../../account-scenarios.md#sup-04) | 暂停成功，显示恢复接单，已有任务可完成 | 共享实现，UI未专项验收 | 复用平台写和 busy 去重，新按钮沿用暂停／恢复；本轮未验收真实派单 | T1、useSupply；B5 |
| [SUP-05](../../account-scenarios.md#sup-05) | 暂停明确失败，仍可能接收新任务 | 受阻 | Hive 现时快照不能证明暂停／恢复原请求结果；旧 useSupply 查询不等于原结果协议，60 秒原结果 UI 未接通 | B2 |
| [SUP-06](../../account-scenarios.md#sup-06) | 暂停结果未知，自动核对原操作 | 受阻 | Hive 现时快照不能证明暂停／恢复原请求结果；旧 useSupply 查询不等于原结果协议，60 秒原结果 UI 未接通 | B2 |
| [SUP-07](../../account-scenarios.md#sup-07) | 正在恢复接单，按钮不可重复点击 | 共享实现，UI未专项验收 | 复用平台写和 busy 去重，新按钮沿用暂停／恢复；本轮未验收真实派单 | T1、useSupply；B5 |
| [SUP-08](../../account-scenarios.md#sup-08) | 恢复成功，其他条件满足后可接单 | 共享实现，UI未专项验收 | 复用平台写和 busy 去重，新按钮沿用暂停／恢复；本轮未验收真实派单 | T1、useSupply；B5 |
| [SUP-09](../../account-scenarios.md#sup-09) | 恢复成功但额度不足或仍重连 | 共享实现，UI未专项验收 | ready、paused、reasons 独立；解除暂停不解除额度或连接限制，未验证真实派单 | T1、useSupply；B5 |
| [SUP-10](../../account-scenarios.md#sup-10) | 恢复明确失败，仍暂停，保留恢复接单按钮 | 受阻 | Hive 现时快照不能证明暂停／恢复原请求结果；旧 useSupply 查询不等于原结果协议，60 秒原结果 UI 未接通 | B2 |
| [SUP-11](../../account-scenarios.md#sup-11) | 恢复结果未知，保留暂不可用的恢复接单按钮 | 受阻 | Hive 现时快照不能证明暂停／恢复原请求结果；旧 useSupply 查询不等于原结果协议，60 秒原结果 UI 未接通 | B2 |
| [SUP-12](../../account-scenarios.md#sup-12) | 核对后确认已生效／确定未生效 | 受阻 | Hive 现时快照不能证明暂停／恢复原请求结果；旧 useSupply 查询不等于原结果协议，60 秒原结果 UI 未接通 | B2 |
| [QUOTA-01](../../account-scenarios.md#quota-01) | 额度耗尽，恢复时间已知／允许接单／账号页 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-02](../../account-scenarios.md#quota-02) | 额度耗尽，恢复时间已知／允许接单／详情打开 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-03](../../account-scenarios.md#quota-03) | 额度耗尽，恢复时间已知／已暂停／账号页 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-04](../../account-scenarios.md#quota-04) | 额度耗尽，恢复时间已知／已暂停／详情打开 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-05](../../account-scenarios.md#quota-05) | 额度耗尽，恢复时间未知／允许接单／账号页 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-06](../../account-scenarios.md#quota-06) | 额度耗尽，恢复时间未知／允许接单／详情打开 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-07](../../account-scenarios.md#quota-07) | 额度耗尽，恢复时间未知／已暂停／账号页 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-08](../../account-scenarios.md#quota-08) | 额度耗尽，恢复时间未知／已暂停／详情打开 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-09](../../account-scenarios.md#quota-09) | 额度恢复核验中／允许接单／账号页 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-10](../../account-scenarios.md#quota-10) | 额度恢复核验中／允许接单／详情打开 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-11](../../account-scenarios.md#quota-11) | 额度恢复核验中／已暂停／账号页 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-12](../../account-scenarios.md#quota-12) | 额度恢复核验中／已暂停／详情打开 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-13](../../account-scenarios.md#quota-13) | 额度已恢复／允许接单／账号页 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-14](../../account-scenarios.md#quota-14) | 额度已恢复／允许接单／详情打开 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-15](../../account-scenarios.md#quota-15) | 额度已恢复／已暂停／账号页 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [QUOTA-16](../../account-scenarios.md#quota-16) | 额度已恢复／已暂停／详情打开 | 共享实现，UI未逐项验收 | 沿用 AccountQuota 的当前身份窗口，未知值、真实重置时间和暂停选择独立，详情不复制额度；16 个变体未逐项跑正式 UI 或真实额度恢复 | T1、AccountQuota；B5 |
| [AUTH-04](../../account-scenarios.md#auth-04) | 修改目录／存储或修复系统权限后实际读取与核验 | 局部受控验证 | 私有持久保存及 readback 后 local／official detect；拒绝相对、过长目录与非法 store | U2、R1、T1 |
| [AUTH-01](../../account-scenarios.md#auth-01) | 读取权限不足，原先允许接单 | 局部受控验证 | 权限错误、独立故障和可信暂停保留，同因去重，故障隐藏额度，提供读取设置入口 | U5 |
| [AUTH-02](../../account-scenarios.md#auth-02) | 读取权限不足，原先暂停 | 局部受控验证 | 权限错误、独立故障和可信暂停保留，同因去重，故障隐藏额度，提供读取设置入口 | U5 |
| [AUTH-03](../../account-scenarios.md#auth-03) | 修改凭证读取设置，仅打开面板 | 局部受控验证 | 开关设置不等于修复；保存失败留草稿，关闭切页再开保留；readback 后才核验 | U2、U5 |
| [AUTH-05](../../account-scenarios.md#auth-05) | 修复成功仍是 A，保留最新接单选择 | 部分实现 | 同身份修复需核验和同步／注册证据；不同已核验身份转换号确认；结果未全链路验收 | OpenaiAccountCard、useAccounts；B5 |
| [AUTH-06](../../account-scenarios.md#auth-06) | 读取成功发现 B，进入核对账号变更 | 部分实现 | 同身份修复需核验和同步／注册证据；不同已核验身份转换号确认；结果未全链路验收 | OpenaiAccountCard、useAccounts；B5 |
| [AUTH-07](../../account-scenarios.md#auth-07) | 修复后仍读取失败，保留原因与修复入口 | 局部受控验证 | 权限错误、独立故障和可信暂停保留，同因去重，故障隐藏额度，提供读取设置入口 | U5 |
| [AUTH-08](../../account-scenarios.md#auth-08) | 授权过期且原先暂停 | 未闭环 | 过期／失败不当作换号，普通主动登录保持暂停；安全复合重登和原来源准备连续性仍不足 | G1；B1、B4 |
| [AUTH-09](../../account-scenarios.md#auth-09) | 授权过期但未手动暂停 | 未闭环 | 过期／失败不当作换号，普通主动登录保持暂停；安全复合重登和原来源准备连续性仍不足 | G1；B1、B4 |
| [AUTH-10](../../account-scenarios.md#auth-10) | 取消重新登录确认／完成重登后的暂停保留 | 未闭环 | 过期／失败不当作换号，普通主动登录保持暂停；安全复合重登和原来源准备连续性仍不足 | G1；B1、B4 |
| [CHG-01](../../account-scenarios.md#chg-01) | 发现不同账号 B，保留已接入 A | 部分实现 | 仅已核验不同身份显示换号，确认窗显示 A／B 并校验当前上下文；取消／竞态 UI 未专项验收 | OpenaiAction、T1 |
| [CHG-02](../../account-scenarios.md#chg-02) | 核对账号变更，查看 A 与 B | 部分实现 | 仅已核验不同身份显示换号，确认窗显示 A／B 并校验当前上下文；取消／竞态 UI 未专项验收 | OpenaiAction、T1 |
| [CHG-03](../../account-scenarios.md#chg-03) | 确认换号弹窗／取消确认，保留 A | 部分实现 | 仅已核验不同身份显示换号，确认窗显示 A／B 并校验当前上下文；取消／竞态 UI 未专项验收 | OpenaiAction、T1 |
| [CHG-04](../../account-scenarios.md#chg-04) | 正在换号，随后准备 B | 部分实现 | 复用 confirm_change，三步流程；原操作及同步／注册证据齐备才完成并保持暂停；专属跨层成功未验收 | OpenaiAccountCard；B5 |
| [CHG-05](../../account-scenarios.md#chg-05) | 换号成功，B 保持暂停 | 部分实现 | 复用 confirm_change，三步流程；原操作及同步／注册证据齐备才完成并保持暂停；专属跨层成功未验收 | OpenaiAccountCard；B5 |
| [CHG-06](../../account-scenarios.md#chg-06) | 换号结果待核对／核对中 | 部分实现 | 共享不可变原 ID 查询器、60 秒停止及手动去重；换号 A→B 未知界面与持久恢复仍待补 | U4（共享）；B3 |
| [CHG-07](../../account-scenarios.md#chg-07) | 核对确认已换成 B，保持暂停 | 未闭环 | 只接受匹配原 ID 的确定结果；新身份成功与失败后再次确认 UI／跨重启路径未验收 | operationQuery；B3、B5 |
| [CHG-08](../../account-scenarios.md#chg-08) | 核对确认换号失败，保留 A，可重新核对确认换号 | 未闭环 | 只接受匹配原 ID 的确定结果；新身份成功与失败后再次确认 UI／跨重启路径未验收 | operationQuery；B3、B5 |
| [CHG-09](../../account-scenarios.md#chg-09) | 仍无法确定换号结果，保留 A → B 待核对信息 | 部分实现 | 共享不可变原 ID 查询器、60 秒停止及手动去重；换号 A→B 未知界面与持久恢复仍待补 | U4（共享）；B3 |
| [SYNC-01](../../account-scenarios.md#sync-01) | 自动重连中，允许接单／已暂停两种状态 | 共享实现，UI未专项验收 | 复用连接、供给 reasons 与独立暂停；普通重连无完成态；更多连接文案仍需收敛 | T1、OpenaiAccountCard；B5 |
| [SYNC-02](../../account-scenarios.md#sync-02) | 重连成功，可接单／仍暂停 | 共享实现，UI未专项验收 | 复用连接、供给 reasons 与独立暂停；普通重连无完成态；更多连接文案仍需收敛 | T1、OpenaiAccountCard；B5 |
| [SYNC-03](../../account-scenarios.md#sync-03) | 账号状态信息过期，正在更新 | 局部受控验证 | OpenAI 1／2／4 秒有限失败重试，耗尽停读并可手动查询；纯 snapshot 保留历史证据 | T1、U3 |
| [SYNC-04](../../account-scenarios.md#sync-04) | 更新成功，可接单／仍暂停 | 局部受控验证 | OpenAI 1／2／4 秒有限失败重试，耗尽停读并可手动查询；纯 snapshot 保留历史证据 | T1、U3 |
| [SYNC-05](../../account-scenarios.md#sync-05) | 更新未成功，暂时无法确认账号状态 | 局部受控验证 | OpenAI 1／2／4 秒有限失败重试，耗尽停读并可手动查询；纯 snapshot 保留历史证据 | T1、U3 |
| [SYNC-06](../../account-scenarios.md#sync-06) | 更新发现授权、读取或换号问题，转对应场景 | 部分实现 | 新故障或已核验身份变化替换旧成功提示；各来源恢复出口尚未全部闭合 | U6；B4 |
| [VIEW-01](../../account-scenarios.md#view-01) | 打开／关闭账号详情 | 局部受控验证 | 正式详情可开关，含信息／历史／设置，不复制主步骤、额度和接单操作 | U2、U5 |
| [VIEW-05](../../account-scenarios.md#view-05) | 展开准备进度 | 待补 | 没有可信细分准备证据展开，单有 preparing 时不虚构进度 | B4 |
| [VIEW-02](../../account-scenarios.md#view-02) | 展开／折叠错误详情，同因去重、独立条件保留 | 局部受控验证 | 错误默认折叠，同 check／code／message／evidence 去重，独立错误保留，issue 不重复已有同码同消息 | U5 |
| [VIEW-03](../../account-scenarios.md#view-03) | 查看额度详情，不改变接单选择 | 共享实现，UI未专项验收 | 主卡片额度可展开重置时间，查看不提交接单写；未专项验证所有额度 UI | AccountQuota；B5 |
| [VIEW-04](../../account-scenarios.md#view-04) | 打开／关闭凭证读取设置，不代表已检测修复 | 局部受控验证 | 开关设置不等于修复；保存失败留草稿，关闭切页再开保留；readback 后才核验 | U2、U5 |
| [VIEW-06](../../account-scenarios.md#view-06) | 安装说明的打开与返回，不代表已安装 | 待补 | 底层返回 client_missing；新卡片缺安装说明与返回核验流程 | B4 |
