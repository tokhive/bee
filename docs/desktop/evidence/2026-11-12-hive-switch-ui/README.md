# Hive 切换界面验证（ticket 08）

本轮实现正式 React 界面、Tauri typed client、当前 profile／instance 作用域隔离及前端 mock，并同步唯一主预览。按已确认 spec 实施；视觉交付为待评审。未执行真实两个 Hive／Postgres／原生 App 验收，该范围由 ticket 09 负责。

## 行为与边界

- 概览设备区旁的紧凑列表显示当前地址、可信保存身份的“上次归属”、未核对项及阻塞条件；历史列表不读取每台服务器。地址和设备名称在失败、关闭及 workspace 重建后保留。
- 切换 owner 位于可重建 workspace 之外。进度显示原生阶段与已知任务／未知终止／未结算数量，未知值显示待核对；没有估计百分比。许可及查询预算来自 native。关闭列表／导航不发送取消。
- 目标设备配对、原凭据被拒、重新绑定及采用新归属沿独立 target 命令与原 transaction revision；提交 B 前保留 A。首次无 current profile 的设置继续原 device_begin。
- current profile／instance 改变时清除来源缓存与 receipt floor，拒绝旧事件和迟到结果。目标提交后账号空选择或读取失败留在 B 内处理。
- 原生退出请求显示明确的继续等待／取消切换并退出选择，说明任务可能中断。退出与取消未知不能显示成功。

## 验证

TDD 记录：typed switch client、profile scope 清缓存／拒绝旧结果、首次 profile gate 与 target mock 的测试均从失败推进至通过；另以失败用例发现并修复旧 startup error 跨 Hive 覆盖及 StrictMode 初始读取丢失。

- TypeScript typecheck 与正式生产 build 通过；Vite 保留已有 bundle 大小提示。
- 最终集成上全部 342 项前端单元通过，覆盖 switch client、scope／startup、bridge／lifecycle 及 mock；原生输出字段对齐检查直接读取最终 Rust DTO。
- 28 项 Playwright 通过，包含 9 项切换用例及既有设备／自动账号用例：列表键盘与输入、暂停／未知、首次 profile gate、交接空窗、目标恢复、退出选择、提交 B 后账号问题、失败输入，以及两份主预览模板。
- 原生参数契约直接读取 Rust command 签名与 Serde 输入类型，校验新增 switch 参数，并保留旧 snake_case payload 拒绝负例。最终集成后 64 个注册命令全部通过。
- ego-browser 已目视检查浅深外观与窄窗口，独立打开修改前正式 bundle、交付 bundle 与主预览历史，并检查列表／Escape／修改前对照。Web guidelines 检查涉及表单标签、名称、autocomplete、焦点、长地址换行和弹层滚动。

## 可复查材料

[浅色紧凑列表](formal-list-light-final.png) · [深色未知进度](formal-unknown-dark-final.png) · [主预览等待](main-waiting-light-final.png)。截图仅补充说明，完整可运行历史如下。

- 正式组件修改前：[完整 frozen bundle](../../../../desktop/tests/fixtures/bee-preview/history/20261112-215252-before-hive-switch/SOURCE.md)。
- 正式组件最终版：[完整 frozen bundle](../../../../desktop/tests/fixtures/bee-preview/history/20261112-222601-hive-switch-final/SOURCE.md)。
- 正式组件交付初版：[完整 frozen bundle](../../../../desktop/tests/fixtures/bee-preview/history/20261112-221434-hive-switch-interface/SOURCE.md)。该版本保留于最终原生字段核对之前；最终交付另行冻结。
- 主预览：[完整快照](../../../preview/history/20261112-221434-hive-switch-interface/index.html?scene=switch-waiting)。对照依赖全部同目录冻结。

正式 bundle 必须以选定历史目录作为 HTTP 根目录，打开 /tests/fixtures/bee-preview/index.html?scene=switch-saved&theme=dark&size=narrow；主预览从 docs/preview 的 HTTP 服务打开对应 history 路径。两者使用模拟数据，不能替代 native sidecar、服务端屏障、任务结算、真实退出和重启验收。
