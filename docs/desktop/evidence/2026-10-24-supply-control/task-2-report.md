# Task 2：白名单桥与 Rust 命令实施报告

状态：DONE。代码提交：`337d33d feat(desktop): expose typed platform supply bridge commands`。基线：`efbe0783ec9e2a94a913af0c3ca3547558a6c607`。

## 完成范围

- 保持 `Devices`、`RunWithDevices` 与原设备业务接口不变；新增可选 `Supplies`，按实际接口支持依次发布原两项、原四项、完整六项能力。
- Go 新增 `supply_status({platform})`、`supply_set_paused({platform,paused})`。只允许 openai/claude 和显式 boolean，token 级检查重复字段、未知字段、缺失/null/错误类型，不回显未知字段或平台路径串。
- 成功使用 `result.supply`；业务错误使用 `result.error`、代码 `SUPPLY_OPERATION_FAILED`，保留底层公开错误证据。业务失败不进入传输错误，后续 ping 可用。
- Rust 使用封闭 `SupplyPlatform` 枚举与 typed Tauri 命令；命令只接收平台和必要的 bool。枚举拒绝错误值时只报告输入长度，不回显载荷。`bridge_request` 仍只允许 ping。
- Rust 握手精确接受三组有序能力，拒绝截断、颠倒、重复或扩展能力组；新方法固定 method/params 并沿用 15 秒期限及既有队列、来源与实例核验。
- 使用真实 Node 子进程 fixture 验证六项握手、两平台、true/false、固定 method/params、业务失败后健康；实际 Tauri invoke 验证平台 missing/null/path 与 paused missing/null/string 被拒绝、显式 false 成功。

## TDD 证据

所有 Rust 命令在 worktree 根设置：

```sh
export PATH="$PWD/.cache/toolchains/node-v24.22.1-darwin-arm64/bin:$PATH" RUSTUP_TOOLCHAIN=1.94 CARGO_HOME="$PWD/.cache/cargo-home"
```

### RED：Go 供给功能缺失

命令：`go test ./desktopbridge -run Supply -count=1`。下面是首次测试、实现前的真实输出；失败原因是缺少供给能力与方法。日志保存在 `/tmp/supply-task2-go-red.log`。

```text
--- FAIL: TestSupplyCapabilitiesAreOptionalAndOrdered (0.00s)
    --- FAIL: TestSupplyCapabilitiesAreOptionalAndOrdered/supply (0.00s)
        supply_test.go:38: capabilities=[ping shutdown device_status device_begin]; want=[ping shutdown device_status device_begin supply_status supply_set_paused]
--- FAIL: TestSupplyStrictParameters (0.00s)
    --- FAIL: TestSupplyStrictParameters/supply_status{} (0.00s)
        supply_test.go:49: unsafe request accepted or secret echoed: {"protocol":1,"id":"hello-1","instance":"7ad0968f18a3727b7b7e206e91aea41f","result":{"bee_version":"test","os":"darwin","arch":"arm64","capabilities":["ping","shutdown","device_status","device_begin"]}}
            {"protocol":1,"id":"x","instance":"7ad0968f18a3727b7b7e206e91aea41f","error":{"code":"UNKNOWN_METHOD","message":"method is unrecognized; allowed=hello,ping,shutdown"}}
            {"protocol":1,"id":"p","instance":"7ad0968f18a3727b7b7e206e91aea41f","result":{"alive":true}}
    --- FAIL: TestSupplyStrictParameters/supply_set_paused{} (0.00s)
        supply_test.go:49: unsafe request accepted or secret echoed: {"protocol":1,"id":"hello-1","instance":"87555ba26d2ee460f05f601787907950","result":{"bee_version":"test","os":"darwin","arch":"arm64","capabilities":["ping","shutdown","device_status","device_begin"]}}
            {"protocol":1,"id":"x","instance":"87555ba26d2ee460f05f601787907950","error":{"code":"UNKNOWN_METHOD","message":"method is unrecognized; allowed=hello,ping,shutdown"}}
            {"protocol":1,"id":"p","instance":"87555ba26d2ee460f05f601787907950","result":{"alive":true}}
--- FAIL: TestSupplyCallsPreservePlatformAndExplicitFalse (0.00s)
    supply_test.go:57: calls=[] paused=[] output={"protocol":1,"id":"hello-1","instance":"7bccdd3c039ce0a859f683154dcc73ad","result":{"bee_version":"test","os":"darwin","arch":"arm64","capabilities":["ping","shutdown","device_status","device_begin"]}}
        {"protocol":1,"id":"o","instance":"7bccdd3c039ce0a859f683154dcc73ad","error":{"code":"INVALID_REQUEST","message":"params contains fields=1; required=0 fields"}}
        {"protocol":1,"id":"c","instance":"7bccdd3c039ce0a859f683154dcc73ad","error":{"code":"INVALID_REQUEST","message":"params contains fields=1; required=0 fields"}}
        {"protocol":1,"id":"f","instance":"7bccdd3c039ce0a859f683154dcc73ad","error":{"code":"INVALID_REQUEST","message":"params contains fields=2; required=0 fields"}}
        {"protocol":1,"id":"t","instance":"7bccdd3c039ce0a859f683154dcc73ad","error":{"code":"INVALID_REQUEST","message":"params contains fields=2; required=0 fields"}}
--- FAIL: TestSupplyBusinessFailureDoesNotBreakManagement (0.00s)
    supply_test.go:65: unexpected end of JSON input
FAIL
FAIL	github.com/tokhive/bee/desktopbridge	0.819s
FAIL
```

