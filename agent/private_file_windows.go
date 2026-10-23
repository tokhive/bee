//go:build windows

package bee

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func openRegularNoFollow(path string) (*os.File, error) {
	return openWindowsRegularFile(path, windows.GENERIC_READ, windows.OPEN_EXISTING, nil)
}

func openWindowsRegularFile(path string, access, disposition uint32, security *windows.SecurityAttributes) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, &os.PathError{Op: "encode Windows file path", Path: path, Err: err}
	}
	handle, err := windows.CreateFile(name, access, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, security, disposition, windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open regular file without following reparse points", Path: path, Err: err}
	}
	file := os.NewFile(uintptr(handle), path)
	if err := validateWindowsRegularFile(file); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

func validateWindowsRegularFile(file *os.File) error {
	handle := windows.Handle(file.Fd())
	kind, err := windows.GetFileType(handle)
	if err != nil {
		return fmt.Errorf("query file type for %q: %w", file.Name(), err)
	}
	if kind != windows.FILE_TYPE_DISK {
		return fmt.Errorf("file %q has Windows type=%#x; required=ordinary disk file", file.Name(), kind)
	}
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return fmt.Errorf("query opened file attributes for %q: %w", file.Name(), err)
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("file %q has reparse attributes=%#x; required=no reparse point", file.Name(), info.FileAttributes)
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		return fmt.Errorf("file %q has directory attributes=%#x; required=regular file", file.Name(), info.FileAttributes)
	}
	return nil
}

func validatePrivateFile(file *os.File) error {
	if err := validateWindowsRegularFile(file); err != nil {
		return err
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return fmt.Errorf("query current process user for %q: %w", file.Name(), err)
	}
	sd, err := windows.GetSecurityInfo(windows.Handle(file.Fd()), windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return fmt.Errorf("query opened file owner and DACL for %q: %w", file.Name(), err)
	}
	owner, _, err := sd.Owner()
	if err != nil {
		return fmt.Errorf("read owner SID for %q: %w", file.Name(), err)
	}
	if owner == nil || !owner.Equals(user.User.Sid) {
		return fmt.Errorf("file %q has owner SID=%v; required current process SID=%s", file.Name(), owner, user.User.Sid.String())
	}
	control, _, err := sd.Control()
	if err != nil {
		return fmt.Errorf("read DACL control for %q: %w", file.Name(), err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return fmt.Errorf("file %q has DACL control=%#x; required=protected DACL", file.Name(), control)
	}
	acl, _, err := sd.DACL()
	if err != nil {
		return fmt.Errorf("read DACL for %q: %w", file.Name(), err)
	}
	if acl == nil || acl.AceCount == 0 {
		return fmt.Errorf("file %q has missing or empty DACL; required=explicit current-user access", file.Name())
	}
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(acl, i, &ace); err != nil {
			return fmt.Errorf("read DACL ACE %d for %q: %w", i, file.Name(), err)
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Header.AceFlags&(windows.INHERITED_ACE|windows.INHERIT_ONLY_ACE) != 0 {
			return fmt.Errorf("file %q has DACL ACE %d type=%d flags=%#x; required=explicit current-user allow ACE", file.Name(), i, ace.Header.AceType, ace.Header.AceFlags)
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if !sid.IsValid() || !sid.Equals(user.User.Sid) {
			return fmt.Errorf("file %q has DACL ACE %d granting SID=%v mask=%#x; required current process SID=%s only", file.Name(), i, sid, ace.Mask, user.User.Sid.String())
		}
	}
	return nil
}

func privateWindowsSecurity() (*windows.SecurityAttributes, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, fmt.Errorf("query current process user for private file creation: %w", err)
	}
	sid := user.User.Sid.String()
	sd, err := windows.SecurityDescriptorFromString("O:" + sid + "D:P(A;;FA;;;" + sid + ")")
	if err != nil {
		return nil, fmt.Errorf("build protected current-user file security descriptor: %w", err)
	}
	return &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}, nil
}

// Create the temporary file with its final ACL, before any private bytes exist.
// MoveFileEx replaces the old directory entry without deleting it first.
func writePrivateFile(path string, data []byte, pattern string) error {
	if err := checkPrivateReplacementTarget(path); err != nil {
		return err
	}
	if strings.ContainsAny(pattern, `/\`) {
		return fmt.Errorf("temporary private-file pattern %q contains a path separator; required=basename pattern", pattern)
	}
	security, err := privateWindowsSecurity()
	if err != nil {
		return err
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return fmt.Errorf("generate private temporary filename for %q: %w", path, err)
	}
	prefix, suffix := pattern, ""
	if at := strings.LastIndexByte(pattern, '*'); at >= 0 {
		prefix, suffix = pattern[:at], pattern[at+1:]
	}
	temporary := filepath.Join(filepath.Dir(path), prefix+hex.EncodeToString(random[:])+suffix)
	file, err := openWindowsRegularFile(temporary, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.CREATE_NEW, security)
	if err != nil {
		return err
	}
	defer os.Remove(temporary)
	defer file.Close()
	if err := validatePrivateFile(file); err != nil {
		return fmt.Errorf("check private replacement protection for %q: %w", path, err)
	}
	if _, err := file.Write(data); err != nil {
		return fmt.Errorf("write private replacement for %q: %w", path, err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("flush private replacement for %q: %w", path, err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close private replacement for %q: %w", path, err)
	}
	if err := checkPrivateReplacementTarget(path); err != nil {
		return err
	}
	from, err := windows.UTF16PtrFromString(temporary)
	if err != nil {
		return fmt.Errorf("encode private replacement path: %w", err)
	}
	to, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return fmt.Errorf("encode private destination path %q: %w", path, err)
	}
	if err := windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH); err != nil {
		return fmt.Errorf("replace private file %q with synced temporary file: %w", path, err)
	}
	return nil
}

func checkPrivateReplacementTarget(path string) error {
	file, err := openRegularNoFollow(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("check private replacement target: %w", err)
	}
	return file.Close()
}
