//go:build darwin || linux

package bee_test

import (
	"os"
	"syscall"
)

func lockDoctorTestFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}