### RED：Rust 六项握手

先执行 `node desktop/scripts/build-bee.mjs`，输出 native Bee 的 revision 为基线 HEAD `efbe0783ec9e2a94a913af0c3ca3547558a6c607`。随后执行：

`cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml supply_handshake_accepts_only_three_exact_capability_groups`

预期失败点为实际六项能力被现有四项白名单拒绝。真实输出：

```text
   Compiling bee-desktop v0.1.0 (/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/src-tauri)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 5.92s
     Running unittests src/lib.rs (desktop/src-tauri/target/debug/deps/bee_desktop_lib-2fae8002f353f7d7)

running 1 test
test protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups ... FAILED

failures:

---- protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups stdout ----

thread 'protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups' (12875170) panicked at src/protocol_tests.rs:147:134:
called `Result::unwrap()` on an `Err` value: BridgeError { code: "CAPABILITY_MISMATCH", message: "hello capability set rejected; actual entries=6; required=ping,shutdown with optional device_status,device_begin" }
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 47 filtered out; finished in 0.01s

error: test failed, to rerun pass `--lib`
```

新增 typed API 测试后还执行了 `cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml supply`，在枚举/方法尚未实现时出现 E0432/E0599（完整输出 `/tmp/supply-task2-rust-api-red.log`）；此为 API 尚未实现的编译证据，不将它单独视为行为红灯。

随后在未扩展能力白名单前用真实子进程运行相同 `supply` 定向命令，六项握手与两个供给 fixture 测试均因 CAPABILITY_MISMATCH 失败。真实行为红灯如下：

