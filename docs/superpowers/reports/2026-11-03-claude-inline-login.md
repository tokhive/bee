# Claude 登录小修复验证

本次落实已认可的行内反馈界面，修复可读取但格式无效的旧凭据阻止官方登录的问题，并按用户要求补全 macOS 官方终端输入输出。原六项计划撤回，作为同一修复交付，不新增桌面协议或依赖。

## 验证结果

- Go：`go test ./agent -run 'TestDesktopAuthorize|TestDesktopAccount.*Claude|TestClaude' -count=1` 通过。
- 终端补全后的 Go race 回归：`go test -race ./agent -run 'TestDesktopAuthorize|TestDesktopTerminalRelay|TestDesktopOfficialTerminalSession|TestDesktopTerminalShellQuotes' -count=1` 通过（6.822s）。覆盖真实子进程转接提示和合成授权码、完成、取消、终端断开、错误会话、启动失败、临时目录清理与 shell 字面参数保护。
- macOS 断开回归先复现失败；验证 Darwin 的 poll 在 Events=0 时不报告断开，改为请求 POLLIN 后通过。输入就绪但尚未读取时有 25ms 等待，避免监测空转。
- 原生系统 Terminal：`BEE_NATIVE_TERMINAL_SMOKE=1 go test ./agent -run '^TestDesktopTerminalNativeSmoke$' -count=1 -v` 通过（7.069s）；用户手动输入 `bee-synthetic-code`，受控合成进程收到并接受，进程正常结束并清理通道。测试不调用 Claude，也不接触真实账号。
- 账号页面浏览器回归：28 项通过；后续完成取消结果未知的专项保护后，5 项 Claude 行内专项全部通过。
- 账号协议单测：9 项通过。
- 终端补全后的 `make app`（含 TypeScript 检查）及 `codesign --verify --deep --strict` 通过，产物为 `desktop/src-tauri/target/debug/bundle/macos/Bee S1 Dev.app`。构建仍有既有 Rust 未使用成员与前端包体积提示。
- 使用独立的合成账号浏览器核对确认焦点、等待状态、浅色失败状态、折叠详情和恢复按钮；失败只有一条提示，核验失败只提供重新核验。
- 未操作真实账号登录、钥匙串或贡献状态，未退出或重启用户运行中的 Bee。

## 一致性检查

- ✅ 对话：沿用已认可的行内预览；已撤回多任务与额外审批流程。
- ✅ 文档内部：设计、计划与决策记录已撤销“终端不在范围内”的旧执行判断，均包含用户要求补全的 macOS 交互。
- ✅ 代码与设计：确认和进度沿用现有操作；核验不重复登录；结果未知只查询原操作；成功不自动接入。macOS Claude 的实际登录使用终端适配，版本和能力探测仍在后台；其他平台未宣称接通终端。
- ✅ 接口与配置：没有新增协议字段、依赖或产品配置；内部助手命令已接入 CLI 分发，来源命名空间、进程回收与取消继续使用既有保护；新增详情关闭焦点回调为可选参数，原调用方保持兼容。
- ✅ 文档与证据：测试记录明确为合成回归，未宣称真实授权已成功。

## 已知边界

独立的 revision 130/131 异常未获复现结论，本次未调整版本保护。完整真实授权仍需用户在更新后的 Bee 自行完成，不能由上述合成回归证明。

原生合成终端输入已验证；官方网页授权、真实账号写入及随后在线身份核验的完整链路尚未实测。当前运行中的旧 Bee 未重启，新构建须用户退出后重新打开才生效。
