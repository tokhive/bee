# 本机开发包验证

平台为 macOS 15.7.7 arm64。包位于 worktree 的 `desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app`，debug／ad-hoc 签名，约 56.30 MiB；未公证、未发布，未替换应用安装目录或操作运行中的旧窗口。

## 构建与来源

从 worktree 根目录执行，使用已安装工具和已有离线缓存：

```sh
export PATH=/Users/dayong/.nvm/versions/node/v24.22.1/bin:/Users/dayong/.rustup/toolchains/1.94-aarch64-apple-darwin/bin:$PATH
export CARGO_HOME="$PWD/.cache/cargo-home"
GOCACHE="$PWD/.cache/go-build" node desktop/scripts/build-bee.mjs
APPLE_SIGNING_IDENTITY=- npm --prefix desktop run tauri -- build --debug --bundles app --ci -- --locked --offline
```

包含 FIFO／符号链接及两平台版本管道修复的构建退出 0；Tauri beforeBuild 重新执行普通生产构建，避免把 demo 产物打入原生包。sidecar 来源文件为 `desktop/src-tauri/binaries/bee-aarch64-apple-darwin.source.json`，记录 HEAD、TEE、arm64 目标、Go 1.27.3、Bee 版本和签名前 SHA256；Rust build.rs 核对来源并嵌入。macOS 签名会改变程序字节，包内最终字节由 App 签名封印核验。

收尾文档提交会改变 HEAD；交付前须再次按上述命令重建，再重复以下签名和冒烟验证，使实际包匹配最终提交。文档不写入自己的最终 hash，避免为更新验收 hash 反复改变源码版本。最终版本从来源文件及包内 `bee version` 读取，不沿用旧供给包版本。

## 已执行验证

```sh
codesign --verify --deep --strict --verbose=2 'desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app'
cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml -- --ignored
node desktop/scripts/smoke-accounts.mjs "$PWD/desktop/src-tauri/target/debug/bundle/macos/Bee Dev.app/Contents/MacOS/bee"
```

- `codesign` 返回 `valid on disk` 和 `satisfies its Designated Requirement`，退出 0。
- 两项签名包专项通过，0 failed：`macos_signed_bundle_seal_accepts_signing_changes_and_rejects_tampering`、`signed_app_bee_handshakes_pings_and_reaps_without_gui_or_path_lookup`。前者只篡改临时副本，证明修改会被拒绝；后者从真实包目录启动并回收自有 Bee。
- 账号冒烟通过：hello 精确十项能力 → defaults → OpenAI／Claude snapshot(false) → 前端实际 TS 解码 → ping → shutdown，子进程退出 0。两平台候选均 `not_checked`、选择均 `not_selected`、Hive 均 `not_checked`；不输出用户目录或原始 DTO。

普通 Rust 回归为 56 项通过；上述 2 项默认 ignored 专项已显式执行，合计 58 项。本轮未修改 Rust 后继续窄修 Go helper，包重新构建后重复专项和冒烟；不将普通 Rust 测试标记为涵盖新增 Go 分支。

这些证据证明本机包构建、来源约束、签名、包内管理协议与公开 DTO 可用，不替代 macOS 原生 GUI／Keychain、真实官方联网或 Windows／Linux 验收。所有自动冒烟都不 detect、不 refresh Hive、不读取真实账号或启动贡献。
