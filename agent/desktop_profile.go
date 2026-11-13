package bee

import (
	"fmt"
	"os"
	"path/filepath"
)

// DesktopProfileMode is fixed for the lifetime of one management process.
type DesktopProfileMode string

const (
	DesktopProfileCurrent  DesktopProfileMode = "current"
	DesktopProfilePrepare  DesktopProfileMode = "prepare"
	DesktopProfileActivate DesktopProfileMode = "activate"
)

func (m DesktopProfileMode) Validate() error {
	if m != DesktopProfileCurrent && m != DesktopProfilePrepare && m != DesktopProfileActivate {
		return fmt.Errorf("desktop profile mode rejected: actual=%q; required=current|prepare|activate", m)
	}
	return nil
}

// NewDesktopProfileDevice accepts only the core-derived existing private directory.
// It never creates a missing profile, changes a running device path, or falls back.
func NewDesktopProfileDevice(directory string, mode DesktopProfileMode) (*DesktopDevice, error) {
	if err := mode.Validate(); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return nil, fmt.Errorf("desktop profile directory rejected: absolute=%t clean=%t; required=absolute clean existing directory", filepath.IsAbs(directory), filepath.Clean(directory) == directory)
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return nil, fmt.Errorf("desktop profile directory lookup: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("desktop profile directory rejected: mode=%s; required=directory without symbolic link", info.Mode())
	}
	// Parent components must also be fixed. The native store supplies canonical paths.
	real, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return nil, fmt.Errorf("desktop profile directory resolution: %w", err)
	}
	if real != directory {
		return nil, fmt.Errorf("desktop profile directory rejected: canonical_match=false; resolve symbolic parent before launch")
	}
	return &DesktopDevice{path: filepath.Join(directory, "bee-desktop.json"), profileMode: mode}, nil
}
func (d *DesktopDevice) ProfileMode() DesktopProfileMode {
	if d == nil || d.profileMode == "" {
		return DesktopProfileCurrent
	}
	return d.profileMode
}

// DesktopProfileMethodAllowed is also mirrored by Rust before IPC emission.
func DesktopProfileMethodAllowed(mode DesktopProfileMode, method string) bool {
	if mode == DesktopProfileCurrent {
		return true
	}
	switch method {
	case "hello", "ping", "shutdown", "device_context", "device_status", "device_begin", "device_recovery_prepare", "device_recovery_confirm", "device_recovery_status", "runtime_inspect_recovery", "runtime_verify", "desktop_switch":
		return true
	case "runtime_configure_network", "network_status":
		return mode == DesktopProfileActivate
	}
	return false
}

func (d *DesktopDevice) ProfileDirectory() string {
	if d == nil || d.profileMode == "" || d.path == "" {
		return ""
	}
	return filepath.Dir(d.path)
}
