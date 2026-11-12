//go:build linux

package bee

import (
	"bufio"
	"context"
	"debug/buildinfo"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/tokhive/bee/logx"
	"golang.org/x/sys/unix"
)

func installHandoff(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee install-handoff", flag.ContinueOnError)
	flags.SetOutput(out)
	path := flags.String("config", "", "device configuration file whose running Bee the installer may stop")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *path == "" || flags.NArg() != 0 {
		return fmt.Errorf("install-handoff requires --config PATH and no positional arguments; config=%q, positional count=%d", *path, flags.NArg())
	}
	if !logx.Readable(os.Stdin) {
		return errors.New("install-handoff requires a terminal for confirmation; stop the existing Bee manually")
	}
	err := handoffWithInput(ctx, *path, os.Stdin, out, 10*time.Second)
	if err == nil {
		err = ctx.Err()
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ErrInstallHandoffCancelled
	}
	return err
}

func handoffWithInput(ctx context.Context, path string, input io.Reader, out io.Writer, timeout time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	ui, err := newInstallUI(out)
	if err != nil {
		return err
	}
	process, err := inspectHandoff(path)
	if err != nil {
		return fmt.Errorf("inspect configuration lock %s: %w; stop the existing process manually", path+".lock", err)
	}
	if process == nil {
		return nil // The original holder exited before inspection.
	}
	defer process.close()
	fmt.Fprintf(out, ui.text("Bee PID %d (UID %d) is running outside the managed systemd service.\nConfiguration: %s\nStopping it will interrupt current work.\n", "检测到 systemd 托管服务之外的 Bee 进程，PID %d（UID %d）。\n配置：%s\n停止会中断当前正在处理的任务。\n"), process.pid, os.Getuid(), path)
	reader := bufio.NewReader(input)
	for {
		fmt.Fprint(out, ui.text("Stop this Bee and switch to systemd background operation? [y/N]: ", "是否停止此 Bee 并改由 systemd 在后台运行？[y/N]: "))
		answer, readErr := readHandoffAnswer(ctx, reader)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if readErr != nil && readErr != io.EOF {
			return fmt.Errorf("read handoff confirmation for PID %d: %w", process.pid, readErr)
		}
		if readErr == io.EOF {
			break // An incomplete answer is not approval.
		}
		switch strings.ToLower(strings.TrimSpace(answer)) {
		case "y", "yes":
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := process.validate(); err != nil {
				return fmt.Errorf("recheck Bee PID %d before stopping: %w; stop it manually", process.pid, err)
			}
			if err := process.stop(ctx, timeout); err != nil {
				return err
			}
			ui.status(out, "✅", "32", "Previous Bee stopped and configuration lock released.", "旧 Bee 已停止，配置锁已释放。")
			return nil
		case "", "n", "no":
			fmt.Fprintln(out, ui.text("Existing Bee kept. The background service was not started.", "已保留原 Bee 进程，尚未启动后台服务。"))
			return ErrInstallHandoffCancelled
		default:
			fmt.Fprintln(out, ui.text("Please answer yes or no.", "请输入 y 或 n，回车默认否。"))
		}
	}
	fmt.Fprintln(out, ui.text("Existing Bee kept. The background service was not started.", "已保留原 Bee 进程，尚未启动后台服务。"))
	return ErrInstallHandoffCancelled
}

// A one-shot installer command must also exit when its terminal read is blocked.
// The buffered result lets the reader finish if cancellation wins the select.
func readHandoffAnswer(ctx context.Context, reader *bufio.Reader) (string, error) {
	type result struct {
		answer string
		err    error
	}
	answers := make(chan result, 1)
	go func() {
		answer, err := reader.ReadString('\n')
		answers <- result{answer, err}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case result := <-answers:
		return result.answer, result.err
	}
}

type handoffBee struct {
	pid, pidfd int
	lock       *os.File
	stat       unix.Stat_t
}

