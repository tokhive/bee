use super::*;
use serde_json::json;

#[test]
fn experience_notification_capability_requires_complete_ordered_group() {
    let mut methods = vec![
        "ping",
        "shutdown",
        "device_status",
        "device_begin",
        "supply_status",
        "supply_set_paused",
        "account_defaults",
        "account_detect",
        "account_snapshot",
        "account_action",
        "runtime_snapshot",
        "runtime_start",
        "runtime_stop",
        "runtime_configure_network",
        "runtime_restore",
        "authorize_start",
        "authorize_status",
        "authorize_cancel",
        "diagnostics_start",
        "diagnostics_snapshot",
        "diagnostics_cancel",
        "network_status",
        "network_test",
        "notification_snapshot",
    ];
    let check = |caps: &Vec<&str>| {
        hello(
            json!({"bee_version":"fixture","os":"darwin","arch":"arm64","capabilities":caps}),
            "fixture",
            "darwin",
            "arm64",
        )
    };
    assert!(check(&methods).is_ok());
    methods.swap(22, 23);
    assert_eq!(check(&methods).unwrap_err().code, "CAPABILITY_MISMATCH");
    methods = vec!["ping", "shutdown", "notification_snapshot"];
    assert!(check(&methods).is_err());
}

fn frame(id: &str, instance: &str, result: Value) -> Vec<u8> {
    let mut bytes =
        serde_json::to_vec(&json!({"protocol":1,"id":id,"instance":instance,"result":result}))
            .unwrap();
    bytes.push(b'\n');
    bytes
}

#[test]
fn fragmented_utf8_and_combined_frames_preserve_correlation() {
    let mut input = frame("first", "one", json!({"text":"蜂"}));
    input.extend(frame("second", "one", json!({"alive":true})));
    let mut decoder = FrameDecoder::default();
    let mut frames = Vec::new();
    assert_eq!(FrameDecoder::default().push(&input).unwrap().len(), 2);
    for byte in input {
        frames.extend(decoder.push(&[byte]).unwrap());
    }
    decoder.finish().unwrap();
    assert_eq!(frames.len(), 2);
    let second = frames
        .pop()
        .unwrap()
        .success("second", Some("one"))
        .unwrap();
    assert_eq!(second, json!({"alive":true}));
    assert_eq!(
        frames.pop().unwrap().success("first", None).unwrap(),
        json!({"text":"蜂"})
    );
}

#[test]
fn malformed_session_cannot_be_reused_for_a_later_hello() {
    let mut decoder = FrameDecoder::default();
    let error = decoder.push(b"not-json\n").unwrap_err();
    assert_eq!(
        decoder.push(&frame("h", "new", json!({}))).unwrap_err(),
        error
    );
    assert_eq!(decoder.finish().unwrap_err(), error);
}

#[test]
fn validates_frame_boundaries_and_eof() {
    let mut input = frame("first", "one", json!({}));
    input.pop();
    input.resize(MAX_FRAME_BYTES, b' ');
    input.push(b'\n');
    assert_eq!(FrameDecoder::default().push(&input).unwrap().len(), 1);
    assert_eq!(
        FrameDecoder::default()
            .push(&vec![b'x'; MAX_FRAME_BYTES + 1])
            .unwrap_err()
            .code,
        "FRAME_TOO_LARGE"
    );
    let mut partial = FrameDecoder::default();
    partial.push(b"{").unwrap();
    assert_eq!(partial.finish().unwrap_err().code, "INCOMPLETE_FRAME");
    FrameDecoder::default().finish().unwrap();
}

