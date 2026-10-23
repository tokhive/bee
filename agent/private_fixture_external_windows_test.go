//go:build windows

package bee_test

import (
	"os"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func writePrivateFixture(path string, data []byte) error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	sid := user.User.Sid.String()
	sd, err := windows.SecurityDescriptorFromString("O:" + sid + "D:P(A;;FA;;;" + sid + ")")
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

func assertPrivateFixture(t *testing.T, path string) {
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
		t.Fatalf("fixture %q owner differs from current user: owner=%v error=%v", path, owner, err)
	}
	control, _, err := sd.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatalf("fixture %q DACL is not protected: control=%#x error=%v", path, control, err)
	}
	acl, _, err := sd.DACL()
	if err != nil || acl == nil || acl.AceCount != 1 {
		t.Fatalf("fixture %q DACL must grant only its current user: acl=%v error=%v", path, acl, err)
	}
	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(acl, 0, &ace); err != nil {
		t.Fatal(err)
	}
	if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || !(*windows.SID)(unsafe.Pointer(&ace.SidStart)).Equals(user.User.Sid) {
		t.Fatalf("fixture %q DACL grants another principal", path)
	}
}

// Query independently from Bee's private-file validation. SDDL includes owner,
// every DACL ACE and the inheritance/protection flags, unlike os.FileMode.
func officialFilePermissionSnapshot(t *testing.T, path string) string {
	t.Helper()
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatalf("snapshot official fixture owner/DACL for %q: %v", path, err)
	}
	if sd == nil {
		t.Fatalf("official fixture %q has no security descriptor", path)
	}
	sddl := sd.String()
	if sddl == "" {
		t.Fatalf("official fixture %q owner/DACL could not be encoded as SDDL", path)
	}
	return sddl
}

func TestOfficialFilePermissionSnapshotDetectsWindowsDACLChanges(t *testing.T) {
	path := t.TempDir() + `\auth.json`
	if err := writePrivateFixture(path, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	before := officialFilePermissionSnapshot(t, path)
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + user.User.Sid.String() + ")(A;;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
	if after := officialFilePermissionSnapshot(t, path); after == before {
		t.Fatal("official-file permission snapshot missed an added Everyone-read ACE")
	}
}

func preventTestReplacement(t *testing.T, directory, path string) func() {
	t.Helper()
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatalf("open fixture without delete sharing: %v", err)
	}
	return func() { _ = windows.CloseHandle(handle) }
}
