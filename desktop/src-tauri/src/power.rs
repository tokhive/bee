//! Keeps the computer from sleeping when idle while an account shares, when
//! the person turned that on. The display may still sleep, and on a laptop
//! closing the lid still does; only idle system sleep is held off.

use std::sync::Mutex;

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CString};

    type CFStringRef = *const c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(alloc: *const c_void, text: *const c_char, encoding: u32) -> CFStringRef;
        fn CFRelease(value: *const c_void);
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(kind: CFStringRef, level: u32, name: CFStringRef, id: *mut u32) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    const UTF8: u32 = 0x0800_0100;
    const ASSERTION_ON: u32 = 255;

    fn cf_string(text: &str) -> CFStringRef {
        let text = CString::new(text).expect("no NUL in a constant");
        unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), UTF8) }
    }

    /// Takes a "prevent idle system sleep" assertion; `pmset -g assertions`
    /// lists it with `name`.
    pub fn hold(name: &str) -> Option<u32> {
        let kind = cf_string("PreventUserIdleSystemSleep");
        let reason = cf_string(name);
        if kind.is_null() || reason.is_null() {
            return None;
        }
        let mut id = 0;
        let result = unsafe { IOPMAssertionCreateWithName(kind, ASSERTION_ON, reason, &mut id) };
        unsafe {
            CFRelease(kind);
            CFRelease(reason);
        }
        (result == 0).then_some(id)
    }

    pub fn release(id: u32) {
        unsafe { IOPMAssertionRelease(id) };
    }
}

/// What macOS shows as the reason the computer stays awake.
const REASON: &str = "Bee is sharing AI accounts";

#[derive(Default)]
pub struct Awake {
    #[cfg(target_os = "macos")]
    held: Mutex<Option<u32>>,
    #[cfg(not(target_os = "macos"))]
    held: Mutex<bool>,
}

impl Awake {
    /// Holds off idle sleep when `want` is true and lets it go when false.
    pub fn set(&self, want: bool) {
        let mut held = self.held.lock().unwrap();
        #[cfg(target_os = "macos")]
        match (want, *held) {
            (true, None) => {
                *held = mac::hold(REASON);
                eprintln!("[bee-desktop] keeping the computer awake: {}", if held.is_some() { "on" } else { "failed" });
            }
            (false, Some(id)) => {
                mac::release(id);
                *held = None;
                eprintln!("[bee-desktop] keeping the computer awake: off");
            }
            _ => {}
        }
        #[cfg(not(target_os = "macos"))]
        if want != *held {
            *held = want;
            if want {
                eprintln!("[bee-desktop] keeping the computer awake is not supported on this system");
            }
        }
    }
}

/// Whether any account in Bee's platforms is sharing now.
pub fn sharing(platforms: &std::collections::BTreeMap<String, serde_json::Value>) -> bool {
    platforms.values().any(|p| p["sharing"]["state"] == "sharing")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn only_a_sharing_account_counts() {
        let mut platforms = BTreeMap::new();
        assert!(!sharing(&platforms));
        platforms.insert("claude".to_string(), json!({ "sharing": { "state": "paused" } }));
        assert!(!sharing(&platforms));
        platforms.insert("openai".to_string(), json!({ "sharing": { "state": "sharing" } }));
        assert!(sharing(&platforms));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn holds_and_releases_the_assertion() {
        let awake = Awake::default();
        awake.set(true);
        assert!(awake.held.lock().unwrap().is_some());
        awake.set(true);
        awake.set(false);
        assert!(awake.held.lock().unwrap().is_none());
    }
}
