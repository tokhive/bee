package bee

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
)

func observeDesktopAuthorizationGroup(group int) (desktopAuthorizationGroupStatus, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return desktopAuthorizationGroupStatus{}, err
	}
	var result desktopAuthorizationGroupStatus
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 0 {
			continue
		}
		actual, err := syscall.Getpgid(pid)
		if errors.Is(err, syscall.ESRCH) {
			continue
		}
		if err != nil {
			return result, fmt.Errorf("read process group: pid=%d; %w", pid, err)
		}
		if actual != group {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if errors.Is(err, os.ErrNotExist) {
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
