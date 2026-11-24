package workspace

import (
	"encoding/json"
	"path/filepath"
	"strconv"

	"github.com/tokhive/bee/beewire"
)

// A sandbox is an OCI container. The Provider builds an environment once —
// with docker, podman or buildah, whose output is the interchange format —
// and every session is one bundle this file assembles around it: a read-only
// root filesystem, one writable volume at /workspace, and nothing else of the
// host.
//
// Nothing here needs a daemon, a socket, an image pull, or root: the runtime
// is executed directly on the bundle. That is the difference between using
// Docker's formats and installing Docker.

// The sandbox's environment. HOME is the volume because the root filesystem is
// read-only and build tools write caches under it; it contains no credentials,
// because nothing in a v1 sandbox holds the Provider's login state. PATH puts
// /usr/local/bin ahead of the system so a toolchain installed by npm or an
// installer script is found, and keeps ~/.local/bin working for installs that
// do not need root.
var sandboxEnv = []string{
	"PATH=/workspace/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
	"HOME=/workspace",
	"USER=workspace",
	"LOGNAME=workspace",
	"SHELL=/bin/sh",
	"TERM=xterm-256color",
	"TMPDIR=/workspace/.tmp",
	"LANG=C.UTF-8",
}

const (
	// sandboxPids bounds the processes one sandbox may have, so a fork bomb
	// in it reaches this ceiling instead of the machine's.
	sandboxPids = 512
	// sandboxNoFile is the file-descriptor ceiling. A terminal multiplexer and
	// a language server fit well inside it.
	sandboxNoFile = 8192
	// sandboxTmpMB is the size of the tmpfs at /tmp. Build caches belong in
	// /workspace; this is scratch.
	sandboxTmpMB = 256
)

// ociSpec is the subset of the OCI runtime specification this Bee writes. The
// file is read by runsc, which also fills in what the spec leaves out.
type ociSpec struct {
	OCIVersion string     `json:"ociVersion"`
	Process    ociProcess `json:"process"`
	Root       ociRoot    `json:"root"`
	Hostname   string     `json:"hostname"`
	Mounts     []ociMount `json:"mounts"`
	Linux      ociLinux   `json:"linux"`
}

type ociRoot struct {
	Path     string `json:"path"`
	Readonly bool   `json:"readonly"`
}

type ociProcess struct {
	Terminal        bool            `json:"terminal"`
	User            ociUser         `json:"user"`
	Args            []string        `json:"args"`
	Env             []string        `json:"env"`
	Cwd             string          `json:"cwd"`
	Capabilities    ociCapabilities `json:"capabilities"`
	Rlimits         []ociRlimit     `json:"rlimits"`
	NoNewPrivileges bool            `json:"noNewPrivileges"`
}

type ociUser struct {
	UID uint32 `json:"uid"`
	GID uint32 `json:"gid"`
}

// ociCapabilities is empty on purpose: a terminal that runs a buyer's agent
// needs no capability at all, and an empty bounding set is one fewer thing the
// sandbox can use.
type ociCapabilities struct {
	Bounding    []string `json:"bounding"`
	Effective   []string `json:"effective"`
	Inheritable []string `json:"inheritable"`
	Permitted   []string `json:"permitted"`
	Ambient     []string `json:"ambient"`
}

type ociRlimit struct {
	Type string `json:"type"`
	Hard uint64 `json:"hard"`
	Soft uint64 `json:"soft"`
}

type ociMount struct {
	Destination string   `json:"destination"`
	Type        string   `json:"type"`
	Source      string   `json:"source"`
	Options     []string `json:"options,omitempty"`
}

type ociLinux struct {
	Namespaces                 []ociNamespace `json:"namespaces"`
	Resources                  ociResources   `json:"resources"`
	UIDMappings                []ociIDMap     `json:"uidMappings,omitempty"`
	GIDMappings                []ociIDMap     `json:"gidMappings,omitempty"`
	GIDMappingsEnableSetgroups *bool          `json:"gidMappingsEnableSetgroups,omitempty"`
	MaskedPaths                []string       `json:"maskedPaths,omitempty"`
	ReadonlyPaths              []string       `json:"readonlyPaths,omitempty"`
}

type ociNamespace struct {
	Type string `json:"type"`
}

type ociIDMap struct {
	ContainerID uint32 `json:"containerID"`
	HostID      uint32 `json:"hostID"`
	Size        uint32 `json:"size"`
}

type ociResources struct {
	Memory *ociMemory `json:"memory,omitempty"`
	Pids   *ociPids   `json:"pids,omitempty"`
	CPU    *ociCPU    `json:"cpu,omitempty"`
}

type ociMemory struct {
	Limit int64 `json:"limit"`
}

type ociPids struct {
	Limit int64 `json:"limit"`
}

type ociCPU struct {
	Quota  int64 `json:"quota"`
	Period int64 `json:"period"`
}

// masking is the set the spec's defaults keep out of a container's view. The
// ranges are written out rather than globbed because the field takes paths.
var maskedPaths = []string{
	"/proc/acpi", "/proc/asound", "/proc/kcore", "/proc/keys", "/proc/latency_stats",
	"/proc/timer_list", "/proc/timer_stats", "/proc/sched_debug", "/proc/scsi",
	"/sys/firmware", "/sys/devices/virtual/powercap",
}