func inspectHandoff(path string) (*handoffBee, error) {
	fd, err := unix.Open(path+".lock", unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("open existing lock without following symlinks: %w", err)
	}
	process := &handoffBee{pidfd: -1, lock: os.NewFile(uintptr(fd), path+".lock")}
	ok := false
	defer func() {
		if !ok {
			process.close()
		}
	}()
	if err := unix.Fstat(fd, &process.stat); err != nil {
		return nil, fmt.Errorf("stat lock: %w", err)
	}
	if process.stat.Mode&unix.S_IFMT != unix.S_IFREG {
		return nil, fmt.Errorf("lock mode=%#o; expected regular file", process.stat.Mode)
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err == nil {
		return nil, nil // Closing the file releases this probe lock.
	} else if !errors.Is(err, unix.EWOULDBLOCK) {
		return nil, fmt.Errorf("probe lock: %w", err)
	}
	process.pid, err = process.owner()
	if err != nil {
		return nil, err
	}
	if process.pid <= 1 || process.pid == os.Getpid() {
		return nil, fmt.Errorf("lock holder PID=%d; expected a separate Bee worker", process.pid)
	}
	process.pidfd, err = unix.PidfdOpen(process.pid, 0)
	if err != nil {
		return nil, fmt.Errorf("pidfd_open PID %d: %w; kernel pidfd support is required", process.pid, err)
	}
	if err := process.validate(); err != nil {
		return nil, err
	}
	ok = true
	return process, nil
}

func (p *handoffBee) close() {
	if p.pidfd >= 0 {
		_ = unix.Close(p.pidfd)
	}
	_ = p.lock.Close()
}

func (p *handoffBee) owner() (int, error) {
	data, err := os.ReadFile("/proc/locks")
	if err != nil {
		return 0, fmt.Errorf("read /proc/locks: %w", err)
	}
	return handoffLockOwner(data, &p.stat)
}

func handoffLockOwner(data []byte, stat *unix.Stat_t) (int, error) {
	owners := make(map[int]bool)
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 8 || fields[1] != "FLOCK" || fields[2] != "ADVISORY" || fields[3] != "WRITE" {
			continue
		}
		device := strings.Split(fields[5], ":")
		if len(device) != 3 {
			continue
		}
		major, errMajor := strconv.ParseUint(device[0], 16, 32)
		minor, errMinor := strconv.ParseUint(device[1], 16, 32)
		inode, errInode := strconv.ParseUint(device[2], 10, 64)
		if errMajor != nil || errMinor != nil || errInode != nil || uint32(major) != unix.Major(stat.Dev) || uint32(minor) != unix.Minor(stat.Dev) || inode != stat.Ino {
			continue
		}
		pid, err := strconv.Atoi(fields[4])
		if err != nil || pid <= 1 {
			return 0, fmt.Errorf("lock inode=%d has invalid holder PID %q", stat.Ino, fields[4])
		}
		owners[pid] = true
	}
	if len(owners) != 1 {
		return 0, fmt.Errorf("lock device=%x:%x inode=%d has %d identifiable exclusive holders; expected one", unix.Major(stat.Dev), unix.Minor(stat.Dev), stat.Ino, len(owners))
	}
	for pid := range owners {
		return pid, nil
	}
	panic("unreachable")
}

func (p *handoffBee) validate() error {
	var current unix.Stat_t
	if err := unix.Lstat(p.lock.Name(), &current); err != nil {
		return fmt.Errorf("inspect lock path: %w", err)
	}
	if current.Dev != p.stat.Dev || current.Ino != p.stat.Ino || current.Mode&unix.S_IFMT != unix.S_IFREG {
		return fmt.Errorf("lock file changed at %s; original inode=%d, current inode=%d", p.lock.Name(), p.stat.Ino, current.Ino)
	}
	owner, err := p.owner()
	if err != nil {
		return err
	}
	if owner != p.pid {
		return fmt.Errorf("lock holder changed from PID %d to PID %d", p.pid, owner)
	}
	proc := filepath.Join("/proc", strconv.Itoa(p.pid))
	status, err := os.ReadFile(filepath.Join(proc, "status"))
	if err != nil {
		return fmt.Errorf("read PID %d status: %w", p.pid, err)
	}
	command, err := os.ReadFile(filepath.Join(proc, "cmdline"))
	if err != nil {
		return fmt.Errorf("read PID %d command: %w", p.pid, err)
	}
	cgroup, err := os.ReadFile(filepath.Join(proc, "cgroup"))
	if err != nil {
		return fmt.Errorf("read PID %d cgroup: %w", p.pid, err)
	}
	if err := validateHandoffMetadata(status, command, cgroup, os.Getuid()); err != nil {
		return fmt.Errorf("PID %d: %w", p.pid, err)
	}
	info, err := buildinfo.ReadFile(filepath.Join(proc, "exe"))
	if err != nil {
		return fmt.Errorf("read PID %d executable build identity: %w", p.pid, err)
	}
	if info.Path != "github.com/tokhive/bee/cmd/bee" {
		return fmt.Errorf("PID %d executable build path=%q; expected github.com/tokhive/bee/cmd/bee", p.pid, info.Path)
	}
	exited, err := p.exited()
	if err != nil {
		return err
	}
	if exited {
		return fmt.Errorf("original PID %d exited during identity verification", p.pid)
	}
	return nil
}

