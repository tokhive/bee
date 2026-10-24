# 平台状态与暂停/恢复验收记录

本批只覆盖不改 Hive 的真实平台状态和明确暂停/恢复。产品包固定源码 `24aca16f37e9fa17f843d1c300786056a2b083a1`；后续文档提交不构成包内产品源码。开发包 ZIP、签名后程序 SHA256、来源元数据、真实只读结果及未验收项见 [manifest.json](manifest.json)。源码构建前 Bee 的 binarySha256 与签名后 SHA 不同；二者分别记录，不能混用。

## 已验证的范围

| 层次 | 源码与证据 | 结果 |
| --- | --- | --- |
| Go 服务 | Task1 `be3e2a6`，[实现报告](task-1-report.md)中的风险矩阵及 race | Desktop(Device/Supply) race、agent 全量通过，真实写操作仅对本地 HTTP fixture |
| 全量 Go / 工具 | 桥初版 `337d33d`，[Go全量](go-full.log)、[vet](go-vet.log)、[工具](tooling.log) | 7包、vet、37工具测试通过；后续 Go 窄修另有覆盖 |
| 桥 / Rust | [Task2报告](task-2-report.md)；`0c0a789`重建sidecar后的[普通Rust](rust-final.log) | 桥/cmd通过；普通Rust51通过、2项签名测试另跑 |
| 客户端 | `8add4c9`，[Task3报告](task-3-report.md)、[主控device运行](frontend-device.log) | 8单元＋17页面、bridge10、相关旧页面89、typecheck、普通/demo build通过；页面来自IPC fixture |
| TS错误类型窄修 | `0c0a789`，[Task3报告](task-3-report.md) | 供给单测8通过，新增3项先RED后GREEN；未重复全部页面 |
| Go错误类型窄修 | `24aca16`，[Task3报告](task-3-report.md)、[供给定向](go-final-focused.log)、[最终vet](go-final-vet.log) | 七个类型子例先RED后GREEN；所有DesktopSupply及vet通过，无原值泄露 |
| 最终包 | [Bee构建](build-bee-final.log)、[App构建](build-app-final.log)、[codesign](codesign-final.log)、[签名专项](signed-final.log) | 匹配24aca16；签名有效、signed2通过；ZIP CRC/内容/权限核对通过 |
| 真实Hive只读 | 最终包内Bee，[只读记录](read-only-smoke.json) | 两平台核验、ping和shutdown成功，exit0、stderr0、配置字节未改，未发送PUT |
| 独立完整路径审查 | [审查及M1有限复核](final-code-review.md) | 最终Approved，C/I/M0/0/0；不替代原生环境验收 |

## 当前真实结果与图形缺口

真实只读返回 OpenAI、Claude 均 paused=false/ready=false。OpenAI 原因为 offline、codex_source_unavailable、authorization_unavailable；Claude 为 offline、authorization_unavailable。绑定存在，不表示贡献已启动；本轮没有接入官方账号、贡献或资金，没有对真实Hive做暂停/恢复。

旧App完整备份、签名复核成功；CUA向旧App发送正常退出，精确父67414和owned子67433均消失。新版App已由CUA精确路径启动（父62426、owned子62470）。但本次读取Bee及Finder均报 `Computer Use server error -10005: cgWindowNotFound`；没有取得新版AX或截图，**原生平台卡、刷新、导航和语言操作未算通过**。此错误原因未确定，不能称为沙箱限制、锁屏或产品失败。已请求用户解锁Mac并从Dock显示Bee主窗口，之后可继续只读图形验收。

设备配置与更新前一致；旧包备份不含配置。`previous-app-manifest.json`记录旧程序hash。新版为ad-hoc开发签名、未公证，没有生产发布。Windows/Linux本增量界面与旧P0/P1环境缺口保留；不将fixture、进程存在或代码review换算为真实桌面通过。

原始日志按运行字节归档。`build-app-final.log`、`rust-final.log`、`signed-final.log` 原样含末尾空行，`git diff --check` 对这三处提示 new blank line at EOF；未改写日志、Git配置或跳过hook。除此三份原始日志外暂存差异检查通过，三份日志均与cache原始文件字节一致。