#[test]
fn invalid_envelopes_are_rejected_without_echoing_payload() {
    const SECRET: &str = "never-echo-credential";
    let cases = [
        (vec![0xff, b'\n'], "INVALID_UTF8"),
        (format!("{{\"token\":\"{SECRET}\",\n").into_bytes(), "INVALID_REPLY"),
        (format!("{{\"protocol\":1,\"id\":\"x\",\"instance\":\"one\",\"result\":{{}},\"{SECRET}\":1}}\n").into_bytes(), "INVALID_REPLY"),
        (b"{\"protocol\":2,\"id\":\"x\",\"instance\":\"one\",\"result\":{}}\n".to_vec(), "VERSION_MISMATCH"),
        (b"{\"protocol\":1,\"id\":\"x\",\"instance\":\"\",\"result\":{}}\n".to_vec(), "INVALID_REPLY"),
        (b"{\"protocol\":1,\"id\":\"x\",\"id\":\"y\",\"instance\":\"one\",\"result\":{}}\n".to_vec(), "INVALID_REPLY"),
        (b"{\"protocol\":1,\"id\":\"x\",\"instance\":\"one\",\"result\":null,\"error\":{\"code\":\"X\",\"message\":\"Y\"}}\n".to_vec(), "INVALID_REPLY"),
    ];
    for (input, code) in cases {
        let error = FrameDecoder::default().push(&input).unwrap_err();
        assert_eq!(error.code, code);
        assert!(!error.message.contains(SECRET));
        assert!(!error.message.is_empty());
    }
}

#[test]
fn stale_response_cannot_complete_a_new_request() {
    for (id, instance, code) in [
        ("wrong", "one", "RESPONSE_ID_MISMATCH"),
        ("expected", "old", "INSTANCE_MISMATCH"),
    ] {
        let envelope = FrameDecoder::default()
            .push(&frame(id, instance, json!({"alive":true})))
            .unwrap()
            .pop()
            .unwrap();
        let error = envelope.success("expected", Some("one")).unwrap_err();
        assert_eq!(error.code, code);
    }
}

#[test]
fn handshake_requires_matching_build_and_platform_and_p0_capabilities() {
    let valid = json!({"bee_version":"fixture","os":"darwin","arch":"arm64","capabilities":["ping","shutdown"]});
    assert_eq!(
        hello(valid.clone(), "fixture", "darwin", "arm64")
            .unwrap()
            .bee_version,
        "fixture"
    );
    for field in ["bee_version", "os", "arch"] {
        let mut invalid = valid.clone();
        invalid[field] = json!("different");
        let error = hello(invalid, "fixture", "darwin", "arm64").unwrap_err();
        assert_eq!(error.code, "BUILD_MISMATCH");
        assert!(error.message.contains(field));
    }
    let mut invalid = valid.clone();
    invalid["capabilities"] = json!(["ping", "start"]);
    assert_eq!(
        hello(invalid, "fixture", "darwin", "arm64")
            .unwrap_err()
            .code,
        "CAPABILITY_MISMATCH"
    );
}

#[test]
fn error_response_does_not_become_success() {
    let input = b"{\"protocol\":1,\"id\":\"x\",\"instance\":\"one\",\"error\":{\"code\":\"NOT_READY\",\"message\":\"hello required\"}}\n";
    let envelope = FrameDecoder::default().push(input).unwrap().pop().unwrap();
    assert_eq!(
        envelope.success("x", Some("one")).unwrap_err().code,
        "NOT_READY"
    );
}