```text
   Compiling bee-desktop v0.1.0 (/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/src-tauri)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 5.90s
     Running unittests src/lib.rs (desktop/src-tauri/target/debug/deps/bee_desktop_lib-2fae8002f353f7d7)

running 4 tests
test protocol::tests::supply_platform_is_a_closed_enum_without_echoing_rejected_input ... ok
test protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups ... FAILED
test sidecar::tests::supply_commands_use_fixed_methods_and_params_on_a_six_capability_child ... FAILED
test sidecar::tests::supply_business_failure_keeps_the_owned_session_ready ... FAILED

failures:

---- protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups stdout ----

thread 'protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups' (12885736) panicked at src/protocol_tests.rs:147:134:
called `Result::unwrap()` on an `Err` value: BridgeError { code: "CAPABILITY_MISMATCH", message: "hello capability set rejected; actual entries=6; required=ping,shutdown with optional device_status,device_begin" }
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

---- sidecar::tests::supply_commands_use_fixed_methods_and_params_on_a_six_capability_child stdout ----

thread 'sidecar::tests::supply_commands_use_fixed_methods_and_params_on_a_six_capability_child' (12885739) panicked at src/sidecar_tests.rs:64:17:
bridge failed: Some(BridgeError { code: "CAPABILITY_MISMATCH", message: "hello capability set rejected; actual entries=6; required=ping,shutdown with optional device_status,device_begin; owned child status=exit status: 0; management stderr bytes=0, retained=0, truncated=false, tail=\"\"" })

---- sidecar::tests::supply_business_failure_keeps_the_owned_session_ready stdout ----

thread 'sidecar::tests::supply_business_failure_keeps_the_owned_session_ready' (12885738) panicked at src/sidecar_tests.rs:64:17:
bridge failed: Some(BridgeError { code: "CAPABILITY_MISMATCH", message: "hello capability set rejected; actual entries=6; required=ping,shutdown with optional device_status,device_begin; owned child status=exit status: 0; management stderr bytes=0, retained=0, truncated=false, tail=\"\"" })


failures:
    protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups
    sidecar::tests::supply_business_failure_keeps_the_owned_session_ready
    sidecar::tests::supply_commands_use_fixed_methods_and_params_on_a_six_capability_child

test result: FAILED. 1 passed; 3 failed; 0 ignored; 0 measured; 47 filtered out; finished in 9.00s

error: test failed, to rerun pass `--lib`
```

### GREEN：规定 Go 回归

命令：`go test ./desktopbridge ./cmd/bee`。

```text
ok  	github.com/tokhive/bee/desktopbridge	0.431s
ok  	github.com/tokhive/bee/cmd/bee	0.885s
```

### GREEN：Rust 供给与实际 Tauri invoke

`cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml supply`：4 passed；新增 actual invoke 补充验证命令：

`cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml supply_native_commands_require_platform_and_an_explicit_boolean`

```text
   Compiling bee-desktop v0.1.0 (/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/src-tauri)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2.39s
     Running unittests src/lib.rs (desktop/src-tauri/target/debug/deps/bee_desktop_lib-2fae8002f353f7d7)

running 1 test
test sidecar::tests::supply_native_commands_require_platform_and_an_explicit_boolean ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 8.76s

     Running unittests src/main.rs (desktop/src-tauri/target/debug/deps/bee_desktop-be95409fde965973)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

```

### GREEN：规定 Rust 全量回归

Go 实现后重新执行 `node desktop/scripts/build-bee.mjs`，成功构建本机 darwin/arm64 sidecar，来源仍为当时 HEAD 基线。命令：

`cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml`

第一次全量为 49 passed、2 ignored；补充 actual invoke 测试后再次执行全量，最终真实输出如下：

