//! Windows preferences files: validate the opened object and set its ACL at creation.

use std::{
    ffi::{c_void, OsStr},
    fs::File,
    io,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{
        LocalFree, ERROR_INSUFFICIENT_BUFFER, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE,
    },
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            GetSecurityInfo, SDDL_REVISION_1, SE_FILE_OBJECT,
        },
        EqualSid, GetAce, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
        GetSecurityDescriptorOwner, GetTokenInformation, IsValidAcl, IsValidSecurityDescriptor,
        IsValidSid, IsWellKnownSid, TokenUser, WinLocalSystemSid, ACCESS_ALLOWED_ACE, ACL,
        DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
        SECURITY_ATTRIBUTES, SE_DACL_PROTECTED, SID, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{
        CreateFileW, GetFileInformationByHandle, GetFileType, MoveFileExW,
        BY_HANDLE_FILE_INFORMATION, CREATE_NEW, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_DISK,
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, OPEN_EXISTING, READ_CONTROL,
    },
    System::{
        SystemServices::ACCESS_ALLOWED_ACE_TYPE,
        Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

struct LocalAllocation(*mut c_void);
impl Drop for LocalAllocation {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}

fn denied(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message.into())
}
fn api_error(api: &str) -> io::Error {
    let cause = io::Error::last_os_error();
    io::Error::new(
        cause.kind(),
        format!("{api} failed: {cause}; os_code={:?}", cause.raw_os_error()),
    )
}
fn wide(value: &OsStr) -> io::Result<Vec<u16>> {
    let mut encoded: Vec<u16> = value.encode_wide().collect();
    if let Some(index) = encoded.iter().position(|unit| *unit == 0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Windows file path has a NUL at UTF-16 index={index}; required=no embedded NUL"
            ),
        ));
    }
    encoded.push(0);
    Ok(encoded)
}

struct CurrentUser {
    buffer: Vec<usize>,
}
impl CurrentUser {
    fn query() -> io::Result<Self> {
        let mut token = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(api_error("OpenProcessToken(TOKEN_QUERY)"));
        }
        let token = unsafe { OwnedHandle::from_raw_handle(token) };
        let mut size = 0;
        let result = unsafe {
            GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut size)
        };
        let cause = io::Error::last_os_error();
        if result != 0
            || cause.raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32)
            || size < std::mem::size_of::<TOKEN_USER>() as u32
        {
            return Err(io::Error::new(cause.kind(), format!(
                "GetTokenInformation(TokenUser) size probe result={result} bytes={size} os_code={:?}; required=ERROR_INSUFFICIENT_BUFFER and TOKEN_USER storage", cause.raw_os_error())));
        }
        // TOKEN_USER contains pointers, so use pointer-aligned storage rather than Vec<u8>.
        let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            )
        } == 0
        {
            return Err(api_error("GetTokenInformation(TokenUser)"));
        }
        let user = Self { buffer };
        if unsafe { IsValidSid(user.sid()) } == 0 {
            return Err(denied("GetTokenInformation(TokenUser) returned an invalid SID; required=valid current process user"));
        }
        Ok(user)
    }
    fn sid(&self) -> PSID {
        unsafe { (*(self.buffer.as_ptr().cast::<TOKEN_USER>())).User.Sid }
    }
}

fn sid_text(sid: PSID) -> io::Result<String> {
    let mut output = null_mut();
    if unsafe { ConvertSidToStringSidW(sid, &mut output) } == 0 {
        return Err(api_error("ConvertSidToStringSidW"));
    }
    let _owned = LocalAllocation(output.cast());
    // The API returns a LocalAlloc-owned, NUL-terminated UTF-16 SID string.
    let length = unsafe { (0..).find(|index| *output.add(*index) == 0).unwrap() };
    String::from_utf16(unsafe { std::slice::from_raw_parts(output, length) }).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("SID string is invalid UTF-16: {error}"),
        )
    })
}

