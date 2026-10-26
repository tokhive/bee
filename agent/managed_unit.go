package bee

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// This deliberately accepts the installer's narrow unit format. Unknown
// directives and overrides require manual management rather than a guessed target.
func (s *managedService) validateUnit(owner string) error {
	info, err := os.Lstat(s.unitPath)
	if err != nil {
		return fmt.Errorf("inspect service file %q: %w", s.unitPath, err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 {
		return fmt.Errorf("service file %q mode=%s; expected a regular file without group/other write access", s.unitPath, info.Mode())
	}
	raw, err := os.ReadFile(s.unitPath)
	if err != nil {
		return fmt.Errorf("read service file %q: %w", s.unitPath, err)
	}
	if !strings.HasPrefix(string(raw), "# Managed by Bee install.sh.\n") {
		return fmt.Errorf("service file %q is not managed by Bee install.sh", s.unitPath)
	}
	expected := map[string][]string{
		"Unit.Description": {"TokHive Bee"}, "Unit.After": {"network.target"},
		"Service.Type": {"simple"}, "Service.User": {owner}, "Service.Restart": {"on-failure"}, "Service.RestartSec": {"10"},
		"Service.ExecCondition": {"/usr/bin/test -f " + serviceQuote(s.configPath, true), "/usr/bin/test -f " + serviceQuote(s.egressPath, true)},
		"Service.ExecStart":     {"/bin/sh -c " + serviceQuote(`exec "$@"`, true) + " bee " + serviceQuote(s.binary, true) + " run --config " + serviceQuote(s.configPath, true) + " --egress-config " + serviceQuote(s.egressPath, true)},
		"Install.WantedBy":      {"multi-user.target"},
	}
	seen := map[string]int{}
	env := map[string]string{}
	section := ""
	scanner := bufio.NewScanner(strings.NewReader(string(raw)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSuffix(strings.TrimPrefix(line, "["), "]")
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return fmt.Errorf("unsupported service line %q in %s", line, s.unitPath)
		}
		full := section + "." + key
		if full == "Service.Environment" {
			decoded, e := strconv.Unquote(value)
			if e != nil {
				return fmt.Errorf("invalid service Environment quoting in %s: %w", s.unitPath, e)
			}
			decoded = strings.ReplaceAll(decoded, "%%", "%")
			if serviceQuote(decoded, false) != value {
				return fmt.Errorf("service Environment re-encoding differs in %s; expected installer literal escaping", s.unitPath)
			}
			name, v, ok := strings.Cut(decoded, "=")
			switch name {
			case "HOME", "XDG_CONFIG_HOME", "PATH", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_SECURESTORAGE_CONFIG_DIR":
			default:
				return fmt.Errorf("unsupported service environment variable %q; manage unit manually", name)
			}
			if !ok {
				return fmt.Errorf("invalid Environment assignment in %s", s.unitPath)
			}
			if _, exists := env[name]; exists {
				return fmt.Errorf("duplicate service environment %q", name)
			}
			env[name] = v
			continue
		}
		values, ok := expected[full]
		n := seen[full]
		if !ok || n >= len(values) || value != values[n] {
			return fmt.Errorf("service %s=%q does not match this Bee configuration/executable; expected %q; manage it manually", full, value, values)
		}
		seen[full]++
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read service unit: %w", err)
	}
	for key, values := range expected {
		if seen[key] != len(values) {
			return fmt.Errorf("service %s count=%d; expected %d", key, seen[key], len(values))
		}
	}
	if env["XDG_CONFIG_HOME"] != filepath.Dir(filepath.Dir(s.configPath)) {
		return fmt.Errorf("service XDG_CONFIG_HOME=%q; expected %q", env["XDG_CONFIG_HOME"], filepath.Dir(filepath.Dir(s.configPath)))
	}
	if env["HOME"] == "" || env["PATH"] == "" {
		return fmt.Errorf("service HOME/PATH is missing; manage it manually")
	}
	return nil
}
func serviceQuote(value string, argument bool) string {
	value = strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "%", "%%").Replace(value)
	if argument {
		value = strings.ReplaceAll(value, "$", "$$")
	}
	return "\"" + value + "\""
}
