# Bee App 主预览

历史预览已迁入独立档案库；旧版链接需要先启动归档服务（端口 15500）。见[归档查找与维护](archive.md)。当前主预览和草稿继续在本仓库开发。

[打开唯一主预览](index.html) · [历史版本与确认记录](http://127.0.0.1:15500/docs/preview/history/README.md) · [维护规范](../standard/html-preview.md)

整个 App 使用同一个主入口。2026-11-18 用户确认当前草稿并要求“更新到主预览”。主预览现已纳入紧凑设备卡、正常菜单移除修复入口、连接故障重试，以及绑定／切换／取消结果的“重新核对”，共 638 个场景；原主预览 588 个场景全部保留。

[打开当前主预览](index.html?scene=device-service&theme=light&size=narrow) · [已认可冻结版](http://127.0.0.1:15500/docs/preview/history/20261118-114315-approved-device-fault-actions/index.html?scene=device-service&size=narrow)。`draft.html` 保留本次评审稿，当前没有新增待评审差异；后续调整仍在草稿进行。

本次只同步 HTML 与说明，不修改正式应用代码。2026-11-17 的正式 React 组件记录仍见[历史冻结记录](http://127.0.0.1:15500/desktop/tests/fixtures/bee-preview/history/20261117-153033-approved-binding-repair/SOURCE.md)。页面使用模拟数据，不接真实登录或业务，HTML 认可不代表正式应用或真实 Hive 已验收。

以下章节记录各轮交付时的范围与状态；2026-11-17 概览简化和 2026-11-18 故障核对草稿现均已获本次认可并纳入主预览。完整交互验证沿用草稿验证，本次另核对场景完整性、主入口显示与关键操作。

## 已认可：设备故障与重新核对（2026-11-18）

[打开当前草稿](draft.html?scene=device-service&theme=light&size=narrow) · [正常菜单](draft.html?scene=device-normal-menu&size=narrow) · [连接超时](draft.html?scene=device-connection-timeout&size=narrow) · [未知错误](draft.html?scene=device-status-unknown&size=narrow) · [结果未确认](draft.html?scene=device-binding-unknown&size=narrow) · [完整冻结稿](http://127.0.0.1:15500/docs/preview/history/20261118-112829-device-fault-actions/draft.html?scene=device-service&size=narrow) · [历史索引](http://127.0.0.1:15500/docs/preview/history/README.md)

落实用户确认的文字 UI：正常设备菜单只保留“切换 Hive”；设备凭据确实失效时显示“修复设备绑定”。连接拒绝、HTTP 503 和超时显示具体原因及“重试连接”，不据此推荐重绑或升级。未识别错误保留实际错误摘要、详情与“重新核对”。绑定、切换和取消结果未确认时统一使用“重新核对”，查询期间不可重复点击，结束后区分成功、仍未完成和仍未知。切换结果未知保留“取消切换”，取消结果未知不重复取消。

沿用上轮紧凑布局：当前故障与操作集中在设备卡，设备资料在卡底；保留账号自身问题、身份、暂停选择及 OpenAI 双窗口额度。绑定或切换确认完成后，接入入口仍位于账号区。

新增“设备与 Hive / 故障与核对”分组，含 40 个可直接选择的正常、故障、错误详情、核对进行中及结果分支；原 598 个入口保留，共 638 个。默认打开 HTTP 503。用户已确认本版 HTML，现已同步到 `index.html`；正式应用代码未在本轮更新。

验证包括受影响场景的浅色紧凑／深色宽屏显示、重试成功与失败、状态／绑定／切换／取消核对结果、恢复后保留暂停、详情与键盘焦点、重置和场景切换取消旧模拟操作。所有数据和结果都是本地预设，不访问真实 Hive。

修改前复用字节一致的 `20261117-211505-compact-device-overview/draft.html`；交付冻结于 `20261118-112829-device-fault-actions`，包含本轮草稿、修改前稿、认可主预览和全部对照 HTML。

## 上一轮待评审：概览设备区简化（2026-11-17）

[打开当前草稿](draft.html?scene=compact-startup-failure&theme=light&size=narrow) · [完整冻结稿](http://127.0.0.1:15500/docs/preview/history/20261117-211505-compact-device-overview/draft.html?scene=compact-startup-failure&theme=light&size=narrow) · [历史索引](http://127.0.0.1:15500/docs/preview/history/README.md)

针对真实截图中“切换已取消、设备绑定完成、当前网络故障、账号接入引导”同时展开的问题：设备卡只展开当前故障与操作，设备身份放在底部；已结束的切换和绑定收成可关闭的简短反馈；接入入口留在账号区。只有进行中的绑定与 Hive 切换保留展开步骤。独立账号故障、已知身份、暂停选择和 OpenAI 双窗口额度仍保留；未知值显示 —。

新增 10 个“概览 / 设备区简化”入口，原有 588 个入口保留，共 598 个。包含截图组合故障、诊断、重试进行中、重试失败／成功、独立授权过期、绑定完成、配对中、切换中及正常状态。默认打开截图组合场景。该稿待评审，`index.html` 和正式应用代码未修改。

已检查浅／深色、820 × 680／1080 × 700、关闭反馈不隐藏故障且重试后不重新弹出、诊断详情与焦点返回、键盘菜单、主题／尺寸保留弹层输入、重试失败／恢复后保留暂停和独立故障、网页明确确认后完成绑定、切换进行中及取消、重置和切场景中断旧模拟任务。HTTP 503 与连接拒绝分别保留具体证据，不据此推断协议不兼容。全是静态预设，不访问真实 Hive。

修改前草稿复用 `20261117-153033-approved-binding-repair/draft.html`，已核对字节一致；本轮冻结新草稿、修改前草稿、认可主预览及全部对照 HTML，独立打开后交付。

当前开发 worktree：`/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-setup-failure-preview`，分支 `codex/bee-setup-failure-preview`。历史版本与确认记录在独立档案库；下方其它 worktree 和旧端口为历史记录。

在本 worktree 根目录运行：

```sh
python3 -m http.server 1497 --bind 127.0.0.1 --directory docs/preview
```

固定访问地址：<http://127.0.0.1:1497/index.html>。支持 `scene=onboarding|recovery|ready`、`theme=light|dark`、`size=narrow|wide`。

## 待评审：设备绑定修复视觉优化（2026-11-17）

[绑定故障](draft.html?scene=rebind-fault&theme=light&size=narrow) · [配对确认](draft.html?scene=rebind-pair&theme=dark&size=narrow) · [恢复进度](draft.html?scene=rebind-tasks&size=narrow) · [完成](draft.html?scene=rebind-complete&size=narrow) · [启动恢复](draft.html?scene=rebind-config) · [修改前同场景](http://127.0.0.1:15500/docs/preview/history/20261116-175535-inline-binding-repair/draft.html?scene=rebind-fault&size=narrow) · [设备操作菜单](draft.html?scene=rebind-device-menu&size=narrow) · [完整冻结稿](http://127.0.0.1:15500/docs/preview/history/20261117-114138-switch-hive-in-device-menu/draft.html?scene=rebind-fault&size=narrow) · [上一版冻结稿](http://127.0.0.1:15500/docs/preview/history/20261117-111736-binding-repair-visual-polish/draft.html?scene=rebind-fault&size=narrow) · [历史索引](http://127.0.0.1:15500/docs/preview/history/README.md)。

用户确认视觉方案后只调整 `draft.html` 的样式与修复区域的标记结构；文案、场景和流程沿用下方 2026-11-16 方案，`index.html` 和正式代码未修改。本轮 HTML 待视觉评审。

同日补充：用户评审指出设备凭据失效场景下“切换 Hive”按钮不协调，从四个候选中确认把入口收进卡片标题的“⋯”菜单。这一项改变了已认可主预览中“切换 Hive”的入口位置，仅在草稿内生效；纳入主预览前需单独确认。

- 概览设备卡：修复区域以一条分隔线接在设备信息下方，沿用主预览 Hive 切换区的字号与行距（12px 正文、12px 加粗标题），取代原先比卡片标题更大的 16px 标题；卡片标题的更多入口改为 28px 图标按钮，菜单向下展开。
- 故障提示：恢复顶部状态圆点，“设备绑定待修复”用强调色、“等待设备绑定修复”用中性色，不再以表示正常的绿色显示；错误详情入口缩为 24px。
- 配对确认：标签、配对码和有效期收为一行，影响告知改为浅底提示条；紧凑窗口下配对态卡片高度由 564px 降至 365px，AI 账号卡回到首屏。
- 按钮层级：按钮高度由 36px 回到基线 32px，每个状态只保留一个主按钮；取消等低频操作收入操作行右侧的“⋯”菜单，取消确认弹窗的取消按钮用危险色。概览内服务故障不再重复显示第二个菜单入口。
- 恢复进度：按用户要求与主预览进行中场景的呈现方式一致，不新增转圈或步骤条。概览内为标题行加普通状态行，同 Hive 切换进行中；启动恢复页使用设备设置页已有的左侧强调线状态块。
- “切换 Hive”入口：原为信息行右侧的 66×32 描边按钮，按钮文字比同行 11px 信息低约 7.5px，并与标题行的“⋯”上下并列。现与“修复设备绑定”同列于卡片标题的“⋯”菜单，信息行只保留文字（48px → 33px）。菜单打开时聚焦第一个可用项；修复进行中“切换 Hive”在菜单内置灰并保留原提示；Hive 列表与确认弹窗关闭后焦点回到“⋯”。在非修复场景打开该菜单不再改动场景下拉。
- 弹窗与完成态：确认弹窗、证据浮层对齐 Hive 切换弹窗的尺寸、圆角与字号；完成态的设备、Hive、归属账号按设备摘要样式单行排列。

与确认方案文字的三处差异，均由“与主预览场景呈现方式一致”这一补充要求引出：概览内修复区域整体采用 Hive 切换区的 12px 字阶，未使用方案中的 14px 标题和 13px 原因；进度不加转圈；启动恢复页的配对码保持主预览设备设置页的上下排列，未改单行。

验证：46 个修复相关入口在浅色紧凑、深色宽屏下逐一渲染，无横向溢出、缺失文本或越出卡片的元素。浏览器演练故障→检查→配对→网页确认（含错误配对码、切换主题与尺寸保留输入）→完成→空账号页；“⋯”菜单键盘操作与焦点返回、取消确认到已取消；正常检查；HTTP 503 证据浮层与重试；停止核对后继续；启动恢复地址校验至完成；直接选中的进行中场景停留、切场景取消旧任务、重置；Hive 切换等待场景及 Claude 模板。“切换 Hive”入口调整后，另对 17 个 Hive 切换入口、43 个带概览的修复入口和 2 个概览入口共 62 个场景，按浅色紧凑、深色宽屏复查：信息行无按钮、菜单内入口唯一、无横向溢出；演练从菜单打开 Hive 列表、选择目标到切换成功、地址校验报错、切换主题与尺寸保留列表输入、归属与重新绑定确认弹窗、通知来源提示、概览与账号页往返、重置。紧凑窗口下配对与配对码过期两个状态仍略高于一屏（713／689px 对 678px），需在概览内滚动。直接打开 `rebind-complete` 时场景下拉显示“尚未登录 · 首次接入”，修改前后一致，本轮未改。全部为页面内模拟数据，不连接真实 Hive，不代表正式应用验收。

留版：视觉优化修改前复用字节一致的 `20261116-175535-inline-binding-repair`，交付版为 `20261117-111736-binding-repair-visual-polish`；“切换 Hive”入口调整修改前复用字节一致的 `20261117-111736-binding-repair-visual-polish`，新完整留版为 `20261117-114138-switch-hive-in-device-menu`，其中 `before-visual-polish.html` 为视觉优化前完整稿、`before-switch-menu.html` 为入口调整前完整稿，并带齐全部对照 HTML。

## 上一轮待评审：概览内设备绑定修复（2026-11-16，交互方案沿用，视觉见上方）

[概览正常态](draft.html?scene=rebind-device&theme=light&size=narrow) · [绑定故障](draft.html?scene=rebind-fault&size=narrow) · [网页确认与影响告知](draft.html?scene=rebind-pair&theme=dark&size=narrow) · [启动恢复](draft.html?scene=rebind-config) · [历史索引](http://127.0.0.1:15500/docs/preview/history/README.md) · [完整冻结稿](http://127.0.0.1:15500/docs/preview/history/20261116-175535-inline-binding-repair/draft.html?scene=rebind-device)。

本轮落实用户确认的四项重审结论：取消独立设备页；概览设备区更多菜单提供“修复设备绑定”；检查、恢复反馈、配对码和等待进度在设备区原地展开；确需替换设备时，在前往 Hive 网页确认之前提示“重新绑定完成后，需要重新接入 AI 账号。”。首次启动无法进入概览时复用恢复内容，取消仍需弹窗确认。正常检查仅给出简短结果，不重置绑定、不影响原接单选择。

沿用原概览和账号模型，返回 AI 账号页保留原状态；绑定故障以独立条件说明暂不可贡献，正常绑定检查不引入这个阻塞。替换结果确认完成后才进入空账号状态。HTTP 503 重试后重新检查原绑定，不直接新建配对。保留已有主预览的 Hive 切换实现和 17 个起点；修复与切换进行中避免混用两个操作，切换完成后修复使用当前 Hive。

草稿共 588 个直接入口，其中 46 个修复相关入口复用同一内容组件，17 个 Hive 切换入口来自已认可主预览。旧 `rebind-device` 链接现打开概览设备区，页面下拉不再列出独立“设备”页；左下角恢复原有身份展示。旧服务故障链接继续映射到对应修复状态。

验证包括修复入口与正常结果、网页确认到完成及空账号页、取消、HTTP 503 重试、主题尺寸保留输入、概览／账号往返保留暂停与配对码、直接进行中场景停留、切场景取消旧操作、Hive 切换入口及深浅色紧凑布局。全部为页面内模拟，不证明正式应用或 Hive 业务验收。`index.html` 和正式代码未修改；本轮 HTML 待视觉与交互评审。

修改前复用字节一致的 `20261116-165613-rebind-interaction`；新完整留版为 `20261116-175535-inline-binding-repair`，包括全部对照 HTML。

## 历史讨论：独立设备页与重新绑定交互（2026-11-16，已被上方方案替代）

### 后续重审（四项调整已确认，已落实至上方候选稿）

用户已确认两项调整：取消本稿新增的独立设备页，复用概览设备区承载设备资料和低频恢复入口，保留已有“切换 Hive”；常驻恢复入口改名“修复设备绑定”，确需网页重新确认归属时显示“请重新绑定”和“重新绑定 Hive”。普通连接故障仍提供与原因匹配的处理入口，如“重试连接”。

用户随后确认另外两项调整：修复过程在概览设备区原地展开，检查正常或恢复成功时用简短结果反馈结束，需要网页确认时展示配对码、有效期及相关操作；取消确认使用弹窗。首次启动无法进入概览时，在启动恢复页复用同一组内容。确需替换设备时，在前往 Hive 确认的主按钮前说明“重新绑定完成后，需要重新接入 AI 账号。”；直接恢复原绑定时不显示这项影响。

此前已确认的恢复边界继续适用：网页打开不等于用户批准，必须核对配对码并明确确认；确认后显示当前实际等待阶段，停止自动核对时提供“继续核对”，不重新获取配对码；关闭页面不等于取消。取消结果须经确认，取消不自动恢复旧设备接单，也不撤回已完成处理；绑定已经完成则展示完成结果。本机保存失败只继续保存。替换完成后引导重新接入 AI 账号，不自动开始贡献；恢复原绑定则保留账号及接单选择。

恢复机制文档中的“重新绑定 Hive”仍指包含优先恢复原绑定的完整流程；以上是面向用户的动作名称、展示位置与告知时机调整，不改变恢复机制。这四项调整已落实至上方候选稿；下面保留上一轮 HTML 的交付记录，便于与冻结版对照。

### 上一轮 HTML 交付记录

[正常设备页](http://127.0.0.1:15500/docs/preview/history/20261116-165613-rebind-interaction/draft.html?scene=rebind-device&theme=light&size=narrow) · [绑定故障](http://127.0.0.1:15500/docs/preview/history/20261116-165613-rebind-interaction/draft.html?scene=rebind-fault&size=narrow) · [网页确认与配对码](http://127.0.0.1:15500/docs/preview/history/20261116-165613-rebind-interaction/draft.html?scene=rebind-pair&size=narrow) · [停止核对](http://127.0.0.1:15500/docs/preview/history/20261116-165613-rebind-interaction/draft.html?scene=rebind-paused) · [取消确认](http://127.0.0.1:15500/docs/preview/history/20261116-165613-rebind-interaction/draft.html?scene=rebind-cancel-dialog) · [历史索引](http://127.0.0.1:15500/docs/preview/history/README.md) · [完整冻结稿](http://127.0.0.1:15500/docs/preview/history/20261116-165613-rebind-interaction/draft.html?scene=rebind-device)。

依据本会话已确认线框制作；HTML 仍待视觉与交互评审，尚未纳入主预览或正式应用。正常设备页把「重新绑定 Hive」放入右上角更多菜单，绑定故障和配置损坏时直接提供入口。沿用页面内状态提示，不将错误堆到窗口顶部。37 个新增直接入口，加上 9 个旧服务故障链接兼容映射，草稿共 571 个入口；旧故障方案保留在历史快照。

本轮包括原绑定正常／恢复、缺少地址、配对码与有效期、原请求继续核对、Hive 网页明确确认、旧任务与结算等待、停止自动核对、替换与保存、取消确认及未知结果、绑定已提交后的取消核对、完成后重新接入 AI 账号。HTTP 503 提供重试连接；只有明确兼容性证据才提示更新 Bee 或升级 Hive；记录缺失提供管理员处理与诊断出口。正常往返设备页保留原账号页面及暂停状态，替换成功进入现有空账号页。

所有操作都是固定模拟数据；Hive 网页在模态窗口中模拟，需输入配对码并明确确认。确认网址只使用 Hive 同源 `/devices/pair`，不承诺自动填码。更新检查预设为暂无兼容版本；不连接真实更新服务。网页、诊断与剪贴板仅包含示例数据。关闭网页弹窗继续原请求；预览页刷新按 URL 场景起点恢复，不能据此宣称真实应用重启持久化已验收。

验证：46 个相关直接入口能渲染且无横向溢出；9 个直接选中的进行中阶段保持静态。浏览器演练正常检查、错误配对码校验、网页明确确认到替换完成、取消终态、继续保存、确认前换码／确认后续查、账号页往返仍暂停、切场景取消旧任务；检查主题与尺寸保留弹窗输入、菜单键盘与焦点、深浅色紧凑布局。主预览和正式代码未修改。

修改前复用字节一致的 `20261116-154817-setup-service-failure`；交付版本冻结至 `20261116-165613-rebind-interaction`，含全部对照 HTML。来源为本节上方标明的 worktree 与分支。

## 历史讨论：首次启动服务故障与身份核对（2026-11-16，已被上方方案替代）

[打开本轮待评审稿](draft.html?scene=setup-service-blocked&theme=dark&size=narrow) · [Hive 已恢复但身份未确认](draft.html?scene=setup-service-available) · [当前主预览](index.html?scene=setup-unknown) · [历史索引](http://127.0.0.1:15500/docs/preview/history/README.md) · [完整冻结稿](http://127.0.0.1:15500/docs/preview/history/20261116-154817-setup-service-failure/draft.html?scene=setup-service-blocked)。

用户同意先补组合故障预览，再按认可结果同步主预览与正式实现。本轮 HTML 待评审。工作入口是当前 Bee checkout 的 `docs/preview/draft.html`；下方早期 worktree 限定为历史记录。主预览 `index.html` 保持原内容。

故障统一放入居中的设备设置内容区，主状态为“绑定结果待确认”；分别保留 HTTP 503 和设备身份不足以应用网络设置的事实。一个主要按钮打开 Hive 控制台，次要操作检查原绑定结果。叹号详情保留两项证据、独立启动状态核对及诊断入口。Hive 可访问不代表绑定已确认，不生成新配对码、不开始贡献。

在原草稿 525 个入口上新增 9 个可直接选择的子场景，共 534 个：服务不可用、检查绑定中、检查后仍不可用、服务恢复但身份未确认、错误详情、启动核对中、启动核对后身份未确认、控制台、诊断。此前草稿内容保留；它与主预览的场景集合不同，后续纳入主预览时只合入本轮认可部分。

已在浏览器验证新增入口、两种窗口尺寸（820 × 680、1080 × 700）、浅深色、无横向溢出、叹号和 Escape 焦点返回、外观/尺寸切换保留详情、原绑定及启动核对、控制台返回、诊断返回与模拟 JSON 导出、重置和切场景取消旧检查；原配对网址异常入口作定点回归。历史稿独立打开复查。全部为静态预设，不访问真实 Hive，不代表真实故障修复或恢复流程验收。

启动当前预览：在 Bee 根目录运行 `python3 -m http.server 1497 --bind 127.0.0.1 --directory docs/preview`，打开 <http://127.0.0.1:1497/draft.html?scene=setup-service-blocked&theme=dark&size=narrow>。产品资源全部内联；冻结稿带齐本轮对照 HTML，早期版本的进一步历史跳转可能需要档案库 15500 服务。

## 待评审：首次绑定异常页操作层级（2026-11-13）

[打开本轮待评审稿](draft.html?scene=setup-unknown&theme=light&size=wide) · [直接查看叹号详情](draft.html?scene=setup-unknown-details&theme=dark&size=narrow) · [本轮完整冻结稿](http://127.0.0.1:15500/docs/preview/history/20261113-110233-pairing-error-actions/draft.html?scene=setup-unknown)。用户已确认文字布局；本轮 HTML 待评审，主预览继续使用已认可版本。

配对网址验证失败场景按“状态 → 具体原因 → 下一步 → 操作”组织。只突出“打开 Hive 控制台”；“重新检查绑定结果”为次要文字按钮；“查看诊断”位于圆圈叹号详情底部，详情保留原始错误与校验要求。诊断可返回原详情并导出标记为模拟数据的 JSON。

保留原有 519 个场景，新增 6 个子场景，待评审稿共 525 个入口：检查后已绑定、正在检查、仍未确认、错误详情、Hive 控制台及诊断。直接选择进行中会停留；从产品按钮发起才按预设推进，已绑定结果经过确认身份与保存阶段。默认失败起点检查后仍待确认，不自动重建配对。设备设置的定位消息校验原场景，防止快速切场景后旧消息改回下拉位置。

浏览器已检查浅深色、1080 × 700／820 × 680、单一主按钮与无横向溢出、详情键盘打开／关闭／焦点返回、切外观与尺寸保留浮层、控制台返回、检查两种结果、诊断返回与模拟导出、重置起点及切场景取消旧检查。冻结稿与对照入口在交付前独立打开复查。

修改前复用 `20261112-190918-add-error-details/draft.html`，已核对字节一致；本轮冻结全部内联内容和对照依赖。控制台、已有绑定及错误均为页面内模拟，不连接真实 Hive，不证明原配对网址错误已修复；正式 App 未在本轮修改。

## 已认可并纳入：三步添加 OpenAI 账号（2026-11-13）

最新调整：错误原因旁使用圆圈叹号打开详情浮层，替代文字折叠入口。[查看错误场景](index.html?scene=add-permission) · [本轮冻结稿](http://127.0.0.1:15500/docs/preview/history/20261112-190918-add-error-details/draft.html?scene=add-permission)。已检查八类错误的打开、关闭与键盘焦点。

[打开添加向导](index.html?scene=add-platform) · [读取位置表单](index.html?scene=add-settings) · [接入后原有卡片](index.html?scene=add-preparing) · [冻结版本](http://127.0.0.1:15500/docs/preview/history/20261112-183023-add-account-wizard/draft.html?scene=add-platform) · [已确认流程](../desktop/add-account-design.md)

文本与 HTML 均已确认，已纳入主预览。使用现有 Bee 外壳，新增“选择平台 → 连接账号 → 确认接入”。空状态直接选平台；第二步提供官方登录与读取位置两条路径；读取表单底部只有“保存／返回”。接入成功后只展示已接入账号，复用既有 OpenAI 卡片，不改卡片的准备与完成反馈。

新增 38 个场景，主预览共 519 个入口；原有 481 个入口保留作对照。旧首次添加场景不是新向导入口。主预览 `index.html` 已纳入本轮设计。Claude 选项进入既有 Claude 预览，未重做或验收其三步流程。

浏览器已验证：全部 38 个入口的内容、选择器同步、无横向溢出与直接进行中停留；登录和目录读取两条连续路径；确认返回再继续；目录草稿在返回、主题／尺寸切换后保留；修改错误目录后恢复；取消登录返回连接方式；接入未知结果查询后回到既有卡片；历史暂停保留；账号变化后重新确认；切场景取消旧任务；重置起点；目录选择弹层 Escape 和焦点返回。浅色／深色、820／1080 窗口做视觉检查。

所有数据与结果为静态预设，不读取本机凭证、不连接 Hive、不发起官方授权。目录选择器为页面内模拟；打开登录页面后由预设模拟授权完成，不能作为真实登录成功的依据。接入权限拒绝、历史查询失败等不可凭按钮自动修复的预设保持阻塞。

修改前草稿复用 `20261112-150523-setup-error-clarity/draft.html`，已核对字节一致；主预览基线复用 `20261112-152533-approved-first-launch/index.html`。本轮历史包含完整内联稿和冻结对照依赖。

本次纳入留版：[完整主预览快照](http://127.0.0.1:15500/docs/preview/history/20261113-104743-approved-add-account/index.html?scene=add-platform)。保留已认可来源稿以供对照；认可标记以本说明和历史索引为准。

## 先前待评审：主动重新登录与换号

以下为 2026-11-05 的交付记录；当前草稿以“OpenAI 完整场景草稿”一节为准。当时主预览为已认可的三个场景，待评审稿保留这三个场景，新增“主动重新登录（返回不同账号）”与“发现不同账号，待确认”，共五个起点；不代表完整账号场景清单。

- 不同身份流程：选择“主动重新登录（返回不同账号）” → OpenAI 详情 → 重新登录 → 开始官方登录 → 自动核验 → 查看新旧账号 → 确认换号 → 确认更换 → 自动准备 → 手动恢复接单。
- 同身份对照：从“可接单”进入详情并重新登录，预设返回原身份，完成后仍暂停；手动恢复后隐藏步骤。
- 直接选择“发现不同账号，待确认”会停留供评审；查看详情、取消确认均保留原账号。

访问：<http://127.0.0.1:1496/draft.html?scene=relogin-different>。新增 `scene=relogin-different|change`；外观和窗口参数沿用主预览。

本轮区分：

| 类别 | 结果与边界 |
| --- | --- |
| 界面 | 沿用轻量步骤与独立按钮；核验发现身份不同后转入换号步骤；明确新旧身份与换号后暂停。修复详情自动更新时焦点丢失，以及恢复接单后焦点未回到操作按钮。 |
| 预览模拟 | 接通登录返回不同身份与显式换号流程；原账号只在确认后替换。取消、切场景可中断旧任务；同身份登录保留暂停。 |
| 真实实现待核实 | 官方登录结果读取、身份比较依据、平台暂停确认、换号持久化和准备成功条件均未核实；固定延迟模拟不能证明真实实现通过。读取失败、登录失败、换号结果未决和后台刷新／重启保留选择未在本轮新增演示。 |

浏览器已检查首次接入、授权恢复、同身份重新登录、不同身份换号、取消登录／换号、Escape 焦点返回、自动准备后的面板焦点、场景切换中断、异常起点停留、深浅色和两种尺寸；完成后步骤隐藏。历史稿与当前待评审稿内容一致，并单独打开检查。

## 已认可并纳入主预览：额度等待（2026-11-06）

[打开额度场景](index.html?scene=quota-known-allowed)。用户已认可该 HTML，主预览保留原有三个场景并新增额度等待；其他候选仍在 draft 中评审。额度耗尽属于正常等待，暂停／恢复按钮在额度核验中仍可操作；按钮不改变额度。新增子场景覆盖恢复时间已知／未知、核验中、额度恢复，各自提供允许接单／暂停和详情状态；直接选择均停留，重置回到最后直接选择的起点。

本轮仅验证 HTML 中的接单按钮、详情、子场景定位、重置及外观尺寸保留状态。额度窗口自动恢复通过直接选择子场景查看，未模拟真实时间流逝或验证后台接单。本次仅将认可的额度场景纳入主预览，正式实现未修改。额度方案已记录到账号设计文档，其余未要求落盘的讨论不作扩展。


## 上一版待评审：OpenAI 完整场景草稿（2026-11-09）

[打开草稿](http://127.0.0.1:1496/draft.html?scene=onboarding) · [冻结版本](http://127.0.0.1:15500/docs/preview/history/20261109-120904-openai-scenarios-draft/draft.html?scene=onboarding)

本轮仅更新 `draft.html` 与预览索引、历史；`index.html` 保持原样。复用 Bee 外壳和已有 Claude 内容。依据账号设计记录截至 `08b8451` 的确认规则，以共享视图承接 108 个场景索引条目，共 200 个可直接选择的子场景；不是 108 份独立页面，也不代表正式 UI、接口或真实业务验收完成。HTML 仍为**待评审**。

| 范围 | 入口与重点 |
| --- | --- |
| IN-01～12、LOGIN-01～15 | [首次接入](draft.html?scene=onboarding)、[无历史选择确认](draft.html?scene=intake-no-history)、[官方登录等待](draft.html?scene=first-login-wait)；接入保留原有／期间最新接单选择，查询失败不按无历史处理 |
| RE-01～14、CHG-01～09 | [从详情重登](draft.html?scene=relogin-different)、[核对账号变更](draft.html?scene=change-found)、[进度未知](draft.html?scene=restart-unknown)、[归属不明](draft.html?scene=restart-blocked)；主动重登及确认换号保持暂停，旧流程安全结束后才启动新登录 |
| PRE-01～05、VIEW-05 | [准备进度](draft.html?scene=prep-evidence-paused)、[准备失败](draft.html?scene=prep-prepare-failed-allowed)；数字步骤只标记可信完成／失败节点，进度只读，无虚构百分比或倒计时 |
| SUP-01～15、QUOTA-01～16、SYNC-01～06 | [正常接单](draft.html?scene=ready)、[额度等待](draft.html?scene=quota-known-allowed)、[恢复长期未知](draft.html?scene=resume-long)；额度和暂停选择独立，普通状态不常驻步骤 |
| AUTH-01～10、VIEW-01～06 | [读取设置](draft.html?scene=settings-allowed)、[保存失败](draft.html?scene=settings-settings-failed-paused)、[账号详情](draft.html?scene=view-detail)；保存／取消明确，失败保留输入，保存成功后再读取核验；详情不重复步骤、接单按钮或完整额度区 |

场景按“接入／接单／授权问题／变更与恢复 → 流程 → 子场景”组织。直接选择停留；点击产品按钮才按预设推进，选择器只同步位置，不重新初始化。重置回到最后直接选择的起点；切场景取消旧模拟任务。外观和尺寸切换保留输入、操作及弹层。URL 的 `scene` 记录最后直接选择的评审起点，`theme=light|dark`、`size=narrow|wide` 可分享；未知参数回落到首次接入、浅色、紧凑窗口。旧 `recovery`、`change` 与额度入口仍可使用。

### 静态模拟与尚未闭合的能力

所有账号、额度、错误证据、动作许可和阶段结果均为本文件内的静态预设，不读取真实凭据、不启动真实 Codex、不调用 Hive。产品按钮没有外置“模拟成功”控制。进行中起点保持静止以供评审；自然后台进度由独立子场景查看。设置保存失败起点预设首次重试仍失败、下一次保存成功，随后仍需读取核验，不能把保存回执当作修复。

- **IN-11／IN-12**：接入准备保护已有实现与测试（`eefb0ec`），但纯只读原操作核对、长期未知恢复及界面可判别“确无历史选择”的完整链路仍需集成核验。草稿区分未接入、结果未知与已接入但准备中。
- **LOGIN-04～07、RE-05～14**：取链、安全打开、细分进度、一次安全重新登录及提交边界取消仍有仅契约／静态样本部分；普通启动／查询／取消已有接口，不能一概称为未实现。草稿只在预设明确允许时演示安全动作。
- **LOGIN-15／RE-10／RE-12**：归属不明或长期未知的实际恢复出口尚未闭合。无安全许可时展示阻塞证据，不伪造“重新登录”成功，不使用永远有效的重试按钮。RE-12 保留步骤，“刷新登录进度”只查询原操作。
- **SUP-13／14／15**：当前暂停状态快照不能证明某次未知写入的终态；单次操作追踪、有限重试与防覆盖仍待补齐。持续自动核对时不加手动刷新，未知恢复按钮保留但暂不可用；这些页面不代表长期恢复闭环已经实现。修复不自动重放原接单请求。
- **AUTH-04／VIEW-05**：明确保存／取消、保存后读取核验的接口联动仍需验收；完整准备细分字段尚未向界面交付。草稿同时提供“只有准备中事实”和“可信细分预设”两种展开，不能把预设当成真实接口输出。

接口边界参考本轮只读核对会话 `01a1be69-0975-7c51-8cd1-17ca9b8500ee`，不修改其他会话使用中的场景设计文档或接口文件。

### 本轮验证与留版

浏览器检查 200 个直接入口（关联 108 个索引编号）：状态、弹层、数字节点及无自动定时推进；核验阶段无取消登录，取消中／已取消不显示推进步骤，详情不复制主界面操作。重点演练接入保留允许／暂停与期间最新选择、同号重登、异号确认及取消、准备与核验失败、设置失败保留输入／取消不保存／保存后再核验、原操作核对不同结果、复合取消与新登录取消移交、额度开关独立、切场景取消旧任务、重置起点、主题尺寸保留输入、键盘 Tab／Escape 与焦点返回。检查浅色紧凑、深色宽屏布局及完整历史文件独立打开。只验证静态 HTML，不运行无关业务测试。

修改前复用内容完全一致的 `20261106-104056-quota-waiting-draft/draft.html`；本轮冻结为 `20261109-120904-openai-scenarios-draft/draft.html`。两份均为完整单文件，无外部运行依赖；当前主预览 SHA-256 仍为 `6e36f3c2adfbf3fee34fc0184d2c6487337bb4c573b44310f82c79ad9a8f03bb`。

## 历史交付：仅首次登录流程连续性（2026-11-09 17:53）

[体验完整流程](draft.html?scene=onboarding) · [直接看核验完成](draft.html?scene=first-candidate) · [修改前对比](http://127.0.0.1:15500/docs/preview/history/20261109-120904-openai-scenarios-draft/draft.html?scene=intake-candidate-allowed) · [本轮冻结版](http://127.0.0.1:15500/docs/preview/history/20261109-175305-first-login-continuity/draft.html?scene=onboarding)

本轮仅试做从首次登录进入接入准备的流程。登录、核验账号、确认接入、准备接单四步保留编号；步骤移到身份信息下方，状态和按钮区预留空间。核验成功仍保留前两步的完成记录，确认接入后推进第三、第四步；准备完成后按接单选择显示结果。直接从已登录账号接入仍显示两步，主动重登、授权恢复、读取修复、换号等流程尚未采用这次布局调整。

新增 11 个首次登录来源的独立子场景，累计 211 个入口，仍关联原有 108 个索引条目。主预览、正式代码、`accounts-preview-design.md` 和 `account-scenarios.md` 均未修改；本轮为待评审效果稿，确认后再同步文档并考虑其他流程。

已用浏览器验证首次登录至接入、准备及完成，三个推进阶段步骤区纵坐标一致；检查新增状态直接停留、步骤数字与失败节点、取消接入确认、主题尺寸、Escape、重置及原有两步接入／三步重登／无步骤额度场景。完整单文件历史版已独立打开核对。真实接口能力与未闭合边界沿用上一版说明。

## 已认可专项：首次登录完成确认（2026-11-09 18:02）

[直接看成功界面](draft.html?scene=first-success&theme=light&size=narrow) · [完整登录流程](draft.html?scene=onboarding) · [本轮冻结版](http://127.0.0.1:15500/docs/preview/history/20261109-180232-first-login-completion/draft.html?scene=first-success)

首次登录准备成功后，四个数字步骤全部完成，卡片停留显示“账号接入成功！”与实际接单条件。点击“完成”收起步骤与成功提示，进入普通账号卡片；此按钮只确认已读，不控制接单、不解除暂停。暂停与额度等待分别显示对应说明。新增 first-success、first-success-paused、first-success-quota 三个直接入口，累计 214 个入口。其他流程、主预览、正式代码及两个账号设计文档本轮不改。

浏览器验证完整首次登录到成功确认、三个完成分支与点击后接单选择保持、重置起点、主题尺寸保留完成态、键盘 Enter 和焦点回到接单按钮；冻结单文件独立打开检查。修改前复用字节一致的 20261109-175305 快照；本轮仅静态模拟，未验证真实接口。

### 2026-11-09 用户确认与文档同步

用户已认可首次登录连续四步与成功完成态，规则已同步至 [设计记录](../desktop/accounts-preview-design.md) 和 [场景索引](../desktop/account-scenarios.md)。认可范围仅限此流程，整份草稿及其他场景不因此认可。本轮只更新文档与确认记录，不修改 HTML 或正式代码；主预览暂未合入本次专项。用户先测试当前场景，再决定其他流程是否调整；测试入口及候选调整点见场景索引“其余待测试、再决定是否调整的流程”。

## 独立新版对比：连续步骤与完成反馈（2026-11-09 18:20，待评审）

[新版](flow-comparison.html?scene=intake-candidate-allowed&theme=light&size=narrow) · [旧版](draft.html?scene=intake-candidate-allowed&theme=light&size=narrow) · [冻结对比版](http://127.0.0.1:15500/docs/preview/history/20261109-182012-continuous-flows-comparison/flow-comparison.html?scene=intake-candidate-allowed)

用户授权制作独立新版对比。旧 draft.html 保留原样，包括开始本轮前已有的未提交工具栏调整；index.html 和正式代码不改。一级场景使用原完整分组名（例如“接入 / 接入账号”），二级保持原选项名；新增完成态留在对应分组。新版工具栏提供“打开旧版同场景”，比较普通结果时按账号来源和暂停／额度条件选择旧场景。

新版将固定步骤位置、状态与按钮留白扩展到已登录账号接入、重新登录、授权恢复、读取修复及换号。接入两步、换号三步；重登与读取修复保留核验，实际经过准备时保留准备节点至完成。完成态四类文案区分接入、重登／授权恢复、读取修复和换号；点击“完成”只收起反馈，不更改账号、暂停或额度。登录超时重试说明先安全结束旧登录再启动新登录。取消／未知状态沿用既定边界，不虚构完成。普通接单开关、自动重连等不增加祝贺页。

修改前快照为 20261109-181751-before-flow-comparison；交付快照为 20261109-182012-continuous-flows-comparison。后者同时冻结新版与旧版完整 HTML，可独立打开及对比。本版仍为静态模拟；不代表已认可为设计基线或真实接口验收，不修改两个设计文档中的已确认结论。

## 2026-11-09 18:40：新版已认可并纳入主预览

已同步两个账号设计文档与场景索引。主预览只调整页面标题与预览标识，交互沿用用户认可的 flow-comparison.html；复用上一轮浏览器验证结果。旧主预览归档复用 `docs/preview/history/20261106-104743-approved-quota/index.html`，本轮冻结版为 [打开](http://127.0.0.1:15500/docs/preview/history/20261109-184032-approved-continuous-flows/index.html?scene=intake-candidate-allowed)。冻结目录同时保存旧版 draft，支持独立对比。旧版和对比页未改写；此前待评审／未合入描述为当时记录，以本节为准。正式前后端代码未修改。

## 状态详情收敛（2026-11-09）

按用户确认同步主预览和新版对比页，旧 draft 保留。移除重复正文的通用详情，暂停／独立连接条件直接展示；错误证据、原操作核对记录与可信细分准备进度按需展开，账号详情及额度区保留。修改前复用 184032 主预览与 182012 对比页完整快照。本轮冻结于 [历史版本](http://127.0.0.1:15500/docs/preview/history/20261109-184518-concise-state-details/index.html?scene=intake-retry-paused)，包含两份新版与旧 draft。仅调整静态呈现，不改变业务操作。

## Claude macOS 待评审草稿（2026-11-10）

[完整首次登录](draft.html?scene=claude-onboarding) · [等待终端登录](draft.html?scene=claude-first-login-wait) · [打开终端失败](draft.html?scene=claude-first-login-failed) · [找不到窗口](draft.html?scene=claude-terminal-lost) · [冻结版](http://127.0.0.1:15500/docs/preview/history/20261110-115235-claude-terminal-review/draft.html?scene=claude-first-login-wait)

本轮在 draft.html 保留原有 OpenAI 草稿及未提交的两级工具栏调整，新增 216 个 Claude 直接入口，共 430 个入口。Claude 共用流程取自最新主预览的连续步骤与完成反馈，按接入、接单、授权问题、变更与恢复分组；删除不适用的 Codex 取链／补开页面，只为 macOS Terminal 登录提供差异呈现。主预览 index.html 未修改，Claude HTML 待用户评审；不扩展 OpenAI 正式实现任务。

已确认文本差异：Bee 自动打开 Terminal，用户按终端／浏览器提示完成；等待页仅有取消登录，不虚构返回终端能力；找不到窗口提示从 Dock 切换。打开终端被明确拒绝时允许安全重试，回执不明沿共用原操作核对。首次未核验身份时不展示虚构账号 A。配置目录、存储方式、保存／取消、读取核验、重登确认、错误信息都沿用共用结构，选项按实际平台支持填写；当前以 macOS 钥匙串为默认，文件读取与官方登录存储不一致时不模拟静默切换。

全部为静态模拟：不打开真实终端、浏览器授权，不读取凭证，不调用业务接口。点击产品操作后由场景预设模拟官方结果；直接选中阶段保持停留。套餐和额度均为合成示例，不能据此承诺真实字段或数值。其他操作的长期未知／归属恢复边界继承主预览，未用伪成功填补真实接口缺口；非 macOS 登录未验收。

验证：216 个 Claude 直接入口渲染、无意外定时推进及无 Codex 打开页面按钮；浏览器演练首次登录→核验→确认接入→准备→完成、打开失败重试、取消到终态、同号重登仍暂停、配置目录保存及重登告知、主题／尺寸保留输入、切场景取消旧任务。深色紧凑与浅色宽屏目视检查；完整冻结版独立打开。此记录不宣称真实业务通过。

修改前完整保存 20261110-114307-before-claude-draft（含已有未提交草稿和当时主预览）；交付冻结为 20261110-115235-claude-terminal-review。两者均为完整内联 HTML。原 OpenAI 工作草稿仍保留，Claude 单独模板复用最新主预览以避免覆盖其他会话修改。

## 已认可概览纳入主预览（20261110-180055）

默认入口现为概览，可通过页面下拉或应用导航进入 AI 账号；已有账号场景完整保留。概览使用已认可状态优先双卡布局，设备资料弱化显示，移除空顶栏、静态底栏及重复管理入口。账号处理入口定位对应平台，恢复流程沿用账号页。概览与账号页共享同一份预览账号状态；仅静态模拟，不接真实业务。

[概览](index.html?scene=overview-attention) · [原账号首次接入](index.html?scene=onboarding) · [本次完整快照](http://127.0.0.1:15500/docs/preview/history/20261110-180055-approved-overview/index.html)

最终验证：共 229 个入口（原账号 227 + 概览 2）。检查概览首次加载、两平台暂停与返回、重置、深浅色／宽窄尺寸、原首次接入及额度链接。额度取自原账号预览，候选稿固定数值不作为另一份状态来源。正式实现、草稿与账号规格均未修改。最终完整快照：[打开](http://127.0.0.1:15500/docs/preview/history/20261111-022040-approved-overview-final/index.html)。


## 2026-11-11 已认可紧凑列表与错误浮层

当前主预览已合入账号四列布局、固定额度区和状态旁错误详情浮层，并保留已认可概览及连续流程。通过一级场景“紧凑列表 / 评审”直接查看缺凭证、正常、耗尽和未知状态。错误原因为正文，证据在 ⓘ 浮层；历史与未知额度不伪装为当前值。详细确认与冻结入口见历史索引。

## 启动恢复（2026-11-11）

[旧会话阻塞](index.html?scene=startup-blocked) · [真实阶段示意](index.html?scene=startup-preparing) · [后台连接失败](index.html?scene=startup-stopped)。新增 7 个静态模拟起点；直接选中的进行中状态保持不动。核对不会启动服务，重新连接预设进入旧任务核对阻塞；诊断只导出模拟数据。正式执行阶段由原生状态驱动，HTML 不证明远端旧任务已经退出。


## 概览向 AI 账号页对齐（20261111-144208）

按用户确认保留两个页面；AI 账号页既有布局、样式、账号逻辑和全部场景保持原样。概览复用账号页的导航、标识、字体、颜色、卡片和按钮风格，保留状态优先布局及弱化的设备信息；账号行精简为身份、当前状态、必要独立条件、摘要额度和操作入口。

“需处理”只统计需要介入的授权、读取、明确操作失败等情况及等待用户完成的登录，不计入普通暂停、额度等待、自动重连或自动核对。修复现有导航包装层未转交平台参数的问题，前往处理定位原账号，返回概览恢复入口焦点。未重做账号处理流程。

[当前概览](index.html?scene=overview-attention&theme=light&size=narrow&page=overview) · [本轮完整快照](http://127.0.0.1:15500/docs/preview/history/20261111-144208-overview-account-style/index.html?scene=overview-attention&page=overview)。修改前复用与当时主预览字节一致的 20261111-121407-startup-recovery-verified；冻结目录同时保留旧版对照文件。

验证：14 个相关场景的计数，账号定位与返回焦点，两平台暂停／恢复，浅深色 × 宽窄尺寸的布局与无横向溢出，以及启动阻塞不显示普通概览。主预览和新增冻结版均可打开。本轮只改静态预览及其记录，未修改正式代码；不代表真实业务验收。


## Claude 同步主预览账号布局（20261111-145858，待评审）

Claude 草稿沿用当前主预览 OpenAI 的紧凑四列布局、固定双窗口额度、状态旁 ⓘ 错误证据浮层与步骤展示方式。保留 macOS Terminal 登录、配置目录和钥匙串差异。补充正常、耗尽、未知额度和凭证缺失四个入口；Claude 共 220 个可直接查看的起点。

[正常账号](draft.html?scene=claude-compact-normal&theme=light&size=wide) · [凭证缺失](draft.html?scene=claude-compact-missing&theme=light&size=narrow) · [终端启动失败](draft.html?scene=claude-first-login-failed&theme=light&size=narrow) · [完整冻结草稿](http://127.0.0.1:15500/docs/preview/history/20261111-145858-claude-compact-sync/draft.html?scene=claude-compact-normal)。

验证：220 个起点加载且无模拟定时器；登录重试／取消、暂停接单、错误浮层关闭与焦点返回、设置输入跨外观与尺寸保持、切场景取消旧任务，以及浅色窄窗／深色宽窗截图。仅静态 HTML 模拟；未修改主预览或正式实现，待人工评审。


## Claude 已纳入唯一主预览（20261111-150658）

用户确认“更新到主预览吧”，上述 Claude 草稿现为**已认可并合入**。使用 [Claude 额度未知](index.html?scene=claude-compact-unknown&theme=light&size=narrow)、[正常账号](index.html?scene=claude-compact-normal&theme=light&size=wide) 或 [终端登录失败](index.html?scene=claude-first-login-failed)。后续评审以 index.html 为准，draft.html 保留本次方案来源。

保留原有 240 个场景，加入 220 个 Claude 起点；概览和启动恢复仍可使用。Claude 的概览摘要沿用主预览样式并反映当前 Claude 状态；主题、尺寸和同平台页面切换保留操作状态。验证两平台切换、概览往返、登录重试、错误浮层与切场景取消旧任务，复查启动恢复未丢失。仅 HTML 模拟，未修改正式代码。

[完整合入快照](http://127.0.0.1:15500/docs/preview/history/20261111-150658-approved-claude/index.html?scene=claude-compact-unknown)。

## 旧会话安全结束（2026-11-11）

主预览增加 `startup-unsupported` 与 `startup-draining`，共 9 个启动分支。Hive 不支持时仅保留诊断；排空中“继续恢复”演示返回普通账号布局，保持接单选择。配套实现尚未部署，该预览不调用真实恢复。新增历史：[20261111-154454-session-retirement](http://127.0.0.1:15500/docs/preview/history/20261111-154454-session-retirement/index.html?scene=startup-draining)。


## 首次启动设备绑定向导（2026-11-12，待评审）

[打开草稿](draft.html?scene=setup-form) · [完成页](draft.html?scene=setup-complete) · [保存失败](draft.html?scene=setup-save-failed) · [完整冻结版](http://127.0.0.1:15500/docs/preview/history/20261112-145209-first-launch-wizard/draft.html?scene=setup-form)。文本方案已确认，HTML 尚待人工评审；主入口 index.html 未修改。

草稿以最新主预览为基线，保留 462 个既有场景，新增 19 个入口，共 481 个。场景组“首次启动 / 设备设置”包含正常、进行中、失败和恢复状态，“首次启动 / 绑定后”复用现有账号页及概览，并预设两个平台均未接入。绑定前页面选择器禁用；绑定后可使用主页面导航。

正常体验：填写任意示例 HTTP(S) 地址 → 继续绑定设备 → 打开 Hive 确认网页 → 预设确认、核对和保存 → 完成 → 前往接入 AI 账号或进入概览。不会访问所填地址、打开真实授权网页或绑定真实设备。原请求未知的 Hive 控制台为本地模拟弹窗；诊断导出为标有 simulated 的示例文件。

验证：17 个向导静态起点；空地址错误及焦点；主题／尺寸保留输入；键盘提交；复制动作；正常绑定与账号页交接；创建失败重试、启动读取恢复、过期重建、保存失败续接、未知结果不重建及弹窗 Escape 返回焦点；切场景取消旧进度；重置回最后直接选择起点；浅深色 × 两尺寸；完成后的设备名称与地址传入现有概览。历史版独立打开及既有代表场景亦作检查。全部为 HTML 模拟，未验收真实配对、外部授权或服务端恢复。

本轮本地评审服务使用 `python3 -m http.server 1497 --bind 127.0.0.1 --directory docs/preview`，入口为 <http://127.0.0.1:1497/draft.html?scene=setup-form>；也可使用上文 1496 服务或直接打开 HTML。


### 向导故障详情与措辞调整（2026-11-12）

[浏览器打开失败](draft.html?scene=setup-open-failed) · [到期等待](draft.html?scene=setup-expiry-check) · [继续完成绑定](draft.html?scene=setup-save-failed) · [完整快照](http://127.0.0.1:15500/docs/preview/history/20261112-150523-setup-error-clarity/draft.html?scene=setup-open-failed)。

五类故障将“查看错误详情”折叠入口改为原因旁的圆圈叹号浮层，主文案与证据保留。有效期已到时明确 Bee 正在自动确认、结果自动更新；通用设备检查沿用“重新检查设备”，保存失败按钮改为“继续完成绑定”。已验证浮层键盘开关、Escape 及焦点返回、切场景移除、浅深色／尺寸切换，以及原绑定恢复路径；历史版独立打开。


## 首次启动向导已纳入主预览（2026-11-12）

用户确认“同意，更新到主预览”。请使用 [首次启动](index.html?scene=setup-form)、[错误详情](index.html?scene=setup-open-failed)、[自动等待](index.html?scene=setup-expiry-check) 或 [绑定完成](index.html?scene=setup-complete)。以上先前“待评审”记录为交付历史，最新认可范围为设备向导及本轮错误图标、等待文案、操作名称调整；账号页继续复用。

保留原有 462 个场景，新增 19 个，共 481 个。当前主预览默认打开首次设备设置，普通概览仍可通过场景选择进入。draft.html 保留为方案来源，不再作为当前评审入口。

[完整主预览快照](http://127.0.0.1:15500/docs/preview/history/20261112-152533-approved-first-launch/index.html?scene=setup-form)。合入前复用已有完整快照；本轮仅更新主入口标题和认可标记，交互沿用已验证草稿。核对场景完整性并验证主入口正常绑定、错误浮层、完成出口及新快照；仅静态模拟，正式 App 未修改。


## Hive URL 切换（2026-11-12，待评审）

按已确认的 Hive URL 切换规格同步唯一主预览，两个概览模板均在设备摘要旁提供紧凑“切换 Hive”入口。新增保存地址／添加、目标配对／凭据恢复／归属确认、任务结算等待、结果未知、观察暂停、后台交接、成功空账号、账号故障、失败／取消与退出选择，共 15 个起点。

[当前主预览](index.html?scene=switch-idle&theme=light&size=narrow) · [完整冻结版](http://127.0.0.1:15500/docs/preview/history/20261112-221434-hive-switch-interface/index.html?scene=switch-waiting) · [验证记录](../desktop/evidence/2026-11-12-hive-switch-ui/README.md)。本轮视觉状态待评审；既有已认可页面的认可记录保留。修改前复用逐字节相同的 [完整主预览](http://127.0.0.1:15500/docs/preview/history/20261112-152533-approved-first-launch/index.html)。冻结版同时保存五个对照文件，Hive 场景的对照入口指向 before-switch.html，不依赖当前文件。

浏览器已检查 OpenAI／Claude 两个概览模板、列表关闭不取消、Escape 焦点返回、错误地址保留输入、暗色与紧凑窗口，以及归档页独立打开。产品按钮按静态预设演示阶段；不接真实 Hive、不证明真实任务结束、结算、取消或原生进程退出。正式 React 组件与 mock 的验证另见上方记录。


### 2026-11-13 Hive 切换审查修复

新增待评审主预览场景：`index.html?scene=switch-history-conflict&theme=light&size=narrow`、`index.html?scene=switch-notification-source&theme=dark&size=narrow`。前者在列表解释历史归一化冲突并仅禁用受影响目标；后者保留旧通知的原 Hive，打开列表供明确选择，关闭提示后保留当前页。两者只模拟本轮正式界面的可见反馈。

修改前主预览复用字节一致的 `history/20261112-221434-hive-switch-interface/`；本轮交付留版为 [完整快照](http://127.0.0.1:15500/docs/preview/history/20261113-002455-hive-switch-review-final/index.html?scene=switch-history-conflict&theme=light&size=narrow)。以该目录为独立 HTTP 根运行，冻结对照页随包提供。正式 React mock 预览及本轮验证见 [审查修复证据](../desktop/evidence/2026-11-13-hive-switch-review-fixes/README.md)。
