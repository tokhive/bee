use super::*;

#[test]
fn native_close_hides_instead_of_quitting_the_management_process() {
    assert_eq!(intent_for(WindowEvent::CloseRequested), WindowIntent::Hide);
}

#[test]
fn second_launch_and_reopen_recover_the_existing_window_without_a_tray() {
    assert_eq!(intent_for(WindowEvent::SecondLaunch), WindowIntent::Show);
    assert_eq!(intent_for(WindowEvent::Reopen), WindowIntent::Show);
}

#[test]
fn tray_and_native_menu_share_the_same_window_intents() {
    for intent in [WindowIntent::Show, WindowIntent::Hide, WindowIntent::Quit] {
        assert_eq!(intent_for(WindowEvent::Menu(intent)), intent);
    }
}

#[test]
fn callback_receipt_retains_only_a_boolean_and_rejects_other_protocols() {
    let receipt = LoginReceipt::default();
    assert!(!receipt.received());
    assert!(!receipt.receive("https://example.com/?code=secret&state=private"));
    assert!(!receipt.receive("tokhive-bee-devil://login?code=secret"));
    assert!(!receipt.received());
    assert!(receipt.receive("tokhive-bee-dev://login?code=secret&state=private"));
    assert!(receipt.received());
    assert!(receipt.receive("tokhive-bee-dev://login?code=second&state=other"));
    assert!(receipt.received());
}

#[cfg(unix)]
#[test]
fn unexpected_parent_death_closes_stdin_and_native_management_process_exits() {
    use std::{
        io::{BufRead, BufReader},
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let binary = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(format!("binaries/bee-{}", env!("BEE_TARGET")));
    assert!(
        binary.is_file(),
        "native Bee missing at {}",
        binary.display()
    );
    let script = r#"
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const child = spawn(process.argv[1], ['desktop'], {stdio: ['pipe', 'pipe', 'ignore']});
child.on('exit', () => process.exit(73));
setTimeout(() => process.exit(71), 3000).unref();
createInterface({input: child.stdout}).once('line', line => {
  const reply = JSON.parse(line);
  if (reply.protocol !== 1 || reply.id !== 'eof-hello' || !reply.result?.bee_version) process.exit(72);
  console.log(child.pid);
});
child.stdin.write(JSON.stringify({protocol:1,id:'eof-hello',method:'hello',params:{}}) + '\n');
setInterval(() => {}, 1000);
"#;
    let mut parent = Command::new("node")
        .args(["-e", script])
        .arg(&binary)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut pid = String::new();
    BufReader::new(parent.stdout.take().unwrap())
        .read_line(&mut pid)
        .unwrap();
    let pid: u32 = pid
        .trim()
        .parse()
        .expect("management child PID must be numeric");
    struct ParentAndChild<'a>(&'a mut std::process::Child, Option<u32>);
    impl Drop for ParentAndChild<'_> {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
            if let Some(pid) = self.1 {
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", &pid.to_string()])
                    .output();
            }
        }
    }
    let mut processes = ParentAndChild(&mut parent, Some(pid));
    processes.0.kill().unwrap();
    let parent_exit = processes.0.wait().unwrap();
    assert!(parent_exit.code().is_none(), "fixture parent exited before test kill: actual={parent_exit}; required=signal termination after child hello");
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let exists = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .output()
            .unwrap();
        if !exists.status.success() {
            processes.1 = None;
            break;
        }
        assert!(
            Instant::now() < deadline,
            "native management PID={pid} remained after parent death and stdin EOF for 5000ms"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}
