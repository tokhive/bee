package bee

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// diagnosticReport is what the desktop app saves when the person exports a
// diagnostic report for support: the overview and every bee doctor check,
// with the home directory and email addresses masked. It never holds a
// credential.
type diagnosticReport struct {
	GeneratedAt time.Time       `json:"generated_at"`
	Version     string          `json:"version"`
	OS          string          `json:"os"`
	Arch        string          `json:"arch"`
	Overview    controlOverview `json:"overview"`
	Doctor      doctorReport    `json:"doctor"`
}

var emailPattern = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)

// redactReport masks what identifies the person but is not needed to help
// them: their home directory and the local part of email addresses.
func redactReport(raw []byte) []byte {
	text := string(raw)
	if home, err := os.UserHomeDir(); err == nil && len(home) > 1 {
		text = strings.ReplaceAll(text, home, "~")
	}
	text = emailPattern.ReplaceAllStringFunc(text, maskEmail)
	return []byte(text)
}

func (c *controlServer) diagnostics(ctx context.Context) ([]byte, error) {
	egressPath := ""
	if fileExists(defaultEgressPath(c.configPath)) {
		egressPath = defaultEgressPath(c.configPath)
	}
	report := diagnosticReport{GeneratedAt: time.Now().UTC(), Version: Version, OS: runtime.GOOS, Arch: runtime.GOARCH, Overview: c.overview(), Doctor: diagnose(ctx, c.configPath, egressPath)}
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return nil, err
	}
	return redactReport(raw), nil
}