var readonlyPaths = []string{
	"/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger",
}

// buildSpec renders the bundle's config.json. volume is the session's only
// writable host path; nothing else of the host is mounted, which is what keeps
// a default like "share /Users" out of reach. hostUID and hostGID are the
// account the Bee runs as, which is the one id the sandbox is mapped to.
func buildSpec(c Config, spec beewire.WorkspaceSpec, volume string, hostUID, hostGID uint32) ([]byte, error) {
	args := spec.Command
	if len(args) == 0 {
		args = c.Command
	}
	if len(args) == 0 {
		args = []string{"/bin/sh"}
	}
	mounts := []ociMount{
		{Destination: "/proc", Type: "proc", Source: "proc"},
		{Destination: "/dev", Type: "tmpfs", Source: "tmpfs",
			Options: []string{"nosuid", "strictatime", "mode=755", "size=65536k"}},
		{Destination: "/dev/pts", Type: "devpts", Source: "devpts",
			Options: []string{"nosuid", "noexec", "newinstance", "ptmxmode=0666", "mode=0620"}},
		{Destination: "/dev/shm", Type: "tmpfs", Source: "shm",
			Options: []string{"nosuid", "noexec", "nodev", "mode=1777", "size=65536k"}},
		{Destination: "/workspace", Type: "bind", Source: volume,
			Options: []string{"rbind", "nosuid", "nodev"}},
		{Destination: "/tmp", Type: "tmpfs", Source: "tmpfs",
			Options: []string{"nosuid", "nodev", "mode=1777", "size=" + strconv.Itoa(sandboxTmpMB) + "m"}},
	}
	// No host resolver or hosts file: v1 sandboxes have no network at all. Model
	// traffic stays on the Hub path, and the Provider's LAN must not be one
	// route away from a buyer's command.
	memory := c.MemoryMB
	if memory <= 0 {
		memory = 1024
	}
	// The tier asks for a ceiling; the Provider's configuration is the consent
	// ceiling above it. Taking the minimum means a tier can lower memory but
	// never exceed what this Provider agreed to rent.
	if spec.MemoryMB > 0 && spec.MemoryMB < memory {
		memory = spec.MemoryMB
	}
	denySetgroups := false
	out := ociSpec{
		OCIVersion: "1.0.2",
		Process: ociProcess{
			Terminal: false,
			User:     ociUser{UID: 0, GID: 0},
			Args:     args,
			Env:      append([]string{}, sandboxEnv...),
			Cwd:      "/workspace",
			Capabilities: ociCapabilities{
				Bounding: []string{}, Effective: []string{}, Inheritable: []string{},
				Permitted: []string{}, Ambient: []string{},
			},
			Rlimits: []ociRlimit{
				{Type: "RLIMIT_NOFILE", Hard: sandboxNoFile, Soft: sandboxNoFile},
				{Type: "RLIMIT_CORE", Hard: 0, Soft: 0},
			},
			NoNewPrivileges: true,
		},
		// Read-only: a session's writes belong on its volume, and an
		// environment shared by every session must not be changed by one.
		Root:     ociRoot{Path: c.Environment, Readonly: true},
		Hostname: "workspace",
		Mounts:   mounts,
		Linux: ociLinux{
			Namespaces: []ociNamespace{
				{Type: "pid"}, {Type: "ipc"}, {Type: "uts"}, {Type: "mount"},
				{Type: "network"}, {Type: "user"},
			},
			// One id, mapped to the Provider's own: rootless needs no
			// subuid range, and everything the sandbox writes on its volume
			// is owned by the account that runs the Bee.
			UIDMappings: []ociIDMap{{ContainerID: 0, HostID: hostUID, Size: 1}},
			GIDMappings: []ociIDMap{{ContainerID: 0, HostID: hostGID, Size: 1}},
			// Written as false so an unmapped group cannot be raised back to
			// the host's groups with setgroups.
			GIDMappingsEnableSetgroups: &denySetgroups,
			Resources: ociResources{
				Memory: &ociMemory{Limit: int64(memory) << 20},
				Pids:   &ociPids{Limit: sandboxPids},
			},
			MaskedPaths:   maskedPaths,
			ReadonlyPaths: readonlyPaths,
		},
	}
	if spec.CPU > 0 {
		out.Linux.Resources.CPU = &ociCPU{Quota: int64(spec.CPU * 100000), Period: 100000}
	}
	return json.MarshalIndent(out, "", "  ")
}

// gvisorArgs is the command line for one session. Network is always off: v1
// sandboxes are tools, not model clients. The sandbox always runs rootless and
// mapped to the account running the Bee, so it can write its volume and nothing
// else of the host; cgroups stay enabled so memory, CPU and pids are enforced.
func gvisorArgs(state, id, bundle string) []string {
	args := []string{
		"--root=" + filepath.Join(state, "runsc"),
		"--network=none",
		"--rootless",
	}
	return append(args, "run", "--bundle", bundle, id)
}
