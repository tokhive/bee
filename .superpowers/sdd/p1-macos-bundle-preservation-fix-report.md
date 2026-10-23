# Mac 原生验收：同时保留 App 与 DMG 修补报告

## 修补内容

`.github/workflows/desktop-hosted-macos.yml` 的 Tauri build 参数由 `--bundles dmg` 改为 `--bundles app,dmg`。这样 CI 在生成 DMG 的同时保留 `.app`，供后续签名包测试和包元数据记录使用。未修改产品代码、测试、锁文件、最低系统版本或其他 workflow。

## RED 证据

本机对基线 `e1bc8253d176a42c5f84ed9acb5dbac21400c76e` 的原生构建使用 `--bundles dmg`，构建退出码为 0，但日志随后清理了 `bundle/macos/Bee Dev.app`。之后 Rust 39 项通过、2 项签名包测试失败，原因是预期路径下的 App 已不存在。证据日志位于：

- `.cache/qa/p1-native-local-final/tauri-demo-build-dmg-only.log`
- `.cache/qa/p1-native-local-final/cargo-test-before-app-preservation-red.log`
- `.cache/qa/p1-native-local-final/codesign-missing-app-red.log`

Tauri CLI `build --help` 已确认 `--bundles` 接受空格或逗号分隔，`app` 与 `dmg` 均为合法 bundle 类型。本修补保留签名门禁及测试路径，不改变测试语义。

## 检查与未运行项

- `shellcheck` 可用；对 workflow 中的内嵌 Bash 命令进行语法/静态检查。
- Ruby Psych 解析 workflow YAML。
- `git diff --check` 检查补丁空白错误。
- `actionlint` 未安装，因此未运行 actionlint。
- 未运行原生构建、cargo 测试、GUI、1420，也未启动发布流程；本机原生 GREEN 及远端新 Mac run 留给主控按计划执行。
