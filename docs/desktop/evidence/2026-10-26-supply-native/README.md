# Mac 原生平台页补验（2026-10-26）

用户显示主窗口后，直接续验已有开发包，没有重新实现、重建或重跑上轮大套。App 精确路径、版本及两程序 hash 与 [10月24日包清单](../2026-10-24-supply-control/manifest.json) 一致，产品源码固定 `24aca16`。本轮只读 UI 与网络检查，未修改 Hive、设备绑定、CLI 配置，未发送真实 PUT，未启动贡献。

## 已取得的原生证据

- 取窗已恢复，AX 显示“设备已绑定，尚未开始贡献”，两张平台卡与具体原因正常出现。首次 OpenAI/Claude 核对时间为本地10:37:31/32；手动点击“重新核对平台”后看到“核对中”和禁用按钮，再看到两卡恢复真实结果、时间更新至10:38:10。OpenAI原因 offline/codex_source_unavailable/authorization_unavailable，Claude原因 offline/authorization_unavailable；均不ready，未显示为贡献在线。初次成功 AX/图像已在本轮工具输出中检查，未另存成功截图。
- 后续自动查询Claude收到HTTP409，界面隐藏旧成功、两张卡显示“本次结果未确认”，暂停按钮禁用；失败后的手动重查收到identity HTTP409，没有重新提交写入。[脱敏失败AX](02-read-failure.ax.txt)保留HTTP方法、路径及状态。
- [诊断AX](03-diagnostics.ax.txt)及[原生诊断截图](03-diagnostics.jpg)确认管理进程ready、版本dev+24aca16f37e9、设备bound、贡献未开始。诊断/设置/概览导航可用。
- 设置从“跟随系统”切到English，核对[英文平台页](04-platform-en.ax.txt)的真实错误、平台卡和按钮文案；随后恢复[跟随系统设置](05-settings-restored.ax.txt)，回到[中文概览](06-final-overview-zh.ax.txt)。本轮不改变外观。
- 两程序hash保持，检查前后的设备配置字节相同。身份AX中的邮箱和设备ID已脱敏；含设备资料的整窗截图仅留本地cache，没有进入此归档。当前原生截图为2000×1400像素，不据此标记860×600原生缩放通过。

## 未通过的联网稳定性

成功读取后出现HTTP409（错误体不符合既有Hive JSON错误格式），再出现identity EOF。[独立Go诊断](http-diagnostic.json)沿用同一个现有Hive、GET方法、请求头及10秒HTTP期限，分别对未带凭证identity、带凭证identity及两平台只读采样，四次均在HTTP之前报TLS握手失败；[无凭证curl诊断](unauthenticated-api-diagnostic.json)退出35。凭证仅在本地Go内存中使用，没有输出或写入此归档。

这说明独立于React/Tauri的HTTP检查也发生连接失败，但**尚不能确定409与TLS失败是否同一根因**，不能归咎于Hive业务、客户端、网络代理或设备被撤销。检查了绑定Hive的供给controller/service及错误编码路径，未找到本次非JSON409的直接来源。未修改客户端重试、放宽校验、切换网络或改Hive来掩盖该结果。

结论：窗口/真实卡片/刷新状态/错误保护/导航/中英切换已核对；连续端到端联网稳定性保留未通过。真实暂停/恢复、原生最小窗口、Windows/Linux与旧P0/P1剩余矩阵未在本轮验收。取窗中另有一次cgWindowNotFound，重新按同一精确App路径选择后恢复，不能宣称工具问题永久消失。

界面测试已结束并明确交还用户，可正常操作电脑和Bee；语言恢复为原设置，不再要求用户保持窗口或暂停使用。
