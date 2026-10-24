# 桌面设备配对

2026-10-24：客户端复用现有 Hive 接口，不修改 Hive。当前可生成设备配对、打开确认网页、核对绑定结果和重启恢复；绑定不会启动贡献。独立桌面账号登录、真实平台账号、收益及贡献运行尚未接通。

## 三步验收

1. 打开 `desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app`，进入“概览”，填写实际 Hive 地址和设备名称，点击“生成配对码”。应显示公开配对码和确认网址；联网失败应显示具体错误，不显示已绑定。
2. 点击“打开 Hive 确认网页”。在浏览器登录 Hive，核对设备并确认；替换已有设备也须在网页明确确认。完成后手动回到 Bee，页面应自动核对并显示设备名、归属邮箱和设备 ID。
3. 退出并重开 Bee，应重新向同一 Hive 核验原设备身份。账号、收益仍显示未接通，不能开始贡献；原 CLI 配置不变。

这是实际设备绑定，会写入所选 Hive 的设备记录。自动测试使用本地 HTTP fixture，不代替用户批准线上设备，也不对线上 Hive 自动提交确认。没有 Hive 账号时，可以验收表单和失败提示，无法完成真实绑定。

## 保存与失败处理

Go 将配置固定保存到系统用户配置目录下 `tokhive/bee-desktop.json`。Mac 为 `~/Library/Application Support/tokhive/bee-desktop.json`；不读取或覆盖 CLI 的 `bee.json`。凭证使用既有权限、锁与原子写入保护，不进入网页状态或诊断。

普通过期可点击“重新生成配对码”；网络失败可点击“重新核对设备”。若兑换结果未确认，客户端保留原事务并用原凭证核验，不自动创建新设备。已绑定凭证被撤销、设备被替换、归属变化或 Hive 变化时停止并报错，保留原配置供恢复。不要通过删除配置来解决未知兑换结果。

语言与外观仅用于本次运行。显式 `dev:demo`/`build:demo` 保留 P1 演示；普通网页仍显示未接通，只有普通 Tauri 入口使用真实设备服务。

## 自动验证及限制

从 Bee 检出根目录运行：

```sh
go test ./...
go vet ./...
go test -race ./agent -run TestDesktopDevice -count=1
npm --prefix desktop run test:device
npm --prefix desktop run build
npm --prefix desktop run build:demo
cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml
```

当前已验证 Go 7 包、vet、12 项设备测试及 race（最终 agent 全量回归 53.319 秒）；TS 设备/桥测试 13 项；配对页面 Chromium 6 项（含 860×600 操作和横向溢出检查）、原页面相关回归 56 项；工具测试 37 项；Rust 45 项，加新包构建后补跑的签名包 2 项。普通和 demo 构建通过，新设备测试已接入 CI 配置，尚未运行本提交的远端 CI。页面测试使用 Tauri 调用替身；Go 使用本地 HTTP 服务核对现有 Hive 合同和兑换恢复，不能代替原生 WebView 或线上账号确认。

本次不扩大旧 P0/P1 的三端验收结论；Windows/Linux 新设备配对原生界面尚未验收。协议和秘密边界见[私有管理协议](bridge-protocol.md)，实施范围见[设备配对计划](../superpowers/plans/2026-10-24-desktop-device-pairing.md)。

## 设备配对批次交付记录

以下为 `70518b4` 的历史证据。当前同路径 App 已更新为 `24aca16` 平台状态与暂停/恢复版本，用户已完成真实绑定，不需重新配对；最新包和验收边界见[平台供给说明](supply-control.md)。旧图形工具失败仍保留为历史记录。

- 源码提交：`70518b43393c82cf15ecc78d9c0b0d66e11307bb`（`dev+70518b43393c`）；后续验证文档提交不改变包内源码版本。
- Mac arm64 开发包：`desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app`。压缩包：`.cache/device-pairing/Bee-Dev-macos-arm64-70518b4.zip`，22,957,834 字节；SHA256 为 `6976f82673b301d3f4796f53ca8ca5686f806b192d187f2ffea49f9c60b70e70`，ZIP CRC 检查通过。
- `codesign --verify --deep --strict` 通过；2 项签名包测试验证完整性、篡改拒绝及包内 Bee 握手/ping/回收。仅 ad-hoc 开发签名，未作生产发布或公证。
- 实际包内 Bee 子进程完成 hello → device_status → ping → shutdown，返回 unbound、退出 0、stderr 0 字节，没有创建凭证或联网。真实配对 HTTP 各状态和恢复由 Go 本地服务测试验证；未自动确认线上设备。
- **Mac 原生图形仍未验收。** 通过 CUA 用精确包路径打开后，App 和其 owned Bee 进程存在；两次窗口读取均报 `Computer Use server error -10005: cgWindowNotFound`，没有截图或 AX 证据。无法据此判断原因，也不将进程存在当作页面通过。
- 独立代码复核已通过；Hive 仍只有原有 ` M bee`，本次没有修改 Hive 源码、数据库、子模块或 CLI 配置。

包来源和验证摘要见[本次交付清单](evidence/2026-10-24-device-pairing/manifest.json)。原生 App 已启动；实际网页绑定仍按上面的三步由用户核对和确认。