#[test]
fn supply_handshake_accepts_only_four_exact_capability_groups() {
    let groups = [
        json!(["ping", "shutdown"]),
        json!(["ping", "shutdown", "device_status", "device_begin"]),
        json!([
            "ping",
            "shutdown",
            "device_status",
            "device_begin",
            "supply_status",
            "supply_set_paused"
        ]),
    ];
    for capabilities in groups {
        hello(json!({"bee_version":"fixture","os":"darwin","arch":"arm64","capabilities":capabilities}), "fixture","darwin","arm64").unwrap();
    }
    let accounts = json!([
        "ping",
        "shutdown",
        "device_status",
        "device_begin",
        "supply_status",
        "supply_set_paused",
        "account_defaults",
        "account_detect",
        "account_snapshot",
        "account_action"
    ]);
    hello(
        json!({"bee_version":"fixture","os":"darwin","arch":"arm64","capabilities":accounts}),
        "fixture",
        "darwin",
        "arm64",
    )
    .unwrap();
    for index in 6..10 {
        let mut invalid = accounts.clone();
        invalid.as_array_mut().unwrap().swap(5, index);
        assert_eq!(hello(json!({"bee_version":"fixture","os":"darwin","arch":"arm64","capabilities":invalid}),"fixture","darwin","arm64").unwrap_err().code,"CAPABILITY_MISMATCH");
    }
    for capabilities in [
        json!(["ping", "shutdown", "supply_status", "supply_set_paused"]),
        json!([
            "ping",
            "shutdown",
            "device_status",
            "device_begin",
            "supply_status"
        ]),
        json!([
            "ping",
            "shutdown",
            "device_status",
            "device_begin",
            "supply_set_paused",
            "supply_status"
        ]),
        json!([
            "ping",
            "shutdown",
            "device_status",
            "device_begin",
            "supply_status",
            "supply_status"
        ]),
        json!([
            "ping",
            "shutdown",
            "device_status",
            "device_begin",
            "supply_status",
            "supply_set_paused",
            "extra"
        ]),
    ] {
        assert_eq!(hello(json!({"bee_version":"fixture","os":"darwin","arch":"arm64","capabilities":capabilities}), "fixture","darwin","arm64").unwrap_err().code,"CAPABILITY_MISMATCH");
    }
}

#[test]
fn supply_platform_is_a_closed_enum_without_echoing_rejected_input() {
    for (input, platform) in [
        (json!("openai"), SupplyPlatform::Openai),
        (json!("claude"), SupplyPlatform::Claude),
    ] {
        assert_eq!(
            serde_json::from_value::<SupplyPlatform>(input.clone()).unwrap(),
            platform
        );
        assert_eq!(serde_json::to_value(platform).unwrap(), input);
    }
    for input in [
        Value::Null,
        json!(false),
        json!("/private/credential-path"),
        json!("OPENAI"),
        json!({"url":"secret"}),
    ] {
        let cause = serde_json::from_value::<SupplyPlatform>(input)
            .unwrap_err()
            .to_string();
        assert!(!cause.contains("credential-path") && !cause.contains("secret"));
    }
}

#[test]
fn rejected_capabilities_report_first_difference_without_unknown_payload() {
    for (capabilities, expected) in [
        (
            json!(["shutdown", "ping"]),
            vec!["index=0", "expected=ping", "actual=shutdown"],
        ),
        (
            json!(["ping", "shutdown", "device_begin", "device_status"]),
            vec!["index=2", "expected=device_status", "actual=device_begin"],
        ),
        (
            json!([
                "ping",
                "shutdown",
                "device_status",
                "device_begin",
                "supply_status",
                "supply_status"
            ]),
            vec![
                "index=5",
                "expected=supply_set_paused",
                "actual=supply_status",
            ],
        ),
        (
            json!(["ping", "private-secret"]),
            vec!["index=1", "expected=shutdown", "unknown member bytes=14"],
        ),
        (
            json!(["ping", "shutdown", "device_status", "private-secret"]),
            vec![
                "index=3",
                "expected=device_begin",
                "unknown member bytes=14",
            ],
        ),
        (
            json!([
                "ping",
                "shutdown",
                "device_status",
                "device_begin",
                "supply_status",
                "private-secret"
            ]),
            vec![
                "index=5",
                "expected=supply_set_paused",
                "unknown member bytes=14",
            ],
        ),
        (
            json!(["ping", "shutdown", "private-secret"]),
            vec!["actual count=3", "required counts=2,4,6"],
        ),
    ] {
        let cause = hello(json!({"bee_version":"fixture","os":"darwin","arch":"arm64","capabilities":capabilities}),"fixture","darwin","arm64").unwrap_err();
        assert_eq!(cause.code, "CAPABILITY_MISMATCH");
        for evidence in expected {
            assert!(
                cause.message.contains(evidence),
                "missing {evidence}: {}",
                cause.message
            );
        }
        assert!(!cause.message.contains("private-secret"));
    }
}
#[test]
fn account_typed_requests_reject_missing_null_and_unknown_fields() {
    for value in [
        json!({"platform":"openai","store":"file","mode":"local"}),
        json!({"platform":null,"directory":null,"store":"file","mode":"local"}),
        json!({"platform":"openai","directory":null,"store":"file","mode":"local","token":"private-secret"}),
    ] {
        assert!(serde_json::from_value::<super::AccountDetectRequest>(value).is_err());
    }
    let request: super::AccountDetectRequest = serde_json::from_value(
        json!({"platform":"openai","directory":null,"store":"file","mode":"local"}),
    )
    .unwrap();
    assert!(request.validate().is_ok());
    let request: super::AccountDetectRequest = serde_json::from_value(
        json!({"platform":"openai","directory":"relative","store":"keychain","mode":"local"}),
    )
    .unwrap();
    assert!(request.validate().is_err());
}

