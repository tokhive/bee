# Bee 桌面分层架构

产品范围见[产品需求](product.md)，接口字段以[私有桥协议](bridge-protocol.md)及对应源码类型为准。

## 分层与接口

| 层 | 责任 | 接口与实现入口 |
| --- | --- | --- |
| React 页面 | 四页布局、交互、可访问性和状态呈现 | [NativeApp](../../desktop/src/app/NativeApp.tsx)、`desktop/src/features/`、`desktop/src/presentation/` |
| 应用状态 | 聚合设备、账号、运行与供给；隔离旧实例和旧修订；安排读取与退避 | [desktopState](../../desktop/src/system/desktopState.ts)、feature hooks |
| 类型化 Client | 固定方法、输入类型和公开响应解码 | [system](../../desktop/src/system/)、`RuntimeClient`、`AccountClient`、`SupplyClient` 等 |
| Tauri / Rust | 白名单命令、子进程监督、原生菜单／通知／文件导出／更新 | [命令注册](../../desktop/src-tauri/src/lib.rs)、[commands](../../desktop/src-tauri/src/commands.rs)、[sidecar](../../desktop/src-tauri/src/sidecar.rs) |
| Go Bee | 设备与账号归属、持久状态、授权维护、贡献运行、Hive 协议 | [desktopbridge](../../desktopbridge/)、[agent](../../agent/) |
| Hive 与官方服务 | 设备配对、账号同步、准入与实际上游服务 | [接口核查](2026-11-03-interface-compatibility.md)，各报告只证明其注明版本 |

既定栈为 Tauri 2、React、TypeScript、Vite、Radix/Lucide/Tailwind 与独立 Go Bee。具体依赖以锁文件为准；构建工具版本和命令见[开发入口](../../desktop/README.md)。不新增本机 HTTP 服务或数据库。

## 进程、连接与贡献

Rust 从 App 包内固定位置启动本次拥有的 Go Bee，通过 stdin/stdout JSONL 通信；stderr 独立消费。hello/ping 只证明管理会话可用。Go 设备在线连接和贡献连接按已核验归属串行交接；设备在线不等于已接入账号、开始贡献或可接单。

首次贡献由用户明确开始。正常退出后的恢复须核验保存意图、设备、来源、网络与运行归属；主动停止保持停止，异常或未决状态不冒充可恢复。关窗后台与明确退出分开；退出只回收本 App 创建的子进程，不按进程名查杀外部 Bee。详见[运行设计](../superpowers/specs/2026-10-26-desktop-account-runtime-design.md)和[设备在线设计](../superpowers/specs/2026-11-03-desktop-device-connection-design.md)。

## 数据与权限

设备凭据、官方登录、确认凭据和授权维护留在 Go。React 接收白名单公开状态，不读取凭证、不构造任意 Hive URL、不执行 Shell。设备配置、账号选择及普通偏好分别保存；账号状态不复制官方 token，不覆盖 CLI 配置。文件更新使用权限保护、锁、原子替换与读回。

单实例注册先于窗口和管理进程创建；失败不能继续创建第二个管理进程。仅已确认的系统入口可打开站点、登录或安装更新；Hive 用户会话由浏览器承接。

## mock 与真实接口

正式 UI 预览安装模拟 Tauri IPC 后加载当前 NativeApp、Client 和状态协调器。UI 和业务层使用同一输入输出契约；mock 仅替换 IPC 响应，不复制另一套页面。字段变化时同步真实 Client、模拟数据与契约断言。

契约测试检查 TS 实际调用与 Rust 命令签名；Go/Rust 受控集成测试验证另一层边界。模拟页面不能证明真实设备配对、官方账号、系统权限或生产更新通过。验收分层见[验收状态](acceptance.md)。

## 构建、安装与更新

App 与内置 Bee 同版本、同来源打包。构建脚本核对固定 TEE、工具链、目标架构和 Bee 来源哈希；Rust 启动时核对包完整性与握手。ad-hoc 开发签名只用于开发完整性，不代表生产签名或公证。

macOS 使用 DMG，Windows 使用 NSIS，Linux 使用 AppImage；具体目标环境、签名、可信更新配置及安装证明见[发布说明](release.md)和[发布验收](release-validation.md)。检查／下载更新不停止贡献，安装需要明确退出并确认影响。