```text
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.66s
     Running unittests src/lib.rs (desktop/src-tauri/target/debug/deps/bee_desktop_lib-2fae8002f353f7d7)

running 52 tests
test build_source::tests::macos_signed_bundle_seal_accepts_signing_changes_and_rejects_tampering ... ignored, requires a freshly built and ad-hoc signed Bee Dev.app; run explicitly after tauri build
test lifecycle::tests::native_close_hides_instead_of_quitting_the_management_process ... ok
test lifecycle::tests::second_launch_and_reopen_recover_the_existing_window_without_a_tray ... ok
test lifecycle::tests::tray_and_native_menu_share_the_same_window_intents ... ok
test navigation::tests::permits_only_the_bundled_app_in_release ... ok
test lifecycle::tests::callback_receipt_retains_only_a_boolean_and_rejects_other_protocols ... ok
test commands::tests::frontend_can_only_send_ping_without_paths_or_arguments ... ok
test navigation::tests::development_permits_only_the_declared_vite_origin ... ok
test commands::browser_action_tests::completed_or_expired_pairing_returns_without_opening_a_stale_url ... ok
test protocol::tests::error_response_does_not_become_success ... ok
test diagnostics::tests::large_stderr_is_fully_drained_with_only_a_bounded_tail_retained ... ok
test protocol::tests::malformed_session_cannot_be_reused_for_a_later_hello ... ok
test protocol::tests::handshake_requires_matching_build_and_platform_and_p0_capabilities ... ok
test protocol::tests::stale_response_cannot_complete_a_new_request ... ok
test protocol::tests::invalid_envelopes_are_rejected_without_echoing_payload ... ok
test protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups ... ok
test commands::device_tests::browser_url_is_limited_to_saved_pairing ... ok
test protocol::tests::supply_platform_is_a_closed_enum_without_echoing_rejected_input ... ok
test sidecar::tests::bundled_program_is_always_next_to_the_app_executable ... ok
test sidecar::tests::cleanup_failure_preserves_the_original_protocol_error ... ok
test protocol::tests::fragmented_utf8_and_combined_frames_preserve_correlation ... ok
test build_source::tests::source_must_match_target_commit_tee_and_toolchain ... ok
test build_source::tests::actual_bundled_bytes_must_match_recorded_sha256 ... ok
test protocol::tests::validates_frame_boundaries_and_eof ... ok
test commands::browser_action_tests::browser_launcher_wait_is_bounded ... ok
test sidecar::tests::signed_app_bee_handshakes_pings_and_reaps_without_gui_or_path_lookup ... ignored, requires a freshly built signed Bee Dev.app; run explicitly after tauri build
test lifecycle::tests::unexpected_parent_death_closes_stdin_and_native_management_process_exits ... ok
test sidecar::tests::native_go_management_binary_can_handshake_ping_and_stop ... ok
test sidecar::tests::fragmented_child_responses_and_concurrent_requests_are_correlated ... ok
test sidecar::tests::child_failure_retains_exit_status_and_bounded_management_diagnostic ... ok
test singleton_tests::invalid_dbus_session_never_reaches_sidecar_setup ... ok
test singleton_tests::linux_adapter::startup_lock::tests::registration_gate_holds_an_exclusive_os_lock_until_registration_finishes ... ok
test singleton_tests::linux_adapter::startup_lock::tests::registration_gate_refuses_symlink_and_public_lock_file ... ok
test sidecar::tests::supply_commands_use_fixed_methods_and_params_on_a_six_capability_child ... ok
test singleton_tests::registration_lock::tests::registration_gate_holds_an_exclusive_os_lock_until_registration_finishes ... ok
test singleton_tests::registration_lock::tests::registration_gate_refuses_symlink_and_public_lock_file ... ok
test singleton_tests::singleton_registration_failure_aborts_before_sidecar_setup ... ok
test singleton_tests::windows_registration::tests::absent_primary_window_times_out_instead_of_starting_another_instance ... ok
test singleton_tests::windows_registration::tests::existing_instance_waits_for_its_window_and_forwards_exactly_once ... ok
test singleton_tests::windows_registration::tests::null_mutex_and_window_handles_fail_with_the_native_error ... ok
test singleton_tests::windows_registration::tests::rejected_or_uncertain_delivery_is_returned_without_retrying ... ok
test singleton_tests::windows_registration::tests::window_found_at_or_after_deadline_is_not_forwarded ... ok
test sidecar::tests::missing_and_changed_binaries_fail_before_handshake ... ok
test sidecar::tests::device_business_failure_keeps_owned_bridge_ready ... ok
test sidecar::tests::supply_business_failure_keeps_the_owned_session_ready ... ok
test sidecar::tests::supply_native_commands_require_platform_and_an_explicit_boolean ... ok
test sidecar::tests::owned_process_is_reaped_before_singleton_release ... ok
test sidecar::tests::concurrent_stop_reaps_stubborn_owned_child_and_preserves_external_process ... ok
test sidecar::tests::failed_ping_revokes_ready_before_returning_and_stop_waits_for_reaping ... ok
test singleton_tests::macos_ipc::primary_accepts_forwarding_and_reacquires_after_exit ... ok
test sidecar::tests::unsent_queue_timeout_does_not_kill_a_healthy_device_session ... ok
test sidecar::tests::invalid_utf8_version_exit_and_timeout_never_become_ready ... ok

test result: ok. 50 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 25.70s

     Running unittests src/main.rs (desktop/src-tauri/target/debug/deps/bee_desktop-be95409fde965973)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests bee_desktop_lib

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

```

## 文件变更

