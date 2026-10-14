package bee

import (
	"runtime"
	"runtime/debug"
)

// Version is the release this binary was built as. Release builds set it
// through cmd/bee; a build from source stays "dev" and reports the commit Go
// recorded instead.
var Version = "dev"

// versionLine is what bee version prints and bee run logs first, so a
// report from a provider says which build it came from.
func versionLine() string {
	line := "bee " + Version
	// The commit is Bee's only when Bee is the main module; built through
	// Hive's workspace, Go records Hive's.
	if info, ok := debug.ReadBuildInfo(); ok && Version == "dev" && info.Main.Path == "github.com/tokhive/bee" {
		var revision, modified string
		for _, setting := range info.Settings {
			switch setting.Key {
			case "vcs.revision":
				revision = setting.Value
			case "vcs.modified":
				modified = setting.Value
			}
		}
		if len(revision) > 12 {
			revision = revision[:12]
		}
		if revision != "" {
			if modified == "true" {
				revision += "-dirty"
			}
			line += " (" + revision + ")"
		}
	}
	return line + " " + runtime.GOOS + "/" + runtime.GOARCH
}
