use super::*;
use serde_json::json;

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