- `desktopbridge/protocol.go`：供给参数解析。
- `desktopbridge/server.go`：可选 Supplies、能力及业务 dispatch。
- `desktopbridge/supply_test.go`：严格参数、能力兼容、两平台与 false、业务失败健康测试。
- `desktop/src-tauri/src/commands.rs`：typed 命令与 generic ping 白名单回归。
- `desktop/src-tauri/src/lib.rs`：注册两个命令。
- `desktop/src-tauri/src/protocol.rs`：平台枚举与精确三组握手。
- `desktop/src-tauri/src/protocol_tests.rs`：能力拒绝矩阵、枚举隐私测试。
- `desktop/src-tauri/src/sidecar.rs`：固定方法、参数与 15 秒期限。
- `desktop/src-tauri/src/sidecar_tests.rs`：真实子进程及 Tauri invoke 测试。
- `desktop/tests/fixtures/bridge-child.mjs`：六项能力与严格 method/params fixture。

## 自检、风险与边界

已自检 brief 的每项要求、完整提交差异及 `git diff --check`；没有发现未解决问题。仅修改 brief 允许的 bridge/Rust/fixture 与同层测试，没有修改 Task 1、UI、docs 或 ledger。报告为被忽略的任务过程文件，未入源码提交。

没有读取绑定配置、秘密或凭证，没有真实 Hive PUT，没有操作 App 67414/owned 67433，没有触碰 Hive 已有 `M bee`。fixture 写请求只作用于子进程内的公开测试数据。没有派生其他代理。

两个既有签名 App 专项在普通 cargo test 中保持 ignored，按 brief 留到主控最终签名包收尾；它们不是本任务未通过项。提交后最终打包必须重建 native Bee，使来源 revision 对齐最终 HEAD；当前验证用 sidecar 是提交前基线 HEAD 的当前工作树实现。

## I1 复核修正

状态：DONE。提交：`8f761b0 fix(desktop): preserve safe supply validation evidence`。基线：`337d33d`。

按 review I1 修复错误证据，未改接口和拒绝集合。Go 明确区分 platform null、错误 JSON 类型与非法字符串枚举；记录实际 JSON 类型和未知字符串 UTF-8 字节数，paused 报告实际 JSON 类型。Rust 对长度 2/4/6 的错误能力组只报告首个差异的零基位置、期望项和安全实际项；已知成员可回显，未知成员仅报告字节数，其余长度报告实际 count。

新增断言覆盖 Go null/number/boolean/object/array/string 与中文字符串字节数，Rust 两/四/六项顺序、重复、未知成员和错误数量，并检查未知载荷不回显。只改 `desktopbridge/protocol.go`、`desktopbridge/supply_test.go`、`desktop/src-tauri/src/protocol.rs`、`desktop/src-tauri/src/protocol_tests.rs` 四个源码文件。

沿用指定隔离工具链，每次 Rust 阶段前先执行 `node desktop/scripts/build-bee.mjs`，输出来源 `revision=337d33dbca2b11dd5542c02e61940d6fcda6f5db; target=aarch64-apple-darwin`。

### RED：Go

命令：`go test ./desktopbridge -run Supply -count=1`。实际输出：

```text
--- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload (0.00s)
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/platform-null (0.00s)
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="platform is null"
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="actual type=null"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/platform-number (0.00s)
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="platform JSON type rejected"
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="actual type=number"
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="required=string"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/platform-bool (0.00s)
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="platform JSON type rejected"
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="actual type=boolean"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/platform-object (0.00s)
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="platform JSON type rejected"
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="actual type=object"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/platform-array (0.00s)
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="platform JSON type rejected"
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="actual type=array"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/platform-enum (0.00s)
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="platform enum rejected"
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="actual type=string"
        supply_test.go:151: message="supply platform is not an allowed string enum; required=openai,claude"; missing="string bytes=22"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/paused-null (0.00s)
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="paused JSON type rejected"
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="actual type=null"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/paused-string (0.00s)
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="paused JSON type rejected"
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="actual type=string"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/paused-number (0.00s)
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="paused JSON type rejected"
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="actual type=number"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/paused-object (0.00s)
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="paused JSON type rejected"
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="actual type=object"
    --- FAIL: TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload/paused-array (0.00s)
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="paused JSON type rejected"
        supply_test.go:151: message="supply paused has a non-boolean JSON type; required=explicit boolean"; missing="actual type=array"
FAIL
FAIL	github.com/tokhive/bee/desktopbridge	0.870s
FAIL
```

