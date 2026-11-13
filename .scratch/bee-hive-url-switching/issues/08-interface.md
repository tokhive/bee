# 08: 概览设备区的紧凑切换入口与真实反馈

**What to build:** 用户能选择保存的地址或添加 B，看到真实等待原因，继续等待或取消；主预览同步。

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-hive-url-switching/docs/desktop/designs/2026-11-12-hive-url-switching.md

**Blocked by:** 06 App 执行 A→B→A 的持久切换

**Status:** done

- [x] 正式界面／bridge／mock 契约齐全，UI 不猜测百分比或隐藏未知结果。
- [x] 暗色、窄窗口、键盘焦点和恢复路径可用；关闭面板不取消。
- [x] 主预览保留完整历史快照及索引，浏览器验证关键交互。

实现记录：概览设备区紧凑列表／添加、App 级 switch owner、native capability 驱动进度、独立 target 配对与原事务恢复、退出选择，以及 profile／instance 作用域清理。已合并最终集成 2650440，严格 DTO 与 07 最终输出一致。

验证：正式 build/typecheck、342 前端单元、64 注册命令 Rust 参数契约、28 相关浏览器用例通过；最终代码上的 9 项切换浏览器用例复跑通过。主预览与正式 mock 的修改前／交付完整历史、浅深窄窗截图及验证边界见 docs/desktop/evidence/2026-11-12-hive-switch-ui/README.md。视觉待评审；真实双 Hive／PG／原生生命周期验收已由 09 完成。
