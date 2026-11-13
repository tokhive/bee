//go:build windows

package bee

import (
	"os"
	"path/filepath"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestPrivateFileWindowsUsesProtectedCurrentUserACL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	if err := writePrivateFile(path, []byte(`{}`), ".private-*"); err != nil {
		t.Fatal(err)
	}
	assertPrivateTestFile(t, path)
}

func assertPrivateTestFile(t *testing.T, path string) {
	t.Helper()
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil || !owner.Equals(user.User.Sid) {
		t.Fatalf("private file owner is not the current process user: error=%v", err)
	}
	control, _, err := sd.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatalf("private file DACL still inherits permissions: control=%#x; error=%v", control, err)
	}
	acl, _, err := sd.DACL()
	if err != nil || acl == nil || acl.AceCount != 1 {
		t.Fatalf("private file must grant access only to its current user: ACL=%v; error=%v", acl, err)
	}
	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(acl, 0, &ace); err != nil {
		t.Fatal(err)
	}
	sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
	if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || !sid.Equals(user.User.Sid) {
		t.Fatal("private file grants access to a different principal")
	}
}

func writeTestPrivateFile(path string, data []byte, mode os.FileMode) error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	dacl := "O:" + user.User.Sid.String() + "D:P(A;;FA;;;" + user.User.Sid.String() + ")"
	if mode&0077 != 0 {
		dacl += "(A;;FR;;;WD)"
	}
	sd, err := windows.SecurityDescriptorFromString(dacl)
	if err != nil {
		return err
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	handle, err := windows.CreateFile(name, windows.GENERIC_WRITE, windows.FILE_SHARE_READ, &sa, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return err
	}
	file := os.NewFile(uintptr(handle), path)
	defer file.Close()
	if _, err := file.Write(data); err != nil {
		return err
	}
	return file.Close()
}

func TestPrivateFileWindowsRejectsOtherUsersReadAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("O:" + user.User.Sid.String() + "D:P(A;;FA;;;" + user.User.Sid.String() + ")(A;;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	handle, err := windows.CreateFile(name, windows.GENERIC_WRITE, windows.FILE_SHARE_READ, &sa, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	file := os.NewFile(uintptr(handle), path)
	if _, err := file.WriteString(`{}`); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	opened, err := openRegularNoFollow(path)
	if err != nil {
		t.Fatalf("Everyone-read fixture must remain a readable ordinary file: %v", err)
	}
	defer opened.Close()
	if err := validatePrivateFile(opened); err == nil {
		t.Fatal("opened configuration accepted an Everyone-read ACE")
	}
	if _, err := readState(path); err == nil {
		t.Fatal("configuration accepted an Everyone-read ACE")
	}
}

func TestStateLockWindowsUsesProtectedCurrentUserACL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	unlock, err := lockState(path)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	assertPrivateTestFile(t, path+".lock")
}

func TestStateLockWindowsRejectsOtherUsersReadAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	if err := writeTestPrivateFile(path+".lock", []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	if unlock, err := lockState(path); err == nil {
		unlock()
		t.Fatal("configuration lock accepted an Everyone-read ACE")
	}
	if raw, err := os.ReadFile(path + ".lock"); err != nil || string(raw) != "original" {
		t.Fatalf("rejected insecure lock changed the original: error=%v", err)
	}
}

func TestPrivateFileWindowsFailedReplacementKeepsOriginal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	if err := writePrivateFile(path, []byte(`{"name":"original"}`), ".private-*"); err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	// No FILE_SHARE_DELETE: Windows must refuse replacement of this open file.
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	err = writePrivateFile(path, []byte(`{"name":"replacement"}`), ".private-*")
	closeErr := windows.CloseHandle(handle)
	if err == nil || closeErr != nil {
		t.Fatalf("locked destination replacement: error=%v; close error=%v", err, closeErr)
	}
	state, err := readState(path)
	if err != nil || state.Name != "original" {
		t.Fatalf("failed replacement changed the old file: name=%q; error=%v", state.Name, err)
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil || len(entries) != 1 {
		t.Fatalf("failed replacement left temporary files: entries=%d; error=%v", len(entries), err)
	}
}
