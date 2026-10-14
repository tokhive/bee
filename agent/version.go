package bee

import (
	"runtime"
	"runtime/debug"
)

// Version is the release this binary was built as. Release builds set it
// through cmd/bee; a build from source stays "dev" and reports the commit Go
// recorded instead.
var Version = "dev"

// buildVersion is Version, or for a source build "dev+<commit>", with
// "-dirty" when the tree had local changes.
func buildVersion() string {
	// The commit is Bee's only when Bee is the main module; built through
	// Hive's workspace, Go records Hive's.
	info, ok := debug.ReadBuildInfo()
	if Version != "dev" || !ok || info.Main.Path != "github.com/tokhive/bee" {
		return Version
	}
	var revision, modified string
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.modified":
			modified = setting.Value
		}
	}
	if revision == "" {
		return Version
	}
	if len(revision) > 12 {
		revision = revision[:12]
	}
	if modified == "true" {
		revision += "-dirty"
	}
	return Version + "+" + revision
}

// versionLine is what bee version prints and bee run logs first, so a
// report from a provider says which build it came from.
func versionLine() string {
	return "bee " + buildVersion() + " " + runtime.GOOS + "/" + runtime.GOARCH
}

// userAgent identifies this build to Hive on every request and on the
// connection, so the console can show which Bees run an old release.
func userAgent() string {
	return "tokhive-bee/" + buildVersion() + " (" + runtime.GOOS + "/" + runtime.GOARCH + ")"
}
