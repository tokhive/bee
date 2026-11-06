//go:build windows

package bee

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// A suspended child cannot start descendants before assignment to our Job.
// Retained handles, never process names, identify the owned process tree.
func runDesktopAuthorization(ctx context.Context, command *exec.Cmd) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var name *uint16
	var security *windows.SecurityAttributes
	if lease := desktopLoginLeaseFromContext(ctx); lease != nil {
		if previous, err := openDesktopOriginalLoginJob(lease.name); err == nil {
			windows.CloseHandle(previous)
			return fmt.Errorf("owned login job already exists for original operation; no process is started")
		} else if !errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
			return fmt.Errorf("check original login job before launch: %w", err)
		}
		var err error
		name, err = windows.UTF16PtrFromString(lease.name)
		if err != nil {
			return err
		}
		security, err = privateWindowsSecurity()
		if err != nil {
			return err
		}
	}
	job, err := windows.CreateJobObject(security, name)
	if err != nil {
		return fmt.Errorf("create owned login job: %w", err)
	}
	defer windows.CloseHandle(job)
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		return fmt.Errorf("set owned login job limits: %w", err)
	}
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_SUSPENDED | windows.CREATE_NO_WINDOW}
	command.WaitDelay = time.Second
	if err = command.Start(); err != nil {
		return desktopAuthorizationProcessError("start suspended official process", err)
	}
	// Every setup failure kills and reaps the still-suspended child.
	abort := func(cause error) error {
		killErr := command.Process.Kill()
		waitErr := command.Wait()
		if waitErr != nil {
			var exited *exec.ExitError
			if errors.As(waitErr, &exited) {
				waitErr = nil
			}
		}
		if killErr != nil || waitErr != nil {
			return errors.Join(cause, &desktopAuthorizationCleanupError{errors.Join(killErr, waitErr)})
		}
		return cause
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE|windows.SYNCHRONIZE, false, uint32(command.Process.Pid))
	if err != nil {
		return abort(fmt.Errorf("open owned login process handle: %w", err))
	}
	defer windows.CloseHandle(process)
	if err = windows.AssignProcessToJobObject(job, process); err != nil {
		return abort(fmt.Errorf("assign suspended login process to job: %w", err))
	}
	if err = resumeDesktopAuthorizationThread(uint32(command.Process.Pid)); err != nil {
		return abort(err)
	}
	// Observe root exit without Cmd.Wait: descendants may still hold the
	// stdout pipe. Terminate the Job first, then let Cmd.Wait drain and reap.
	exited := make(chan error, 1)
	go func() {
		status, err := windows.WaitForSingleObject(process, windows.INFINITE)
		if err == nil && status != windows.WAIT_OBJECT_0 {
			err = fmt.Errorf("owned login wait status rejected: actual=%d expected=%d", status, windows.WAIT_OBJECT_0)
		}
		exited <- err
	}()
	var observed error
	received := false
	select {
	case observed = <-exited:
		received = true
	case <-ctx.Done():
		observed = ctx.Err()
	}
	terminateErr := windows.TerminateJobObject(job, 1)
	if terminateErr != nil {
		_ = command.Process.Kill()
	}
	if !received {
		observed = errors.Join(observed, <-exited)
	}
	waited := desktopAuthorizationExit(command.Wait())
	if terminateErr != nil {
		return errors.Join(observed, &desktopAuthorizationCleanupError{fmt.Errorf("terminate owned login job: %w", terminateErr)}, waited)
	}
	return errors.Join(observed, waited)

}
func resumeDesktopAuthorizationThread(pid uint32) error {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return fmt.Errorf("enumerate suspended login thread: %w", err)
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ThreadEntry32{Size: uint32(unsafe.Sizeof(windows.ThreadEntry32{}))}
	for err = windows.Thread32First(snapshot, &entry); err == nil; err = windows.Thread32Next(snapshot, &entry) {
		if entry.OwnerProcessID != pid {
			continue
		}
		thread, openErr := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, entry.ThreadID)
		if openErr != nil {
			return fmt.Errorf("open owned suspended thread: %w", openErr)
		}
		count, resumeErr := windows.ResumeThread(thread)
		windows.CloseHandle(thread)
		if resumeErr != nil {
			return fmt.Errorf("resume owned login thread: %w", resumeErr)
		}
		if count != 1 {
			return fmt.Errorf("owned login thread suspension count rejected: actual=%d expected=1", count)
		}
		return nil
	}
	return fmt.Errorf("owned suspended login thread not found: %w", err)
}

func desktopLoginSupervisor(context.Context, []string) error {
	return fmt.Errorf("login guardian unavailable: OS=windows; required=owned Windows Job execution")
}
