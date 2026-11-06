package bee

import (
	"fmt"
	"slices"

	"golang.org/x/sys/unix"
)

func observeDesktopAuthorizationGroup(group int) (desktopAuthorizationGroupStatus, error) {
	processes, err := unix.SysctlKinfoProcSlice("kern.proc.pgrp", group)
	if err != nil {
		return desktopAuthorizationGroupStatus{}, err
	}
	var result desktopAuthorizationGroupStatus
	for _, process := range processes {
		if process.Eproc.Pgid != int32(group) {
			return result, fmt.Errorf("kernel returned different process group: actual=%d expected=%d", process.Eproc.Pgid, group)
		}
		result.members = append(result.members, int(process.Proc.P_pid))
		result.evidence = append(result.evidence, fmt.Sprintf("%d:%d", process.Proc.P_pid, process.Proc.P_stat))
		// Darwin proc.h: SSTOP=4, SZOMB=5. Zombies cannot fork or retain FDs.
		if process.Proc.P_stat != 5 {
			result.live++
			if process.Proc.P_stat != 4 {
				result.moving++
			}
		}
	}
	slices.Sort(result.members)
	return result, nil
}
