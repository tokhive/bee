#![cfg(windows)]

use super::{create_private, protected_open, replace, validate_security_descriptor};
use std::{
    ffi::c_void,
    fs::{self, File},
    io::{self, Read, Write},
    os::windows::{
        ffi::OsStrExt,
        fs::symlink_file,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Path, PathBuf},
    ptr::{null, null_mut},
    sync::atomic::{AtomicU64, Ordering},
};
use windows_sys::Win32::{
    Foundation::{LocalFree, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            ConvertStringSidToSidW, GetSecurityInfo, SDDL_REVISION_1, SE_FILE_OBJECT,
        },
        GetAce, GetSecurityDescriptorControl, GetTokenInformation, TokenUser, ACCESS_ALLOWED_ACE,
        ACL, DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, SECURITY_ATTRIBUTES,
        SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{
        CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    },
    System::{
        SystemServices::ACCESS_ALLOWED_ACE_TYPE,
        Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "bee-private-windows-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Local(*mut c_void);
impl Drop for Local {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
    text.encode_wide().chain(Some(0)).collect()
}
fn sid_text(sid: *mut c_void) -> String {
    let mut output = null_mut();
    assert_ne!(
        unsafe { ConvertSidToStringSidW(sid, &mut output) },
        0,
        "{}",
        io::Error::last_os_error()
    );
    let owned = Local(output.cast());
    let len = unsafe { (0..).find(|&i| *output.add(i) == 0).unwrap() };
    let text = String::from_utf16(unsafe { std::slice::from_raw_parts(output, len) }).unwrap();
    drop(owned);
    text
}
fn current_sid() -> String {
    let mut token = null_mut();
    assert_ne!(
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) },
        0,
        "{}",
        io::Error::last_os_error()
    );
    let token = unsafe { OwnedHandle::from_raw_handle(token) };
    let mut size = 0;
    unsafe {
        GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut size);
    }
    assert!(size >= std::mem::size_of::<TOKEN_USER>() as u32);
    let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
    assert_ne!(
        unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            )
        },
        0,
        "{}",
        io::Error::last_os_error()
    );
    sid_text(unsafe { (*(buffer.as_ptr().cast::<TOKEN_USER>())).User.Sid })
}
fn descriptor(text: &str) -> Local {
    let input = wide(std::ffi::OsStr::new(text));
    let mut output = null_mut();
    assert_ne!(
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                input.as_ptr(),
                SDDL_REVISION_1,
                &mut output,
                null_mut(),
            )
        },
        0,
        "{}",
        io::Error::last_os_error()
    );
    Local(output)
}
fn create_fixture(path: &Path, sddl: &str, bytes: &[u8]) {
    let security = descriptor(sddl);
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: security.0,
        bInheritHandle: 0,
    };
    let path_wide = wide(path.as_os_str());
    let handle = unsafe {
        CreateFileW(
            path_wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    assert_ne!(
        handle,
        INVALID_HANDLE_VALUE,
        "{}",
        io::Error::last_os_error()
    );
    let mut file = unsafe { File::from_raw_handle(handle) };
    file.write_all(bytes).unwrap();
    file.sync_all().unwrap();
}
fn write_private(path: &Path, bytes: &[u8]) {
    let mut file = create_private(path).unwrap();
    file.write_all(bytes).unwrap();
    file.sync_all().unwrap();
}
fn assert_private_handle(file: &File) {
    let mut owner = null_mut();
    let mut acl: *mut ACL = null_mut();
    let mut sd = null_mut();
    assert_eq!(
        unsafe {
            GetSecurityInfo(
                file.as_raw_handle(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                &mut acl,
                null_mut(),
                &mut sd,
            )
        },
        0
    );
    let _owned = Local(sd);
    let expected = current_sid();
    assert_eq!(sid_text(owner), expected);
    let mut control = 0;
    let mut revision = 0;
    assert_ne!(
        unsafe { GetSecurityDescriptorControl(sd, &mut control, &mut revision) },
        0
    );
    assert_ne!(control & SE_DACL_PROTECTED, 0);
    assert!(!acl.is_null());
    let mut principals = Vec::new();
    for index in 0..unsafe { (*acl).AceCount as u32 } {
        let mut ace = null_mut();
        assert_ne!(unsafe { GetAce(acl, index, &mut ace) }, 0);
        let ace = unsafe { &*(ace.cast::<ACCESS_ALLOWED_ACE>()) };
        assert_eq!(ace.Header.AceType as u32, ACCESS_ALLOWED_ACE_TYPE);
        assert_eq!(ace.Header.AceFlags, 0);
        principals.push(sid_text(std::ptr::addr_of!(ace.SidStart).cast_mut().cast()));
    }
    principals.sort();
    let mut allowed = vec![expected, "S-1-5-18".to_owned()];
    allowed.sort();
    allowed.dedup();
    assert_eq!(principals, allowed);
}

#[test]
fn windows_private_file_is_protected_before_the_first_write() {
    let fixture = Fixture::new();
    let path = fixture.path("preferences.json");
    let mut file = create_private(&path).unwrap();
    assert_private_handle(&file);
    assert_eq!(file.metadata().unwrap().len(), 0);
    file.write_all(b"private preferences").unwrap();
    file.sync_all().unwrap();
    drop(file);
    let mut opened = protected_open(&path).unwrap();
    let mut bytes = Vec::new();
    opened.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"private preferences");
}

#[test]
fn windows_private_file_creation_never_truncates_an_existing_file() {
    let fixture = Fixture::new();
    let path = fixture.path("preferences.json");
    write_private(&path, b"original");
    assert!(create_private(&path).is_err());
    assert_eq!(fs::read(path).unwrap(), b"original");
}

#[test]
fn windows_private_file_rejects_a_public_dacl_without_changing_bytes() {
    let fixture = Fixture::new();
    let path = fixture.path("preferences.json");
    let user = current_sid();
    create_fixture(
        &path,
        &format!("O:{user}D:P(A;;FA;;;{user})(A;;FR;;;WD)"),
        b"original",
    );
    let error = protected_open(&path).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    assert!(error.to_string().contains("ACE"), "{error}");
    assert_eq!(fs::read(path).unwrap(), b"original");
}

#[test]
fn windows_private_file_rejects_a_foreign_owner_without_admin_privileges() {
    let user = current_sid();
    let user_wide = wide(std::ffi::OsStr::new(&user));
    let mut user_sid = null_mut();
    assert_ne!(
        unsafe { ConvertStringSidToSidW(user_wide.as_ptr(), &mut user_sid) },
        0
    );
    let _owned_user = Local(user_sid);
    // Descriptor validation avoids requiring SeRestorePrivilege just to build an owner-mismatch fixture.
    let foreign_owner = if user == "S-1-5-18" {
        "S-1-1-0"
    } else {
        "S-1-5-18"
    };
    let security = descriptor(&format!("O:{foreign_owner}D:P(A;;FA;;;{user})"));
    let error = validate_security_descriptor(security.0, user_sid).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    assert!(error.to_string().contains("owner"), "{error}");
}

#[test]
fn windows_private_file_rejects_inherited_null_and_empty_dacls() {
    let user = current_sid();
    let input = wide(std::ffi::OsStr::new(&user));
    let mut sid = null_mut();
    assert_ne!(
        unsafe { ConvertStringSidToSidW(input.as_ptr(), &mut sid) },
        0
    );
    let _owned = Local(sid);
    for text in [
        format!("O:{user}D:(A;;FA;;;{user})"),
        format!("O:{user}D:NO_ACCESS_CONTROL"),
        format!("O:{user}D:P"),
    ] {
        let sd = descriptor(&text);
        assert!(
            validate_security_descriptor(sd.0, sid).is_err(),
            "accepted {text}"
        );
    }
}

#[test]
fn windows_private_file_rejects_reparse_points_and_multiple_links() {
    let fixture = Fixture::new();
    let path = fixture.path("original.json");
    write_private(&path, b"original");
    let link = fixture.path("symlink.json");
    symlink_file(&path, &link)
        .expect("reparse test requires Windows Developer Mode or symlink privilege");
    assert!(protected_open(&link).is_err());
    let hardlink = fixture.path("hardlink.json");
    fs::hard_link(&path, &hardlink).unwrap();
    assert!(protected_open(&hardlink).is_err());
    assert_eq!(fs::read(path).unwrap(), b"original");
}

#[test]
fn windows_private_file_atomically_replaces_an_existing_destination() {
    let fixture = Fixture::new();
    let destination = fixture.path("preferences.json");
    let source = fixture.path("replacement.tmp");
    write_private(&destination, b"old");
    write_private(&source, b"new");
    replace(&source, &destination).unwrap();
    assert!(!source.exists());
    assert_eq!(fs::read(&destination).unwrap(), b"new");
    assert_private_handle(&protected_open(&destination).unwrap());
}

#[test]
fn windows_private_file_publishes_a_new_destination() {
    let fixture = Fixture::new();
    let source = fixture.path("replacement.tmp");
    let destination = fixture.path("preferences.json");
    write_private(&source, b"new");
    replace(&source, &destination).unwrap();
    assert!(!source.exists());
    assert_eq!(fs::read(&destination).unwrap(), b"new");
    assert_private_handle(&protected_open(&destination).unwrap());
}

#[test]
fn windows_private_file_failed_replacement_preserves_both_files() {
    let fixture = Fixture::new();
    let destination = fixture.path("preferences.json");
    let source = fixture.path("replacement.tmp");
    write_private(&destination, b"original");
    write_private(&source, b"replacement");
    let input = wide(destination.as_os_str());
    // No FILE_SHARE_DELETE: a successful replacement would violate Windows sharing rules.
    let locked = unsafe {
        CreateFileW(
            input.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    assert_ne!(
        locked,
        INVALID_HANDLE_VALUE,
        "{}",
        io::Error::last_os_error()
    );
    let locked = unsafe { OwnedHandle::from_raw_handle(locked) };
    assert!(replace(&source, &destination).is_err());
    drop(locked);
    assert_eq!(fs::read(&destination).unwrap(), b"original");
    assert_eq!(fs::read(&source).unwrap(), b"replacement");
    assert_private_handle(&protected_open(&destination).unwrap());
}

#[test]
fn windows_private_file_does_not_replace_an_insecure_destination() {
    let fixture = Fixture::new();
    let source = fixture.path("replacement.tmp");
    let destination = fixture.path("preferences.json");
    let user = current_sid();
    create_fixture(
        &destination,
        &format!("O:{user}D:P(A;;FA;;;{user})(A;;FR;;;WD)"),
        b"original",
    );
    write_private(&source, b"replacement");
    assert!(replace(&source, &destination).is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"original");
    assert_eq!(fs::read(&source).unwrap(), b"replacement");
}
