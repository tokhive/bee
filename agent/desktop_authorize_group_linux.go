package bee

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"slices"
	"strconv"
	"strings"
	"syscall"
)

func observeDesktopAuthorizationGroup(group int) (desktopAuthorizationGroupStatus, error) {
	return observeDesktopAuthorizationProcGroup(group, os.DirFS("/proc"), syscall.Getpgid)
}

func observeDesktopAuthorizationProcGroup(group int, proc fs.FS, getpgid func(int) (int, error)) (desktopAuthorizationGroupStatus, error) {
	entries, err := fs.ReadDir(proc, ".")
	if err != nil {
		return desktopAuthorizationGroupStatus{}, err
	}
	var result desktopAuthorizationGroupStatus
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 0 {
			continue
		}
		actual, err := getpgid(pid)
		if errors.Is(err, syscall.ESRCH) {
			continue
		}
		if err != nil {
			return result, fmt.Errorf("read process group: pid=%d; %w", pid, err)
		}
		if actual != group {
			continue
		}
		raw, err := fs.ReadFile(proc, path.Join(entry.Name(), "stat"))
		// The process can exit after Getpgid or after opening its proc file.
		// Linux may report either ENOENT or ESRCH for the vanished proc entry.
		if errors.Is(err, os.ErrNotExist) || errors.Is(err, syscall.ESRCH) {
			continue
		}
		if err != nil {
			return result, fmt.Errorf("read owned process state: pid=%d group=%d; %w", pid, group, err)
		}
		// comm may contain spaces or ')'; state follows the final closing ')'.
		end := strings.LastIndex(string(raw), ") ")
		if end < 0 {
			return result, fmt.Errorf("owned process stat rejected: pid=%d group=%d; missing command boundary", pid, group)
		}
		fields := strings.Fields(string(raw[end+2:]))
		if len(fields) < 3 || len(fields[0]) != 1 {
			return result, fmt.Errorf("owned process stat rejected: pid=%d group=%d fields=%d", pid, group, len(fields))
		}
		confirmed, err := strconv.Atoi(fields[2])
		if err != nil || confirmed != group {
			return result, fmt.Errorf("owned process group changed during observation: pid=%d actual=%s expected=%d", pid, fields[2], group)
		}
		result.members = append(result.members, pid)
		result.evidence = append(result.evidence, fmt.Sprintf("%d:%s", pid, fields[0]))
		if fields[0] != "Z" && fields[0] != "X" {
			result.live++
			if fields[0] != "T" && fields[0] != "t" {
				result.moving++
			}
		}
	}
	slices.Sort(result.members)
	return result, nil
}
