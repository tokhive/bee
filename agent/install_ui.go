package bee

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/tokhive/bee/logx"
)

// installUI formats login, setup and installer handoff prompts; it never changes service configuration.
type installUI struct {
	lang                       string
	terminal, color, installer bool
}

func newInstallUI(out io.Writer) (installUI, error) {
	lang := os.Getenv("BEE_LANG")
	if lang != "" && lang != "zh" && lang != "en" {
		return installUI{}, fmt.Errorf("invalid BEE_LANG %q; allowed values: zh, en", lang)
	}
	if lang == "" {
		lang = "en"
		for _, name := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
			if value := os.Getenv(name); value != "" {
				if strings.HasPrefix(value, "zh") {
					lang = "zh"
				}
				break
			}
		}
	}
	terminal := logx.Readable(out) && os.Getenv("TERM") != "dumb"
	return installUI{lang: lang, terminal: terminal, color: terminal && os.Getenv("NO_COLOR") == "", installer: os.Getenv("BEE_INSTALL_UI") == "1"}, nil
}

func (ui installUI) text(en, zh string) string {
	if ui.lang == "zh" {
		return zh
	}
	return en
}

func (ui installUI) status(out io.Writer, icon, color, en, zh string) {
	message := ui.text(en, zh)
	if ui.terminal {
		message = icon + " " + message
	}
	if ui.color {
		message = "\x1b[" + color + "m" + message + "\x1b[0m"
	}
	fmt.Fprintln(out, message)
}
