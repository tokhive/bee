//go:build windows

package bee

import (
	"context"
	"errors"
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func openDesktopLoginProcessLock(path string, create bool) (*os.File, error) {
	security, err := privateWindowsSecurity()
	if err != nil {
		return nil, err
	}
	disposition := uint32(windows.OPEN_EXISTING)
	if create {
		disposition = windows.OPEN_ALWAYS
	}
	file, err := openWindowsRegularFile(path, windows.GENERIC_READ|windows.GENERIC_WRITE, disposition, security)
	if err != nil {
		return nil, err
	}
	if err := validatePrivateFile(file); err != nil {
		file.Close()
		return nil, err
	}
	if err := windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, new(windows.Overlapped)); err != nil {
		file.Close()
		return nil, fmt.Errorf("original login process guard still held: %w", err)
	}
	return file, nil
}

var desktopOpenLoginJob = windows.NewLazySystemDLL("kernel32.dll").NewProc("OpenJobObjectW")

func openDesktopOriginalLoginJob(name string) (windows.Handle, error) {
	value, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	// JOB_OBJECT_QUERY; opening a handle never grants ownership of any other
	// process name/PID. The private operation guard is acquired first.
	handle, _, callErr := desktopOpenLoginJob.Call(0x0004, 0, uintptr(unsafe.Pointer(value)))
	if handle == 0 {
		return 0, callErr
	}
	return windows.Handle(handle), nil
}

func confirmDesktopLoginProcessStopped(_ context.Context, lease *desktopLoginProcessLease) error {
	job, err := openDesktopOriginalLoginJob(lease.name)
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("query original login job ownership: %w", err)
	}
	defer windows.CloseHandle(job)
	var accounting struct {
		TotalUser, TotalKernel, PeriodUser, PeriodKernel int64
		PageFaults, Processes, Active, Terminated        uint32
	}
	if err := windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&accounting)), uint32(unsafe.Sizeof(accounting)), nil); err != nil {
		return fmt.Errorf("query original login job activity: %w", err)
	}
	if accounting.Active != 0 {
		return fmt.Errorf("original login job has active processes: active=%d; source verification requires zero", accounting.Active)
	}
	return nil
}
