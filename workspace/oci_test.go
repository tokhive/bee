package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
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

// A v1 sandbox has no network, so it gets no resolver even if an old config
// still asks for one.
func TestBuildSpecHasNoHostNetwork(t *testing.T) {
	spec := beewire.WorkspaceSpec{ID: "ws-1"}
	for _, cfg := range []Config{{Environment: "/env"}, {Environment: "/env", AllowNetwork: true}} {
		out := bundle(t, cfg, spec, "/vol")
		if mountAt(out, "/etc/resolv.conf") != nil || mountAt(out, "/etc/hosts") != nil {
			t.Fatalf("host resolver mounted with config %+v", cfg)
		}
	}
	if err := (Config{Runtime: "gvisor", Environment: "/env", Cgroups: true, AllowNetwork: true}).Validate(); err == nil {
		t.Fatal("allow_network was accepted")
	}
}

// The tier asks for a ceiling; the Provider's configuration is the consent
// ceiling above it. Neither can exceed the other silently.
func TestBuildSpecCapsMemoryAtTheProvider(t *testing.T) {
	cfg := Config{Environment: "/env", MemoryMB: 2048}
	if out := bundle(t, cfg, beewire.WorkspaceSpec{ID: "ws-1", MemoryMB: 4096}, "/vol"); out.Linux.Resources.Memory.Limit != 2048<<20 {
		t.Fatalf("memory limit %d, want the provider ceiling", out.Linux.Resources.Memory.Limit)
	}
	if out := bundle(t, cfg, beewire.WorkspaceSpec{ID: "ws-1", MemoryMB: 512}, "/vol"); out.Linux.Resources.Memory.Limit != 512<<20 {
		t.Fatalf("memory limit %d, want the tier ceiling", out.Linux.Resources.Memory.Limit)
	}
	if out := bundle(t, cfg, beewire.WorkspaceSpec{ID: "ws-1"}, "/vol"); out.Linux.Resources.Memory.Limit != 2048<<20 {
		t.Fatalf("memory limit %d, want the provider default", out.Linux.Resources.Memory.Limit)
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

// Tools installed under /usr/local/bin or ~/.local/bin must be found, and
// their caches belong on the writable volume.
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

// The runtime is driven directly: no daemon, no pull, no network, and cgroups
// stay on so the declared ceilings are enforced.
func TestGVisorArgs(t *testing.T) {
	got := strings.Join(gvisorArgs("/state", "ws-1", "/state/bundle"), " ")
	want := "--root=/state/runsc --network=none --rootless run --bundle /state/bundle ws-1"
	if got != want {
		t.Fatalf("args:\n got %s\nwant %s", got, want)
	}
}

// A Bee hosts nothing until it is told how, and the supported runtime needs an
// environment to run sessions from.
func TestNewRejectsGVisorWithoutAnEnvironment(t *testing.T) {
	if _, err := New(Config{Runtime: "gvisor", Cgroups: true}, t.TempDir()); err == nil {
		t.Fatal("gvisor started with no environment")
	}
}

// A root Bee gives a runtime escape the whole machine, so it is refused even
// before the environment is checked. The cgroups check runs on every platform.
func TestGVisorRequiresCgroups(t *testing.T) {
	err := (Config{Runtime: "gvisor", Environment: "/env", Cgroups: false}).Validate()
	if err == nil || !strings.Contains(err.Error(), "cgroups") {
		t.Fatalf("validate: %v", err)
	}
}

// An environment that carries the Provider's login state is refused before the
// first buyer can read it.
func TestScanEnvironmentRefusesCredentials(t *testing.T) {
	root := t.TempDir()
	if err := scanEnvironment(root); err != nil {
		t.Fatalf("clean environment rejected: %v", err)
	}
	path := filepath.Join(root, "home", "seller", ".claude")
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, ".credentials.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := scanEnvironment(root); err == nil {
		t.Fatal("credentials in a home directory were accepted")
	}
}
