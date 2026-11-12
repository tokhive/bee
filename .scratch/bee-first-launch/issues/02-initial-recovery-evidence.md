# 02: 首次配对持久化恢复故障证据

**Spec:** /Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-ui/docs/desktop/first-launch-design.md

**Status:** done

**Blocked by:** None

**What to build:** 为 spec 指定的首次配对恢复补足 Go 公共 DesktopDevice API 的 TDD 行为验证。重点创建前 identity 503 与创建 POST 503 区分，首次 saving 失败后继续保存不重复 create/redeem，保存成功/回执失败及重启；复用已有测试支持，不无意义重复已有覆盖。发现真实违反 spec 的后端行为可做最小修复并报告。

**Acceptance:** 实际 create/redeem 调用计数证明恢复不重放；typed corrupt/unconfigured 沿用已有测试；Go targeted -race 通过。现有后端若正确，不为测试制造产品变化。

**Ownership:** agent/desktop_first_launch_test.go（新增独立测试文件优先）；必要最小后端修复，不碰前端。

实现记录写在本票末尾：red→green证据、命令/结果、提交及限制；未实测系统路径不得宣称通过。

## 实现与验收

- 实现 `eea51df`，集成合并 `6dba1fb`。新增真实文件替换失败与保存成功但完成记录失败的同会话／重启覆盖，create/redeem 各一次。
- 红测试发现首次配对恢复会覆盖已确认身份；最小修复先比较原身份，阻止归属／设备变化和无效身份消除原保存约束。
- `go test -race -timeout=180s ./agent -run "^(TestDesktopFirstLaunch|TestDesktopDevice|TestDeviceRecovery)" -count=1` 通过。
- 使用临时目录、合成 Hive 与实际文件系统故障；不代表真实 Hive、桥传输丢包或断电验证。