#[test]
fn account_operation_requires_current_platform_and_known_state() {
    let operation = json!({"id":"a".repeat(48),"kind":"select","platform":"openai","state":"pending","revision":3,"error":null});
    let valid =
        json!({"account":{"platform":"openai","operation":operation,"login_maintenance":null}});
    assert!(super::validate_account_operation(&valid, super::SupplyPlatform::Openai).is_ok());
    for (field, value) in [
        ("state", json!("finished_maybe")),
        ("platform", json!("claude")),
        ("revision", json!(9007199254740992u64)),
        ("id", json!("SECRET")),
    ] {
        let mut bad = valid.clone();
        bad["account"]["operation"][field] = value;
        assert!(super::validate_account_operation(&bad, super::SupplyPlatform::Openai).is_err());
    }
    let mut secret = valid.clone();
    secret["account"]["operation"]["confirmation_id"] = json!("SECRET");
    assert!(super::validate_account_operation(&secret, super::SupplyPlatform::Openai).is_err());
    assert!(super::validate_account_operation(
        &json!({"account":{"platform":"openai"}}),
        super::SupplyPlatform::Openai
    )
    .is_err());
    assert!(super::validate_account_operation(
        &json!({"account":{"platform":"openai","operation":null,"login_maintenance":null}}),
        super::SupplyPlatform::Openai
    )
    .is_ok());
}

#[test]
fn login_maintenance_requires_bound_authorize_evidence_even_without_current_operation() {
    let valid = json!({"account":{"platform":"openai","operation":null,"login_maintenance":{"operation":{"id":"a".repeat(48),"kind":"authorize","platform":"openai","state":"cancelled","revision":3,"error":null},"phase":"restored","source":{"directory":null,"store":"file"},"started_at":"2026-11-01T01:02:03Z","can_recheck":false,"error":null}}});
    assert!(super::validate_account_operation(&valid, super::SupplyPlatform::Openai).is_ok());
    let mutations = [
        (
            "/account/login_maintenance/operation/platform",
            json!("claude"),
        ),
        ("/account/login_maintenance/operation/kind", json!("select")),
        ("/account/login_maintenance/phase", json!("unknown")),
        (
            "/account/login_maintenance/source/directory",
            json!("relative"),
        ),
        ("/account/login_maintenance/source/store", json!("keychain")),
        (
            "/account/login_maintenance/started_at",
            json!("2026-02-30T00:00:00Z"),
        ),
        ("/account/login_maintenance/can_recheck", Value::Null),
        (
            "/account/login_maintenance/error",
            json!({"code":"blocked","check":"restore","platform":"claude","message":"blocked","evidence":{}}),
        ),
    ];
    for (path, value) in mutations {
        let mut bad = valid.clone();
        *bad.pointer_mut(path).unwrap() = value;
        assert!(
            super::validate_account_operation(&bad, super::SupplyPlatform::Openai).is_err(),
            "{path}"
        );
    }
    let mut missing = valid.clone();
    missing["account"]
        .as_object_mut()
        .unwrap()
        .remove("login_maintenance");
    assert!(super::validate_account_operation(&missing, super::SupplyPlatform::Openai).is_err());
    let mut secret = valid;
    secret["account"]["login_maintenance"]["token"] = json!("SECRET");
    let error =
        super::validate_account_operation(&secret, super::SupplyPlatform::Openai).unwrap_err();
    assert!(!error.message.contains("SECRET"));
}

