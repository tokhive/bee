# 完整原生 GUI 验收

2026-11-12（Asia/Shanghai）。Bee `9a254fb44d933ec6ceb15f4934e04fa647792f8b`，Hive真实fixture基于`8b0f1eb`生产代码及09测试helper。不是demo或浏览器替代：运行完整Tauri NativeApp、嵌入正式React产物、实际Go受管child、两套真实Hive和独立PostgreSQL schema。

## 环境与边界

- Linux/arm64；Rust/Cargo1.94.0；Go1.27.3原生Linux构建；Node24.22.1；GTK3.24.41/WebKit4.1 2.52.6。Cargo使用dev profile和`tauri/custom-protocol`，没有使用demo入口。
- Docker专用internal network、没有默认路由或发布端口；PG使用专用tmpfs。自然非root用户`beeqa`，独立XDG目录及空官方来源；未设置或复用HOME，未挂载用户账号。
- A为`:46177`，B为`:34685`；两个合成归属`switch-a@example.test`、`switch-b@example.test`。此GUI流程未接入AI账号、不执行买家任务；真实任务与结算见09集成报告。
- 使用Xvfb、xdotool操作真实窗口，ImageMagick截取窗口。仅终止已核验的测试App PID；重启保留同一私有目录。

## 结果

| 操作 | 直接证据 |
| --- | --- |
| 初次连接A、在准备目标时真实Ctrl+Q选择继续等待 | 保留App、原切换；之后观察预算到期仍保留记录 |
| 意外退出后重启 | `proof.json`前后原switch ID、A/B profile、round/start、暂停预算一致；原受管Go child均退出 |
| 首次目标准备表单 | [重启后地址保留](restart-target-preserved.png)，固定目标地址只读，不要求重新输入 |
| 取消待准备切换 | 原记录终态cancelled，A重新连接 |
| A→首次真实B | [B已连接](first-b-connected.png)，目标地址和归属正确；零账号仍可成功并引导接入 |
| 已保存B→A | [地址列表](saved-hives.png)保留各自归属；[返回A](returned-a.png)无需重新配对，以新operation成功提交 |
| 主动取消并退出 | [真实退出选择](native-quit-choice.png)；App及owned Go child退出；journal保留cancel/quit=true |
| 再次启动 | [仍在A](cancel-quit-restart-a.png)，没有继续切到已取消目标 |
| 暗色900×700、键盘 | [窄窗列表](dark-narrow-chooser.png)可滚动；Escape关闭后Enter重新打开，焦点回到入口 |

原生验收暴露的首次B地址空白、英文词条遗漏、正常首次配对误称旧设备恢复，均已修复并在此构建复验。早期验收曾把B端口少输一位为`:3685`；该记录只用于验证崩溃保留和取消，之后重新选择真实`:34685`完成往返，不把错误地址记作B连接成功。

## 构建与复核

正式前端：Node24 `npm run build`；移除临时node_modules链接后，原生Linux Go执行`go build -p 1 -trimpath '-ldflags=-r=$ORIGIN/../lib' -o /tmp/bee-aarch64-unknown-linux-gnu ./cmd/bee`，按实际revision、版本、SHA写sidecar provenance。Cargo执行`cargo +1.94.0 build --locked --offline --bin bee-desktop --features tauri/custom-protocol`，运行时匹配Go二进制为App同目录`bee`。完整二进制SHA及脱敏状态投影在`proof.json`。

服务端使用09的`TestHiveSwitchFixture`，两个真实app.New/Market；配对确认经隔离fixture的`/__fixture/confirm`调用真实确认逻辑。截图与状态均来自同一运行，不含设备凭据或配对码。

此次验证覆盖Linux完整原生流程；不将其称作macOS安装包或Hosted CI通过。正式与主预览的HTML留版和对照见[界面证据](../2026-11-12-hive-switch-ui/README.md)。
