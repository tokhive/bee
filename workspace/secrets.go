package workspace

import (
	"fmt"
	"os"
	"path/filepath"
)

// credentialPaths are the files a Provider is most likely to leave in an
// environment built on their own machine. A v1 sandbox holds no login state:
// the buyer is root in the container and can read any file in the read-only
// root, so a stamped-in credential would be readable by every buyer.
var credentialPaths = []string{
	".claude/.credentials.json",
	".claude.json",
	".codex/auth.json",
	".config/opencode/auth.json",
	".ssh/id_rsa",
	".ssh/id_ed25519",
	".ssh/id_ecdsa",
	".ssh/identity",
	".aws/credentials",
	".config/gcloud/application_default_credentials.json",
	".config/gh/hosts.yml",
	".docker/config.json",
	".netrc",
	".git-credentials",
	".npmrc",
	".pypirc",
}

// scanEnvironment refuses to host an environment that carries credentials. It
// checks the root itself, a root account's home, and every ordinary home under
// /home: those are where an unpacked root filesystem keeps a user's state.
// A missing environment is not an error; the gVisor check reports that.
func scanEnvironment(root string) error {
	if root == "" {
		return nil
	}
	homes := []string{root, filepath.Join(root, "root")}
	if entries, err := os.ReadDir(filepath.Join(root, "home")); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				homes = append(homes, filepath.Join(root, "home", entry.Name()))
			}
		}
	}
	for _, home := range homes {
		for _, rel := range credentialPaths {
			path := filepath.Join(home, rel)
			if _, err := os.Lstat(path); err == nil {
				shown, err := filepath.Rel(root, path)
				if err != nil {
					shown = path
				}
				return fmt.Errorf("workspace: environment contains credentials at %s; a sandbox must not carry the provider's login state", shown)
			}
		}
	}
	return nil
}