func validateHandoffMetadata(status, command, cgroup []byte, uid int) error {
	foundUID := false
	for _, line := range strings.Split(string(status), "\n") {
		if !strings.HasPrefix(line, "Uid:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 5 {
			return fmt.Errorf("process Uid record has %d fields; expected 5", len(fields))
		}
		for _, raw := range fields[1:] {
			if raw != strconv.Itoa(uid) {
				return fmt.Errorf("process UIDs=%s; expected only current UID %d", strings.Join(fields[1:], ","), uid)
			}
		}
		foundUID = true
	}
	if !foundUID {
		return errors.New("process status has no Uid record")
	}
	args := strings.Split(strings.TrimSuffix(string(command), "\x00"), "\x00")
	if len(args) == 0 || args[0] == "" {
		return errors.New("process command is empty; expected Bee run/start or menu")
	}
	if len(args) > 1 && args[1] != "run" && args[1] != "start" {
		return errors.New("process is not a Bee run/start worker or menu; finish the other command manually")
	}
	for _, line := range strings.Split(strings.TrimSpace(string(cgroup)), "\n") {
		fields := strings.SplitN(line, ":", 3)
		if len(fields) != 3 {
			return fmt.Errorf("process cgroup record=%q; expected hierarchy:controllers:path", line)
		}
		parts := strings.Split(strings.TrimPrefix(fields[2], "/"), "/")
		for i, part := range parts {
			// Desktop terminals can be scopes beneath the current user's manager.
			userManager := part == "user@"+strconv.Itoa(uid)+".service" && i >= 2 && i+1 < len(parts) && parts[i-1] == "user-"+strconv.Itoa(uid)+".slice" && parts[i-2] == "user.slice"
			if strings.HasSuffix(part, ".service") && !userManager {
				return fmt.Errorf("process belongs to systemd unit %q; stop its service manually", part)
			}
		}
	}
	return nil
}

func (p *handoffBee) exited() (bool, error) {
	poll := []unix.PollFd{{Fd: int32(p.pidfd), Events: unix.POLLIN}}
	_, err := unix.Poll(poll, 0)
	if err != nil {
		return false, fmt.Errorf("poll pidfd for PID %d: %w", p.pid, err)
	}
	if poll[0].Revents&(unix.POLLERR|unix.POLLNVAL) != 0 {
		return false, fmt.Errorf("poll pidfd for PID %d returned events=%#x", p.pid, poll[0].Revents)
	}
	return poll[0].Revents&(unix.POLLIN|unix.POLLHUP) != 0, nil
}

func (p *handoffBee) stop(ctx context.Context, timeout time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := unix.PidfdSendSignal(p.pidfd, syscall.SIGTERM, nil, 0); err != nil {
		return fmt.Errorf("pidfd_send_signal SIGTERM to Bee PID %d: %w; stop it manually", p.pid, err)
	}
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		exited, err := p.exited()
		if err != nil {
			return err
		}
		if exited {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("timed out after %s waiting for Bee PID %d to exit after SIGTERM; no SIGKILL sent; stop it manually", timeout, p.pid)
		case <-tick.C:
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	var current unix.Stat_t
	if err := unix.Lstat(p.lock.Name(), &current); err != nil {
		return fmt.Errorf("inspect released lock %s: %w", p.lock.Name(), err)
	}
	if current.Dev != p.stat.Dev || current.Ino != p.stat.Ino {
		return fmt.Errorf("lock file changed at %s after PID %d exited; expected inode=%d, got inode=%d", p.lock.Name(), p.pid, p.stat.Ino, current.Ino)
	}
	if err := unix.Flock(int(p.lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return fmt.Errorf("acquire %s after PID %d exited: %w; another process may have restarted Bee; manage it manually", p.lock.Name(), p.pid, err)
	}
	return nil
}