fn validate_security_descriptor(
    descriptor: PSECURITY_DESCRIPTOR,
    expected_owner: PSID,
) -> io::Result<()> {
    if descriptor.is_null() || unsafe { IsValidSecurityDescriptor(descriptor) } == 0 {
        return Err(denied("file security descriptor is missing or invalid; required=valid owner and protected DACL"));
    }
    let mut owner = null_mut();
    let mut defaulted = 0;
    if unsafe { GetSecurityDescriptorOwner(descriptor, &mut owner, &mut defaulted) } == 0 {
        return Err(api_error("GetSecurityDescriptorOwner"));
    }
    if owner.is_null() || unsafe { IsValidSid(owner) } == 0 {
        return Err(denied(
            "file owner SID is missing or invalid; required=current process user",
        ));
    }
    if unsafe { EqualSid(owner, expected_owner) } == 0 {
        return Err(denied(
            "file owner_matches_current_user=false; required=current process user ownership",
        ));
    }
    let mut control = 0;
    let mut revision = 0;
    if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0 {
        return Err(api_error("GetSecurityDescriptorControl"));
    }
    if control & SE_DACL_PROTECTED == 0 {
        return Err(denied(format!(
            "file DACL control={control:#x}; required=SE_DACL_PROTECTED"
        )));
    }
    let mut present = 0;
    let mut acl: *mut ACL = null_mut();
    if unsafe { GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted) } == 0
    {
        return Err(api_error("GetSecurityDescriptorDacl"));
    }
    if present == 0 || acl.is_null() || unsafe { IsValidAcl(acl) } == 0 {
        return Err(denied(format!(
            "file DACL present={present} null={}; required=valid explicit DACL",
            acl.is_null()
        )));
    }
    let count = unsafe { (*acl).AceCount as u32 };
    let mut user_granted = false;
    for index in 0..count {
        let mut ace = null_mut();
        if unsafe { GetAce(acl, index, &mut ace) } == 0 {
            return Err(api_error(&format!("GetAce(index={index})")));
        }
        // IsValidAcl/GetAce returned an ACE inside the OS-owned descriptor allocation.
        let header = unsafe { &*(ace.cast::<windows_sys::Win32::Security::ACE_HEADER>()) };
        if header.AceType as u32 != ACCESS_ALLOWED_ACE_TYPE || header.AceFlags != 0 {
            return Err(denied(format!(
                "file DACL ACE index={index} type={} flags={:#x}; required=explicit allow ACE",
                header.AceType, header.AceFlags
            )));
        }
        let sid_offset = std::mem::offset_of!(ACCESS_ALLOWED_ACE, SidStart);
        let sid_header_size = std::mem::offset_of!(SID, SubAuthority);
        if (header.AceSize as usize) < sid_offset + sid_header_size {
            return Err(denied(format!(
                "file DACL ACE index={index} size={}; required=allow ACE with SID",
                header.AceSize
            )));
        }
        let sid = unsafe { ace.cast::<u8>().add(sid_offset).cast::<c_void>() };
        let subauthorities = unsafe { (*(sid.cast::<SID>())).SubAuthorityCount as usize };
        let sid_size = sid_header_size + subauthorities * std::mem::size_of::<u32>();
        if sid_offset + sid_size > header.AceSize as usize || unsafe { IsValidSid(sid) } == 0 {
            return Err(denied(format!("file DACL ACE index={index} size={} SID bytes={sid_size}; required=valid bounded SID", header.AceSize)));
        }
        if unsafe { EqualSid(sid, expected_owner) } != 0 {
            user_granted = true;
        } else if unsafe { IsWellKnownSid(sid, WinLocalSystemSid) } == 0 {
            let mask = unsafe { (*(ace.cast::<ACCESS_ALLOWED_ACE>())).Mask };
            return Err(denied(format!("file DACL ACE index={index} mask={mask:#x} principal_matches_current_user=false principal_is_system=false; required=current process user or SYSTEM")));
        }
    }
    if !user_granted {
        return Err(denied(format!("file DACL ACE count={count} has no current-user grant; required=explicit current-user allow ACE")));
    }
    Ok(())
}

