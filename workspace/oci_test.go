package workspace

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

func bundle(t *testing.T, cfg Config, spec beewire.WorkspaceSpec, volume string) ociSpec {
	t.Helper()
	body, err := buildSpec(cfg, spec, volume, 501, 20)
	if err != nil {
		t.Fatalf("build spec: %v", err)
	}
	var out ociSpec
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode spec: %v\n%s", err, body)
	}
	return out
}

func mountAt(spec ociSpec, destination string) *ociMount {
	for i := range spec.Mounts {
		if spec.Mounts[i].Destination == destination {
			return &spec.Mounts[i]
		}
	}
	return nil
}

// The volume is the only writable piece of the host a session gets. Everything
// else of the Provider's machine — a home directory, a socket, a checkout —
// must be unreachable by construction, not by convention.
func TestBuildSpecMountsOnlyTheVolumeFromTheHost(t *testing.T) {
	cfg := Config{Environment: "/opt/tokhive/environment", MemoryMB: 2048}
	out := bundle(t, cfg, beewire.WorkspaceSpec{ID: "ws-1", Command: []string{"/usr/local/bin/claude"}}, "/home/seller/workspaces/ws-1")

	if !out.Root.Readonly {
		t.Fatal("root filesystem is writable")
	}
	if out.Root.Path != cfg.Environment {
		t.Fatalf("root path %q, want the environment", out.Root.Path)
	}
	workspace := mountAt(out, "/workspace")
	if workspace == nil || workspace.Type != "bind" || workspace.Source != "/home/seller/workspaces/ws-1" {
		t.Fatalf("workspace mount: %+v", workspace)
	}
	for _, mount := range out.Mounts {
		if mount.Type == "bind" && mount.Destination != "/workspace" {
			t.Fatalf("host path %q mounted at %s", mount.Source, mount.Destination)
		}
	}
	if spec := strings.Join(out.Process.Args, " "); spec != "/usr/local/bin/claude" {
		t.Fatalf("args %q", spec)
	}
	if out.Process.NoNewPrivileges != true {
		t.Fatal("no-new-privileges is off")
	}
	for _, set := range [][]string{
		out.Process.Capabilities.Bounding, out.Process.Capabilities.Effective,
		out.Process.Capabilities.Permitted, out.Process.Capabilities.Ambient,
	} {
		if len(set) != 0 {
			t.Fatalf("capabilities granted: %v", set)
		}
	}
}

// Without network the sandbox must not even get a resolver, and with it the
// resolver has to arrive the same way the traffic does.
func TestBuildSpecGatesTheNetwork(t *testing.T) {
	spec := beewire.WorkspaceSpec{ID: "ws-1"}
	off := bundle(t, Config{Environment: "/env"}, spec, "/vol")
	if mountAt(off, "/etc/resolv.conf") != nil {
		t.Fatal("resolver mounted without network")
	}
	on := bundle(t, Config{Environment: "/env", AllowNetwork: true}, spec, "/vol")
	if mountAt(on, "/etc/resolv.conf") == nil {
		t.Fatal("resolver missing with network")
	}
}

// The account the Bee runs as is the one id the sandbox is mapped to: nothing
// needs root, and everything the session writes on its volume belongs to the
// Provider's own account.
func TestBuildSpecMapsOneRootlessID(t *testing.T) {
	out := bundle(t, Config{Environment: "/env", MemoryMB: 1024}, beewire.WorkspaceSpec{ID: "ws-1"}, "/vol")
	if len(out.Linux.UIDMappings) != 1 || out.Linux.UIDMappings[0].HostID != 501 || out.Linux.UIDMappings[0].Size != 1 {
		t.Fatalf("uid mappings: %+v", out.Linux.UIDMappings)
	}
	if len(out.Linux.GIDMappings) != 1 || out.Linux.GIDMappings[0].HostID != 20 {
		t.Fatalf("gid mappings: %+v", out.Linux.GIDMappings)
	}
	if out.Linux.GIDMappingsEnableSetgroups == nil || *out.Linux.GIDMappingsEnableSetgroups {
		t.Fatal("setgroups is allowed in the sandbox")
	}
	if out.Linux.Resources.Memory == nil || out.Linux.Resources.Memory.Limit != 1024<<20 {
		t.Fatalf("memory limit: %+v", out.Linux.Resources.Memory)
	}
	if out.Linux.Resources.Pids == nil || out.Linux.Resources.Pids.Limit != sandboxPids {
		t.Fatalf("pid limit: %+v", out.Linux.Resources.Pids)
	}
}

// Claude Code and Codex keep their state under HOME and are installed under
// /usr/local/bin or ~/.local/bin. A sandbox that points either somewhere else
// makes the two official clients fail on first run.
func TestBuildSpecHomeIsTheVolumeAndOnPath(t *testing.T) {
	out := bundle(t, Config{Environment: "/env"}, beewire.WorkspaceSpec{ID: "ws-1"}, "/vol")
	env := map[string]string{}
	for _, kv := range out.Process.Env {
		key, value, ok := strings.Cut(kv, "=")
		if ok {
			env[key] = value
		}
	}
	if env["HOME"] != "/workspace" {
		t.Fatalf("HOME %q", env["HOME"])
	}
	if env["TMPDIR"] != "/workspace/.tmp" {
		t.Fatalf("TMPDIR %q", env["TMPDIR"])
	}
	for _, dir := range []string{"/usr/local/bin", "/workspace/.local/bin"} {
		if !strings.Contains(env["PATH"], dir) {
			t.Fatalf("PATH %q lacks %s", env["PATH"], dir)
		}
	}
	if out.Process.Cwd != "/workspace" {
		t.Fatalf("cwd %q", out.Process.Cwd)
	}
}

// The runtime is driven directly: no daemon, no pull, and the network and
// cgroups flags say what the Provider consented to.
func TestGVisorArgs(t *testing.T) {
	off := strings.Join(gvisorArgs(Config{}, "/state", "ws-1", "/state/bundle"), " ")
	want := "--root=/state/runsc --network=none --rootless --ignore-cgroups run --bundle /state/bundle ws-1"
	if off != want {
		t.Fatalf("args:\n got %s\nwant %s", off, want)
	}
	on := strings.Join(gvisorArgs(Config{AllowNetwork: true, Cgroups: true}, "/state", "ws-1", "/bundle"), " ")
	want = "--root=/state/runsc --network=sandbox --rootless run --bundle /bundle ws-1"
	if on != want {
		t.Fatalf("args:\n got %s\nwant %s", on, want)
	}
}

// A Bee hosts nothing until it is told how, and the supported runtime needs an
// environment to run sessions from.
func TestNewRejectsGVisorWithoutAnEnvironment(t *testing.T) {
	if _, err := New(Config{}, t.TempDir()); err == nil {
		t.Fatal("gvisor started with no environment")
	}
}