#[test]
fn account_operation_failure_accepts_only_valid_http_observation_time() {
    let mut result = json!({"account":{"platform":"openai","login_maintenance":null,"operation":{"id":"a".repeat(48),"kind":"select","platform":"openai","state":"failed","revision":3,"error":{"code":"connection_closed","check":"identity","platform":"openai","message":"unexpected EOF","evidence":{"observed_at":"2026-11-03T10:30:20.123456789Z"}}}}});
    assert!(super::validate_account_operation(&result, super::SupplyPlatform::Openai).is_ok());
    for value in ["2026-02-30T00:00:00Z", "2099-01-01T00:00:00Z", "not-a-time"] {
        result["account"]["operation"]["error"]["evidence"]["observed_at"] = json!(value);
        assert!(super::validate_account_operation(&result, super::SupplyPlatform::Openai).is_err());
    }
}
#[test]
fn clear_selection_accepts_revision_without_candidate_but_select_does_not() {
    let mut request = super::AccountActionRequest {
        platform: super::SupplyPlatform::Openai,
        revision: 2,
        candidate_ref: String::new(),
        action: "clear_selection".into(),
        confirmed: true,
    };
    assert!(request.validate().is_ok());
    request.action = "select".into();
    assert!(request.validate().is_err());
}

#[test]
fn device_recovery_public_contract_is_strict_and_keeps_initial_pairing_separate() {
    let base = json!({"operation_id":"a".repeat(48),"revision":1,"phase":"awaiting_confirmation","old_identity":null,"new_identity":null,"pairing":null,"failure":null});
    assert!(device_recovery(&json!({"recovery":base})).is_ok());
    for patch in [
        json!({"credential":"SECRET"}),
        json!({"revision":0}),
        json!({"phase":"invented"}),
        json!({"phase":"saving"}),
    ] {
        let mut bad = base.clone();
        bad.as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        assert!(device_recovery(&json!({"recovery":bad})).is_err());
    }
    let mut missing = base.clone();
    missing.as_object_mut().unwrap().remove("failure");
    assert!(device_recovery(&json!({"recovery":missing})).is_err());
    let initial = json!({"device":{"state":"pairing","hive":"https://hive.example","name":"Mac","recovery":base.clone()}});
    // serde_json has no object spread: populate the explicit phase below.
    let mut initial = initial;
    initial["device"]["recovery"] = base.clone();
    initial["device"]["recovery"]["phase"] = json!("creation_unknown");
    assert!(validate_device_recovery(&initial).is_ok());
    initial["device"]["state"] = json!("bound");
    assert!(validate_device_recovery(&initial).is_err());
}

#[test]
fn initial_device_reply_rejects_unknown_or_secret_fields() {
    for field in ["credential", "pairing_token", "unexpected"] {
        let mut value = json!({"device":{"state":"unbound"}});
        value["device"][field] = json!("SECRET");
        assert!(
            validate_device_recovery(&value).is_err(),
            "accepted {field}"
        );
    }
}

#[test]
fn initial_device_state_never_claims_an_unverified_identity() {
    for device in [
        json!({"state":"unknown"}),
        json!({"state":"bound"}),
        json!({"state":"unbound","identity":{"id":"d","name":"Mac","owner_id":"o","owner_email":"o@example.com"}}),
    ] {
        assert!(validate_device_recovery(&json!({"device":device})).is_err());
    }
}

#[test]
fn unknown_operation_result_is_reserved_for_interrupted_authorization() {
    let original=json!({"id":"c".repeat(48),"kind":"authorize","platform":"openai","state":"unknown","revision":2,"error":null});
    assert!(validate_operation(&original,Some(SupplyPlatform::Openai), &["authorize"]).is_ok());
    let mut other=original;
    other["kind"]=json!("select");
    assert!(validate_operation(&other,Some(SupplyPlatform::Openai), &["select"]).is_err());
}