fn validate(file: &File, current_user: &CurrentUser) -> io::Result<()> {
    let handle = file.as_raw_handle();
    let kind = unsafe { GetFileType(handle) };
    if kind != FILE_TYPE_DISK {
        return Err(denied(format!(
            "opened file Windows type={kind}; required=FILE_TYPE_DISK"
        )));
    }
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 {
        return Err(api_error("GetFileInformationByHandle"));
    }
    if info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY) != 0
        || info.nNumberOfLinks != 1
    {
        return Err(denied(format!("opened file attributes={:#x} links={}; required=regular non-reparse file with one link", info.dwFileAttributes, info.nNumberOfLinks)));
    }
    let mut descriptor = null_mut();
    let status = unsafe {
        GetSecurityInfo(
            handle,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        let cause = io::Error::from_raw_os_error(status as i32);
        return Err(io::Error::new(
            cause.kind(),
            format!("GetSecurityInfo(owner,DACL) failed: {cause}; os_code={status}"),
        ));
    }
    let _owned = LocalAllocation(descriptor);
    validate_security_descriptor(descriptor, current_user.sid())
}

fn open(
    path: &Path,
    access: u32,
    disposition: u32,
    attributes: *const SECURITY_ATTRIBUTES,
) -> io::Result<File> {
    let input = wide(path.as_os_str())?;
    let handle = unsafe {
        CreateFileW(
            input.as_ptr(),
            access | READ_CONTROL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            attributes,
            disposition,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(api_error(&format!(
            "CreateFileW(disposition={disposition},OPEN_REPARSE_POINT)"
        )));
    }
    Ok(unsafe { File::from_raw_handle(handle) })
}

pub fn protected_open(path: &Path) -> io::Result<File> {
    let current_user = CurrentUser::query()?;
    let file = open(path, GENERIC_READ, OPEN_EXISTING, null())?;
    validate(&file, &current_user)?;
    Ok(file)
}

/// Ownership locks need a writable handle for LockFileEx while retaining the
/// same ACL/reparse-point checks as all private state reads.
pub fn protected_open_writable(path: &Path) -> io::Result<File> {
    let current_user = CurrentUser::query()?;
    let file = open(path, GENERIC_READ | GENERIC_WRITE, OPEN_EXISTING, null())?;
    validate(&file, &current_user)?;
    Ok(file)
}

pub fn create_private(path: &Path) -> io::Result<File> {
    let current_user = CurrentUser::query()?;
    let user = sid_text(current_user.sid())?;
    let system_grant = if unsafe { IsWellKnownSid(current_user.sid(), WinLocalSystemSid) } != 0 {
        ""
    } else {
        "(A;;FA;;;SY)"
    };
    let sddl = wide(OsStr::new(&format!(
        "O:{user}D:P(A;;FA;;;{user}){system_grant}"
    )))?;
    let mut descriptor = null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    } == 0
    {
        return Err(api_error(
            "ConvertStringSecurityDescriptorToSecurityDescriptorW(private ACL)",
        ));
    }
    let _owned = LocalAllocation(descriptor);
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    let file = open(path, GENERIC_READ | GENERIC_WRITE, CREATE_NEW, &attributes)?;
    validate(&file, &current_user)?;
    Ok(file)
}

/// Publish a caller-synced private temporary file. Never delete the old destination first.
pub fn replace(source: &Path, destination: &Path) -> io::Result<()> {
    if source == destination || source.parent() != destination.parent() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Windows private replacement requires distinct files in the same directory",
        ));
    }
    let _source = protected_open(source)?;
    let _destination = match protected_open(destination) {
        Ok(file) => Some(file),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    let from = wide(source.as_os_str())?;
    let to = wide(destination.as_os_str())?;
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(api_error("MoveFileExW(REPLACE_EXISTING|WRITE_THROUGH)"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "private_file_windows_tests.rs"]
mod tests;