### RED：Rust

命令：`cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml protocol::tests`。实际输出：

```text
   Compiling bee-desktop v0.1.0 (/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/src-tauri)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 5.16s
     Running unittests src/lib.rs (desktop/src-tauri/target/debug/deps/bee_desktop_lib-2fae8002f353f7d7)

running 10 tests
test protocol::tests::error_response_does_not_become_success ... ok
test protocol::tests::supply_platform_is_a_closed_enum_without_echoing_rejected_input ... ok
test protocol::tests::invalid_envelopes_are_rejected_without_echoing_payload ... ok
test protocol::tests::malformed_session_cannot_be_reused_for_a_later_hello ... ok
test protocol::tests::stale_response_cannot_complete_a_new_request ... ok
test protocol::tests::handshake_requires_matching_build_and_platform_and_p0_capabilities ... ok
test protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups ... ok
test protocol::tests::fragmented_utf8_and_combined_frames_preserve_correlation ... ok
test protocol::tests::rejected_capabilities_report_first_difference_without_unknown_payload ... FAILED
test protocol::tests::validates_frame_boundaries_and_eof ... ok

failures:

---- protocol::tests::rejected_capabilities_report_first_difference_without_unknown_payload stdout ----

thread 'protocol::tests::rejected_capabilities_report_first_difference_without_unknown_payload' (12941076) panicked at src/protocol_tests.rs:234:35:
missing index=0: hello capability set rejected; actual entries=2; required=exact ordered group ping,shutdown; optionally device_status,device_begin; then optionally supply_status,supply_set_paused
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    protocol::tests::rejected_capabilities_report_first_difference_without_unknown_payload

test result: FAILED. 9 passed; 1 failed; 0 ignored; 0 measured; 43 filtered out; finished in 0.02s

error: test failed, to rerun pass `--lib`
```

### GREEN：Go

命令：`go test ./desktopbridge -run Supply -count=1`。实际输出：

```text
ok  	github.com/tokhive/bee/desktopbridge	0.465s
```

### GREEN：Rust

命令：`cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml protocol::tests`。实际输出：

```text
   Compiling bee-desktop v0.1.0 (/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop/src-tauri)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 5.10s
     Running unittests src/lib.rs (desktop/src-tauri/target/debug/deps/bee_desktop_lib-2fae8002f353f7d7)

running 10 tests
test protocol::tests::error_response_does_not_become_success ... ok
test protocol::tests::supply_platform_is_a_closed_enum_without_echoing_rejected_input ... ok
test protocol::tests::invalid_envelopes_are_rejected_without_echoing_payload ... ok
test protocol::tests::malformed_session_cannot_be_reused_for_a_later_hello ... ok
test protocol::tests::stale_response_cannot_complete_a_new_request ... ok
test protocol::tests::handshake_requires_matching_build_and_platform_and_p0_capabilities ... ok
test protocol::tests::supply_handshake_accepts_only_three_exact_capability_groups ... ok
test protocol::tests::rejected_capabilities_report_first_difference_without_unknown_payload ... ok
test protocol::tests::fragmented_utf8_and_combined_frames_preserve_correlation ... ok
test protocol::tests::validates_frame_boundaries_and_eof ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 43 filtered out; finished in 0.03s

     Running unittests src/main.rs (desktop/src-tauri/target/debug/deps/bee_desktop-be95409fde965973)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

```

RED 原因是现有错误缺少类型/字节数/首个能力差异证据，GREEN 为供给 Go 定向通过及 Rust protocol 10/10 通过。按主控要求不重跑 50 项全量。`git diff --check` 通过；只修改允许四文件，未访问真实配置、App 或 Hive。无新增运行风险；最终签名包来源仍需主控在最终 HEAD 重建，对本次诊断修正的定向验证已完成。
