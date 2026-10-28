use super::*;
use std::cell::{Cell, RefCell};
struct Fake {
    actual: Cell<bool>,
    fail_write: bool,
    fail_read: bool,
    calls: RefCell<Vec<bool>>,
}
impl Registrar for Fake {
    fn set(&self, enabled: bool) -> Result<(), BridgeError> {
        self.calls.borrow_mut().push(enabled);
        if self.fail_write {
            Err(problem(
                "AUTOSTART_REGISTER_FAILED",
                "OS registration rejected: desired=true",
            ))
        } else {
            self.actual.set(enabled);
            Ok(())
        }
    }
    fn registered(&self) -> Result<bool, BridgeError> {
        if self.fail_read {
            Err(problem(
                "AUTOSTART_QUERY_FAILED",
                "OS registration lookup failed",
            ))
        } else {
            Ok(self.actual.get())
        }
    }
}
fn fake() -> Fake {
    Fake {
        actual: Cell::new(false),
        fail_write: false,
        fail_read: false,
        calls: RefCell::new(vec![]),
    }
}
#[test]
fn autostart_status_does_not_modify_registration() {
    let f = fake();
    let s = status(true, &f);
    assert!(s.desired);
    assert_eq!(s.registered, Some(false));
    assert!(f.calls.borrow().is_empty());
}
#[test]
fn autostart_write_failure_keeps_desired_separate_from_observed() {
    let mut f = fake();
    f.fail_write = true;
    let s = apply(true, &f);
    assert!(s.desired);
    assert_eq!(s.registered, Some(false));
    assert_eq!(s.error.unwrap().code, "AUTOSTART_REGISTER_FAILED");
}
#[test]
fn autostart_query_failure_never_claims_registration() {
    let mut f = fake();
    f.fail_read = true;
    let s = apply(true, &f);
    assert!(s.desired);
    assert!(s.registered.is_none());
    assert_eq!(s.error.unwrap().code, "AUTOSTART_QUERY_FAILED");
}
#[test]
fn autostart_success_requires_matching_readback() {
    let f = fake();
    assert_eq!(apply(true, &f).registered, Some(true));
    assert_eq!(apply(false, &f).registered, Some(false));
    assert_eq!(*f.calls.borrow(), vec![true, false]);
}
#[test]
fn autostart_unconfirmed_readback_is_failure() {
    struct Noop;
    impl Registrar for Noop {
        fn set(&self, _: bool) -> Result<(), BridgeError> {
            Ok(())
        }
        fn registered(&self) -> Result<bool, BridgeError> {
            Ok(false)
        }
    }
    let s = apply(true, &Noop);
    assert_eq!(s.error.unwrap().code, "AUTOSTART_UNCONFIRMED");
    assert_eq!(s.registered, Some(false));
}

#[test]
fn autostart_background_requires_a_recoverable_tray() {
    assert!(crate::lifecycle::background_should_hide(true, true));
    assert!(!crate::lifecycle::background_should_hide(true, false));
    assert!(!crate::lifecycle::background_should_hide(false, true));
}
